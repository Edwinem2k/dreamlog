// tests/api.test.js
import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, mock } from 'node:test';

// Mock localStorage
const store = {};
global.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
};

// Mock fetch
let mockFetchResponse = null;
global.fetch = async () => mockFetchResponse;

const { api } = await import('../js/api.js');
const { db }  = await import('../js/db.js');

beforeEach(() => {
  mockFetchResponse = null;
  global.fetch = async () => mockFetchResponse;
  db.saveSettings({ workerUrl: 'https://worker.example.com' });
});

describe('api.testConnection', () => {
  it('returns true when worker responds ok', async () => {
    mockFetchResponse = { ok: true, json: async () => ({ ok: true }) };
    const result = await api.testConnection();
    assert.equal(result, true);
  });

  it('returns false when fetch fails', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = async () => { throw new Error('Network error'); };
      const result = await api.testConnection();
      assert.equal(result, false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('api.analyseTranscript', () => {
  it('returns cleanedTranscript and analysis on success', async () => {
    mockFetchResponse = {
      ok: true,
      json: async () => ({
        cleanedTranscript: 'clean text',
        analysis: { emotions: ['wonder'], themes: [], characters: [], locations: [], dream_signs: [], summary: 'A dream.' },
      }),
    };
    const result = await api.analyseTranscript('raw text');
    assert.equal(result.cleanedTranscript, 'clean text');
    assert.deepEqual(result.analysis.emotions, ['wonder']);
  });
});

describe('api.saveDream', () => {
  it('returns notionPageId on success', async () => {
    mockFetchResponse = { ok: true, json: async () => ({ notionPageId: 'abc123' }) };
    const result = await api.saveDream({ rawTranscript: 'raw', cleanedTranscript: 'clean' });
    assert.equal(result.notionPageId, 'abc123');
  });

  it('throws when worker returns non-ok', async () => {
    mockFetchResponse = { ok: false, status: 500 };
    await assert.rejects(() => api.saveDream({}), /Worker error 500/);
  });
});

describe('api.getDreams', () => {
  it('returns results array on success', async () => {
    mockFetchResponse = { ok: true, json: async () => ({ results: [{ id: '1' }] }) };
    const result = await api.getDreams();
    assert.equal(result.results.length, 1);
  });

  it('throws when worker returns non-ok', async () => {
    mockFetchResponse = { ok: false, status: 503 };
    await assert.rejects(() => api.getDreams(), /Worker error 503/);
  });
});

describe('api.updateDream', () => {
  it('resolves without error on success', async () => {
    mockFetchResponse = { ok: true, json: async () => ({}) };
    await assert.doesNotReject(() => api.updateDream('page-id', { lucidity: 3 }));
  });

  it('throws when worker returns non-ok', async () => {
    mockFetchResponse = { ok: false, status: 400 };
    await assert.rejects(() => api.updateDream('page-id', {}), /Worker error 400/);
  });
});
