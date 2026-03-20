// js/record.js
import { navigate, openDrawer } from './app.js';

// ── Lucidity levels ───────────────────────────────────
export const LUCIDITY_LEVELS = [
  { value: 0, name: 'Unaware',  desc: 'Normal dream, no awareness' },
  { value: 1, name: 'Glimmer',  desc: 'Something felt off' },
  { value: 2, name: 'Flicker',  desc: 'Knew briefly, then lost it' },
  { value: 3, name: 'Witness',  desc: 'Aware, along for the ride' },
  { value: 4, name: 'Pilot',    desc: 'Aware and acted on it' },
  { value: 5, name: 'Architect',desc: 'Shaped the dream itself' },
];

// ── Recording state ───────────────────────────────────
let recognition = null;
let isRecording  = false;
let isPaused     = false;
let rawTranscript = '';
let _container = null;

// ── Render ────────────────────────────────────────────
export function render(container) {
  _container = container;
  // Clean up any active recognition when navigating away
  stopRecognition();
  rawTranscript = '';
  isRecording   = false;
  isPaused      = false;

  container.innerHTML = `
    <div class="screen" id="record-screen">
      <div class="screen-header">
        <button class="hamburger" id="rec-menu" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
        <div style="text-align:center">
          <div id="rec-date" style="font-size:13px;color:var(--text-faint)"></div>
          <div id="rec-nudge" style="font-size:12px;color:var(--text-ghost);margin-top:2px"></div>
        </div>
        <div style="width:28px"></div>
      </div>

      <div class="screen-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center">
        <button class="record-btn" id="rec-btn" aria-label="Start recording">
          ${iconCircle()}
        </button>
        <p id="rec-hint" style="margin-top:16px;font-size:13px;color:var(--text-ghost)"></p>
      </div>

      <div id="rec-controls" style="display:none;padding:0 20px 20px" class="safe-bottom">
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <button class="btn-secondary" id="rec-pause" style="flex:1">⏸ Pause</button>
          <button class="btn-secondary btn-danger" id="rec-discard" style="flex:1">✕ Discard</button>
        </div>
        <button class="btn-primary" id="rec-submit">Submit Journal Entry</button>
      </div>
    </div>
  `;

  // Set date
  document.getElementById('rec-date').textContent = formatDate(new Date());

  // Set nudge from localStorage dream count
  setNudge();

  // Wire up events
  document.getElementById('rec-menu').addEventListener('click', openDrawer);
  document.getElementById('rec-btn').addEventListener('click', handleRecordTap);
  document.getElementById('rec-pause')?.addEventListener('click', handlePauseTap);
  document.getElementById('rec-discard')?.addEventListener('click', handleDiscard);
  document.getElementById('rec-submit')?.addEventListener('click', handleSubmit);
}

// ── Handlers ──────────────────────────────────────────
function handleRecordTap() {
  // Big button drives the full recording lifecycle:
  //   idle → start  |  recording → pause  |  paused → resume
  if (!isRecording && !isPaused) {
    startRecording();
  } else if (isRecording && !isPaused) {
    pauseRecording();
  } else if (isPaused) {
    resumeRecording();
  }
}

function handlePauseTap() {
  if (isPaused) {
    resumeRecording();
  } else {
    pauseRecording();
  }
}

function handleDiscard() {
  if (!confirm('Discard this entry?')) return;
  stopRecognition();
  render(_container);
}

function handleSubmit() {
  if (!rawTranscript.trim()) {
    alert('Nothing recorded yet — tap the button and speak before submitting.');
    return;
  }
  stopRecognition();
  // Pass raw transcript to shared state, navigate to review
  navigate('review', { pendingTranscript: rawTranscript });
}

// ── Recording logic ───────────────────────────────────
function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const r = new SpeechRecognition();
  r.continuous     = true;
  r.interimResults = false;
  r.lang           = 'en-US';
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) rawTranscript += e.results[i][0].transcript + ' ';
    }
  };
  r.onerror = (e) => {
    if (e.error !== 'aborted') console.warn('Speech recognition error:', e.error);
  };
  r.onend = () => {
    if (isRecording && !isPaused) {
      isRecording = false;
      isPaused = true;
      updateUI('paused');
    }
  };
  return r;
}

async function startRecording() {
  recognition = createRecognition();
  if (!recognition) {
    alert('Voice recording is not supported in this browser. Use Safari on iPhone or Chrome on desktop.');
    return;
  }
  recognition.start();
  isRecording = true;
  isPaused    = false;
  updateUI('recording');
}

function pauseRecording() {
  recognition?.stop();
  isRecording = false;
  isPaused = true;
  updateUI('paused');
}

function resumeRecording() {
  // Fresh instance — calling start() on a stopped instance throws in some browsers
  recognition = createRecognition();
  recognition.start();
  isRecording = true;
  isPaused    = false;
  updateUI('recording');
}

function stopRecognition() {
  recognition?.stop();
  recognition = null;
  isRecording = false;
  isPaused    = false;
}

// ── UI updates ────────────────────────────────────────
function updateUI(state) {
  const btn = document.getElementById('rec-btn');
  if (!btn) return; // navigated away; ignore stale callback
  const hint     = document.getElementById('rec-hint');
  const controls = document.getElementById('rec-controls');
  const pauseBtn = document.getElementById('rec-pause');

  if (state === 'recording') {
    btn.className = 'record-btn recording';
    btn.innerHTML = iconStop();
    hint.textContent = '';
    hint.style.display = ''; // reset to stylesheet default
    controls.style.display = 'block';
    pauseBtn.textContent = '⏸ Pause';
  } else if (state === 'paused') {
    btn.className = 'record-btn paused';
    btn.innerHTML = iconPause();
    hint.textContent = 'Paused — tap Resume to continue';
    hint.style.display = 'block';
    pauseBtn.textContent = '▶ Resume';
  }
}

// ── Helpers ───────────────────────────────────────────
function iconCircle() {
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>`;
}
function iconStop() {
  return `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
}
function iconPause() {
  return `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
}

function formatDate(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

async function setNudge() {
  try {
    const { db } = await import('./db.js'); // lazy import avoids circular dep
    const recent = db.getRecentDreams(7);
    const nudge = document.getElementById('rec-nudge');
    if (nudge) nudge.textContent = recent.length
      ? `You've logged ${recent.length} dream${recent.length > 1 ? 's' : ''} this week`
      : 'Start logging your dreams';
  } catch { /* ignore */ }
}
