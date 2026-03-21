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

// ── Lucidity lookup ───────────────────────────────────
const LUCIDITY_LABELS = ['Unaware', 'Glimmer', 'Flicker', 'Witness', 'Pilot', 'Architect'];
function lucidityFromLabel(label) {
  const idx = LUCIDITY_LABELS.indexOf(label);
  return idx >= 0 ? idx : 0;
}

// ── Notion page → app dream mapping ──────────────────
function extractMultiSelect(prop) {
  return prop?.multi_select?.map(o => o.name) ?? [];
}

function extractRichText(blocks) {
  return blocks
    .filter(b => b.type === 'paragraph')
    .flatMap(b => b.paragraph.rich_text.map(r => r.text?.content ?? ''))
    .join(' ')
    .trim();
}

function extractToggleChildren(blocks, toggleTitle) {
  const toggle = blocks.find(
    b => b.type === 'toggle' &&
         b.toggle.rich_text?.[0]?.text?.content === toggleTitle
  );
  if (!toggle?.children) return '';
  return toggle.children
    .filter(b => b.type === 'paragraph')
    .flatMap(b => b.paragraph.rich_text.map(r => r.text?.content ?? ''))
    .join(' ')
    .trim();
}

function extractCallout(blocks) {
  const callout = blocks.find(b => b.type === 'callout');
  return callout?.callout?.rich_text?.map(r => r.text?.content ?? '').join('') ?? '';
}

function notionPageToAppDream(page, blocks) {
  const props = page.properties;
  return {
    id:            crypto.randomUUID(),
    notionPageId:  page.id,
    date:          props.Date?.date?.start ?? '',
    lucidityLabel: props.Lucidity?.select?.name ?? '',
    lucidity:      lucidityFromLabel(props.Lucidity?.select?.name ?? ''),
    emotions:      extractMultiSelect(props.Emotions),
    themes:        extractMultiSelect(props.Themes),
    characters:    extractMultiSelect(props.Characters),
    locations:     extractMultiSelect(props.Locations),
    dreamSigns:    extractMultiSelect(props['Dream Signs']),
    cleanedTranscript: extractRichText(blocks),
    rawTranscript:     extractToggleChildren(blocks, 'Raw recording'),
    summary:           extractCallout(blocks),
  };
}

// ── Route handlers ────────────────────────────────────

async function handleAnalyse(request, env) {
  let transcript;
  try {
    ({ transcript } = await request.json());
  } catch {
    return jsonError('invalid JSON body', 400);
  }
  if (!transcript) return jsonError('transcript required', 400);

  // Pass 1: clean transcript
  const cleanRes = await callClaude(env.ANTHROPIC_API_KEY, CLEAN_PROMPT, transcript, 4096);
  if (!cleanRes.ok) return jsonError('Claude clean pass failed', 502);
  const cleanData = await cleanRes.json();
  const cleanedTranscript = cleanData.content?.[0]?.text?.trim();
  if (!cleanedTranscript) return jsonError('Claude clean pass returned empty content', 502);

  // Pass 2: analyse cleaned transcript
  const analyseRes = await callClaude(env.ANTHROPIC_API_KEY, ANALYSE_PROMPT, cleanedTranscript);
  if (!analyseRes.ok) return jsonError('Claude analyse pass failed', 502);
  const analyseData = await analyseRes.json();
  const analysisText = analyseData.content?.[0]?.text?.trim();
  if (!analysisText) return jsonError('Claude analyse pass returned empty content', 502);

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
  let dream;
  try {
    dream = await request.json();
  } catch {
    return jsonError('invalid JSON body', 400);
  }
  if (!dream) return jsonError('dream required', 400);
  if (!dream.date) return jsonError('dream.date required', 400);
  // Default array fields to empty arrays if missing
  dream.emotions    = dream.emotions    ?? [];
  dream.themes      = dream.themes      ?? [];
  dream.characters  = dream.characters  ?? [];
  dream.locations   = dream.locations   ?? [];
  dream.dreamSigns  = dream.dreamSigns  ?? [];

  const notionRes = await createNotionPage(env.NOTION_API_KEY, env.NOTION_DATABASE_ID, dream);
  if (!notionRes.ok) {
    const err = await notionRes.text();
    return jsonError(`Notion error: ${err}`, 502);
  }
  const page = await notionRes.json();
  return jsonOk({ notionPageId: page.id });
}

async function handleGetDreams(env) {
  try {
    const pages = await fetchAllNotionPages(env.NOTION_API_KEY, env.NOTION_DATABASE_ID);
    return jsonOk({ results: pages });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}

async function handleSync(request, env) {
  let knownIds;
  try {
    ({ knownIds } = await request.json());
  } catch {
    return jsonError('invalid JSON body', 400);
  }
  if (!Array.isArray(knownIds)) return jsonError('knownIds must be an array', 400);

  let allPages;
  try {
    allPages = await fetchAllNotionPages(env.NOTION_API_KEY, env.NOTION_DATABASE_ID);
  } catch (err) {
    return jsonError(`Notion query failed: ${err.message}`, 502);
  }

  const notionIds = new Set(allPages.map(p => p.id));
  const knownSet  = new Set(knownIds);

  const pagesToImport = allPages.filter(p => !knownSet.has(p.id));
  const toDelete      = knownIds.filter(id => !notionIds.has(id));

  // Fetch blocks in batches of 10. Note: nested toggle child fetches inside
  // fetchPageBlocks mean total subrequests can exceed 10 per batch on pages with
  // toggle blocks. Free plan limit is 50; paid plan is 1000. For large initial
  // imports the client calls /sync in a loop until toImport is empty.
  const toImport = [];
  for (let i = 0; i < pagesToImport.length; i += 10) {
    const batch = pagesToImport.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(async page => {
        const blocks = await fetchPageBlocks(env.NOTION_API_KEY, page.id);
        return notionPageToAppDream(page, blocks);
      })
    );
    toImport.push(...results);
  }

  return jsonOk({ toImport, toDelete });
}

async function handleUpdateDream(request, env) {
  let notionPageId, patch;
  try {
    ({ notionPageId, patch } = await request.json());
  } catch {
    return jsonError('invalid JSON body', 400);
  }
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
        case '/analyse':
          if (request.method !== 'POST') { response = jsonError('Method not allowed', 405); break; }
          response = await handleAnalyse(request, env); break;
        case '/save':
          if (request.method !== 'POST') { response = jsonError('Method not allowed', 405); break; }
          response = await handleSave(request, env); break;
        case '/dreams':
          if (request.method !== 'POST') {
            response = jsonError('Method not allowed', 405);
            break;
          }
          response = await handleGetDreams(env);
          break;
        case '/update':
          if (request.method !== 'POST') { response = jsonError('Method not allowed', 405); break; }
          response = await handleUpdateDream(request, env); break;
        case '/sync':
          if (request.method !== 'POST') { response = jsonError('Method not allowed', 405); break; }
          response = await handleSync(request, env); break;
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
function callClaude(apiKey, systemPrompt, userText, maxTokens = 1024) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    }),
  });
}

// ── Notion helpers ────────────────────────────────────
async function fetchAllNotionPages(apiKey, databaseId) {
  const pages = [];
  let cursor;
  do {
    const body = { sorts: [{ property: 'Date', direction: 'descending' }] };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: notionHeaders(apiKey),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function fetchPageBlocks(apiKey, pageId) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    headers: notionHeaders(apiKey),
  });
  if (!res.ok) return [];  // graceful degradation — caller imports with empty content
  const data = await res.json();
  // Fetch toggle children inline (needed for "Raw recording" toggle).
  // NOTE: Only fetches first page of toggle children (Notion limit: 100 blocks per request).
  // A very long rawTranscript split into more than 100 blocks would be silently truncated.
  // This is acceptable for v1 — 100 × 1999 chars ≈ 200k chars, far exceeding typical dreams.
  const blocks = await Promise.all(data.results.map(async block => {
    if (block.type === 'toggle' && block.has_children) {
      const childRes = await fetch(`https://api.notion.com/v1/blocks/${block.id}/children`, {
        headers: notionHeaders(apiKey),
      });
      if (childRes.ok) {
        const childData = await childRes.json();
        return { ...block, children: childData.results };
      }
    }
    return block;
  }));
  return blocks;
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
