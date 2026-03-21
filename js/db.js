// js/db.js

const KEYS = {
  DREAMS:      'dl_dreams',
  SETTINGS:    'dl_settings',
  TAG_HISTORY: 'dl_tagHistory',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const db = {
  // ── Settings ───────────────────────────────────────
  getSettings() {
    return read(KEYS.SETTINGS, { workerUrl: '', vapidPublicKey: '' });
  },
  saveSettings(patch) {
    const current = this.getSettings();
    write(KEYS.SETTINGS, { ...current, ...patch });
  },

  // ── Dreams ─────────────────────────────────────────
  getDreams() {
    return read(KEYS.DREAMS, []);
  },
  saveDream(dream) {
    const dreams = this.getDreams();
    write(KEYS.DREAMS, [dream, ...dreams]);
  },
  updateDream(id, patch) {
    const dreams = this.getDreams().map(d => d.id === id ? { ...d, ...patch } : d);
    write(KEYS.DREAMS, dreams);
  },
  deleteDream(notionPageId) {
    const dreams = this.getDreams();
    const filtered = dreams.filter(d => d.notionPageId !== notionPageId);
    if (filtered.length !== dreams.length) write(KEYS.DREAMS, filtered);
  },
  importDreams(newDreams) {
    if (!newDreams.length) return;
    const existing = this.getDreams();
    write(KEYS.DREAMS, [...newDreams, ...existing]);
  },
  getRecentDreams(days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return this.getDreams().filter(d => d.date >= cutoffStr);
  },

  // ── Tag history ────────────────────────────────────
  getTagHistory() {
    return read(KEYS.TAG_HISTORY, {
      emotions: [], themes: [], characters: [], locations: [], dreamSigns: [],
    });
  },
  addToTagHistory(field, tags) {
    const history = this.getTagHistory();
    const existing = new Set(history[field] || []);
    tags.forEach(t => existing.add(t));
    write(KEYS.TAG_HISTORY, { ...history, [field]: Array.from(existing) });
  },
};
