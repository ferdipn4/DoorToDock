/* Door2Dock – Heatmap Visualisation (30-min slots, docks only) */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun display order
const START_HOUR = 7;
const END_HOUR = 20; // last slot is 20:30, so 07:00–20:30 = 28 columns

let allStations = [];
let showCount = 3;

document.addEventListener('DOMContentLoaded', () => {
    loadStations();

    document.querySelectorAll('[data-count]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-count]').forEach(b =>
                b.classList.remove('active'));
            e.target.classList.add('active');
            showCount = parseInt(e.target.dataset.count);
            loadHeatmap();
        });
    });
});

async function loadStations() {
    try {
        const resp = await fetch('/api/stations');
        allStations = await resp.json();
        loadHeatmap();
    } catch (e) {
        console.error('Failed to load stations:', e);
    }
}

function getTopStationIds(n) {
    // Stations come sorted by walking_distance_m from the API
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
    // 07:00, 07:30, 08:00, ... 20:30  →  28 slots
    const slots = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
        slots.push({ hour: h, minute: 0 });
        slots.push({ hour: h, minute: 30 });
    }
    return slots;
}

function renderHeatmap(data) {
    const slots = buildSlots(); // 28 slots

    // Build lookup: { weekday: { "h:m": avg_docks } }
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

    // Filter to 07-21 range (already done by API but be safe)
    const filtered = data.filter(d => d.hour >= START_HOUR && d.hour <= END_HOUR);

    // Group by slot (hour:minute)
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

    // Best slots (highest average)
    const slotAvgs = Object.entries(bySlot).map(([slot, vals]) => ({
        slot,
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    })).sort((a, b) => b.avg - a.avg);

    if (slotAvgs.length > 0) {
        const top3 = slotAvgs.slice(0, 3).map(s => s.slot);
        document.getElementById('insight-peak').textContent = top3.join(', ');
    }

    // Worst slots
    const bottom3 = [...slotAvgs].sort((a, b) => a.avg - b.avg)
        .slice(0, 3).map(s => s.slot);
    document.getElementById('insight-low').textContent = bottom3.join(', ');

    // Day with lowest average (hardest to find docks)
    const dayAvgs = Object.entries(byDay).map(([d, vals]) => ({
        day: parseInt(d),
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    })).sort((a, b) => a.avg - b.avg);

    if (dayAvgs.length > 0) {
        document.getElementById('insight-busiest').textContent =
            DAY_NAMES[dayAvgs[0].day];
    }
}
