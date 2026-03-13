/* Door2Dock – Insights Page (Trends + Weather + Model + About) */

// ------------------------------------------------------------------
// Time Series state
// ------------------------------------------------------------------
let docksChart;
let allStations = [];
let currentStation = '';
let currentHours = 24;

// ------------------------------------------------------------------
// Heatmap state
// ------------------------------------------------------------------
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun display order
const START_HOUR = 7;
const END_HOUR = 20;
let showCount = 3;

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    initChart();
    loadAboutStats();

    document.getElementById('station-select').addEventListener('change', (e) => {
        currentStation = e.target.value;
        loadTimeSeries();
    });

    document.querySelectorAll('[data-hours]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-hours]').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentHours = parseInt(e.target.dataset.hours);
            loadTimeSeries();
        });
    });

    document.querySelectorAll('[data-count]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-count]').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            showCount = parseInt(e.target.dataset.count);
            loadHeatmap();
        });
    });

    // Weather correlation
    loadCorrelationStats();
    loadBinnedCharts();

    setInterval(() => {
        if (currentStation) loadTimeSeries();
        loadCorrelationStats();
    }, 60000);
});

// ------------------------------------------------------------------
// Crosshair plugin
// ------------------------------------------------------------------

const crosshairPlugin = {
    id: 'crosshair',
    afterDraw(chart) {
        if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length) {
            const x = chart.tooltip._active[0].element.x;
            const yAxis = chart.scales.y;
            const ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, yAxis.top);
            ctx.lineTo(x, yAxis.bottom);
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.restore();
        }
    }
};

// ------------------------------------------------------------------
// Time Series Chart
// ------------------------------------------------------------------

function initChart() {
    const commonOpts = {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { position: 'top' },
            tooltip: {
                callbacks: {
                    title: (items) => {
                        if (items.length > 0) {
                            return new Date(items[0].parsed.x)
                                .toLocaleString('en-GB', {
                                    day: '2-digit', month: 'short',
                                    hour: '2-digit', minute: '2-digit'
                                });
                        }
                        return '';
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'time',
                time: { tooltipFormat: 'dd MMM HH:mm' },
                grid: { color: 'rgba(255,255,255,0.05)' },
            },
            y: {
                beginAtZero: true,
                grid: { color: 'rgba(255,255,255,0.05)' },
                title: { display: true, text: 'Free Docks' },
            }
        }
    };

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3';
    script.onload = () => {
        docksChart = new Chart(document.getElementById('chart-docks'), {
            type: 'line',
            data: { datasets: [] },
            options: commonOpts,
            plugins: [crosshairPlugin],
        });
        if (currentStation) loadTimeSeries();
    };
    document.head.appendChild(script);
}

// ------------------------------------------------------------------
// Load stations
// ------------------------------------------------------------------

async function loadStations() {
    try {
        const resp = await fetch('/api/stations');
        allStations = await resp.json();

        const select = document.getElementById('station-select');
        select.innerHTML = '<option value="">Select a station...</option>';
        allStations.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.station_id;
            const walkMin = Math.round((s.walking_duration_s || 0) / 60);
            opt.textContent = `${s.station_name} (${walkMin} min walk)`;
            select.appendChild(opt);
        });

        if (allStations.length > 0) {
            currentStation = allStations[0].station_id;
            select.value = currentStation;
            loadTimeSeries();
        }

        loadHeatmap();
    } catch (e) {
        console.error('Failed to load stations:', e);
    }
}

loadStations();

// ------------------------------------------------------------------
// Time Series Data
// ------------------------------------------------------------------

async function loadTimeSeries() {
    if (!docksChart || !currentStation) return;

    try {
        const resp = await fetch(`/api/timeseries/${currentStation}?hours=${currentHours}`);
        const data = await resp.json();

        const timestamps = data.map(d => d.timestamp);
        const docks = data.map(d => d.empty_docks);

        docksChart.data = {
            datasets: [{
                label: 'Free Docks',
                data: timestamps.map((t, j) => ({ x: t, y: docks[j] })),
                borderColor: '#198754',
                backgroundColor: 'rgba(25, 135, 84, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
            }]
        };
        docksChart.update();
        updateSummary(docks);
    } catch (e) {
        console.error('Failed to load time series:', e);
        updateSummary([]);
    }
}

function updateSummary(docks) {
    const container = document.getElementById('ts-summary');
    if (!docks.length) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';
    const current = docks[docks.length - 1];
    const avg = Math.round(docks.reduce((a, b) => a + b, 0) / docks.length * 10) / 10;
    const min = Math.min(...docks);
    const max = Math.max(...docks);

    const elCurrent = document.getElementById('ts-current');
    elCurrent.textContent = current;
    elCurrent.className = 'fs-3 fw-bold ' + (current >= 5 ? 'text-success' : current >= 1 ? 'text-warning' : 'text-danger');
    document.getElementById('ts-avg').textContent = avg;
    document.getElementById('ts-min').textContent = min;
    document.getElementById('ts-max').textContent = max;
}

// ------------------------------------------------------------------
// Heatmap
// ------------------------------------------------------------------

function getTopStationIds(n) {
    return allStations.slice(0, n).map(s => s.station_id);
}

async function loadHeatmap() {
    const ids = getTopStationIds(showCount);
    const params = ids.length ? `?station_ids=${ids.join(',')}` : '';

    try {
        const resp = await fetch(`/api/heatmap${params}`);
        const data = await resp.json();
        renderHeatmap(data);
        computeHeatmapInsights(data);
    } catch (e) {
        console.error('Failed to load heatmap:', e);
        document.getElementById('heatmap-grid').innerHTML =
            '<div class="text-danger text-center py-5">Failed to load heatmap data</div>';
    }
}

function buildSlots() {
    const slots = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
        slots.push({ hour: h, minute: 0 });
        slots.push({ hour: h, minute: 30 });
    }
    return slots;
}

function renderHeatmap(data) {
    const slots = buildSlots();
    const grid = {};
    let minVal = Infinity, maxVal = -Infinity;

    data.forEach(d => {
        const key = `${d.hour}:${d.minute}`;
        if (d.hour < START_HOUR || d.hour > END_HOUR) return;
        if (!grid[d.weekday]) grid[d.weekday] = {};
        const val = d.avg_docks || 0;
        grid[d.weekday][key] = val;
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
    });

    if (minVal === Infinity) minVal = 0;
    if (maxVal === -Infinity) maxVal = 1;
    const range = maxVal - minVal || 1;

    let html = '<div class="heatmap-grid">';
    html += '<div class="heatmap-header"></div>';
    slots.forEach(s => {
        const label = s.minute === 0 ? `${s.hour.toString().padStart(2, '0')}` : '';
        html += `<div class="heatmap-header">${label}</div>`;
    });

    DAY_ORDER.forEach(day => {
        html += `<div class="heatmap-row-label">${DAY_NAMES[day]}</div>`;
        slots.forEach(s => {
            const key = `${s.hour}:${s.minute}`;
            const val = (grid[day] && grid[day][key]) || 0;
            const norm = (val - minVal) / range;
            const color = heatmapColor(norm);
            const textColor = norm > 0.5 ? '#000' : '#fff';
            const timeLabel = `${s.hour.toString().padStart(2, '0')}:${s.minute.toString().padStart(2, '0')}`;
            html += `<div class="heatmap-cell"
                style="background-color: ${color}; color: ${textColor};"
                title="${DAY_NAMES[day]} ${timeLabel} – ${val} docks">${val}</div>`;
        });
    });

    html += '</div>';
    document.getElementById('heatmap-grid').innerHTML = html;
}

function heatmapColor(norm) {
    let r, g, b;
    if (norm < 0.5) {
        const t = norm * 2;
        r = 220; g = Math.round(53 + t * 140); b = Math.round(69 - t * 62);
    } else {
        const t = (norm - 0.5) * 2;
        r = Math.round(255 - t * 230); g = Math.round(193 - t * 58); b = Math.round(7 + t * 77);
    }
    return `rgb(${r}, ${g}, ${b})`;
}

function computeHeatmapInsights(data) {
    if (!data.length) return;
    const filtered = data.filter(d => d.hour >= START_HOUR && d.hour <= END_HOUR);

    const bySlot = {};
    const byDay = {};
    filtered.forEach(d => {
        const slotKey = `${d.hour.toString().padStart(2, '0')}:${(d.minute || 0).toString().padStart(2, '0')}`;
        const val = d.avg_docks || 0;
        if (!bySlot[slotKey]) bySlot[slotKey] = [];
        bySlot[slotKey].push(val);
        if (!byDay[d.weekday]) byDay[d.weekday] = [];
        byDay[d.weekday].push(val);
    });

    const slotAvgs = Object.entries(bySlot).map(([slot, vals]) => ({
        slot, avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    })).sort((a, b) => b.avg - a.avg);

    if (slotAvgs.length > 0) {
        document.getElementById('insight-peak').textContent =
            slotAvgs.slice(0, 3).map(s => s.slot).join(', ');
    }
    const bottom3 = [...slotAvgs].sort((a, b) => a.avg - b.avg).slice(0, 3).map(s => s.slot);
    document.getElementById('insight-low').textContent = bottom3.join(', ');

    const dayAvgs = Object.entries(byDay).map(([d, vals]) => ({
        day: parseInt(d), avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    })).sort((a, b) => a.avg - b.avg);

    if (dayAvgs.length > 0) {
        document.getElementById('insight-busiest').textContent = DAY_NAMES[dayAvgs[0].day];
    }
}

// ------------------------------------------------------------------
// Weather Correlation Stats
// ------------------------------------------------------------------

async function loadCorrelationStats() {
    try {
        const resp = await fetch('/api/correlation-stats');
        const data = await resp.json();

        setCorr('corr-temp', data.temp_corr, 'corr-temp-desc');
        setCorr('corr-rain', data.rain_corr, 'corr-rain-desc');
        setCorr('corr-wind', data.wind_corr, 'corr-wind-desc');
        setCorr('corr-humidity', data.humidity_corr, 'corr-humidity-desc');

        if (data.samples) {
            document.getElementById('sample-badge').textContent =
                `${Number(data.samples).toLocaleString()} samples`;
        }
    } catch (e) {
        console.error('Failed to load correlation stats:', e);
    }
}

function setCorr(elementId, value, descId) {
    const el = document.getElementById(elementId);
    const descEl = descId ? document.getElementById(descId) : null;
    const card = el.closest('.card');

    if (value == null) {
        el.textContent = 'N/A';
        el.className = 'fs-2 fw-bold corr-neutral';
        if (descEl) descEl.textContent = 'Insufficient data';
        if (card) card.className = 'card h-100 corr-card-neutral';
        return;
    }
    const rounded = value.toFixed(3);
    el.textContent = (value > 0 ? '+' : '') + rounded;
    if (value > 0.1) {
        el.className = 'fs-2 fw-bold corr-positive';
        if (card) card.className = 'card h-100 corr-card-positive';
    } else if (value < -0.1) {
        el.className = 'fs-2 fw-bold corr-negative';
        if (card) card.className = 'card h-100 corr-card-negative';
    } else {
        el.className = 'fs-2 fw-bold corr-neutral';
        if (card) card.className = 'card h-100 corr-card-neutral';
    }

    if (descEl) {
        const abs = Math.abs(value);
        let strength;
        if (abs > 0.7) strength = 'Strong';
        else if (abs > 0.4) strength = 'Moderate';
        else if (abs > 0.1) strength = 'Weak';
        else { descEl.textContent = 'No correlation'; return; }
        const direction = value > 0 ? 'positive' : 'negative';
        descEl.textContent = `${strength} ${direction} (r = ${rounded})`;
    }
}

// ------------------------------------------------------------------
// Binned Bar Charts
// ------------------------------------------------------------------

async function loadBinnedCharts() {
    try {
        const resp = await fetch('/api/weather-correlation');
        const data = await resp.json();

        const tempEdges = [], tempLabels = [];
        for (let t = -3; t <= 30; t += 3) {
            tempEdges.push(t); tempLabels.push(`${t}–${t + 3}°C`);
        }
        createBinnedBar('chart-temp', data, 'temperature', 'avg_docks', tempEdges, tempLabels, 'Avg Free Docks');

        const rainEdges = [0, 0.1, 1, 5, 100];
        const rainLabels = ['Dry', 'Light', 'Moderate', 'Heavy'];
        createBinnedBar('chart-rain', data, 'precipitation', 'avg_docks', rainEdges, rainLabels, 'Avg Free Docks');

        const windEdges = [], windLabels = [];
        for (let w = 0; w <= 20; w += 2) {
            windEdges.push(w); windLabels.push(`${w}–${w + 2}`);
        }
        createBinnedBar('chart-wind', data, 'wind_speed', 'avg_docks', windEdges, windLabels, 'Avg Free Docks');

        const humEdges = [], humLabels = [];
        for (let h = 0; h <= 100; h += 10) {
            humEdges.push(h); humLabels.push(`${h}–${h + 10}%`);
        }
        createBinnedBar('chart-humidity', data, 'humidity', 'avg_docks', humEdges, humLabels, 'Avg Free Docks');

        computeWeatherInsights(data);
    } catch (e) {
        console.error('Failed to load weather charts:', e);
    }
}

function binData(data, key, yKey, edges) {
    const bins = new Array(edges.length - 1).fill(null).map(() => ({ sum: 0, count: 0 }));
    data.forEach(d => {
        const x = d[key]; const y = d[yKey];
        if (x == null || y == null) return;
        for (let i = 0; i < edges.length - 1; i++) {
            if (x >= edges[i] && x < edges[i + 1]) {
                bins[i].sum += y; bins[i].count++; break;
            }
        }
    });
    return bins.map(b => b.count > 0 ? { avg: Math.round(b.sum / b.count * 10) / 10, count: b.count } : null);
}

function createBinnedBar(canvasId, data, xKey, yKey, edges, labels, yLabel) {
    const binned = binData(data, xKey, yKey, edges);
    const filteredLabels = [], filteredAvgs = [], filteredCounts = [];
    binned.forEach((b, i) => {
        if (b && b.count >= 3) {
            filteredLabels.push(labels[i]); filteredAvgs.push(b.avg); filteredCounts.push(b.count);
        }
    });
    if (filteredAvgs.length === 0) return;

    const minAvg = Math.min(...filteredAvgs);
    const maxAvg = Math.max(...filteredAvgs);
    const range = maxAvg - minAvg || 1;
    const bgColors = filteredAvgs.map(v => barColor((v - minAvg) / range, 0.7));
    const borderColors = filteredAvgs.map(v => barColor((v - minAvg) / range, 1));

    new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: {
            labels: filteredLabels,
            datasets: [{
                label: yLabel, data: filteredAvgs,
                backgroundColor: bgColors, borderColor: borderColors, borderWidth: 1,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (ctx) => `(${filteredCounts[ctx.dataIndex]} samples)`
                    }
                }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { font: { size: 10 } } },
                y: { title: { display: true, text: yLabel }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
            }
        }
    });
}

function barColor(norm, alpha) {
    let r, g, b;
    if (norm < 0.5) {
        const t = norm * 2;
        r = 220; g = Math.round(53 + t * 140); b = Math.round(69 - t * 62);
    } else {
        const t = (norm - 0.5) * 2;
        r = Math.round(255 - t * 230); g = Math.round(193 - t * 58); b = Math.round(7 + t * 77);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ------------------------------------------------------------------
// Weather Insights
// ------------------------------------------------------------------

function computeWeatherInsights(data) {
    const tempBins = {};
    data.forEach(d => {
        if (d.temperature == null || d.avg_docks == null) return;
        const bin = Math.floor(d.temperature / 3) * 3;
        const label = `${bin}–${bin + 3}°C`;
        if (!tempBins[label]) tempBins[label] = { sum: 0, count: 0 };
        tempBins[label].sum += d.avg_docks; tempBins[label].count++;
    });

    const rainBins = {
        'Dry (0mm)': { sum: 0, count: 0 }, 'Light rain': { sum: 0, count: 0 },
        'Moderate rain': { sum: 0, count: 0 }, 'Heavy rain': { sum: 0, count: 0 }
    };
    data.forEach(d => {
        if (d.precipitation == null || d.avg_docks == null) return;
        let label;
        if (d.precipitation < 0.1) label = 'Dry (0mm)';
        else if (d.precipitation < 1) label = 'Light rain';
        else if (d.precipitation < 5) label = 'Moderate rain';
        else label = 'Heavy rain';
        rainBins[label].sum += d.avg_docks; rainBins[label].count++;
    });

    const allBins = { ...tempBins, ...rainBins };
    let bestLabel = null, bestAvg = -Infinity;
    let worstLabel = null, worstAvg = Infinity;

    for (const [label, b] of Object.entries(allBins)) {
        if (b.count < 5) continue;
        const avg = b.sum / b.count;
        if (avg > bestAvg) { bestAvg = avg; bestLabel = label; }
        if (avg < worstAvg) { worstAvg = avg; worstLabel = label; }
    }

    if (bestLabel) {
        document.getElementById('insight-best').textContent = bestLabel;
        document.getElementById('insight-best-detail').textContent = `~${Math.round(bestAvg)} avg free docks`;
    }
    if (worstLabel) {
        document.getElementById('insight-worst').textContent = worstLabel;
        document.getElementById('insight-worst-detail').textContent = `~${Math.round(worstAvg)} avg free docks`;
    }
}

// ------------------------------------------------------------------
// About Stats
// ------------------------------------------------------------------

async function loadAboutStats() {
    try {
        const resp = await fetch('/api/stats');
        const s = await resp.json();
        document.getElementById('about-stats').innerHTML = `
            <div class="row g-3 text-center">
                <div class="col-sm-4">
                    <div class="fs-3 fw-bold">${(s.bike_rows || 0).toLocaleString()}</div>
                    <div class="small text-body-secondary">Bike data points</div>
                </div>
                <div class="col-sm-4">
                    <div class="fs-3 fw-bold">${(s.weather_rows || 0).toLocaleString()}</div>
                    <div class="small text-body-secondary">Weather data points</div>
                </div>
                <div class="col-sm-4">
                    <div class="fs-3 fw-bold">${s.collection_days || '--'} days</div>
                    <div class="small text-body-secondary">Collection period</div>
                </div>
            </div>
            <div class="mt-3 text-center small text-body-secondary">
                First record: ${s.first_record ? new Date(s.first_record).toLocaleString() : '--'}
                &middot;
                Last record: ${s.last_record ? new Date(s.last_record).toLocaleString() : '--'}
            </div>`;
    } catch (e) {
        document.getElementById('about-stats').innerHTML =
            '<div class="text-danger text-center">Failed to load statistics</div>';
    }
}
