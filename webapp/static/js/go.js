/* DockSense -- Go Tab (4-state: direction x timing, desktop map + chart) */

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
let planChart = null;
let tileLayer = null;

// Track which states have been loaded to avoid redundant fetches
let loadedStates = {};

const IMPERIAL = [51.4988, -0.1749];
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

// -- Init --
document.addEventListener('DOMContentLoaded', () => {
    autoDetectDirection();
    setupToggles();
    setupPlanForms();
    handleDeepLink();
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
    window.history.replaceState({}, '', window.location.pathname);
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
    document.getElementById('btn-to').addEventListener('click', () => {
        if (direction === 'to') return;
        direction = 'to';
        syncToggleUI();
        switchState();
    });
    document.getElementById('btn-from').addEventListener('click', () => {
        if (direction === 'from') return;
        direction = 'from';
        syncToggleUI();
        switchState();
    });
    document.getElementById('btn-now').addEventListener('click', () => {
        if (timing === 'now') return;
        timing = 'now';
        syncToggleUI();
        switchState();
    });
    document.getElementById('btn-plan').addEventListener('click', () => {
        if (timing === 'plan') return;
        timing = 'plan';
        syncToggleUI();
        switchState();
    });
}

function syncToggleUI() {
    setActiveBtn('btn-to', direction === 'to');
    setActiveBtn('btn-from', direction === 'from');
    setActiveBtn('btn-now', timing === 'now');
    setActiveBtn('btn-plan', timing === 'plan');
}

function setActiveBtn(id, active) {
    document.getElementById(id).classList.toggle('active', active);
}

// -- State switching --
function switchState() {
    const activeId = `state-${direction}-${timing}`;

    STATE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (id === activeId) {
            el.style.display = '';
            el.classList.add('fade-in');
            setTimeout(() => el.classList.remove('fade-in'), 250);
        } else {
            el.style.display = 'none';
        }
    });

    // Desktop right panel
    if (timing === 'now') {
        switchDesktopRightPanel('map');
    } else {
        switchDesktopRightPanel('chart');
    }

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
    document.getElementById('to-now-docks').textContent = rec.predicted_empty_docks;
    document.getElementById('to-now-confidence').textContent = Math.round(rec.confidence * 100) + '%';
    document.getElementById('to-now-walk').textContent = rec.walk_to_destination_min + ' min';

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
        `${weather.temperature}\u00B0C, ${weather.description} \u2014 ${weather.effect}`;
}

function renderToNowStations(stations, recommendedId) {
    const container = document.getElementById('to-now-stations');
    // Filter out recommended station for alternatives list
    const alts = stations.filter(s => s.station_id !== recommendedId);
    container.innerHTML = alts.map(s => {
        const dockCls = dockColorClass(s.predicted_empty_docks);
        const isFull = s.predicted_empty_docks === 0;
        return `
        <div class="station-row"
             data-station="${s.station_id}"
             onmouseenter="window._goHighlight('${s.station_id}')"
             onmouseleave="window._goUnhighlight('${s.station_id}')">
            <div class="station-row-left">
                <div class="station-row-name">${shortName(s.station_name)}</div>
                <div class="station-row-meta">
                    <i class="bi bi-person-walking"></i>
                    ${s.walk_to_destination_min} min to uni
                </div>
            </div>
            <div class="station-row-right">
                <div class="station-row-confidence">${Math.round(s.confidence * 100)}%</div>
                <div class="station-row-docks">
                    <span class="dock-number ${dockCls}">${s.predicted_empty_docks}</span>
                    ${isFull ? '<span class="dock-sublabel">likely full</span>' : ''}
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
        document.getElementById('from-now-walk').textContent = walkMin + ' min';

        // Render other stations
        const others = sorted.filter(s => s.station_id !== best.station_id);
        renderFromNowStations(others, best.station_id);

        // Update map for From mode
        if (map) renderMapMarkersFrom(sorted, best.station_id);
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
    container.innerHTML = stations.map(s => {
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
                    ${walkMin} min from uni
                </div>
            </div>
            <div class="station-row-right">
                <div class="station-row-docks">
                    <span class="dock-number ${bikeCls}">${s.available_bikes}</span>
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
    const ampmSel = document.getElementById(`${prefix}-ampm`);
    const daysContainer = document.getElementById(`${prefix}-days`);

    // Populate hours
    for (let h = 1; h <= 12; h++) {
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

    ampmSel.value = 'AM';

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
    let hour = parseInt(document.getElementById(`${prefix}-hour`).value);
    const min = parseInt(document.getElementById(`${prefix}-minute`).value);
    const ampm = document.getElementById(`${prefix}-ampm`).value;
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    const activeDay = document.querySelector(`#${prefix}-days .plan-day-btn.active`);
    const date = activeDay ? activeDay.dataset.date : new Date().toISOString().split('T')[0];

    return `${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;
}

function getSelectedTimeDisplay(prefix) {
    const h = parseInt(document.getElementById(`${prefix}-hour`).value);
    const m = parseInt(document.getElementById(`${prefix}-minute`).value);
    const ap = document.getElementById(`${prefix}-ampm`).value;
    return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

// ====================================================
// STATE 3: To Imperial + Plan trip
// ====================================================

async function loadToPlan() {
    const btn = document.getElementById('to-plan-scan-btn');
    btn.classList.add('loading');
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Calculating...';
    try {
        const data = await getPredictionPlan({
            arriveBy: getSelectedTime('to-plan'),
            mode: 'arrive',
        });
        planData = data;
        renderToPlanResult(data);
        renderPlanWeather('to-plan', data.weather_forecast);
        if (isDesktop()) renderPlanChart();
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
        hour: '2-digit', minute: '2-digit', hour12: true,
    }).toUpperCase();
    document.getElementById('to-plan-leave-by').textContent = `Leave by ${leaveStr}`;

    // Subtitle
    const stn = shortName(data.recommended_station.station_name);
    document.getElementById('to-plan-subtitle').textContent =
        `Dock at ${stn} \u00B7 ${data.recommended_station.walk_to_destination_min} min walk to uni`;

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
        hour: '2-digit', minute: '2-digit', hour12: true,
    }).toUpperCase();
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
    btn.classList.add('loading');
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Calculating...';
    try {
        const data = await getPredictionPlan({
            arriveBy: getSelectedTime('from-plan'),
            mode: 'depart',
        });
        planData = data;
        renderFromPlanResult(data);
        renderPlanWeather('from-plan', data.weather_forecast);
        if (isDesktop()) renderPlanChart();
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
    document.getElementById('from-plan-bikes').textContent = predicted;

    const targetStr = getSelectedTimeDisplay('from-plan');
    document.getElementById('from-plan-bikes-label').textContent = `predicted bikes at ${targetStr}`;

    document.getElementById('from-plan-confidence').textContent = Math.round(rec.confidence * 100) + '%';
    document.getElementById('from-plan-walk').textContent = rec.walk_to_destination_min + ' min';

    // Alternatives
    renderAlternatives('from-plan-alternatives', data.alternatives_at_target_time, 'green');
}

// ====================================================
// SHARED RENDERERS
// ====================================================

function renderAlternatives(containerId, alts, theme) {
    const container = document.getElementById(containerId);
    const recClass = theme === 'green' ? 'alt-recommended-green' : 'alt-recommended';
    container.innerHTML = alts.map(a => {
        const isRec = a.reason === 'recommended';
        const dockCls = dockColorClass(a.predicted);
        return `
        <div class="alt-row${isRec ? ' ' + recClass : ''}">
            <div class="alt-row-left">
                <div class="alt-row-name">${shortName(a.station_name)}</div>
                <div class="alt-row-reason">${a.reason}</div>
            </div>
            <div class="alt-row-right">
                <div class="alt-row-confidence">${Math.round(a.confidence * 100)}%</div>
                <div class="station-row-docks">
                    <span class="dock-number ${dockCls}">${a.predicted}</span>
                    ${a.predicted === 0 ? '<span class="dock-sublabel">likely full</span>' : ''}
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

function switchDesktopRightPanel(view) {
    const mapView = document.getElementById('go-right-map');
    const chartView = document.getElementById('go-right-chart');
    if (!mapView || !chartView) return;

    if (view === 'chart') {
        mapView.style.display = 'none';
        chartView.style.display = 'flex';
        if (planData) renderPlanChart();
    } else {
        mapView.style.display = 'flex';
        chartView.style.display = 'none';
        if (map) setTimeout(() => map.invalidateSize(), 50);
    }
}

// -- Plan chart (desktop right panel) --
function renderPlanChart() {
    if (!planData) return;
    const canvas = document.getElementById('plan-chart');
    if (!canvas) return;

    if (planChart) planChart.destroy();

    const alts = planData.alternatives_at_target_time;
    const prefix = direction === 'to' ? 'to-plan' : 'from-plan';
    const targetTime = new Date(getSelectedTime(prefix));

    const labels = [];
    const timePoints = [];
    for (let i = -6; i <= 6; i++) {
        const t = new Date(targetTime.getTime() + i * 5 * 60000);
        timePoints.push(t);
        labels.push(t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    }

    const stationColors = [COLORS.danger, COLORS.warning, COLORS.info];
    const yLabel = direction === 'to' ? 'Predicted empty docks' : 'Predicted available bikes';

    const datasets = alts.slice(0, 3).map((a, idx) => {
        const baseDocks = a.predicted;
        const data = timePoints.map((_, i) => {
            const offset = i - 6;
            const trend = baseDocks <= 1
                ? Math.max(0, baseDocks + 2 - Math.abs(offset) * 0.5 + (offset < 0 ? 1 : -0.5))
                : Math.max(0, baseDocks + (offset < 0 ? 1 : -0.3) * Math.abs(offset) * 0.3);
            return Math.round(Math.max(0, trend) * 10) / 10;
        });

        return {
            label: shortName(a.station_name),
            data,
            borderColor: a.reason === 'recommended' ? (direction === 'to' ? COLORS.info : COLORS.success) : stationColors[idx],
            backgroundColor: 'transparent',
            borderWidth: a.reason === 'recommended' ? 2.5 : 1.5,
            borderDash: a.reason === 'recommended' ? [] : [4, 3],
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
        };
    });

    const targetIdx = 6;

    planChart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'line',
                        font: { size: 11 },
                        color: isDarkMode() ? '#A0A0A0' : '#6B6B6B',
                        padding: 16,
                    },
                },
                annotation: undefined,
            },
            scales: {
                x: {
                    grid: {
                        display: true,
                        color: isDarkMode() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                        drawTicks: false,
                    },
                    ticks: {
                        font: { size: 10 },
                        color: isDarkMode() ? '#6B6B6B' : '#9B9B9B',
                        maxRotation: 0,
                        callback: function(val, idx) {
                            return idx % 3 === 0 ? this.getLabelForValue(val) : '';
                        },
                    },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: yLabel,
                        font: { size: 10 },
                        color: isDarkMode() ? '#6B6B6B' : '#9B9B9B',
                    },
                    grid: {
                        color: isDarkMode() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                        drawTicks: false,
                    },
                    ticks: {
                        font: { size: 10 },
                        color: isDarkMode() ? '#6B6B6B' : '#9B9B9B',
                        stepSize: 2,
                    },
                },
            },
        },
        plugins: [{
            id: 'targetLine',
            afterDraw(chart) {
                const meta = chart.getDatasetMeta(0);
                if (!meta.data[targetIdx]) return;
                const x = meta.data[targetIdx].x;
                const { top, bottom } = chart.chartArea;
                const ctx = chart.ctx;
                ctx.save();
                ctx.setLineDash([4, 4]);
                const lineColor = isDarkMode() ? '#E8E8E8' : '#1A1A1A';
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.4;
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x, bottom);
                ctx.stroke();

                ctx.setLineDash([]);
                ctx.globalAlpha = 1;
                ctx.fillStyle = lineColor;
                ctx.font = '500 10px -apple-system, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Target', x, top - 4);
                ctx.restore();
            },
        }],
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

    if (predictionData && direction === 'to') renderMapMarkers();
    if (stationsData.length && direction === 'from') {
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

        const docks = pred.predicted_empty_docks;
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
            `<small>${pred.walk_to_destination_min} min walk to uni</small>`
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

        const walkMin = Math.round(st.walking_duration_s / 60);
        marker.bindPopup(
            `<strong>${shortName(st.station_name)}</strong><br>` +
            `<span style="color:${color}; font-size:1.3em; font-weight:500;">${bikes}</span> bikes available<br>` +
            `<small>${walkMin} min walk from uni</small>`
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
