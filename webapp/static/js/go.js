/* Door2Dock -- Go Tab (4-state: direction x timing, desktop map) */

import { getPredictionNow, getPredictionPlan, getStations } from './api/client.js';

// -- State --
let direction = 'to';   // 'to' | 'from'
let timing = 'now';     // 'now' | 'plan'
let predictionData = null;
let stationsData = [];
let planData = null;
let map = null;
let mapMarkers = {};
let mapLayers = {};
let tileLayer = null;
let mobileMap = null;
let mobileMapMarkers = {};
let mobileMapLayers = {};
let mobileView = 'list'; // 'list' | 'map'

const IMPERIAL = [51.498099, -0.174956];
const DESKTOP_BP = 1024;
const TILES_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

const COLORS = {
    danger: '#E24B4A',
    warning: '#BA7517',
    success: '#1D9E75',
    info: '#378ADD',
};

const STATE_IDS = ['state-to-now', 'state-from-now', 'state-to-plan', 'state-from-plan'];

// Sort state
let toNowSort = 'preference';
let fromNowSort = 'preference';

// Preference station IDs from settings
function getPreferenceIds() {
    try {
        const raw = localStorage.getItem('ds_station_order');
        if (raw) {
            const ids = JSON.parse(raw);
            if (Array.isArray(ids) && ids.length > 0) return ids;
        }
    } catch { /* ignore */ }
    return [];
}

function preferenceIndex(stationId) {
    const ids = getPreferenceIds();
    const idx = ids.indexOf(stationId);
    return idx >= 0 ? idx : 9999;
}

// -- Init --
document.addEventListener('DOMContentLoaded', () => {
    autoDetectDirection();
    handleDeepLink();
    setupToggles();
    setupPlanForms();
    setupSortButtons();
    setupMobileViewToggle();
    switchState();
    initDesktopMap();
    window.addEventListener('resize', onResize);
});

// -- Deep link --
function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('direction');
    const t = params.get('timing') || params.get('mode');
    if (d === 'to' || d === 'from') direction = d;
    if (t === 'now') timing = 'now';
    else if (t === 'plan') timing = 'plan';
    // Keep timing param in URL for nav active state

    syncToggleUI();
}

// -- Auto-detect direction: before noon -> To Imperial, after -> From Imperial --
function autoDetectDirection() {
    const hour = new Date().getHours();
    direction = hour < 12 ? 'to' : 'from';
    syncToggleUI();
}

// -- Toggle wiring --
function setupToggles() {
    wireToggle('btn-to', 'to');
    wireToggle('btn-from', 'from');
}

function wireToggle(btnId, dir) {
    const el = document.getElementById(btnId);
    if (!el) return;
    el.addEventListener('click', () => {
        if (direction === dir) return;
        onDirectionSwitch();
        direction = dir;
        syncToggleUI();
        switchState();
    });
}

function onDirectionSwitch() {
    // Clear stale plan results when switching direction
    if (timing === 'plan') {
        planData = null;
        ['to-plan-result', 'from-plan-result'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        ['to-plan-empty', 'from-plan-empty'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
        // Clear map markers and show overlay
        if (map) clearMapLayers();
        const overlay = document.getElementById('plan-map-overlay');
        if (overlay) overlay.style.display = '';
    }
}

function syncToggleUI() {
    setActiveBtn('btn-to', direction === 'to');
    setActiveBtn('btn-from', direction === 'from');
}

function setActiveBtn(id, active) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', active);
}

// -- Sort button wiring --
function setupSortButtons() {
    setupSortFor('to-now-sort', (sort) => {
        toNowSort = sort;
        if (predictionData) renderToNowStations(predictionData.stations, predictionData.recommended.station_id);
    });
    setupSortFor('from-now-sort', (sort) => {
        fromNowSort = sort;
        if (stationsData.length) {
            const sorted = [...stationsData].sort((a, b) => a.walking_distance_m - b.walking_distance_m);
            const best = sorted.find(s => s.available_bikes > 0) || sorted[0];
            const others = stationsData.filter(s => s.station_id !== (best ? best.station_id : null));
            renderFromNowStations(others, best ? best.station_id : null);
        }
    });
}

function setupSortFor(containerId, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            onChange(btn.dataset.sort);
        });
    });
}

// -- Mobile view toggle (list / map) --
function setupMobileViewToggle() {
    const listBtn = document.getElementById('btn-list-view');
    const mapBtn = document.getElementById('btn-map-view');
    if (!listBtn || !mapBtn) return;

    listBtn.addEventListener('click', () => {
        if (mobileView === 'list') return;
        mobileView = 'list';
        syncMobileView();
    });
    mapBtn.addEventListener('click', () => {
        if (mobileView === 'map') return;
        mobileView = 'map';
        syncMobileView();
    });
}

function syncMobileView() {
    const listBtn = document.getElementById('btn-list-view');
    const mapBtn = document.getElementById('btn-map-view');
    if (listBtn) listBtn.classList.toggle('active', mobileView === 'list');
    if (mapBtn) mapBtn.classList.toggle('active', mobileView === 'map');

    const activeStateEl = document.getElementById(`state-${direction}-now`);
    const mobileMapContainer = document.getElementById('mobile-map-container');

    if (mobileView === 'map') {
        // Hide station list content, show mobile map
        if (activeStateEl) activeStateEl.style.display = 'none';
        if (mobileMapContainer) {
            mobileMapContainer.style.display = '';
            initMobileMap();
        }
    } else {
        // Show station list, hide mobile map
        if (activeStateEl) activeStateEl.style.display = '';
        if (mobileMapContainer) mobileMapContainer.style.display = 'none';
    }
}

// -- Mobile map --
function initMobileMap() {
    const container = document.getElementById('mobile-map');
    if (!container) return;

    if (!mobileMap) {
        mobileMap = L.map(container, {
            zoomControl: true,
            scrollWheelZoom: true,
            attributionControl: false,
        }).setView(IMPERIAL, 15);

        L.tileLayer(isDarkMode() ? TILES_DARK : TILES_LIGHT, { maxZoom: 19 }).addTo(mobileMap);

        const markerFill = isDarkMode() ? '#E8E8E8' : '#333';
        L.circleMarker(IMPERIAL, {
            radius: 7, fillColor: markerFill, color: isDarkMode() ? '#444' : '#fff', weight: 2, fillOpacity: 0.9,
        }).addTo(mobileMap).bindPopup('<strong>Imperial College London</strong>');
    }

    setTimeout(() => mobileMap.invalidateSize(), 100);
    renderMobileMapMarkers();
}

function renderMobileMapMarkers() {
    if (!mobileMap) return;

    // Clear existing
    Object.values(mobileMapMarkers).forEach(m => mobileMap.removeLayer(m));
    Object.values(mobileMapLayers).forEach(l => mobileMap.removeLayer(l));
    mobileMapMarkers = {};
    mobileMapLayers = {};

    if (direction === 'to' && predictionData) {
        const recId = predictionData.recommended.station_id;
        const predMap = {};
        predictionData.stations.forEach(s => { predMap[s.station_id] = s; });

        stationsData.forEach(st => {
            const pred = predMap[st.station_id];
            if (!pred) return;
            const docks = Math.round(pred.predicted_empty_docks);
            const color = dockColor(docks);
            const isRec = st.station_id === recId;
            const radius = isRec ? 8 : 6;

            const marker = L.circleMarker([st.latitude, st.longitude], {
                radius, fillColor: isRec ? COLORS.info : color, color: '#fff', weight: 1.5, fillOpacity: 0.9,
            }).addTo(mobileMap);

            marker.bindPopup(
                `<strong>${shortName(st.station_name)}</strong><br>` +
                `<span style="color:${color}; font-size:1.3em; font-weight:500;">${docks}</span> predicted docks<br>` +
                `<small>${formatWalk(pred.walk_to_destination_min, pred.walking_distance_m)} walk to uni</small>`
            );
            mobileMapMarkers[st.station_id] = marker;

            if (isRec) {
                mobileMapLayers.recRing = L.circleMarker([st.latitude, st.longitude], {
                    radius: 16, fill: false, color: COLORS.info, weight: 2, dashArray: '4, 4',
                }).addTo(mobileMap);
            }
        });
    } else if (direction === 'from' && stationsData.length) {
        const sorted = [...stationsData].sort((a, b) => a.walking_distance_m - b.walking_distance_m);
        const best = sorted.find(s => s.available_bikes > 0) || sorted[0];
        const bestId = best ? best.station_id : null;

        sorted.forEach(st => {
            const bikes = st.available_bikes;
            const color = bikeColor(bikes);
            const isBest = st.station_id === bestId;
            const radius = isBest ? 8 : 6;

            const marker = L.circleMarker([st.latitude, st.longitude], {
                radius, fillColor: isBest ? COLORS.success : color, color: '#fff', weight: 1.5, fillOpacity: 0.9,
            }).addTo(mobileMap);

            const walkMinMobile = Math.round(st.walking_duration_s / 60);
            marker.bindPopup(
                `<strong>${shortName(st.station_name)}</strong><br>` +
                `<span style="color:${color}; font-size:1.3em; font-weight:500;">${bikes}</span> bikes available<br>` +
                `<small>${formatWalk(walkMinMobile, st.walking_distance_m)} walk from uni</small>`
            );
            mobileMapMarkers[st.station_id] = marker;

            if (isBest) {
                mobileMapLayers.recRing = L.circleMarker([st.latitude, st.longitude], {
                    radius: 16, fill: false, color: COLORS.success, weight: 2, dashArray: '4, 4',
                }).addTo(mobileMap);
            }
        });
    }
}

// -- State switching --
function switchState() {
    const activeId = `state-${direction}-${timing}`;

    STATE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (id === activeId) {
            // On mobile map view in Now mode, keep state hidden (map is shown instead)
            if (!isDesktop() && timing === 'now' && mobileView === 'map') {
                el.style.display = 'none';
            } else {
                el.style.display = '';
            }
            el.classList.add('fade-in');
            setTimeout(() => el.classList.remove('fade-in'), 250);
        } else {
            el.style.display = 'none';
        }
    });

    // Show/hide mobile view toggle (only in Now mode on mobile)
    const viewToggle = document.getElementById('view-toggle');
    if (viewToggle) {
        viewToggle.style.display = (!isDesktop() && timing === 'now') ? '' : 'none';
    }

    // Hide mobile map when switching to Plan mode
    const mobileMapContainer = document.getElementById('mobile-map-container');
    if (mobileMapContainer && timing === 'plan') {
        mobileMapContainer.style.display = 'none';
    }

    // On mobile Now mode with map view, keep map visible
    if (!isDesktop() && timing === 'now' && mobileView === 'map') {
        if (mobileMapContainer) mobileMapContainer.style.display = '';
    }

    // Desktop right panel
    switchDesktopRightPanel(timing === 'plan' ? 'plan' : 'now');

    // Load data for this state
    const stateKey = `${direction}-${timing}`;
    if (stateKey === 'to-now') loadToNow();
    else if (stateKey === 'from-now') loadFromNow();
    else if (stateKey === 'to-plan') { /* form already set up, no auto-load */ }
    else if (stateKey === 'from-plan') { /* form already set up, no auto-load */ }
}

// ====================================================
// STATE 1: To Imperial + Now
// ====================================================

async function loadToNow() {
    const skeleton = document.getElementById('to-now-skeleton');
    const hero = document.getElementById('to-now-hero');
    const errorEl = document.getElementById('to-now-error');
    const allFullEl = document.getElementById('to-now-all-full');

    skeleton.style.display = '';
    hero.style.display = 'none';
    errorEl.style.display = 'none';
    allFullEl.style.display = 'none';

    try {
        const [data, stns] = await Promise.all([getPredictionNow(), getStations()]);
        predictionData = data;
        stationsData = stns;

        const allFull = data.stations.every(s => s.predicted_empty_docks === 0);
        if (allFull) allFullEl.style.display = '';

        skeleton.style.display = 'none';
        hero.style.display = '';
        hero.classList.add('fade-in');
        setTimeout(() => hero.classList.remove('fade-in'), 250);

        renderToNowHero(data.recommended);
        renderToNowWeather(data.weather);
        renderToNowStations(data.stations, data.recommended.station_id);
        if (map) renderMapMarkers();
        if (mobileMap) renderMobileMapMarkers();
    } catch (e) {
        console.error('Failed to load prediction:', e);
        skeleton.style.display = 'none';
        errorEl.style.display = '';
    }

    const retryBtn = document.getElementById('to-now-retry-btn');
    if (retryBtn) retryBtn.onclick = () => loadToNow();
}

function renderToNowHero(rec) {
    document.getElementById('to-now-name').textContent = shortName(rec.station_name);
    document.getElementById('to-now-docks').textContent = Math.round(rec.predicted_empty_docks);
    document.getElementById('to-now-walk').textContent = formatWalk(rec.walk_to_destination_min, rec.walking_distance_m);

    const total = rec.total_trip_min;
    const walk = rec.walk_to_destination_min;
    const cycle = 15;
    const dock = Math.max(1, total - cycle - walk);
    document.getElementById('to-now-trip').textContent =
        `Total: ~${total} min (cycle ${cycle} + dock ${dock} + walk ${walk})`;
}

function renderToNowWeather(weather) {
    const icon = weatherIcon(weather.description);
    const iconEl = document.querySelector('#to-now-weather i');
    if (iconEl) iconEl.className = `bi bi-${icon}`;
    const textEl = document.getElementById('to-now-weather-text');
    if (textEl) textEl.textContent =
        `${weather.temperature}\u00B0C, ${weather.description} \u00B7 ${weather.effect}`;
}

function renderToNowStations(stations, recommendedId) {
    const container = document.getElementById('to-now-stations');
    // Filter out recommended station for alternatives list
    let alts = stations.filter(s => s.station_id !== recommendedId);
    if (toNowSort === 'preference') {
        alts = [...alts].sort((a, b) => preferenceIndex(a.station_id) - preferenceIndex(b.station_id));
    } else if (toNowSort === 'distance') {
        alts = [...alts].sort((a, b) => (a.walk_to_destination_min || 99) - (b.walk_to_destination_min || 99));
    } else {
        alts = [...alts].sort((a, b) => b.predicted_empty_docks - a.predicted_empty_docks);
    }
    container.innerHTML = alts.map(s => {
        const rounded = Math.round(s.predicted_empty_docks);
        const dockCls = dockColorClass(rounded);
        const isFull = rounded === 0;
        return `
        <div class="station-row"
             data-station="${s.station_id}"
             onmouseenter="window._goHighlight('${s.station_id}')"
             onmouseleave="window._goUnhighlight('${s.station_id}')">
            <div class="station-row-left">
                <div class="station-row-name">${shortName(s.station_name)}</div>
                <div class="station-row-meta">
                    <i class="bi bi-person-walking"></i>
                    ${formatWalk(s.walk_to_destination_min, s.walking_distance_m)} to uni
                </div>
            </div>
            <div class="station-row-right">
                <div class="station-row-docks">
                    <span class="dock-number ${dockCls}">${Math.round(s.predicted_empty_docks)}</span>
                    ${isFull ? '<span class="dock-sublabel">likely full</span>' : '<span class="dock-label">empty docks</span>'}
                </div>
            </div>
        </div>`;
    }).join('');
}

// ====================================================
// STATE 2: From Imperial + Now
// ====================================================

async function loadFromNow() {
    const skeleton = document.getElementById('from-now-skeleton');
    const hero = document.getElementById('from-now-hero');
    const errorEl = document.getElementById('from-now-error');

    skeleton.style.display = '';
    hero.style.display = 'none';
    errorEl.style.display = 'none';

    try {
        const stns = await getStations();
        stationsData = stns;

        // Sort by walking distance
        const sorted = [...stns].sort((a, b) => a.walking_distance_m - b.walking_distance_m);
        // Find nearest with available bikes
        const best = sorted.find(s => s.available_bikes > 0) || sorted[0];

        skeleton.style.display = 'none';
        hero.style.display = '';
        hero.classList.add('fade-in');
        setTimeout(() => hero.classList.remove('fade-in'), 250);

        document.getElementById('from-now-name').textContent = shortName(best.station_name);
        document.getElementById('from-now-bikes').textContent = best.available_bikes;
        const walkMin = Math.round(best.walking_duration_s / 60);
        document.getElementById('from-now-walk').textContent = formatWalk(walkMin, best.walking_distance_m);

        // Render other stations
        const others = sorted.filter(s => s.station_id !== best.station_id);
        renderFromNowStations(others, best.station_id);

        // Update map for From mode
        if (map) renderMapMarkersFrom(sorted, best.station_id);
        if (mobileMap) renderMobileMapMarkers();
    } catch (e) {
        console.error('Failed to load stations:', e);
        skeleton.style.display = 'none';
        errorEl.style.display = '';
    }

    const retryBtn = document.getElementById('from-now-retry-btn');
    if (retryBtn) retryBtn.onclick = () => loadFromNow();
}

function renderFromNowStations(stations, bestId) {
    const container = document.getElementById('from-now-stations');
    let sorted;
    if (fromNowSort === 'preference') {
        sorted = [...stations].sort((a, b) => preferenceIndex(a.station_id) - preferenceIndex(b.station_id));
    } else if (fromNowSort === 'distance') {
        sorted = [...stations].sort((a, b) => (a.walking_duration_s || 9999) - (b.walking_duration_s || 9999));
    } else {
        sorted = [...stations].sort((a, b) => b.available_bikes - a.available_bikes);
    }
    container.innerHTML = sorted.map(s => {
        const bikeCls = bikeColorClass(s.available_bikes);
        const walkMin = Math.round(s.walking_duration_s / 60);
        return `
        <div class="station-row"
             data-station="${s.station_id}"
             onmouseenter="window._goHighlight('${s.station_id}')"
             onmouseleave="window._goUnhighlight('${s.station_id}')">
            <div class="station-row-left">
                <div class="station-row-name">${shortName(s.station_name)}</div>
                <div class="station-row-meta">
                    <i class="bi bi-person-walking"></i>
                    ${formatWalk(walkMin, s.walking_distance_m)} from uni
                </div>
            </div>
            <div class="station-row-right">
                <div class="station-row-docks">
                    <span class="dock-number ${bikeCls}">${s.available_bikes}</span>
                    ${s.available_bikes === 0 ? '<span class="dock-sublabel">no bikes</span>' : '<span class="dock-label">bikes</span>'}
                </div>
            </div>
        </div>`;
    }).join('');
}

// ====================================================
// PLAN FORMS (shared setup for To Plan + From Plan)
// ====================================================

function setupPlanForms() {
    setupPlanFormFor('to-plan');
    setupPlanFormFor('from-plan');

    // Wire scan buttons
    document.getElementById('to-plan-scan-btn').addEventListener('click', () => loadToPlan());
    document.getElementById('from-plan-scan-btn').addEventListener('click', () => loadFromPlan());
}

function setupPlanFormFor(prefix) {
    const hourSel = document.getElementById(`${prefix}-hour`);
    const minSel = document.getElementById(`${prefix}-minute`);
    const daysContainer = document.getElementById(`${prefix}-days`);

    // Populate hours (0-23)
    for (let h = 0; h <= 23; h++) {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = String(h).padStart(2, '0');
        if (h === 10) opt.selected = true;
        hourSel.appendChild(opt);
    }

    // Populate minutes
    for (let m = 0; m < 60; m += 5) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = String(m).padStart(2, '0');
        if (m === 15) opt.selected = true;
        minSel.appendChild(opt);
    }

    // Populate days
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const btn = document.createElement('button');
        btn.className = 'plan-day-btn' + (i === 1 ? ' active' : '');
        btn.dataset.date = d.toISOString().split('T')[0];
        btn.textContent = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[d.getDay()];
        btn.addEventListener('click', () => {
            daysContainer.querySelectorAll('.plan-day-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
        daysContainer.appendChild(btn);
    }
}

function getSelectedTime(prefix) {
    const hour = parseInt(document.getElementById(`${prefix}-hour`).value);
    const min = parseInt(document.getElementById(`${prefix}-minute`).value);

    const activeDay = document.querySelector(`#${prefix}-days .plan-day-btn.active`);
    const date = activeDay ? activeDay.dataset.date : new Date().toISOString().split('T')[0];

    return `${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;
}

function getSelectedTimeDisplay(prefix) {
    const h = parseInt(document.getElementById(`${prefix}-hour`).value);
    const m = parseInt(document.getElementById(`${prefix}-minute`).value);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ====================================================
// STATE 3: To Imperial + Plan trip
// ====================================================

async function loadToPlan() {
    const btn = document.getElementById('to-plan-scan-btn');
    const emptyState = document.getElementById('to-plan-empty');
    const resultEl = document.getElementById('to-plan-result');
    btn.classList.add('loading');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Calculating...';
    // Hide empty state and previous result, show loading in result area
    if (emptyState) emptyState.style.display = 'none';
    if (resultEl) resultEl.style.display = 'none';
    try {
        const [data, stns] = await Promise.all([
            getPredictionPlan({ arriveBy: getSelectedTime('to-plan'), mode: 'arrive' }),
            stationsData.length ? Promise.resolve(stationsData) : getStations(),
        ]);
        planData = data;
        if (!stationsData.length) stationsData = stns;
        renderToPlanResult(data);
        renderPlanWeather('to-plan', data.weather_forecast);
        if (isDesktop()) renderMapMarkersPlan();
    } catch (e) {
        console.error('Failed to load plan:', e);
    } finally {
        btn.classList.remove('loading');
        btn.innerHTML = '<i class="bi bi-search"></i> Get recommendation';
    }
}

function renderToPlanResult(data) {
    const emptyState = document.getElementById('to-plan-empty');
    if (emptyState) emptyState.style.display = 'none';
    document.getElementById('to-plan-result').style.display = '';

    // Leave by
    const leaveTime = new Date(data.leave_by);
    const leaveStr = leaveTime.toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
    document.getElementById('to-plan-leave-by').textContent = leaveStr;

    // Subtitle
    const stn = shortName(data.recommended_station.station_name);
    document.getElementById('to-plan-subtitle').textContent =
        `Dock at ${stn} \u00B7 ${formatWalk(data.recommended_station.walk_to_destination_min, data.recommended_station.walking_distance_m)} walk to uni`;

    // Timeline bar
    const bd = data.breakdown;
    document.getElementById('to-plan-tl-cycle').style.flex = bd.cycle_min;
    document.getElementById('to-plan-tl-dock').style.flex = bd.dock_min;
    document.getElementById('to-plan-tl-walk').style.flex = bd.walk_min;

    document.getElementById('to-plan-tl-labels').innerHTML = `
        <div class="plan-tl-label" style="flex:${bd.cycle_min}">
            <span class="plan-tl-label-dot" style="background:var(--info)"></span>
            Cycle ${bd.cycle_min}m
        </div>
        <div class="plan-tl-label" style="flex:${bd.dock_min}">
            <span class="plan-tl-label-dot" style="background:var(--warning)"></span>
            Dock ${bd.dock_min}m
        </div>
        <div class="plan-tl-label" style="flex:${bd.walk_min}">
            <span class="plan-tl-label-dot" style="background:var(--success)"></span>
            Walk ${bd.walk_min}m
        </div>`;

    // Arrival strip
    const arrivalTime = new Date(bd.arrival_time);
    const arrStr = arrivalTime.toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const targetStr = getSelectedTimeDisplay('to-plan');
    document.getElementById('to-plan-arrival-strip').textContent =
        `Arrives ${arrStr} \u00B7 ${bd.buffer_min} min buffer before ${targetStr}`;

    // Why not closer
    const whyEl = document.getElementById('to-plan-why');
    if (data.why_not_closer) {
        whyEl.style.display = '';
        document.getElementById('to-plan-why-text').textContent = data.why_not_closer;
    } else {
        whyEl.style.display = 'none';
    }

    // Alternatives
    renderAlternatives('to-plan-alternatives', data.alternatives_at_target_time, 'blue');
}

// ====================================================
// STATE 4: From Imperial + Plan trip
// ====================================================

async function loadFromPlan() {
    const btn = document.getElementById('from-plan-scan-btn');
    const emptyState = document.getElementById('from-plan-empty');
    const resultEl = document.getElementById('from-plan-result');
    btn.classList.add('loading');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Calculating...';
    if (emptyState) emptyState.style.display = 'none';
    if (resultEl) resultEl.style.display = 'none';
    try {
        const [data, stns] = await Promise.all([
            getPredictionPlan({ arriveBy: getSelectedTime('from-plan'), mode: 'depart' }),
            stationsData.length ? Promise.resolve(stationsData) : getStations(),
        ]);
        planData = data;
        if (!stationsData.length) stationsData = stns;
        renderFromPlanResult(data);
        renderPlanWeather('from-plan', data.weather_forecast);
        if (isDesktop()) renderMapMarkersPlan();
    } catch (e) {
        console.error('Failed to load from-plan:', e);
    } finally {
        btn.classList.remove('loading');
        btn.innerHTML = '<i class="bi bi-search"></i> Get recommendation';
    }
}

function renderFromPlanResult(data) {
    const emptyState = document.getElementById('from-plan-empty');
    if (emptyState) emptyState.style.display = 'none';
    document.getElementById('from-plan-result').style.display = '';

    const rec = data.recommended_station;
    document.getElementById('from-plan-name').textContent = shortName(rec.station_name);
    // For "from" mode, predicted_empty_docks represents predicted available bikes
    // (the backend will return the appropriate value based on mode)
    const predicted = rec.predicted_empty_docks;
    document.getElementById('from-plan-bikes').textContent = Math.round(predicted);

    const targetStr = getSelectedTimeDisplay('from-plan');
    document.getElementById('from-plan-bikes-label').textContent = `predicted bikes at ${targetStr}`;

    document.getElementById('from-plan-walk').textContent = formatWalk(rec.walk_to_destination_min, rec.walking_distance_m);

    // Alternatives
    renderAlternatives('from-plan-alternatives', data.alternatives_at_target_time, 'green');
}

// ====================================================
// SHARED RENDERERS
// ====================================================

function renderAlternatives(containerId, alts, theme) {
    const container = document.getElementById(containerId);
    const recClass = theme === 'green' ? 'alt-recommended-green' : 'alt-recommended';
    const isFrom = theme === 'green';
    container.innerHTML = alts.map(a => {
        const isRec = a.reason === 'recommended';
        const rp = Math.round(a.predicted);
        const colorCls = isFrom ? bikeColorClass(rp) : dockColorClass(rp);
        const zeroLabel = isFrom ? 'no bikes' : 'likely full';
        const unitLabel = isFrom ? 'bikes' : 'docks';
        const walkLabel = isFrom ? 'from uni' : 'to uni';
        const walkText = a.walking_distance_m
            ? formatWalk(a.walk_to_destination_min, a.walking_distance_m) + ' ' + walkLabel
            : a.reason;
        return `
        <div class="alt-row${isRec ? ' ' + recClass : ''}">
            <div class="alt-row-left">
                <div class="alt-row-name">${shortName(a.station_name)}</div>
                <div class="alt-row-reason"><i class="bi bi-person-walking"></i> ${walkText}</div>
            </div>
            <div class="alt-row-right">
                <div class="station-row-docks">
                    <span class="dock-number ${colorCls}">${rp}</span>
                    ${rp === 0 ? `<span class="dock-sublabel">${zeroLabel}</span>` : `<span class="dock-label">${unitLabel}</span>`}
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderPlanWeather(prefix, forecast) {
    if (!forecast) return;
    const icon = weatherIcon(forecast.description);
    const stripIcon = document.querySelector(`#${prefix}-weather i`);
    if (stripIcon) stripIcon.className = `bi bi-${icon}`;
    const textEl = document.getElementById(`${prefix}-weather-text`);
    if (textEl) {
        textEl.textContent =
            `${forecast.temperature}\u00B0C, ${forecast.description} \u00B7 ` +
            `${forecast.precipitation_mm}mm rain \u00B7 ${forecast.wind_speed} m/s wind`;
    }
}

// ====================================================
// DESKTOP RIGHT PANEL
// ====================================================

function switchDesktopRightPanel(mode) {
    const mapView = document.getElementById('go-right-map');
    if (!mapView) return;

    // Map is always visible
    mapView.style.display = 'flex';
    const overlay = document.getElementById('plan-map-overlay');

    if (mode === 'plan') {
        // Plan mode: show overlay if no plan data, otherwise render plan markers
        if (planData) {
            if (overlay) overlay.style.display = 'none';
            renderMapMarkersPlan();
        } else {
            if (overlay) overlay.style.display = '';
            if (map) clearMapLayers();
        }
    } else {
        // Now mode: hide overlay, markers are rendered by loadToNow/loadFromNow
        if (overlay) overlay.style.display = 'none';
    }
    if (map) setTimeout(() => map.invalidateSize(), 50);
}

// -- Plan map (desktop right panel) — map with predicted availability --
function renderMapMarkersPlan() {
    if (!planData || !map) return;

    clearMapLayers();

    // Hide overlay
    const overlay = document.getElementById('plan-map-overlay');
    if (overlay) overlay.style.display = 'none';

    const isFrom = direction === 'from';
    const alts = planData.alternatives_at_target_time;
    const recId = planData.recommended_station ? planData.recommended_station.station_id : null;

    // Build station lookup for lat/lng
    const stationLookup = {};
    stationsData.forEach(s => { stationLookup[s.station_id] = s; });

    alts.forEach(a => {
        const st = stationLookup[a.station_id];
        if (!st) return;

        const predicted = Math.round(a.predicted);
        const isRec = a.reason === 'recommended';
        const color = isRec
            ? (isFrom ? COLORS.success : COLORS.info)
            : (isFrom ? bikeColor(predicted) : dockColor(predicted));
        const radius = isRec ? 9 : Math.max(5, Math.min(9, 5 + predicted * 0.3));

        const marker = L.circleMarker([st.latitude, st.longitude], {
            radius,
            fillColor: color,
            color: isDarkMode() ? '#444' : '#fff',
            weight: 1.5,
            fillOpacity: 0.9,
        }).addTo(map);

        const unit = isFrom ? 'bikes' : 'empty docks';
        const walkLabel = isFrom ? 'from uni' : 'to uni';
        const walkText = a.walking_distance_m
            ? formatWalk(a.walk_to_destination_min, a.walking_distance_m)
            : '';

        marker.bindPopup(
            `<strong>${shortName(a.station_name)}</strong>` +
            `${isRec ? ' <span style="color:' + color + '; font-size:10px;">(recommended)</span>' : ''}<br>` +
            `<span style="color:${color}; font-size:1.3em; font-weight:500;">${predicted}</span> predicted ${unit}<br>` +
            (walkText ? `<small><i class="bi bi-person-walking"></i> ${walkText} ${walkLabel}</small>` : '')
        );

        marker._baseRadius = radius;
        mapMarkers[a.station_id] = marker;

        // Hover effects
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
            mapLayers.recRing = L.circleMarker([st.latitude, st.longitude], {
                radius: 18,
                fill: false,
                color: color,
                weight: 2,
                dashArray: '4, 4',
            }).addTo(map);

            mapLayers.route = L.polyline(
                curvedPath(isFrom ? IMPERIAL : [st.latitude, st.longitude], isFrom ? [st.latitude, st.longitude] : IMPERIAL),
                { color: color, weight: 1.5, dashArray: '6, 6', opacity: 0.5 }
            ).addTo(map);
        }
    });
}

// ====================================================
// DESKTOP MAP
// ====================================================

function isDesktop() {
    return window.innerWidth >= DESKTOP_BP;
}

function initDesktopMap() {
    if (!isDesktop()) return;
    createMap();
}

function onResize() {
    if (isDesktop() && !map) createMap();
    if (map) map.invalidateSize();
}

function createMap() {
    const container = document.getElementById('go-map');
    if (!container || map) return;

    map = L.map(container, {
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: false,
    }).setView(IMPERIAL, 15);

    tileLayer = L.tileLayer(isDarkMode() ? TILES_DARK : TILES_LIGHT, {
        maxZoom: 19,
    }).addTo(map);

    const markerFill = isDarkMode() ? '#E8E8E8' : '#333';
    L.circleMarker(IMPERIAL, {
        radius: 7, fillColor: markerFill, color: isDarkMode() ? '#444' : '#fff', weight: 2, fillOpacity: 0.9,
    }).addTo(map).bindPopup('<strong>Imperial College London</strong>');

    if (timing === 'plan' && planData) {
        renderMapMarkersPlan();
    } else if (predictionData && direction === 'to') {
        renderMapMarkers();
    } else if (stationsData.length && direction === 'from') {
        const sorted = [...stationsData].sort((a, b) => a.walking_distance_m - b.walking_distance_m);
        const best = sorted.find(s => s.available_bikes > 0) || sorted[0];
        renderMapMarkersFrom(sorted, best ? best.station_id : null);
    }
    setTimeout(() => map.invalidateSize(), 100);
}

function renderMapMarkers() {
    if (!map || !predictionData) return;

    const recId = predictionData.recommended.station_id;

    clearMapLayers();

    const predMap = {};
    predictionData.stations.forEach(s => { predMap[s.station_id] = s; });

    stationsData.forEach(st => {
        const pred = predMap[st.station_id];
        if (!pred) return;

        const docks = Math.round(pred.predicted_empty_docks);
        const color = dockColor(docks);
        const isRec = st.station_id === recId;
        const radius = isRec ? 8 : 6;

        const marker = L.circleMarker([st.latitude, st.longitude], {
            radius,
            fillColor: isRec ? COLORS.info : color,
            color: '#fff',
            weight: 1.5,
            fillOpacity: 0.9,
        }).addTo(map);

        marker.bindPopup(
            `<strong>${shortName(st.station_name)}</strong><br>` +
            `<span style="color:${color}; font-size:1.3em; font-weight:500;">${docks}</span> predicted docks<br>` +
            `<small>${formatWalk(pred.walk_to_destination_min, pred.walking_distance_m)} walk to uni</small>`
        );

        marker._baseRadius = radius;
        mapMarkers[st.station_id] = marker;

        if (isRec) {
            mapLayers.recRing = L.circleMarker([st.latitude, st.longitude], {
                radius: 16, fill: false, color: COLORS.info, weight: 2, dashArray: '4, 4',
            }).addTo(map);

            mapLayers.route = L.polyline(
                curvedPath([st.latitude, st.longitude], IMPERIAL),
                { color: COLORS.info, weight: 1.5, dashArray: '6, 6', opacity: 0.5 }
            ).addTo(map);
        }
    });
}

function renderMapMarkersFrom(stations, bestId) {
    if (!map) return;

    clearMapLayers();

    stations.forEach(st => {
        const bikes = st.available_bikes;
        const color = bikeColor(bikes);
        const isBest = st.station_id === bestId;
        const radius = isBest ? 8 : 6;

        const marker = L.circleMarker([st.latitude, st.longitude], {
            radius,
            fillColor: isBest ? COLORS.success : color,
            color: '#fff',
            weight: 1.5,
            fillOpacity: 0.9,
        }).addTo(map);

        const walkMinMap = Math.round(st.walking_duration_s / 60);
        marker.bindPopup(
            `<strong>${shortName(st.station_name)}</strong><br>` +
            `<span style="color:${color}; font-size:1.3em; font-weight:500;">${bikes}</span> bikes available<br>` +
            `<small>${formatWalk(walkMinMap, st.walking_distance_m)} walk from uni</small>`
        );

        marker._baseRadius = radius;
        mapMarkers[st.station_id] = marker;

        if (isBest) {
            mapLayers.recRing = L.circleMarker([st.latitude, st.longitude], {
                radius: 16, fill: false, color: COLORS.success, weight: 2, dashArray: '4, 4',
            }).addTo(map);

            mapLayers.route = L.polyline(
                curvedPath(IMPERIAL, [st.latitude, st.longitude]),
                { color: COLORS.success, weight: 1.5, dashArray: '6, 6', opacity: 0.5 }
            ).addTo(map);
        }
    });
}

function clearMapLayers() {
    Object.values(mapMarkers).forEach(m => map.removeLayer(m));
    Object.values(mapLayers).forEach(l => map.removeLayer(l));
    mapMarkers = {};
    mapLayers = {};
}

function curvedPath(from, to, steps = 20) {
    const midLat = (from[0] + to[0]) / 2;
    const midLng = (from[1] + to[1]) / 2;
    const dx = to[1] - from[1];
    const dy = to[0] - from[0];
    const offset = 0.0015;
    const ctrlLat = midLat + dx * offset * 10;
    const ctrlLng = midLng - dy * offset * 10;

    const points = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const lat = (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * ctrlLat + t * t * to[0];
        const lng = (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * ctrlLng + t * t * to[1];
        points.push([lat, lng]);
    }
    return points;
}

function highlightMarker(stationId) {
    const marker = mapMarkers[stationId];
    if (!marker || !map) return;
    marker.setStyle({ radius: (marker._baseRadius || 6) + 4, weight: 3, fillOpacity: 1 });
    marker.bringToFront();
    marker.openPopup();
}

function unhighlightMarker(stationId) {
    const marker = mapMarkers[stationId];
    if (!marker || !map) return;
    marker.setStyle({ radius: marker._baseRadius || 6, weight: 1.5, fillOpacity: 0.9 });
    marker.closePopup();
}

window._goHighlight = (id) => highlightMarker(id);
window._goUnhighlight = (id) => unhighlightMarker(id);

// ====================================================
// HELPERS
// ====================================================

function shortName(name) {
    return name.split(',')[0];
}

function formatWalk(walkMin, distanceM) {
    const min = walkMin || 0;
    const dist = (distanceM || 0) >= 1000
        ? ((distanceM || 0) / 1000).toFixed(1) + 'km'
        : Math.round(distanceM || 0) + 'm';
    return `${min} min (${dist})`;
}

function weatherIcon(desc) {
    const d = (desc || '').toLowerCase();
    if (d.includes('rain')) return 'cloud-rain';
    if (d.includes('cloud') || d.includes('overcast')) return 'clouds';
    if (d.includes('snow')) return 'snow';
    if (d.includes('clear') || d.includes('sun')) return 'sun';
    return 'cloud';
}

function dockColorClass(docks) {
    if (docks === 0) return 'dock-red';
    if (docks <= 2) return 'dock-amber';
    return 'dock-green';
}

function bikeColorClass(bikes) {
    if (bikes === 0) return 'dock-red';
    if (bikes <= 3) return 'dock-amber';
    return 'dock-green';
}

function dockColor(docks) {
    if (docks === 0) return COLORS.danger;
    if (docks <= 2) return COLORS.warning;
    return COLORS.success;
}

function bikeColor(bikes) {
    if (bikes === 0) return COLORS.danger;
    if (bikes <= 3) return COLORS.warning;
    return COLORS.success;
}

function isDarkMode() {
    if (document.documentElement.getAttribute('data-bs-theme') === 'dark') return true;
    if (document.documentElement.getAttribute('data-bs-theme') === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
