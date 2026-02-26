/* Door2Dock – Live Dashboard */

let map;
let markers = {};
let currentStations = [];
let currentSort = 'walking';
let showCount = 10; // 0 = all

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadStats();
    loadWeather();
    loadLiveStatus();

    // Sort buttons
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentSort = e.target.dataset.sort;
            renderStationCards();
        });
    });

    // Show count buttons
    document.querySelectorAll('.show-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.show-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            showCount = parseInt(e.target.dataset.show);
            renderStationCards();
            updateMapVisibility();
            updateStats();
        });
    });

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
        currentStations = await resp.json();

        updateMapMarkers(currentStations);
        renderStationCards();
        updateStats();
        updateTimestamp(currentStations);
        updateMapVisibility();
    } catch (e) {
        console.error('Live status error:', e);
        document.getElementById('station-list').innerHTML =
            '<div class="text-danger text-center py-5">Failed to load station data</div>';
    }
}

// ------------------------------------------------------------------
// Sorting & Filtering
// ------------------------------------------------------------------

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
        case 'name':
            sorted.sort((a, b) => a.station_name.localeCompare(b.station_name));
            break;
    }
    return sorted;
}

function getVisibleStations() {
    // Always sort by walking distance first to determine the "nearest"
    const byWalking = [...currentStations].sort((a, b) =>
        (a.walking_distance_m || 9999) - (b.walking_distance_m || 9999));
    if (showCount > 0) {
        return new Set(byWalking.slice(0, showCount).map(s => s.station_id));
    }
    return new Set(byWalking.map(s => s.station_id));
}

// ------------------------------------------------------------------
// Station Cards
// ------------------------------------------------------------------

function formatWalkingTime(seconds) {
    if (!seconds) return '?';
    const mins = Math.round(seconds / 60);
    return `${mins} min walk`;
}

function renderStationCards() {
    const container = document.getElementById('station-list');
    const visible = getVisibleStations();
    const sorted = sortStations(currentStations).filter(s => visible.has(s.station_id));

    container.innerHTML = sorted.map(s => {
        const pct = s.total_docks > 0
            ? Math.round((s.empty_docks / s.total_docks) * 100) : 0;
        const fillClass = s.status === 'green' ? 'fill-green'
            : s.status === 'yellow' ? 'fill-yellow' : 'fill-red';
        const dockColor = s.status === 'green' ? 'text-success'
            : s.status === 'yellow' ? 'text-warning' : 'text-danger';
        const walkTime = formatWalkingTime(s.walking_duration_s);
        const walkDist = Math.round(s.walking_distance_m || 0);

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
                            <div class="station-name">${s.station_name}</div>
                            <div class="station-meta">
                                <i class="bi bi-person-walking"></i> ${walkDist}m · ${walkTime} · ${s.total_docks} total docks
                            </div>
                        </div>
                        <span class="badge status-${s.status}">${s.status.toUpperCase()}</span>
                    </div>
                    <div class="dock-bar">
                        <div class="dock-bar-fill ${fillClass}" style="width: ${pct}%"></div>
                    </div>
                    <div class="bike-detail">
                        ${s.standard_bikes} standard · ${s.ebikes} e-bikes available
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
    const statusColors = {
        green: '#198754',
        yellow: '#ffc107',
        red: '#dc3545',
    };

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
                {
                    radius: radius,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 0.9,
                }
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
// Hover Highlight
// ------------------------------------------------------------------

let pulseRing = null;

function highlightMarker(stationId) {
    const marker = markers[stationId];
    if (!marker) return;

    marker.setStyle({
        radius: (marker._baseRadius || 10) + 6,
        weight: 4,
        color: '#fff',
        fillOpacity: 1,
    });
    marker.bringToFront();

    const latlng = marker.getLatLng();
    if (pulseRing) map.removeLayer(pulseRing);
    pulseRing = L.circleMarker(latlng, {
        radius: (marker._baseRadius || 10) + 16,
        fillColor: marker._baseColor || '#fff',
        fillOpacity: 0.15,
        color: marker._baseColor || '#fff',
        weight: 2,
        opacity: 0.4,
        className: 'pulse-ring',
    }).addTo(map);

    marker.openPopup();
}

function unhighlightMarker(stationId) {
    const marker = markers[stationId];
    if (!marker) return;

    const visible = getVisibleStations();
    const isVisible = visible.has(stationId);

    marker.setStyle({
        radius: marker._baseRadius || 10,
        weight: 2,
        color: '#fff',
        fillOpacity: isVisible ? 0.9 : 0.1,
        opacity: isVisible ? 1 : 0.15,
    });

    if (pulseRing) {
        map.removeLayer(pulseRing);
        pulseRing = null;
    }
    marker.closePopup();
}

// ------------------------------------------------------------------
// Counts & Timestamp
// ------------------------------------------------------------------

function updateStats() {
    const visible = getVisibleStations();
    let totalFreeDocks = 0;
    let visibleCount = 0;

    // Sort by walking distance to find nearest
    const byWalking = [...currentStations].sort((a, b) =>
        (a.walking_distance_m || 9999) - (b.walking_distance_m || 9999));

    byWalking.forEach(s => {
        if (visible.has(s.station_id)) {
            totalFreeDocks += s.empty_docks || 0;
            visibleCount++;
        }
    });

    // Free docks
    document.getElementById('stat-free-docks').textContent = totalFreeDocks;
    document.getElementById('stat-visible-count').textContent = visibleCount;
    document.getElementById('stat-total-count').textContent = currentStations.length;

    // Nearest station with free docks
    const nearest = byWalking.find(s => visible.has(s.station_id) && s.empty_docks > 0);
    if (nearest) {
        const dockColor = nearest.status === 'green' ? 'text-success'
            : nearest.status === 'yellow' ? 'text-warning' : 'text-danger';
        const el = document.getElementById('stat-nearest-docks');
        el.textContent = nearest.empty_docks + ' docks';
        el.className = `fs-2 fw-bold ${dockColor}`;
        document.getElementById('stat-nearest-name').textContent =
            `${nearest.station_name.split(',')[0]} · ${formatWalkingTime(nearest.walking_duration_s)}`;
    } else {
        document.getElementById('stat-nearest-docks').textContent = '0';
        document.getElementById('stat-nearest-docks').className = 'fs-2 fw-bold text-danger';
        document.getElementById('stat-nearest-name').textContent = 'No docks available';
    }
}

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

// ------------------------------------------------------------------
// Click-to-Focus: Pan map to station and open popup
// ------------------------------------------------------------------

function focusStation(stationId) {
    const marker = markers[stationId];
    if (!marker) return;
    const latlng = marker.getLatLng();
    map.flyTo(latlng, 17, { duration: 0.5 });
    setTimeout(() => {
        marker.openPopup();
    }, 500);
}
