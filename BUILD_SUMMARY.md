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
| `POST /api/auth/signup/` `{email, password, full_name}` | 201 `{access, refresh, user}` |
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
5. **Branding:** the exact name is "Skill Swap Platform with AI Matching"
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
