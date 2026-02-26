# Dock Availability Prediction -- Methodology

## 1. Objective

Predict the number of **empty docks** (`empty_docks`) at Santander Cycles docking stations near Imperial College London. Accurate forecasts allow commuters to decide, before leaving home, whether their target station will have space to dock a bike.

## 2. Data

- **Source:** Merged bike availability (TfL BikePoint API, polled every minute) + weather observations (Open-Meteo API).
- **Scope:** 21 stations within 800 m of Imperial College, ~1 day of continuous collection.
- **Rows after merge:** 26,780 (one row per station per minute); 25,037 after dropping NaN rows.
- **Weather match rate:** 93.6 % (remaining rows carry NaN weather fields and are dropped during training).
- **Weather variation:** Temperature 10.1--16.2 C, humidity 61--89 %, precipitation 0 mm (no rain), wind speed 6.3--24.1 m/s.

## 3. Feature Engineering

| Feature | Type | Rationale |
|---------|------|-----------|
| `hour` (0-23) | Temporal | Dock demand follows strong intraday patterns (commute peaks). |
| `hour_sin`, `hour_cos` | Temporal (cyclical) | Sine/cosine encoding ensures hour 23 and hour 0 are treated as neighbours. |
| `weekday` (0-6) | Temporal | Weekday vs. weekend usage differs substantially. |
| `is_weekend` | Binary | Explicit flag to capture the weekday/weekend split. |
| `temperature` (C) | Weather | Higher temperatures correlate with increased cycling activity. |
| `humidity` (%) | Weather | High humidity may discourage cycling. |
| `precipitation` (mm/h) | Weather | Rain is the strongest weather deterrent for cycling. |
| `wind_speed` (m/s) | Weather | Strong wind reduces cycling uptake. |
| `station_enc` | Categorical (encoded) | Each station has a unique baseline occupancy and capacity. |
| `total_docks` | Station property | Normalises predictions relative to station size. |

**Target variable:** `empty_docks` (integer, 0 to `total_docks`).

## 4. Two Model Families: Forecast vs. Nowcast

We train **two separate model families** to understand the contribution of different feature groups:

### Forecast (temporal + weather + station)
The **primary model** for deployment. Uses only features that are available ahead of time: time of day, day of week, weather conditions, and station identity. This model answers: *"Given the time and weather, how many docks will be free?"*

### Nowcast (forecast features + 1-min lag)
Adds `empty_docks_lag1` (the dock count from 1 minute ago). This model is useful for near-real-time correction but **cannot be used for true forecasting** because it requires knowing the current state. We include it to demonstrate the massive accuracy boost from autoregressive features and to motivate why the forecast task is inherently harder.

**Why the distinction matters:** In an initial experiment without this separation, the lag feature dominated at ~99% importance, making all other features (including weather) appear irrelevant. The model was essentially learning "predict the same value as 1 minute ago" -- trivially accurate but useless for advance planning.

## 5. Train / Test Split

A **chronological 80/20 split** is used instead of random splitting. This is critical for time-series data because:

- Random splitting would leak future information into the training set.
- A chronological split simulates real deployment: the model only sees past data when predicting the future.
- It provides a realistic estimate of out-of-sample performance.
- **Train:** 20,029 rows (25 Feb 17:12 -- 26 Feb 11:35 UTC)
- **Test:** 5,008 rows (26 Feb 11:35 -- 26 Feb 16:06 UTC)

## 6. Models

### 6.1 Baseline -- Historical Average

For each combination of `(station, hour, weekday)`, compute the mean `empty_docks` from the training set. This model captures recurring temporal patterns but ignores weather and recent trends.

### 6.2 Random Forest Regressor

- **Rationale:** Ensemble of decision trees that handles non-linear relationships, mixed feature types, and is robust to outliers. No feature scaling required.
- **Hyper-parameters:** 200 trees, max depth 15, min 5 samples per leaf.

### 6.3 Gradient Boosting Regressor

- **Rationale:** Sequential boosting typically achieves higher accuracy than bagging (Random Forest) on structured/tabular data. Slower to train but often produces the best single-model results.
- **Hyper-parameters:** 300 trees, max depth 6, learning rate 0.1, min 10 samples per leaf.

## 7. Evaluation Metrics

| Metric | Description |
|--------|-------------|
| **MAE** (Mean Absolute Error) | Average absolute prediction error in dock units. Most interpretable. |
| **RMSE** (Root Mean Squared Error) | Penalises large errors more heavily than MAE. |
| **R-squared** (Coefficient of Determination) | Proportion of variance explained; 1.0 = perfect. |

The model with the **lowest MAE** is selected as the production model.

## 8. Results

### Forecast Models (no lag -- the real prediction task)

| Model | MAE | RMSE | R-squared |
|-------|-----|------|-----------|
| Baseline (Historical Avg) | 11.28 | 12.33 | -5.85 |
| Random Forest | 2.81 | 4.29 | 0.17 |
| **Gradient Boosting** | **2.67** | **4.09** | **0.25** |

### Nowcast Models (with 1-min lag)

| Model | MAE | RMSE | R-squared |
|-------|-----|------|-----------|
| Baseline (Historical Avg) | 11.28 | 12.33 | -5.85 |
| **Random Forest** | **0.16** | **0.37** | **0.99** |
| Gradient Boosting | 0.20 | 0.39 | 0.99 |

**Best forecast model: Gradient Boosting** (MAE = 2.67 docks).

### Interpretation

- The **nowcast** models achieve near-perfect accuracy (MAE < 0.2 docks) but this is misleading -- the lag feature alone explains 99% of the variance, making all other features negligible.
- The **forecast** models (R-squared = 0.25) show that predicting dock availability from time + weather alone is a much harder task, especially with only 1 day of data.
- The **baseline** fails badly (negative R-squared) because 1 day of data provides only one observation per (station, hour, weekday) group -- no averaging possible. With 1-2 weeks of data, this baseline will become competitive.

## 9. Feature Importance (Forecast Model)

The feature importance plot (`feature_importance.png`) shows the Gradient Boosting model's reliance on each feature:

1. **`total_docks`** (~69%) -- Station capacity is the strongest predictor: larger stations tend to have more free docks.
2. **`station_enc`** (~10%) -- Station identity captures location-specific demand patterns.
3. **`wind_speed`** (~9%) -- The weather feature with the most variation in the dataset (6--24 m/s).
4. **`humidity`** (~5%) and **`temperature`** (~4%) -- Secondary weather effects.
5. **`hour_cos`** (~2%) -- Time-of-day effect (limited by only 1 day of data).
6. **`precipitation`** (~0%) -- No rain occurred during the collection period, so this feature has zero variance and zero predictive power.

**Key insight:** Weather features (wind, humidity, temperature) already contribute ~18% of total importance despite minimal variation. With multi-day data spanning diverse weather conditions, their contribution is expected to increase substantially.

## 10. Limitations

- **Limited data:** ~1 day of observations. The model cannot learn weekly seasonality or multi-day weather patterns. Results will improve substantially after 1-2 weeks of data collection.
- **No rain in dataset:** Precipitation -- expected to be the strongest weather predictor -- has zero variance (0 mm throughout). The model cannot learn its effect until rainy days are observed.
- **No seasonal effects:** Spring/summer cycling patterns differ from winter; the current dataset covers a single season snapshot.
- **Low R-squared for forecast:** R-squared of 0.25 means only 25% of dock variance is explained. This is expected with 1 day of data and will improve with more temporal patterns to learn from.
- **Station set is fixed:** The model is trained on 21 specific stations and does not generalise to stations outside the training set without retraining.
- **No event data:** Special events (e.g. concerts, strikes) that disrupt normal patterns are not captured.

## 11. Next Steps

1. **Collect more data** (target: 1-2 weeks) and retrain -- this is the single most impactful improvement.
2. **Capture diverse weather** -- rain, cold, and warm days will make weather features more predictive.
3. **Add longer lag features** (5 min, 15 min, 1 hour) for a hybrid forecast/nowcast model.
4. **Hyper-parameter tuning** with cross-validation on a larger dataset.
5. **Dashboard integration:** Serve predictions via the Flask API (`/api/forecast`).
6. **Evaluate per-station performance** to identify stations where the model struggles.
7. **Explore time-series models** (e.g. LSTM, Prophet) if tree-based models plateau.
