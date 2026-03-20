// js/journal.js
import { openDrawer } from './app.js';
import { db } from './db.js';
import { api } from './api.js';
import { LUCIDITY_LEVELS } from './record.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function render(container) {
  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <button class="hamburger" id="jnl-menu" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
        <span class="screen-title">Dream Journal</span>
        <div style="width:28px"></div>
      </div>
      <div class="screen-body" id="jnl-body">
        <p style="color:var(--text-ghost);font-size:13px">Loading...</p>
      </div>
    </div>
  `;

  document.getElementById('jnl-menu').addEventListener('click', openDrawer);
  loadJournal();
}

async function loadJournal() {
  const body = document.getElementById('jnl-body');
  if (!body) return;

  // Show local cache immediately
  const localDreams = db.getDreams();
  renderList(body, localDreams);

  // Refresh from Notion in background
  try {
    await api.getDreams();
    // Note: In v1, Notion results are used as a reference — local cache is authoritative.
    // A future phase can add bidirectional sync.
  } catch { /* offline — show local cache */ }
}

function renderList(body, dreams) {
  if (!dreams.length) {
    body.innerHTML = `
      <div style="text-align:center;padding:40px 0">
        <p style="font-size:32px;margin-bottom:12px">🌙</p>
        <p style="color:var(--text-faint)">No dreams logged yet.</p>
        <p style="color:var(--text-ghost);font-size:13px;margin-top:6px">Tap Home to record your first dream.</p>
      </div>
    `;
    return;
  }
  body.innerHTML = dreams.map(d => dreamCard(d)).join('');
  body.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => renderDetail(body, db.getDreams().find(d => d.id === card.dataset.id)));
  });
}

function dreamCard(dream) {
  const level = LUCIDITY_LEVELS[dream.lucidity] || LUCIDITY_LEVELS[0];
  const badgeClass = dream.lucidity >= 4 ? 'badge-high' : dream.lucidity > 0 ? 'badge-lucid' : 'badge-none';
  const topSigns = (dream.dreamSigns || []).slice(0, 3).map(t =>
    `<span style="font-size:11px;padding:2px 7px;border-radius:999px;background:var(--bg-elevated);color:var(--text-ghost);border:1px solid var(--border-soft)">${esc(t)}</span>`
  ).join('');

  return `
    <div class="card" data-id="${esc(dream.id)}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:12px;color:var(--text-faint)">${esc(dream.date)}</span>
        <span class="badge ${badgeClass}">${esc(level.name)}</span>
      </div>
      <p style="font-size:14px;color:var(--text-muted);line-height:1.4;margin-bottom:8px">${esc((dream.summary || '').slice(0, 80))}${dream.summary?.length > 80 ? '…' : ''}</p>
      <div style="display:flex;gap:5px;flex-wrap:wrap">${topSigns}</div>
    </div>
  `;
}

// ── Detail view ───────────────────────────────────────
function renderDetail(body, dream) {
  if (!dream) return;
  const level = LUCIDITY_LEVELS[dream.lucidity] || LUCIDITY_LEVELS[0];
  const badgeClass = dream.lucidity >= 4 ? 'badge-high' : dream.lucidity > 0 ? 'badge-lucid' : 'badge-none';

  body.innerHTML = `
    <div style="padding-bottom:20px" class="safe-bottom">
      <button id="det-back" style="background:none;border:none;color:var(--accent-soft);font-size:13px;cursor:pointer;padding:0 0 12px">← Back</button>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:13px;color:var(--text-faint)">${esc(dream.date)}</span>
        <span class="badge ${badgeClass}">${esc(level.name)}</span>
      </div>

      <p style="font-size:14px;line-height:1.6;color:var(--text-muted);margin-bottom:12px">${esc(dream.cleanedTranscript || '')}</p>

      <details style="margin-bottom:16px">
        <summary style="font-size:12px;color:var(--text-ghost);cursor:pointer">▶ View raw recording</summary>
        <p style="font-size:12px;color:var(--text-faint);padding:10px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-top:6px;line-height:1.5">${esc(dream.rawTranscript || '')}</p>
      </details>

      ${detailTagRow('Dream Signs', dream.dreamSigns)}
      ${detailTagRow('Emotions',    dream.emotions)}
      ${detailTagRow('Themes',      dream.themes)}
      ${detailTagRow('Characters',  dream.characters)}
      ${detailTagRow('Locations',   dream.locations)}

      <div style="margin-top:16px;padding:12px;background:var(--bg-elevated);border-radius:var(--radius-sm)">
        <p style="font-size:13px;color:var(--text-muted);line-height:1.5">${esc(dream.summary || '')}</p>
      </div>

      <button class="btn-secondary mt-20" id="det-edit" style="width:100%;text-align:center">✏️ Edit tags & details</button>
    </div>
  `;

  document.getElementById('det-back').addEventListener('click', () => renderList(body, db.getDreams()));
  document.getElementById('det-edit').addEventListener('click', () => renderEditMode(body, dream));
}

function detailTagRow(label, tags) {
  if (!tags?.length) return '';
  const chips = tags.map(t => `<span class="chip" style="cursor:default">${esc(t)}</span>`).join('');
  return `<div class="mt-12"><span class="field-label">${label}</span><div class="chips-row">${chips}</div></div>`;
}

// ── Edit mode ─────────────────────────────────────────
function renderEditMode(body, dream) {
  const editDraft = {
    lucidity:   dream.lucidity,
    lucidityLabel: dream.lucidityLabel || LUCIDITY_LEVELS[dream.lucidity]?.name,
    emotions:   [...(dream.emotions || [])],
    themes:     [...(dream.themes || [])],
    characters: [...(dream.characters || [])],
    locations:  [...(dream.locations || [])],
    dreamSigns: [...(dream.dreamSigns || [])],
    summary:    dream.summary || '',
  };

  body.innerHTML = `
    <div class="safe-bottom">
      <button id="edit-back" style="background:none;border:none;color:var(--accent-soft);font-size:13px;cursor:pointer;padding:0 0 12px">← Cancel</button>

      <div class="mt-8">
        <span class="field-label">Lucidity level</span>
        <div class="lucidity-selector" id="edit-lucidity"></div>
      </div>

      ${editTagField('Emotions',    'edit-emotions',   'emotions',   editDraft)}
      ${editTagField('Themes',      'edit-themes',     'themes',     editDraft)}
      ${editTagField('Characters',  'edit-characters', 'characters', editDraft)}
      ${editTagField('Locations',   'edit-locations',  'locations',  editDraft)}
      ${editTagField('Dream Signs', 'edit-dreamsigns', 'dreamSigns', editDraft)}

      <div class="mt-16">
        <label class="field-label" for="edit-summary">Summary</label>
        <textarea id="edit-summary" class="input textarea" rows="3">${esc(editDraft.summary)}</textarea>
      </div>

      <button class="btn-primary mt-20" id="edit-save">Save changes</button>
    </div>
  `;

  // Lucidity selector
  const lucContainer = document.getElementById('edit-lucidity');
  lucContainer.innerHTML = LUCIDITY_LEVELS.map(l => `
    <button class="lucidity-opt${l.value === editDraft.lucidity ? ' selected' : ''}"
            data-value="${l.value}" data-label="${esc(l.name)}">
      <span class="lopt-name">${esc(l.name)}</span>
    </button>
  `).join('');
  lucContainer.querySelectorAll('.lucidity-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      editDraft.lucidity      = Number(btn.dataset.value);
      editDraft.lucidityLabel = btn.dataset.label;
      lucContainer.querySelectorAll('.lucidity-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Wire tag fields
  ['emotions','themes','characters','locations','dreamSigns'].forEach(key => {
    wireEditTagField(`edit-${key.toLowerCase()}`, key, editDraft);
  });

  document.getElementById('edit-back').addEventListener('click', () => renderDetail(body, dream));

  document.getElementById('edit-save').addEventListener('click', async () => {
    const patch = {
      lucidity:      editDraft.lucidity,
      lucidityLabel: editDraft.lucidityLabel,
      emotions:      editDraft.emotions,
      themes:        editDraft.themes,
      characters:    editDraft.characters,
      locations:     editDraft.locations,
      dreamSigns:    editDraft.dreamSigns,
      summary:       document.getElementById('edit-summary').value,
    };
    db.updateDream(dream.id, patch);
    if (dream.notionPageId) {
      try { await api.updateDream(dream.notionPageId, patch); }
      catch { console.warn('Notion update failed — saved locally'); }
    }
    renderDetail(body, { ...dream, ...patch });
  });
}

// Minimal tag field renderer for edit mode
function editTagField(label, id, key, editDraft) {
  return `
    <div class="mt-12">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span class="field-label" style="margin-bottom:0">${label}</span>
        <button id="${id}-add" style="background:none;border:none;color:var(--accent-soft);font-size:22px;cursor:pointer;padding:0;line-height:1;width:28px;height:28px;display:flex;align-items:center;justify-content:center">+</button>
      </div>
      <div class="chips-row" id="${id}">
        ${editDraft[key].map(t => `<span class="chip" data-tag="${esc(t)}" data-key="${key}"><span class="chip-remove">×</span> ${esc(t)}</span>`).join('')}
      </div>
      <div id="${id}-input-wrap" style="display:none;margin-top:8px">
        <input type="text" placeholder="Tag name" id="${id}-input"
               autocomplete="new-password" autocorrect="off" spellcheck="false"
               style="width:100%;background:var(--bg-elevated);border:1px solid var(--border-soft);border-radius:var(--radius-sm);color:var(--text-primary);font-size:16px;outline:none;padding:8px 12px">
      </div>
    </div>
  `;
}

function wireEditTagField(containerId, key, editDraft) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      editDraft[key] = editDraft[key].filter(t => t !== chip.dataset.tag);
      chip.remove();
    });
  });

  const input  = document.getElementById(`${containerId}-input`);
  const wrap   = document.getElementById(`${containerId}-input-wrap`);
  const addBtn = document.getElementById(`${containerId}-add`);
  if (!input || !wrap || !addBtn) return;

  function showInput() { wrap.style.display = 'block'; input.focus(); }
  function hideInput() { wrap.style.display = 'none'; input.value = ''; }

  let _blurTimer = null;

  function commitInput() {
    clearTimeout(_blurTimer);
    const tag = input.value.trim();
    if (tag && !editDraft[key].includes(tag)) {
      editDraft[key].push(tag);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.tag = tag;
      chip.innerHTML = `<span class="chip-remove">×</span> ${esc(tag)}`;
      chip.addEventListener('click', () => { editDraft[key] = editDraft[key].filter(t => t !== tag); chip.remove(); });
      container.appendChild(chip);
    }
    hideInput();
  }

  addBtn.addEventListener('click', () => {
    if (wrap.style.display === 'none') showInput();
    else commitInput();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitInput(); }
    if (e.key === 'Escape') { clearTimeout(_blurTimer); hideInput(); }
  });

  input.addEventListener('blur', () => {
    _blurTimer = setTimeout(commitInput, 150);
  });
}
