/**
 * Mock data layer for Door2Dock frontend development.
 * Matches the API response shapes defined in CLAUDE_CODE_INSTRUCTIONS.md Section 6.
 * Uses real station names and realistic coordinates from monitored_stations.
 */

// ── Station reference data (real names, coords, walking distances) ──

const STATIONS = [
  { station_id: 'BikePoints_392', station_name: 'Imperial College, Knightsbridge', latitude: 51.4990, longitude: -0.1746, distance_m: 48, walking_distance_m: 62, walking_duration_s: 52, total_docks: 30 },
  { station_id: 'BikePoints_356', station_name: 'Prince Consort Road, Knightsbridge', latitude: 51.4994, longitude: -0.1762, distance_m: 130, walking_distance_m: 169, walking_duration_s: 141, total_docks: 24 },
  { station_id: 'BikePoints_809', station_name: 'Exhibition Road Museums 1, South Kensington', latitude: 51.4964, longitude: -0.1725, distance_m: 310, walking_distance_m: 403, walking_duration_s: 336, total_docks: 27 },
  { station_id: 'BikePoints_810', station_name: 'Exhibition Road Museums 2, South Kensington', latitude: 51.4960, longitude: -0.1722, distance_m: 340, walking_distance_m: 442, walking_duration_s: 368, total_docks: 18 },
  { station_id: 'BikePoints_428', station_name: 'Exhibition Road, Knightsbridge', latitude: 51.5013, longitude: -0.1742, distance_m: 281, walking_distance_m: 365, walking_duration_s: 304, total_docks: 24 },
  { station_id: 'BikePoints_191', station_name: 'Victoria & Albert Museum, Cromwell Road', latitude: 51.4967, longitude: -0.1717, distance_m: 320, walking_distance_m: 416, walking_duration_s: 347, total_docks: 38 },
  { station_id: 'BikePoints_216', station_name: 'South Kensington Station, South Kensington', latitude: 51.4941, longitude: -0.1741, distance_m: 530, walking_distance_m: 689, walking_duration_s: 574, total_docks: 40 },
  { station_id: 'BikePoints_403', station_name: 'Queens Gate, Kensington Gardens', latitude: 51.5019, longitude: -0.1785, distance_m: 460, walking_distance_m: 598, walking_duration_s: 498, total_docks: 24 },
  { station_id: 'BikePoints_187', station_name: 'Queen\'s Gate (South), South Kensington', latitude: 51.4949, longitude: -0.1788, distance_m: 530, walking_distance_m: 689, walking_duration_s: 574, total_docks: 18 },
  { station_id: 'BikePoints_160', station_name: 'Holy Trinity Brompton, Knightsbridge', latitude: 51.4970, longitude: -0.1679, distance_m: 620, walking_distance_m: 806, walking_duration_s: 672, total_docks: 24 },
  { station_id: 'BikePoints_150', station_name: 'Natural History Museum, South Kensington', latitude: 51.4953, longitude: -0.1762, distance_m: 430, walking_distance_m: 559, walking_duration_s: 466, total_docks: 33 },
  { station_id: 'BikePoints_263', station_name: 'Albert Gate, Hyde Park', latitude: 51.5027, longitude: -0.1589, distance_m: 750, walking_distance_m: 975, walking_duration_s: 813, total_docks: 34 },
  { station_id: 'BikePoints_400', station_name: 'Palace Gate, Kensington Gardens', latitude: 51.5019, longitude: -0.1831, distance_m: 680, walking_distance_m: 884, walking_duration_s: 737, total_docks: 17 },
  { station_id: 'BikePoints_163', station_name: 'Knightsbridge, Hyde Park', latitude: 51.5013, longitude: -0.1640, distance_m: 690, walking_distance_m: 897, walking_duration_s: 748, total_docks: 27 },
  { station_id: 'BikePoints_97',  station_name: 'Cadogan Place, Knightsbridge', latitude: 51.4946, longitude: -0.1571, distance_m: 790, walking_distance_m: 1027, walking_duration_s: 856, total_docks: 24 },
];

// ── GET /api/prediction/now ──

export const MOCK_PREDICTION_NOW = {
  timestamp: '2026-03-17T08:12:00Z',
  mode: 'arrive',
  weather: {
    temperature: 12,
    description: 'light rain',
    effect: 'lower dock demand than usual',
  },
  recommended: {
    station_id: 'BikePoints_428',
    station_name: 'Exhibition Road, Knightsbridge',
    predicted_empty_docks: 7,
    confidence: 0.89,
    walk_to_destination_min: 5,
    total_trip_min: 22,
  },
  stations: [
    { station_id: 'BikePoints_392', station_name: 'Imperial College, Knightsbridge',          predicted_empty_docks: 0,  available_bikes: 8,  confidence: 0.94, walk_to_destination_min: 1,  preference_rank: 1,  is_recommended: false, status: 'likely_full' },
    { station_id: 'BikePoints_356', station_name: 'Prince Consort Road, Knightsbridge',       predicted_empty_docks: 1,  available_bikes: 12, confidence: 0.58, walk_to_destination_min: 2,  preference_rank: 2,  is_recommended: false, status: 'low' },
    { station_id: 'BikePoints_428', station_name: 'Exhibition Road, Knightsbridge',            predicted_empty_docks: 7,  available_bikes: 10, confidence: 0.87, walk_to_destination_min: 5,  preference_rank: 3,  is_recommended: true,  status: 'good' },
    { station_id: 'BikePoints_809', station_name: 'Exhibition Road Museums 1, South Kensington', predicted_empty_docks: 4, available_bikes: 14, confidence: 0.78, walk_to_destination_min: 5, preference_rank: 4, is_recommended: false, status: 'moderate' },
    { station_id: 'BikePoints_810', station_name: 'Exhibition Road Museums 2, South Kensington', predicted_empty_docks: 3, available_bikes: 6, confidence: 0.72, walk_to_destination_min: 6, preference_rank: 5, is_recommended: false, status: 'moderate' },
    { station_id: 'BikePoints_191', station_name: 'Victoria & Albert Museum, Cromwell Road',   predicted_empty_docks: 12, available_bikes: 22, confidence: 0.93, walk_to_destination_min: 6,  preference_rank: 6,  is_recommended: false, status: 'good' },
    { station_id: 'BikePoints_216', station_name: 'South Kensington Station, South Kensington', predicted_empty_docks: 8, available_bikes: 28, confidence: 0.91, walk_to_destination_min: 8, preference_rank: 7, is_recommended: false, status: 'good' },
    { station_id: 'BikePoints_160', station_name: 'Holy Trinity Brompton, Knightsbridge',     predicted_empty_docks: 5,  available_bikes: 15, confidence: 0.74, walk_to_destination_min: 9,  preference_rank: 8,  is_recommended: false, status: 'good' },
    { station_id: 'BikePoints_150', station_name: 'Natural History Museum, South Kensington',  predicted_empty_docks: 10, available_bikes: 20, confidence: 0.89, walk_to_destination_min: 7,  preference_rank: 9,  is_recommended: false, status: 'good' },
    { station_id: 'BikePoints_403', station_name: 'Queens Gate, Kensington Gardens',           predicted_empty_docks: 6,  available_bikes: 11, confidence: 0.80, walk_to_destination_min: 7,  preference_rank: 10, is_recommended: false, status: 'good' },
    { station_id: 'BikePoints_187', station_name: 'Queen\'s Gate (South), South Kensington',   predicted_empty_docks: 2,  available_bikes: 9, confidence: 0.63, walk_to_destination_min: 8,  preference_rank: 11, is_recommended: false, status: 'low' },
    { station_id: 'BikePoints_263', station_name: 'Albert Gate, Hyde Park',                    predicted_empty_docks: 14, available_bikes: 18, confidence: 0.92, walk_to_destination_min: 11, preference_rank: 12, is_recommended: false, status: 'good' },
    { station_id: 'BikePoints_400', station_name: 'Palace Gate, Kensington Gardens',           predicted_empty_docks: 5,  available_bikes: 7, confidence: 0.69, walk_to_destination_min: 10, preference_rank: 13, is_recommended: false, status: 'good' },
    { station_id: 'BikePoints_163', station_name: 'Knightsbridge, Hyde Park',                  predicted_empty_docks: 9,  available_bikes: 16, confidence: 0.86, walk_to_destination_min: 10, preference_rank: 14, is_recommended: false, status: 'good' },
    { station_id: 'BikePoints_97',  station_name: 'Cadogan Place, Knightsbridge',              predicted_empty_docks: 7,  available_bikes: 13, confidence: 0.77, walk_to_destination_min: 12, preference_rank: 15, is_recommended: false, status: 'good' },
  ],
};

// ── POST /api/prediction/plan ──

export const MOCK_PREDICTION_PLAN = {
  leave_by: '2026-03-17T09:52:00Z',
  recommended_station: {
    station_id: 'BikePoints_428',
    station_name: 'Exhibition Road, Knightsbridge',
    predicted_empty_docks: 5,
    confidence: 0.89,
    walk_to_destination_min: 5,
  },
  breakdown: {
    cycle_min: 15,
    dock_min: 4,
    walk_min: 5,
    buffer_min: 3,
    arrival_time: '2026-03-17T10:12:00Z',
  },
  alternatives_at_target_time: [
    { station_name: 'Imperial College, Knightsbridge',       predicted: 0, confidence: 0.96, reason: 'predicted full since 7:48' },
    { station_name: 'Prince Consort Road, Knightsbridge',    predicted: 1, confidence: 0.62, reason: 'low confidence' },
    { station_name: 'Exhibition Road, Knightsbridge',        predicted: 5, confidence: 0.89, reason: 'recommended' },
    { station_name: 'Exhibition Road Museums 1, South Kensington', predicted: 3, confidence: 0.84, reason: 'fewer than 5 docks' },
    { station_name: 'Victoria & Albert Museum, Cromwell Road', predicted: 9, confidence: 0.91, reason: 'further walk' },
  ],
  why_not_closer: 'Imperial College predicted full by 7:48. Prince Consort Road has only 1 predicted dock (low confidence). Exhibition Road is the first station with 5+ predicted docks.',
  weather_forecast: {
    temperature: 11,
    description: 'overcast',
    precipitation_mm: 0.2,
    wind_speed: 4.5,
  },
};

// ── GET /api/stations ──

export const MOCK_STATIONS = STATIONS.map((s, i) => ({
  ...s,
  available_bikes: [8, 12, 14, 6, 10, 22, 28, 11, 9, 15, 20, 18, 7, 16, 13][i],
  standard_bikes: [5, 8, 10, 4, 7, 15, 20, 8, 6, 10, 14, 12, 5, 11, 9][i],
  ebikes: [3, 4, 4, 2, 3, 7, 8, 3, 3, 5, 6, 6, 2, 5, 4][i],
  empty_docks: [0, 1, 7, 4, 3, 12, 8, 6, 2, 5, 10, 14, 5, 9, 7][i],
  status: ['red', 'yellow', 'green', 'yellow', 'yellow', 'green', 'green', 'green', 'yellow', 'green', 'green', 'green', 'green', 'green', 'green'][i],
  timestamp: '2026-03-17T08:12:00Z',
}));

// ── GET /api/insights/overview ──

export const MOCK_INSIGHTS_OVERVIEW = {
  data_sources: {
    dock_readings: { count: 367420, label: 'Dock readings', badge: 'TfL Santander API' },
    weather_observations: { count: 19180, label: 'Weather observations', badge: 'Open-Meteo API' },
    temp_sensor_readings: { count: 19042, label: 'Temp sensor readings', badge: 'KY-028 sensor' },
    sensor_events: { count: 20, label: 'Motion events', badge: 'PIR sensor' },
  },
  model_accuracy_7d: 0.84,
  collection_days: 18,
  first_record: '2026-02-27T10:00:00Z',
  last_record: '2026-03-17T08:12:00Z',
  key_findings: [
    'Rain reduces morning dock pressure by ~18%, shifting the peak-full window 23 min later.',
    'Imperial College station is the first to fill (7:48am avg) and last to recover (9:22am).',
    'Weekend availability is 3.2x higher at 8am across all monitored stations.',
  ],
};

// ── GET /api/insights/correlations ──

export const MOCK_INSIGHTS_CORRELATIONS = {
  pearson: {
    temperature: { coefficient: 0.34, p_value: 0.001, interpretation: 'Moderate positive — warmer days see slightly more cycling, reducing dock availability' },
    precipitation: { coefficient: -0.28, p_value: 0.003, interpretation: 'Moderate negative — rain reduces cycling demand, leaving more docks free' },
    wind_speed: { coefficient: -0.15, p_value: 0.04, interpretation: 'Weak negative — high wind slightly reduces cycling' },
    humidity: { coefficient: -0.12, p_value: 0.08, interpretation: 'Very weak — not statistically significant' },
  },
  rain_effect: {
    dry_days: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      avg_empty_docks: [18, 19, 20, 20, 19, 16, 10, 5, 2, 3, 6, 9, 11, 10, 9, 8, 7, 8, 10, 13, 15, 16, 17, 18][h],
    })),
    rainy_days: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      avg_empty_docks: [19, 19, 20, 20, 19, 17, 13, 8, 5, 5, 8, 11, 12, 12, 11, 10, 9, 10, 12, 14, 16, 17, 18, 18][h],
    })),
  },
  temp_scatter: Array.from({ length: 60 }, (_, i) => ({
    temperature: 3 + i * 0.3,
    avg_empty_docks: Math.max(0, 12 + (i * 0.3 - 9) * 0.8 + (Math.random() - 0.5) * 6),
  })),
  sensor_vs_api: Array.from({ length: 48 }, (_, i) => {
    const hour = i * 0.5;
    const baseTemp = 8 + 4 * Math.sin((hour - 6) * Math.PI / 12);
    return {
      hour,
      timestamp: `2026-03-16T${String(Math.floor(hour)).padStart(2, '0')}:${hour % 1 ? '30' : '00'}:00Z`,
      api_temperature: Math.round(baseTemp * 10) / 10,
      sensor_temperature: Math.round((baseTemp + (Math.random() - 0.5) * 1.5) * 10) / 10,
    };
  }),
  sensor_api_correlation: 0.94,
};

// ── GET /api/insights/patterns ──

export const MOCK_INSIGHTS_PATTERNS = {
  hourly_heatmap: (() => {
    const data = [];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const isWeekday = day < 5;
        let avg;
        if (!isWeekday) {
          avg = Math.max(2, 15 - Math.abs(hour - 14) * 0.8 + (Math.random() - 0.5) * 3);
        } else if (hour >= 7 && hour <= 9) {
          avg = Math.max(0, 3 - (hour === 8 ? 2 : 0) + Math.random() * 2);
        } else if (hour >= 17 && hour <= 19) {
          avg = Math.max(1, 5 + Math.random() * 3);
        } else {
          avg = Math.max(2, 14 - Math.abs(hour - 13) * 0.6 + (Math.random() - 0.5) * 3);
        }
        data.push({ weekday: day, hour, avg_empty_docks: Math.round(avg * 10) / 10 });
      }
    }
    return data;
  })(),
  day_of_week_8am: [
    { day: 'Mon', avg_empty_docks: 2.1 },
    { day: 'Tue', avg_empty_docks: 1.8 },
    { day: 'Wed', avg_empty_docks: 2.4 },
    { day: 'Thu', avg_empty_docks: 1.5 },
    { day: 'Fri', avg_empty_docks: 3.2 },
    { day: 'Sat', avg_empty_docks: 12.4 },
    { day: 'Sun', avg_empty_docks: 14.1 },
  ],
  station_fill_order: [
    { station_name: 'Imperial College', avg_fill_time: '07:48', rank: 1 },
    { station_name: 'Prince Consort Road', avg_fill_time: '07:55', rank: 2 },
    { station_name: 'Exhibition Road', avg_fill_time: '08:12', rank: 3 },
    { station_name: 'Exhibition Road Museums 1', avg_fill_time: '08:18', rank: 4 },
    { station_name: 'Exhibition Road Museums 2', avg_fill_time: '08:24', rank: 5 },
    { station_name: 'Queens Gate', avg_fill_time: '08:31', rank: 6 },
    { station_name: 'Victoria & Albert Museum', avg_fill_time: '08:45', rank: 7 },
  ],
};

// ── GET /api/insights/model ──

export const MOCK_INSIGHTS_MODEL = {
  nowcast: {
    name: 'RandomForest Nowcast',
    type: 'nowcast',
    horizon_min: 15,
    mae: 1.19,
    rmse: 1.82,
    r2: 0.9714,
    features: ['empty_docks_now', 'hour_sin', 'hour_cos', 'is_weekend', 'station_enc', 'temperature', 'precipitation', 'wind_speed', 'humidity'],
  },
  forecast: {
    name: 'HistoricalAverage Forecast',
    type: 'forecast',
    horizon_min: 15,
    mae: 3.41,
    rmse: 4.88,
    r2: 0.6723,
    features: ['hour_sin', 'hour_cos', 'is_weekend', 'station_enc', 'temperature', 'precipitation', 'wind_speed', 'humidity'],
  },
  feature_importance: [
    { feature: 'empty_docks_now', importance: 0.42 },
    { feature: 'hour_sin', importance: 0.18 },
    { feature: 'hour_cos', importance: 0.12 },
    { feature: 'station_enc', importance: 0.09 },
    { feature: 'temperature', importance: 0.06 },
    { feature: 'is_weekend', importance: 0.05 },
    { feature: 'precipitation', importance: 0.04 },
    { feature: 'wind_speed', importance: 0.02 },
    { feature: 'humidity', importance: 0.02 },
  ],
  accuracy_history: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-03-${String(4 + i).padStart(2, '0')}`,
    mae: Math.round((1.0 + Math.random() * 0.5) * 100) / 100,
    r2: Math.round((0.95 + Math.random() * 0.04) * 10000) / 10000,
  })),
  error_distribution: Array.from({ length: 11 }, (_, i) => {
    const error = i - 5; // -5 to +5
    const count = Math.round(Math.exp(-0.3 * error * error) * 200 + Math.random() * 20);
    return { error_docks: error, count };
  }),
  prediction_vs_actual: Array.from({ length: 80 }, () => {
    const actual = Math.round(Math.random() * 20);
    const predicted = Math.max(0, actual + Math.round((Math.random() - 0.5) * 4));
    return { actual, predicted };
  }),
};

// ── GET /api/weather/current ──

export const MOCK_WEATHER_CURRENT = {
  timestamp: '2026-03-17T08:10:00Z',
  temperature: 12,
  humidity: 78,
  precipitation: 0.4,
  wind_speed: 3.2,
  weather_code: 61,
  description: 'light rain',
};

// ── GET /api/weather/forecast ──

export const MOCK_WEATHER_FORECAST = {
  date: '2026-03-17',
  hourly: Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    temperature: Math.round((8 + 5 * Math.sin((h - 6) * Math.PI / 12)) * 10) / 10,
    precipitation: [0, 0, 0, 0, 0, 0, 0.1, 0.4, 0.3, 0.1, 0, 0, 0, 0, 0, 0.2, 0.5, 0.3, 0, 0, 0, 0, 0, 0][h],
    wind_speed: Math.round((2 + Math.random() * 4) * 10) / 10,
    description: [0, 0, 0, 0, 0, 0, 0.1, 0.4, 0.3, 0.1, 0, 0, 0, 0, 0, 0.2, 0.5, 0.3, 0, 0, 0, 0, 0, 0][h] > 0.2 ? 'light rain' : 'overcast',
  })),
};

// ── GET/PUT /api/settings ──

export const MOCK_SETTINGS = {
  station_order: STATIONS.map(s => s.station_id),
  commute: {
    cycling_speed_min: 15,
    destination: 'Imperial College London',
    destination_coords: { lat: 51.498099, lng: -0.174956 },
  },
  mode_auto_switch: true,
  mode_switch_time: '12:00',
  telegram: {
    connected: true,
    bot_name: 'DockSenseBot',
    last_message: '2026-03-17T07:52:00Z',
  },
  motion_sensor: {
    status: 'online',
    last_event: '2026-03-17T07:48:12Z',
    events_today: 2,
  },
  appearance: 'light',
};
