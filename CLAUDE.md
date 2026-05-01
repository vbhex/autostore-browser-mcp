# autostore-browser-mcp

> ## 🧠 Knowledge Distillation Strategy
>
> AutoStore's architectural bet: encode every workflow as a deterministic macro tool so weak models (qwen-plus, glm-4-flash) only need intent matching — multi-step reasoning is pre-computed by Claude offline.
>
> Before ending any session, read:
> - `rules/KNOWLEDGE_DISTILLATION_STRATEGY.md` — the master plan + macro roadmap
> - `rules/CONTRIBUTING_PLATFORM_KNOWLEDGE.md` — where each kind of knowledge belongs
> - `rules/COMPUTER_USE_STRATEGY.md` — annotated screenshots + macro-tool rationale
>
> **Rule:** if you spent 3+ tool calls on a workflow that could be one macro, encode it in `mac/AutoStore/Sources/Services/PlatformKnowledge.swift` + register the tool in `LocalLLMService.swift` before committing. Push so the next AutoStore release ships with that knowledge.


**MCP stdio server that hands an LLM a real Chromium browser.** Built for
AutoStore listing jobs — the LLM drives Seller Central / Seller Hub / Etsy the
same way a human does, using cookies persisted per-store.

## Why this exists

The Node pipeline projects (`amazon/`, `ebay/`, `etsy/`) upload via
CSV/flat-file/API. Those paths break whenever Amazon/eBay tweak a column or a
category gets a new required attribute. An LLM with a browser can adapt in real
time: look at the page, read the error, click the right thing.

This server is the browser. The LLM (Claude Code, the AutoStore Mac app agent,
Cursor, …) is the driver.

## Architecture

```
┌─────────────────┐   MCP stdio    ┌────────────────────────┐   Playwright
│  LLM / Mac app  │ ─────────────▶ │ autostore-browser-mcp  │ ───────────▶ Chromium
└─────────────────┘                └────────────────────────┘
                                    persistent contexts in
                                    ~/.autostore-browser-mcp/profiles/<name>
```

Each "profile" is a named persistent Chromium context. Cookies, localStorage,
and service-worker state all live on disk under that profile, so logging into
Amazon Seller Central once means every subsequent listing job is already
authenticated.

Conventional profile names used by AutoStore:

- `amazon` — Seller Central (ATVPDKIKX0DER in our case)
- `ebay` — Seller Hub
- `etsy` — Shop Manager
- ad-hoc names are fine — any string works

## Tools exposed

| Tool | Purpose |
|------|---------|
| `open_tab` | Open a new tab on a profile, optionally to a URL |
| `navigate` | Point an existing tab at a URL |
| `list_tabs` / `close_tab` / `close_profile` | Tab + lifecycle management |
| `click` / `fill` / `select_option` / `press_key` | Input interactions |
| `upload_file` | Attach a file to `<input type=file>` |
| `wait_for` | Wait for a selector to hit visible/hidden/attached/detached |
| `get_text` / `get_attribute` / `current_url` | Read from the page |
| `eval` | Run a JS expression in the page, get JSON back |
| `snapshot` | ARIA accessibility snapshot — **use this first** when landing on a new page |
| `screenshot` | PNG base64 — expensive, use sparingly |

Every tool takes a `profile` (which cookie jar) and an optional `tab` id.
Omit `tab` to target the most-recently-opened tab on that profile.

## Usage

```bash
npm install
npm run install-browser      # downloads Chromium (~150MB), one time
npm run build
node dist/index.js           # starts MCP over stdio — does nothing on its own
```

### Claude Code / Cursor

Add to your MCP client config (e.g. `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "autostore-browser": {
      "command": "node",
      "args": ["/Users/jameswalstonn/Documents/autostore/browser-mcp/dist/index.js"]
    }
  }
}
```

### AutoStore Mac app

The Mac app spawns this server as a child process during agent startup and
connects via the MCP client in `mac/AutoStore/Sources/Services/`. See
`mac/CLAUDE.md` for the integration contract once wired.

## Environment

| Var | Default | Effect |
|-----|---------|--------|
| `AUTOSTORE_BROWSER_HEADLESS` | `false` | Set `true` for headless runs. Default is headed so humans can watch/intervene. |
| `AUTOSTORE_BROWSER_DATA_DIR` | `~/.autostore-browser-mcp/profiles` | Where per-profile persistent contexts live. |

## Rules

1. **Never commit `.browser-data/`** — it holds session cookies. Already in `.gitignore`.
2. **One profile per store**, not per platform. If you ever run two Amazon
   stores, use `amazon-a` and `amazon-b` to keep cookie jars separate — the
   "one store per platform" rule in the root CLAUDE.md still applies at the
   listing-mapping layer.
3. **Prefer `snapshot` over `screenshot`** when the LLM is trying to reason about
   the page. An ARIA tree fits in a single LLM turn; a full-page PNG doesn't.
4. **The server never retries.** The LLM retries. That's the whole point — an
   LLM can look at an error and decide to re-click, whereas a hardcoded retry
   loop just repeats the same failure.
5. **Amazon manual-confirmation rule carries over.** The root CLAUDE.md requires
   per-product user approval before any Amazon listing submit. Whatever agent
   drives this MCP must enforce that gate — the MCP itself doesn't know or care
   which clicks are "submit" vs "save draft".

## File layout

```
browser-mcp/
  src/
    index.ts     — MCP stdio entry
    browser.ts   — Playwright persistent-context lifecycle
    tools.ts     — all tool definitions (zod schemas + handlers)
  dist/          — compiled output (gitignored)
  CLAUDE.md
  package.json
  tsconfig.json
```
