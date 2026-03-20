// js/api.js
// All network calls to the Cloudflare Worker.
// This is the only file that constructs Worker URLs.
import { db } from './db.js';

async function post(path, body) {
  const { workerUrl } = db.getSettings();
  const res = await fetch(`${workerUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

async function get(path) {
  const { workerUrl } = db.getSettings();
  return fetch(`${workerUrl}${path}`);
}

export const api = {
  async testConnection() {
    try {
      const res = await get('/ping');
      return res.ok;
    } catch { return false; }
  },

  async analyseTranscript(rawTranscript) {
    const res = await post('/analyse', { transcript: rawTranscript });
    if (!res.ok) throw new Error(`Worker error ${res.status}`);
    return res.json(); // { cleanedTranscript, analysis }
  },

  async saveDream(dream) {
    const res = await post('/save', dream);
    if (!res.ok) throw new Error(`Worker error ${res.status}`);
    return res.json(); // { notionPageId }
  },

  async getDreams() {
    const res = await get('/dreams');
    if (!res.ok) throw new Error(`Worker error ${res.status}`);
    return res.json(); // { results: [...] }
  },

  async updateDream(notionPageId, patch) {
    const res = await post('/update', { notionPageId, patch });
    if (!res.ok) throw new Error(`Worker error ${res.status}`);
    return res.json();
  },
};
