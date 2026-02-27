/* Door2Dock – Weather Correlation (Binned Bar Charts) */

document.addEventListener('DOMContentLoaded', () => {
    loadCorrelationStats();
    loadBinnedCharts();

    setInterval(() => {
        loadCorrelationStats();
    }, 60000);
});

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
// Binned bar charts
// ------------------------------------------------------------------

async function loadBinnedCharts() {
    try {
        const resp = await fetch('/api/weather-correlation');
        const data = await resp.json();

        // Temperature bins: 3°C steps
        const tempEdges = [];
        const tempLabels = [];
        for (let t = -3; t <= 30; t += 3) {
            tempEdges.push(t);
            tempLabels.push(`${t}–${t + 3}°C`);
        }
        createBinnedBar('chart-temp', data, 'temperature', 'avg_bikes',
            tempEdges, tempLabels, 'Avg Available Bikes');

        // Precipitation bins: categorical
        const rainEdges = [0, 0.1, 1, 5, 100];
        const rainLabels = ['Dry', 'Light', 'Moderate', 'Heavy'];
        createBinnedBar('chart-rain', data, 'precipitation', 'avg_bikes',
            rainEdges, rainLabels, 'Avg Available Bikes');

        // Wind bins: 2 m/s steps
        const windEdges = [];
        const windLabels = [];
        for (let w = 0; w <= 20; w += 2) {
            windEdges.push(w);
            windLabels.push(`${w}–${w + 2}`);
        }
        createBinnedBar('chart-wind', data, 'wind_speed', 'avg_bikes',
            windEdges, windLabels, 'Avg Available Bikes');

        // Humidity bins: 10% steps
        const humEdges = [];
        const humLabels = [];
        for (let h = 0; h <= 100; h += 10) {
            humEdges.push(h);
            humLabels.push(`${h}–${h + 10}%`);
        }
        createBinnedBar('chart-humidity', data, 'humidity', 'avg_bikes',
            humEdges, humLabels, 'Avg Available Bikes');

        computeWeatherInsights(data);
    } catch (e) {
        console.error('Failed to load weather charts:', e);
    }
}

function binData(data, key, yKey, edges) {
    // Each bin covers [edges[i], edges[i+1])
    const bins = new Array(edges.length - 1).fill(null).map(() => ({ sum: 0, count: 0 }));

    data.forEach(d => {
        const x = d[key];
        const y = d[yKey];
        if (x == null || y == null) return;
        for (let i = 0; i < edges.length - 1; i++) {
            if (x >= edges[i] && x < edges[i + 1]) {
                bins[i].sum += y;
                bins[i].count++;
                break;
            }
        }
    });

    return bins.map(b => b.count > 0
        ? { avg: Math.round(b.sum / b.count * 10) / 10, count: b.count }
        : null);
}

function createBinnedBar(canvasId, data, xKey, yKey, edges, labels, yLabel) {
    const binned = binData(data, xKey, yKey, edges);

    // Filter out empty bins
    const filteredLabels = [];
    const filteredAvgs = [];
    const filteredCounts = [];
    binned.forEach((b, i) => {
        if (b && b.count >= 3) {
            filteredLabels.push(labels[i]);
            filteredAvgs.push(b.avg);
            filteredCounts.push(b.count);
        }
    });

    if (filteredAvgs.length === 0) return;

    // Color bars: green for high values, red for low
    const minAvg = Math.min(...filteredAvgs);
    const maxAvg = Math.max(...filteredAvgs);
    const range = maxAvg - minAvg || 1;

    const bgColors = filteredAvgs.map(v => {
        const norm = (v - minAvg) / range;
        return barColor(norm, 0.7);
    });
    const borderColors = filteredAvgs.map(v => {
        const norm = (v - minAvg) / range;
        return barColor(norm, 1);
    });

    new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: {
            labels: filteredLabels,
            datasets: [{
                label: yLabel,
                data: filteredAvgs,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 1,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (ctx) => {
                            const count = filteredCounts[ctx.dataIndex];
                            return `(${count} samples)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { font: { size: 10 } },
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

function barColor(norm, alpha) {
    // Red (low bikes) -> Yellow (mid) -> Green (high bikes)
    let r, g, b;
    if (norm < 0.5) {
        const t = norm * 2;
        r = 220;
        g = Math.round(53 + t * 140);
        b = Math.round(69 - t * 62);
    } else {
        const t = (norm - 0.5) * 2;
        r = Math.round(255 - t * 230);
        g = Math.round(193 - t * 58);
        b = Math.round(7 + t * 77);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ------------------------------------------------------------------
// Best / Worst insights
// ------------------------------------------------------------------

function computeWeatherInsights(data) {
    // Bin temperature by 3°C
    const tempBins = {};
    data.forEach(d => {
        if (d.temperature == null || d.avg_bikes == null) return;
        const bin = Math.floor(d.temperature / 3) * 3;
        const label = `${bin}–${bin + 3}°C`;
        if (!tempBins[label]) tempBins[label] = { sum: 0, count: 0 };
        tempBins[label].sum += d.avg_bikes;
        tempBins[label].count++;
    });

    // Bin precipitation categorically
    const rainBins = { 'Dry (0mm)': { sum: 0, count: 0 }, 'Light rain': { sum: 0, count: 0 },
        'Moderate rain': { sum: 0, count: 0 }, 'Heavy rain': { sum: 0, count: 0 } };
    data.forEach(d => {
        if (d.precipitation == null || d.avg_bikes == null) return;
        let label;
        if (d.precipitation < 0.1) label = 'Dry (0mm)';
        else if (d.precipitation < 1) label = 'Light rain';
        else if (d.precipitation < 5) label = 'Moderate rain';
        else label = 'Heavy rain';
        rainBins[label].sum += d.avg_bikes;
        rainBins[label].count++;
    });

    // Find best/worst across all factors
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
        document.getElementById('insight-best-detail').textContent =
            `~${Math.round(bestAvg)} avg bikes available`;
    }
    if (worstLabel) {
        document.getElementById('insight-worst').textContent = worstLabel;
        document.getElementById('insight-worst-detail').textContent =
            `~${Math.round(worstAvg)} avg bikes available`;
    }
}
