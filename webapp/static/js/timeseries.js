/* Door2Dock – Time Series Charts (single station, absolute values) */

let bikesChart, docksChart;
let allStations = [];
let currentStation = '';
let currentHours = 24;

document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    loadStations();

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

    setInterval(() => {
        if (currentStation) loadTimeSeries();
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

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3';
    script.onload = () => {
        docksChart = new Chart(document.getElementById('chart-docks'), {
            type: 'line',
            data: { datasets: [] },
            options: {
                ...commonOpts,
                scales: {
                    ...commonOpts.scales,
                    y: { ...commonOpts.scales.y, title: { display: true, text: 'Free Docks' } }
                }
            },
            plugins: [crosshairPlugin],
        });

        bikesChart = new Chart(document.getElementById('chart-bikes'), {
            type: 'line',
            data: { datasets: [] },
            options: {
                ...commonOpts,
                scales: {
                    ...commonOpts.scales,
                    y: { ...commonOpts.scales.y, title: { display: true, text: 'Bikes' } }
                }
            },
            plugins: [crosshairPlugin],
        });

        // Load data for first station once charts are ready
        if (currentStation) loadTimeSeries();
    };
    document.head.appendChild(script);
}

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

        // Auto-select nearest station
        if (allStations.length > 0) {
            currentStation = allStations[0].station_id;
            select.value = currentStation;
            loadTimeSeries();
        }
    } catch (e) {
        console.error('Failed to load stations:', e);
    }
}

async function loadTimeSeries() {
    if (!docksChart || !currentStation) return;

    try {
        const resp = await fetch(`/api/timeseries/${currentStation}?hours=${currentHours}`);
        const data = await resp.json();

        const timestamps = data.map(d => d.timestamp);
        const bikes = data.map(d => d.available_bikes);
        const standard = data.map(d => d.standard_bikes);
        const ebikes = data.map(d => d.ebikes);
        const docks = data.map(d => d.empty_docks);

        // Docks chart (primary)
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

        // Bikes chart
        bikesChart.data = {
            datasets: [
                {
                    label: 'Total Bikes',
                    data: timestamps.map((t, j) => ({ x: t, y: bikes[j] })),
                    borderColor: '#0d6efd',
                    backgroundColor: 'rgba(13, 110, 253, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2,
                },
                {
                    label: 'Standard',
                    data: timestamps.map((t, j) => ({ x: t, y: standard[j] })),
                    borderColor: '#20c997',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    borderDash: [4, 2],
                },
                {
                    label: 'E-Bikes',
                    data: timestamps.map((t, j) => ({ x: t, y: ebikes[j] })),
                    borderColor: '#ffc107',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    borderDash: [4, 2],
                },
            ]
        };
        bikesChart.update();

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
