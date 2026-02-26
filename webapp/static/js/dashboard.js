/* Door2Dock – Live Dashboard */

let map;
let markers = {};

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadStats();
    loadWeather();
    loadLiveStatus();

    // Auto-refresh every 60 seconds
    setInterval(() => {
        loadLiveStatus();
        loadWeather();
    }, 60000);
});

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        scrollWheelZoom: true,
    }).setView([51.4988, -0.1749], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(map);

    // Imperial College marker
    L.circleMarker([51.4988, -0.1749], {
        radius: 8,
        fillColor: '#0d6efd',
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9,
    }).addTo(map).bindPopup('<strong>Imperial College London</strong><br>South Kensington Campus');

    // 800m radius circle
    L.circle([51.4988, -0.1749], {
        radius: 800,
        color: '#0d6efd',
        fillColor: '#0d6efd',
        fillOpacity: 0.05,
        weight: 1,
        dashArray: '5, 5',
    }).addTo(map);
}

async function loadStats() {
    try {
        const resp = await fetch('/api/stats');
        const s = await resp.json();
        document.getElementById('stat-stations').textContent = s.stations || '--';
        document.getElementById('stat-datapoints').textContent =
            (s.bike_rows || 0).toLocaleString();
        document.getElementById('stat-days').textContent = s.collection_days || '--';
    } catch (e) {
        console.error('Stats load error:', e);
    }
}

async function loadWeather() {
    try {
        const resp = await fetch('/api/weather-now');
        const w = await resp.json();
        if (w.temperature != null) {
            document.getElementById('stat-temp').textContent =
                Math.round(w.temperature);
            document.getElementById('stat-weather-desc').textContent =
                `${w.description || ''} · ${w.wind_speed || 0} m/s wind`;
        }
    } catch (e) {
        console.error('Weather load error:', e);
    }
}

async function loadLiveStatus() {
    try {
        const resp = await fetch('/api/live');
        const stations = await resp.json();

        updateStationCards(stations);
        updateMapMarkers(stations);
        updateCounts(stations);
        updateTimestamp(stations);
    } catch (e) {
        console.error('Live status error:', e);
        document.getElementById('station-list').innerHTML =
            '<div class="text-danger text-center py-5">Failed to load station data</div>';
    }
}

function updateStationCards(stations) {
    const container = document.getElementById('station-list');
    const sorted = [...stations].sort((a, b) =>
        (a.distance_m || 999) - (b.distance_m || 999));

    container.innerHTML = sorted.map(s => {
        const pct = s.total_docks > 0
            ? Math.round((s.empty_docks / s.total_docks) * 100) : 0;
        const fillClass = s.status === 'green' ? 'fill-green'
            : s.status === 'yellow' ? 'fill-yellow' : 'fill-red';

        return `
        <div class="station-card bg-body-secondary status-border-${s.status}">
            <div class="d-flex justify-content-between align-items-start">
                <div>
                    <div class="station-name">${s.station_name}</div>
                    <div class="station-meta">${s.distance_m || '?'}m from Imperial</div>
                </div>
                <span class="badge status-${s.status}">${s.status.toUpperCase()}</span>
            </div>
            <div class="station-numbers">
                <div>
                    <div class="num">${s.available_bikes}</div>
                    <div class="num-label">Bikes</div>
                </div>
                <div>
                    <div class="num">${s.ebikes}</div>
                    <div class="num-label">E-Bikes</div>
                </div>
                <div>
                    <div class="num">${s.empty_docks}</div>
                    <div class="num-label">Docks</div>
                </div>
                <div>
                    <div class="num text-body-secondary">${s.total_docks}</div>
                    <div class="num-label">Total</div>
                </div>
            </div>
            <div class="dock-bar">
                <div class="dock-bar-fill ${fillClass}" style="width: ${pct}%"></div>
            </div>
        </div>`;
    }).join('');
}

function updateMapMarkers(stations) {
    const statusColors = {
        green: '#198754',
        yellow: '#ffc107',
        red: '#dc3545',
    };

    stations.forEach(s => {
        const color = statusColors[s.status] || '#6c757d';
        const popupHtml = `
            <strong>${s.station_name}</strong><br>
            <span style="color:${color}">&#9679;</span>
            ${s.available_bikes} bikes · ${s.ebikes} e-bikes · ${s.empty_docks} docks free<br>
            <small>${s.distance_m || '?'}m from Imperial</small>
        `;

        if (markers[s.station_id]) {
            // Update existing marker
            markers[s.station_id].setStyle({ fillColor: color });
            markers[s.station_id].setPopupContent(popupHtml);
        } else {
            // Create new marker
            markers[s.station_id] = L.circleMarker(
                [s.latitude, s.longitude],
                {
                    radius: 10,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 0.9,
                }
            ).addTo(map).bindPopup(popupHtml);
        }
    });
}

function updateCounts(stations) {
    const counts = { green: 0, yellow: 0, red: 0 };
    stations.forEach(s => { counts[s.status] = (counts[s.status] || 0) + 1; });
    document.getElementById('count-green').textContent = counts.green;
    document.getElementById('count-yellow').textContent = counts.yellow;
    document.getElementById('count-red').textContent = counts.red;
}

function updateTimestamp(stations) {
    if (stations.length > 0 && stations[0].timestamp) {
        const t = new Date(stations[0].timestamp);
        document.getElementById('update-time').textContent =
            t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
}
