# Claude.md – Smart-Commute Predictor (Door2Dock)

## Projektübersicht

**Projekttitel:** Door2Dock – Smart-Commute Predictor  
**Ziel:** Ein prädiktives System, das die Verfügbarkeit von Santander Cycles Docking-Stationen rund um Imperial College London vorhersagt und kontextabhängige Empfehlungen für den täglichen Arbeitsweg liefert.

**Kernidee:** Durch die Fusion von physischer Sensorik (PIR-Bewegungssensor am ESP32) und öffentlichen Echtzeit-Datenströmen (TfL Bike API + Wetter API) wird ein System geschaffen, das beim Verlassen der Wohnung sofort anzeigt, ob an der Zielstation Bikes/Docks verfügbar sind.

---

## Aufgabenstellung (Uni-Assignment)

### Part 1: Sensing (50%)
- Mindestens 1 Woche kontinuierliche Daten aus mindestens 2 Zeitreihen-Datenquellen unterschiedlicher Natur
- Datenerfassung von einem Custom-Sensor ODER einer öffentlichen Datenquelle
- Netzwerkkommunikation und Datenspeicherung
- Design-Entscheidungen begründen, Data Cleaning diskutieren

### Part 2: Analytics und Interface (50%)
- Web-App / Phone-App / UI zur Datenpräsentation
- Einfache Zeitreihenanalyse (Korrelationen, Trends)
- Innovation, Kreativität, Enterprise-Potenzial, Skalierbarkeit diskutieren

---

## Architektur

```
┌──────────────────┐                    ┌─────────────────────────────┐
│  TfL BikePoint   │  REST (1/min)      │                             │
│  API (800 stations)├─────────────────▶│     Heroku Worker Dyno      │
└──────────────────┘                    │                             │
                                        │  ┌───────────────────────┐  │
┌──────────────────┐  REST (1/min)      │  │  bike_collector.py    │  │
│  Open-Meteo      ├──────────────────▶│  │  21 stations, 1/min   │  │
│  Weather API     │                    │  └───────────┬───────────┘  │
└──────────────────┘                    │              │              │
                                        │  ┌───────────▼───────────┐  │
┌──────────────────┐  HTTPS             │  │  Supabase PostgreSQL  │  │
│  ESP32 + PIR     ├──────┬────────────▶│  │  (Cloud Database)     │  │
│  Motion Sensor   │      │             │  └───────────┬───────────┘  │
└──────────────────┘      │             │              │              │
                          │             │  ┌───────────▼───────────┐  │
                          │             │  │  Flask Web Dashboard   │  │
                          │             │  │  (5 Seiten)            │  │
                          │             │  └───────────────────────┘  │
                          │             └─────────────────────────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │  Telegram Bot API│
                 │  (push alerts)   │
                 └──────────────────┘
```

---

## Datenquellen

### 1. TfL Santander Cycles API (Primäre Datenquelle)
- **Endpoint:** `https://api.tfl.gov.uk/BikePoint`
- **Kein API-Key nötig** (anonymes Limit: 50 Requests/Minute, wir brauchen 1/Minute)
- **Daten:** Alle ~800 Docking-Stationen in London, alle 5 Min aktualisiert
- **Relevante Felder pro Station:**
  - `NbBikes` – Verfügbare Bikes gesamt
  - `NbStandardBikes` – Standard-Bikes
  - `NbEBikes` – E-Bikes
  - `NbEmptyDocks` – Freie Docking-Plätze
  - `NbDocks` – Gesamtkapazität
- **Monitoring:** 21 Stationen im 800m-Radius um Imperial College (South Kensington)
- **Polling-Intervall:** Jede Minute

### 2. OpenWeatherMap API (Zweite Datenquelle)
- **Endpoint:** `https://api.openweathermap.org/data/2.5/weather`
- **API-Key nötig** (Free Tier: 1000 Calls/Tag)
- **Daten:** Temperatur, Niederschlag, Windgeschwindigkeit, Wetter-Code
- **Polling-Intervall:** Alle 15 Minuten
- **Standort:** Imperial College Koordinaten (51.4988, -0.1749)

### 3. PIR-Bewegungssensor (Custom Hardware – Trigger)
- **Hardware:** HC-SR501 PIR-Sensor + ESP32
- **Funktion:** Registriert Verlassen der Wohnung als Event-Trigger
- **Kommunikation:** HTTPS (Supabase + Telegram)
- **Output:** LED indicator (GPIO 15)
- **Notifications:** Telegram push with live dock status

---

## Aktueller Stand der Implementierung

### ✅ Fertig
- **`bike_collector.py`** – Bike-Datensammlung (jede Minute, 21 Stationen)
  - Entdeckt automatisch alle Stationen im 800m-Radius um Imperial College
  - Modi: `--once`, `--discover`, `--stats`, Dauerbetrieb
- **`weather_collector.py`** – Wetter-Datensammlung (jede Minute, Open-Meteo)
  - Temperatur, Luftfeuchtigkeit, Niederschlag, Windgeschwindigkeit, WMO-Code
  - Kein API-Key nötig (Open-Meteo statt OpenWeatherMap)
- **`worker.py`** – Combined Worker für Heroku (beide Collectors)
- **`export_data.py`** – Datenexport + Cleaning + Merge (Bike+Wetter auf Minutenbasis)
- **Supabase PostgreSQL** – Läuft stabil mit `psycopg` + `prepare_threshold=None`
- **Heroku Deployment** – Worker Dyno (Datensammlung) + Web Dyno (Dashboard)
  - App: `smart-commute-imperial`
  - URL: `https://smart-commute-imperial-0cac549c4dd9.herokuapp.com/`
- **Flask Web-Dashboard** (`webapp/`) – 5 Seiten: Live Status | Trends | Weather Impact | Planner | About
  - **Live Status:** Leaflet-Karte mit farbcodierten Stationsmarkern (Grün/Gelb/Rot), Fokus auf freie Docks
  - **Hover-Interaktion:** Station-Card hovern → Marker pulsiert auf der Karte + Popup öffnet sich
  - **Sortierung:** Stationen sortierbar nach Distanz, meiste/wenigste Docks, Name
  - **Trends:** Zusammengelegte Seite aus Time Series + Heatmap
    - Oben: Station-Selector + Zeitraum-Buttons (6h/12h/24h/48h/7d) + Summary-Stats + Free Docks Chart
    - Unten: Weekly Patterns Heatmap (CSS-Grid, Stunde × Wochentag) mit Top 3/5 Toggle + 3 Insight-Cards
  - **Weather Impact:** 4 Pearson-Korrelationskarten (Temperatur/Regen/Wind/Feuchtigkeit vs. Free Docks) + 4 Binned-Bar-Charts + Best/Worst Insight-Cards
  - **About-Seite:** Architektur-Diagramm (inkl. Telegram), Tech Stack, Live-Statistiken
  - **Dock Forecast:** Stat-Card mit T+15min Vorhersage, dynamische Forecast-Annotation pro Station-Card ("→ ~N in 15min")
  - **Favoriten-Sterne:** Klickbare Stern-Icons pro Station-Card auf Live Status, gespeichert in localStorage
  - Dark Mode (Bootstrap 5), Auto-Refresh alle 60s, responsive
  - JSON-API mit 10 Endpoints + graceful DB-Error-Handling (503)

### ✅ Modell-Training (`training/`)
- **`train_model.py`** – Trainiert und vergleicht 3 Modelle für `empty_docks`-Vorhersage (T+15min)
  - Feature Engineering: Temporal (fractional hour, weekday, cyclical encoding), Wetter, Station-Encoding, Lag-Feature
  - **T+15min Target Shift:** `shift(-15)` auf minutlichen Daten → Vorhersage 15 Min in die Zukunft
  - **Fractional Hours:** `hour + minute/60` für feingranulare Vorhersagen
  - Modelle: Historical Average (Baseline), Random Forest, Gradient Boosting
  - Chronologischer 80/20 Train/Test Split (kein Data Leakage)
  - Metriken: MAE, RMSE, R²
  - Outputs: `model.pkl` (inkl. `prediction_horizon_min`), `feature_importance.png`, `predictions.png`, `metrics.txt`
- **`METHODOLOGY.md`** – Dokumentation für Uni-Bericht (Zielsetzung, Features, Modellwahl, Limitationen)

### ✅ Forecast-Integration ins Dashboard
- **`webapp/forecast.py`** – ForecastService Singleton
  - Lädt `training/model.pkl` einmalig beim Start, liest `prediction_horizon_min` (Default 60, aktuell 15)
  - Baut Feature-Vektoren intern (fractional hour_sin/cos, is_weekend, station_enc via LabelEncoder, Wetter)
  - `predict_all_stations()` für alle 21 Stationen, unbekannte Stationen → `None`
  - `scan_time_range()` – Scannt Zeitfenster in 5-Min-Schritten, predicted pro Station pro Slot
  - `fetch_weather_forecast()` – Holt stündliche Wettervorhersage von Open-Meteo für ein Zieldatum
- **`/api/forecast`** Endpoint – Query-Params: `?hour=` (float), `?weekday=` (Default: aktuelle fractional hour + horizon)
  - Holt aktuelle Wetterdaten + Stationsliste aus DB
  - Return: `{ available, model_name, prediction_horizon_min, hour, weekday, predictions: [...] }`
- **Dashboard-UI** – Forecast Stat-Card + dynamische "→ ~N in 15min" Annotation pro Station-Card (farbcodiert)

### ✅ Morning Commute Planner
- **`/api/commute-scan`** Endpoint – Query-Params: `?date=`, `?start=`, `?end=`, `?stations=` (kommaseparierte IDs)
  - Holt Wetter-Forecast via Open-Meteo `/v1/forecast` (Fallback: letzte DB-Observation)
  - Scannt gewählte Stationen via `scan_time_range()` in 5-Min-Schritten
  - `_compute_recommendation()`: Findet letzten "sicheren" Zeitpunkt (≥5 Docks bei mindestens einer gewählten Station)
  - Return: `{ available, date, prediction_horizon_min, weather_forecast, favorites, alternatives, recommendation }`
- **Planner-Seite** (`/planner`) – Layout: Stationen (links) | Scan-Settings (Mitte) | Wetter (rechts)
  - **Recommendation-Card:** Farbcodiert (grün/gelb/rot) mit empfohlener Ankunftszeit
  - **Stations-Selektor:** Checkboxen statt Sterne, nächste 3 Stationen automatisch vorausgewählt, in sessionStorage gespeichert
  - **Scan-Settings:** Datumswähler + Zeitfenster (Default: morgen 08:00–10:00), Scan-Button disabled bis mindestens 1 Station gewählt
  - **Wetter-Forecast-Card:** Stundenwerte für das gewählte Zeitfenster
  - **Timeline-Chart:** Chart.js Liniendiagramm (X=Zeit, Y=predicted free docks, eine Linie pro gewählter Station)

### ❌ Noch offen
- ESP32 + PIR-Sensor Setup (pausiert)
- Raspberry Pi als lokaler Server (pausiert)

---

## Datenbankschema

### Tabelle: bike_availability
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | SERIAL / AUTO | Primary Key |
| timestamp | TIMESTAMPTZ | UTC Zeitstempel |
| station_id | TEXT | z.B. "BikePoints_809" |
| station_name | TEXT | z.B. "Exhibition Road, Knightsbridge" |
| available_bikes | INTEGER | Bikes gesamt |
| standard_bikes | INTEGER | Standard-Bikes |
| ebikes | INTEGER | E-Bikes |
| empty_docks | INTEGER | Freie Docking-Plätze |
| total_docks | INTEGER | Gesamtkapazität |
| latitude | FLOAT | Breitengrad |
| longitude | FLOAT | Längengrad |

### Tabelle: monitored_stations
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| station_id | TEXT (PK) | BikePoint ID |
| station_name | TEXT | Stationsname |
| latitude | FLOAT | Breitengrad |
| longitude | FLOAT | Längengrad |
| distance_m | FLOAT | Entfernung zu Imperial College |

### Tabelle: weather_data (noch zu implementieren)
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | SERIAL / AUTO | Primary Key |
| timestamp | TIMESTAMPTZ | UTC Zeitstempel |
| temperature | FLOAT | °C |
| humidity | FLOAT | % |
| precipitation | FLOAT | mm/h |
| wind_speed | FLOAT | m/s |
| weather_code | INTEGER | OpenWeatherMap Code |
| description | TEXT | z.B. "light rain" |

### Tabelle: sensor_events (noch zu implementieren)
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | SERIAL / AUTO | Primary Key |
| timestamp | TIMESTAMPTZ | UTC Zeitstempel |
| event_type | TEXT | "departure" |
| confidence | FLOAT | Nach Debouncing-Filter |

---

## Tech Stack

| Komponente | Technologie |
|-----------|-------------|
| Datensammlung | Python 3.12 |
| Hosting | Heroku (Worker Dyno, Student Pack) |
| Datenbank | MongoDB Atlas ODER Supabase PostgreSQL |
| TfL API | REST, kein Key nötig |
| Wetter API | OpenWeatherMap (Free Tier) |
| Hardware | ESP32 + HC-SR501 PIR + LED (GPIO 15) |
| Dashboard | Flask + Chart.js |
| Notifications | Telegram Bot API (push alerts) |
| Kommunikation | HTTPS (Supabase + Telegram) |

---

## Geplante Analyse (Part 2)

### Zeitreihen-Analyse
- **Muster erkennen:** Verfügbarkeit nach Stunde × Wochentag (Heatmap)
- **Pearson-Korrelation:** Niederschlag ↔ freie Docks
- **Pearson-Korrelation:** Temperatur ↔ freie Docks
- **Peak-Erkennung:** Wann sind Stationen am vollsten (morgens 08:00-09:00?)
- **Vorhersage:** Gradient Boosting Modell (T+15min) mit Wetter + Temporal Features

### Empfehlungslogik
- **Grün:** ≥5 freie Plätze an der Zielstation
- **Gelb:** 1-4 freie Plätze → Ausweichstation vorschlagen
- **Rot:** 0 freie Plätze → Alternative empfehlen (Bus, U-Bahn)

---

## Ordnerstruktur (Ziel)

```
Door2Dock/
├── bike_collector.py        # Bike-Datensammlung (TfL API, jede Minute)
├── weather_collector.py     # Wetter-Datensammlung (Open-Meteo, jede Minute)
├── worker.py                # Combined Worker für Heroku
├── export_data.py           # Datenexport + Cleaning + Merge
├── webapp/
│   ├── app.py               # Flask App Factory
│   ├── db.py                # Shared DB-Helper
│   ├── api.py               # JSON-API Endpoints (10 Routes)
│   ├── forecast.py          # ForecastService + scan_time_range + weather forecast
│   ├── views.py             # HTML-Seitenrouten (5 Seiten)
│   ├── templates/
│   │   ├── base.html        # Dark-Mode Layout, Nav (5 Items)
│   │   ├── dashboard.html   # Live Status + Karte
│   │   ├── trends.html      # Time Series + Heatmap (zusammengelegt)
│   │   ├── weather_impact.html # Wetter-Korrelation (Docks statt Bikes)
│   │   ├── planner.html     # Morning Commute Planner (Checkboxen)
│   │   └── about.html       # System-Info (inkl. Telegram)
│   └── static/
│       ├── css/style.css    # Custom Styles
│       └── js/
│           ├── dashboard.js # Karte, Station-Cards, Hover, Sort, Favoriten
│           ├── trends.js    # Time Series Chart + CSS-Grid Heatmap (merged)
│           ├── weather.js   # Binned-Bar-Charts + Korrelationen (Free Docks)
│           └── planner.js   # Commute-Scan, Timeline-Chart, Checkbox-Selektion
├── training/
│   ├── train_model.py       # Modell-Training (RF, GB, Baseline), T+15min
│   ├── METHODOLOGY.md       # Dokumentation für Uni-Bericht
│   ├── model.pkl            # Bestes Modell (joblib)
│   ├── feature_importance.png
│   ├── predictions.png
│   └── metrics.txt
├── esp32/
│   └── smart_commute.ino    # ESP32 Firmware (Arduino)
├── Procfile                 # web + worker Dynos
├── runtime.txt              # Python-Version
├── requirements.txt         # Python Dependencies
├── .gitignore
└── Claude.md                # Diese Datei
```

---

## Wichtige Konfiguration

- **Imperial College Koordinaten:** 51.4988, -0.1749
- **Suchradius:** 800m
- **Polling-Intervall:** 60 Sekunden
- **Heroku App Name:** smart-commute-imperial
- **DATABASE_URL:** Wird als Heroku Config Var gesetzt
- **GitHub Repo:** Door2Dock (Collaborator-Repo)

---

## Zeitplan

| Woche | Aufgabe |
|-------|---------|
| 1 | Infrastruktur: Heroku + DB + bike_collector läuft ← **aktuell hier** |
| 2 | Wetter-Collector, ESP32-Setup, Daten sammeln |
| 3 | Web-Dashboard, Zeitreihen-Analyse, ESP32-Integration |
| 4 | Dokumentation, Feinschliff, Innovation/Skalierbarkeit diskutieren |
