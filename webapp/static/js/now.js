/* Door2Dock – Now Page (Live Status with Priority Stations) */

// Priority stations in order of importance
const PRIORITY_STATION_NAMES = [
    'Exhibition Road Museums 1',
    'Exhibition Road Museums 2',
    'Victoria & Albert Museum',
    'Exhibition Road',
    'South Kensington Station',
    'Holy Trinity Brompton',
    'Natural History Museum',
];

let map;
let markers = {};
let currentStations = [];
let currentSort = 'walking';
let showCount = 10;
let forecastData = {};
let forecastHorizon = 15;

// ------------------------------------------------------------------
// Priority station matching
// ------------------------------------------------------------------

function getPriorityIndex(stationName) {
    const name = stationName.toLowerCase();
    for (let i = 0; i < PRIORITY_STATION_NAMES.length; i++) {
        if (name.includes(PRIORITY_STATION_NAMES[i].toLowerCase())) {
            return i;
        }
    }
    return -1;
}

function isPriorityStation(stationName) {
    return getPriorityIndex(stationName) >= 0;
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadWeather();
    loadLiveStatus();
    loadForecast();

    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentSort = e.target.dataset.sort;
            renderStationCards();
        });
    });

    document.querySelectorAll('.show-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.show-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            showCount = parseInt(e.target.dataset.show);
            renderStationCards();
            updateMapVisibility();
        });
    });

    setInterval(() => {
        loadLiveStatus();
        loadWeather();
        loadForecast();
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

    L.circleMarker([51.4988, -0.1749], {
        radius: 8,
        fillColor: '#0d6efd',
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9,
    }).addTo(map).bindPopup('<strong>Imperial College London</strong><br>South Kensington Campus');

    L.circle([51.4988, -0.1749], {
        radius: 800,
        color: '#0d6efd',
        fillColor: '#0d6efd',
        fillOpacity: 0.05,
        weight: 1,
        dashArray: '5, 5',
    }).addTo(map);
}

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
        updateMapMarkers(currentStations);
        renderPriorityStations();
        renderStationCards();
        updateQuickRecommendation();
        updateMapVisibility();
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

    // Find best priority station (by current docks)
    const priorityStations = currentStations
        .filter(s => isPriorityStation(s.station_name))
        .sort((a, b) => getPriorityIndex(a.station_name) - getPriorityIndex(b.station_name));

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
        text.textContent = `${best.station_name} — ${best.empty_docks} free docks${forecastText}`;
        detail.textContent = `${walkMin} min walk · Best option right now`;
    } else {
        const anyAvailable = priorityStations.find(s => s.empty_docks >= 1);
        if (anyAvailable) {
            const walkMin = Math.round((anyAvailable.walking_duration_s || 0) / 60);
            card.classList.add('rec-yellow');
            signal.className = 'rec-signal rec-signal-yellow';
            text.textContent = `${anyAvailable.station_name} — only ${anyAvailable.empty_docks} free dock${anyAvailable.empty_docks > 1 ? 's' : ''}`;
            detail.textContent = `${walkMin} min walk · Limited availability, consider alternatives`;
        } else {
            card.classList.add('rec-red');
            signal.className = 'rec-signal rec-signal-red';
            text.textContent = 'No free docks at your stations';
            detail.textContent = 'Check the map for alternatives further away';
        }
    }
}

// ------------------------------------------------------------------
// Priority Station Cards (top section)
// ------------------------------------------------------------------

function renderPriorityStations() {
    const container = document.getElementById('priority-stations');
    const horizonLabel = forecastHorizon >= 60
        ? `${Math.round(forecastHorizon / 60)}h` : `${forecastHorizon}min`;

    const priority = currentStations
        .filter(s => isPriorityStation(s.station_name))
        .sort((a, b) => getPriorityIndex(a.station_name) - getPriorityIndex(b.station_name));

    if (priority.length === 0) {
        container.innerHTML = '<div class="text-body-secondary text-center py-3">No priority stations found</div>';
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
            const predicted = Math.round(fc.predicted_empty_docks);
            forecastHtml = `<div class="small text-${fcColor} fw-bold">&rarr; ~${predicted} in ${horizonLabel}</div>`;
        }

        return `
        <div class="col-sm-6 col-md-4 col-lg-3">
            <div class="card h-100 priority-station-card status-border-${s.status}"
                 onclick="focusStation('${s.station_id}')"
                 onmouseenter="highlightMarker('${s.station_id}')"
                 onmouseleave="unhighlightMarker('${s.station_id}')">
                <div class="card-body py-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="small fw-bold">${s.station_name.split(',')[0]}</div>
                        <span class="badge status-${s.status}" style="font-size:0.65rem">${s.status.toUpperCase()}</span>
                    </div>
                    <div class="d-flex align-items-end gap-2">
                        <div class="${dockColor}">
                            <span class="fs-2 fw-bold">${s.empty_docks}</span>
                            <span class="small">free</span>
                        </div>
                        <div class="flex-grow-1 text-end">
                            ${forecastHtml}
                            <div class="small text-body-secondary">${walkMin} min walk</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ------------------------------------------------------------------
// Station Cards (all stations list)
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

function getVisibleStations() {
    const byWalking = [...currentStations].sort((a, b) =>
        (a.walking_distance_m || 9999) - (b.walking_distance_m || 9999));
    if (showCount > 0) {
        return new Set(byWalking.slice(0, showCount).map(s => s.station_id));
    }
    return new Set(byWalking.map(s => s.station_id));
}

function renderStationCards() {
    const container = document.getElementById('station-list');
    const visible = getVisibleStations();
    const sorted = sortStations(currentStations).filter(s => visible.has(s.station_id));

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
        const isPriority = isPriorityStation(s.station_name);

        let forecastHint = '';
        if (forecastData[s.station_id]) {
            const fc = forecastData[s.station_id];
            const fcColor = fc.predicted_status === 'green' ? 'success'
                : fc.predicted_status === 'yellow' ? 'warning' : 'danger';
            forecastHint = ` · <span class="forecast-hint text-${fcColor}">&rarr; ~${Math.round(fc.predicted_empty_docks)} in ${horizonLabel}</span>`;
        }

        return `
        <div class="station-card bg-body-secondary status-border-${s.status}"
             data-station-id="${s.station_id}"
             onclick="focusStation('${s.station_id}')"
             onmouseenter="highlightMarker('${s.station_id}')"
             onmouseleave="unhighlightMarker('${s.station_id}')">
            <div class="d-flex gap-3 align-items-center">
                <div class="dock-hero ${dockColor}">
                    <div class="dock-hero-num">${s.empty_docks}</div>
                    <div class="dock-hero-label">FREE DOCKS</div>
                </div>
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <div class="station-name">
                                ${isPriority ? '<i class="bi bi-star-fill text-warning" style="font-size:0.7rem"></i> ' : ''}${s.station_name}
                            </div>
                            <div class="station-meta">
                                <i class="bi bi-person-walking"></i> ${walkDist}m · ${walkTime} · ${s.total_docks} total
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
            <span style="opacity:0.6;"> / ${s.total_docks} total</span><br>
            <small>${s.standard_bikes} standard + ${s.ebikes} e-bikes · ${walkDist}m · ${walkTime}</small>
        `;

        if (markers[s.station_id]) {
            markers[s.station_id].setStyle({ fillColor: color, radius: radius });
            markers[s.station_id].setPopupContent(popupHtml);
            markers[s.station_id]._baseRadius = radius;
            markers[s.station_id]._baseColor = color;
        } else {
            const marker = L.circleMarker(
                [s.latitude, s.longitude],
                { radius, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9 }
            ).addTo(map).bindPopup(popupHtml);
            marker._baseRadius = radius;
            marker._baseColor = color;
            markers[s.station_id] = marker;
        }
    });
}

function updateMapVisibility() {
    const visible = getVisibleStations();
    for (const [stationId, marker] of Object.entries(markers)) {
        if (visible.has(stationId)) {
            marker.setStyle({ opacity: 1, fillOpacity: 0.9 });
        } else {
            marker.setStyle({ opacity: 0.15, fillOpacity: 0.1 });
        }
    }
}

// ------------------------------------------------------------------
// Hover & Focus
// ------------------------------------------------------------------

function highlightMarker(stationId) {
    const marker = markers[stationId];
    if (!marker) return;
    marker.setStyle({
        radius: (marker._baseRadius || 10) + 6,
        weight: 4, color: '#fff', fillOpacity: 1,
    });
    marker.bringToFront();
    marker.openPopup();
}

function unhighlightMarker(stationId) {
    const marker = markers[stationId];
    if (!marker) return;
    const visible = getVisibleStations();
    const isVisible = visible.has(stationId);
    marker.setStyle({
        radius: marker._baseRadius || 10,
        weight: 2, color: '#fff',
        fillOpacity: isVisible ? 0.9 : 0.1,
        opacity: isVisible ? 1 : 0.15,
    });
    marker.closePopup();
}

function focusStation(stationId) {
    const marker = markers[stationId];
    if (!marker) return;
    map.flyTo(marker.getLatLng(), 17, { duration: 0.5 });
    setTimeout(() => marker.openPopup(), 500);
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
