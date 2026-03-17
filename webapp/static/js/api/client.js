/**
 * API client with mock data toggle for DockSense frontend development.
 *
 * Set USE_MOCK = true to use hardcoded mock data (no backend needed).
 * Set USE_MOCK = false to hit the live Flask API endpoints.
 */

import {
  MOCK_PREDICTION_NOW,
  MOCK_PREDICTION_PLAN,
  MOCK_STATIONS,
  MOCK_INSIGHTS_OVERVIEW,
  MOCK_INSIGHTS_CORRELATIONS,
  MOCK_INSIGHTS_PATTERNS,
  MOCK_INSIGHTS_MODEL,
  MOCK_WEATHER_CURRENT,
  MOCK_WEATHER_FORECAST,
  MOCK_SETTINGS,
} from './mockData.js';

// ── Toggle: true = mock data, false = live API ──
const USE_MOCK = false;

// Minimal mock delay (just enough to simulate async, not noticeable)
const MOCK_DELAY = 0;

function delay(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status} ${resp.statusText}`);
  return resp.json();
}

// ── Prediction ──

export async function getPredictionNow() {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_PREDICTION_NOW);
  }
  return fetchJSON('/api/prediction/now');
}

export async function getPredictionPlan({ arriveBy, destination = 'imperial_college', mode = 'arrive' } = {}) {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_PREDICTION_PLAN);
  }
  return fetchJSON('/api/prediction/plan', {
    method: 'POST',
    body: JSON.stringify({ arrive_by: arriveBy, destination, mode }),
  });
}

// ── Stations ──

export async function getStations() {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_STATIONS);
  }
  return fetchJSON('/api/stations');
}

// ── Insights ──

export async function getInsightsOverview() {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_INSIGHTS_OVERVIEW);
  }
  return fetchJSON('/api/insights/overview');
}

export async function getInsightsCorrelations() {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_INSIGHTS_CORRELATIONS);
  }
  return fetchJSON('/api/insights/correlations');
}

export async function getInsightsPatterns() {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_INSIGHTS_PATTERNS);
  }
  return fetchJSON('/api/insights/patterns');
}

export async function getInsightsModel() {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_INSIGHTS_MODEL);
  }
  return fetchJSON('/api/insights/model');
}

// ── Weather ──

export async function getWeatherCurrent() {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_WEATHER_CURRENT);
  }
  return fetchJSON('/api/weather/current');
}

export async function getWeatherForecast(date, time) {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_WEATHER_FORECAST);
  }
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (time) params.set('time', time);
  return fetchJSON(`/api/weather/forecast?${params}`);
}

// ── Settings ──

export async function getSettings() {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    return structuredClone(MOCK_SETTINGS);
  }
  return fetchJSON('/api/settings');
}

export async function updateSettings(settings) {
  if (USE_MOCK) {
    await delay(MOCK_DELAY);
    Object.assign(MOCK_SETTINGS, settings);
    return structuredClone(MOCK_SETTINGS);
  }
  return fetchJSON('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}
