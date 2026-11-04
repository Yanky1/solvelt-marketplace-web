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
| `PUBLIC_ORIGIN` | yes (https) | Public origin: canonical URLs, sitemap, Origin checks |
| `TRUSTED_PROXIES` | no | Comma-separated IPs/IPv4 CIDRs of your reverse proxies; `X-Forwarded-For` is trusted only from these |
| `PORT` | no | Server port (default 3000) |

The server refuses to start in production when a required value is missing or invalid (the error never prints secret values).

## Test

```bash
npm run lint && npm run typecheck && npm test      # lint, types, Vitest + Testing Library
npm run build && npm run e2e                        # Playwright against the built server + mock API, axe in light/dark
```

If your machine's Chromium does not match Playwright's expected build, set `PW_CHROMIUM_PATH` to a Chromium binary (CI installs its own).

## Screenshots

`npm run build && npm run screenshots` regenerates `docs/screenshots/` (desktop and mobile, light and dark).
