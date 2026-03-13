# Dock Availability Prediction -- Methodology

## 1. Objective

Predict the number of **empty docks** (`empty_docks`) at Santander Cycles docking stations near Imperial College London, **15 minutes into the future**. Accurate forecasts allow commuters to decide, before leaving home, whether their target station will have space to dock a bike.

Two prediction contexts are supported:
- **Now page (Nowcast):** Given current dock counts + weather + time, predict T+15 min.
- **Plan page (Forecast):** Given only time + weather + station, predict docks hours or days ahead (no current state available).

---

## 2. Data Sources

Three data streams are merged into a single training dataset:

| Source | Table | Polling | Fields used |
|--------|-------|---------|-------------|
| TfL BikePoint API | `bike_availability` | Every 1 min | `empty_docks`, `total_docks`, `station_id`, `timestamp` |
| ESP32 temperature sensor | `temperature_readings` | ~Every 1 min | `temperature_c`, `created_at` |
| Open-Meteo Weather API | `weather_data` | Every 1 min | `humidity`, `precipitation`, `wind_speed` |

**Temperature note:** The sensor temperature (from the ESP32) is used as the training feature -- not the API temperature. This fulfils the assignment requirement to incorporate physical sensor data into the model. For deployment predictions, the Open-Meteo forecast temperature is used as a substitute, since the sensor only provides current readings, not forecasts.

### 2.1 Join Strategy

All three sources record timestamps independently, with up to ~50 seconds of jitter between them. To join:

1. Round every timestamp to the **nearest minute**.
2. Aggregate sensor readings per minute (mean temperature, rounded to 2 decimal places).
3. Aggregate weather readings per minute (mean humidity, precipitation, wind speed).
4. Inner-join bike data with sensor data on the rounded minute.
5. Inner-join the result with weather data on the rounded minute.

This produces one row per station per minute, with all features aligned.

### 2.2 Dataset Summary

| Metric | Value |
|--------|-------|
| Raw bike rows | 315,773 |
| Stations | 21 (within 800 m of Imperial College) |
| Time span | 25 Feb 2026 17:12 -- 13 Mar 2026 09:36 UTC (~16 days) |
| Rows after merge & cleaning | 315,437 |
| Dropped (NaN in key columns) | 336 |

### 2.3 Data Cleaning

- **Timestamp rounding:** All timestamps rounded to nearest minute to enable joining across sources.
- **Deduplication:** Multiple sensor or weather readings within the same minute are averaged.
- **NaN removal:** Rows missing any key column (`empty_docks`, `total_docks`, `temperature`, `humidity`, `precipitation`, `wind_speed`) are dropped. Only 336 of 315,773 rows were affected (0.1%).
- **Temperature precision:** Sensor temperature averages rounded to 2 decimal places.
- **No outlier removal:** All values fall within physically plausible ranges (temperature 5--19 C, humidity 43--98%, wind 0.7--35.6 m/s, precipitation 0--0.6 mm/h). No synthetic outliers were introduced.

### 2.4 Weather Variation

| Variable | Min | Max | Range |
|----------|-----|-----|-------|
| Temperature | 5.3 C | 18.7 C | 13.4 C |
| Humidity | 43% | 98% | 55% |
| Precipitation | 0.0 mm/h | 0.6 mm/h | 0.6 mm/h |
| Wind speed | 0.7 m/s | 35.6 m/s | 34.9 m/s |

The dataset captures a reasonable range of late-winter/early-spring conditions, though heavy rain events are underrepresented (max 0.6 mm/h).

---

## 3. Feature Engineering

### 3.1 Target Variable

The target is `empty_docks` **15 minutes in the future**. This is constructed by shifting each station's `empty_docks` series backward by 15 rows (since data is recorded every minute):

```
target[t] = empty_docks[t + 15]
```

The last 15 rows per station have no target and are dropped. A 15-minute horizon was chosen because it matches a typical walking time to the station from Imperial College.

### 3.2 Feature Set

| Feature | Type | Description |
|---------|------|-------------|
| `hour` | Temporal | Fractional hour (e.g. 8.25 = 08:15). Captures fine-grained intraday patterns. |
| `hour_sin` | Temporal (cyclical) | `sin(2π · hour / 24)`. Ensures hour 23 and hour 0 are treated as neighbours. |
| `hour_cos` | Temporal (cyclical) | `cos(2π · hour / 24)`. Paired with sin for full circular encoding. |
| `weekday` | Temporal | Day of week (0=Monday, 6=Sunday). |
| `is_weekend` | Binary | 1 if Saturday/Sunday, 0 otherwise. |
| `temperature` | Weather | Sensor temperature in Celsius. |
| `humidity` | Weather | Relative humidity (%). |
| `precipitation` | Weather | Precipitation rate (mm/h). |
| `wind_speed` | Weather | Wind speed (m/s). |
| `station_enc` | Categorical | Integer-encoded station ID (LabelEncoder). Captures station-specific baselines. |
| `total_docks` | Station | Total docking capacity. Normalises predictions relative to station size. |
| `empty_docks_lag1` | Lag (Nowcast only) | Current empty docks (1-minute lag). Only used in the nowcast model. |

### 3.3 Cyclical Hour Encoding

Standard integer encoding of hours (0--23) implies that hour 23 and hour 0 are maximally distant, when they are actually adjacent. Sine/cosine encoding maps hours to a circle, preserving this proximity. Both sin and cos are needed to avoid ambiguity (sin alone maps hour 3 and hour 21 to the same value).

### 3.4 Why Two Feature Sets?

The **nowcast** model adds `empty_docks_lag1` (the current dock count). This is extremely predictive for near-future values but is **only available in real time** -- it cannot be used when planning a commute for tomorrow morning. The two-model architecture ensures:

- **Plan page** uses only features available ahead of time (time, weather forecast, station).
- **Now page** leverages live data for much higher accuracy.

---

## 4. Train / Test Split

A **chronological 80/20 split** is used:

| Split | Rows | Period |
|-------|------|--------|
| Train | 252,349 | 25 Feb 17:20 -- 10 Mar 06:29 UTC (~12.5 days) |
| Test | 63,088 | 10 Mar 06:29 -- 13 Mar 09:15 UTC (~3 days) |

**Why chronological, not random?**
- Random splitting would leak future information into the training set, inflating accuracy.
- A chronological split simulates real deployment: the model only sees past data when predicting the future.
- It reveals whether the model generalises to new days and weather conditions.

---

## 5. Models

Three model architectures are trained for each feature set (Forecast and Nowcast), giving 6 models total.

### 5.1 Baseline -- Historical Average

For each combination of `(station, rounded_hour, weekday)`, compute the mean `empty_docks` from the training set. At prediction time, look up the corresponding group mean. If no match exists, fall back to the global mean.

This model captures recurring temporal patterns (e.g. "Station X typically has 8 free docks at 9am on Tuesdays") but ignores weather and recent trends.

### 5.2 Random Forest Regressor

An ensemble of 200 decision trees, each trained on a bootstrap sample of the data. Final prediction is the average across all trees.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `n_estimators` | 200 | Sufficient for convergence without excessive training time |
| `max_depth` | 15 | Prevents overfitting while allowing complex interactions |
| `min_samples_leaf` | 5 | Regularisation to avoid fitting noise |
| `n_jobs` | -1 | Parallel training across all CPU cores |

**Strengths:** Handles non-linear relationships, mixed feature types, robust to outliers, no feature scaling required, provides feature importance estimates.

### 5.3 Gradient Boosting Regressor

Sequential ensemble where each tree corrects the errors of the previous ones. Typically achieves higher accuracy than Random Forest on structured tabular data.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `n_estimators` | 300 | More trees than RF since each tree is shallow |
| `max_depth` | 6 | Shallow trees prevent overfitting in boosting |
| `learning_rate` | 0.1 | Standard rate; balances speed and accuracy |
| `min_samples_leaf` | 10 | Stronger regularisation due to sequential learning |

---

## 6. Evaluation Metrics

| Metric | Formula | Interpretation |
|--------|---------|---------------|
| **MAE** | Mean of \|actual - predicted\| | Average error in dock units. Most interpretable: "the prediction is off by X docks on average." |
| **RMSE** | √(Mean of (actual - predicted)²) | Penalises large errors more heavily. Important for safety: a prediction that's off by 10 docks once is worse than being off by 2 docks five times. |
| **R²** | 1 - SS_res / SS_tot | Proportion of variance explained. 1.0 = perfect, 0 = no better than predicting the mean. |

The model with the **lowest MAE** is selected as the production model within each family.

---

## 7. Results

### 7.1 Forecast Models (time + weather + station, no current state)

| Model | MAE | RMSE | R² |
|-------|-----|------|-----|
| **Baseline (Historical Avg)** | **3.41** | **5.05** | **0.75** |
| Random Forest | 3.48 | 4.84 | 0.77 |
| Gradient Boosting | 3.56 | 4.86 | 0.77 |

**Best: Baseline** (MAE = 3.41 docks)

### 7.2 Nowcast Models (same + current empty_docks)

| Model | MAE | RMSE | R² |
|-------|-----|------|-----|
| Baseline (Historical Avg) | 3.41 | 5.05 | 0.75 |
| **Random Forest** | **1.09** | **1.77** | **0.97** |
| Gradient Boosting | 1.11 | 1.78 | 0.97 |

**Best: Random Forest** (MAE = 1.09 docks)

### 7.3 Interpretation

**Why did Baseline win the Forecast family?**

The Historical Average Baseline (MAE = 3.41) slightly outperformed both ML models (RF: 3.48, GB: 3.56). This is a meaningful finding:

- With 16 days of data covering ~2 full weeks, the Baseline has enough observations per (station, hour, weekday) group to compute stable averages.
- The ML models attempt to learn additional patterns from weather, but the weather variation in the dataset (mostly dry, mild late-winter conditions) does not yet provide enough signal to improve beyond the temporal baseline.
- The ML models achieve higher R² (0.77 vs 0.75) and lower RMSE (4.84 vs 5.05), meaning they handle extreme values better, but their average error (MAE) is slightly higher due to overfitting on weather noise.

This result is consistent with time-series forecasting literature: simple baselines are hard to beat without sufficient data diversity.

**Why is Nowcast so much better?**

The Random Forest Nowcast model (MAE = 1.09) achieves 3x lower error than any Forecast model. This is because dock counts are highly autocorrelated: the number of free docks right now is the strongest predictor of free docks 15 minutes from now. The `empty_docks_lag1` feature dominates the model's feature importance.

This dramatic gap validates the two-model architecture: the Now page benefits enormously from live data, while the Plan page must rely on temporal and weather patterns alone.

### 7.4 Feature Importance (Nowcast -- Random Forest)

The feature importance plot (`feature_importance_nowcast.png`) shows:

1. **`empty_docks_lag1`** -- Dominant feature (current dock count is highly predictive of near-future)
2. **`station_enc`** -- Station identity captures location-specific patterns
3. **`total_docks`** -- Station capacity
4. **`hour`** / temporal features -- Time-of-day effects
5. **Weather features** -- Contribute modestly; their relative importance is suppressed by the dominant lag feature

---

## 8. Dashboard Integration

### 8.1 Now Page (Nowcast Model)

- **Model:** Random Forest with `empty_docks_lag1` (MAE = 1.09)
- **Endpoint:** `/api/forecast`
- **Process:** Fetches latest dock counts and weather from the database, builds feature vectors including current `empty_docks` for each station, predicts T+15 min.
- **Display:** Each station card shows a colour-coded annotation (e.g. "-> ~12 in 15min"). The recommendation banner uses predicted dock counts.

### 8.2 Plan Page (Forecast Model)

- **Model:** Historical Average Baseline (MAE = 3.41)
- **Endpoint:** `/api/commute-scan`
- **Process:** Fetches weather forecast from Open-Meteo for the target date, scans the time window in 5-minute steps, predicts dock availability per station per slot.
- **Display:** Timeline chart with predicted docks over time, colour-coded recommendation card with suggested arrival/departure time.

### 8.3 Architecture

The `ForecastService` class (`webapp/forecast.py`) loads the model once at startup and exposes `predict()`, `predict_all_stations()`, and `scan_time_range()` methods. Feature vectors (cyclical hour encoding, weekend flag, weather, station encoding) are constructed internally. Unknown stations (not in the training set) return `None` gracefully.

Two singleton instances are maintained: `get_forecast_service()` for planning and `get_nowcast_service()` for live predictions.

---

## 9. Limitations

1. **Limited weather diversity:** The 16-day dataset covers mostly dry, mild conditions (max precipitation 0.6 mm/h). The model has limited exposure to heavy rain, which is expected to be a strong predictor of dock availability.
2. **No seasonal variation:** The dataset covers late February to mid-March only. Summer cycling patterns (higher volume, longer days) are not represented.
3. **Forecast Baseline ceiling:** The Baseline model cannot capture non-linear weather interactions. With more diverse weather data, ML models are expected to overtake it.
4. **Fixed station set:** The model only knows 21 stations. Predicting for new stations requires retraining.
5. **No event data:** Special events (concerts, university holidays, tube strikes) can cause unusual demand patterns that the model cannot anticipate.
6. **Sensor temperature as proxy:** The model is trained on ESP32 sensor temperature but deployed with API forecast temperature. While these are strongly correlated, systematic biases between the two could affect prediction accuracy.

---

## 10. Reproducibility

```bash
# Step 1: Export merged dataset from Supabase
export DATABASE_URL="postgresql://..."
python export_data.py --output data/merged.csv

# Step 2: Train models
python training/train_model.py --data data/merged.csv

# Outputs:
#   training/model_forecast.pkl           (Baseline -- for Plan page)
#   training/model_nowcast.pkl            (Random Forest -- for Now page)
#   training/model.pkl                    (backward-compatible copy of forecast)
#   training/feature_importance_nowcast.png
#   training/predictions.png
#   training/predictions_nowcast.png
#   training/model_comparison.png
#   training/metrics.txt
```

**Dependencies:** pandas, numpy, scikit-learn, matplotlib, joblib
