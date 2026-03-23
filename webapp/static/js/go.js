/* Door2Dock -- Go Tab (single-column, recommendation-first layout) */

import { getPredictionNow, getPredictionPlan, getStations, getWeatherCurrent } from './api/client.js';

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
let mapExpanded = false;

const IMPERIAL = [51.498099, -0.174956];
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
    setupMapExpand();
    renderSkeletonStationRows();
    switchState();
    initMap();
    window.addEventListener('resize', () => {
        if (map) map.invalidateSize();
    });
});

// -- Deep link --
function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('direction');
    const t = params.get('timing') || params.get('mode');
    if (d === 'to' || d === 'from') direction = d;
    if (t === 'now') timing = 'now';
    else if (t === 'plan') timing = 'plan';
    syncToggleUI();
}

function autoDetectDirection() {
    const hour = new Date().getHours();
    direction = hour < 12 ? 'to' : 'from';
}

function syncToggleUI() {
    document.getElementById('btn-to').classList.toggle('active', direction === 'to');
    document.getElementById('btn-from').classList.toggle('active', direction === 'from');
}

// ====================================================
// TOGGLES
// ====================================================

function setupToggles() {
    wireToggle('btn-to', 'to');
    wireToggle('btn-from', 'from');
}

function wireToggle(btnId, dir) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (direction === dir) return;
        onDirectionSwitch();
        direction = dir;
        syncToggleUI();
        switchState();
    });
}

function onDirectionSwitch() {
    if (timing === 'plan') {
        planData = null;
        ['to-plan-result', 'from-plan-result', 'to-plan-loading', 'from-plan-loading'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        ['to-plan-empty', 'from-plan-empty'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
    }
}

// ====================================================
// SORT BUTTONS
// ====================================================

function setupSortButtons() {
    setupSortFor('to-now-sort', (s) => { toNowSort = s; rerenderToNowStations(); });
    setupSortFor('from-now-sort', (s) => { fromNowSort = s; rerenderFromNowStations(); });
}

function setupSortFor(containerId, cb) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            cb(btn.dataset.sort);
        });
    });
}

let _toNowStationsCache = null;
let _fromNowStationsCache = null;

function rerenderToNowStations() {
    if (_toNowStationsCache) renderToNowStations(_toNowStationsCache.pred, _toNowStationsCache.stns);
}

function rerenderFromNowStations() {
    if (_fromNowStationsCache) renderFromNowStations(_fromNowStationsCache);
}

// ====================================================
// MAP EXPAND
// ====================================================

function setupMapExpand() {
    const btn = document.getElementById('minimap-expand');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const wrap = document.getElementById('minimap-wrap');
        mapExpanded = !mapExpanded;
        wrap.classList.toggle('expanded', mapExpanded);
        btn.title = mapExpanded ? 'Collapse map' : 'Expand map';
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = mapExpanded ? 'bi bi-arrows-angle-contract' : 'bi bi-arrows-angle-expand';
        }
        if (map) setTimeout(() => map.invalidateSize(), 350);
    });
}

// ====================================================
// STATE SWITCHING
// ====================================================

function switchState() {
    const activeId = `state-${direction}-${timing}`;

    STATE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === activeId) {
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    });

    // Show/hide station sections
    const stationsNow = document.getElementById('stations-now');
    const stationsPlan = document.getElementById('stations-plan');

    if (timing === 'now') {
        stationsNow.style.display = '';
        stationsPlan.style.display = 'none';

        // Toggle between to/from station lists
        document.getElementById('to-now-sort-row').style.display = direction === 'to' ? '' : 'none';
        document.getElementById('to-now-stations').style.display = direction === 'to' ? '' : 'none';
        document.getElementById('from-now-sort-row').style.display = direction === 'from' ? '' : 'none';
        document.getElementById('from-now-stations').style.display = direction === 'from' ? '' : 'none';
    } else {
        stationsNow.style.display = 'none';
        stationsPlan.style.display = '';

        document.getElementById('to-plan-alts-header').style.display = direction === 'to' ? '' : 'none';
        document.getElementById('to-plan-alternatives').style.display = direction === 'to' ? '' : 'none';
        document.getElementById('from-plan-alts-header').style.display = direction === 'from' ? '' : 'none';
        document.getElementById('from-plan-alternatives').style.display = direction === 'from' ? '' : 'none';

        // Show static skeleton rows in plan alt containers if no results yet
        const prefix = direction === 'to' ? 'to-plan' : 'from-plan';
        const altContainer = document.getElementById(`${prefix}-alternatives`);
        const resultEl = document.getElementById(`${prefix}-result`);
        if (altContainer && resultEl && resultEl.style.display === 'none' && !altContainer.querySelector('.alt-row')) {
            altContainer.innerHTML = Array(3).fill(buildSkeletonRow(false)).join('');
        }
    }

    // Load data
    if (direction === 'to' && timing === 'now') loadToNow();
    else if (direction === 'from' && timing === 'now') loadFromNow();

    // Update map markers if we have data
    updateMapMarkers();
}

// ====================================================
// STATE 1: To Imperial + Now
// ====================================================

async function loadToNow() {
    const skeleton = document.getElementById('to-now-skeleton');
    const hero = document.getElementById('to-now-hero');
    const error = document.getElementById('to-now-error');
    const allFull = document.getElementById('to-now-all-full');
    const weatherSkel = document.getElementById('to-now-weather-skeleton');
    const weather = document.getElementById('to-now-weather');

    skeleton.style.display = '';
    hero.style.display = 'none';
    error.style.display = 'none';
    allFull.style.display = 'none';
    weatherSkel.style.display = '';
    weather.style.display = 'none';
    showSkeletonStationRows('to-now-stations');

    try {
        const [pred, stns] = await Promise.all([
            getPredictionNow({ direction: 'to' }),
            stationsData.length ? Promise.resolve(stationsData) : getStations(),
        ]);
        predictionData = pred;
        if (!stationsData.length) stationsData = stns;
        skeleton.style.display = 'none';

        // Check if genuinely all stations are predicted full
        const allPredictedFull = !pred.recommended ||
            pred.stations.every(s => s.predicted_empty_docks <= 0);

        if (allPredictedFull) {
            allFull.style.display = '';
        } else {
            renderToNowHero(pred);
        }

        weatherSkel.style.display = 'none';
        weather.style.display = '';
        renderToNowWeather(pred.weather);
        renderToNowStations(pred, stns);
        updateMapMarkers();
    } catch (e) {
        console.error('Failed to load predictions:', e);
        skeleton.style.display = 'none';
        weatherSkel.style.display = 'none';
        error.style.display = '';
    }

    // Retry button
    const retryBtn = document.getElementById('to-now-retry-btn');
    retryBtn.onclick = () => loadToNow();
}

function renderToNowHero(pred) {
    const hero = document.getElementById('to-now-hero');
    hero.style.display = '';
    const rec = pred.recommended;
    document.getElementById('to-now-name').textContent = shortName(rec.station_name);
    document.getElementById('to-now-docks').textContent = Math.round(rec.predicted_empty_docks);
    document.getElementById('to-now-walk').textContent = formatWalk(rec.walk_to_destination_min);
    document.getElementById('to-now-trip').textContent =
        `Prediction: ${pred.prediction_horizon_min || 15} min ahead`;
}

function renderToNowWeather(w) {
    if (!w) return;
    const icon = weatherIcon(w.description);
    const stripIcon = document.querySelector('#to-now-weather i');
    if (stripIcon) stripIcon.className = `bi bi-${icon}`;
    // Prediction weather has {temperature, description, effect}
    // Plan weather has {temperature, description, precipitation_mm, wind_speed}
    let text = `${w.temperature}\u00B0C, ${w.description}`;
    if (w.precipitation_mm !== undefined) {
        text += ` \u00B7 ${w.precipitation_mm}mm rain \u00B7 ${w.wind_speed} m/s wind`;
    } else if (w.effect) {
        text += ` \u00B7 ${w.effect}`;
    }
    document.getElementById('to-now-weather-text').textContent = text;
}

function renderToNowStations(pred, stns) {
    _toNowStationsCache = { pred, stns };
    const container = document.getElementById('to-now-stations');
    const recId = pred.recommended ? pred.recommended.station_id : null;

    // Build prediction map
    const predMap = {};
    pred.stations.forEach(s => { predMap[s.station_id] = s; });

    // Build display list
    let list = stns.map(s => {
        const p = predMap[s.station_id];
        return {
            ...s,
            predicted_empty_docks: p ? Math.round(p.predicted_empty_docks) : null,
            walk_to_destination_min: p ? p.walk_to_destination_min : Math.round(s.walking_duration_s / 60),
            walking_distance_m: p ? p.walking_distance_m : s.walking_distance_m,
            isRec: s.station_id === recId,
        };
    }).filter(s => s.predicted_empty_docks !== null);

    // Sort
    if (toNowSort === 'availability') {
        list.sort((a, b) => b.predicted_empty_docks - a.predicted_empty_docks);
    } else if (toNowSort === 'distance') {
        list.sort((a, b) => a.walking_distance_m - b.walking_distance_m);
    } else {
        // preference: recommended first, then by preference, then by distance
        list.sort((a, b) => {
            if (a.isRec !== b.isRec) return a.isRec ? -1 : 1;
            const pa = preferenceIndex(a.station_id);
            const pb = preferenceIndex(b.station_id);
            if (pa !== pb) return pa - pb;
            return a.walking_distance_m - b.walking_distance_m;
        });
    }

    container.innerHTML = list.map(s => {
        const docks = s.predicted_empty_docks;
        const colorCls = dockColorClass(docks);
        const recCls = s.isRec ? ' recommended' : '';
        return `
        <div class="station-row${recCls}" data-station="${s.station_id}"
             onmouseenter="window._goHighlight('${s.station_id}')"
             onmouseleave="window._goUnhighlight('${s.station_id}')">
            <div class="station-row-left">
                <div class="station-row-name">${shortName(s.station_name)}</div>
                <div class="station-row-meta">
                    <i class="bi bi-person-walking"></i>
                    ${formatWalk(s.walk_to_destination_min)} to uni
                </div>
            </div>
            <div class="station-row-right">
                <div class="station-row-docks">
                    <span class="dock-number ${colorCls}">${docks}</span>
                    ${docks === 0 ? '<span class="dock-sublabel">likely full</span>' : '<span class="dock-label">docks</span>'}
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
    const error = document.getElementById('from-now-error');
    const weatherSkel = document.getElementById('from-now-weather-skeleton');
    const weatherEl = document.getElementById('from-now-weather');

    skeleton.style.display = '';
    hero.style.display = 'none';
    error.style.display = 'none';
    weatherSkel.style.display = '';
    weatherEl.style.display = 'none';
    showSkeletonStationRows('from-now-stations');

    try {
        const [stns, weather] = await Promise.all([
            stationsData.length ? Promise.resolve(stationsData) : getStations(),
            getWeatherCurrent().catch(() => null),
        ]);
        if (!stationsData.length) stationsData = stns;
        skeleton.style.display = 'none';

        // Sort by walking distance, pick closest with bikes
        const sorted = [...stns].sort((a, b) => a.walking_distance_m - b.walking_distance_m);
        const best = sorted.find(s => s.available_bikes > 0) || sorted[0];

        hero.style.display = '';
        document.getElementById('from-now-name').textContent = shortName(best.station_name);
        document.getElementById('from-now-bikes').textContent = best.available_bikes;
        const walkMin = Math.round(best.walking_duration_s / 60);
        document.getElementById('from-now-walk').textContent = formatWalk(walkMin);

        weatherSkel.style.display = 'none';
        weatherEl.style.display = '';
        renderFromNowWeather(weather);
        renderFromNowStations(stns);
        updateMapMarkers();
    } catch (e) {
        console.error('Failed to load stations:', e);
        skeleton.style.display = 'none';
        weatherSkel.style.display = 'none';
        error.style.display = '';
    }

    const retryBtn = document.getElementById('from-now-retry-btn');
    retryBtn.onclick = () => loadFromNow();
}

function renderFromNowWeather(w) {
    if (!w) return;
    const icon = weatherIcon(w.description || '');
    const stripIcon = document.querySelector('#from-now-weather i');
    if (stripIcon) stripIcon.className = `bi bi-${icon}`;
    let text = `${w.temperature}\u00B0C, ${w.description || 'unknown'}`;
    if (w.effect) {
        text += ` \u00B7 ${w.effect}`;
    } else {
        // from weather/current: estimate cycling context
        const temp = w.temperature;
        const desc = (w.description || '').toLowerCase();
        if (desc.includes('rain')) text += ' \u00B7 reduced bike demand';
        else if (temp >= 15) text += ' \u00B7 good cycling weather';
        else text += ' \u00B7 typical bike demand';
    }
    document.getElementById('from-now-weather-text').textContent = text;
}

function renderFromNowStations(stns) {
    _fromNowStationsCache = stns;
    const container = document.getElementById('from-now-stations');

    // Find the best station (closest with bikes) to mark as recommended
    const sortedByDist = [...stns].sort((a, b) => a.walking_distance_m - b.walking_distance_m);
    const bestStation = sortedByDist.find(s => s.available_bikes > 0) || sortedByDist[0];
    const bestId = bestStation ? bestStation.station_id : null;

    let list = stns.map(s => ({
        ...s,
        walkMin: Math.round(s.walking_duration_s / 60),
        isRec: s.station_id === bestId,
    }));

    // Sort
    if (fromNowSort === 'availability') {
        list.sort((a, b) => b.available_bikes - a.available_bikes);
    } else if (fromNowSort === 'distance') {
        list.sort((a, b) => a.walking_distance_m - b.walking_distance_m);
    } else {
        // preference: recommended first, then by preference, then distance
        list.sort((a, b) => {
            if (a.isRec !== b.isRec) return a.isRec ? -1 : 1;
            const pa = preferenceIndex(a.station_id);
            const pb = preferenceIndex(b.station_id);
            if (pa !== pb) return pa - pb;
            return a.walking_distance_m - b.walking_distance_m;
        });
    }

    container.innerHTML = list.map(s => {
        const bikes = s.available_bikes;
        const colorCls = bikeColorClass(bikes);
        const recCls = s.isRec ? ' recommended-green' : '';
        return `
        <div class="station-row${recCls}" data-station="${s.station_id}"
             onmouseenter="window._goHighlight('${s.station_id}')"
             onmouseleave="window._goUnhighlight('${s.station_id}')">
            <div class="station-row-left">
                <div class="station-row-name">${shortName(s.station_name)}</div>
                <div class="station-row-meta">
                    <i class="bi bi-person-walking"></i>
                    ${formatWalk(s.walkMin)} from uni
                </div>
            </div>
            <div class="station-row-right">
                <div class="station-row-docks">
                    <span class="dock-number ${colorCls}">${bikes}</span>
                    ${bikes === 0 ? '<span class="dock-sublabel">no bikes</span>' : '<span class="dock-label">bikes</span>'}
                </div>
            </div>
        </div>`;
    }).join('');
}

// ====================================================
// PLAN FORMS
// ====================================================

function setupPlanForms() {
    setupPlanFormFor('to-plan');
    setupPlanFormFor('from-plan');
}

function setupPlanFormFor(prefix) {
    const hourSel = document.getElementById(`${prefix}-hour`);
    const minSel = document.getElementById(`${prefix}-minute`);
    if (!hourSel || !minSel) return;

    // Populate hours (0-23) — first option is placeholder
    const hourPlaceholder = document.createElement('option');
    hourPlaceholder.value = '';
    hourPlaceholder.textContent = 'HH';
    hourPlaceholder.disabled = true;
    hourPlaceholder.selected = true;
    hourSel.appendChild(hourPlaceholder);
    for (let h = 0; h < 24; h++) {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = String(h).padStart(2, '0');
        hourSel.appendChild(opt);
    }

    // Populate minutes (0, 5, 10, ... 55) — first option is placeholder
    const minPlaceholder = document.createElement('option');
    minPlaceholder.value = '';
    minPlaceholder.textContent = 'MM';
    minPlaceholder.disabled = true;
    minPlaceholder.selected = true;
    minSel.appendChild(minPlaceholder);
    for (let m = 0; m < 60; m += 5) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = String(m).padStart(2, '0');
        minSel.appendChild(opt);
    }

    // Day selector
    const daysContainer = document.getElementById(`${prefix}-days`);
    const today = new Date();
    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const btn = document.createElement('button');
        btn.className = 'plan-day-btn';
        btn.dataset.offset = i;
        const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
            : d.toLocaleDateString('en-GB', { weekday: 'short' });
        btn.textContent = label;
        btn.addEventListener('click', () => {
            daysContainer.querySelectorAll('.plan-day-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updatePlanBtnState(prefix);
        });
        daysContainer.appendChild(btn);
    }

    // Scan button — starts disabled
    const scanBtn = document.getElementById(`${prefix}-scan-btn`);
    scanBtn.disabled = true;
    scanBtn.addEventListener('click', () => {
        if (prefix === 'to-plan') loadToPlan();
        else loadFromPlan();
    });

    // Enable button when time + day are selected
    hourSel.addEventListener('change', () => updatePlanBtnState(prefix));
    minSel.addEventListener('change', () => updatePlanBtnState(prefix));
}

function updatePlanBtnState(prefix) {
    const hourSel = document.getElementById(`${prefix}-hour`);
    const minSel = document.getElementById(`${prefix}-minute`);
    const dayBtn = document.querySelector(`#${prefix}-days .plan-day-btn.active`);
    const scanBtn = document.getElementById(`${prefix}-scan-btn`);
    const helper = document.getElementById(`${prefix}-helper`);
    const hasTime = hourSel.value !== '' && minSel.value !== '';
    const hasDay = !!dayBtn;
    const ready = hasTime && hasDay;
    scanBtn.disabled = !ready;
    if (helper) helper.style.display = ready ? 'none' : '';
}

function getSelectedTime(prefix) {
    const dayBtn = document.querySelector(`#${prefix}-days .plan-day-btn.active`);
    const offset = dayBtn ? parseInt(dayBtn.dataset.offset) : 0;
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().split('T')[0];
    const h = parseInt(document.getElementById(`${prefix}-hour`).value) || 0;
    const m = parseInt(document.getElementById(`${prefix}-minute`).value) || 0;
    return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getSelectedTimeDisplay(prefix) {
    const h = document.getElementById(`${prefix}-hour`).value;
    const m = document.getElementById(`${prefix}-minute`).value;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ====================================================
// STATE 3: To Imperial + Plan trip
// ====================================================

async function loadToPlan() {
    const btn = document.getElementById('to-plan-scan-btn');
    const emptyState = document.getElementById('to-plan-empty');
    const loading = document.getElementById('to-plan-loading');
    const resultEl = document.getElementById('to-plan-result');
    btn.classList.add('loading');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Calculating...';
    if (emptyState) emptyState.style.display = 'none';
    if (resultEl) resultEl.style.display = 'none';
    if (loading) loading.style.display = '';
    showSkeletonStationRows('to-plan-alternatives');
    try {
        const [data, stns] = await Promise.all([
            getPredictionPlan({ arriveBy: getSelectedTime('to-plan'), mode: 'arrive' }),
            stationsData.length ? Promise.resolve(stationsData) : getStations(),
        ]);
        planData = data;
        if (!stationsData.length) stationsData = stns;
        if (loading) loading.style.display = 'none';
        renderToPlanResult(data);
        renderPlanWeather('to-plan', data.weather_forecast);
        updateMapMarkers();
    } catch (e) {
        console.error('Failed to load plan:', e);
        if (loading) loading.style.display = 'none';
        if (emptyState) emptyState.style.display = '';
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
        `Dock at ${stn} \u00B7 ${formatWalk(data.recommended_station.walk_to_destination_min)} walk to uni`;

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
    const loading = document.getElementById('from-plan-loading');
    const resultEl = document.getElementById('from-plan-result');
    btn.classList.add('loading');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Calculating...';
    if (emptyState) emptyState.style.display = 'none';
    if (resultEl) resultEl.style.display = 'none';
    if (loading) loading.style.display = '';
    showSkeletonStationRows('from-plan-alternatives');
    try {
        const [data, stns] = await Promise.all([
            getPredictionPlan({ arriveBy: getSelectedTime('from-plan'), mode: 'depart' }),
            stationsData.length ? Promise.resolve(stationsData) : getStations(),
        ]);
        planData = data;
        if (!stationsData.length) stationsData = stns;
        if (loading) loading.style.display = 'none';
        renderFromPlanResult(data);
        renderPlanWeather('from-plan', data.weather_forecast);
        updateMapMarkers();
    } catch (e) {
        console.error('Failed to load from-plan:', e);
        if (loading) loading.style.display = 'none';
        if (emptyState) emptyState.style.display = '';
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
    const predicted = rec.predicted_empty_docks;
    document.getElementById('from-plan-bikes').textContent = Math.round(predicted);

    const targetStr = getSelectedTimeDisplay('from-plan');
    document.getElementById('from-plan-bikes-label').textContent = `predicted bikes at ${targetStr}`;

    document.getElementById('from-plan-walk').textContent = formatWalk(rec.walk_to_destination_min);

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
            ? formatWalk(a.walk_to_destination_min) + ' ' + walkLabel
            : a.reason;
        return `
        <div class="alt-row${isRec ? ' ' + recClass : ''}" data-station="${a.station_id}"
             onmouseenter="window._goHighlight('${a.station_id}')"
             onmouseleave="window._goUnhighlight('${a.station_id}')">
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
// MINI MAP
// ====================================================

function initMap() {
    const container = document.getElementById('go-minimap');
    if (!container) return;

    map = L.map(container, {
        zoomControl: false,
        scrollWheelZoom: true,
        attributionControl: false,
    }).setView(IMPERIAL, 15);

    // Add small zoom control
    L.control.zoom({ position: 'topleft' }).addTo(map);

    tileLayer = L.tileLayer(isDarkMode() ? TILES_DARK : TILES_LIGHT, {
        maxZoom: 19,
    }).addTo(map);

    // Imperial College marker
    const markerFill = isDarkMode() ? '#E8E8E8' : '#333';
    L.circleMarker(IMPERIAL, {
        radius: 7, fillColor: markerFill, color: isDarkMode() ? '#444' : '#fff', weight: 2, fillOpacity: 0.9,
    }).addTo(map).bindPopup('<strong>Imperial College London</strong>');

    setTimeout(() => map.invalidateSize(), 100);
}

function updateMapMarkers() {
    if (!map) return;

    if (timing === 'plan' && planData) {
        renderMapMarkersPlan();
    } else if (timing === 'now' && direction === 'to' && predictionData) {
        renderMapMarkersToNow();
    } else if (timing === 'now' && direction === 'from' && stationsData.length) {
        const sorted = [...stationsData].sort((a, b) => a.walking_distance_m - b.walking_distance_m);
        const best = sorted.find(s => s.available_bikes > 0) || sorted[0];
        renderMapMarkersFromNow(sorted, best ? best.station_id : null);
    } else {
        clearMapLayers();
    }
}

function renderMapMarkersToNow() {
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
            color: isDarkMode() ? '#444' : '#fff',
            weight: 1.5,
            fillOpacity: 0.9,
        }).addTo(map);

        marker.bindPopup(
            `<strong>${shortName(st.station_name)}</strong><br>` +
            `<span style="color:${color}; font-size:1.3em; font-weight:500;">${docks}</span> predicted docks<br>` +
            `<small>${formatWalk(pred.walk_to_destination_min)} walk to uni</small>`
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

function renderMapMarkersFromNow(stations, bestId) {
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
            color: isDarkMode() ? '#444' : '#fff',
            weight: 1.5,
            fillOpacity: 0.9,
        }).addTo(map);

        const walkMinMap = Math.round(st.walking_duration_s / 60);
        marker.bindPopup(
            `<strong>${shortName(st.station_name)}</strong><br>` +
            `<span style="color:${color}; font-size:1.3em; font-weight:500;">${bikes}</span> bikes available<br>` +
            `<small>${formatWalk(walkMinMap)} walk from uni</small>`
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

function renderMapMarkersPlan() {
    if (!planData || !map) return;
    clearMapLayers();

    const isFrom = direction === 'from';
    const alts = planData.alternatives_at_target_time;
    const recId = planData.recommended_station ? planData.recommended_station.station_id : null;

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
            ? formatWalk(a.walk_to_destination_min)
            : '';

        marker.bindPopup(
            `<strong>${shortName(a.station_name)}</strong>` +
            `${isRec ? ' <span style="color:' + color + '; font-size:10px;">(recommended)</span>' : ''}<br>` +
            `<span style="color:${color}; font-size:1.3em; font-weight:500;">${predicted}</span> predicted ${unit}<br>` +
            (walkText ? `<small><i class="bi bi-person-walking"></i> ${walkText} ${walkLabel}</small>` : '')
        );

        marker._baseRadius = radius;
        mapMarkers[a.station_id] = marker;

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
// SKELETON HELPERS
// ====================================================

function buildSkeletonRow(animated) {
    const cls = animated ? 'skel-bar' : 'skel-bar skel-static-bar';
    return `
    <div class="skel-station-row${animated ? '' : ' skel-station-row-static'}">
        <div style="flex:1; min-width:0;">
            <div class="${cls}" style="width: 120px; height: 12px; margin-bottom: 6px;"></div>
            <div class="${cls}" style="width: 80px; height: 8px;"></div>
        </div>
        <div style="text-align:right;">
            <div class="${cls}" style="width: 28px; height: 18px; margin-left: auto; margin-bottom: 4px;"></div>
            <div class="${cls}" style="width: 36px; height: 8px; margin-left: auto;"></div>
        </div>
    </div>`;
}

function renderSkeletonStationRows() {
    // Fill station list containers with static (non-animated) skeleton rows on page load
    ['to-now-stations', 'from-now-stations'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.innerHTML.trim()) {
            el.innerHTML = Array(5).fill(buildSkeletonRow(false)).join('');
        }
    });
}

function showSkeletonStationRows(containerId) {
    const el = document.getElementById(containerId);
    if (el) {
        el.innerHTML = Array(5).fill(buildSkeletonRow(true)).join('');
    }
}

// ====================================================
// HELPERS
// ====================================================

function shortName(name) {
    return name.split(',')[0];
}

function formatWalk(walkMin) {
    return `${walkMin || 0} min`;
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
