/* Door2Dock – Weather Correlation Charts */

document.addEventListener('DOMContentLoaded', () => {
    loadCorrelationStats();
    loadScatterPlots();
});

async function loadCorrelationStats() {
    try {
        const resp = await fetch('/api/correlation-stats');
        const data = await resp.json();

        setCorr('corr-temp', data.temp_corr);
        setCorr('corr-rain', data.rain_corr);
        setCorr('corr-wind', data.wind_corr);
        setCorr('corr-humidity', data.humidity_corr);
    } catch (e) {
        console.error('Failed to load correlation stats:', e);
    }
}

function setCorr(elementId, value) {
    const el = document.getElementById(elementId);
    if (value == null) {
        el.textContent = 'N/A';
        el.className = 'fs-2 fw-bold corr-neutral';
        return;
    }
    const rounded = value.toFixed(3);
    el.textContent = (value > 0 ? '+' : '') + rounded;
    if (value > 0.1) el.className = 'fs-2 fw-bold corr-positive';
    else if (value < -0.1) el.className = 'fs-2 fw-bold corr-negative';
    else el.className = 'fs-2 fw-bold corr-neutral';
}

async function loadScatterPlots() {
    try {
        const resp = await fetch('/api/weather-correlation');
        const data = await resp.json();

        createScatter('chart-temp', data, 'temperature', 'avg_bikes',
            'Temperature (°C)', 'Avg Available Bikes', '#ff6384');
        createScatter('chart-rain', data, 'precipitation', 'avg_bikes',
            'Precipitation (mm/h)', 'Avg Available Bikes', '#36a2eb');
        createScatter('chart-wind', data, 'wind_speed', 'avg_bikes',
            'Wind Speed (m/s)', 'Avg Available Bikes', '#4bc0c0');
        createScatter('chart-humidity', data, 'humidity', 'avg_bikes',
            'Humidity (%)', 'Avg Available Bikes', '#9966ff');

    } catch (e) {
        console.error('Failed to load scatter plots:', e);
    }
}

function createScatter(canvasId, data, xKey, yKey, xLabel, yLabel, color) {
    const points = data
        .filter(d => d[xKey] != null && d[yKey] != null)
        .map(d => ({ x: d[xKey], y: d[yKey] }));

    // Compute trend line (linear regression)
    const trend = linearRegression(points);

    const datasets = [{
        label: yLabel,
        data: points,
        backgroundColor: color + '66',
        borderColor: color,
        pointRadius: 2.5,
        pointHoverRadius: 5,
    }];

    // Add trend line if we have enough points
    if (trend && points.length > 2) {
        const xVals = points.map(p => p.x);
        const xMin = Math.min(...xVals);
        const xMax = Math.max(...xVals);
        datasets.push({
            label: 'Trend',
            data: [
                { x: xMin, y: trend.slope * xMin + trend.intercept },
                { x: xMax, y: trend.slope * xMax + trend.intercept },
            ],
            type: 'line',
            borderColor: '#ffffff88',
            borderWidth: 2,
            borderDash: [6, 3],
            pointRadius: 0,
            fill: false,
        });
    }

    new Chart(document.getElementById(canvasId), {
        type: 'scatter',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) =>
                            `${xLabel}: ${ctx.parsed.x} · ${yLabel}: ${ctx.parsed.y}`
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: xLabel },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                },
                y: {
                    title: { display: true, text: yLabel },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    beginAtZero: true,
                }
            }
        }
    });
}

function linearRegression(points) {
    const n = points.length;
    if (n < 2) return null;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const p of points) {
        sumX += p.x;
        sumY += p.y;
        sumXY += p.x * p.y;
        sumX2 += p.x * p.x;
    }

    const denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return null;

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
}
