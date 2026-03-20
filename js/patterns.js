// js/patterns.js
import { openDrawer } from './app.js';
import { db } from './db.js';

// ── Pure data functions (exported for testing) ────────
export function topTags(dreams, field, n = 5) {
  const counts = {};
  dreams.forEach(d => (d[field] || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([tag, count]) => ({ tag, count }));
}

export function computeStats(dreams) {
  const total = dreams.length;
  if (!total) return { total: 0, currentStreak: 0, bestStreak: 0 };

  // Build set of unique dates (sorted descending)
  const dates = [...new Set(dreams.map(d => d.date))].sort().reverse();
  const today = new Date().toISOString().slice(0, 10);

  let currentStreak = 0;
  let cursor = today;
  for (const date of dates) {
    if (date === cursor) {
      currentStreak++;
      const d = new Date(cursor);
      d.setDate(d.getDate() - 1);
      cursor = d.toISOString().slice(0, 10);
    } else if (date < cursor) break;
  }

  // Best streak (full scan)
  let bestStreak = 0, streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    prev.setDate(prev.getDate() - 1);
    if (dates[i] === prev.toISOString().slice(0, 10)) {
      streak++;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 1;
    }
  }
  bestStreak = Math.max(bestStreak, currentStreak);

  return { total, currentStreak, bestStreak };
}

// ── Screen render ─────────────────────────────────────
let timeFilter = 'all'; // 'all' | '30'

export function render(container) {
  container.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <button class="hamburger" id="pat-menu" aria-label="Menu">
          <span></span><span></span><span></span>
        </button>
        <span class="screen-title">Patterns</span>
        <div style="width:28px"></div>
      </div>
      <div class="screen-body" id="pat-body"></div>
    </div>
  `;

  document.getElementById('pat-menu').addEventListener('click', openDrawer);

  // Load Chart.js from CDN if not already loaded
  if (!window.Chart) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.onload = () => renderPatterns();
    document.head.appendChild(script);
  } else {
    renderPatterns();
  }
}

function renderPatterns() {
  const allDreams = db.getDreams();
  const filtered  = timeFilter === '30' ? db.getRecentDreams(30) : allDreams;
  const stats     = computeStats(allDreams); // streak always uses all data
  const body      = document.getElementById('pat-body');
  if (!body) return;

  body.innerHTML = `
    <!-- Stats row -->
    <div style="display:flex;gap:10px;margin-bottom:16px">
      ${statBox(stats.total,         'Total dreams')}
      ${statBox(stats.currentStreak, 'Current streak', true)}
      ${statBox(stats.bestStreak,    'Best streak')}
    </div>

    <!-- Time filter toggle -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <div class="toggle-pill" id="time-toggle">
        <button class="${timeFilter === 'all' ? 'active' : ''}" data-filter="all">All time</button>
        <button class="${timeFilter === '30'  ? 'active' : ''}" data-filter="30">Last 30 days</button>
      </div>
    </div>

    <!-- Charts -->
    <div style="margin-bottom:16px">
      <span class="field-label">Top dream signs</span>
      <canvas id="chart-signs" height="160"></canvas>
    </div>
    <div>
      <span class="field-label">Top emotions</span>
      <canvas id="chart-emotions" height="160"></canvas>
    </div>
  `;

  document.querySelectorAll('#time-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      timeFilter = btn.dataset.filter;
      renderPatterns();
    });
  });

  renderChart('chart-signs',    topTags(filtered, 'dreamSigns', 5));
  renderChart('chart-emotions', topTags(filtered, 'emotions',   5));
}

function statBox(value, label, green = false) {
  const color = green ? 'var(--success)' : 'var(--accent-soft)';
  return `
    <div style="flex:1;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;text-align:center">
      <div style="font-size:26px;font-weight:700;color:${color};line-height:1">${value}</div>
      <div style="font-size:10px;color:var(--text-ghost);margin-top:4px">${label}</div>
    </div>
  `;
}

function renderChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return;

  // Destroy existing chart instance if re-rendering
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.map(d => d.tag),
      datasets: [{
        data: data.map(d => d.count),
        backgroundColor: 'rgba(124, 58, 237, 0.7)',
        borderColor: '#a78bfa',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', stepSize: 1 }, grid: { color: '#1e2240' } },
        y: { ticks: { color: '#c4c2e8', font: { size: 12 } }, grid: { display: false } },
      },
    },
  });
}
