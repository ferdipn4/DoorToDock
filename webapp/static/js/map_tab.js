/* Door2Dock – Map Tab (full-screen station map) */

import { getPredictionNow, getStations } from './api/client.js';

const IMPERIAL = [51.4988, -0.1749];

// Tile providers
const TILES_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

const COLORS = {
    danger: '#E24B4A',
    warning: '#BA7517',
    success: '#1D9E75',
    info: '#378ADD',
};

let map = null;
let markers = {};
let recRing = null;

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadData();
});

function isDarkMode() {
    if (document.documentElement.getAttribute('data-bs-theme') === 'dark') return true;
    if (document.documentElement.getAttribute('data-bs-theme') === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function initMap() {
    map = L.map('map-full', {
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: false,
    }).setView(IMPERIAL, 15);

    L.tileLayer(isDarkMode() ? TILES_DARK : TILES_LIGHT, { maxZoom: 19 }).addTo(map);

    // Imperial College marker
    const dark = isDarkMode();
    L.circleMarker(IMPERIAL, {
        radius: 7,
        fillColor: dark ? '#E8E8E8' : '#333',
        color: dark ? '#444' : '#fff',
        weight: 2,
        fillOpacity: 0.9,
    }).addTo(map).bindPopup(
        '<div class="station-popup">' +
        '<div class="station-popup-name">Imperial College London</div>' +
        '<div class="station-popup-meta"><div class="station-popup-meta-row">South Kensington Campus</div></div>' +
        '</div>'
    );

    // Fix rendering after DOM settles
    setTimeout(() => map.invalidateSize(), 100);
}

async function loadData() {
    try {
        const [prediction, stationList] = await Promise.all([
            getPredictionNow(),
            getStations(),
        ]);
        renderMarkers(stationList, prediction);
        updateTimestamp(prediction.timestamp);
    } catch (e) {
        console.error('Map data load error:', e);
        showMapError();
    }
}

function showMapError() {
    const legend = document.getElementById('map-tab-legend');
    if (legend) {
        legend.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);">
                <i class="bi bi-cloud-slash"></i>
                <span>Couldn't load station data</span>
                <button class="ds-retry-btn" onclick="location.reload()" style="margin:0;padding:4px 10px;">Retry</button>
            </div>`;
    }
}

function renderMarkers(stations, prediction) {
    const recId = prediction.recommended.station_id;

    // Build prediction lookup
    const predMap = {};
    prediction.stations.forEach(s => { predMap[s.station_id] = s; });

    stations.forEach((st, idx) => {
        const pred = predMap[st.station_id];
        const docks = pred ? pred.predicted_empty_docks : (st.empty_docks || 0);
        const confidence = pred ? pred.confidence : null;
        const walkMin = pred ? pred.walk_to_destination_min : Math.round((st.walking_duration_s || 0) / 60);
        const isRec = st.station_id === recId;
        const color = isRec ? COLORS.info : dockColor(docks);
        const radius = isRec ? 9 : Math.max(5, Math.min(9, 5 + docks * 0.3));

        const marker = L.circleMarker([st.latitude, st.longitude], {
            radius,
            fillColor: color,
            color: isDarkMode() ? '#444' : '#fff',
            weight: 1.5,
            fillOpacity: 0,
        }).addTo(map);

        // Fade in markers with stagger
        setTimeout(() => {
            marker.setStyle({ fillOpacity: 0.9 });
        }, 80 + idx * 30);

        marker.bindPopup(buildPopup(st, docks, confidence, walkMin, isRec, prediction.timestamp), {
            closeButton: false,
            className: 'station-popup-wrapper',
        });

        marker._baseRadius = radius;
        markers[st.station_id] = marker;

        // Hover: enlarge marker
        marker.on('mouseover', () => {
            marker.setStyle({ radius: radius + 4, weight: 3, fillOpacity: 1 });
            marker.bringToFront();
        });
        marker.on('mouseout', () => {
            if (!marker.isPopupOpen()) {
                marker.setStyle({ radius, weight: 1.5, fillOpacity: 0.9 });
            }
        });
        marker.on('popupclose', () => {
            marker.setStyle({ radius, weight: 1.5, fillOpacity: 0.9 });
        });

        // Dashed ring around recommended
        if (isRec) {
            recRing = L.circleMarker([st.latitude, st.longitude], {
                radius: 18,
                fill: false,
                color: COLORS.info,
                weight: 2,
                dashArray: '4, 4',
            }).addTo(map);
        }
    });
}

function buildPopup(station, docks, confidence, walkMin, isRec, timestamp) {
    const name = station.station_name.split(',')[0];
    const total = station.total_docks || '--';
    const color = dockColor(docks);
    const confText = confidence !== null ? Math.round(confidence * 100) + '% confidence' : '';

    const ts = timestamp ? new Date(timestamp) : null;
    const timeStr = ts
        ? ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : '--';

    return `<div class="station-popup">
        <div class="station-popup-name">
            ${name}
            ${isRec ? '<span class="station-popup-badge">Recommended</span>' : ''}
        </div>
        <div class="station-popup-docks">
            <span class="station-popup-docks-num" style="color: ${color};">${docks}</span>
            <span class="station-popup-docks-label">predicted empty docks / ${total} total</span>
        </div>
        <div class="station-popup-meta">
            <div class="station-popup-meta-row">
                <i class="bi bi-person-walking"></i> ${walkMin} min walk to Imperial
            </div>
            ${confText ? `<div class="station-popup-meta-row"><i class="bi bi-bullseye"></i> ${confText}</div>` : ''}
            <div class="station-popup-meta-row">
                <i class="bi bi-clock"></i> Prediction at ${timeStr}
            </div>
        </div>
    </div>`;
}

function updateTimestamp(timestamp) {
    const el = document.getElementById('map-prediction-time');
    if (!el || !timestamp) return;
    const t = new Date(timestamp);
    const timeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `Prediction for ${timeStr}`;
}

function dockColor(docks) {
    if (docks === 0) return COLORS.danger;
    if (docks <= 2) return COLORS.warning;
    return COLORS.success;
}
