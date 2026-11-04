# Design decisions (buyer website)

Ids `W1-nn`. Newest last.

| Id | Date | Decision | Why |
|---|---|---|---|
| W1-01 | 2026-11-04 | React Router **7.18.5** pinned (exact) for `react-router`, `@react-router/*`. npm's `latest` is v8; the brief says v7. | Brief; the `@react-router/*` packages must share one version. |
| W1-02 | 2026-11-04 | ESLint 9 (not 10) with typescript-eslint and `jsx-a11y`. | `eslint-plugin-jsx-a11y` does not support ESLint 10 yet. |
| W1-03 | 2026-11-04 | Production server is `server.js` (Express 5 + `@react-router/express`). Start-up validation runs when the server build is imported (`entry.server.tsx` calls `getConfig()`), so a bad config fails the process before it listens. | Fail fast in production. |
| W1-04 | 2026-11-04 | Theme preference is the cookie `solvelt_theme` (`light`/`dark`/`system`, 1 year, `SameSite=Lax`, not HttpOnly since it holds no secret). The root loader reads it and SSR emits `<html data-theme>` for light/dark; `system` emits no attribute so `prefers-color-scheme` applies. Responses `Vary: Cookie`. Sign-out must not clear it. | No flash of the wrong theme; user choice survives sign-out. |
| W1-05 | 2026-11-04 | Theme is changed by `POST /theme` (progressive enhancement, works without JS). It runs the same Origin check as every mutating action and only redirects to `safeNext()` paths. | CSRF and open-redirect hotspots apply to every action. |
| W1-06 | 2026-11-04 | `assertSameOrigin` (Origin, falling back to Referer, must equal `PUBLIC_ORIGIN`) lives in `lib/csrf.server.ts`; the per-session CSRF token is added with the auth slice and checked in the same helper. | Origin check plus token is required; slice 1 has no session yet. |
| W1-07 | 2026-11-04 | `?next=` targets go through `safeNext`: must start with a single `/`, no `//`, `/\`, backslash or CR/LF; otherwise `/`. | Open-redirect hotspot. |
| W1-08 | 2026-11-04 | Overlays use native `<dialog>` (modal and drawer): built-in focus trap, Escape and inert background. | Less custom a11y code to get wrong. |
| W1-09 | 2026-11-04 | Fonts self-hosted through `@fontsource` (Plus Jakarta Sans 400/600/700, Playfair Display 600/700, latin subset). | Brief; no third-party font requests. |
| W1-10 | 2026-11-04 | E2E runs the built server (`node server.js`) with `e2e/mock-api.mjs`. Viewport-specific tests live in `*.mobile.spec.ts` (desktop project ignores them) rather than using `test.skip`. | No skipped tests. |
| W1-11 | 2026-11-04 | Playwright uses `PW_CHROMIUM_PATH` when set (local sandboxes); CI runs `playwright install --with-deps chromium`. | Local browser build may differ from the Playwright version. |
| W1-12 | 2026-11-04 | The API has no catalog or auth endpoints merged yet (`docs/API.md` lists only `/health` and `/api/v1/ping`). Catalog and auth slices are built against a typed client plus mock handlers and wired when the endpoints land. | Brief instruction. |

## Theming
Tokens are CSS custom properties in `app/styles/tokens.css` (from the Solvelt portal). Dark values apply under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme='light'])` and for `:root[data-theme='dark']`. Bright images use `filter: brightness(var(--img-dim))`.

## Components (slice 1)
`app/components/ui`: Button, LinkButton, Input/Field (label, hint, error), Select, Checkbox, Card, Badge, Price, RatingStars, Skeleton, EmptyState, Breadcrumb, Pagination, Modal/Drawer, Toast. Shell: Logo, Header (search, nav, account, cart placeholder, mobile drawer), Footer (theme switch), skip link, error/404 pages. `/styleguide` (noindex) shows them all and is covered by axe in light and dark.

## Status
Slice 1 (skeleton, tokens, shell, CI): done. Next: auth (BFF), then catalog pages, SEO, images.

## Additions after slice 1
| Id | Date | Decision | Why |
|---|---|---|---|
| W1-13 | 2026-11-04 | All API calls go through `apiFetch` (`app/lib/api.server.ts`). It sets the client IP header from the socket peer; `X-Forwarded-For` is honoured only when the peer matches `TRUSTED_PROXIES` (IPs or IPv4 CIDRs, comma separated), walking the chain right to left past trusted hops, ignoring malformed chains. A client-supplied copy of the header is never forwarded. (Header details superseded by W1-14.) Express `trust proxy` is off. | Orchestrator addition to brief item 4: the API rate-limits per end-user IP but all traffic arrives from this server. |
| W1-14 | 2026-11-04 | Forwarding contract is final (API repo `docs/API.md`, API main 3b48083). `apiFetch` sends on every call, and only when an IP could be resolved: `X-Solvelt-Client-Ip`, `X-Solvelt-Client-Timestamp` (unix seconds, floored, our clock) and `X-Solvelt-Client-Signature` = `v1=` + lower-hex HMAC-SHA256(`WEB_FORWARDING_KEY`, `"<timestamp>\n<ip>"`). The key is env `WEB_FORWARDING_KEY`; production start-up fails if it is missing, shorter than 32, the dev default, or equal to `SESSION_COOKIE_SECRET`. Test vector: key `dev-only-web-forwarding-key-not-for-production`, ts `1700000000`, ip `203.0.113.9` -> `v1=eaf9dade01862226a6cb91574596e068996969fe53eb32f05d4ec102df81a4e8`. | Orchestrator relay of M1 contract; verified against the API docs. |

## Review 1 (orchestrator review of 9dfb046)
| Id | Date | Decision | Why |
|---|---|---|---|
| W1-15 | 2026-11-04 | `safeNext` rejects any control char, whitespace (incl. NBSP) or backslash anywhere, then resolves the value against a dummy origin and returns `pathname+search+hash`, rejecting a result starting with `//`. Rejects tested: tab, newline, space, NUL, NBSP, `https:`, `//`, backslash. | Browsers strip tabs/newlines and read `\` as `/`: `"/\t/evil.example"` became `//evil.example` (HIGH). |
| W1-16 | 2026-11-04 | Anything but `NODE_ENV=development\|test` is production (unset included). In production both secrets must be >= 32 chars, not placeholders (`change-me`, `dev-only`, `example`, ...) and have >= 12 distinct characters. The http exception for `PUBLIC_ORIGIN` is decided on the parsed hostname (`localhost`, `127.0.0.1`), not a regex over the string. E2E/screenshot secrets are random-looking. | Weak or placeholder secrets and `http://localhost.evil.com` were accepted. |
| W1-17 | 2026-11-04 | Security headers are set once in Express middleware in `server.js` for every response: nonce-based CSP (`script-src 'self' 'nonce-…'`, `style-src 'self'` plus `style-src-attr 'unsafe-inline'` because React emits `style=""` attributes, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`), nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy (payment and passkeys allowed for self), COOP, HSTS when `PUBLIC_ORIGIN` is https. The nonce reaches RR through the load context and a `NonceContext`. `entry.server.tsx` sets `Cache-Control: private, no-cache` on HTML unless a route sets its own and `Vary: Cookie`; `handleDataRequest` does the same for `.data` responses. | Hotspot: personalised SSR data must never be shared-cached; HTML had no CSP. |
| W1-18 | 2026-11-04 | Light-mode hero focus ring is `--gold-2`; inputs' placeholder uses `--muted` with opacity 1. | `--ring` on the green hero was 1.6-2.6:1; the browser placeholder grey fails contrast on dark surfaces (axe does not check it). |
| W1-19 | 2026-11-04 | `robots.txt` no longer disallows `/img/` or `/styleguide` (noindex does that job). RR packages are pinned exactly (no `^`). Render abort timer is cleared. Playwright `retries: 0`. | Review items 6 and 7. |
| W1-20 | 2026-11-04 | New E2E checks: computed dark/light body background in every axe case; OS dark/light with no cookie; explicit light beats OS dark; placeholder colour; hero focus colour; noindex meta on 404; security/caching headers on HTML, `.data`, resource routes; nonce differs per request; hydration with no console errors or CSP violations; start-up failures. Each fix was revert-checked (the matching test goes red). | Review item 7. |
