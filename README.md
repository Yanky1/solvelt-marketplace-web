# Solvelt marketplace website

The buyer website of the Solvelt marketplace. React + TypeScript, React Router v7 in framework mode with SSR (Node server), Solvelt Figma styling (light and dark).

- Backend: [solvelt-marketplace-api](https://github.com/Yanky1/solvelt-marketplace-api) (endpoints in its `docs/API.md`).
- Standing rules for Claude sessions: [CLAUDE.md](CLAUDE.md). Design decisions: [docs/DESIGN.md](docs/DESIGN.md).

## Run

```bash
npm ci
cp .env.example .env      # optional in development; defaults are used
npm run dev               # http://localhost:5173
npm run build && npm start   # production SSR server on :3000
```

## Configuration (environment)

| Variable | Required in production | Meaning |
|---|---|---|
| `API_BASE_URL` | yes | Marketplace API base URL |
| `SESSION_COOKIE_SECRET` | yes (>= 32 chars) | Signs session cookie and CSRF tokens |
| `WEB_FORWARDING_KEY` | yes (>= 32 chars) | Same secret as the API's `Web__ForwardingKey`; signs the forwarded client IP. Must differ from `SESSION_COOKIE_SECRET` |
| `PUBLIC_ORIGIN` | yes (https) | Public origin: canonical URLs, sitemap, Origin checks |
| `TRUSTED_PROXIES` | no | Comma-separated IPs or CIDRs (IPv4 or IPv6) of your reverse proxies; `X-Forwarded-For` is trusted only from these. Invalid entries stop start-up. Keep server clocks in NTP sync (the API accepts the signed timestamp for a short window) |
| `PORT` | no | Server port (default 3000) |

The server refuses to start in production when a required value is missing or invalid (the error never prints secret values).

## Sessions and auth

The browser only holds a sealed `HttpOnly` cookie; the API token stays on this server (BFF). Every action checks Origin plus a per-session CSRF token. See `docs/DESIGN.md` (W1-21..30), including the API auth contract this site currently assumes.

## Test

```bash
npm run lint && npm run typecheck && npm test      # lint, types, Vitest + Testing Library
npm run build && npm run e2e                        # Playwright against the built server + mock API, axe in light/dark
```

If your machine's Chromium does not match Playwright's expected build, set `PW_CHROMIUM_PATH` to a Chromium binary (CI installs its own).

## Screenshots

`npm run build && npm run screenshots` regenerates `docs/screenshots/` (desktop and mobile, light and dark).
