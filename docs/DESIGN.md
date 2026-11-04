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
