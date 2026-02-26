/* Door2Dock – Time Series Charts */

let bikesChart, docksChart;
let currentStation = '';
let currentHours = 24;

document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    loadStations();

    // Station selector
    document.getElementById('station-select').addEventListener('change', (e) => {
        currentStation = e.target.value;
        if (currentStation) loadTimeSeries();
    });

    // Time range buttons
    document.querySelectorAll('[data-hours]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-hours]').forEach(b =>
                b.classList.remove('active'));
            e.target.classList.add('active');
            currentHours = parseInt(e.target.dataset.hours);
            if (currentStation) loadTimeSeries();
        });
    });
});

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
            }
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
            }
        });
    };
    document.head.appendChild(script);
}

async function loadStations() {
    try {
        const resp = await fetch('/api/stations');
        const stations = await resp.json();
        const select = document.getElementById('station-select');
        select.innerHTML = '<option value="">Select a station...</option>';
        stations.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.station_id;
            opt.textContent = `${s.station_name} (${s.distance_m}m)`;
            select.appendChild(opt);
        });

        // Auto-select first station
        if (stations.length > 0) {
            currentStation = stations[0].station_id;
            select.value = currentStation;
            loadTimeSeries();
        }
    } catch (e) {
        console.error('Failed to load stations:', e);
    }
}

async function loadTimeSeries() {
    if (!currentStation || !bikesChart) return;

    try {
        const resp = await fetch(
            `/api/timeseries/${currentStation}?hours=${currentHours}`);
        const data = await resp.json();

        const timestamps = data.map(d => d.timestamp);
        const bikes = data.map(d => d.available_bikes);
        const ebikes = data.map(d => d.ebikes);
        const standard = data.map(d => d.standard_bikes);
        const docks = data.map(d => d.empty_docks);

        bikesChart.data = {
            labels: timestamps,
            datasets: [
                {
                    label: 'Total Bikes',
                    data: bikes,
                    borderColor: '#0d6efd',
                    backgroundColor: 'rgba(13, 110, 253, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2,
                },
                {
                    label: 'Standard',
                    data: standard,
                    borderColor: '#20c997',
                    backgroundColor: 'transparent',
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    borderDash: [4, 2],
                },
                {
                    label: 'E-Bikes',
                    data: ebikes,
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

        docksChart.data = {
            labels: timestamps,
            datasets: [{
                label: 'Empty Docks',
                data: docks,
                borderColor: '#198754',
                backgroundColor: 'rgba(25, 135, 84, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
            }]
        };
        docksChart.update();

    } catch (e) {
        console.error('Failed to load time series:', e);
    }
}
