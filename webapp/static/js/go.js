/* DockSense – Go Tab (Now + Plan modes, desktop map + chart) */

import { getPredictionNow, getPredictionPlan, getStations } from './api/client.js';

// ── State ──
let currentMode = 'now';
let currentDirection = null;
let predictionData = null;
let planData = null;
let stationsData = [];
let map = null;
let mapMarkers = {};
let mapLayers = {};
let planChart = null;

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

let tileLayer = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    autoDetectDirection();
    setupToggles();
    setupPlanForm();
    handleDeepLink();
    loadNowMode();
    initDesktopMap();
    window.addEventListener('resize', onResize);
});

// ── Deep link: ?mode=now triggers fresh Now mode ──
function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    if (mode === 'now') {
        currentMode = 'now';
        setActiveBtn('btn-now', 'btn-plan');
        document.getElementById('now-content').style.display = '';
        document.getElementById('plan-content').style.display = 'none';
        // Clean up URL without reload
        window.history.replaceState({}, '', window.location.pathname);
    } else if (mode === 'plan') {
        currentMode = 'plan';
        setActiveBtn('btn-plan', 'btn-now');
        document.getElementById('plan-content').style.display = '';
        document.getElementById('now-content').style.display = 'none';
        window.history.replaceState({}, '', window.location.pathname);
    }
}

// ── Auto-detect morning/evening ──
function autoDetectDirection() {
    const hour = new Date().getHours();
    const isMorning = hour < 12;
    currentDirection = isMorning ? 'arrive' : 'depart';

    document.getElementById('btn-arrive').classList.toggle('active', isMorning);
    document.getElementById('btn-depart').classList.toggle('active', !isMorning);

    updateModeIndicator();
}

// ── Toggle wiring ──
function setupToggles() {
    document.getElementById('btn-now').addEventListener('click', () => {
        if (currentMode === 'now') return;
        setActiveBtn('btn-now', 'btn-plan');
        currentMode = 'now';
        transitionMode('now-content', 'plan-content');
        switchDesktopRightPanel('map');
    });
    document.getElementById('btn-plan').addEventListener('click', () => {
        if (currentMode === 'plan') return;
        setActiveBtn('btn-plan', 'btn-now');
        currentMode = 'plan';
        transitionMode('plan-content', 'now-content');
        switchDesktopRightPanel('chart');
    });

    document.getElementById('btn-arrive').addEventListener('click', () => {
        setActiveBtn('btn-arrive', 'btn-depart');
        currentDirection = 'arrive';
        updateModeIndicator();
        updatePlanLabel();
    });
    document.getElementById('btn-depart').addEventListener('click', () => {
        setActiveBtn('btn-depart', 'btn-arrive');
        currentDirection = 'depart';
        updateModeIndicator();
        updatePlanLabel();
    });
}

function setActiveBtn(activeId, inactiveId) {
    document.getElementById(activeId).classList.add('active');
    document.getElementById(inactiveId).classList.remove('active');
}

function updateModeIndicator() {
    const indicator = document.getElementById('mode-indicator');
    const text = document.getElementById('mode-indicator-text');
    if (currentDirection === 'arrive') {
        indicator.classList.remove('evening');
        text.textContent = 'Morning mode \u2014 finding empty docks near Imperial';
    } else {
        indicator.classList.add('evening');
        text.textContent = 'Evening mode \u2014 finding available bikes near Imperial';
    }
}

function updatePlanLabel() {
    const label = document.getElementById('plan-direction-label');
    if (!label) return;
    label.textContent = currentDirection === 'depart'
        ? 'I NEED TO LEAVE FROM'
        : 'I NEED TO BE AT';
}

// ── Desktop right panel switching ──
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

// ── Mode transition ──
function transitionMode(showId, hideId) {
    const show = document.getElementById(showId);
    const hide = document.getElementById(hideId);
    hide.classList.add('fading');
    setTimeout(() => {
        hide.style.display = 'none';
        hide.classList.remove('fading');
        show.style.display = '';
        show.classList.add('fade-in');
        setTimeout(() => show.classList.remove('fade-in'), 250);
    }, 150);
}

// ══════════════════════════════════════════════════════
// NOW MODE
// ══════════════════════════════════════════════════════

async function loadNowMode() {
    const skeleton = document.getElementById('hero-skeleton');
    const heroCard = document.getElementById('hero-card');
    const errorEl = document.getElementById('now-error');
    const allFullEl = document.getElementById('now-all-full');

    // Show skeleton, hide others
    skeleton.style.display = '';
    heroCard.style.display = 'none';
    errorEl.style.display = 'none';
    allFullEl.style.display = 'none';

    try {
        const [data, stns] = await Promise.all([getPredictionNow(), getStations()]);
        predictionData = data;
        stationsData = stns;

        // Check all-stations-full
        const allFull = data.stations.every(s => s.predicted_empty_docks === 0);
        if (allFull) {
            allFullEl.style.display = '';
        }

        skeleton.style.display = 'none';
        heroCard.style.display = '';
        heroCard.classList.add('fade-in');
        setTimeout(() => heroCard.classList.remove('fade-in'), 250);

        renderNowHero(data.recommended);
        renderWeather(data.weather);
        renderStationList(data.stations, data.recommended.station_id);
        if (map) renderMapMarkers();
    } catch (e) {
        console.error('Failed to load prediction:', e);
        skeleton.style.display = 'none';
        errorEl.style.display = '';
    }

    // Wire up retry button
    const retryBtn = document.getElementById('now-retry-btn');
    if (retryBtn) {
        retryBtn.onclick = () => loadNowMode();
    }
}

function renderNowHero(rec) {
    document.getElementById('hero-name').textContent = shortName(rec.station_name);
    document.getElementById('hero-docks').textContent = rec.predicted_empty_docks;
    document.getElementById('hero-confidence').textContent = Math.round(rec.confidence * 100) + '%';
    document.getElementById('hero-walk').textContent = rec.walk_to_destination_min + ' min';

    const total = rec.total_trip_min;
    const walk = rec.walk_to_destination_min;
    const cycle = 15;
    const dock = Math.max(1, total - cycle - walk);
    document.getElementById('hero-trip').textContent =
        `Total: ~${total} min (bike ${cycle} + dock ${dock} + walk ${walk})`;
}

function renderWeather(weather) {
    const icon = weatherIcon(weather.description);
    const iconEl = document.querySelector('#now-content .weather-strip i');
    if (iconEl) iconEl.className = `bi bi-${icon}`;
    const textEl = document.getElementById('weather-text');
    if (textEl) textEl.textContent =
        `${weather.temperature}\u00B0C, ${weather.description} \u2014 ${weather.effect}`;
}

function renderStationList(stations, recommendedId) {
    const container = document.getElementById('station-list');
    container.innerHTML = stations.map(s => {
        const isRec = s.station_id === recommendedId;
        const dockCls = dockColorClass(s.predicted_empty_docks);
        const isFull = s.predicted_empty_docks === 0;

        return `
        <div class="station-row${isRec ? ' recommended' : ''}"
             data-station="${s.station_id}"
             onmouseenter="window._goHighlight('${s.station_id}')"
             onmouseleave="window._goUnhighlight('${s.station_id}')">
            <div class="rank-badge">${s.preference_rank}</div>
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

window._goHighlight = (id) => highlightMarker(id);
window._goUnhighlight = (id) => unhighlightMarker(id);

// ══════════════════════════════════════════════════════
// PLAN MODE
// ══════════════════════════════════════════════════════

function setupPlanForm() {
    // Populate hour select (1-12)
    const hourSel = document.getElementById('plan-hour');
    for (let h = 1; h <= 12; h++) {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = String(h).padStart(2, '0');
        if (h === 10) opt.selected = true;
        hourSel.appendChild(opt);
    }

    // Populate minute select (00, 05, 10, ..., 55)
    const minSel = document.getElementById('plan-minute');
    for (let m = 0; m < 60; m += 5) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = String(m).padStart(2, '0');
        if (m === 15) opt.selected = true;
        minSel.appendChild(opt);
    }

    // Default AM
    document.getElementById('plan-ampm').value = 'AM';

    // Populate day buttons (next 5 days)
    const daysContainer = document.getElementById('plan-days');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    for (let i = 0; i < 5; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const btn = document.createElement('button');
        btn.className = 'plan-day-btn' + (i === 1 ? ' active' : '');
        btn.dataset.date = d.toISOString().split('T')[0];
        btn.textContent = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[d.getDay()];
        btn.addEventListener('click', () => {
            daysContainer.querySelectorAll('.plan-day-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadPlanMode();
        });
        daysContainer.appendChild(btn);
    }

    // Auto-load on time change
    [hourSel, minSel, document.getElementById('plan-ampm')].forEach(el => {
        el.addEventListener('change', () => loadPlanMode());
    });
}

async function loadPlanMode() {
    try {
        const data = await getPredictionPlan({
            arriveBy: getSelectedArriveBy(),
            mode: currentDirection,
        });
        planData = data;
        renderPlanResult(data);
        renderPlanWeather(data.weather_forecast);
        if (isDesktop()) renderPlanChart();
    } catch (e) {
        console.error('Failed to load plan:', e);
    }
}

function getSelectedArriveBy() {
    let hour = parseInt(document.getElementById('plan-hour').value);
    const min = parseInt(document.getElementById('plan-minute').value);
    const ampm = document.getElementById('plan-ampm').value;
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    const activeDay = document.querySelector('.plan-day-btn.active');
    const date = activeDay ? activeDay.dataset.date : new Date().toISOString().split('T')[0];

    return `${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;
}

function renderPlanResult(data) {
    const emptyState = document.getElementById('plan-empty-state');
    if (emptyState) emptyState.style.display = 'none';
    document.getElementById('plan-result').style.display = '';

    // Leave by
    const leaveTime = new Date(data.leave_by);
    const leaveStr = leaveTime.toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: true,
    }).toUpperCase();
    document.getElementById('plan-leave-by').textContent = `Leave by ${leaveStr}`;

    // Subtitle
    const stn = shortName(data.recommended_station.station_name);
    document.getElementById('plan-subtitle').textContent =
        `Dock at ${stn} \u00B7 ${data.recommended_station.walk_to_destination_min} min walk to uni`;

    // Timeline bar
    const bd = data.breakdown;
    const totalMin = bd.cycle_min + bd.dock_min + bd.walk_min;
    document.getElementById('plan-tl-cycle').style.flex = bd.cycle_min;
    document.getElementById('plan-tl-dock').style.flex = bd.dock_min;
    document.getElementById('plan-tl-walk').style.flex = bd.walk_min;

    document.getElementById('plan-tl-labels').innerHTML = `
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

    // Get target time from form
    const targetStr = (() => {
        let h = parseInt(document.getElementById('plan-hour').value);
        const m = parseInt(document.getElementById('plan-minute').value);
        const ap = document.getElementById('plan-ampm').value;
        return `${h}:${String(m).padStart(2, '0')} ${ap}`;
    })();

    document.getElementById('plan-arrival-strip').textContent =
        `Arrives ${arrStr} \u00B7 ${bd.buffer_min} min buffer before ${targetStr}`;

    // Why not closer
    const whyEl = document.getElementById('plan-why');
    if (data.why_not_closer) {
        whyEl.style.display = '';
        document.getElementById('plan-why-text').textContent = data.why_not_closer;
    } else {
        whyEl.style.display = 'none';
    }

    // Alternatives
    renderAlternatives(data.alternatives_at_target_time);
}

function renderAlternatives(alts) {
    const container = document.getElementById('plan-alternatives');
    container.innerHTML = alts.map(a => {
        const isRec = a.reason === 'recommended';
        const dockCls = dockColorClass(a.predicted);
        return `
        <div class="alt-row${isRec ? ' alt-recommended' : ''}">
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

function renderPlanWeather(forecast) {
    if (!forecast) return;
    const icon = weatherIcon(forecast.description);
    const stripIcon = document.querySelector('#plan-weather-strip i');
    if (stripIcon) stripIcon.className = `bi bi-${icon}`;
    const textEl = document.getElementById('plan-weather-text');
    if (textEl) {
        textEl.textContent =
            `${forecast.temperature}\u00B0C, ${forecast.description} \u00B7 ` +
            `${forecast.precipitation_mm}mm rain \u00B7 ${forecast.wind_speed} m/s wind`;
    }
}

// ── Plan chart (desktop right panel) ──
function renderPlanChart() {
    if (!planData) return;
    const canvas = document.getElementById('plan-chart');
    if (!canvas) return;

    if (planChart) planChart.destroy();

    // Generate synthetic availability curves for top 3 stations
    const alts = planData.alternatives_at_target_time;
    const targetTime = new Date(getSelectedArriveBy());
    const startTime = new Date(targetTime.getTime() - 30 * 60000);

    // X-axis: 13 points, every 5 min from -30 to +30 around target
    const labels = [];
    const timePoints = [];
    for (let i = -6; i <= 6; i++) {
        const t = new Date(targetTime.getTime() + i * 5 * 60000);
        timePoints.push(t);
        labels.push(t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    }

    // Build datasets for top 3 candidate stations
    const stationColors = [COLORS.danger, COLORS.warning, COLORS.info];
    const datasets = alts.slice(0, 3).map((a, idx) => {
        const baseDocks = a.predicted;
        // Simulate a curve: stations with low docks trend down, high docks stay stable
        const data = timePoints.map((_, i) => {
            const offset = i - 6; // -6 to +6
            const trend = baseDocks <= 1
                ? Math.max(0, baseDocks + 2 - Math.abs(offset) * 0.5 + (offset < 0 ? 1 : -0.5))
                : Math.max(0, baseDocks + (offset < 0 ? 1 : -0.3) * Math.abs(offset) * 0.3);
            return Math.round(Math.max(0, trend) * 10) / 10;
        });

        return {
            label: shortName(a.station_name),
            data,
            borderColor: a.reason === 'recommended' ? COLORS.info : stationColors[idx],
            backgroundColor: 'transparent',
            borderWidth: a.reason === 'recommended' ? 2.5 : 1.5,
            borderDash: a.reason === 'recommended' ? [] : [4, 3],
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
        };
    });

    // Target time vertical line index
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
                        text: 'Predicted empty docks',
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
            // Draw vertical dashed line at target time
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

                // Label
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

// ══════════════════════════════════════════════════════
// DESKTOP MAP (Now mode)
// ══════════════════════════════════════════════════════

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

    if (predictionData) renderMapMarkers();
    setTimeout(() => map.invalidateSize(), 100);
}

function renderMapMarkers() {
    if (!map || !predictionData) return;

    const recId = predictionData.recommended.station_id;

    Object.values(mapMarkers).forEach(m => map.removeLayer(m));
    Object.values(mapLayers).forEach(l => map.removeLayer(l));
    mapMarkers = {};
    mapLayers = {};

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

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════

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

function dockColor(docks) {
    if (docks === 0) return COLORS.danger;
    if (docks <= 2) return COLORS.warning;
    return COLORS.success;
}

function isDarkMode() {
    if (document.documentElement.getAttribute('data-bs-theme') === 'dark') return true;
    if (document.documentElement.getAttribute('data-bs-theme') === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
