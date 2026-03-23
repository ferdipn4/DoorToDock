/* Door2Dock - Insights Tab (all real data from Supabase) */

import { getInsightsCh1, getInsightsCh3, getInsightsCh4, getInsightsCh5 } from './api/client.js';

// Chart instances
let morningChart = null;
let eveningChart = null;
let sensorChart = null;
let rainChart = null;
let station930Chart = null;
let featureChart = null;
let forecastFeatureChart = null;

// Theme helpers
function isDarkMode() {
    if (document.documentElement.getAttribute('data-bs-theme') === 'dark') return true;
    if (document.documentElement.getAttribute('data-bs-theme') === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getGrid() {
    return { color: isDarkMode() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', drawTicks: false };
}
function getTick() {
    return { font: { size: 10 }, color: isDarkMode() ? '#6B6B6B' : '#9B9B9B' };
}
function getLegendColor() {
    return isDarkMode() ? '#A0A0A0' : '#6B6B6B';
}
function getAxisTitleColor() {
    return isDarkMode() ? '#6B6B6B' : '#9B9B9B';
}

const STATION_COLORS = {
    'BikePoints_432': '#e63946',
    'BikePoints_482': '#f4845f',
    'BikePoints_878': '#f9a825',
    'BikePoints_356': '#d4580a',
    'BikePoints_428': '#7c2d12',
};

const PREFERRED_IDS = ['BikePoints_432', 'BikePoints_482', 'BikePoints_878', 'BikePoints_356', 'BikePoints_428'];

function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
}

function showError(containerId, retryFn) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
        <div class="chart-error">
            <i class="bi bi-cloud-slash"></i>
            <span>Data unavailable</span>
            <button onclick="(${retryFn.toString()})()"><i class="bi bi-arrow-clockwise"></i> Retry</button>
        </div>
    `;
}

// Init
let _insightsRevealed = false;
function revealInsights() {
    if (_insightsRevealed) return;
    _insightsRevealed = true;
    const loader = document.getElementById('page-loader');
    const nav = document.getElementById('ins-nav');
    const content = document.getElementById('ins-content');
    if (loader) loader.classList.add('fade-out');
    setTimeout(() => {
        if (loader) loader.style.display = 'none';
        if (nav) nav.style.display = '';
        if (content) content.style.display = '';
    }, 300);
}

document.addEventListener('DOMContentLoaded', () => {
    loadCh1();
    loadCh3();
    loadCh4();
    loadCh5();
});

// ============================================================
// CHAPTER 1: The Problem
// ============================================================

async function loadCh1() {
    try {
        const data = await getInsightsCh1();

        // Stats
        if (data.stats.first_zero) {
            setText('stat-fill-time', data.stats.first_zero.first_zero_time || '--');
        }
        if (data.stats.avg_docks_930 != null) {
            setText('stat-docks-930', data.stats.avg_docks_930.toFixed(1));
        }
        if (data.stats.avg_bikes_6pm != null) {
            setText('stat-bikes-6pm', data.stats.avg_bikes_6pm.toFixed(1));
        }
        setText('stat-stations', String(data.stats.station_count));

        renderMorningChart(data.morning);
        renderHeatmap(data.heatmap, 'ch1-heatmap');
        renderEveningChart(data.evening);
    } catch (e) {
        console.error('Ch1 load failed:', e);
        setText('stat-fill-time', 'Error');
        setText('stat-docks-930', 'Error');
        setText('stat-bikes-6pm', 'Error');
    }
    revealInsights();
}

function buildTimeSlots(startHour, endHour) {
    const slots = [];
    for (let h = startHour; h <= endHour; h++) {
        for (let m = 0; m < 60; m += 15) {
            slots.push({ h, m, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` });
        }
    }
    return slots;
}

function renderMorningChart(rows) {
    const canvas = document.getElementById('morning-chart');
    if (!canvas) return;
    if (morningChart) morningChart.destroy();

    if (!rows || rows.length === 0) {
        canvas.parentElement.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Data unavailable</span></div>';
        return;
    }

    // Group by station, keyed by "hour:minute"
    const byStation = {};
    rows.forEach(r => {
        if (!byStation[r.station_id]) {
            byStation[r.station_id] = { name: r.station_name.split(',')[0], data: {} };
        }
        const key = `${r.hour}:${r.minute}`;
        byStation[r.station_id].data[key] = parseFloat(r.avg_empty_docks);
    });

    const slots = buildTimeSlots(6, 13);
    const labels = slots.map(s => s.label);

    const datasets = PREFERRED_IDS.map(id => {
        const station = byStation[id];
        if (!station) return null;
        return {
            label: station.name,
            data: slots.map(s => station.data[`${s.h}:${s.m}`] ?? null),
            borderColor: STATION_COLORS[id],
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
        };
    }).filter(Boolean);

    morningChart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { usePointStyle: false, boxWidth: 14, boxHeight: 4, font: { size: 10 }, color: getLegendColor(), padding: 14 },
                },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} empty docks` } },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        ...getTick(),
                        maxRotation: 0,
                        callback(val, idx) {
                            // Show only full-hour labels
                            const label = labels[idx];
                            return label && label.endsWith(':00') ? label : '';
                        },
                        autoSkip: false,
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5 },
                    title: { display: true, text: 'Average empty docks', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
    });
}

function renderEveningChart(rows) {
    const canvas = document.getElementById('evening-chart');
    if (!canvas) return;
    if (eveningChart) eveningChart.destroy();

    if (!rows || rows.length === 0) {
        canvas.parentElement.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Data unavailable</span></div>';
        return;
    }

    const byStation = {};
    rows.forEach(r => {
        if (!byStation[r.station_id]) {
            byStation[r.station_id] = { name: r.station_name.split(',')[0], data: {} };
        }
        const key = `${r.hour}:${r.minute}`;
        byStation[r.station_id].data[key] = parseFloat(r.avg_bikes);
    });

    const slots = buildTimeSlots(14, 21);
    const labels = slots.map(s => s.label);

    const datasets = PREFERRED_IDS.map(id => {
        const station = byStation[id];
        if (!station) return null;
        return {
            label: station.name,
            data: slots.map(s => station.data[`${s.h}:${s.m}`] ?? null),
            borderColor: STATION_COLORS[id],
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
        };
    }).filter(Boolean);

    eveningChart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { usePointStyle: false, boxWidth: 14, boxHeight: 4, font: { size: 10 }, color: getLegendColor(), padding: 14 },
                },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} bikes` } },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        ...getTick(),
                        maxRotation: 0,
                        callback(val, idx) {
                            const label = labels[idx];
                            return label && label.endsWith(':00') ? label : '';
                        },
                        autoSkip: false,
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5 },
                    title: { display: true, text: 'Average available bikes', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
    });
}

// ============================================================
// HEATMAP (shared renderer, used in Chapter 1)
// ============================================================

function heatmapColor(v) {
    if (v <= 1) return '#C62828';
    if (v <= 2) return '#D32F2F';
    if (v <= 3) return '#E53935';
    if (v <= 5) return '#EF6C00';
    if (v <= 7) return '#F9A825';
    if (v <= 10) return '#66BB6A';
    if (v <= 14) return '#43A047';
    return '#2E7D32';
}

function renderHeatmap(apiData, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!apiData || apiData.length === 0) {
        container.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Data unavailable</span></div>';
        return;
    }

    const data = apiData.map(r => ({
        day: r.weekday === 0 ? 6 : r.weekday - 1,
        hour: r.hour,
        value: r.avg_empty_docks,
    }));
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    let html = '<div class="hm-header"></div>';
    for (let h = 0; h < 24; h++) {
        const label = h % 3 === 0 ? `${String(h).padStart(2, '0')}` : '';
        html += `<div class="hm-header">${label}</div>`;
    }

    for (let day = 0; day < 7; day++) {
        html += `<div class="hm-row-label">${dayNames[day]}</div>`;
        for (let hour = 0; hour < 24; hour++) {
            const d = data.find(x => x.day === day && x.hour === hour);
            const v = d ? d.value : 0;
            const bg = heatmapColor(v);
            const textColor = v <= 5 ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)';
            html += `<div class="hm-cell" style="background:${bg};color:${textColor}" title="${dayNames[day]} ${String(hour).padStart(2, '0')}:00: ${v} docks">${Math.round(v)}</div>`;
        }
    }

    container.innerHTML = html;
}

// ============================================================
// CHAPTER 3: Data Sources
// ============================================================

async function loadCh3() {
    try {
        const data = await getInsightsCh3();
        setText('ds-docks', formatCount(data.bike_rows));
        setText('ds-weather', formatCount(data.weather_rows));
        setText('ds-sensor', formatCount(data.temp_rows));
        setText('arch-rows', formatCount(data.bike_rows + data.weather_rows + data.temp_rows) + ' rows');

        if (data.sensor_corr != null) {
            setText('sensor-corr-badge', `r = ${data.sensor_corr.toFixed(2)}`);
        }

        if (data.sensor_vs_api && data.sensor_vs_api.length > 0) {
            renderSensorChart(data.sensor_vs_api);
            const days = data.temp_first && data.temp_last
                ? Math.round((new Date(data.temp_last) - new Date(data.temp_first)) / 86400000)
                : 16;
            setText('sensor-caption',
                `The IoT sensor closely tracks the weather API (r = ${data.sensor_corr?.toFixed(2) || '0.96'}), validating both data sources. Sensor was active for ${days} days of the collection period.`);
        } else {
            setText('sensor-caption', 'Sensor validation data unavailable.');
        }
    } catch (e) {
        console.error('Ch3 load failed:', e);
        setText('ds-docks', 'Error');
        setText('ds-weather', 'Error');
        setText('ds-sensor', 'Error');
    }
    revealInsights();
}

function renderSensorChart(rows) {
    const canvas = document.getElementById('sensor-chart');
    if (!canvas) return;
    if (sensorChart) sensorChart.destroy();

    const labels = [];
    const apiData = [];
    const sensorData = [];

    // Compute sparse date labels: pick ~5-6 evenly spread indices
    const totalPoints = rows.length;
    const sparseCount = 6;
    const sparseIndices = new Set();
    for (let i = 0; i < sparseCount; i++) {
        sparseIndices.add(Math.round(i * (totalPoints - 1) / (sparseCount - 1)));
    }

    rows.forEach((r, i) => {
        const d = new Date(r.ts);
        if (sparseIndices.has(i)) {
            labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        } else {
            labels.push('');
        }
        apiData.push(r.api_temp != null ? parseFloat(r.api_temp) : null);
        sensorData.push(r.sensor_temp != null ? parseFloat(r.sensor_temp) : null);
    });

    sensorChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Open-Meteo API',
                    data: apiData,
                    borderColor: '#378ADD',
                    borderWidth: 1.5,
                    borderDash: [5, 3],
                    backgroundColor: 'transparent',
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    tension: 0.3,
                },
                {
                    label: 'KY-028 sensor',
                    data: sensorData,
                    borderColor: '#BA7517',
                    borderWidth: 1.5,
                    backgroundColor: 'rgba(186, 117, 23, 0.06)',
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    tension: 0.3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { usePointStyle: true, pointStyle: 'line', font: { size: 10 }, color: getLegendColor(), padding: 14 },
                },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}\u00B0C` } },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        ...getTick(),
                        maxRotation: 0,
                        autoSkip: false,
                        callback(val, idx) { return labels[idx] || ''; },
                    },
                },
                y: {
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 3 },
                    title: { display: true, text: 'Temperature (\u00B0C)', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
    });
}

// ============================================================
// CHAPTER 4: Patterns
// ============================================================

async function loadCh4() {
    try {
        const data = await getInsightsCh4();
        renderRainChart(data.rain_dry, data.rain_wet, data.rain_day_counts);
        renderStation930(data.station_930);
    } catch (e) {
        console.error('Ch4 load failed:', e);
    }
    revealInsights();
}

function renderRainChart(dryRows, wetRows, dayCounts) {
    const canvas = document.getElementById('rain-chart');
    if (!canvas) return;
    if (rainChart) rainChart.destroy();

    if ((!dryRows || dryRows.length === 0) && (!wetRows || wetRows.length === 0)) {
        canvas.parentElement.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Rain data unavailable</span></div>';
        return;
    }

    const hours = [];
    for (let h = 6; h <= 19; h++) hours.push(h);
    const labels = hours.map(h => `${String(h).padStart(2, '0')}:00`);

    const dryMap = {};
    (dryRows || []).forEach(r => { dryMap[r.hour] = parseFloat(r.avg_empty_docks); });
    const wetMap = {};
    (wetRows || []).forEach(r => { wetMap[r.hour] = parseFloat(r.avg_empty_docks); });

    const dryData = hours.map(h => dryMap[h] ?? null);
    const wetData = hours.map(h => wetMap[h] ?? null);

    rainChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Dry days (precip = 0)',
                    data: dryData,
                    borderColor: '#C8C8C8',
                    borderWidth: 2,
                    backgroundColor: 'transparent',
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    tension: 0.3,
                    spanGaps: false,
                },
                {
                    label: 'Any rain (precip > 0)',
                    data: wetData,
                    borderColor: '#378ADD',
                    borderWidth: 2,
                    borderDash: [5, 3],
                    backgroundColor: 'rgba(55, 138, 221, 0.06)',
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    tension: 0.3,
                    spanGaps: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { usePointStyle: true, pointStyle: 'line', font: { size: 10 }, color: getLegendColor(), padding: 14 },
                },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} empty docks` } },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { ...getTick(), maxRotation: 0 },
                    title: { display: true, text: 'Time', font: { size: 10 }, color: getAxisTitleColor() },
                },
                y: {
                    beginAtZero: true,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5 },
                    title: { display: true, text: 'Average empty docks', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
    });

    // Update disclaimer with real counts
    const disclaimerEl = document.getElementById('rain-disclaimer');
    if (disclaimerEl && dayCounts) {
        const dry = dayCounts.dry_days || 0;
        const rainy = dayCounts.rainy_days || 0;
        disclaimerEl.innerHTML = `
            <div class="caveat-header">
                <span class="caveat-icon"><i class="bi bi-exclamation-triangle"></i></span>
                <span class="caveat-title">Limited rain data</span>
            </div>
            <div class="caveat-stats">
                <div class="caveat-stat"><span class="caveat-num">${dry}</span> dry weekdays</div>
                <div class="caveat-divider"></div>
                <div class="caveat-stat"><span class="caveat-num">${rainy}</span> rainy weekdays</div>
                <div class="caveat-divider"></div>
                <div class="caveat-stat"><span class="caveat-num">0</span> heavy rain days</div>
            </div>
            <div class="caveat-note">Based on 24 days of collection. Heavy rain (&gt;0.5 mm/h) did not occur. The rain line may be incomplete where insufficient data exists. A full seasonal cycle would be needed for robust weather-effect conclusions.</div>`;
    }
}

function renderStation930(rows) {
    const canvas = document.getElementById('station-930-chart');
    if (!canvas) return;
    if (station930Chart) station930Chart.destroy();

    if (!rows || rows.length === 0) {
        canvas.parentElement.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Data unavailable</span></div>';
        return;
    }

    const labels = rows.map(r => r.station_name.split(',')[0]);
    const values = rows.map(r => parseFloat(r.avg_empty_docks));

    // Preferred stations get blue, others get green/amber/red by dock count
    const colors = rows.map((r, i) => {
        if (PREFERRED_IDS.includes(r.station_id)) return '#378ADD';
        const v = values[i];
        return v > 5 ? '#1D9E75' : v >= 2 ? '#BA7517' : '#E24B4A';
    });

    // Bold preferred station labels via font weight callback
    const fontWeights = rows.map(r =>
        PREFERRED_IDS.includes(r.station_id) ? 'bold' : 'normal'
    );

    station930Chart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderRadius: 3,
                borderSkipped: false,
                barPercentage: 0.7,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x} avg empty docks at 9:30 AM` } },
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5 },
                    title: { display: true, text: 'Average empty docks', font: { size: 10 }, color: getAxisTitleColor() },
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        ...getTick(),
                        font: function(context) {
                            const weight = fontWeights[context.index] || 'normal';
                            return { size: 10, weight };
                        },
                    },
                },
            },
        },
    });
}

// ============================================================
// CHAPTER 5: Models
// ============================================================

const FEATURE_LABELS = {
    empty_docks_lag1: 'Current dock count',
    empty_docks_now: 'Current dock count',
    hour_sin: 'Hour (sin)',
    hour_cos: 'Hour (cos)',
    hour: 'Hour of day',
    is_weekend: 'Weekend flag',
    station_enc: 'Station',
    temperature: 'Temperature',
    precipitation: 'Precipitation',
    wind_speed: 'Wind speed',
    humidity: 'Humidity',
    total_docks: 'Station capacity',
    weekday: 'Weekday',
    // Forecast conceptual features
    station: 'Station',
    current_availability: 'Current availability',
    weather: 'Weather',
};

async function loadCh5() {
    try {
        const data = await getInsightsCh5();
        if (data.nowcast) {
            setText('model-nowcast-name', (data.nowcast.name || 'Gradient Boosting').replace(' Nowcast', ''));
            setText('model-nowcast-mae', data.nowcast.mae?.toFixed(2) || '--');
            setText('model-nowcast-r2', data.nowcast.r2?.toFixed(2) || '--');
            setText('error-nowcast', `+/-${Math.round(data.nowcast.mae || 1)} dock`);
        }
        if (data.forecast) {
            setText('model-forecast-name', (data.forecast.name || 'Historical Average').replace(' Forecast', ''));
            setText('model-forecast-mae', data.forecast.mae?.toFixed(2) || '--');
            setText('model-forecast-r2', data.forecast.r2?.toFixed(2) || '--');
            setText('error-forecast', `+/-${Math.round(data.forecast.mae || 3)} docks`);
        }
        if (data.feature_importance && data.feature_importance.length > 0) {
            renderFeatureImportance(data.feature_importance);
        }
        if (data.forecast_importance && data.forecast_importance.length > 0) {
            renderForecastImportance(data.forecast_importance);
        }
    } catch (e) {
        console.error('Ch5 load failed:', e);
    }
    revealInsights();
}

function renderFeatureImportance(features) {
    const canvas = document.getElementById('feature-chart');
    if (!canvas) return;
    if (featureChart) featureChart.destroy();

    if (!features || features.length === 0) {
        canvas.parentElement.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Data unavailable</span></div>';
        return;
    }

    const top = features.slice(0, 8);
    const labels = top.map(f => FEATURE_LABELS[f.feature] || f.feature);
    const values = top.map(f => Math.round(f.importance * 1000) / 10);

    featureChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: top.map((_, i) => `rgba(55, 138, 221, ${1 - i * 0.08})`),
                borderRadius: 4,
                borderSkipped: false,
                barPercentage: 0.65,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x}% importance` } },
            },
            scales: {
                x: { beginAtZero: true, grid: getGrid(), ticks: { ...getTick(), callback: v => v + '%' } },
                y: { grid: { display: false }, ticks: { ...getTick(), font: { size: 11 } } },
            },
        },
    });
}

function renderForecastImportance(features) {
    const canvas = document.getElementById('forecast-feature-chart');
    if (!canvas) return;
    if (forecastFeatureChart) forecastFeatureChart.destroy();

    if (!features || features.length === 0) {
        canvas.parentElement.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Data unavailable</span></div>';
        return;
    }

    const labels = features.map(f => FEATURE_LABELS[f.feature] || f.feature);
    const values = features.map(f => Math.round(f.importance * 1000) / 10);
    const colors = features.map(f =>
        f.importance > 0 ? 'rgba(29, 158, 117, 0.8)' : 'rgba(200, 200, 200, 0.4)'
    );

    forecastFeatureChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderRadius: 4,
                borderSkipped: false,
                barPercentage: 0.65,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x}% importance` } },
            },
            scales: {
                x: { beginAtZero: true, grid: getGrid(), ticks: { ...getTick(), callback: v => v + '%' } },
                y: { grid: { display: false }, ticks: { ...getTick(), font: { size: 11 } } },
            },
        },
    });
}

// ============================================================
// Helpers
// ============================================================

function setText(id, text) {
    const el = document.getElementById(id);
    if (el && text != null) el.textContent = text;
}
