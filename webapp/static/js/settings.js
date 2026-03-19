/* DockSense – Settings Tab */

import { getSettings, getStations } from './api/client.js';

let settings = null;
let stations = [];

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
});

async function loadSettings() {
    try {
        const [s, st] = await Promise.all([getSettings(), getStations()]);
        settings = s;
        stations = st;
        renderStationList();
        renderCommuteDefaults();
        renderTelegram();
        renderMotionSensor();
        renderAutoSwitch();
        renderAppearance();
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

// ══════════════════════════════════════════════════════
// STATION REORDER LIST
// ══════════════════════════════════════════════════════

function renderStationList() {
    const container = document.getElementById('station-reorder-list');
    if (!container) return;

    // Order stations by settings.station_order, take first 10
    const ordered = orderStations(settings.station_order);
    const list = ordered.slice(0, 10);

    // Persist initial order so Now/Plan pages can read it
    if (!localStorage.getItem('ds_station_order')) {
        const initialOrder = ordered.map(s => s.station_id);
        localStorage.setItem('ds_station_order', JSON.stringify(initialOrder));
    }

    container.innerHTML = list.map((st, i) => {
        const name = st.station_name.split(',')[0];
        const walkMin = Math.round((st.walking_duration_s || 0) / 60);
        return `
        <div class="reorder-item" data-id="${st.station_id}" draggable="true">
            <span class="reorder-handle"><i class="bi bi-grip-vertical"></i></span>
            <span class="reorder-rank">${i + 1}</span>
            <span class="reorder-name">${name}</span>
            <span class="reorder-walk">${walkMin} min walk</span>
            <span class="reorder-arrows">
                <button class="reorder-arrow-btn" data-dir="up" ${i === 0 ? 'disabled' : ''}><i class="bi bi-chevron-up"></i></button>
                <button class="reorder-arrow-btn" data-dir="down" ${i === list.length - 1 ? 'disabled' : ''}><i class="bi bi-chevron-down"></i></button>
            </span>
        </div>`;
    }).join('');

    // Wire up arrow buttons
    container.querySelectorAll('.reorder-arrow-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = btn.closest('.reorder-item');
            const dir = btn.dataset.dir;
            moveItem(item, dir);
        });
    });

    // Wire up HTML5 drag-and-drop
    setupDragAndDrop(container);
}

function orderStations(orderIds) {
    const idSet = new Set(orderIds || []);
    const ordered = [];
    // Add stations in order
    for (const id of (orderIds || [])) {
        const st = stations.find(s => s.station_id === id);
        if (st) ordered.push(st);
    }
    // Append any stations not in the order list
    for (const st of stations) {
        if (!idSet.has(st.station_id)) ordered.push(st);
    }
    return ordered;
}

function moveItem(item, dir) {
    const container = document.getElementById('station-reorder-list');
    const items = [...container.querySelectorAll('.reorder-item')];
    const idx = items.indexOf(item);

    if (dir === 'up' && idx > 0) {
        container.insertBefore(item, items[idx - 1]);
    } else if (dir === 'down' && idx < items.length - 1) {
        container.insertBefore(items[idx + 1], item);
    }

    updateRanks();
    saveStationOrder();
}

function updateRanks() {
    const items = document.querySelectorAll('#station-reorder-list .reorder-item');
    items.forEach((item, i) => {
        item.querySelector('.reorder-rank').textContent = i + 1;
        const upBtn = item.querySelector('[data-dir="up"]');
        const downBtn = item.querySelector('[data-dir="down"]');
        upBtn.disabled = i === 0;
        downBtn.disabled = i === items.length - 1;
    });
}

function saveStationOrder() {
    const items = document.querySelectorAll('#station-reorder-list .reorder-item');
    const order = [...items].map(el => el.dataset.id);
    settings.station_order = order;
    // Persist to localStorage
    localStorage.setItem('ds_station_order', JSON.stringify(order));
}

// ── HTML5 Drag and Drop ──

function setupDragAndDrop(container) {
    let dragItem = null;

    container.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.reorder-item');
        if (!item) return;
        dragItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    container.addEventListener('dragend', (e) => {
        if (dragItem) {
            dragItem.classList.remove('dragging');
            dragItem = null;
        }
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        updateRanks();
        saveStationOrder();
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = e.target.closest('.reorder-item');
        if (!target || target === dragItem) return;

        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        target.classList.add('drag-over');
    });

    container.addEventListener('dragleave', (e) => {
        const target = e.target.closest('.reorder-item');
        if (target) target.classList.remove('drag-over');
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const target = e.target.closest('.reorder-item');
        if (!target || !dragItem || target === dragItem) return;

        const items = [...container.querySelectorAll('.reorder-item')];
        const dragIdx = items.indexOf(dragItem);
        const targetIdx = items.indexOf(target);

        if (dragIdx < targetIdx) {
            container.insertBefore(dragItem, target.nextSibling);
        } else {
            container.insertBefore(dragItem, target);
        }

        target.classList.remove('drag-over');
    });
}

// ══════════════════════════════════════════════════════
// COMMUTE DEFAULTS
// ══════════════════════════════════════════════════════

function renderCommuteDefaults() {
    const cyclingInput = document.getElementById('cycling-time');
    const walkingSelect = document.getElementById('walking-speed');

    if (settings.commute) {
        cyclingInput.value = settings.commute.cycling_speed_min || 15;
    }

    cyclingInput.addEventListener('change', () => {
        const val = Math.max(1, Math.min(60, parseInt(cyclingInput.value) || 15));
        cyclingInput.value = val;
        settings.commute.cycling_speed_min = val;
        localStorage.setItem('ds_cycling_time', val);
    });

    walkingSelect.addEventListener('change', () => {
        localStorage.setItem('ds_walking_speed', walkingSelect.value);
    });

    // Restore from localStorage
    const savedCycling = localStorage.getItem('ds_cycling_time');
    if (savedCycling) cyclingInput.value = savedCycling;

    const savedWalking = localStorage.getItem('ds_walking_speed');
    if (savedWalking) walkingSelect.value = savedWalking;
}

// ══════════════════════════════════════════════════════
// TELEGRAM
// ══════════════════════════════════════════════════════

function renderTelegram() {
    const tg = settings.telegram || {};
    const dot = document.getElementById('tg-dot');
    const status = document.getElementById('tg-status');
    const bot = document.getElementById('tg-bot');
    const last = document.getElementById('tg-last');
    const testBtn = document.getElementById('tg-test-btn');

    if (tg.connected) {
        dot.className = 'settings-status-dot online';
        status.textContent = 'Connected';
    } else {
        dot.className = 'settings-status-dot offline';
        status.textContent = 'Disconnected';
    }

    bot.textContent = `Bot: @${tg.bot_name || 'DockSenseBot'}`;

    if (tg.last_message) {
        const t = new Date(tg.last_message);
        const timeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        last.textContent = `Last notification sent: ${timeStr} today`;
    } else {
        last.textContent = 'No notifications sent yet';
    }

    testBtn.addEventListener('click', async () => {
        if (!tg.connected) {
            testBtn.innerHTML = '<i class="bi bi-x-circle"></i> Not configured';
            testBtn.classList.add('sent');
            setTimeout(() => {
                testBtn.innerHTML = '<i class="bi bi-send"></i> Test notification';
                testBtn.classList.remove('sent');
            }, 2000);
            return;
        }

        testBtn.disabled = true;
        testBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Sending...';

        try {
            const resp = await fetch('/api/telegram/test', { method: 'POST' });
            const result = await resp.json();

            if (result.sent) {
                testBtn.innerHTML = '<i class="bi bi-check2"></i> Sent!';
                testBtn.classList.add('sent');
                // Update last message display
                const now = new Date();
                const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                last.textContent = `Last notification sent: ${timeStr} today`;
            } else {
                testBtn.innerHTML = '<i class="bi bi-x-circle"></i> Failed';
            }
        } catch (e) {
            console.error('Test notification failed:', e);
            testBtn.innerHTML = '<i class="bi bi-x-circle"></i> Error';
        }

        setTimeout(() => {
            testBtn.disabled = false;
            testBtn.innerHTML = '<i class="bi bi-send"></i> Test notification';
            testBtn.classList.remove('sent');
        }, 2000);
    });
}

// ══════════════════════════════════════════════════════
// MOTION SENSOR
// ══════════════════════════════════════════════════════

function renderMotionSensor() {
    const sensor = settings.motion_sensor || {};
    const dot = document.getElementById('sensor-dot');
    const status = document.getElementById('sensor-status');
    const last = document.getElementById('sensor-last');
    const count = document.getElementById('sensor-count');

    if (sensor.status === 'online') {
        dot.className = 'settings-status-dot online';
        status.textContent = 'Online';
    } else {
        dot.className = 'settings-status-dot offline';
        status.textContent = 'Offline';
    }

    if (sensor.last_event) {
        const t = new Date(sensor.last_event);
        const now = new Date();
        const diffMs = now - t;
        const diffMin = Math.floor(diffMs / 60000);
        const timeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        if (diffMin < 60) {
            last.textContent = `Last event: departure at ${timeStr} (${diffMin} min ago)`;
        } else if (t.toDateString() === now.toDateString()) {
            last.textContent = `Last event: departure at ${timeStr} today`;
        } else {
            const dateStr = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            last.textContent = `Last event: departure at ${timeStr}, ${dateStr}`;
        }
    } else {
        last.textContent = 'No events recorded';
    }

    count.textContent = `Events today: ${sensor.events_today || 0}`;
}

// ══════════════════════════════════════════════════════
// MODE AUTO-SWITCHING
// ══════════════════════════════════════════════════════

function renderAutoSwitch() {
    const toggle = document.getElementById('auto-switch-toggle');
    const timeField = document.getElementById('switch-time-field');
    const timeInput = document.getElementById('switch-time');

    toggle.checked = settings.mode_auto_switch !== false;
    timeInput.value = settings.mode_switch_time || '12:00';
    timeField.style.display = toggle.checked ? '' : 'none';

    // Restore from localStorage
    const savedToggle = localStorage.getItem('ds_auto_switch');
    if (savedToggle !== null) toggle.checked = savedToggle === 'true';

    const savedTime = localStorage.getItem('ds_switch_time');
    if (savedTime) timeInput.value = savedTime;

    timeField.style.display = toggle.checked ? '' : 'none';

    toggle.addEventListener('change', () => {
        timeField.style.display = toggle.checked ? '' : 'none';
        localStorage.setItem('ds_auto_switch', toggle.checked);
    });

    timeInput.addEventListener('change', () => {
        localStorage.setItem('ds_switch_time', timeInput.value);
    });
}

// ══════════════════════════════════════════════════════
// APPEARANCE
// ══════════════════════════════════════════════════════

function renderAppearance() {
    const control = document.getElementById('appearance-control');
    const buttons = control.querySelectorAll('.ds-segmented-btn');

    // Restore saved theme
    const saved = localStorage.getItem('ds_appearance') || 'system';
    buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === saved);
    });

    control.addEventListener('click', (e) => {
        const btn = e.target.closest('.ds-segmented-btn');
        if (!btn) return;

        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const theme = btn.dataset.theme;
        localStorage.setItem('ds_appearance', theme);
        applyTheme(theme);
    });

    applyTheme(saved);
}

function applyTheme(theme) {
    const html = document.documentElement;
    if (theme === 'dark') {
        html.setAttribute('data-bs-theme', 'dark');
    } else if (theme === 'light') {
        html.setAttribute('data-bs-theme', 'light');
    } else {
        // System: remove attribute, let media queries handle it
        html.removeAttribute('data-bs-theme');
    }
}
