# Website sessions: the BFF (W2)

The customer website never lets the browser talk to the API directly. Next route handlers under
`/api/bff/*` (the "backend for frontend") call the API server-to-server, so tokens never reach page
scripts.

## Cookies (website origin only)

| Cookie     | Content               | Flags                                              | Purpose                                        |
| ---------- | --------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `ui_at`    | access token (JWT)    | HttpOnly, SameSite=Lax, Secure on https, path `/`  | Sent to the BFF; expires a little before the token |
| `ui_rt`    | refresh token         | HttpOnly, SameSite=Lax, Secure on https, path `/api/bff` | Only the BFF ever receives it            |
| `ui_auth`  | `1`                   | not HttpOnly (a hint, never trusted)               | Pages decide which links to show / whether to fetch the cart |
| `ui_csrf`  | random value          | not HttpOnly (double-submit)                       | Must equal the `X-UI-CSRF` header on mutations |
| `ui_lang`  | `en` / `pcm`          | SameSite=Lax                                       | Language (only honoured when the Pidgin flag is on) |

Nothing is kept in `localStorage` / `sessionStorage` except short-lived, non-secret form drafts
during a language switch (never passwords).

## Flows

- **Login / register**: browser -> `POST /api/bff/auth/{login,register}` -> API with `client:"web"`.
  The API answers with the access token in the body and the refresh token in `Set-Cookie`; the BFF
  moves both into the cookies above and returns only the customer profile.
- **Every other call**: browser -> `/api/bff/<api path>` (allow-list in `lib/bff/allowlist.ts`) ->
  API with `Authorization: Bearer <ui_at>`. When `ui_at` is missing or the API answers 401, the BFF
  refreshes once (body `{refreshToken}`), re-issues the cookies and retries. If the refresh fails the
  cookies are cleared and the browser gets `401 UNAUTHENTICATED` (the app then sends the shopper to
  login with a safe return path).
- **Refresh is single-flight per refresh token.** The API rotates refresh tokens and revokes the
  whole session when an old one is presented again, so two parallel requests must not both refresh.
- **CSRF**: every non-GET BFF call needs a same-origin `Origin` / `Sec-Fetch-Site`, and the
  `X-UI-CSRF` header must equal the `ui_csrf` cookie (`GET /api/bff/csrf` creates it).
- **Logout**: revokes the refresh token at the API (best effort) and clears the cookies.
- **Email links** go to `/verify-email?token=` and `/reset-password?token=` on `PUBLIC_WEB_URL`. The page
  reads the token, removes it from the address bar, and sends it by POST.

## Deployment notes

- **API `TRUST_PROXY=1`** (one hop): the BFF forwards the real client address in `X-Forwarded-For`
  (the last entry of the load balancer's header), so the API's per-IP rate limits and account
  lockouts apply to shoppers, not to the website server.
- `PUBLIC_WEB_URL` (API) must be the website origin; `NEXT_PUBLIC_SITE_URL` (web) is used for the
  CSRF origin check and canonical URLs.
- Several web instances: the single-flight lock is in-process. Add a short rotation grace window in the
  API (accept the previous refresh token for a few seconds) before scaling out. **Not built; needs a
  decision.**
- Password rules: the minimum length is a server setting that the public API does not expose, so the
  forms cannot state it up front (they show the server's `WEAK_PASSWORD` answer). Proposal: add it to
  `GET /site/config` settings.
