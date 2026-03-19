# Dreamlog

A personal PWA dream journal for lucid dreamers.

## Setup
See `docs/superpowers/specs/2026-03-19-dreamlog-design.md` for full architecture.

### Requirements
- Node.js 18+
- Cloudflare account (free)
- Notion account + integration token
- Anthropic API key

### Quick start
1. Deploy Cloudflare Worker: `cd worker && npx wrangler deploy`
2. Set Worker env vars in Cloudflare dashboard (see spec §4)
3. Open `index.html` on a local HTTPS server or push to GitHub Pages
4. On iPhone: Safari → Share → Add to Home Screen
