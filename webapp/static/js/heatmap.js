/* Door2Dock – Heatmap Visualisation */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun display order
let currentMetric = 'avg_docks';

document.addEventListener('DOMContentLoaded', () => {
    loadStations();
    loadHeatmap();

    document.getElementById('station-select').addEventListener('change', () => {
        loadHeatmap();
    });

    document.querySelectorAll('[data-metric]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-metric]').forEach(b =>
                b.classList.remove('active'));
            e.target.classList.add('active');
            currentMetric = e.target.dataset.metric;
            loadHeatmap();
        });
    });
});

async function loadStations() {
    try {
        const resp = await fetch('/api/stations');
        const stations = await resp.json();
        const select = document.getElementById('station-select');
        stations.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.station_id;
            const walkMin = Math.round((s.walking_duration_s || 0) / 60);
            opt.textContent = `${s.station_name} (${walkMin} min walk)`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('Failed to load stations:', e);
    }
}

async function loadHeatmap() {
    const stationId = document.getElementById('station-select').value;
    const url = stationId
        ? `/api/heatmap?station_id=${encodeURIComponent(stationId)}`
        : '/api/heatmap';

    try {
        const resp = await fetch(url);
        const data = await resp.json();
        renderHeatmap(data);
        computeInsights(data);
    } catch (e) {
        console.error('Failed to load heatmap:', e);
        document.getElementById('heatmap-grid').innerHTML =
            '<div class="text-danger text-center py-5">Failed to load heatmap data</div>';
    }
}

function renderHeatmap(data) {
    const title = currentMetric === 'avg_bikes'
        ? 'Average Available Bikes' : 'Average Empty Docks';
    document.getElementById('heatmap-title').textContent = title;

    // Build lookup: { weekday: { hour: value } }
    const grid = {};
    let minVal = Infinity, maxVal = -Infinity;

    data.forEach(d => {
        const day = d.weekday;
        const hour = d.hour;
        const val = d[currentMetric] || 0;
        if (!grid[day]) grid[day] = {};
        grid[day][hour] = val;
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
    });

    if (minVal === Infinity) minVal = 0;
    if (maxVal === -Infinity) maxVal = 1;
    const range = maxVal - minVal || 1;

    // Build HTML
    let html = '<div class="heatmap-grid">';

    // Header row: empty corner + hours 0-23
    html += '<div class="heatmap-header"></div>';
    for (let h = 0; h < 24; h++) {
        html += `<div class="heatmap-header">${h.toString().padStart(2, '0')}</div>`;
    }

    // Data rows: Mon-Sun
    DAY_ORDER.forEach(day => {
        html += `<div class="heatmap-row-label">${DAY_NAMES[day]}</div>`;
        for (let h = 0; h < 24; h++) {
            const val = (grid[day] && grid[day][h]) || 0;
            const norm = (val - minVal) / range; // 0 to 1
            const color = heatmapColor(norm);
            const textColor = norm > 0.5 ? '#000' : '#fff';

            html += `<div class="heatmap-cell"
                style="background-color: ${color}; color: ${textColor};"
                title="${DAY_NAMES[day]} ${h}:00 – ${val}">${val}</div>`;
        }
    });

    html += '</div>';
    document.getElementById('heatmap-grid').innerHTML = html;
}

function heatmapColor(norm) {
    // Red (low) -> Yellow (mid) -> Green (high)
    let r, g, b;
    if (norm < 0.5) {
        // Red to Yellow
        const t = norm * 2;
        r = 220;
        g = Math.round(53 + t * (193 - 53));
        b = Math.round(69 + t * (7 - 69));
    } else {
        // Yellow to Green
        const t = (norm - 0.5) * 2;
        r = Math.round(255 - t * (255 - 25));
        g = Math.round(193 + t * (135 - 193));
        b = Math.round(7 + t * (84 - 7));
    }
    return `rgb(${r}, ${g}, ${b})`;
}

function computeInsights(data) {
    if (!data.length) return;

    // Update insight labels based on metric
    const isDocks = currentMetric === 'avg_docks';
    document.getElementById('insight-peak-label').textContent =
        isDocks ? 'Best Hours (Most Docks)' : 'Peak Hours (Most Bikes)';
    document.getElementById('insight-low-label').textContent =
        isDocks ? 'Worst Hours (Fewest Docks)' : 'Low Hours (Fewest Bikes)';
    document.getElementById('insight-busiest-label').textContent =
        isDocks ? 'Hardest Day to Dock' : 'Busiest Day';

    // Group by hour
    const byHour = {};
    const byDay = {};
    data.forEach(d => {
        const val = d[currentMetric] || 0;
        if (!byHour[d.hour]) byHour[d.hour] = [];
        byHour[d.hour].push(val);
        if (!byDay[d.weekday]) byDay[d.weekday] = [];
        byDay[d.weekday].push(val);
    });

    // Peak hours (highest average)
    const hourAvgs = Object.entries(byHour).map(([h, vals]) => ({
        hour: parseInt(h),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    })).sort((a, b) => b.avg - a.avg);

    if (hourAvgs.length > 0) {
        const top3 = hourAvgs.slice(0, 3).map(h =>
            `${h.hour.toString().padStart(2, '0')}:00`);
        document.getElementById('insight-peak').textContent = top3.join(', ');
    }

    // Low hours
    const bottom3 = [...hourAvgs].sort((a, b) => a.avg - b.avg)
        .slice(0, 3).map(h => `${h.hour.toString().padStart(2, '0')}:00`);
    document.getElementById('insight-low').textContent = bottom3.join(', ');

    // Day with lowest average (hardest to find docks / busiest for bikes)
    const dayAvgs = Object.entries(byDay).map(([d, vals]) => ({
        day: parseInt(d),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    })).sort((a, b) => a.avg - b.avg);

    if (dayAvgs.length > 0) {
        document.getElementById('insight-busiest').textContent =
            DAY_NAMES[dayAvgs[0].day];
    }
}
