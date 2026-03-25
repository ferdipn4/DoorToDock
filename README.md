# Door2Dock – Smart-Commute Predictor

A predictive system that forecasts Santander Cycles docking station availability near Imperial College London and provides context-aware commute recommendations.

By fusing physical sensor data (PIR motion sensor on ESP32, DHT22 temperature sensor) with public real-time data streams (TfL Bike API, Open-Meteo Weather API), Door2Dock tells you — before you leave home — whether your target station will have bikes or docks available.

**Live app:** [smart-commute-imperial.herokuapp.com](https://smart-commute-imperial-0cac549c4dd9.herokuapp.com/)

---

## Features

- **Now** — Real-time recommendation for the best station to dock or pick up a bike, with a T+15 min availability prediction
- **Plan** — Set a future arrival time and day to get a station recommendation based on forecasted availability
- **Insights** — Data exploration: hourly/weekly heatmaps, weather correlations, model performance metrics, system architecture overview
- **Settings** — Reorder preferred stations, configure commute defaults, Telegram push notifications, appearance (light/dark/system)
- **Onboarding tour** — Guided walkthrough for first-time visitors
- **Telegram alerts** — Push notifications triggered by the PIR motion sensor when you leave home

---

## Architecture

```
┌──────────────────┐                    ┌─────────────────────────────┐
│  TfL BikePoint   │  REST (1/min)      │                             │
│  API (800+ stn)  ├──────────────────▶│     Heroku (2 Dynos)        │
└──────────────────┘                    │                             │
                                        │  ┌───────────────────────┐  │
┌──────────────────┐  REST (1/min)      │  │  Worker Dyno          │  │
│  Open-Meteo      ├──────────────────▶│  │  bike_collector.py    │  │
│  Weather API     │                    │  │  weather_collector.py │  │
└──────────────────┘                    │  └───────────┬───────────┘  │
                                        │              │              │
┌──────────────────┐  HTTPS             │  ┌───────────▼───────────┐  │
│  ESP32 + PIR     ├──────────────────▶│  │  Supabase PostgreSQL  │  │
│  + DHT22 Sensor  │                    │  └───────────┬───────────┘  │
└──────────────────┘                    │              │              │
                                        │  ┌───────────▼───────────┐  │
                                        │  │  Web Dyno (Flask)     │  │
                                        │  │  Dashboard + API      │  │
                                        │  └───────────────────────┘  │
                                        └─────────────────────────────┘
```

---

## Data Sources

| Source | Table | Polling | Description |
|--------|-------|---------|-------------|
| TfL BikePoint API | `bike_availability` | 1/min | Dock/bike counts for 21 stations within 800m of Imperial College |
| Open-Meteo API | `weather_data` | 1/min | Temperature, humidity, precipitation, wind speed |
| ESP32 DHT22 | `temperature_readings` | ~1/min | Doorstep temperature (used as model training feature) |
| ESP32 PIR | `sensor_events` | Event-driven | Departure events that trigger Telegram alerts |
| Reference | `monitored_stations` | Static | 21 stations with coordinates and walking distances |

---

## ML Models

Two Gradient Boosting models trained on 600k+ rows of merged bike + weather data:

| Model | Use Case | Features | MAE | R² |
|-------|----------|----------|-----|-----|
| **Nowcast** | Now page (T+15 min) | Current docks + time + weather + lag | ~1.2 docks | 0.97 |
| **Forecast** | Plan page (hours ahead) | Time + weather + station only | ~3.5 docks | 0.72 |

See [`training/METHODOLOGY.md`](training/METHODOLOGY.md) for full methodology, feature engineering, and evaluation.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.12, Flask |
| Database | Supabase (PostgreSQL) |
| Hosting | Heroku (Web + Worker Dynos) |
| ML | scikit-learn (Gradient Boosting) |
| Frontend | Vanilla JS, Chart.js, Leaflet |
| Hardware | ESP32 + HC-SR501 PIR + DHT22 |
| Notifications | Telegram Bot API |

---

## Project Structure

```
Door2Dock/
├── bike_collector.py          # TfL API poller (every minute, 21 stations)
├── weather_collector.py       # Open-Meteo weather poller
├── worker.py                  # Combined worker for Heroku
├── export_data.py             # Data export + cleaning + merge
├── data/
│   └── merged.csv             # Merged training dataset (622k rows)
├── training/
│   ├── train_model.py         # Model training (Nowcast + Forecast)
│   ├── METHODOLOGY.md         # Full methodology documentation
│   ├── model_nowcast.pkl      # Nowcast model (T+15 min)
│   ├── model_forecast.pkl     # Forecast model (hours ahead)
│   └── *.png                  # Feature importance, SHAP, residuals
├── webapp/
│   ├── app.py                 # Flask app factory
│   ├── api.py                 # JSON API (15+ endpoints)
│   ├── views.py               # HTML page routes
│   ├── db.py                  # Database helper
│   ├── forecast.py            # ForecastService (prediction engine)
│   ├── telegram.py            # Telegram bot integration
│   ├── templates/             # Jinja2 HTML templates
│   └── static/
│       ├── css/style.css      # Custom styles (light + dark mode)
│       └── js/                # Page-specific JS modules
├── Procfile                   # Heroku dyno config
├── requirements.txt           # Python dependencies
└── SETUP.md                   # Deployment guide
```

---

## Local Development

```bash
# Clone and install
git clone https://github.com/feli-codes/Door2Dock.git
cd Door2Dock
pip install -r requirements.txt

# Set environment variable
export DATABASE_URL="your_supabase_connection_string"

# Run the web app
python -m flask --app webapp.app run --debug

# Run data collectors (optional)
python bike_collector.py --once    # single collection
python bike_collector.py           # continuous (1/min)
```

---

## Deployment

See [`SETUP.md`](SETUP.md) for full Heroku + Supabase setup instructions.

```bash
# Deploy to Heroku
git push heroku main

# Scale dynos
heroku ps:scale web=1 worker=1
```
