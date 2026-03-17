# DockSense — Full App Redesign Instructions

> **Purpose**: These instructions are for Claude Code to redesign the DoorToDock web app from scratch. The app predicts Santander bike dock availability near Imperial College London. The existing frontend on Heroku should be completely replaced with this new design.

---

## 1. Project context

### What the app does
- Predicts empty dock availability at Santander bike stations near Imperial College London
- A motion sensor detects when the user leaves home and triggers a Telegram notification with a dock recommendation
- The user bikes to uni every morning (needs empty docks to drop off) and home every evening (needs available bikes to pick up)
- Morning problem: docks near Imperial fill up fast (~7:48am). User needs to know which further station still has space, factoring in walking time to uni
- Evening problem: the reverse — stations are empty of bikes

### Tech stack
- **Backend data**: Supabase (PostgreSQL)
- **Frontend**: Heroku (replace existing frontend entirely)
- **Data sources**: TfL Santander API (bike_availability), Open-Meteo weather API (weather_data), KY-028 temperature sensor (temperature_readings), PIR motion sensor (sensor_events)
- **ML models**: Already trained and deployed — a "now" model (15-min prediction) and a "future" model (schedule-based prediction)
- **Notifications**: Telegram bot (already set up)

### Supabase schema (5 tables)

**bike_availability** (~367k rows):
- id (int4, PK), timestamp (timestamptz), station_id (text), station_name (text)
- available_bikes (int4), standard_bikes (int4), ebikes (int4)
- empty_docks (int4), total_docks (int4), latitude (float8), longitude (float8)

**monitored_stations** (21 rows):
- station_id (text, PK), station_name (text), latitude (float8), longitude (float8)
- distance_m (float8), walking_distance_m (float8), walking_duration_s (float8)

**weather_data** (~19k rows):
- id (int4, PK), timestamp (timestamptz), temperature (float8), humidity (float8)
- precipitation (float8), wind_speed (float8), weather_code (int4), description (text)

**sensor_events** (20 rows):
- id (int4, PK), timestamp (timestamptz), event_type (text), confidence (float8)

**temperature_readings** (~19k rows):
- id (int8, PK), temperature_c (float8), raw_adc (int4), created_at (timestamptz)

---

## 2. Design philosophy

The app has ONE job: **tell the user where to dock their bike**. It is opinionated — it gives a recommendation, not a dashboard. Data and analytics exist on a separate tab for the academic showcase.

Key principles:
- **Decision-first**: The home screen answers "where should I go?" in one glance
- **Context-aware**: Auto-detects morning (dock bike) vs evening (pick up bike) mode, but user can override
- **Two modes**: "Now" (motion sensor triggered, uses current availability) and "Plan" (schedule for later, uses forecast)
- **Responsive**: Mobile-first design that scales to desktop with a side-by-side map layout
- **Academic-friendly**: Insights tab showcases all data sources, correlations, and model performance for the university submission

---

## 3. App structure — 4 sections via navigation

### Navigation
- **Mobile**: Bottom tab bar with 4 items: Go, Map, Insights, Settings
- **Desktop**: Slim icon sidebar on the left (56px wide), icons only, tooltip on hover

### Tab 1: GO (home screen / daily use)

This is the primary screen. It has two sub-modes toggled at the top:

#### NOW mode (default)
Triggered automatically when the motion sensor fires. Shows:

1. **Mode indicator**: Small ambient line — "Morning mode — finding empty docks near Imperial" with an amber dot. After noon it says "Evening mode — finding available bikes". User can tap to override.

2. **Now/Plan toggle**: Segmented control at top. "Now" is active.

3. **Arrive/Depart toggle**: Second segmented control. "Arrive (dock bike)" vs "Depart (pick up bike)". Auto-set by time of day but manually overridable.

4. **Recommendation hero card**: The main event. Blue info-colored card with:
   - "RECOMMENDED STATION" label
   - Station name (large, 20px)
   - Three metrics side by side: Predicted empty docks, Confidence %, Walk to uni time
   - Total trip estimate at bottom: "Total: ~22 min (bike 15 + dock 4 + walk 3)"

5. **Weather context strip**: Small bar below hero. Shows current conditions and their effect: "12°C, light rain — lower dock demand than usual"

6. **Fallback stations list**: Ordered list of all preferred stations. Each row shows:
   - Station name
   - Walking time to destination
   - Preference rank
   - Predicted empty docks (color coded: red=0, amber=1-2, green=3+)
   - Confidence percentage
   - The recommended station is highlighted with a blue info border
   - Stations predicted full are shown but with red "likely full" label

#### PLAN mode
For scheduling ahead (e.g. evening before). Shows:

1. Same mode toggles as Now

2. **Input form**:
   - "I need to be at" → destination field (default: Imperial College London)
   - "By" → time picker (hour:minute, AM/PM) + day selector (Tomorrow, Wed, Thu...)
   - "Weather forecast" → auto-populated strip showing forecast for selected day/time

3. **Recommendation result card** (same blue hero card style):
   - "RECOMMENDED PLAN" label
   - "Leave by 9:52 AM" (large text) — this is the computed departure time
   - "Dock at Exhibition Road · 5 min walk" — the station selection
   - Visual timeline bar: colored segments for Cycle / Dock / Walk, proportional widths
   - "Arrives 10:12 · 3 min buffer before 10:15"

4. **"Why not closer?" explainer card**: Gray card below explaining why the recommendation skipped closer stations. Example: "Imperial College station predicted full by 9:50. Prince Consort Road has only 1 predicted dock (low confidence). Exhibition Road is the first station with 5+ predicted docks."

#### Desktop layout for GO tab
- Left panel (340px): All the controls, hero card, and station list
- Right panel (remaining width): Live map showing all monitored stations with color-coded prediction dots
  - Red dot = predicted full
  - Amber dot = 1-2 docks
  - Green dot = 3+ docks
  - Dashed ring around recommended station
  - Dot size scales with dock count
  - Legend bar at bottom of map
  - In Plan mode, the right panel shows a prediction timeline chart instead (or in addition to the map): availability curves for top 3 candidate stations over the next hour, with a vertical dashed line at the target arrival time

### Tab 2: MAP

Full-screen map view of all 21 monitored stations.

- Each station is a circle on the map, color and size encoding predicted availability
- Tapping a station shows a popup with: station name, current/predicted empty docks, total docks, walking time to Imperial, last updated timestamp
- Color legend at bottom
- Time slider or "predict for" picker to see how the map changes over the next hour
- Walking route from recommended station to Imperial shown as a dashed line

On desktop, this is a full-width map. On mobile, it's the full viewport.

### Tab 3: INSIGHTS (academic showcase)

This is where data analysis and visualisations live. It has 3-4 sub-sections navigated by horizontal pills at the top: Overview, Correlations, Time patterns, Model.

#### Overview sub-page
- **Data source metric cards** (4 across on desktop, 3 on mobile):
  - Dock readings: count + "TfL Santander API" badge
  - Weather observations: count + "Open-Meteo API" badge
  - Temp sensor readings: count + "KY-028 sensor" badge
  - Model accuracy (7d): percentage + progress bar

- **Key findings card**: 2-3 sentences summarising the most important insights. Example findings:
  - "Rain reduces morning dock pressure by ~18%, shifting the peak-full window 23 min later"
  - "Imperial College station is the first to fill (7:48am avg) and last to recover (9:22am)"
  - "Weekend availability is 3.2x higher at 8am across all monitored stations"

#### Correlations sub-page
- **Rain effect chart**: Two overlapping availability curves (dry days vs rainy days) showing the ~23 min shift
- **Temperature vs dock demand scatter**: Temperature on x-axis, average empty docks on y-axis
- **Sensor vs API temperature chart**: Two overlapping time series (KY-028 sensor readings vs Open-Meteo API temperature). Show the correlation coefficient (r≈0.94). This demonstrates the sensor data source for the academic submission
- **Wind speed effect**: If significant, show wind speed vs cycling demand

#### Time patterns sub-page
- **Hourly availability heatmap**: 24 hours on x-axis, 7 days on y-axis, color intensity = average empty docks at Imperial College station. Should clearly show the 7:30-9:00 AM weekday crunch
- **Day-of-week comparison**: Bar chart showing average 8am availability across Mon-Sun
- **Station fill order**: Small multiple or ranked list showing which stations fill first on a typical weekday morning. Imperial first, then Prince Consort, then Exhibition Road, etc.

#### Model sub-page
- **Accuracy over time chart**: Line chart of model accuracy (daily rolling average) over the last 14 days
- **Prediction vs actual scatter**: For the "now" model — predicted empty docks vs actual empty docks 15 min later
- **Feature importance**: Horizontal bar chart showing which features the model relies on most (current availability, hour of day, precipitation, etc.)
- **Error distribution**: Histogram of prediction errors (how many docks off is the model, typically?)
- **Trip feedback log**: Table of recent trips showing: date, time, recommended station, predicted docks, actual docks found (if feedback was given), whether the recommendation was correct

### Tab 4: SETTINGS

Simple form-style page:

- **Station preferences**: Drag-to-reorder list of the 21 monitored stations. Top stations get priority in recommendations.
- **Commute defaults**: Cycling speed assumption (default: 15 min), home address (for departure time calculation)
- **Telegram connection**: Status indicator + test button. Shows bot name, last message sent.
- **Motion sensor**: Status indicator (last event timestamp, event count today). Health check.
- **Mode auto-switching**: Toggle to enable/disable automatic morning/evening mode switching. Option to set the switchover time (default: 12:00 PM).
- **Appearance**: Light/dark mode toggle (or auto based on system)

---

## 4. Visual design system

### Colour scheme
Use a clean, flat design. CSS variables for theming:

```css
:root {
  --bg-primary: #FFFFFF;
  --bg-secondary: #F5F5F0;
  --bg-tertiary: #EEEEE8;
  --text-primary: #1A1A1A;
  --text-secondary: #6B6B6B;
  --text-tertiary: #9B9B9B;
  --border: rgba(0,0,0,0.08);
  --border-hover: rgba(0,0,0,0.15);

  /* Semantic */
  --info: #378ADD;
  --info-bg: #E6F1FB;
  --success: #1D9E75;
  --success-bg: #E1F5EE;
  --warning: #BA7517;
  --warning-bg: #FAEEDA;
  --danger: #E24B4A;
  --danger-bg: #FCEBEB;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1A1A1A;
    --bg-secondary: #242424;
    --bg-tertiary: #2C2C2C;
    --text-primary: #E8E8E8;
    --text-secondary: #A0A0A0;
    --text-tertiary: #6B6B6B;
    --border: rgba(255,255,255,0.08);
    --border-hover: rgba(255,255,255,0.15);
  }
}
```

### Typography
- Font: System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`)
- Two weights only: 400 (regular), 500 (medium/bold)
- Sizes: 20px hero numbers, 18px page titles, 14px body, 12px labels/captions, 11px small labels
- Sentence case everywhere — never ALL CAPS except small-caps labels like "RECOMMENDED STATION" which should be 11px, font-weight 500, letter-spacing 0.5px, secondary color

### Components
- **Cards**: White background, 0.5px border, border-radius-lg, padding 16px
- **Metric cards**: bg-secondary, no border, border-radius-md, padding 14px. Label above (11px, secondary), number below (22px, 500 weight)
- **Hero recommendation card**: info-bg background, 0.5px info border, border-radius-lg
- **Station rows**: bg-secondary, border-radius-md, padding 10-12px. Flex row with name/details on left, prediction on right
- **Segmented controls**: bg-secondary container with 3px padding, active segment gets bg-primary + subtle shadow
- **Pills**: Small rounded-full elements for sub-navigation. Active = info-bg + info text. Inactive = bg-secondary + secondary text
- **Badges**: Tiny pill-shaped labels next to data source names. E.g. "TfL API" in info color, "Weather" in success, "KY-028" in warning

### Charts
Use a charting library (Chart.js, Recharts if React, or similar). Style:
- Minimal gridlines (dashed, 0.5px, tertiary color)
- No chart borders or backgrounds
- Line charts: 1.5px stroke, subtle area fill at 0.06 opacity
- Axis labels: 9-10px, tertiary color
- Annotations: Small rounded-rect badges for callouts (e.g. "peak" label on the availability chart)

### Map
Use Leaflet.js or Mapbox GL JS with a minimal/light tile style. Stations rendered as custom circle markers with color and size encoding. On dark mode, use a dark map tile.

---

## 5. Responsive behaviour

### Breakpoints
- Mobile: < 768px — bottom tab bar, single column, stacked cards
- Tablet: 768-1024px — still bottom bar but wider cards
- Desktop: > 1024px — icon sidebar on left, GO tab splits into panel + map, Insights gets 2-column grid

### Key responsive changes

**GO tab**:
- Mobile: Single column. Map is on the separate Map tab.
- Desktop: Left panel (340px fixed) with controls + station list. Right panel with live map. The map is integrated INTO the Go tab so you see both at once.

**Insights tab**:
- Mobile: All charts stack vertically. Metric cards in 2x2 or 3-across grid.
- Desktop: Metric cards 4-across. Charts in 2-column grid.

**Navigation**:
- Mobile: Bottom tab bar, 4 items, with labels. Active tab highlighted.
- Desktop: Left sidebar, 56px wide, icons only. Active icon gets info-bg background. Settings icon at bottom separated by flex spacer.

---

## 6. Data flow & API endpoints needed

The frontend needs these API endpoints (build them or connect to existing ones):

### GET /api/prediction/now
Returns the current prediction for all monitored stations.
```json
{
  "timestamp": "2026-03-16T08:12:00Z",
  "mode": "arrive",
  "weather": {
    "temperature": 12,
    "description": "light rain",
    "effect": "lower dock demand than usual"
  },
  "recommended": {
    "station_id": "BikePoints_392",
    "station_name": "Prince Consort Road",
    "predicted_empty_docks": 4,
    "confidence": 0.87,
    "walk_to_destination_min": 3,
    "total_trip_min": 22
  },
  "stations": [
    {
      "station_id": "BikePoints_392",
      "station_name": "Imperial College, Knightsbridge",
      "predicted_empty_docks": 0,
      "confidence": 0.95,
      "walk_to_destination_min": 1,
      "preference_rank": 1,
      "is_recommended": false,
      "status": "likely_full"
    }
    // ... all monitored stations
  ]
}
```

### POST /api/prediction/plan
Request body includes target arrival time. Returns backwards-computed plan.
```json
// Request
{
  "arrive_by": "2026-03-17T10:15:00Z",
  "destination": "imperial_college",
  "mode": "arrive"
}

// Response
{
  "leave_by": "2026-03-17T09:52:00Z",
  "recommended_station": {
    "station_id": "BikePoints_428",
    "station_name": "Exhibition Road",
    "predicted_empty_docks": 5,
    "confidence": 0.89,
    "walk_to_destination_min": 5
  },
  "breakdown": {
    "cycle_min": 15,
    "dock_min": 4,
    "walk_min": 5,
    "buffer_min": 3,
    "arrival_time": "2026-03-17T10:12:00Z"
  },
  "alternatives_at_target_time": [
    { "station_name": "Imperial College", "predicted": 0, "confidence": 0.96, "reason": "predicted full since 7:48" },
    { "station_name": "Prince Consort Road", "predicted": 1, "confidence": 0.62, "reason": "low confidence" },
    { "station_name": "Exhibition Road", "predicted": 5, "confidence": 0.89, "reason": "recommended" }
  ],
  "why_not_closer": "Imperial College predicted full by 7:48. Prince Consort Road has only 1 predicted dock (low confidence). Exhibition Road is the first station with 5+ predicted docks."
}
```

### GET /api/stations
Returns all monitored stations with current live data.

### GET /api/insights/overview
Returns data source counts, model accuracy, key findings.

### GET /api/insights/correlations
Returns precomputed correlation data for the charts.

### GET /api/insights/patterns
Returns hourly heatmap data, day-of-week averages, station fill order.

### GET /api/insights/model
Returns model accuracy history, feature importance, error distribution.

### GET /api/weather/current
Returns current weather conditions.

### GET /api/weather/forecast?date=2026-03-17&time=10:15
Returns weather forecast for planning.

### GET /api/settings
Returns user settings (station order, commute defaults, etc.)

### PUT /api/settings
Updates user settings.

---

## 7. Implementation notes

### Frontend framework
Use React (or the framework already in use in the existing repo). If starting fresh, React with Vite is recommended. Use React Router for tab navigation.

### State management
Keep it simple — React Context or Zustand for:
- Current mode (now/plan)
- Current direction (arrive/depart)
- Auto mode override
- Selected time for plan mode
- Station preferences

### Map implementation
Use `react-leaflet` with OpenStreetMap tiles. Custom circle markers with the color/size encoding described above. Ensure the map has both light and dark tile URLs.

### Charts
Use Recharts (if React) or Chart.js. Keep charts minimal and clean — no excessive gridlines, borders, or decorative elements.

### Real-time updates
On the GO tab (Now mode), poll `/api/prediction/now` every 60 seconds to keep predictions fresh. Show a subtle "updated X seconds ago" timestamp.

### Telegram deep link
The Telegram notification should include a link that opens the web app directly to the GO tab with the current prediction loaded. Format: `https://your-heroku-app.herokuapp.com/?mode=now`

### Academic considerations
- The Insights tab must prominently show ALL THREE data sources (TfL API, weather API, temperature sensor)
- The temperature sensor correlation chart is specifically important — it demonstrates the IoT/sensor component of the project
- Model performance metrics should be clearly visible
- The trip feedback log provides evidence the system works in practice

---

## 8. File structure suggestion

```
src/
├── components/
│   ├── layout/
│   │   ├── Sidebar.jsx          # Desktop icon sidebar
│   │   ├── BottomNav.jsx        # Mobile bottom tabs
│   │   └── AppShell.jsx         # Responsive wrapper
│   ├── go/
│   │   ├── GoTab.jsx            # Main Go tab container
│   │   ├── ModeToggle.jsx       # Now/Plan segmented control
│   │   ├── DirectionToggle.jsx  # Arrive/Depart segmented control
│   │   ├── RecommendationHero.jsx
│   │   ├── WeatherStrip.jsx
│   │   ├── StationList.jsx
│   │   ├── StationRow.jsx
│   │   ├── PlanForm.jsx         # Plan mode inputs
│   │   ├── PlanResult.jsx       # Plan mode recommendation
│   │   └── WhyNotCloser.jsx
│   ├── map/
│   │   ├── MapTab.jsx
│   │   ├── StationMarker.jsx
│   │   └── MapLegend.jsx
│   ├── insights/
│   │   ├── InsightsTab.jsx
│   │   ├── OverviewPage.jsx
│   │   ├── CorrelationsPage.jsx
│   │   ├── PatternsPage.jsx
│   │   ├── ModelPage.jsx
│   │   ├── DataSourceCard.jsx
│   │   ├── AvailabilityChart.jsx
│   │   ├── RainEffectChart.jsx
│   │   ├── SensorVsApiChart.jsx
│   │   ├── HourlyHeatmap.jsx
│   │   └── FeatureImportanceChart.jsx
│   └── settings/
│       ├── SettingsTab.jsx
│       ├── StationOrderList.jsx
│       └── TelegramStatus.jsx
├── hooks/
│   ├── usePrediction.js
│   ├── useStations.js
│   ├── useWeather.js
│   └── useSettings.js
├── api/
│   └── client.js               # API fetch helpers
├── context/
│   └── AppContext.jsx           # Global state
├── styles/
│   └── globals.css              # CSS variables, base styles
└── App.jsx
```

---

## 9. Priority order for implementation

Build in this order:

1. **App shell + navigation**: Sidebar/bottom nav, routing between 4 tabs, responsive breakpoint switching
2. **GO tab — Now mode**: Recommendation hero, station list, weather strip. Mock data first, then connect to API.
3. **Map tab**: Leaflet map with station markers, color encoding, legend
4. **GO tab — Plan mode**: Input form, backwards-planning result display, "why not closer" card
5. **GO tab desktop layout**: Split panel + map side-by-side
6. **Insights — Overview**: Data source cards, key findings, dock availability chart
7. **Insights — Correlations**: Rain effect chart, sensor vs API chart
8. **Insights — Time patterns**: Hourly heatmap, day-of-week comparison
9. **Insights — Model**: Accuracy chart, feature importance, error distribution
10. **Settings tab**: Station ordering, Telegram status, sensor health
11. **Dark mode**: Ensure all CSS variables adapt, dark map tiles
12. **Polish**: Loading states, error states, empty states, animations

---

## 10. Important design details to get right

- The recommendation hero card should be the FIRST thing you see. No header image, no welcome message, no logo taking up space. Straight to the answer.
- Station rows in the fallback list should be tight — 10-12px padding, not 20px. You want to see 4-5 stations without scrolling on mobile.
- The segmented controls (Now/Plan, Arrive/Depart) should feel native. The active segment has a white bg with a subtle box-shadow, the inactive segments have no background.
- Numbers are the star of every card. Station name in 14px, but predicted dock count in 16-18px. The eye should go straight to the number.
- Color coding is simple and consistent everywhere: red = 0 docks (full), amber = 1-2 docks (risky), green = 3+ docks (good). Same palette on the map, in the station list, and in charts.
- The "Why not closer?" card only appears when the recommendation skips the user's top-preference station. If the closest station IS the recommendation, the card doesn't show.
- On desktop, the map in the Go tab is NOT just decorative. The recommended station should have a visible pulsing ring or dashed border. The route from Imperial to the recommended station should be shown as a dashed line.
