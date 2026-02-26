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
┌──────────────────┐     MQTT/HTTP      ┌─────────────────────────────┐
│  ESP32 + PIR     │ ─────────────────▶ │     Raspberry Pi (lokal)    │
│  + RGB-LED       │ ◀───────────────── │  oder Heroku Worker (Cloud) │
│  + LCD 1602      │   (Empfehlung)     │                             │
└──────────────────┘                    │  ┌───────────────────────┐  │
                                        │  │  bike_collector.py    │  │
┌──────────────────┐                    │  │  (jede Minute)        │  │
│ TfL BikePoint API│ ──────────────────▶│  └───────────┬───────────┘  │
│ (Santander Cycles)│                   │              │              │
└──────────────────┘                    │  ┌───────────▼───────────┐  │
                                        │  │  Datenbank            │  │
┌──────────────────┐                    │  │  (MongoDB Atlas oder  │  │
│ OpenWeatherMap   │ ──────────────────▶│  │   Supabase PostgreSQL)│  │
│ API              │                    │  └───────────┬───────────┘  │
└──────────────────┘                    │              │              │
                                        │  ┌───────────▼───────────┐  │
                                        │  │  Web-Dashboard        │  │
                                        │  │  (Flask + Chart.js)   │  │
                                        │  └───────────────────────┘  │
                                        └─────────────────────────────┘
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
- **Monitoring:** ~12 Stationen im 800m-Radius um Imperial College (South Kensington)
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
- **Kommunikation:** MQTT oder HTTP-POST an Server
- **Zusatz-Output:** RGB-LED (Grün/Gelb/Rot) + LCD 1602 Anzeige

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
- **Flask Web-Dashboard** (`webapp/`)
  - **Live Status:** Leaflet-Karte mit farbcodierten Stationsmarkern (Grün/Gelb/Rot), Fokus auf freie Docks
  - **Hover-Interaktion:** Station-Card hovern → Marker pulsiert auf der Karte + Popup öffnet sich
  - **Sortierung:** Stationen sortierbar nach Distanz, meiste/wenigste Docks, Name
  - **Time Series:** Chart.js Liniendiagramme (Standard-Bikes, E-Bikes, freie Docks) mit Stations- und Zeitraumselektor
  - **Heatmap:** Custom CSS-Grid Heatmap (Stunde × Wochentag), umschaltbar Bikes/Docks
  - **Wetter-Korrelation:** 4 Scatter-Plots mit Trendlinien + Pearson-Korrelationskoeffizienten
  - **About-Seite:** Architektur-Diagramm, Tech Stack, Live-Statistiken
  - **Dock Forecast:** Stat-Card mit Vorhersage (nächste Stunde), Forecast-Annotation pro Station-Card ("→ ~N in 1h")
  - Dark Mode (Bootstrap 5), Auto-Refresh alle 60s, responsive
  - JSON-API mit 9 Endpoints + graceful DB-Error-Handling (503)

### ✅ Modell-Training (`training/`)
- **`train_model.py`** – Trainiert und vergleicht 3 Modelle für `empty_docks`-Vorhersage
  - Feature Engineering: Temporal (hour, weekday, cyclical encoding), Wetter, Station-Encoding, Lag-Feature
  - Modelle: Historical Average (Baseline), Random Forest, Gradient Boosting
  - Chronologischer 80/20 Train/Test Split (kein Data Leakage)
  - Metriken: MAE, RMSE, R²
  - Outputs: `model.pkl`, `feature_importance.png`, `predictions.png`, `metrics.txt`
- **`METHODOLOGY.md`** – Dokumentation für Uni-Bericht (Zielsetzung, Features, Modellwahl, Limitationen)

### ✅ Forecast-Integration ins Dashboard
- **`webapp/forecast.py`** – ForecastService Singleton
  - Lädt `training/model.pkl` (Gradient Boosting) einmalig beim Start
  - Baut Feature-Vektoren intern (hour_sin/cos, is_weekend, station_enc via LabelEncoder, Wetter)
  - `predict_all_stations()` für alle 21 Stationen, unbekannte Stationen → `None`
- **`/api/forecast`** Endpoint – Query-Params: `?hour=`, `?weekday=` (Default: nächste Stunde London-Zeit)
  - Holt aktuelle Wetterdaten + Stationsliste aus DB
  - Return: `{ available, model_name, predictions: [{ station_id, predicted_empty_docks, predicted_status }] }`
- **Dashboard-UI** – Forecast Stat-Card + "→ ~N in 1h" Annotation pro Station-Card (farbcodiert)

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
| Hardware | ESP32 + HC-SR501 PIR + RGB-LED + LCD 1602 |
| Dashboard | Flask + Chart.js oder Plotly |
| Edge Device | Raspberry Pi 3 (optional) |
| Kommunikation | MQTT (ESP32 ↔ Pi) oder HTTP |

---

## Geplante Analyse (Part 2)

### Zeitreihen-Analyse
- **Muster erkennen:** Verfügbarkeit nach Stunde × Wochentag (Heatmap)
- **Pearson-Korrelation:** Niederschlag ↔ verfügbare Bikes
- **Pearson-Korrelation:** Temperatur ↔ verfügbare Bikes
- **Peak-Erkennung:** Wann sind Stationen am vollsten (morgens 08:00-09:00?)
- **Vorhersage:** Einfaches Modell (historischer Durchschnitt + Wetter-Korrektur)

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
│   ├── api.py               # JSON-API Endpoints (9 Routes)
│   ├── forecast.py          # ForecastService (Modell-Vorhersage)
│   ├── views.py             # HTML-Seitenrouten (5 Seiten)
│   ├── templates/
│   │   ├── base.html        # Dark-Mode Layout, Nav
│   │   ├── dashboard.html   # Live Status + Karte
│   │   ├── timeseries.html  # Zeitreihen-Charts
│   │   ├── heatmap.html     # Stunde × Wochentag Heatmap
│   │   ├── weather.html     # Wetter-Korrelation
│   │   └── about.html       # System-Info
│   └── static/
│       ├── css/style.css    # Custom Styles
│       └── js/
│           ├── dashboard.js # Karte, Station-Cards, Hover, Sort
│           ├── timeseries.js# Chart.js Liniendiagramme
│           ├── heatmap.js   # CSS-Grid Heatmap
│           └── weather.js   # Scatter-Plots + Trendlinien
├── training/
│   ├── train_model.py       # Modell-Training (RF, GB, Baseline)
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
