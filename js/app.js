// js/app.js
import { render as renderRecord }   from './record.js';
import { render as renderReview }   from './review.js';
import { render as renderJournal }  from './journal.js';
import { render as renderPatterns } from './patterns.js';
import { render as renderSettings } from './settings.js';

// ── Shared state ─────────────────────────────────────
// Single source of truth passed between screens.
export const state = {
  pendingTranscript: null,   // raw string from Web Speech API
  pendingDream: null,        // { transcript, cleanedTranscript } waiting for review
  currentScreen: 'record',
};

// ── Screen registry ───────────────────────────────────
const screens = {
  record:   renderRecord,
  review:   renderReview,
  journal:  renderJournal,
  patterns: renderPatterns,
  settings: renderSettings,
};

// ── Router ────────────────────────────────────────────
const appEl = document.getElementById('app');

export function navigate(screenName, params = {}) {
  if (!screens[screenName]) {
    console.error(`Unknown screen: ${screenName}`);
    return;
  }
  // Merge any params into state so target screen can read them
  Object.assign(state, params);
  state.currentScreen = screenName;

  // Re-render drawer with updated active item
  renderDrawer();

  const screenContainer = appEl.querySelector('.screen-container');
  screens[screenName](screenContainer);
}

// ── Nav drawer ────────────────────────────────────────
const NAV_ITEMS = [
  { screen: 'record',   icon: '🌙', label: 'Home' },
  { screen: 'journal',  icon: '📖', label: 'Journal' },
  { screen: 'patterns', icon: '📊', label: 'Patterns' },
  { screen: 'settings', icon: '⚙️',  label: 'Settings' },
];

function renderDrawer() {
  const existing = appEl.querySelector('.drawer-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';

  const drawer = document.createElement('div');
  drawer.className = 'drawer';

  NAV_ITEMS.forEach(({ screen, icon, label }) => {
    const btn = document.createElement('button');
    btn.className = 'drawer-item' + (state.currentScreen === screen ? ' active' : '');
    btn.innerHTML = `<span class="icon">${icon}</span><span>${label}</span>`;
    btn.addEventListener('click', () => {
      closeDrawer();
      navigate(screen);
    });
    drawer.appendChild(btn);
  });

  overlay.appendChild(drawer);
  appEl.prepend(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDrawer();
  });
}

export function openDrawer() {
  const overlay = appEl.querySelector('.drawer-overlay');
  const drawer  = appEl.querySelector('.drawer');
  if (overlay && drawer) {
    overlay.classList.add('open');
    drawer.classList.add('open');
  }
}

function closeDrawer() {
  const overlay = appEl.querySelector('.drawer-overlay');
  const drawer  = appEl.querySelector('.drawer');
  if (overlay && drawer) {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
  }
}

// ── Bootstrap ─────────────────────────────────────────
function boot() {
  appEl.innerHTML = `
    <div class="screen-container" style="flex:1;display:flex;flex-direction:column;overflow:hidden"></div>
  `;
  renderDrawer();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.warn);
  }

  navigate('record');
}

boot();
