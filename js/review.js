// js/review.js
import { navigate, openDrawer, state } from './app.js';
import { db } from './db.js';
import { api } from './api.js';
import { LUCIDITY_LEVELS } from './record.js';

// ── Local state for this screen ───────────────────────
let draft = {
  rawTranscript:     '',
  cleanedTranscript: '',
  lucidity:          0,
  lucidityLabel:     'Unaware',
  emotions:          [],
  themes:            [],
  characters:        [],
  locations:         [],
  dreamSigns:        [],
  summary:           '',
};

export function render(container) {
  draft.rawTranscript = state.pendingTranscript || '';
  draft.cleanedTranscript = '';
  draft.lucidity = 0;
  draft.lucidityLabel = 'Unaware';
  draft.emotions   = [];
  draft.themes     = [];
  draft.characters = [];
  draft.locations  = [];
  draft.dreamSigns = [];
  draft.summary    = '';

  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <button class="hamburger" id="rev-menu" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
        <span class="screen-title">Review Dream</span>
        <button class="btn-secondary btn-danger" id="rev-discard" style="padding:6px 10px;font-size:12px">Discard</button>
      </div>

      <div class="screen-body" id="rev-body">
        <!-- Transcript -->
        <label class="field-label" for="rev-transcript">Transcript</label>
        <textarea id="rev-transcript" class="input textarea" rows="5" placeholder="Loading cleaned transcript..."></textarea>
        <details style="margin-top:6px">
          <summary style="font-size:12px;color:var(--text-ghost);cursor:pointer">▶ View raw recording</summary>
          <div id="rev-raw" style="font-size:12px;color:var(--text-faint);padding:10px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-top:6px;line-height:1.5"></div>
        </details>

        <!-- Lucidity -->
        <div class="mt-16">
          <span class="field-label">Lucidity level</span>
          <div class="lucidity-selector" id="rev-lucidity"></div>
        </div>

        <!-- Tag fields -->
        ${tagField('Emotions',    'rev-emotions',    'emotions')}
        ${tagField('Themes',      'rev-themes',      'themes')}
        ${tagField('Characters',  'rev-characters',  'characters')}
        ${tagField('Locations',   'rev-locations',   'locations')}
        ${tagField('Dream Signs', 'rev-dreamsigns',  'dreamSigns')}

        <!-- Summary -->
        <div class="mt-16">
          <label class="field-label" for="rev-summary">Summary</label>
          <textarea id="rev-summary" class="input textarea" rows="3" placeholder="Analysing..."></textarea>
        </div>

        <!-- Save -->
        <div class="mt-20 safe-bottom">
          <button class="btn-primary" id="rev-save" disabled>Analysing dream...</button>
        </div>
      </div>
    </div>
  `;

  // Wire up
  document.getElementById('rev-menu').addEventListener('click', openDrawer);
  document.getElementById('rev-discard').addEventListener('click', () => {
    if (confirm('Discard this dream?')) navigate('record');
  });

  // Set raw transcript display
  document.getElementById('rev-raw').textContent = draft.rawTranscript;

  // Render lucidity selector
  renderLuciditySelector();

  // Render (empty) tag fields
  renderAllTagFields();

  // Wire tag inputs once (not on every re-render)
  const fields = [
    { id: 'rev-emotions',   key: 'emotions' },
    { id: 'rev-themes',     key: 'themes' },
    { id: 'rev-characters', key: 'characters' },
    { id: 'rev-locations',  key: 'locations' },
    { id: 'rev-dreamsigns', key: 'dreamSigns' },
  ];
  fields.forEach(({ id, key }) => wireTagInput(id, key));

  // Start analysis
  runAnalysis();
}

// ── Analysis ──────────────────────────────────────────
async function runAnalysis() {
  const transcriptEl = document.getElementById('rev-transcript');
  const summaryEl    = document.getElementById('rev-summary');

  try {
    const result = await api.analyseTranscript(draft.rawTranscript);

    // Guard: if user navigated away, elements are gone
    if (!document.getElementById('rev-transcript')) return;

    draft.cleanedTranscript = result.cleanedTranscript;
    draft.emotions    = result.analysis.emotions    || [];
    draft.themes      = result.analysis.themes      || [];
    draft.characters  = result.analysis.characters  || [];
    draft.locations   = result.analysis.locations   || [];
    draft.dreamSigns  = result.analysis.dream_signs || [];
    draft.summary     = result.analysis.summary     || '';

    transcriptEl.value = draft.cleanedTranscript;
    summaryEl.value    = draft.summary;
    renderAllTagFields();
  } catch (err) {
    if (!document.getElementById('rev-transcript')) return;
    // Graceful degradation — user fills in manually
    transcriptEl.placeholder = 'Analysis unavailable — fill in manually.';
    summaryEl.placeholder    = 'Analysis unavailable — fill in manually.';
    console.warn('Analysis failed:', err);
  } finally {
    const btn = document.getElementById('rev-save');
    if (!btn) return; // navigated away
    btn.disabled    = false;
    btn.textContent = 'Save to Notion';
    btn.onclick = handleSave; // use onclick to prevent listener accumulation
  }
}

// ── Save ──────────────────────────────────────────────
async function handleSave() {
  const saveBtn = document.getElementById('rev-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  // Read current values from DOM (user may have edited)
  const dreamToSave = {
    id:               crypto.randomUUID(),
    date:             new Date().toISOString().slice(0, 10),
    rawTranscript:    draft.rawTranscript,
    cleanedTranscript: document.getElementById('rev-transcript').value,
    lucidity:          draft.lucidity,
    lucidityLabel:     draft.lucidityLabel,
    emotions:          getChips('rev-emotions'),
    themes:            getChips('rev-themes'),
    characters:        getChips('rev-characters'),
    locations:         getChips('rev-locations'),
    dreamSigns:        getChips('rev-dreamsigns'),
    summary:           document.getElementById('rev-summary').value,
    notionPageId:      null,
  };

  // Save to localStorage immediately
  db.saveDream(dreamToSave);

  // Update tag history
  db.addToTagHistory('emotions',   dreamToSave.emotions);
  db.addToTagHistory('themes',     dreamToSave.themes);
  db.addToTagHistory('characters', dreamToSave.characters);
  db.addToTagHistory('locations',  dreamToSave.locations);
  db.addToTagHistory('dreamSigns', dreamToSave.dreamSigns);

  // Save to Notion (best-effort — don't block user)
  try {
    const { notionPageId } = await api.saveDream(dreamToSave);
    db.updateDream(dreamToSave.id, { notionPageId });
  } catch (err) {
    console.warn('Notion save failed — entry saved locally:', err);
  }

  showPostSaveConfirmation();
}

function showPostSaveConfirmation() {
  const body = document.getElementById('rev-body');
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:20px;text-align:center">
      <div style="font-size:48px">🌙</div>
      <h2 style="font-size:22px">Dream saved</h2>
      <p style="color:var(--text-faint);font-size:14px">Good work logging that one.</p>
      <div style="display:flex;flex-direction:column;gap:10px;width:100%">
        <button class="btn-primary" id="conf-another">Record another dream</button>
        <button class="btn-secondary" id="conf-done" style="width:100%;text-align:center">Done</button>
      </div>
    </div>
  `;
  document.getElementById('conf-another').addEventListener('click', () => navigate('record'));
  document.getElementById('conf-done').addEventListener('click', () => navigate('journal'));
}

// ── Lucidity selector ─────────────────────────────────
function renderLuciditySelector() {
  const container = document.getElementById('rev-lucidity');
  if (!container) return;
  container.innerHTML = LUCIDITY_LEVELS.map(l => `
    <button class="lucidity-opt${l.value === draft.lucidity ? ' selected' : ''}"
            data-value="${l.value}" data-label="${l.name}">
      <span class="lopt-name">${l.name}</span>
      <span class="lopt-desc">${l.desc}</span>
    </button>
  `).join('');

  container.querySelectorAll('.lucidity-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      draft.lucidity      = Number(btn.dataset.value);
      draft.lucidityLabel = btn.dataset.label;
      container.querySelectorAll('.lucidity-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}

// ── Tag chip fields ───────────────────────────────────
function tagField(label, id, field) {
  return `
    <div class="mt-16">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span class="field-label" style="margin-bottom:0">${label}</span>
        <button id="${id}-add" style="background:none;border:none;color:var(--accent-soft);font-size:22px;cursor:pointer;padding:0;line-height:1;width:28px;height:28px;display:flex;align-items:center;justify-content:center">+</button>
      </div>
      <div class="chips-row" id="${id}"></div>
      <div class="chip-input-wrap" id="${id}-input-wrap" style="display:none;margin-top:8px;position:relative">
        <input type="text" placeholder="Tag name" data-field="${field}"
               autocomplete="new-password" autocorrect="off" spellcheck="false"
               style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-soft);border-radius:var(--radius-sm);color:var(--text-primary);font-size:16px;outline:none;padding:8px 12px"
               class="chip-text-input" id="${id}-input">
        <div class="chip-autocomplete" id="${id}-autocomplete" style="display:none"></div>
      </div>
    </div>
  `;
}

function renderAllTagFields() {
  const fields = [
    { id: 'rev-emotions',   key: 'emotions' },
    { id: 'rev-themes',     key: 'themes' },
    { id: 'rev-characters', key: 'characters' },
    { id: 'rev-locations',  key: 'locations' },
    { id: 'rev-dreamsigns', key: 'dreamSigns' },
  ];
  fields.forEach(({ id, key }) => renderTagField(id, draft[key], key));
}

function renderTagField(containerId, tags, draftKey) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = tags.map(tag => `
    <span class="chip" data-tag="${tag}" data-field="${draftKey}">
      <span class="chip-remove">×</span> ${tag}
    </span>
  `).join('');

  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      draft[draftKey] = draft[draftKey].filter(t => t !== chip.dataset.tag);
      renderTagField(containerId, draft[draftKey], draftKey);
    });
  });

  // NOTE: wireTagInput is NOT called here anymore
}

function wireTagInput(containerId, draftKey) {
  const input    = document.getElementById(`${containerId}-input`);
  const acList   = document.getElementById(`${containerId}-autocomplete`);
  if (!input || !acList) return;

  const tagHistory = db.getTagHistory();
  const historyArr = tagHistory[draftKey] || [];

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    if (!val) { acList.style.display = 'none'; return; }

    const matches = historyArr.filter(t => t.toLowerCase().startsWith(val) && !draft[draftKey].includes(t));
    if (!matches.length) { acList.style.display = 'none'; return; }

    acList.innerHTML = matches.slice(0, 5).map(m =>
      `<div class="chip-autocomplete-item" data-tag="${m}">${m}</div>`
    ).join('');
    acList.style.display = 'block';

    acList.querySelectorAll('.chip-autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        addTag(containerId, draftKey, item.dataset.tag);
        input.value = '';
        acList.style.display = 'none';
      });
    });
  });

  const wrap   = document.getElementById(`${containerId}-input-wrap`);
  const addBtn = document.getElementById(`${containerId}-add`);

  function showInput() {
    wrap.style.display = 'block';
    input.focus();
  }

  function hideInput() {
    wrap.style.display = 'none';
    input.value = '';
    acList.style.display = 'none';
  }

  let _blurTimer = null;

  function commitInput() {
    clearTimeout(_blurTimer);
    const val = input.value.trim();
    if (val) addTag(containerId, draftKey, val);
    hideInput();
  }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (wrap.style.display === 'none') showInput();
      else commitInput();
    });
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitInput(); }
    if (e.key === 'Escape') { clearTimeout(_blurTimer); hideInput(); }
  });

  // Commit on tap-away; delay lets autocomplete clicks fire first
  input.addEventListener('blur', () => {
    _blurTimer = setTimeout(commitInput, 150);
  });
  acList.addEventListener('mousedown', () => clearTimeout(_blurTimer));
  acList.addEventListener('touchstart', () => clearTimeout(_blurTimer), { passive: true });
}

function addTag(containerId, draftKey, tag) {
  if (!draft[draftKey].includes(tag)) {
    draft[draftKey].push(tag);
    renderTagField(containerId, draft[draftKey], draftKey);
  }
}

function getChips(containerId) {
  const el = document.getElementById(containerId);
  return el ? Array.from(el.querySelectorAll('.chip')).map(c => c.dataset.tag) : [];
}
