/* Door2Dock – Trends (Time Series + Heatmap merged) */

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

    document.getElementById('station-select').addEventListener('change', (e) => {
        currentStation = e.target.value;
        loadTimeSeries();
    });

    document.querySelectorAll('[data-hours]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-hours]').forEach(b =>
                b.classList.remove('active'));
            e.target.classList.add('active');
            currentHours = parseInt(e.target.dataset.hours);
            loadTimeSeries();
        });
    });

    document.querySelectorAll('[data-count]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-count]').forEach(b =>
                b.classList.remove('active'));
            e.target.classList.add('active');
            showCount = parseInt(e.target.dataset.count);
            loadHeatmap();
        });
    });

    setInterval(() => {
        if (currentStation) loadTimeSeries();
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
// Load stations (shared between time series + heatmap)
// ------------------------------------------------------------------

async function loadStations() {
    try {
        const resp = await fetch('/api/stations');
        allStations = await resp.json();

        // Populate station dropdown
        const select = document.getElementById('station-select');
        select.innerHTML = '<option value="">Select a station...</option>';
        allStations.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.station_id;
            const walkMin = Math.round((s.walking_duration_s || 0) / 60);
            opt.textContent = `${s.station_name} (${walkMin} min walk)`;
            select.appendChild(opt);
        });

        // Auto-select nearest station
        if (allStations.length > 0) {
            currentStation = allStations[0].station_id;
            select.value = currentStation;
            loadTimeSeries();
        }

        // Load heatmap with top stations
        loadHeatmap();
    } catch (e) {
        console.error('Failed to load stations:', e);
    }
}

// Kick off station loading
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
        computeInsights(data);
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

    // Header row
    html += '<div class="heatmap-header"></div>';
    slots.forEach(s => {
        const label = s.minute === 0
            ? `${s.hour.toString().padStart(2, '0')}`
            : '';
        html += `<div class="heatmap-header">${label}</div>`;
    });

    // Data rows: Mon-Sun
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
        r = 220;
        g = Math.round(53 + t * (193 - 53));
        b = Math.round(69 + t * (7 - 69));
    } else {
        const t = (norm - 0.5) * 2;
        r = Math.round(255 - t * (255 - 25));
        g = Math.round(193 + t * (135 - 193));
        b = Math.round(7 + t * (84 - 7));
    }
    return `rgb(${r}, ${g}, ${b})`;
}

function computeInsights(data) {
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
        slot,
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    })).sort((a, b) => b.avg - a.avg);

    if (slotAvgs.length > 0) {
        const top3 = slotAvgs.slice(0, 3).map(s => s.slot);
        document.getElementById('insight-peak').textContent = top3.join(', ');
    }

    const bottom3 = [...slotAvgs].sort((a, b) => a.avg - b.avg)
        .slice(0, 3).map(s => s.slot);
    document.getElementById('insight-low').textContent = bottom3.join(', ');

    const dayAvgs = Object.entries(byDay).map(([d, vals]) => ({
        day: parseInt(d),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    })).sort((a, b) => a.avg - b.avg);

    if (dayAvgs.length > 0) {
        document.getElementById('insight-busiest').textContent =
            DAY_NAMES[dayAvgs[0].day];
    }
}
