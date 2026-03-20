// worker/index.js
// Cloudflare Worker — proxies requests from the Dreamlog PWA to
// Anthropic and Notion APIs, handling CORS and credential injection.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── System prompts ────────────────────────────────────
const CLEAN_PROMPT = `You are a dream journal transcription editor. The following is a voice-recorded dream transcript with natural speech patterns, false starts, and corrections. Produce a clean, readable version that corrects speech errors and removes hesitations, but does NOT summarise, shorten, or add any detail not present in the original. Preserve first-person voice and dream sequence order. Return only the cleaned transcript text — no commentary.`;

const ANALYSE_PROMPT = `You are a lucid dreaming analyst. Analyse the following dream transcript and return ONLY a valid JSON object with exactly these fields:
- "emotions": array of strings
- "themes": array of strings
- "characters": array of strings
- "locations": array of strings
- "dream_signs": array of strings (recurring elements that could serve as reality check triggers)
- "summary": string (2-3 sentences, plain language, first person)

Return raw JSON only — no markdown code blocks, no commentary.`;

// ── Route handlers ────────────────────────────────────

async function handleAnalyse(request, env) {
  const { transcript } = await request.json();
  if (!transcript) return jsonError('transcript required', 400);

  // Pass 1: clean transcript
  const cleanRes = await callClaude(env.ANTHROPIC_API_KEY, CLEAN_PROMPT, transcript);
  if (!cleanRes.ok) return jsonError('Claude clean pass failed', 502);
  const cleanedTranscript = (await cleanRes.json()).content[0].text.trim();

  // Pass 2: analyse cleaned transcript
  const analyseRes = await callClaude(env.ANTHROPIC_API_KEY, ANALYSE_PROMPT, cleanedTranscript);
  if (!analyseRes.ok) return jsonError('Claude analyse pass failed', 502);
  const analysisText = (await analyseRes.json()).content[0].text.trim();

  let analysis;
  try {
    analysis = JSON.parse(analysisText);
  } catch {
    // Return cleaned transcript with empty analysis — client handles gracefully
    analysis = { emotions: [], themes: [], characters: [], locations: [], dream_signs: [], summary: '' };
  }

  return jsonOk({ cleanedTranscript, analysis });
}

async function handleSave(request, env) {
  const dream = await request.json();
  if (!dream) return jsonError('dream required', 400);

  const notionRes = await createNotionPage(env.NOTION_API_KEY, env.NOTION_DATABASE_ID, dream);
  if (!notionRes.ok) {
    const err = await notionRes.text();
    return jsonError(`Notion error: ${err}`, 502);
  }
  const page = await notionRes.json();
  return jsonOk({ notionPageId: page.id });
}

async function handleGetDreams(env) {
  const notionRes = await queryNotionDatabase(env.NOTION_API_KEY, env.NOTION_DATABASE_ID);
  if (!notionRes.ok) return jsonError('Notion query failed', 502);
  const data = await notionRes.json();
  return jsonOk({ results: data.results });
}

async function handleUpdateDream(request, env) {
  const { notionPageId, patch } = await request.json();
  if (!notionPageId) return jsonError('notionPageId required', 400);

  const notionRes = await updateNotionPage(env.NOTION_API_KEY, notionPageId, patch);
  if (!notionRes.ok) return jsonError('Notion update failed', 502);
  return jsonOk({ ok: true });
}

async function handlePing() {
  return jsonOk({ ok: true, service: 'dreamlog-worker' });
}

// ── Main fetch handler ────────────────────────────────
export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      let response;
      switch (path) {
        case '/analyse': response = await handleAnalyse(request, env); break;
        case '/save':    response = await handleSave(request, env);    break;
        case '/dreams':
          if (request.method !== 'POST') {
            response = jsonError('Method not allowed', 405);
            break;
          }
          response = await handleGetDreams(env);
          break;
        case '/update':  response = await handleUpdateDream(request, env); break;
        case '/ping':    response = await handlePing();                 break;
        default: response = jsonError('Not found', 404);
      }
      // Attach CORS headers to every response
      Object.entries(CORS_HEADERS).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    } catch (err) {
      const errResponse = jsonError(`Internal error: ${err.message}`, 500);
      Object.entries(CORS_HEADERS).forEach(([k, v]) => errResponse.headers.set(k, v));
      return errResponse;
    }
  },
};

// ── Anthropic helper ──────────────────────────────────
function callClaude(apiKey, systemPrompt, userText) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    }),
  });
}

// ── Notion helpers ────────────────────────────────────
function queryNotionDatabase(apiKey, databaseId) {
  return fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: notionHeaders(apiKey),
    body: JSON.stringify({ sorts: [{ property: 'Date', direction: 'descending' }] }),
  });
}

function createNotionPage(apiKey, databaseId, dream) {
  const titleText = `${dream.date} — ${dream.summary?.split(' ').slice(0, 5).join(' ')}...`;
  return fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(apiKey),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Name:        { title: [{ text: { content: titleText } }] },
        Date:        { date: { start: dream.date } },
        Lucidity:    { select: { name: dream.lucidityLabel } },
        Emotions:    { multi_select: dream.emotions.map(n => ({ name: n })) },
        Themes:      { multi_select: dream.themes.map(n => ({ name: n })) },
        Characters:  { multi_select: dream.characters.map(n => ({ name: n })) },
        Locations:   { multi_select: dream.locations.map(n => ({ name: n })) },
        'Dream Signs': { multi_select: dream.dreamSigns.map(n => ({ name: n })) },
      },
      children: notionPageBody(dream),
    }),
  });
}

function updateNotionPage(apiKey, pageId, patch) {
  const properties = {};
  if (patch.lucidityLabel) properties.Lucidity = { select: { name: patch.lucidityLabel } };
  if (patch.emotions)   properties.Emotions   = { multi_select: patch.emotions.map(n => ({ name: n })) };
  if (patch.themes)     properties.Themes     = { multi_select: patch.themes.map(n => ({ name: n })) };
  if (patch.characters) properties.Characters = { multi_select: patch.characters.map(n => ({ name: n })) };
  if (patch.locations)  properties.Locations  = { multi_select: patch.locations.map(n => ({ name: n })) };
  if (patch.dreamSigns) properties['Dream Signs'] = { multi_select: patch.dreamSigns.map(n => ({ name: n })) };

  return fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(apiKey),
    body: JSON.stringify({ properties }),
  });
}

function notionHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
}

// Notion paragraph rich_text items have a 2000-char limit.
// Split long strings into chunks so the API doesn't return a 400.
function splitText(str, max = 1999) {
  const chunks = [];
  for (let i = 0; i < str.length; i += max) chunks.push(str.slice(i, i + max));
  return chunks.length ? chunks : [''];
}

function textBlocks(content) {
  return splitText(content || '').map(chunk => ({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ text: { content: chunk } }] },
  }));
}

function notionPageBody(dream) {
  return [
    ...textBlocks(dream.cleanedTranscript),
    { object: 'block', type: 'toggle', toggle: {
      rich_text: [{ text: { content: 'Raw recording' } }],
      children: textBlocks(dream.rawTranscript),
    }},
    { object: 'block', type: 'callout', callout: {
      icon: { type: 'emoji', emoji: '🔮' },
      rich_text: [{ text: { content: (dream.summary || '').slice(0, 1999) } }],
    }},
  ];
}

// ── Response helpers ──────────────────────────────────
function jsonOk(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
