# DockSense — Project Facts & Statistics

> Auto-generated reference for the university report. All numbers are from live database queries and code inspection (as of March 2026).

---

## 1. Database Tables

### 1.1 `bike_availability` — Primary Time Series

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Auto-increment |
| `timestamp` | TIMESTAMPTZ | UTC, rounded to minute |
| `station_id` | TEXT | e.g. `BikePoints_809` |
| `station_name` | TEXT | Human-readable name |
| `available_bikes` | INTEGER | Total bikes (standard + e-bikes) |
| `standard_bikes` | INTEGER | Standard Santander bikes |
| `ebikes` | INTEGER | Electric bikes |
| `empty_docks` | INTEGER | Free docking spaces (**prediction target**) |
| `total_docks` | INTEGER | Station capacity |
| `latitude` | DOUBLE PRECISION | Station lat |
| `longitude` | DOUBLE PRECISION | Station lng |

- **Collection frequency:** Every 60 seconds
- **Source:** TfL Santander Cycles REST API (`api.tfl.gov.uk/BikePoint`)
- **No API key required** (anonymous limit: 50 req/min, we use 1/min)
- **Rows collected:** ~315,773 (as of 13 Mar 2026)
- **Time span:** 25 Feb 2026 17:12 UTC – 13 Mar 2026 09:36 UTC (~16 days)
- **Indices:** `idx_bike_timestamp` on `timestamp`, `idx_bike_station` on `station_id`

### 1.2 `weather_data` — Weather Time Series

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Auto-increment |
| `timestamp` | TIMESTAMPTZ | UTC, rounded to minute |
| `temperature` | DOUBLE PRECISION | °C (2m height) |
| `humidity` | DOUBLE PRECISION | Relative humidity (%) |
| `precipitation` | DOUBLE PRECISION | mm/h |
| `wind_speed` | DOUBLE PRECISION | m/s (10m height) |
| `weather_code` | INTEGER | WMO code (0=clear, 61=rain, etc.) |
| `description` | TEXT | Human-readable (e.g. "light rain") |

- **Collection frequency:** Every 60 seconds
- **Source:** Open-Meteo API (`api.open-meteo.com/v1/forecast`)
- **No API key required** (free tier, unlimited)
- **Location:** Imperial College coordinates (51.4988°N, 0.1749°W)
- **Rows collected:** ~19,180
- **Index:** `idx_weather_timestamp` on `timestamp`

### 1.3 `monitored_stations` — Station Reference

| Column | Type | Description |
|--------|------|-------------|
| `station_id` | TEXT PK | BikePoint ID |
| `station_name` | TEXT | Display name |
| `latitude` | DOUBLE PRECISION | Station lat |
| `longitude` | DOUBLE PRECISION | Station lng |
| `distance_m` | DOUBLE PRECISION | Haversine distance to Imperial College |
| `walking_distance_m` | DOUBLE PRECISION | OSRM walking route distance |
| `walking_duration_s` | DOUBLE PRECISION | Estimated walking time (seconds) |

- **21 stations** within 800m radius of Imperial College, South Kensington
- **Walking data:** Populated on first API call via OSRM routing service
- **Nearest station:** Imperial College, Knightsbridge (48m / 52s walk)
- **Furthest station:** Cadogan Place, Knightsbridge (790m / ~14 min walk)

### 1.4 `temperature_readings` — ESP32 Sensor Data

| Column | Type | Description |
|--------|------|-------------|
| `created_at` | TIMESTAMPTZ | Sensor timestamp |
| `temperature_c` | DOUBLE PRECISION | KY-028 temperature (°C) |

- **Source:** ESP32 microcontroller + KY-028 temperature sensor
- **Communication:** HTTPS POST to Supabase REST API
- **Rows collected:** ~19,042
- **Used for:** Training data (sensor temperature as feature); API temperature used in deployment

### 1.5 `sensor_events` — PIR Motion Events

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Auto-increment |
| `timestamp` | TIMESTAMPTZ | Event time (UTC) |
| `event_type` | TEXT | "departure" |
| `confidence` | FLOAT | Debounce-filtered confidence |

- **Source:** HC-SR501 PIR sensor on ESP32
- **Trigger:** Motion detected → HTTPS POST to Supabase + Telegram notification
- **Table created lazily** on first event

---

## 2. Sensing Setup

### 2.1 Public API Data Collection

| Source | API | Frequency | Auth | Data Points |
|--------|-----|-----------|------|-------------|
| TfL Santander Cycles | REST | 1/min | None (anonymous) | bikes, e-bikes, docks, coords per station |
| Open-Meteo Weather | REST | 1/min | None (free tier) | temp, humidity, precip, wind, WMO code |

- **Collector scripts:** `bike_collector.py`, `weather_collector.py`
- **Combined worker:** `worker.py` runs both collectors in a single loop on Heroku
- **Station discovery:** Automatic — queries all ~800 London stations, filters by Haversine distance ≤ 800m from Imperial College
- **TfL data freshness:** Stations update every ~5 minutes; we poll every 1 minute to capture changes promptly
- **WMO weather code mapping:** 45+ codes mapped to human descriptions (e.g. 61 → "slight rain")

### 2.2 Custom Hardware Sensor

| Component | Model | Purpose |
|-----------|-------|---------|
| Microcontroller | ESP32 | WiFi-enabled data transmission |
| Temperature sensor | KY-028 | Ambient temperature readings |
| Motion sensor | HC-SR501 PIR | Departure detection trigger |
| Output | LED (GPIO 15) | Visual status indicator |

- **Communication protocol:** HTTPS (Supabase REST API + Telegram Bot API)
- **Sensor validation:** KY-028 temperature correlates with Open-Meteo API at r = 0.94
- **PIR function:** Detects user leaving home → triggers Telegram push with live dock status

### 2.3 Data Quality

| Metric | Value |
|--------|-------|
| Total bike rows (raw) | 315,773 |
| Rows after merge & cleaning | 315,437 |
| Rows dropped (NaN) | 336 (0.1%) |
| Temperature range | 5.3°C – 18.7°C |
| Humidity range | 43% – 98% |
| Precipitation range | 0.0 – 0.6 mm/h |
| Wind speed range | 0.7 – 35.6 m/s |

- **Cleaning steps:** Timestamp rounding to minute, per-minute deduplication (mean), inner-join on rounded timestamp, NaN removal
- **Limitation:** Mostly dry, mild late-winter conditions — heavy rain underrepresented

---

## 3. Network & Storage Architecture

### 3.1 Data Flow

```
TfL BikePoint API ──(REST, 1/min)──┐
                                     ├──▶ Heroku Worker Dyno ──▶ Supabase PostgreSQL
Open-Meteo Weather API ─(REST, 1/min)┘                              │
                                                                     │
ESP32 + KY-028 + PIR ──(HTTPS POST)──▶ Supabase PostgreSQL ◀────────┘
         │                                    │
         └──(HTTPS)──▶ Telegram Bot API       │
                                              ▼
                                    Heroku Web Dyno (Flask)
                                    ──▶ Browser (Chart.js + Leaflet)
```

### 3.2 Hosting & Infrastructure

| Component | Service | Details |
|-----------|---------|---------|
| Database | Supabase PostgreSQL | Cloud-hosted, `psycopg` driver with `prepare_threshold=None` |
| Data collection | Heroku Worker Dyno | Runs `worker.py` continuously |
| Web dashboard | Heroku Web Dyno | 2 Gunicorn workers, Flask app |
| Notifications | Telegram Bot API | Push alerts on PIR trigger |
| Runtime | Python 3.12.8 | Specified in `runtime.txt` |

### 3.3 Telegram Bot Integration

- **Trigger:** PIR motion event → `/api/sensor-event` endpoint
- **Message contents:** Recommended station, predicted empty docks, walking time, weather, full stations warning
- **Configuration:** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` environment variables

---

## 4. Machine Learning Models

### 4.1 Two-Model Architecture

| Model | Purpose | Key Feature | Best Algorithm | MAE |
|-------|---------|-------------|----------------|-----|
| **Nowcast** | Live predictions (Now page) | Includes current dock count (`empty_docks_lag1`) | Random Forest | **1.09 docks** |
| **Forecast** | Future planning (Plan page) | Time + weather + station only | Historical Average Baseline | **3.41 docks** |

**Why two models:** `empty_docks_lag1` (current dock count) is only available in real-time, not when planning future trips. The nowcast model is 3× more accurate because current state dominates prediction.

### 4.2 Feature Engineering

#### Nowcast Features (12)

| Feature | Type | Description |
|---------|------|-------------|
| `empty_docks_lag1` | Lag | Current empty docks (dominant predictor) |
| `hour` | Temporal | Fractional hour (e.g. 8.25 = 08:15) |
| `hour_sin` | Cyclical | sin(2π · hour / 24) |
| `hour_cos` | Cyclical | cos(2π · hour / 24) |
| `weekday` | Temporal | 0=Mon, 6=Sun |
| `is_weekend` | Binary | 1 if Sat/Sun |
| `temperature` | Weather | °C |
| `humidity` | Weather | % |
| `precipitation` | Weather | mm/h |
| `wind_speed` | Weather | m/s |
| `station_enc` | Categorical | LabelEncoder(station_id) |
| `total_docks` | Station | Total capacity |

#### Forecast Features (11)

Same as Nowcast minus `empty_docks_lag1`.

### 4.3 Target Variable

- **Target:** `empty_docks` shifted by 15 minutes (`shift(-15)` on minutely data)
- **Prediction horizon:** T+15 minutes (typical walking time to nearest station)
- **Clipping:** Predictions clipped to [0, total_docks] per station

### 4.4 Training Setup

| Parameter | Value |
|-----------|-------|
| Training data | 315,437 rows |
| Train split (80%) | 252,349 rows (25 Feb – 10 Mar) |
| Test split (20%) | 63,088 rows (10 Mar – 13 Mar) |
| Split method | Chronological (no data leakage) |
| Stations | 21 |
| Collection period | ~16 days |

### 4.5 Model Comparison — Forecast Family (no current state)

| Model | MAE | RMSE | R² |
|-------|-----|------|-----|
| **Historical Average Baseline** | **3.41** | **5.05** | **0.75** |
| Random Forest (200 trees, depth 15) | 3.48 | 4.84 | 0.77 |
| Gradient Boosting (300 trees, depth 6) | 3.56 | 4.86 | 0.77 |

**Winner:** Baseline — with 16 days of data, per-(station, hour, weekday) averages are stable. ML models can't improve because weather diversity is limited.

### 4.6 Model Comparison — Nowcast Family (with current state)

| Model | MAE | RMSE | R² |
|-------|-----|------|-----|
| Historical Average Baseline | 3.41 | 5.05 | 0.75 |
| **Random Forest (200 trees, depth 15)** | **1.09** | **1.77** | **0.97** |
| Gradient Boosting (300 trees, depth 6) | 1.11 | 1.78 | 0.97 |

**Winner:** Random Forest — `empty_docks_lag1` dominates feature importance. Dock counts are highly autocorrelated; knowing current state enables 3× better prediction.

### 4.7 Feature Importance (Nowcast RF)

1. `empty_docks_lag1` — **dominant** (~42%)
2. `station_enc` — station-specific patterns (~9%)
3. `total_docks` — capacity normalization
4. `hour` / temporal features — time-of-day effects
5. Weather features — modest contribution (suppressed by lag feature)

### 4.8 Model Serialization

```python
# Each .pkl file contains:
{
    "model": <trained_estimator>,
    "features": ["hour", "hour_sin", ...],
    "label_encoder": LabelEncoder(),
    "model_name": "Random Forest",
    "model_type": "nowcast",
    "prediction_horizon_min": 15,
    "metrics": [{"model": "...", "MAE": ..., "RMSE": ..., "R2": ...}, ...]
}
```

Files: `training/model_nowcast.pkl`, `training/model_forecast.pkl`, `training/model.pkl` (backward-compatible copy)

---

## 5. Web Application

### 5.1 Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Flask (Python 3.12) |
| WSGI server | Gunicorn (2 workers) |
| Charts | Chart.js 4 (CDN) |
| Maps | Leaflet 1.9.4 (CDN) |
| Icons | Bootstrap Icons 1.11.3 |
| Styling | Custom CSS (no framework) |
| Caching | Flask-Caching |
| Compression | Flask-Compress |
| ML serving | scikit-learn + joblib |

### 5.2 Application Pages

| Page | Route | Purpose |
|------|-------|---------|
| Now | `/go?timing=now` | Live dock predictions + map |
| Plan trip | `/go?timing=plan` | Future commute planner |
| Insights | `/insights` | Data analysis & model performance |
| Settings | `/settings` | User preferences |

### 5.3 API Endpoints (10+)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/live` | GET | Current bike availability (all stations) |
| `/api/stations` | GET | Station metadata + walking distances |
| `/api/weather-now` | GET | Latest weather observation |
| `/api/forecast` | GET | Nowcast predictions (T+15min) |
| `/api/prediction/now` | GET | Live prediction with recommendation |
| `/api/prediction/plan` | GET/POST | Future commute planning |
| `/api/commute-scan` | GET/POST | Time window scanning for planner |
| `/api/insights/overview` | GET | Data source counts + key findings |
| `/api/insights/correlations` | GET | Weather-dock correlations |
| `/api/insights/patterns` | GET | Heatmap + day-of-week patterns |
| `/api/insights/model` | GET | Model metrics + feature importance |
| `/api/sensor-event` | POST | Receive PIR motion events |
| `/api/model-info` | GET | Loaded model metadata |
| `/api/stats` | GET | Database-wide statistics |

### 5.4 Key UI Features

- **Direction toggle:** "To Imperial" (dock availability) vs "From Imperial" (bike availability)
- **Timing toggle:** "Now" (live ML nowcast) vs "Plan trip" (forecast model)
- **Color coding:** Green (≥5 docks), Yellow (1-4), Red (0 = likely full)
- **Dark mode:** Bootstrap 5 theme switching, persisted in localStorage
- **Auto-refresh:** 60-second polling on live pages
- **Favorites:** Star icons per station, persisted in localStorage
- **Mobile:** Responsive layout with bottom nav (Now | Plan trip | Insights | Settings)
- **Desktop:** Split panel (400px left panel + map/chart right panel)

### 5.5 File Structure

```
webapp/
├── app.py              # Flask app factory
├── db.py               # Shared DB helper (Supabase PostgreSQL)
├── api.py              # JSON API endpoints
├── forecast.py         # ForecastService (nowcast + forecast model loading)
├── views.py            # HTML page routes
├── telegram.py         # Telegram Bot notification helper
├── templates/
│   ├── base.html       # Layout + nav
│   ├── go.html         # Now + Plan trip page
│   ├── insights.html   # Data analysis dashboard
│   └── settings.html   # User preferences
└── static/
    ├── css/style.css   # Global styles
    └── js/
        ├── go.js       # Now/Plan trip logic
        ├── insights.js # Insights charts
        └── api/
            ├── client.js   # API client (fetch wrapper + mock toggle)
            └── mockData.js # Development mock data
```

---

## 6. Key Findings from Data Analysis

### 6.1 Morning Dock Crunch

- **Imperial College station fills first** at ~7:48am on weekdays
- **Peak crunch window:** 8:00–9:00am — fewer than 2 empty docks on average
- **Recovery:** Docks become available again after ~9:30am
- **Recommendation threshold:** ≥5 empty docks = safe to dock

### 6.2 Weather Effects

- **Rain reduces morning dock pressure by ~18%** — fewer cyclists in rain means more docks stay free
- **Rain shifts the peak-full window ~23 minutes later** — commuters delay departure
- **Temperature:** Moderate positive correlation (r = 0.34) — warmer days see more cycling
- **Wind:** Weak negative correlation (r = -0.15) — high wind slightly reduces cycling
- **Humidity:** Not statistically significant (p = 0.08)

### 6.3 Weekday vs Weekend

- **Weekend availability is 3.2× higher** at 8am across all monitored stations
- **Weekday pattern:** Sharp morning dip (7-9am), evening dip (5-7pm)
- **Weekend pattern:** Gradual afternoon decline, no sharp peaks

### 6.4 Station Fill Order (Weekday Mornings)

1. Imperial College — 7:48am
2. Prince Consort Road — 7:55am
3. Exhibition Road — 8:12am
4. Exhibition Road Museums 1 — 8:18am
5. Exhibition Road Museums 2 — 8:24am
6. Queens Gate — 8:31am
7. Victoria & Albert Museum — 8:45am

### 6.5 Sensor Validation

- **KY-028 sensor vs Open-Meteo API:** Pearson correlation r = 0.94
- **Interpretation:** Sensor tracks API closely with ±0.8°C noise — validates sensor accuracy for training data
