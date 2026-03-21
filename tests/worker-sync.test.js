// tests/worker-sync.test.js
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// ── Helpers under test (pure functions, copied from worker/index.js) ──────────
// These are defined here for testability since the worker runtime cannot be
// imported in Node. Keep in sync with worker/index.js.

const LUCIDITY_LABELS = ['Unaware', 'Glimmer', 'Flicker', 'Witness', 'Pilot', 'Architect'];
function lucidityFromLabel(label) {
  const idx = LUCIDITY_LABELS.indexOf(label);
  return idx >= 0 ? idx : 0;
}

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
    id: crypto.randomUUID(),
    notionPageId: page.id,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('lucidityFromLabel', () => {
  it('returns correct index for known labels', () => {
    assert.equal(lucidityFromLabel('Unaware'),   0);
    assert.equal(lucidityFromLabel('Glimmer'),   1);
    assert.equal(lucidityFromLabel('Architect'), 5);
  });

  it('returns 0 for unknown or missing label', () => {
    assert.equal(lucidityFromLabel(''),        0);
    assert.equal(lucidityFromLabel(undefined), 0);
    assert.equal(lucidityFromLabel('Unknown'), 0);
  });
});

describe('extractRichText', () => {
  it('concatenates paragraph blocks with a space', () => {
    const blocks = [
      { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Hello' } }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'world' } }] } },
    ];
    assert.equal(extractRichText(blocks), 'Hello world');
  });

  it('ignores non-paragraph blocks', () => {
    const blocks = [
      { type: 'callout', callout: { rich_text: [{ text: { content: 'ignored' } }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'kept' } }] } },
    ];
    assert.equal(extractRichText(blocks), 'kept');
  });

  it('returns empty string when no paragraphs', () => {
    assert.equal(extractRichText([]), '');
  });
});

describe('extractToggleChildren', () => {
  it('extracts children of the named toggle block', () => {
    const blocks = [
      {
        type: 'toggle',
        toggle: { rich_text: [{ text: { content: 'Raw recording' } }] },
        children: [
          { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'raw text' } }] } },
        ],
      },
    ];
    assert.equal(extractToggleChildren(blocks, 'Raw recording'), 'raw text');
  });

  it('returns empty string if toggle not found', () => {
    assert.equal(extractToggleChildren([], 'Raw recording'), '');
  });
});

describe('extractCallout', () => {
  it('returns callout rich text content', () => {
    const blocks = [
      { type: 'callout', callout: { rich_text: [{ text: { content: 'A dream summary.' } }] } },
    ];
    assert.equal(extractCallout(blocks), 'A dream summary.');
  });

  it('returns empty string when no callout block', () => {
    assert.equal(extractCallout([]), '');
  });
});

describe('notionPageToAppDream', () => {
  it('maps all fields from a full Notion page', () => {
    const page = {
      id: 'notion-page-123',
      properties: {
        Date:           { date: { start: '2024-01-15' } },
        Lucidity:       { select: { name: 'Pilot' } },
        Emotions:       { multi_select: [{ name: 'joy' }] },
        Themes:         { multi_select: [{ name: 'flying' }] },
        Characters:     { multi_select: [] },
        Locations:      { multi_select: [{ name: 'forest' }] },
        'Dream Signs':  { multi_select: [{ name: 'mirror' }] },
      },
    };
    const blocks = [
      { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'cleaned text' } }] } },
      {
        type: 'toggle',
        toggle: { rich_text: [{ text: { content: 'Raw recording' } }] },
        children: [
          { type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'raw text' } }] } },
        ],
      },
      { type: 'callout', callout: { rich_text: [{ text: { content: 'summary here' } }] } },
    ];
    const dream = notionPageToAppDream(page, blocks);

    assert.equal(dream.notionPageId,       'notion-page-123');
    assert.equal(dream.date,               '2024-01-15');
    assert.equal(dream.lucidity,           4);
    assert.equal(dream.lucidityLabel,      'Pilot');
    assert.deepEqual(dream.emotions,       ['joy']);
    assert.deepEqual(dream.themes,         ['flying']);
    assert.deepEqual(dream.characters,     []);
    assert.deepEqual(dream.locations,      ['forest']);
    assert.deepEqual(dream.dreamSigns,     ['mirror']);
    assert.equal(dream.cleanedTranscript,  'cleaned text');
    assert.equal(dream.rawTranscript,      'raw text');
    assert.equal(dream.summary,            'summary here');
    assert.ok(dream.id, 'id should be generated');
    assert.notEqual(dream.id, dream.notionPageId);
  });

  it('defaults missing fields gracefully', () => {
    const page = { id: 'x', properties: {} };
    const dream = notionPageToAppDream(page, []);
    assert.equal(dream.date,              '');
    assert.equal(dream.lucidity,          0);
    assert.equal(dream.lucidityLabel,     '');
    assert.deepEqual(dream.emotions,      []);
    assert.deepEqual(dream.themes,        []);
    assert.deepEqual(dream.characters,    []);
    assert.deepEqual(dream.locations,     []);
    assert.deepEqual(dream.dreamSigns,    []);
    assert.equal(dream.cleanedTranscript, '');
    assert.equal(dream.rawTranscript,     '');
    assert.equal(dream.summary,           '');
  });
});
