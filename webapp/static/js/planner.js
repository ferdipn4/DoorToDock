/* Door2Dock – Morning Commute Planner */

const FAVORITES_KEY = 'door2dock_favorites';
let allStations = [];
let timelineChart = null;
let altChart = null;

// ------------------------------------------------------------------
// Favorites (localStorage)
// ------------------------------------------------------------------

function getFavorites() {
    try {
        return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
    } catch {
        return new Set();
    }
}

function saveFavorites(favSet) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favSet]));
}

function toggleFavorite(stationId) {
    const favs = getFavorites();
    if (favs.has(stationId)) {
        favs.delete(stationId);
    } else {
        favs.add(stationId);
    }
    saveFavorites(favs);
    renderFavoriteList();
}

// ------------------------------------------------------------------
// Station list
// ------------------------------------------------------------------

async function loadStations() {
    try {
        const resp = await fetch('/api/stations');
        allStations = await resp.json();
        renderFavoriteList();
    } catch (e) {
        console.error('Failed to load stations:', e);
    }
}

function renderFavoriteList() {
    const container = document.getElementById('fav-station-list');
    const favs = getFavorites();

    // Sort: favorites first, then by name
    const sorted = [...allStations].sort((a, b) => {
        const aFav = favs.has(a.station_id) ? 0 : 1;
        const bFav = favs.has(b.station_id) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        return (a.walking_distance_m || 9999) - (b.walking_distance_m || 9999);
    });

    container.innerHTML = sorted.map(s => {
        const isFav = favs.has(s.station_id);
        const dist = Math.round(s.walking_distance_m || 0);
        return `
        <div class="fav-station-item ${isFav ? 'fav-active' : ''}"
             onclick="toggleFavorite('${s.station_id}')">
            <i class="bi ${isFav ? 'bi-star-fill text-warning' : 'bi-star'} me-2"></i>
            <span class="flex-grow-1 small">${s.station_name}</span>
            <span class="text-body-secondary small">${dist}m</span>
        </div>`;
    }).join('');
}

// ------------------------------------------------------------------
// Scan
// ------------------------------------------------------------------

async function runScan() {
    const btn = document.getElementById('scan-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Scanning...';

    try {
        const dateVal = document.getElementById('scan-date').value;
        const startTime = document.getElementById('scan-start').value;
        const endTime = document.getElementById('scan-end').value;

        // Convert HH:MM to float
        const startHour = timeToFloat(startTime);
        const endHour = timeToFloat(endTime);

        const favs = getFavorites();
        const stationIds = [...favs].join(',');

        const params = new URLSearchParams({
            date: dateVal,
            start: startHour,
            end: endHour,
        });
        if (stationIds) params.set('stations', stationIds);

        const resp = await fetch(`/api/commute-scan?${params}`);
        const data = await resp.json();

        if (!data.available) {
            showRecommendation(null);
            return;
        }

        renderWeatherForecast(data.weather_forecast);
        renderTimeline(data.favorites, 'timeline-chart', 'timeline-empty');
        renderTimeline(data.alternatives, 'alt-chart', 'alt-empty');
        showRecommendation(data.recommendation);
    } catch (e) {
        console.error('Scan error:', e);
        showRecommendation(null);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-search"></i> Scan';
    }
}

function timeToFloat(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h + m / 60;
}

// ------------------------------------------------------------------
// Recommendation
// ------------------------------------------------------------------

function showRecommendation(rec) {
    const card = document.getElementById('recommendation-card');
    const timeEl = document.getElementById('rec-time');
    const reasonEl = document.getElementById('rec-reason');

    // Remove previous urgency classes
    card.classList.remove('rec-green', 'rec-yellow', 'rec-red');

    if (!rec) {
        timeEl.textContent = '--:--';
        reasonEl.textContent = 'No prediction available';
        return;
    }

    timeEl.textContent = rec.arrive_by;
    reasonEl.textContent = rec.reason;
    card.classList.add(`rec-${rec.urgency}`);
}

// ------------------------------------------------------------------
// Weather Forecast
// ------------------------------------------------------------------

function renderWeatherForecast(weatherData) {
    const container = document.getElementById('weather-forecast');
    if (!weatherData || Object.keys(weatherData).length === 0) {
        container.innerHTML = '<div class="text-body-secondary small">No forecast data available</div>';
        return;
    }

    const hours = Object.keys(weatherData).map(Number).sort((a, b) => a - b);
    container.innerHTML = hours.map(h => {
        const w = weatherData[h] || weatherData[String(h)];
        if (!w) return '';
        const temp = w.temperature != null ? Math.round(w.temperature) : '?';
        const precip = w.precipitation != null ? w.precipitation : 0;
        const wind = w.wind_speed != null ? Math.round(w.wind_speed) : '?';
        const icon = precip > 0 ? 'bi-cloud-rain' : 'bi-sun';
        return `
        <div class="weather-hour-item">
            <span class="fw-bold">${String(h).padStart(2, '0')}:00</span>
            <span><i class="bi ${icon}"></i> ${temp}°C</span>
            <span class="text-body-secondary">${wind} km/h</span>
            ${precip > 0 ? `<span class="text-info">${precip}mm</span>` : ''}
        </div>`;
    }).join('');
}

// ------------------------------------------------------------------
// Timeline Charts
// ------------------------------------------------------------------

const CHART_COLORS = [
    '#42a5f5', '#66bb6a', '#ffa726', '#ef5350', '#ab47bc',
    '#26c6da', '#8d6e63', '#78909c', '#d4e157', '#ec407a',
    '#5c6bc0', '#29b6f6', '#9ccc65', '#ffca28', '#7e57c2',
    '#26a69a', '#ff7043', '#bdbdbd', '#aed581', '#f48fb1',
    '#4dd0e1',
];

function renderTimeline(scanData, canvasId, emptyId) {
    const canvas = document.getElementById(canvasId);
    const emptyEl = document.getElementById(emptyId);

    if (!scanData || !scanData.slots || Object.keys(scanData.stations).length === 0) {
        canvas.style.display = 'none';
        emptyEl.style.display = 'block';
        return;
    }

    canvas.style.display = 'block';
    emptyEl.style.display = 'none';

    const datasets = [];
    let colorIdx = 0;

    for (const [sid, sdata] of Object.entries(scanData.stations)) {
        const color = CHART_COLORS[colorIdx % CHART_COLORS.length];
        const shortName = sdata.name.split(',')[0];
        datasets.push({
            label: shortName,
            data: sdata.predictions,
            borderColor: color,
            backgroundColor: color + '33',
            borderWidth: 2,
            pointRadius: 1,
            tension: 0.3,
            fill: false,
        });
        colorIdx++;
    }

    // Destroy existing chart on this canvas
    const existing = canvasId === 'timeline-chart' ? timelineChart : altChart;
    if (existing) existing.destroy();

    const chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: scanData.slots,
            datasets: datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                annotation: {
                    annotations: {
                        threshold: {
                            type: 'line',
                            yMin: 5,
                            yMax: 5,
                            borderColor: 'rgba(25, 135, 84, 0.5)',
                            borderWidth: 1,
                            borderDash: [5, 5],
                            label: {
                                content: 'Safe (5 docks)',
                                display: true,
                                position: 'end',
                                font: { size: 10 },
                            },
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: { display: true, text: 'Time' },
                    ticks: {
                        maxTicksLimit: 12,
                        font: { size: 10 },
                    },
                },
                y: {
                    title: { display: true, text: 'Predicted Free Docks' },
                    beginAtZero: true,
                },
            },
        },
    });

    if (canvasId === 'timeline-chart') {
        timelineChart = chart;
    } else {
        altChart = chart;
    }
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    // Set default date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    document.getElementById('scan-date').value = dateStr;

    loadStations();
});
