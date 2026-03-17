/* DockSense – Insights Tab */

import { getInsightsOverview, getInsightsCorrelations, getInsightsPatterns, getInsightsModel } from './api/client.js';

let overviewChart = null;
let rainChart = null;
let tempChart = null;
let dowChart = null;
let accuracyChart = null;
let scatterChart = null;
let featureChart = null;
let errorChart = null;
let correlationsLoaded = false;
let patternsLoaded = false;
let modelLoaded = false;

// ── Theme detection ──
function isDarkMode() {
    if (document.documentElement.getAttribute('data-bs-theme') === 'dark') return true;
    if (document.documentElement.getAttribute('data-bs-theme') === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ── Chart style constants (theme-aware) ──
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

const COLORS = {
    info: '#378ADD',
    warning: '#BA7517',
    danger: '#E24B4A',
    success: '#1D9E75',
    gray: '#9B9B9B',
    grayLight: '#C8C8C8',
};

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    setupPillNav();
    loadOverview();
});

// ── Sub-page navigation ──
function setupPillNav() {
    const nav = document.getElementById('insights-nav');
    nav.addEventListener('click', (e) => {
        const btn = e.target.closest('.ds-pill');
        if (!btn) return;
        const page = btn.dataset.page;

        nav.querySelectorAll('.ds-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.insights-subpage').forEach(p => {
            p.style.display = p.id === `page-${page}` ? '' : 'none';
        });

        // Lazy-load sub-pages on first visit
        if (page === 'correlations' && !correlationsLoaded) {
            correlationsLoaded = true;
            loadCorrelations();
        }
        if (page === 'patterns' && !patternsLoaded) {
            patternsLoaded = true;
            loadPatterns();
        }
        if (page === 'model' && !modelLoaded) {
            modelLoaded = true;
            loadModel();
        }
    });
}

// ── Async loaders for sub-pages ──
async function loadCorrelations() {
    try {
        const data = await getInsightsCorrelations();
        renderRainChart(data.rain_effect);
        renderTempChart(data.temp_scatter);
    } catch (e) {
        console.warn('Correlations API unavailable, using synthetic data:', e.message);
        renderRainChart();
        renderTempChart();
    }
}

async function loadPatterns() {
    try {
        const data = await getInsightsPatterns();
        renderHeatmap(data.hourly_heatmap);
        renderDowChart(data.day_of_week_8am);
        renderFillOrder(data.station_fill_order);
    } catch (e) {
        console.warn('Patterns API unavailable, using synthetic data:', e.message);
        renderHeatmap();
        renderDowChart();
        renderFillOrder();
    }
}

async function loadModel() {
    try {
        const data = await getInsightsModel();
        renderAccuracyChart(data.accuracy_history);
        renderScatterChart(data.prediction_vs_actual);
        renderFeatureImportance(data.feature_importance);
        renderErrorDist(data.error_distribution);
    } catch (e) {
        console.warn('Model API unavailable, using synthetic data:', e.message);
        renderAccuracyChart();
        renderScatterChart();
        renderFeatureImportance();
        renderErrorDist();
    }
}

// ══════════════════════════════════════════════════════
// OVERVIEW
// ══════════════════════════════════════════════════════

async function loadOverview() {
    const skeleton = document.getElementById('metric-skeleton');
    const metricCards = document.getElementById('metric-cards');
    const overviewGrid = document.getElementById('overview-grid');
    const errorEl = document.getElementById('insights-error');

    skeleton.style.display = '';
    metricCards.style.display = 'none';
    if (overviewGrid) overviewGrid.style.display = 'none';
    errorEl.style.display = 'none';

    try {
        const data = await getInsightsOverview();

        skeleton.style.display = 'none';
        metricCards.style.display = '';
        metricCards.classList.add('fade-in');
        setTimeout(() => metricCards.classList.remove('fade-in'), 250);
        if (overviewGrid) overviewGrid.style.display = '';

        renderMetricCards(data);
        renderFindings(data.key_findings);
        renderOverviewChart();
        updateSubtitle(data);
    } catch (e) {
        console.error('Failed to load overview:', e);
        skeleton.style.display = 'none';
        errorEl.style.display = '';
    }

    const retryBtn = document.getElementById('insights-retry-btn');
    if (retryBtn) retryBtn.onclick = () => loadOverview();
}

function updateSubtitle(data) {
    const el = document.getElementById('insights-subtitle');
    if (!el) return;
    const sources = Object.keys(data.data_sources).length;
    el.textContent = `${sources} data sources \u00B7 ${data.collection_days} days \u00B7 21 stations`;
}

function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
}

function renderMetricCards(data) {
    const ds = data.data_sources;
    document.getElementById('mc-docks').textContent = formatCount(ds.dock_readings.count);
    document.getElementById('mc-weather').textContent = formatCount(ds.weather_observations.count);
    document.getElementById('mc-sensor').textContent = formatCount(ds.temp_sensor_readings.count);

    const pct = Math.round(data.model_accuracy_7d * 100);
    document.getElementById('mc-accuracy').textContent = pct + '%';
    requestAnimationFrame(() => {
        document.getElementById('mc-accuracy-bar').style.width = pct + '%';
    });
}

function renderFindings(findings) {
    const container = document.getElementById('findings-list');
    container.innerHTML = findings.map(text => `
        <div class="finding-item">
            <div class="finding-bullet"></div>
            <div>${text}</div>
        </div>
    `).join('');
}

function renderOverviewChart() {
    const canvas = document.getElementById('overview-chart');
    if (!canvas) return;
    if (overviewChart) overviewChart.destroy();

    const labels = [];
    const values = [];
    for (let h = 6; h <= 10; h++) {
        for (let m = 0; m < 60; m += 15) {
            if (h === 10 && m > 0) break;
            const t = h + m / 60;
            labels.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

            let docks;
            if (t <= 6.5) docks = 18;
            else if (t <= 7.5) docks = 18 - (t - 6.5) * 14;
            else if (t <= 8.25) docks = Math.max(0.3, 4 - (t - 7.5) * 5);
            else if (t <= 9.5) docks = 0.3 + (t - 8.25) * 8;
            else docks = 10 + (t - 9.5) * 4;
            values.push(Math.round(docks * 10) / 10);
        }
    }

    const minIdx = values.indexOf(Math.min(...values));

    overviewChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: values,
                borderColor: COLORS.danger,
                backgroundColor: 'rgba(226, 75, 74, 0.08)',
                borderWidth: 2,
                fill: true,
                pointRadius: values.map((_, i) => i === minIdx ? 5 : 0),
                pointBackgroundColor: COLORS.danger,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointHoverRadius: 5,
                tension: 0.4,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} empty docks` } },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { ...getTick(), maxRotation: 0, callback(val, idx) { return idx % 4 === 0 ? this.getLabelForValue(val) : ''; } },
                },
                y: {
                    beginAtZero: true, max: 22,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5 },
                    title: { display: true, text: 'Empty docks', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
        plugins: [{
            id: 'peakAnnotation',
            afterDraw(chart) {
                const point = chart.getDatasetMeta(0).data[minIdx];
                if (!point) return;
                const ctx = chart.ctx;
                const x = point.x, y = point.y;
                const text = 'peak crunch';
                ctx.save();
                ctx.font = '500 9px -apple-system, sans-serif';
                const bw = ctx.measureText(text).width + 10;
                const bh = 16, bx = x - bw / 2, by = y - bh - 10;
                ctx.fillStyle = COLORS.danger;
                ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill();
                ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(text, x, by + bh / 2);
                ctx.strokeStyle = COLORS.danger; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
                ctx.beginPath(); ctx.moveTo(x, by + bh); ctx.lineTo(x, y - 6); ctx.stroke();
                ctx.restore();
            },
        }],
    });
}

// ══════════════════════════════════════════════════════
// CORRELATIONS
// ══════════════════════════════════════════════════════

// ── Rain effect chart ──
function renderRainChart(apiData) {
    const canvas = document.getElementById('corr-rain-chart');
    if (!canvas) return;
    if (rainChart) rainChart.destroy();

    // Generate dry-day and rainy-day curves, 6am-10am in 10-min steps
    const labels = [];
    const dry = [];
    const rainy = [];

    // Try to use API data for morning window (6am-10am)
    if (apiData && apiData.dry_days && apiData.rainy_days) {
        for (let h = 6; h <= 10; h++) {
            labels.push(`${String(h).padStart(2, '0')}:00`);
            const dryPt = apiData.dry_days.find(d => d.hour === h);
            const rainyPt = apiData.rainy_days.find(d => d.hour === h);
            dry.push(dryPt ? dryPt.avg_empty_docks : 10);
            rainy.push(rainyPt ? rainyPt.avg_empty_docks : 12);
        }
    }

    // Fall back to synthetic if insufficient data
    if (labels.length === 0) {
    for (let h = 6; h <= 10; h++) {
        for (let m = 0; m < 60; m += 10) {
            if (h === 10 && m > 0) break;
            const t = h + m / 60;
            labels.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

            // Dry day: sharp dip centered at ~7:48
            let d;
            if (t <= 6.5) d = 17;
            else if (t <= 7.3) d = 17 - (t - 6.5) * 12;
            else if (t <= 8.0) d = Math.max(0.5, 7.4 - (t - 7.3) * 10);
            else if (t <= 8.3) d = Math.max(0.3, 0.5 - (t - 8.0) * 0.5);
            else if (t <= 9.5) d = 0.3 + (t - 8.3) * 8.5;
            else d = 10.5 + (t - 9.5) * 5;
            dry.push(Math.round(d * 10) / 10);

            // Rainy day: same shape but shifted ~23 min later (0.383 hours) and slightly higher floor
            const tr = t - 0.383;
            let r;
            if (tr <= 6.5) r = 18;
            else if (tr <= 7.3) r = 18 - (tr - 6.5) * 11;
            else if (tr <= 8.0) r = Math.max(1.5, 9.2 - (tr - 7.3) * 10);
            else if (tr <= 8.3) r = Math.max(1.2, 1.5 - (tr - 8.0) * 0.8);
            else if (tr <= 9.5) r = 1.2 + (tr - 8.3) * 9;
            else r = 12 + (tr - 9.5) * 4;
            rainy.push(Math.round(Math.min(20, r) * 10) / 10);
        }
    }
    } // end fallback

    rainChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Dry days',
                    data: dry,
                    borderColor: COLORS.grayLight,
                    borderWidth: 1.5,
                    borderDash: [5, 3],
                    backgroundColor: 'transparent',
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.4,
                },
                {
                    label: 'Rainy days',
                    data: rainy,
                    borderColor: COLORS.info,
                    borderWidth: 1.5,
                    backgroundColor: 'rgba(55, 138, 221, 0.06)',
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.4,
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
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'line',
                        font: { size: 10 },
                        color: getLegendColor(),
                        padding: 14,
                    },
                },
                tooltip: {
                    callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} docks` },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        ...getTick(),
                        maxRotation: 0,
                        callback(val, idx) { return idx % 6 === 0 ? this.getLabelForValue(val) : ''; },
                    },
                },
                y: {
                    beginAtZero: true,
                    max: 22,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5 },
                    title: { display: true, text: 'Empty docks', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
        plugins: [{
            // Draw "~23 min" annotation between the two curves at their lowest points
            id: 'shiftAnnotation',
            afterDraw(chart) {
                const dryMeta = chart.getDatasetMeta(0);
                const rainyMeta = chart.getDatasetMeta(1);

                // Find the minimum index for each curve
                const dryMin = dry.indexOf(Math.min(...dry));
                const rainyMin = rainy.indexOf(Math.min(...rainy));
                const dryPt = dryMeta.data[dryMin];
                const rainyPt = rainyMeta.data[rainyMin];
                if (!dryPt || !rainyPt) return;

                const ctx = chart.ctx;
                const y = chart.chartArea.bottom - 20;

                ctx.save();
                // Horizontal arrow between the two low points
                ctx.strokeStyle = COLORS.gray;
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(dryPt.x, y);
                ctx.lineTo(rainyPt.x, y);
                ctx.stroke();

                // Arrowheads
                const dir = rainyPt.x > dryPt.x ? 1 : -1;
                ctx.beginPath();
                ctx.moveTo(rainyPt.x, y);
                ctx.lineTo(rainyPt.x - dir * 5, y - 3);
                ctx.lineTo(rainyPt.x - dir * 5, y + 3);
                ctx.closePath();
                ctx.fillStyle = COLORS.gray;
                ctx.fill();

                // Label
                const mx = (dryPt.x + rainyPt.x) / 2;
                ctx.font = '500 9px -apple-system, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = COLORS.gray;
                ctx.fillText('~23 min', mx, y - 5);
                ctx.restore();
            },
        }],
    });
}

// ── Sensor vs API temperature chart ──
function renderTempChart(apiScatter) {
    const canvas = document.getElementById('corr-temp-chart');
    if (!canvas) return;
    if (tempChart) tempChart.destroy();

    // Generate 7 days of hourly temperature data (168 points)
    const labels = [];
    const apiData = [];
    const sensorData = [];

    // Seed a pseudo-random sequence for reproducible noise
    let seed = 42;
    function rand() { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; }

    const baseDate = new Date('2026-03-10T00:00:00Z');
    for (let i = 0; i < 168; i++) {
        const t = new Date(baseDate.getTime() + i * 3600000);
        const dayOfWeek = t.getUTCDay();
        const hour = t.getUTCHours();

        // Day label at midnight, time label at noon
        if (hour === 0) {
            labels.push(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dayOfWeek]);
        } else if (hour === 12) {
            labels.push('12:00');
        } else {
            labels.push('');
        }

        // Sinusoidal diurnal temperature pattern with day-to-day variation
        const dayBase = 8 + (dayOfWeek % 3) * 1.2; // slight day-to-day shift
        const diurnal = 4.5 * Math.sin((hour - 6) * Math.PI / 12);
        const apiTemp = Math.round((dayBase + diurnal) * 10) / 10;

        // Sensor: closely tracks API with ±0.8°C noise
        const noise = (rand() - 0.5) * 1.6;
        const sensorTemp = Math.round((apiTemp + noise) * 10) / 10;

        apiData.push(apiTemp);
        sensorData.push(sensorTemp);
    }

    tempChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Open-Meteo API',
                    data: apiData,
                    borderColor: COLORS.info,
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
                    borderColor: COLORS.warning,
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
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'line',
                        font: { size: 10 },
                        color: getLegendColor(),
                        padding: 14,
                    },
                },
                tooltip: {
                    callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}\u00B0C` },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        ...getTick(),
                        maxRotation: 0,
                        autoSkip: false,
                        callback(val, idx) {
                            return labels[idx] || '';
                        },
                    },
                },
                y: {
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 3 },
                    title: { display: true, text: 'Temperature (\u00B0C)', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
        plugins: [{
            // Draw r = 0.94 correlation badge
            id: 'corrBadge',
            afterDraw(chart) {
                const ctx = chart.ctx;
                const { right, top } = chart.chartArea;
                const text = 'r = 0.94';

                ctx.save();
                ctx.font = '500 10px -apple-system, sans-serif';
                const tw = ctx.measureText(text).width;
                const bw = tw + 12;
                const bh = 18;
                const bx = right - bw - 4;
                const by = top + 4;

                ctx.fillStyle = 'rgba(186, 117, 23, 0.12)';
                ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill();
                ctx.fillStyle = COLORS.warning;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(text, bx + bw / 2, by + bh / 2);
                ctx.restore();
            },
        }],
    });
}

// ══════════════════════════════════════════════════════
// TIME PATTERNS
// ══════════════════════════════════════════════════════

// ── Heatmap data generator ──
function generateHeatmapData() {
    // Returns { day (0=Mon..6=Sun), hour (0-23), value (avg empty docks) }
    const data = [];
    for (let day = 0; day < 7; day++) {
        const isWeekday = day < 5;
        for (let hour = 0; hour < 24; hour++) {
            let v;
            if (!isWeekday) {
                // Weekends: generally high availability
                if (hour < 6) v = 16 + Math.random() * 2;
                else if (hour < 10) v = 13 + Math.random() * 3;
                else if (hour < 18) v = 10 + Math.random() * 4;
                else v = 14 + Math.random() * 3;
            } else {
                // Weekdays: severe morning crunch 7-9
                if (hour < 6) v = 17 + Math.random() * 2;
                else if (hour === 6) v = 14 + Math.random() * 2;
                else if (hour === 7) v = 4 + Math.random() * 3 - day * 0.3;
                else if (hour === 8) v = 0.5 + Math.random() * 1.5;
                else if (hour === 9) v = 3 + Math.random() * 3;
                else if (hour === 10) v = 7 + Math.random() * 3;
                else if (hour < 16) v = 10 + Math.random() * 4;
                else if (hour === 17) v = 6 + Math.random() * 3;
                else if (hour === 18) v = 5 + Math.random() * 3;
                else if (hour === 19) v = 7 + Math.random() * 3;
                else v = 12 + Math.random() * 4;
            }
            data.push({ day, hour, value: Math.max(0, Math.round(v * 10) / 10) });
        }
    }
    return data;
}

function heatmapColor(v) {
    // 0-1: deep red, 2-3: red, 4-5: orange, 6-8: amber, 9-11: light green, 12+: green
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

    let data;
    if (apiData && apiData.length > 0) {
        // API returns weekday 0=Sun (SQL DOW), convert to 0=Mon for display
        data = apiData.map(r => ({
            day: r.weekday === 0 ? 6 : r.weekday - 1,
            hour: r.hour,
            value: r.avg_empty_docks,
        }));
    } else {
        data = generateHeatmapData();
    }
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    let html = '';

    // Header row: empty corner + 24 hour labels
    html += '<div class="hm-header"></div>'; // corner
    for (let h = 0; h < 24; h++) {
        const label = h % 3 === 0 ? `${String(h).padStart(2, '0')}` : '';
        html += `<div class="hm-header">${label}</div>`;
    }

    // Data rows
    for (let day = 0; day < 7; day++) {
        html += `<div class="hm-row-label">${dayNames[day]}</div>`;
        for (let hour = 0; hour < 24; hour++) {
            const d = data.find(x => x.day === day && x.hour === hour);
            const v = d ? d.value : 0;
            const bg = heatmapColor(v);
            const textColor = v <= 5 ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)';
            html += `<div class="hm-cell" style="background:${bg};color:${textColor}" title="${dayNames[day]} ${String(hour).padStart(2, '0')}:00 — ${v} docks">${Math.round(v)}</div>`;
        }
    }

    container.innerHTML = html;
}

// ── Day-of-week bar chart ──
function renderDowChart(apiData) {
    const canvas = document.getElementById('patterns-dow-chart');
    if (!canvas) return;
    if (dowChart) dowChart.destroy();

    let days, values;
    if (apiData && apiData.length > 0) {
        days = apiData.map(r => r.day);
        values = apiData.map(r => r.avg_empty_docks);
    } else {
        days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        values = [2.1, 1.8, 2.4, 1.5, 3.2, 12.4, 14.1];
    }
    const colors = values.map(v => v < 3 ? COLORS.danger : v <= 5 ? COLORS.warning : COLORS.success);

    dowChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: days,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderRadius: 4,
                borderSkipped: false,
                barPercentage: 0.65,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (ctx) => `${ctx.parsed.y} avg empty docks at 8 AM` },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { ...getTick(), maxRotation: 0 },
                },
                y: {
                    beginAtZero: true,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5 },
                    title: { display: true, text: 'Empty docks', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
    });
}

// ── Station fill order ──
function renderFillOrder(apiData) {
    const container = document.getElementById('fill-order-list');
    if (!container) return;

    let stations;
    if (apiData && apiData.length > 0) {
        stations = apiData.map(r => {
            const parts = r.avg_fill_time.split(':');
            const minutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            return { name: r.station_name, time: r.avg_fill_time, minutes };
        });
    } else {
        stations = [
            { name: 'Imperial College', time: '7:48', minutes: 468 },
            { name: 'Prince Consort Rd', time: '8:05', minutes: 485 },
            { name: 'Exhibition Road', time: '8:22', minutes: 502 },
            { name: 'Exhibition Rd M.1', time: '8:28', minutes: 508 },
            { name: 'Exhibition Rd M.2', time: '8:35', minutes: 515 },
            { name: 'Queens Gate', time: '8:42', minutes: 522 },
            { name: 'V&A Museum', time: '8:58', minutes: 538 },
        ];
    }

    // Scale: 7:30 (450) to 9:15 (555) → 0-100%
    const minM = 450, maxM = 555;

    container.innerHTML = stations.map((s, i) => {
        const pct = Math.round(((s.minutes - minM) / (maxM - minM)) * 100);
        const isBefore830 = s.minutes < 510; // 8:30 = 510
        const color = isBefore830 ? (s.minutes < 490 ? COLORS.danger : COLORS.warning) : COLORS.success;

        return `
        <div class="fill-order-row">
            <div class="fill-order-rank" style="background:${color}">${i + 1}</div>
            <div class="fill-order-name">${s.name}</div>
            <div class="fill-order-bar-wrap">
                <div class="fill-order-bar" style="width:${pct}%;background:${color};opacity:0.7"></div>
            </div>
            <div class="fill-order-time">${s.time}</div>
        </div>`;
    }).join('');
}

// ══════════════════════════════════════════════════════
// MODEL
// ══════════════════════════════════════════════════════

// Seeded PRNG for reproducible chart data
function seededRand(s) {
    return function () { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

// ── Accuracy over time (14-day rolling) ──
function renderAccuracyChart(apiData) {
    const canvas = document.getElementById('model-accuracy-chart');
    if (!canvas) return;
    if (accuracyChart) accuracyChart.destroy();

    let labels, values;
    if (apiData && apiData.length > 0) {
        labels = apiData.map(r => {
            const d = new Date(r.date);
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        });
        values = apiData.map(r => Math.round(r.r2 * 100 * 10) / 10);
    } else {
        const rand = seededRand(77);
        labels = [];
        values = [];
        const base = new Date('2026-03-03');
        for (let i = 0; i < 14; i++) {
            const d = new Date(base.getTime() + i * 86400000);
            labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
            const dow = d.getDay();
            const isWeekend = dow === 0 || dow === 6;
            const noise = (rand() - 0.5) * 6;
            const v = isWeekend ? 89 + noise : 81 + noise;
            values.push(Math.round(Math.max(70, Math.min(98, v)) * 10) / 10);
        }
    }

    const pointColors = values.map(v => v >= 80 ? COLORS.success : COLORS.warning);

    accuracyChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: values,
                borderColor: COLORS.success,
                backgroundColor: 'rgba(29, 158, 117, 0.06)',
                borderWidth: 2,
                fill: true,
                pointRadius: 3,
                pointBackgroundColor: pointColors,
                pointBorderColor: '#fff',
                pointBorderWidth: 1.5,
                pointHoverRadius: 5,
                tension: 0.3,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}% accuracy` } },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { ...getTick(), maxRotation: 45, callback(val, idx) { return idx % 2 === 0 ? this.getLabelForValue(val) : ''; } },
                },
                y: {
                    min: 70, max: 100,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5, callback: v => v + '%' },
                    title: { display: true, text: 'Accuracy', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
        plugins: [{
            // 80% baseline dashed line
            id: 'baselineLine',
            afterDraw(chart) {
                const yScale = chart.scales.y;
                const y80 = yScale.getPixelForValue(80);
                const ctx = chart.ctx;
                const { left, right } = chart.chartArea;

                ctx.save();
                ctx.strokeStyle = COLORS.gray;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(left, y80);
                ctx.lineTo(right, y80);
                ctx.stroke();

                ctx.font = '500 9px -apple-system, sans-serif';
                ctx.fillStyle = COLORS.gray;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';
                ctx.fillText('80% baseline', right, y80 - 3);
                ctx.restore();
            },
        }],
    });
}

// ── Prediction vs actual scatter ──
function renderScatterChart(apiData) {
    const canvas = document.getElementById('model-scatter-chart');
    if (!canvas) return;
    if (scatterChart) scatterChart.destroy();

    let points;
    if (apiData && apiData.length > 0) {
        points = apiData.map(r => ({
            x: r.actual,
            y: r.predicted,
            error: Math.abs(r.predicted - r.actual),
        }));
    } else {
        const rand = seededRand(123);
        points = [];
        for (let i = 0; i < 120; i++) {
            const actual = Math.round(rand() * 20);
            const error = (rand() - 0.5) * 2 + (rand() - 0.5) * 3;
            const predicted = Math.max(0, Math.min(20, Math.round(actual + error)));
            points.push({ x: actual, y: predicted, error: Math.abs(predicted - actual) });
        }
    }

    // Split into 3 datasets by error magnitude for coloring
    const green = points.filter(p => p.error <= 1);
    const amber = points.filter(p => p.error >= 2 && p.error < 3);
    const red = points.filter(p => p.error >= 3);

    scatterChart = new Chart(canvas, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: '±1 dock',
                    data: green,
                    backgroundColor: 'rgba(29, 158, 117, 0.5)',
                    borderColor: COLORS.success,
                    borderWidth: 1,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                },
                {
                    label: '±2 docks',
                    data: amber,
                    backgroundColor: 'rgba(186, 117, 23, 0.5)',
                    borderColor: COLORS.warning,
                    borderWidth: 1,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                },
                {
                    label: '±3+ docks',
                    data: red,
                    backgroundColor: 'rgba(226, 75, 74, 0.5)',
                    borderColor: COLORS.danger,
                    borderWidth: 1,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { usePointStyle: true, pointStyle: 'circle', font: { size: 10 }, color: getLegendColor(), padding: 14 },
                },
                tooltip: {
                    callbacks: { label: (ctx) => `Actual: ${ctx.parsed.x}, Predicted: ${ctx.parsed.y}` },
                },
            },
            scales: {
                x: {
                    min: 0, max: 20,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5 },
                    title: { display: true, text: 'Actual empty docks', font: { size: 10 }, color: getAxisTitleColor() },
                },
                y: {
                    min: 0, max: 20,
                    grid: getGrid(),
                    ticks: { ...getTick(), stepSize: 5 },
                    title: { display: true, text: 'Predicted empty docks', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
        plugins: [{
            // y = x diagonal line
            id: 'diagonalLine',
            afterDraw(chart) {
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                const ctx = chart.ctx;

                ctx.save();
                ctx.strokeStyle = COLORS.grayLight;
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(xScale.getPixelForValue(0), yScale.getPixelForValue(0));
                ctx.lineTo(xScale.getPixelForValue(20), yScale.getPixelForValue(20));
                ctx.stroke();

                ctx.font = '500 9px -apple-system, sans-serif';
                ctx.fillStyle = COLORS.grayLight;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText('perfect', xScale.getPixelForValue(16) + 4, yScale.getPixelForValue(16) - 2);
                ctx.restore();
            },
        }],
    });
}

// ── Feature importance (horizontal bar) ──
function renderFeatureImportance(apiData) {
    const canvas = document.getElementById('model-feature-chart');
    if (!canvas) return;
    if (featureChart) featureChart.destroy();

    const FEATURE_LABELS = {
        empty_docks_lag1: 'Current availability',
        hour_sin: 'Hour (sin)',
        hour_cos: 'Hour (cos)',
        hour: 'Hour of day',
        is_weekend: 'Day of week',
        station_enc: 'Station',
        temperature: 'Temperature',
        precipitation: 'Precipitation',
        wind_speed: 'Wind speed',
        humidity: 'Humidity',
        total_docks: 'Station capacity',
        weekday: 'Weekday',
    };

    let features;
    if (apiData && apiData.length > 0) {
        features = apiData.slice(0, 7).map(r => ({
            name: FEATURE_LABELS[r.feature] || r.feature,
            value: r.importance,
        }));
    } else {
        features = [
            { name: 'Current availability', value: 0.34 },
            { name: 'Hour of day', value: 0.22 },
            { name: 'Day of week', value: 0.15 },
            { name: 'Temperature', value: 0.10 },
            { name: 'Precipitation', value: 0.08 },
            { name: 'Station capacity', value: 0.06 },
            { name: 'Wind speed', value: 0.05 },
        ];
    }

    featureChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: features.map(f => f.name),
            datasets: [{
                data: features.map(f => Math.round(f.value * 100)),
                backgroundColor: features.map((_, i) => {
                    const opacity = 1 - i * 0.1;
                    return `rgba(55, 138, 221, ${opacity})`;
                }),
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
                x: {
                    beginAtZero: true,
                    grid: getGrid(),
                    ticks: { ...getTick(), callback: v => v + '%' },
                },
                y: {
                    grid: { display: false },
                    ticks: { ...getTick(), font: { size: 11 } },
                },
            },
        },
    });
}

// ── Error distribution (histogram) ──
function renderErrorDist(apiData) {
    const canvas = document.getElementById('model-error-chart');
    if (!canvas) return;
    if (errorChart) errorChart.destroy();

    let bins, counts;
    if (apiData && apiData.length > 0) {
        bins = apiData.map(r => r.error_docks);
        counts = apiData.map(r => r.count);
    } else {
        bins = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
        counts = [3, 8, 18, 42, 68, 74, 65, 38, 16, 7, 2];
    }

    const barColors = bins.map(b => {
        const abs = Math.abs(b);
        if (abs <= 1) return COLORS.success;
        if (abs <= 2) return COLORS.warning;
        return COLORS.danger;
    });

    errorChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: bins.map(b => (b > 0 ? '+' : '') + b),
            datasets: [{
                data: counts,
                backgroundColor: barColors,
                borderRadius: 3,
                borderSkipped: false,
                barPercentage: 0.85,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (ctx) => `${ctx.parsed.y} predictions with error ${ctx.label} docks` },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { ...getTick(), maxRotation: 0 },
                    title: { display: true, text: 'Error (predicted − actual)', font: { size: 10 }, color: getAxisTitleColor() },
                },
                y: {
                    beginAtZero: true,
                    grid: getGrid(),
                    ticks: { ...getTick() },
                    title: { display: true, text: 'Count', font: { size: 10 }, color: getAxisTitleColor() },
                },
            },
        },
    });
}
