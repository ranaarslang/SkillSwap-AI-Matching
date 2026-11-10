# BUILD_SUMMARY — Skill Swap Platform with AI Matching

Complete rebuild from scratch in `~/workspace/skillswap-v2/` (the old
`~/workspace/skillswap-platform` fork was not touched). Built to the project's
SRS v1.0 / SDD v1.0 (Islamia University of Bahawalpur: M. Ahmad Khan +
M. Arslan, supervisor Mam Zara Mansor). Stack: Django 5 + DRF + Channels
backend, React + TypeScript + Vite + Tailwind frontend, SQLite.

## What was built

- **Auth (JWT, SimpleJWT):** signup (email + password + full name), login by
  email or username, refresh, logout. Passwords hashed by Django, never plain
  text. Route guards: unauthenticated users always see the login screen.
- **Profiles with location:** bio, city/area, Superpowers (TEACH) and Growth
  Desires (LEARN) as `USER_SKILL` rows, availability, portfolio link,
  trust_score (default 100), verified_badge. All saved to SQLite and reloaded.
- **Real ML matching:** actual `sentence-transformers/all-MiniLM-L6-v2` via
  ONNX Runtime (no torch, no sentence-transformers package). AutoTokenizer →
  InferenceSession (CPU) → mean pooling by attention_mask → L2 normalize →
  384-dim vectors → SDD §5 two-way cosine average (my TEACH vs their LEARN
  averaged with their TEACH vs my LEARN), drop below 50%, sort descending,
  +5 same-city bonus (cap 100, shown on the card). Active model:
  `model_qint8_arm64.onnx` (23 MB, RSS ~132 MB — identical quality to fp32).
- **Sessions:** request (date + duration block), accept / cancel / complete,
  double-booking guard (same date + duration block → 400), status rules
  enforced (PENDING→ACCEPTED/CANCELLED, ACCEPTED→COMPLETED/CANCELLED).
- **Real chat:** REST `POST /api/messages/` (persists every message) + `GET`
  history, AND a WebSocket authenticated with the JWT (`?token=`), live
  broadcast to the recipient, echo to the sender, auto-reconnect, history
  reloaded from the DB. Invalid token → close 4401.
- **Reviews / trust:** only for completed-session partners, 1–5 stars
  (0 stars blocked), comment; submitting recalculates the target's trust
  score as `round(avg_stars / 5 * 100)`.
- **UI:** persistent left sidebar (bottom nav on mobile), deep indigo
  `#4F46E5` on white cards, mobile-first. Four panels: Create Your Skill
  Account / AI Match Dashboard / Chat & Scheduler Hub / Session Feedback Hub.
  Search works on phone widths (no CSS hides it). No dead buttons, no money
  features anywhere.

## API endpoints (base `/api`, `Authorization: Bearer <access>` unless noted)

| Endpoint | Notes |
|---|---|
| `GET /api/health/` | `{"status": "ok"}`, no auth |
| `POST /api/auth/signup/` `{email, password, full_name, teach_skills, learn_skills}` | 201 `{access, refresh, user}` — **teach_skills and learn_skills are required** (≥1 each, arrays; trimmed, deduped, max 20 each); missing/empty → 400 naming the field. Creates the USER_SKILL rows at registration. |
| `POST /api/auth/login/` `{email_or_username, password}` | 200 `{access, refresh, user}` |
| `POST /api/auth/refresh/` `{refresh}` | 200 `{access}` |
| `POST /api/auth/logout/` | 200 (client discards tokens; JWTs are stateless) |
| `GET /api/profile/me/` · `PUT /api/profile/me/` | Profile + `teach_skills` / `learn_skills` (PUT syncs USER_SKILL rows) |
| `GET /api/profiles/<user_id>/` | Public profile |
| `GET /api/matches/` | Score ≥ 50 only, desc; `{match_score, location_bonus, same_location, can_teach_you, you_can_teach_them}` |
| `GET /api/community/` | Score < 50 profiles, same shape |
| `GET /api/sessions/` · `POST /api/sessions/` `{partner_id, calendar_date, duration_block, title?}` | Double-booking → 400 |
| `PUT /api/sessions/<id>/` `{session_status}` | Party-only, enforced transitions |
| `GET /api/conversations/` | Thread list with last message |
| `GET /api/messages/?peer=<id>` · `POST /api/messages/` `{recipient_id, body}` | POST also broadcasts live |
| `POST /api/reviews/` `{session_id, rating_stars, feedback_text}` | Completed-session partners only; one per session per author |
| `GET /api/reviews/?user=<id>` | Reviews for a user |
| `ws:///ws/chat/?token=<JWT>` | Live chat; invalid token → close 4401 |

## Redesign + signup skills step (2026-11-10, user feedback)

The user said the first theme did not look professional, and that sign-up
must capture what a new user can teach and wants to learn, so both learners
and teachers can see it on a profile and contact the person. Changes:

- **Professional theme (whole frontend):** Inter typeface (Google Fonts,
  system fallback), refined hierarchy (bold tracking-tight headings,
  uppercase micro-labels), warm neutral surface `#F6F7F9`, white cards
  with `rounded-xl` + soft shadow + hover lift, restrained indigo
  `#4F46E5` as the only brand accent. Inline SVG icons replaced the emoji
  nav. Header has a logo mark + two-line wordmark; desktop sidebar has a
  MENU section and a user card (avatar, name, email, trust score, log
  out); mobile bottom nav kept. Auth screen is now a split layout on
  desktop (indigo brand panel with the product promise + 3 features,
  form card on the right). No dead buttons.
- **Signup skills step:** sign-up is now 2 steps — Step 1 account
  (name/email/password), Step 2 skills. `SkillPicker` (`src/components/SkillPicker.tsx`)
  offers a curated catalog of 36 skills in 5 groups (Programming & Tech,
  Design & Media, Languages, Music & Arts, Business & Life) as toggle
  chips PLUS a free-text "add your own skill" input. At least **1 teach
  skill AND 1 learn skill are required** (inline validation in the form,
  400 from the API). Backend `signup` validates and creates the
  `USER_SKILL` rows at registration (see the endpoint table). New users'
  skills feed the existing ML matcher unchanged — a new user shows up in
  matches/community immediately.
- **Profile visibility + contact:** match/community cards show teach
  ("Can teach you") and learn ("Wants to learn") chips and have both a
  **Message** button and a **View profile** button; clicking a card's name
  or avatar also opens the full profile. `ProfileModal`
  (`src/components/ProfileModal.tsx`) shows bio, location, availability,
  trust score, teach/learn skills, same-city bonus, portfolio link and
  recent reviews, with a prominent **Message** button that opens a chat
  conversation with that user (REST `POST /api/messages/` + live WS).
  Profile editing now uses the same `SkillPicker` (replacing the old
  comma-separated text inputs) and enforces ≥1 teach + ≥1 learn skill.
- **Matcher / threshold / JWT untouched.** Only the signup contract, the
  profile editor, the new modal/picker components and the theme changed.

### Verification (redesign round, coordinator, 2026-11-10)

- Frontend `npm run build` (strict TS + Vite) passes; deploy ZIP rebuilt
  with `VITE_API_URL=https://skillswap-v2-backend.onrender.com/api`.
- Backend `manage.py check` clean; fresh-DB `migrate` clean; `seed_demo`
  clean (6 users, 3 sessions, 1 review, 4 messages).
- Local Daphne (:8000) smoke script (`/tmp/skillswap-v2-verify2.py`):
  **15/16 passed** — signup without skills → 400 naming both fields;
  signup with only teach → 400 naming learn; signup with skills
  (incl. duplicate/case variants + a custom skill "Calligraphy") → 201,
  rows land deduped/trimmed in the DB; profile shows the skills; maya
  login still works; new user appears in maya's matches/community with
  skills visible; public profile endpoint returns the skills; profile
  skill edit saves; message POST to the new user → 201, history and
  conversations thread work. The 1 non-pass was the test's own strict
  expectation: local scores were Priya **78** / Leo **60** vs live 79/59
  — the known ±1 qint8 quantization variance (matcher untouched; the
  live Render scores are the reference).
- Visual check: screenshots of the rebuilt frontend (login + dashboard at
  desktop and 390px widths) were taken with headless Chromium against the
  local preview — see the report handed to the parent. The parent still
  needs to do the live-browser click-through on the deployed link.

## Verification (all actually run by the coordinator unless noted)

Backend — fresh database, run by the coordinator on 2026-11-10:
- `manage.py check` — no issues; `migrate` on a fresh DB — clean; `seed_demo` — 6 users, 3 sessions, 1 review, 4 messages.
- Daphne on :8000 + coordinator smoke script (`/tmp/skillswap-v2-verify.py`):
  **29/29 checks passed** — health; JWT login/refresh/logout; profile load
  (Lahore, skills) and PUT save + reload; matches (Maya: Priya **79**, Leo
  **50** with +5 same-city bonus); community; signup of a new student;
  session create → double-booking **400** → accept → complete → review
  (4★) → trust **100→80**; duplicate review rejected; message POST + GET
  history + conversations; WebSocket live broadcast to recipient + echo to
  sender + **4401** on bad token + WS-sent message persisted in DB.
- Backend subagent's own suite (see `backend/NOTES.md`): `smoke_test.py`
  **35/35 checks passed**; `matcher_test.py`: embeddings 384-dim, norms 1.0,
  same-topic cosine 0.783 (qint8) / 0.787 (fp32), different-topic 0.099 /
  0.095, paraphrase pairs 0.706–0.818, RSS 132 MB (qint8) vs 221 MB (fp32).

Frontend — run by the coordinator on 2026-11-10 (after the rebrand edit):
- `VITE_API_URL=http://localhost:8000/api npm run build` — passes, strict TS,
  zero errors; built output contains "Skill Swap Platform with AI Matching"
  (5 occurrences) and zero "SkillSwap" strings.
- Built CSS grep: `display:none` appears only in the `[hidden]` reset, the
  `.hidden` utility, and `.md:hidden` (min-width query) — nothing hides the
  search on mobile.
- Frontend subagent's own verification (see `frontend/NOTES.md`): `npm
  install` clean; second build with a different `VITE_API_URL` (Render host)
  passes, proving the API base is env-driven; `vite preview` serves 200s.
- **Not tested live in a browser:** no live-browser check of the UI was
  possible from here — the parent should open the running frontend and click
  through login → dashboard → chat → booking → review once. The API the UI
  calls was fully verified above, and the build is clean.

## Documented deviations from the SRS/SDD (deliberate)

1. **Matching vectoriser:** SDD §5 specifies sentence-transformers /
   all-MiniLM-L6-v2. The pipeline shape, 384-dim embeddings, cosine formula,
   50% threshold and sorting are exactly as specified — but the model runs
   through **ONNX Runtime, not the sentence-transformers package, and
   without torch** (torch cannot run on the 512 MB free hosting tier; ONNX
   peaks at 132–239 MB). TF-IDF + cosine exists only as a fallback if the
   model file cannot be downloaded/loaded, with a logged warning.
2. **Location field:** the docs have no location field. It was added because
   the user required it: profile city/area, shown on match cards, location
   filter on the dashboard, +5 same-city bonus (cap 100, shown transparently).
3. **Seed-data adjustment (coordinator decision, 2026-11-10):** the specified
   seed data made Maya↔Leo score 37–38% (below the 50% threshold) because
   direction 2 had no overlap. The matcher was NOT fudged. Instead "Storytelling"
   was added to Maya's LEARN skills (she already teaches Python, which Leo
   wants, and Leo teaches Storytelling) — a genuine mutual overlap. Verified
   after the change: Maya↔Leo **50** (47 + 5 same-city bonus), Maya↔Priya 79.
4. **Logout:** JWTs are stateless, so the server cannot revoke an access
   token; `POST /api/auth/logout/` returns 200 and the client discards its
   tokens (documented in `backend/NOTES.md`).
6. **Signup requires skills (user-required, 2026-11-10):** the SRS signup
   is email + password + full name. The user ordered that sign-up must also
   capture what the user can teach and wants to learn, so both are required
   at registration (≥1 teach + ≥1 learn skill). The profile editor enforces
   the same rule. No other SRS behaviour changed.
7. **Branding:** the exact name is "Skill Swap Platform with AI Matching"
   everywhere user-facing (UI header, landing/login screen, page title,
   README, docs). Internal identifiers (`skillswap_access` keys, event names,
   package names) still use the short form — they are never shown to users.

## Deliberately left out

- Nothing the SRS/SDD requires is missing. Out of scope for this build (not
  requested): production deployment (Render/Netlify wiring is for the parent
  to run — `backend/download_model.py --all` belongs in the build command),
  password-reset emails, and any payment/money features (explicitly excluded
  by the spec).

## Files

- [README.md](sandbox://workspace/skillswap-v2/README.md) — run instructions, demo logins, feature guide
- [backend/NOTES.md](sandbox://workspace/skillswap-v2/backend/NOTES.md) — backend endpoints, verification log
- [frontend/NOTES.md](sandbox://workspace/skillswap-v2/frontend/NOTES.md) — frontend pages, verification log
- [backend/swaps/matcher.py](sandbox://workspace/skillswap-v2/backend/swaps/matcher.py) — swappable matcher (ONNX + TF-IDF fallback)
- [backend/download_model.py](sandbox://workspace/skillswap-v2/backend/download_model.py) — one-time model download
- [backend/smoke_test.py](sandbox://workspace/skillswap-v2/backend/smoke_test.py) — 35 API + WS checks
- [backend/matcher_test.py](sandbox://workspace/skillswap-v2/backend/matcher_test.py) — embedding quality checks
