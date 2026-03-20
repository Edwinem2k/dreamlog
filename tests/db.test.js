// tests/db.test.js
import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

// Mock localStorage for Node.js environment
const store = {};
global.localStorage = {
  getItem:    (k) => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

// Import after mock is set up
const { db } = await import('../js/db.js');

describe('db.getSettings / db.saveSettings', () => {
  beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

  it('returns defaults when nothing stored', () => {
    const s = db.getSettings();
    assert.equal(s.workerUrl, '');
    assert.equal(s.vapidPublicKey, '');
  });

  it('round-trips settings', () => {
    db.saveSettings({ workerUrl: 'https://worker.example.com', vapidPublicKey: 'abc123' });
    const s = db.getSettings();
    assert.equal(s.workerUrl, 'https://worker.example.com');
    assert.equal(s.vapidPublicKey, 'abc123');
  });
});

describe('db.saveDream / db.getDreams', () => {
  beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

  it('returns empty array when no dreams stored', () => {
    assert.deepEqual(db.getDreams(), []);
  });

  it('saves a dream and retrieves it', () => {
    const dream = {
      id: '1', date: '2026-03-19', rawTranscript: 'raw', cleanedTranscript: 'clean',
      lucidity: 1, emotions: ['wonder'], themes: [], characters: [],
      locations: [], dreamSigns: ['flying'], summary: 'A dream.', notionPageId: null,
    };
    db.saveDream(dream);
    const dreams = db.getDreams();
    assert.equal(dreams.length, 1);
    assert.equal(dreams[0].id, '1');
    assert.equal(dreams[0].cleanedTranscript, 'clean');
  });

  it('prepends new dreams (newest first)', () => {
    db.saveDream({ id: '1', date: '2026-03-18' });
    db.saveDream({ id: '2', date: '2026-03-19' });
    assert.equal(db.getDreams()[0].id, '2');
  });
});

describe('db.updateDream', () => {
  beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

  it('updates matching dream by id', () => {
    db.saveDream({ id: '1', lucidity: 0, dreamSigns: [] });
    db.updateDream('1', { lucidity: 4, dreamSigns: ['flying'] });
    const dream = db.getDreams().find(d => d.id === '1');
    assert.equal(dream.lucidity, 4);
    assert.deepEqual(dream.dreamSigns, ['flying']);
  });
});

describe('db.addToTagHistory / db.getTagHistory', () => {
  beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

  it('returns empty arrays when nothing stored', () => {
    const h = db.getTagHistory();
    assert.deepEqual(h.emotions, []);
    assert.deepEqual(h.dreamSigns, []);
  });

  it('deduplicates tags', () => {
    db.addToTagHistory('emotions', ['wonder', 'anxiety']);
    db.addToTagHistory('emotions', ['wonder', 'fear']);
    const h = db.getTagHistory();
    assert.equal(h.emotions.filter(t => t === 'wonder').length, 1);
    assert.equal(h.emotions.length, 3);
  });
});

describe('db.getRecentDreams', () => {
  beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

  it('returns last N days of dreams', () => {
    const today = new Date().toISOString().slice(0, 10);
    const old   = '2020-01-01';
    db.saveDream({ id: '1', date: old });
    db.saveDream({ id: '2', date: today });
    const recent = db.getRecentDreams(30);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].id, '2');
  });
});
