/**
 * Door2Dock onboarding tour.
 * Lightweight tooltip walkthrough for first-time visitors.
 */
(function () {
    'use strict';

    var LS_SEEN = 'door2dock_tour_seen';
    var LS_STEP = 'door2dock_tour_step';

    var STEPS = [
        {
            page: '/',
            selector: null, // centred welcome
            text: 'Welcome to Door2Dock! Let\'s take a quick tour. We predict Santander Cycles availability near Imperial College so you always know where to go.',
            position: 'center',
        },
        {
            page: '/go?timing=now',
            selector: '#to-now-result, #to-now-skeleton',
            text: 'This is your recommendation. It shows the best station to dock your bike, with predicted availability in 15 minutes.',
            position: 'bottom',
        },
        {
            page: '/go?timing=now',
            selector: '.go-dir-toggle',
            text: 'Switch between To Imperial (finding docks to park) and From Imperial (finding bikes to ride home).',
            position: 'bottom',
        },
        {
            page: '/go?timing=plan',
            selector: '#state-to-plan .plan-card',
            text: 'Planning ahead? Set your arrival time and day, then tap Get recommendation to see which station will have space.',
            position: 'bottom',
        },
        {
            page: '/insights',
            selector: '#ins-nav',
            text: 'Explore data patterns, model performance, and system architecture here. This is the full story behind the predictions.',
            position: 'bottom',
        },
        {
            page: '/settings',
            selector: '.station-reorder-list',
            text: 'Drag to reorder your preferred stations. The top stations get priority in recommendations.',
            position: 'bottom',
        },
        {
            page: '/settings',
            selector: '#tg-test-btn',
            text: 'Door2Dock can send push notifications to your phone via Telegram when dock availability changes. Test the connection here. That\'s it, you\'re ready to go!',
            position: 'top',
        },
    ];

    var overlay = null;
    var tooltip = null;
    var highlightedEl = null;
    var currentStep = 0;

    function isOnPage(pagePath) {
        var loc = window.location.pathname + window.location.search;
        // Normalise trailing slashes
        if (pagePath === '/') return loc === '/' || loc === '';
        return loc.indexOf(pagePath) === 0;
    }

    function navigateTo(pagePath) {
        window.location.href = pagePath;
    }

    function createOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'tour-overlay';
        document.body.appendChild(overlay);
    }

    function removeOverlay() {
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
    }

    function removeTooltip() {
        if (tooltip) {
            tooltip.remove();
            tooltip = null;
        }
        if (highlightedEl) {
            highlightedEl.classList.remove('tour-highlight');
            highlightedEl.style.position = '';
            highlightedEl.style.zIndex = '';
            highlightedEl = null;
        }
    }

    function endTour() {
        localStorage.setItem(LS_SEEN, 'true');
        localStorage.removeItem(LS_STEP);
        removeTooltip();
        removeOverlay();
    }

    function buildProgressDots(current, total) {
        var html = '<div class="tour-dots">';
        for (var i = 0; i < total; i++) {
            html += '<span class="tour-dot' + (i <= current ? ' active' : '') + '"></span>';
        }
        html += '</div>';
        return html;
    }

    function showStep(stepIndex) {
        currentStep = stepIndex;
        localStorage.setItem(LS_STEP, String(stepIndex));

        var step = STEPS[stepIndex];

        // Check if we need to navigate
        if (!isOnPage(step.page)) {
            navigateTo(step.page);
            return; // Page will reload and resume tour
        }

        createOverlay();
        removeTooltip();

        // Find target element
        var targetEl = null;
        if (step.selector) {
            // Try each selector (comma-separated fallbacks)
            var selectors = step.selector.split(',').map(function (s) { return s.trim(); });
            for (var i = 0; i < selectors.length; i++) {
                targetEl = document.querySelector(selectors[i]);
                if (targetEl && targetEl.offsetParent !== null) break;
                // If element exists but is hidden, check next
                if (targetEl && targetEl.style.display === 'none') targetEl = null;
            }
        }

        // Highlight element
        if (targetEl) {
            highlightedEl = targetEl;
            var computedPos = window.getComputedStyle(targetEl).position;
            if (computedPos === 'static') {
                targetEl.style.position = 'relative';
            }
            targetEl.style.zIndex = '10001';
            targetEl.classList.add('tour-highlight');

            // Scroll element into view
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Build tooltip
        tooltip = document.createElement('div');
        tooltip.className = 'tour-tooltip';

        var isFirst = stepIndex === 0;
        var isLast = stepIndex === STEPS.length - 1;

        var buttonsHtml = '<div class="tour-btns">';
        if (isFirst) {
            buttonsHtml += '<button class="tour-btn tour-btn-outline" data-action="skip">Skip tour</button>';
        } else {
            buttonsHtml += '<button class="tour-btn tour-btn-outline" data-action="back">Back</button>';
        }
        buttonsHtml += buildProgressDots(stepIndex, STEPS.length);
        if (isLast) {
            buttonsHtml += '<button class="tour-btn tour-btn-fill" data-action="finish">Finish</button>';
        } else {
            buttonsHtml += '<button class="tour-btn tour-btn-fill" data-action="next">Next</button>';
        }
        buttonsHtml += '</div>';

        tooltip.innerHTML =
            '<button class="tour-close" data-action="close" aria-label="Close tour">&times;</button>' +
            '<div class="tour-text">' + step.text + '</div>' +
            buttonsHtml;

        document.body.appendChild(tooltip);

        // Position tooltip
        positionTooltip(targetEl, step.position);

        // Wire button events
        tooltip.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            var action = btn.getAttribute('data-action');
            if (action === 'next') showStep(stepIndex + 1);
            else if (action === 'back') showStep(stepIndex - 1);
            else if (action === 'skip' || action === 'close' || action === 'finish') endTour();
        });
    }

    function positionTooltip(targetEl, preferredPos) {
        if (!tooltip) return;

        // Centre mode (no target element)
        if (!targetEl) {
            tooltip.classList.add('tour-center');
            return;
        }

        // Wait a frame for scroll to settle
        requestAnimationFrame(function () {
            var rect = targetEl.getBoundingClientRect();
            var tipRect = tooltip.getBoundingClientRect();
            var margin = 12;
            var viewW = window.innerWidth;
            var viewH = window.innerHeight;

            // Decide position: prefer below, but flip if not enough space
            var pos = preferredPos || 'bottom';
            if (pos === 'bottom' && rect.bottom + margin + tipRect.height > viewH) {
                pos = 'top';
            }
            if (pos === 'top' && rect.top - margin - tipRect.height < 0) {
                pos = 'bottom';
            }

            var top, left;
            if (pos === 'bottom') {
                top = rect.bottom + margin;
                left = rect.left + rect.width / 2 - tipRect.width / 2;
                tooltip.setAttribute('data-pos', 'bottom');
            } else {
                top = rect.top - margin - tipRect.height;
                left = rect.left + rect.width / 2 - tipRect.width / 2;
                tooltip.setAttribute('data-pos', 'top');
            }

            // Clamp horizontally
            if (left < 12) left = 12;
            if (left + tipRect.width > viewW - 12) left = viewW - 12 - tipRect.width;

            tooltip.style.position = 'fixed';
            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';
        });
    }

    // Resume tour on page load
    function init() {
        var step = localStorage.getItem(LS_STEP);
        var seen = localStorage.getItem(LS_SEEN);

        if (step !== null && seen !== 'true') {
            // Resume tour after page settles
            setTimeout(function () {
                showStep(parseInt(step, 10));
            }, 600);
        } else if (!seen) {
            // First visit: auto-start after delay
            setTimeout(function () {
                showStep(0);
            }, 1000);
        }
    }

    // Expose startTour globally for the replay button
    window.startTour = function () {
        localStorage.removeItem(LS_SEEN);
        localStorage.removeItem(LS_STEP);
        showStep(0);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Small delay even if DOM ready, to let page JS render
        setTimeout(init, 300);
    }
})();
