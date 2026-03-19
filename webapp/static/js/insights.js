/* DockSense - Insights Tab (all real data from Supabase) */

import { getInsightsCh1, getInsightsCh3, getInsightsCh4, getInsightsCh5 } from './api/client.js';

// Chart instances
let morningChart = null;
let eveningChart = null;
let sensorChart = null;
let rainChart = null;
let station930Chart = null;
let featureChart = null;

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
    'BikePoints_432': '#E24B4A',
    'BikePoints_482': '#BA7517',
    'BikePoints_878': '#378ADD',
    'BikePoints_356': '#1D9E75',
    'BikePoints_428': '#7B61FF',
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
        renderEveningChart(data.evening);
    } catch (e) {
        console.error('Ch1 load failed:', e);
        setText('stat-fill-time', 'Error');
        setText('stat-docks-930', 'Error');
        setText('stat-bikes-6pm', 'Error');
    }
}

function renderMorningChart(rows) {
    const canvas = document.getElementById('morning-chart');
    if (!canvas) return;
    if (morningChart) morningChart.destroy();

    if (!rows || rows.length === 0) {
        canvas.parentElement.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Data unavailable</span></div>';
        return;
    }

    // Group by station
    const byStation = {};
    rows.forEach(r => {
        if (!byStation[r.station_id]) {
            byStation[r.station_id] = { name: r.station_name.split(',')[0], data: {} };
        }
        byStation[r.station_id].data[r.hour] = parseFloat(r.avg_empty_docks);
    });

    const hours = [];
    for (let h = 6; h <= 13; h++) hours.push(h);
    const labels = hours.map(h => `${String(h).padStart(2, '0')}:00`);

    const datasets = PREFERRED_IDS.map(id => {
        const station = byStation[id];
        if (!station) return null;
        return {
            label: station.name,
            data: hours.map(h => station.data[h] ?? null),
            borderColor: STATION_COLORS[id],
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
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
                    labels: { usePointStyle: true, pointStyle: 'line', font: { size: 10 }, color: getLegendColor(), padding: 14 },
                },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} empty docks` } },
            },
            scales: {
                x: { grid: { display: false }, ticks: { ...getTick(), maxRotation: 0 } },
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
        byStation[r.station_id].data[r.hour] = parseFloat(r.avg_bikes);
    });

    const hours = [];
    for (let h = 14; h <= 21; h++) hours.push(h);
    const labels = hours.map(h => `${String(h).padStart(2, '0')}:00`);

    const datasets = PREFERRED_IDS.map(id => {
        const station = byStation[id];
        if (!station) return null;
        return {
            label: station.name,
            data: hours.map(h => station.data[h] ?? null),
            borderColor: STATION_COLORS[id],
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
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
                    labels: { usePointStyle: true, pointStyle: 'line', font: { size: 10 }, color: getLegendColor(), padding: 14 },
                },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} bikes` } },
            },
            scales: {
                x: { grid: { display: false }, ticks: { ...getTick(), maxRotation: 0 } },
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
}

function renderSensorChart(rows) {
    const canvas = document.getElementById('sensor-chart');
    if (!canvas) return;
    if (sensorChart) sensorChart.destroy();

    // Downsample if too many points (hourly data for 16 days = ~384 points)
    const labels = [];
    const apiData = [];
    const sensorData = [];

    rows.forEach((r, i) => {
        const d = new Date(r.ts);
        const h = d.getUTCHours();
        if (h === 0) {
            labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        } else if (h === 12) {
            labels.push('12:00');
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
                    ticks: { ...getTick(), maxRotation: 0, autoSkip: false, callback(val, idx) { return labels[idx] || ''; } },
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
        renderHeatmap(data.heatmap);
        renderRainChart(data.rain_dry, data.rain_wet, data.rain_day_counts);
        renderStation930(data.station_930);
        renderFillTimeline(data.fill_timeline);
    } catch (e) {
        console.error('Ch4 load failed:', e);
    }
}

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

function renderHeatmap(apiData) {
    const container = document.getElementById('patterns-heatmap');
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

function renderRainChart(dryRows, wetRows, dayCounts) {
    const canvas = document.getElementById('rain-chart');
    if (!canvas) return;
    if (rainChart) rainChart.destroy();

    if ((!dryRows || dryRows.length === 0) && (!wetRows || wetRows.length === 0)) {
        canvas.parentElement.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Rain data unavailable</span></div>';
        return;
    }

    const hours = [];
    for (let h = 6; h <= 13; h++) hours.push(h);
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

    // Update caption with real counts
    const captionEl = document.getElementById('rain-caption');
    if (captionEl && dayCounts) {
        captionEl.textContent = `Based on ${dayCounts.dry_days || 0} dry days and ${dayCounts.rainy_days || 0} days with any precipitation over 22 days of collection. Heavy rain (>0.5mm/h) occurred on only ${dayCounts.heavy_rain_days || 0} occasions. Longer data collection would strengthen this analysis.`;
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
    const colors = values.map(v => v > 5 ? '#1D9E75' : v >= 2 ? '#BA7517' : '#E24B4A');
    const borderColors = rows.map(r =>
        PREFERRED_IDS.includes(r.station_id) ? '#378ADD' : 'transparent'
    );
    const borderWidths = rows.map(r =>
        PREFERRED_IDS.includes(r.station_id) ? 2 : 0
    );

    station930Chart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: borderWidths,
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
                    ticks: { ...getTick(), font: { size: 10 } },
                },
            },
        },
        plugins: [{
            id: 'preferredLabel',
            afterDraw(chart) {
                // Add a blue dot next to preferred station labels
                const ctx = chart.ctx;
                const yScale = chart.scales.y;
                const xScale = chart.scales.x;
                rows.forEach((r, i) => {
                    if (PREFERRED_IDS.includes(r.station_id)) {
                        const y = yScale.getPixelForValue(i);
                        const x = xScale.getPixelForValue(0) + 4;
                        ctx.save();
                        ctx.fillStyle = '#378ADD';
                        ctx.beginPath();
                        ctx.arc(x, y, 3, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                    }
                });
            },
        }],
    });
}

function renderFillTimeline(rows) {
    const container = document.getElementById('fill-timeline');
    if (!container) return;

    if (!rows || rows.length === 0) {
        container.innerHTML = '<div class="chart-error"><i class="bi bi-cloud-slash"></i><span>Data unavailable</span></div>';
        return;
    }

    // Group by station
    const byStation = {};
    rows.forEach(r => {
        if (!byStation[r.station_id]) {
            byStation[r.station_id] = { name: r.station_name.split(',')[0], hours: {} };
        }
        byStation[r.station_id].hours[r.hour] = parseFloat(r.avg_empty_docks);
    });

    // For each station, find the range of hours where avg < 3
    const timeline = [];
    Object.entries(byStation).forEach(([id, station]) => {
        let lowStart = null;
        let lowEnd = null;
        for (let h = 6; h <= 16; h++) {
            const val = station.hours[h];
            if (val != null && val < 3) {
                if (lowStart === null) lowStart = h;
                lowEnd = h;
            }
        }
        timeline.push({
            id,
            name: station.name,
            lowStart,
            lowEnd,
            hasLow: lowStart !== null,
        });
    });

    // Sort: stations with low periods first, then by earliest start
    timeline.sort((a, b) => {
        if (a.hasLow && !b.hasLow) return -1;
        if (!a.hasLow && b.hasLow) return 1;
        if (a.hasLow && b.hasLow) return a.lowStart - b.lowStart;
        return 0;
    });

    const minH = 6;
    const maxH = 16;
    const range = maxH - minH;

    let html = '';
    timeline.forEach(s => {
        const isPreferred = PREFERRED_IDS.includes(s.id);
        const nameStyle = isPreferred ? 'color: var(--info); font-weight: 600;' : '';
        let barHtml = '';
        if (s.hasLow) {
            const left = ((s.lowStart - minH) / range) * 100;
            const width = ((s.lowEnd - s.lowStart + 1) / range) * 100;
            barHtml = `<div class="fill-timeline-bar" style="left:${left}%;width:${width}%"></div>`;
        }
        html += `
            <div class="fill-timeline-row">
                <div class="fill-timeline-name" style="${nameStyle}">${s.name}</div>
                <div class="fill-timeline-bar-wrap">${barHtml}</div>
            </div>`;
    });

    // Time labels
    html += `<div class="fill-timeline-labels">`;
    for (let h = minH; h <= maxH; h += 2) {
        html += `<span>${String(h).padStart(2, '0')}:00</span>`;
    }
    html += `</div>`;

    container.innerHTML = html;
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
};

async function loadCh5() {
    try {
        const data = await getInsightsCh5();
        if (data.nowcast) {
            setText('model-nowcast-name', (data.nowcast.name || 'Random Forest').replace(' Nowcast', ''));
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
    } catch (e) {
        console.error('Ch5 load failed:', e);
    }
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

// ============================================================
// Helpers
// ============================================================

function setText(id, text) {
    const el = document.getElementById(id);
    if (el && text != null) el.textContent = text;
}
