/* Door2Dock – Time Series Charts */

let bikesChart, docksChart;
let allStations = [];
let currentStation = '';
let currentHours = 24;
let showCount = 3;

const STATION_COLORS = [
    '#42a5f5', '#66bb6a', '#ffa726', '#ef5350', '#ab47bc',
    '#26c6da', '#8d6e63', '#78909c', '#d4e157', '#ec407a',
];

document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    loadStations();

    // Station selector
    document.getElementById('station-select').addEventListener('change', (e) => {
        currentStation = e.target.value;
        loadAllTimeSeries();
    });

    // Time range buttons
    document.querySelectorAll('[data-hours]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-hours]').forEach(b =>
                b.classList.remove('active'));
            e.target.classList.add('active');
            currentHours = parseInt(e.target.dataset.hours);
            loadAllTimeSeries();
        });
    });

    // Show count buttons
    document.querySelectorAll('.ts-show-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.ts-show-btn').forEach(b =>
                b.classList.remove('active'));
            e.target.classList.add('active');
            showCount = parseInt(e.target.dataset.show);
            loadAllTimeSeries();
        });
    });

    // Auto-refresh every 60 seconds
    setInterval(() => {
        if (currentStation || showCount > 1) loadAllTimeSeries();
    }, 60000);
});

// Crosshair plugin – draws a vertical line at hover position
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

function initCharts() {
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
                    },
                    label: (ctx) => {
                        const val = ctx.parsed.y;
                        const suffix = ctx.chart.options.scales.y.max === 100 ? '%' : '';
                        return `${ctx.dataset.label}: ${val}${suffix}`;
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
            }
        }
    };

    // Need the date adapter
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3';
    script.onload = () => {
        bikesChart = new Chart(document.getElementById('chart-bikes'), {
            type: 'line',
            data: { datasets: [] },
            options: {
                ...commonOpts,
                plugins: {
                    ...commonOpts.plugins,
                    legend: { position: 'top' },
                },
                scales: {
                    ...commonOpts.scales,
                    y: { ...commonOpts.scales.y, title: { display: true, text: 'Bikes' } }
                }
            },
            plugins: [crosshairPlugin],
        });

        docksChart = new Chart(document.getElementById('chart-docks'), {
            type: 'line',
            data: { datasets: [] },
            options: {
                ...commonOpts,
                scales: {
                    ...commonOpts.scales,
                    y: { ...commonOpts.scales.y, title: { display: true, text: 'Empty Docks' } }
                }
            },
            plugins: [crosshairPlugin],
        });
    };
    document.head.appendChild(script);
}

async function loadStations() {
    try {
        const resp = await fetch('/api/stations');
        allStations = await resp.json();
        const select = document.getElementById('station-select');
        select.innerHTML = '<option value="">All (by nearest)</option>';
        allStations.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.station_id;
            const walkMin = Math.round((s.walking_duration_s || 0) / 60);
            opt.textContent = `${s.station_name} (${walkMin} min walk)`;
            select.appendChild(opt);
        });

        // Load initial multi-station view
        loadAllTimeSeries();
    } catch (e) {
        console.error('Failed to load stations:', e);
    }
}

function getStationsToShow() {
    if (currentStation) {
        // Single station selected
        return allStations.filter(s => s.station_id === currentStation);
    }
    // Nearest N by walking distance
    return allStations.slice(0, showCount);
}

async function loadAllTimeSeries() {
    if (!bikesChart) return;

    const stations = getStationsToShow();
    if (stations.length === 0) return;

    // Fetch all in parallel
    const fetches = stations.map(s =>
        fetch(`/api/timeseries/${s.station_id}?hours=${currentHours}`)
            .then(r => r.json())
            .then(data => ({ station: s, data }))
            .catch(() => ({ station: s, data: [] }))
    );
    const results = await Promise.all(fetches);

    const isSingle = results.length === 1;

    // Build bike datasets
    const bikeDatasets = [];
    const dockDatasets = [];

    results.forEach((r, i) => {
        const color = STATION_COLORS[i % STATION_COLORS.length];
        const shortName = r.station.station_name.split(',')[0];
        const timestamps = r.data.map(d => d.timestamp);
        const bikes = r.data.map(d => d.available_bikes);
        const standard = r.data.map(d => d.standard_bikes);
        const ebikes = r.data.map(d => d.ebikes);
        const docks = r.data.map(d => d.empty_docks);

        if (isSingle) {
            // Single station: show absolute values with breakdown
            bikeDatasets.push({
                label: 'Total Bikes',
                data: timestamps.map((t, j) => ({ x: t, y: bikes[j] })),
                borderColor: '#0d6efd',
                backgroundColor: 'rgba(13, 110, 253, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
            });
            bikeDatasets.push({
                label: 'Standard',
                data: timestamps.map((t, j) => ({ x: t, y: standard[j] })),
                borderColor: '#20c997',
                backgroundColor: 'transparent',
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 1.5,
                borderDash: [4, 2],
            });
            bikeDatasets.push({
                label: 'E-Bikes',
                data: timestamps.map((t, j) => ({ x: t, y: ebikes[j] })),
                borderColor: '#ffc107',
                backgroundColor: 'transparent',
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 1.5,
                borderDash: [4, 2],
            });
            dockDatasets.push({
                label: 'Empty Docks',
                data: timestamps.map((t, j) => ({ x: t, y: docks[j] })),
                borderColor: '#198754',
                backgroundColor: 'rgba(25, 135, 84, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
            });
        } else {
            // Multi-station: normalized to % of capacity
            bikeDatasets.push({
                label: shortName,
                data: timestamps.map((t, j) => {
                    const total = (bikes[j] || 0) + (docks[j] || 0);
                    const pct = total > 0 ? Math.round(bikes[j] / total * 100) : 0;
                    return { x: t, y: pct };
                }),
                borderColor: color,
                backgroundColor: 'transparent',
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
            });
            dockDatasets.push({
                label: shortName,
                data: timestamps.map((t, j) => {
                    const total = (bikes[j] || 0) + (docks[j] || 0);
                    const pct = total > 0 ? Math.round(docks[j] / total * 100) : 0;
                    return { x: t, y: pct };
                }),
                borderColor: color,
                backgroundColor: color + '1A',
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
            });
        }
    });

    // Update titles and Y-axis labels based on mode
    const yLabel = isSingle ? 'Bikes' : '% of Capacity';
    const yLabelDocks = isSingle ? 'Empty Docks' : '% Free Docks';
    const yMax = isSingle ? undefined : 100;

    document.getElementById('chart-bikes-title').textContent =
        isSingle ? 'Bike Availability Over Time' : 'Bike Availability (% of Capacity)';
    document.getElementById('chart-docks-title').textContent =
        isSingle ? 'Empty Docks Over Time' : 'Free Docks (% of Capacity)';

    bikesChart.options.scales.y.title.text = yLabel;
    bikesChart.options.scales.y.max = yMax;
    bikesChart.data = { datasets: bikeDatasets };
    bikesChart.update();

    docksChart.options.scales.y.title.text = yLabelDocks;
    docksChart.options.scales.y.max = yMax;
    docksChart.data = { datasets: dockDatasets };
    docksChart.update();

    // Summary stats for the first (or only) station
    if (results.length > 0 && results[0].data.length > 0) {
        const docks = results[0].data.map(d => d.empty_docks);
        updateSummary(docks);
    } else {
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
