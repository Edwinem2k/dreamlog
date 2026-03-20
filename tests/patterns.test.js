// tests/patterns.test.js
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// Stub browser globals so app.js and db.js can load in Node
const store = {};
global.localStorage = {
  getItem:    (k) => store[k] ?? null,
  setItem:    (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

function makeEl() {
  const el = {
    innerHTML: '',
    className: '',
    classList: { add: () => {}, remove: () => {} },
    style: {},
    dataset: {},
    appendChild:      () => makeEl(),
    prepend:          () => {},
    remove:           () => {},
    querySelector:    () => makeEl(),  // always return a valid element
    querySelectorAll: () => { const a = []; a.forEach = Array.prototype.forEach.bind(a); return a; },
    addEventListener: () => {},
    setAttribute:     () => {},
  };
  return el;
}

global.document = {
  getElementById:   () => makeEl(),
  querySelector:    () => null,
  querySelectorAll: () => ({ forEach: () => {} }),
  createElement:    () => makeEl(),
  head: makeEl(),
};

// Stub navigator.serviceWorker so app.js boot() doesn't crash
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register: () => Promise.resolve() },
    configurable: true,
    writable: true,
  });
}

const { computeStats, topTags } = await import('../js/patterns.js');

describe('topTags', () => {
  it('counts and sorts tags descending', () => {
    const dreams = [
      { dreamSigns: ['flying', 'teeth'] },
      { dreamSigns: ['flying'] },
      { dreamSigns: ['teeth', 'mirror'] },
    ];
    const result = topTags(dreams, 'dreamSigns', 3);
    assert.deepEqual(result[0], { tag: 'flying', count: 2 });
    assert.deepEqual(result[1].tag, 'teeth');
  });

  it('limits to N results', () => {
    const dreams = [{ dreamSigns: ['a','b','c','d','e','f'] }];
    assert.equal(topTags(dreams, 'dreamSigns', 3).length, 3);
  });
});

describe('computeStats', () => {
  it('counts total dreams', () => {
    const dreams = [{}, {}, {}];
    assert.equal(computeStats(dreams).total, 3);
  });

  it('computes current streak', () => {
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const dreams = [{ date: today }, { date: yesterday }];
    assert.equal(computeStats(dreams).currentStreak, 2);
  });

  it('streak resets if yesterday missing', () => {
    const today = new Date().toISOString().slice(0, 10);
    const old   = '2020-01-01';
    const dreams = [{ date: today }, { date: old }];
    assert.equal(computeStats(dreams).currentStreak, 1);
  });

  it('bestStreak is 1 for a single old dream', () => {
    assert.equal(computeStats([{ date: '2020-01-01' }]).bestStreak, 1);
  });
});
