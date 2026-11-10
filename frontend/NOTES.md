# SkillSwap Frontend — Notes

React + TypeScript + Vite + Tailwind CSS v4 (`@tailwindcss/vite`). Built to the
SRS/SDD spec ("Skill Swap Platform with AI Matching", Islamia University of
Bahawalpur). No demo/fake data anywhere: when the API fails, the UI shows a
clear error state.

## How to run

```bash
npm install
npm run dev        # open http://localhost:5173
```

The API base comes from `VITE_API_URL` (default `http://localhost:8000/api`).
For a deployed backend, e.g.:

```bash
VITE_API_URL=https://<your-backend>/api npm run dev
VITE_API_URL=https://<your-backend>/api npm run build
```

## Auth (JWT, not DRF token auth)

- Sign up: email + password + full name → `POST /api/auth/signup/`
  returns `{access, refresh, user}`.
- Log in: email **or** username + password → `POST /api/auth/login/`.
- Tokens stored in localStorage as `skillswap_access` / `skillswap_refresh`
  (+ `skillswap_user` for the cached user object).
- Every API call sends `Authorization: Bearer <access>`.
- On a 401 the client tries `POST /api/auth/refresh/` once with the refresh
  token and retries; if refresh fails it clears auth and routes to login.
- Unauthenticated users always see the login screen (route guard in `App`).
- Demo hint on the login screen: "Try the demo: maya / demo1234 (also leo / demo1234)".

## Panels (left sidebar on desktop / bottom nav on mobile)

1. **Create Your Skill Account** (`src/components/ProfilePanel.tsx`) — full name,
   bio, location (city/area), TEACH skills labelled "Superpowers", LEARN skills
   labelled "Growth Desires" (comma-separated), availability select, portfolio
   link. "Save & Find AI Matches" → `PUT /api/profile/me/` then switches to
   the AI Match Dashboard. This panel is also the settings editor; the sidebar
   has a Log out button.
2. **AI Match Dashboard** (`src/components/Dashboard.tsx`) — card grid with %
   match badges, name, location, trust-score badge, verified badge, a
   "why matched" line (can teach you / you can teach them), same-city bonus
   shown transparently ("+N same-city bonus"), skill chips, and a
   "Connect & Chat" button per card (opens the Chat Hub with that peer).
   Location filter dropdown (All cities + each city present). Stats row uses
   REAL numbers from the API only. Empty state exact text:
   "No matches found. Try updating your skill definitions."
   Below the matches, "Also in the community" for below-50% profiles.
3. **Chat & Scheduler Hub** (`src/components/ChatHub.tsx`) — dual pane:
   conversation list (with search) + message pane with a context label
   ("Trading: <top overlapping skill>"). Messages from
   `GET /api/messages/?peer=`; sending goes via REST `POST /api/messages/`
   FIRST (source of truth — "sent" only after REST succeeds) and also over
   the WebSocket for live delivery. Scheduler: calendar date picker +
   duration dropdown ("30 Minutes", "1 Hour Mutual Swap", "2 Hours") +
   "Finalize & Track Session" → `POST /api/sessions/` (PENDING); the server's
   error (e.g. double-booking) is shown verbatim. "My sessions" list in the
   hub with Accept / Cancel / Mark complete actions by status.
4. **Session Feedback Hub** (`src/components/FeedbackHub.tsx`) — partner
   dropdown limited to completed-session partners only; 5 interactive stars
   (submit blocked at 0 stars); comments box; Submit → `POST /api/reviews/`;
   after submit the partner's updated trust score is fetched
   (`GET /api/profiles/<id>`) and shown.

No money features anywhere. No dead buttons: every visible control performs a
real action.

## Live chat (WebSocket)

`ws(s)://<api-host>/ws/chat/?token=<JWT access token>` — host derived from
`VITE_API_URL` (http→ws, https→wss, trailing `/api` stripped). Auto-reconnect
with backoff (max 5 retries); on reconnect, history is reloaded from
`GET /api/messages/`. The chat header shows a "● Live" /
"● Offline — messages still send" indicator. Messages persist via REST —
never local-only.

## Search

Top-bar search is always visible, including phone widths: the header uses
`flex-wrap` and the input has `min-w-[160px]`; there is NO CSS rule hiding
`.search` (or any search input) under a max-width media query (verified in
the built CSS — see Verification). Typing filters the dashboard live by name,
bio, and both skill lists across matches + community; shows
"N results for '<query>'" and a "No results for '<query>'" empty state with
a Clear search button. Typing while on another tab switches to the dashboard.

## Files

- `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
- `src/main.tsx`, `src/App.tsx` (tabs, auth guard, data loading, WS wiring)
- `src/api.ts` — typed fetch client (Bearer + 401 refresh retry) + `ChatSocket`
- `src/styles.css` — Tailwind v4 import (no search-hiding rules)
- `src/components/` — `AuthScreen`, `ProfilePanel`, `Dashboard`, `ChatHub`,
  `FeedbackHub`, `ui` (Avatar, chips, badges, date formatting)

## Verification (all done 2026-11-10)

- `npm install` — completes.
- `VITE_API_URL=http://localhost:8000/api npm run build` — passes, strict
  TypeScript (`tsc -b && vite build`), no errors.
- Second build with `VITE_API_URL=https://skillswap-backend-t46o.onrender.com/api`
  — passes; the built JS contains the Render host as the active base and
  `localhost:8000` only as the `||` fallback default, proving the base is
  env-driven, not hardcoded.
- Grepped the built CSS: the only `display:none` occurrences are the `[hidden]`
  reset, the `.hidden` utility, and `.md:hidden` (a *min-width* query hiding
  the mobile bottom nav on desktop). No `max-width` media query hides
  anything, and the search input carries no hiding class.
- Grepped the built JS for the spec strings: exact empty-state text,
  "Save & Find AI Matches", "Finalize & Track Session",
  "1 Hour Mutual Swap", "Trading:", "Superpowers", "Growth Desires",
  "Also in the community", demo hint — all present. Zero leftover
  references to the old DRF token auth in `src/`.
- Served the production build with `vite preview`: index and bundle both
  HTTP 200, correct `<title>`.

## Deviations from the brief

- None in behaviour. One implementation note: the refresh retry is guarded
  by a shared in-flight promise so parallel 401s trigger only one refresh.
- The duration dropdown sends the exact label strings ("30 Minutes",
  "1 Hour Mutual Swap", "2 Hours") as `duration_block`, matching the SDD
  ("preset time allocation layouts (e.g. '1 Hour Mutual Swap')").
- Session status values used: `PENDING` / `ACCEPTED` / `COMPLETED` /
  `CANCELLED` (per SDD §4.5). Accept is shown to the partner who did not
  create the session (inferred as `partner_two`); Cancel is offered on
  PENDING/ACCEPTED sessions, Mark complete on ACCEPTED ones.

## Not done here (out of scope for this task)

- No deployment, no browser testing, no GitHub push (per brief).
- Live end-to-end login/chat against a real backend was not possible from
  this environment (no backend was running locally); the frontend was
  verified by build + static checks + serving the production bundle.
  Run it against the Django backend (`VITE_API_URL` above) to exercise
  login → profile → matches → chat → sessions → reviews end to end.
