/* Door2Dock – Now Page (Clean, focused live status) */

const PRIORITY_SHOW_COUNT = 3; // only show top 3 on first glance

let map;
let mapInitialised = false;
let markers = {};
let currentStations = [];
let currentSort = 'walking';
let forecastData = {};
let forecastHorizon = 15;

// ------------------------------------------------------------------
// Priority stations from Settings (localStorage)
// ------------------------------------------------------------------

const DEFAULT_PRIORITY_IDS = [
    'BikePoints_432', // Exhibition Road Museums 1
    'BikePoints_482', // Exhibition Road Museums 2
    'BikePoints_878', // Victoria & Albert Museum
    'BikePoints_356', // South Kensington Station
    'BikePoints_428', // Exhibition Road
];

function getPriorityStationIds() {
    try {
        const raw = localStorage.getItem('ds_station_order');
        if (raw) {
            const ids = JSON.parse(raw);
            if (Array.isArray(ids) && ids.length > 0) return ids.slice(0, 5);
        }
    } catch { /* ignore */ }
    return DEFAULT_PRIORITY_IDS;
}

function getPriorityIndex(stationId) {
    const ids = getPriorityStationIds();
    return ids.indexOf(stationId);
}

function isPriorityStation(stationId) {
    return getPriorityIndex(stationId) >= 0;
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    loadWeather();
    loadLiveStatus();
    loadForecast();

    // Init map when "Show all stations" is expanded
    const collapseEl = document.getElementById('more-stations');
    collapseEl.addEventListener('shown.bs.collapse', () => {
        initMapIfNeeded();
        if (map) setTimeout(() => map.invalidateSize(), 50);
    });

    // Sort buttons (inside collapsed section)
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentSort = e.target.dataset.sort;
            renderStationCards();
        });
    });

    // Toggle button text + icon
    collapseEl.addEventListener('show.bs.collapse', () => {
        document.getElementById('expand-btn').innerHTML =
            '<i class="bi bi-chevron-up"></i> Hide stations & map';
    });
    collapseEl.addEventListener('hide.bs.collapse', () => {
        document.getElementById('expand-btn').innerHTML =
            '<i class="bi bi-chevron-down"></i> Show all stations & map';
    });

    // Auto-refresh every 60s
    setInterval(() => {
        loadLiveStatus();
        loadWeather();
        loadForecast();
    }, 60000);
});

// ------------------------------------------------------------------
// Lazy map init
// ------------------------------------------------------------------

function initMapIfNeeded() {
    if (mapInitialised) return;
    mapInitialised = true;

    map = L.map('map', {
        zoomControl: true,
        scrollWheelZoom: true,
    }).setView([51.4988, -0.1749], 15);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
    }).addTo(map);

    L.circleMarker([51.4988, -0.1749], {
        radius: 8, fillColor: '#0d6efd', color: '#fff', weight: 2, fillOpacity: 0.9,
    }).addTo(map).bindPopup('<strong>Imperial College London</strong><br>South Kensington Campus');

    L.circle([51.4988, -0.1749], {
        radius: 800, color: '#0d6efd', fillColor: '#0d6efd',
        fillOpacity: 0.05, weight: 1, dashArray: '5, 5',
    }).addTo(map);

    // Render markers for already-loaded stations
    if (currentStations.length > 0) {
        updateMapMarkers(currentStations);
    }

    // Fix Leaflet rendering in collapsed container
    setTimeout(() => map.invalidateSize(), 200);
}

// ------------------------------------------------------------------
// Data loading
// ------------------------------------------------------------------

async function loadWeather() {
    try {
        const resp = await fetch('/api/weather-now');
        const w = await resp.json();
        if (w.temperature != null) {
            document.getElementById('banner-temp').textContent = Math.round(w.temperature);
            document.getElementById('banner-weather-desc').textContent =
                `${w.description || ''} · ${w.wind_speed || 0} m/s`;
        }
    } catch (e) {
        console.error('Weather load error:', e);
    }
}

async function loadLiveStatus() {
    try {
        const resp = await fetch('/api/live');
        currentStations = await resp.json();
        if (mapInitialised) updateMapMarkers(currentStations);
        renderPriorityStations();
        renderStationCards();
        updateQuickRecommendation();
        updateTimestamp(currentStations);
    } catch (e) {
        console.error('Live status error:', e);
    }
}

async function loadForecast() {
    try {
        const resp = await fetch('/api/forecast');
        const data = await resp.json();
        if (!data.available) return;
        forecastHorizon = data.prediction_horizon_min || 15;
        forecastData = {};
        (data.predictions || []).forEach(p => {
            forecastData[p.station_id] = p;
        });
        renderPriorityStations();
        renderStationCards();
        updateQuickRecommendation();
    } catch (e) {
        console.error('Forecast load error:', e);
    }
}

// ------------------------------------------------------------------
// Quick Recommendation Banner
// ------------------------------------------------------------------

function updateQuickRecommendation() {
    const signal = document.getElementById('quick-rec-signal');
    const text = document.getElementById('quick-rec-text');
    const detail = document.getElementById('quick-rec-detail');
    const card = document.getElementById('quick-rec-card');

    const priorityStations = currentStations
        .filter(s => isPriorityStation(s.station_id))
        .sort((a, b) => getPriorityIndex(a.station_id) - getPriorityIndex(b.station_id));

    // Best = nearest priority station with 5+ docks
    const best = priorityStations
        .filter(s => s.empty_docks >= 5)
        .sort((a, b) => (a.walking_distance_m || 9999) - (b.walking_distance_m || 9999))[0];

    const horizonLabel = forecastHorizon >= 60
        ? `${Math.round(forecastHorizon / 60)}h` : `${forecastHorizon}min`;

    card.classList.remove('rec-green', 'rec-yellow', 'rec-red');

    if (best) {
        const walkMin = Math.round((best.walking_duration_s || 0) / 60);
        const fc = forecastData[best.station_id];
        let forecastText = '';
        if (fc) {
            forecastText = ` → ~${Math.round(fc.predicted_empty_docks)} in ${horizonLabel}`;
        }
        card.classList.add('rec-green');
        signal.className = 'rec-signal rec-signal-green';
        text.textContent = `${best.empty_docks} free docks at ${best.station_name.split(',')[0]}`;
        detail.textContent = `${walkMin} min walk${forecastText}`;
    } else {
        const anyAvailable = priorityStations.find(s => (s.empty_docks || 0) >= 1);
        if (anyAvailable) {
            const walkMin = Math.round((anyAvailable.walking_duration_s || 0) / 60);
            card.classList.add('rec-yellow');
            signal.className = 'rec-signal rec-signal-yellow';
            text.textContent = `Only ${anyAvailable.empty_docks} dock${anyAvailable.empty_docks > 1 ? 's' : ''} at ${anyAvailable.station_name.split(',')[0]}`;
            detail.textContent = `${walkMin} min walk · Limited availability`;
        } else {
            card.classList.add('rec-red');
            signal.className = 'rec-signal rec-signal-red';
            text.textContent = 'No free docks at your stations';
            detail.textContent = 'Expand below to check other stations';
        }
    }
}

// ------------------------------------------------------------------
// Priority Station Cards (top 3 only)
// ------------------------------------------------------------------

function renderPriorityStations() {
    const container = document.getElementById('priority-stations');
    const horizonLabel = forecastHorizon >= 60
        ? `${Math.round(forecastHorizon / 60)}h` : `${forecastHorizon}min`;

    const priority = currentStations
        .filter(s => isPriorityStation(s.station_id))
        .sort((a, b) => getPriorityIndex(a.station_id) - getPriorityIndex(b.station_id))
        .slice(0, PRIORITY_SHOW_COUNT);

    if (priority.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = priority.map(s => {
        const dockColor = s.status === 'green' ? 'text-success'
            : s.status === 'yellow' ? 'text-warning' : 'text-danger';
        const walkMin = Math.round((s.walking_duration_s || 0) / 60);
        const fc = forecastData[s.station_id];

        let forecastHtml = '';
        if (fc) {
            const fcColor = fc.predicted_status === 'green' ? 'success'
                : fc.predicted_status === 'yellow' ? 'warning' : 'danger';
            forecastHtml = `<span class="text-${fcColor} fw-bold">&rarr; ~${Math.round(fc.predicted_empty_docks)} in ${horizonLabel}</span>`;
        }

        return `
        <div class="col-sm-4">
            <div class="card h-100 priority-station-card status-border-${s.status}">
                <div class="card-body py-3 text-center">
                    <div class="${dockColor} mb-1">
                        <span class="fs-1 fw-bold">${s.empty_docks}</span>
                        <span class="small">free</span>
                    </div>
                    <div class="small fw-bold mb-1">${s.station_name.split(',')[0]}</div>
                    <div class="small text-body-secondary">${walkMin} min walk</div>
                    ${forecastHtml ? `<div class="small mt-1">${forecastHtml}</div>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

// ------------------------------------------------------------------
// All Station Cards (in collapsed section)
// ------------------------------------------------------------------

function formatWalkingTime(seconds) {
    if (!seconds) return '?';
    return `${Math.round(seconds / 60)} min walk`;
}

function sortStations(stations) {
    const sorted = [...stations];
    switch (currentSort) {
        case 'walking':
            sorted.sort((a, b) => (a.walking_distance_m || 9999) - (b.walking_distance_m || 9999));
            break;
        case 'docks-desc':
            sorted.sort((a, b) => (b.empty_docks || 0) - (a.empty_docks || 0));
            break;
        case 'docks-asc':
            sorted.sort((a, b) => (a.empty_docks || 0) - (b.empty_docks || 0));
            break;
    }
    return sorted;
}

function renderStationCards() {
    const container = document.getElementById('station-list');
    if (!container) return;

    const sorted = sortStations(currentStations);
    const horizonLabel = forecastHorizon >= 60
        ? `${Math.round(forecastHorizon / 60)}h` : `${forecastHorizon}min`;

    container.innerHTML = sorted.map(s => {
        const pct = s.total_docks > 0
            ? Math.round((s.empty_docks / s.total_docks) * 100) : 0;
        const fillClass = s.status === 'green' ? 'fill-green'
            : s.status === 'yellow' ? 'fill-yellow' : 'fill-red';
        const dockColor = s.status === 'green' ? 'text-success'
            : s.status === 'yellow' ? 'text-warning' : 'text-danger';
        const walkTime = formatWalkingTime(s.walking_duration_s);
        const walkDist = Math.round(s.walking_distance_m || 0);

        let forecastHint = '';
        if (forecastData[s.station_id]) {
            const fc = forecastData[s.station_id];
            const fcColor = fc.predicted_status === 'green' ? 'success'
                : fc.predicted_status === 'yellow' ? 'warning' : 'danger';
            forecastHint = ` · <span class="forecast-hint text-${fcColor}">&rarr; ~${Math.round(fc.predicted_empty_docks)} in ${horizonLabel}</span>`;
        }

        return `
        <div class="station-card status-border-${s.status}"
             data-station-id="${s.station_id}"
             onclick="focusStation('${s.station_id}')"
             onmouseenter="highlightMarker('${s.station_id}')"
             onmouseleave="unhighlightMarker('${s.station_id}')">
            <div class="d-flex gap-3 align-items-center">
                <div class="dock-hero ${dockColor}">
                    <div class="dock-hero-num">${s.empty_docks}</div>
                    <div class="dock-hero-label">FREE</div>
                </div>
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <div class="station-name">${s.station_name}</div>
                            <div class="station-meta">
                                <i class="bi bi-person-walking"></i> ${walkDist}m · ${walkTime}
                            </div>
                        </div>
                        <span class="badge status-${s.status}">${s.status.toUpperCase()}</span>
                    </div>
                    <div class="dock-bar">
                        <div class="dock-bar-fill ${fillClass}" style="width: ${pct}%"></div>
                    </div>
                    <div class="bike-detail">
                        ${s.standard_bikes} standard · ${s.ebikes} e-bikes${forecastHint}
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ------------------------------------------------------------------
// Map Markers
// ------------------------------------------------------------------

function updateMapMarkers(stations) {
    if (!map) return;
    const statusColors = { green: '#198754', yellow: '#ffc107', red: '#dc3545' };

    stations.forEach(s => {
        const color = statusColors[s.status] || '#6c757d';
        const radius = Math.max(7, Math.min(16, 7 + s.empty_docks * 0.6));
        const walkTime = formatWalkingTime(s.walking_duration_s);
        const walkDist = Math.round(s.walking_distance_m || 0);
        const popupHtml = `
            <strong>${s.station_name}</strong><br>
            <span style="color:${color}; font-size:1.4em; font-weight:bold;">${s.empty_docks}</span>
            <span style="color:${color};"> free docks</span>
            <span style="opacity:0.6;"> / ${s.total_docks}</span><br>
            <small>${walkDist}m · ${walkTime}</small>
        `;

        if (markers[s.station_id]) {
            markers[s.station_id].setStyle({ fillColor: color, radius });
            markers[s.station_id].setPopupContent(popupHtml);
            markers[s.station_id]._baseRadius = radius;
        } else {
            const marker = L.circleMarker(
                [s.latitude, s.longitude],
                { radius, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9 }
            ).addTo(map).bindPopup(popupHtml);
            marker._baseRadius = radius;
            markers[s.station_id] = marker;
        }
    });
}

// ------------------------------------------------------------------
// Hover & Focus
// ------------------------------------------------------------------

function highlightMarker(stationId) {
    const marker = markers[stationId];
    if (!marker) return;
    marker.setStyle({ radius: (marker._baseRadius || 10) + 6, weight: 4, fillOpacity: 1 });
    marker.bringToFront();
    marker.openPopup();
}

function unhighlightMarker(stationId) {
    const marker = markers[stationId];
    if (!marker) return;
    marker.setStyle({ radius: marker._baseRadius || 10, weight: 2, fillOpacity: 0.9 });
    marker.closePopup();
}

function focusStation(stationId) {
    // Expand the section first if collapsed
    const collapseEl = document.getElementById('more-stations');
    if (!collapseEl.classList.contains('show')) {
        const bsCollapse = new bootstrap.Collapse(collapseEl, { show: true });
    }
    setTimeout(() => {
        initMapIfNeeded();
        if (map) map.invalidateSize();
        const marker = markers[stationId];
        if (!marker) return;
        map.flyTo(marker.getLatLng(), 17, { duration: 0.5 });
        setTimeout(() => marker.openPopup(), 500);
    }, 400);
}

// ------------------------------------------------------------------
// Timestamp
// ------------------------------------------------------------------

function updateTimestamp(stations) {
    if (stations.length > 0 && stations[0].timestamp) {
        const t = new Date(stations[0].timestamp);
        const now = new Date();
        const diffMin = Math.round((now - t) / 60000);
        const timeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const agoStr = diffMin <= 1 ? 'just now' : `${diffMin} min ago`;
        document.getElementById('update-time').textContent = `${timeStr} (${agoStr})`;
    }
}
