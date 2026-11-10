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
| `GET /api/admin/stats/` | Staff only. `{total_users, total_students, total_sessions, sessions_pending/accepted/completed/cancelled, total_messages, total_reviews, average_trust_score}` |
| `GET /api/admin/users/?q=` | Staff only. All users with full profile + skills + trust + `is_active`/`is_staff`; `q` searches name/username/email. |
| `GET /api/admin/users/<id>/` | Staff only. Full user record: profile, sessions, reviews received/given, recent messages (20). |
| `POST /api/admin/users/<id>/toggle-active/` | Staff only. Flips `is_active`; cannot deactivate your own account (400). |
| `POST /api/admin/users/<id>/reset-password/` `{password?}` | Staff only. Sets the password; blank input auto-generates a secure `Temp-XXXXXXXX` password, returned once (`temporary_password`, `generated`). |
| `POST /api/admin/users/<id>/set-trust/` `{trust_score}` | Staff only. Manual trust override, clamped 0–100. (A later review recalculates from ratings.) |
| `GET /api/admin/sessions/?status=` | Staff only. All sessions; optional status filter. |
| `POST /api/admin/sessions/<id>/cancel/` | Staff only. PENDING/ACCEPTED → CANCELLED; other statuses → 400. |
| `GET /api/admin/reviews/` | Staff only. All reviews with author/target. |
| `DELETE /api/admin/reviews/<id>/` | Staff only. Deletes the review and recalculates the target's trust score (returns it). |
| `DELETE /api/admin/messages/<id>/` | Staff only. Deletes any message. |
| Non-staff users get **403 on every `/api/admin/` endpoint**; the Admin nav is hidden for non-staff users. Staff accounts never appear in matching (excluded from candidates). |
| `POST /api/auth/login/` `{email_or_username, password}` | 200 `{access, refresh, user}` |
| `POST /api/auth/refresh/` `{refresh}` | 200 `{access}` |
| `POST /api/auth/logout/` | 200 (client discards tokens; JWTs are stateless) |
| `POST /api/auth/change-password/` `{current_password, new_password, confirm_password}` | **IsAuthenticated.** Verifies the current password, new password min 6 chars, confirm must match; 200 on success (new password works immediately for login); 400 with a clear message on wrong current password / too-short new password / mismatch; 401 unauthenticated. UI: "Change Password" card in the Profile panel (current + new + confirm, frontend validation, success/error toasts). |
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

## Admin Panel (2026-11-10, user-ordered)

Staff-only section for solving any user issue. Admin demo account
(**admin / demo1234**, `is_staff` + `is_superuser`, created by
`seed_demo.py`, survives redeploys) logs in via the normal login page;
staff users see an **Admin** entry in the sidebar (and mobile nav). The
panel is in the same professional theme.

- **Dashboard stats:** total users (students split out), total sessions
  with pending/accepted/completed/cancelled counts, total messages, total
  reviews, average trust score.
- **Users management:** searchable table (name, username, email, location,
  teach/learn skills, trust, active status) with a full-record **View**
  and an activate/deactivate toggle. Self-deactivation is blocked (400 +
  disabled button).
- **User detail view:** one screen per user — profile, skills, location,
  trust, all sessions (with cancel), reviews received/given, recent
  messages (with delete), plus the fix-an-issue actions: password reset
  (supplied or auto-generated temporary password, shown once), trust
  override (clamped 0–100), activate/deactivate, and a Message button.
- **Sessions overview:** all sessions with both partners, title, date,
  duration, status; filter by status; cancel any PENDING/ACCEPTED session
  (inline confirm).
- **Reviews moderation:** all reviews with author/target/stars/text;
  delete recalculates the target's trust score and returns the new value.
- **Message moderation:** delete any message from the user-detail view.
- Backend: all `/api/admin/` endpoints (see table) are protected by
  DRF `IsAdminUser`; the existing public endpoints are untouched. Staff
  accounts are excluded from matching candidates, so the admin never
  appears in students' matches/community.
- **Matcher thread-safety fix (found during verification):** the dashboard
  fires `/matches/` and `/community/` in parallel, and on a cold server
  two threads racing the lazy `transformers` import could see a
  partially initialised module, permanently caching the TF-IDF fallback
  (observed live: Leo 55%, Priya dropped out of matches). `get_matcher()`
  now uses a lock with double-checked caching — scores, threshold and
  model are unchanged; first load is single-threaded. Verified with 3
  rounds of parallel matches+community calls right after a cold restart:
  Priya 78 / Leo 60 every time, zero fallback warnings.

### Verification (admin round, coordinator, 2026-11-10)

- Frontend `npm run build` (strict TS + Vite) passes; deploy ZIP rebuilt
  with `VITE_API_URL=https://skillswap-v2-backend.onrender.com/api`.
- Backend `manage.py check` clean; fresh-DB `migrate` clean; `seed_demo`
  clean (6 demo users + admin, 3 sessions, 1 review, 4 messages).
- Local Daphne smoke script (`/tmp/skillswap-v2-verify-admin.py`):
  **38/38 passed** — admin login + `is_staff` flag; stats counts; users
  list + search; sessions list + status filter; reviews list; user detail
  (all keys, message present); password reset (supplied password works,
  auto-generated password works, shown once); trust set 42 + clamps
  250→100 / −5→0; deactivate blocks login, reactivate restores it,
  self-deactivate → 400; cancel PENDING session, re-cancel → 400;
  message delete; full review cycle (new completed session → 3★ review →
  trust 80 → admin delete → trust 100); admin never in matches/community;
  **non-admin gets 403 on all 11 admin endpoints**.
- Visual check: headless-Chromium screenshots of the admin panel and the
  user-detail view (desktop) plus the redesigned auth/signup/dashboard/
  profile-modal (desktop + 390px) — all reviewed, layout clean, no
  overflow, correct scores (Priya 78%, Leo 60%).

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
8. **Admin Panel (user-ordered, 2026-11-10):** not in the SRS/SDD. Added
   staff-only `/api/admin/` endpoints + an Admin Panel UI (stats, user
   management incl. password reset/trust override/message delete/session
   cancel, review moderation). The `admin` demo account is staff/superuser
   and is excluded from matching. The matcher lock in `get_matcher()` is a
   thread-safety fix only — scores, threshold and model unchanged.
9. **Database: env-based Postgres (Neon free tier), SQLite fallback
   (user-approved, 2026-11-10):** the docs assume a database without
   naming one. The live backend ran on a SQLite file with no persistent
   disk on Render free tier, so every backend code deploy rebuilt the DB
   from scratch (migrate + `seed_demo`) and wiped ALL live data — admin
   password, signups, sessions, reviews. `backend/config/settings.py`
   now reads `DATABASE_URL`: if set, it parses it with `urllib.parse`
   (no new dependency) and uses `django.db.backends.postgresql`
   (Neon: `postgres://user:pass@host:5432/dbname?sslmode=require`,
   password percent-decoded, `sslmode` honoured from the query string,
   bad scheme fails fast with a clear error); if unset, the previous
   SQLite fallback is unchanged. `psycopg[binary]>=3.2,<4` added to
   `backend/requirements.txt`. No models, auth, matching, admin or seed
   code changed — `seed_demo` works on Postgres unchanged. Verified
   2026-11-10: `manage.py check` clean with and without `DATABASE_URL`
   (no live DB needed); with a test URL the engine is postgresql and
   NAME/USER/HOST/PORT/sslmode parse correctly; no SQLite-specific code
   remains outside the fallback. Deploy note: set `DATABASE_URL` in the
   Render service env vars, then deploy (or redeploy) — the build runs
   migrate + `seed_demo` on the Postgres DB, which seeds the demo users
   (maya/leo/admin, demo1234) on the fresh DB. The admin password set
   via Change Password then survives all future deploys.

## Fix round 2 — dedicated admin login, change password, seed fix, premium theme, distinct admin console (2026-11-10, user feedback)

The user reported (1) the admin login showed the sign-up option too, and
(2) the admin account could only be opened with the demo password — any
password of their own choice said invalid. They then said the theme still
looked low-level, and that the admin panel must look clearly different
from the student app. Changes:

- **Dedicated admin login page:** `AuthScreen` gains `variant="admin"`
  (hash route `#/admin-login` in `App.tsx`, hashchange listener). Login
  only — no Sign up tab, no signup link, "Admin Login" heading with a
  shield mark and a staff-only note. The main login screen has an
  "Admin Login →" link. A staff login there lands on the Admin Panel;
  a non-staff login there is rejected with a clear "staff only" error
  and is not authenticated (tokens cleared). Normal student login/signup
  is unchanged. Logout clears the `#/admin-login` hash.
- **Change password (self-service):** new endpoint
  `POST /api/auth/change-password/` (see the endpoint table) + a "Change
  Password" card in `ProfilePanel` (current + new + confirm). The new
  password works immediately for login. This is how the user sets their
  OWN admin password: log in as admin, open Create Your Skill Account,
  set a new password there.
- **Seed fix (critical):** `seed_demo.py` now sets the admin password
  (`demo1234`) ONLY when the admin account is first created
  (`admin_created` True). It never overwrites it on re-seed, so a
  password the user sets survives Render redeploys (Render runs
  `seed_demo` on every backend deploy). Demo student users keep their
  re-seed behaviour (demo1234) — intentional, unchanged.
- **Admin self-reset verified:** `admin_reset_password` has no self-block;
  the admin resetting their OWN password from the panel works and the
  supplied password logs in immediately.
- **Per-user password matching (Django PBKDF2 hashes, unchanged):**
  login checks the entered password against that user's own stored hash
  only. Verified locally: maya/demo1234 works; maya + a wrong password
  rejected; maya + the admin's password rejected; admin + a student's
  password rejected; after changing the admin password, admin + the new
  password works and admin + demo1234 is rejected; after re-running
  `seed_demo`, the changed admin password still works.
- **Premium theme elevation (whole frontend):** the previous
  "professional" pass was judged low-level, so the frontend now has a
  deliberate design-token system in `styles.css` (brand scale 50–950,
  ink scale, shadow tokens card/lift/pop/brand, radius tokens,
  component classes `.card`, `.card-interactive`, `.btn-primary`,
  `.btn-secondary`, `.input`, `.eyebrow`, `.page-title`, `.page-sub`,
  `.logo-mark`, `.grad-text`, `.stat-card`, `animate-rise`/`animate-fade`,
  layered body background with subtle indigo radial tints) used
  consistently in `ui.tsx` (new `ScoreRing` SVG match-score ring,
  `LogoMark` gradient tile, refined Avatar/Chip/TrustBadge/VerifiedBadge/
  ScoreBadge/StatusBadge), `App.tsx` (gradient wordmark, gradient active
  nav pill, user card with trust progress bar), `Dashboard.tsx`
  (ScoreRing on match cards, gradient top accent bar, stat cards),
  `AuthScreen.tsx` (gradient brand panel with glow orbs, glassy feature
  chips, gradient headline accent, `rounded-panel` + `shadow-lift` form
  card), `ProfileModal.tsx` (gradient header with glow orb, backdrop
  blur + fade/rise animations), `ProfilePanel.tsx`, `ChatHub.tsx`,
  `FeedbackHub.tsx`, `AdminPanel.tsx`, `AdminUserDetail.tsx`,
  `SkillPicker.tsx`. Standard: polished modern SaaS (Linear / Stripe /
  Notion level of finish), indigo brand with a supporting palette, no
  rainbow. Mobile-first: 390px verified by screenshot.
- **Distinct admin console identity:** the admin area is a different
  product surface — a dark console, not another page of the student app.
  When the admin tab is active, `App.tsx` renders a dark shell
  (slate-950 background with a faint emerald radial tint, dark header
  with emerald shield tile + "Admin Console" / "SKILL SWAP PLATFORM"
  wordmark + STAFF badge, dark sidebar labelled "Console" with emerald
  active states, "← Back to student app" button, dark user card with an
  emerald trust bar, dark mobile bottom nav with emerald active tab).
  `AdminPanel.tsx` + `AdminUserDetail.tsx` are fully converted to dark
  surfaces (slate-900 cards, slate-800 borders, slate-100/300/400 text,
  emerald accent replacing indigo, `btn-admin` emerald-gradient buttons,
  `btn-admin-secondary` dark buttons, `input-dark` fields, denser
  tables `px-3 py-2.5`), with an `.admin-console` scope in `styles.css`
  restyling the shared token classes (`.card`, `.stat-card` with an
  emerald top accent, `.page-title`, `.page-sub`, `.eyebrow`) so the
  two looks can never bleed into each other. The admin login page is
  dark too (dark form card, emerald shield + "ADMIN CONSOLE" eyebrow,
  emerald Log in button, dark inputs). The student app keeps its premium
  light theme; a student never sees admin branding (verified: no Admin
  nav entry, no "Admin Console" text after a student login).
- **Access rule (verified):** only the admin's own database-stored
  password opens the admin panel. Students get 403 on all 11
  `/api/admin/` endpoints (re-verified this round), the Admin nav is
  hidden for non-staff users, and the admin login page rejects non-staff
  logins with a clear error.

### Verification (fix round 2, coordinator, 2026-11-10)

- Backend: `manage.py check` clean; fresh-DB migrate + `seed_demo`
  clean. `npm run build` passes (strict TS + Vite).
- API smoke script `/tmp/skillswap-v2-verify-fix2.py` (local Daphne):
  **phase 1: 13/13 passed; phase 2 (after re-running seed_demo):
  7/7 passed** — incl. the five per-user password checks: (1) maya/
  demo1234 → 200; (2) maya + wrong password and maya + admin's password
  → 400; (3) admin + a student's password → 400; (4) after changing the
  admin password via change-password, admin + new password → 200 and
  admin + demo1234 → 400; (5) after re-running seed_demo, the changed
  admin password still works and demo1234 stays rejected. Wrong current
  password → 400, too-short new password → 400, unauthenticated
  change-password → 401, non-staff admin stats → 403. Admin self-reset
  to a supplied password → login works. Local DB restored to
  admin/demo1234 afterwards.
- Fresh API re-check after the admin-console work (local Daphne,
  2026-11-10 ~15:20 PKT): maya/demo1234 → 200; maya/wrong → 400;
  admin/demo1234 → 200; maya's token → `GET /api/admin/stats/` → 403;
  admin change-password → 200, admin/new password → 200, admin/demo1234
  after change → 400; admin password restored to demo1234.
- Visual verification: Playwright script
  `/tmp/skillswap-v2-shots-fix2.py` (vite preview :4173 + local Daphne
  :8000 with `CORS_ALLOWED_ORIGINS` including the preview origin) —
  **ALL VISUAL CHECKS DONE**: auth desktop + 390px, admin login page
  (no Sign up tab, "Admin Console" brand), admin login rejecting maya
  (error `[role='alert']` text checked — body text alone was a false
  positive, the page itself contains "Staff only" copy), admin login
  landing on the dark Admin Console (desktop + 390px), maya dashboard
  (Priya 78%, Leo 60%, ScoreRings; no Admin nav, no admin branding),
  profile modal, Change Password section, dashboard 390px. Screenshots:
  `/tmp/skillswap-v2-shots-fix2/` (`01-auth-desktop`,
  `03-admin-login-desktop`, `05-admin-console-desktop`,
  `06-admin-console-mobile`, `07-dashboard-desktop`, `08-profile-modal`,
  `09-profile-change-password`, `10-dashboard-mobile`).

**Known caveat — admin password vs. redeploy (SUPERSEDED by the Neon
shift, deviation 9):** the live backend used a SQLite file DB with no
persistent disk on Render free tier, so the DB was rebuilt from scratch
(migrate + `seed_demo`) on every backend code deploy. The seed fix means
a changed admin password survives `seed_demo` re-runs on a live DB, but
it **reverted to demo1234 on the next backend code deploy** (fresh DB →
admin is "first created" again) and could then be re-set in 30 seconds
via the new Change Password UI. **Fix in place (code, 2026-11-10):**
settings are now env-based Postgres — once `DATABASE_URL` (Neon, free)
is set in the Render service env vars and the backend is redeployed,
the DB lives outside Render, survives deploys, and a password set via
Change Password stays set. Until `DATABASE_URL` is set, the backend
keeps running on SQLite and the old caveat still applies — do NOT set a
permanent admin password before the Neon switch, or it will be wiped by
the migration deploy itself.

## Student header redesign (2026-11-10, user feedback)

User liked the dark admin console header but not the student header, and
chose "Naya premium header banao" (full premium redesign). **Only the
student header changed; the admin header/console is byte-identical**
(`git diff` confirms: admin branch JSX, admin header classes, and the
admin STAFF badge are untouched; the new gradient hairline renders only
when `!isAdminView`).

What changed (`frontend/src/App.tsx` header block + `IconSearch` in
`frontend/src/components/ui.tsx`):
- Bigger brand lockup: `LogoMark` 36px → 44px with a white ring, wordmark
  15px → 17px extrabold, eyebrow tracking widened — the header now reads
  as a brand moment, not a generic white bar.
- Brand gradient hairline: a 2px indigo → violet → sky line along the
  header's bottom edge (student only; admin keeps its plain dark border).
- Search is now a proper pill: rounded-full, magnifier icon, soft slate
  fill, indigo focus ring, capped at `max-w-md` and centred. Same value /
  `onChange` / handler — filtering behaviour unchanged.
- User chip: avatar + name + trust pill (`★ {trust_score}` amber) + `✓`
  verified mark, inside one rounded-full bordered chip. Trust pill shows
  once the profile loads; name stays hidden below the `sm` breakpoint.
- Light premium theme kept throughout — no dark/emerald anywhere, so the
  student app can never be mistaken for the admin console.

### Verification (header round, coordinator, 2026-11-10)

- `npm run build` passes (strict TS + Vite).
- Visual verification: Playwright (`/tmp/verify_header3.py`,
  `/tmp/verify_header4.py`) against the production build served locally
  with `VITE_API_URL` pointing at the live Render backend. Local test
  notes: Chromium cannot reach the VM's IPv6-only egress proxy, so tests
  ran through a loopback `socat` TCP relay (127.0.0.1:3129 → proxy);
  `--disable-web-security` was needed because the backend's CORS list
  only allows the Netlify origin, not the local preview origin — both
  are test-harness-only, not app changes. **Student header PASSED**:
  desktop + 390px screenshots show the new lockup, hairline, search pill
  and trust chip (`★ 100` + `✓` for maya); 0px horizontal overflow at
  390px; search "Python" filters to Leo only and clearing restores both
  matches; dashboard loads with Priya 79% / Leo 59%; no page errors.
  Screenshots: `/tmp/skillswap-v2-shots-header/` (`01-student-desktop`,
  `03-student-mobile`, `10-student-desktop-loaded`,
  `12-student-mobile-loaded`).
- **Admin console header — code-verified unchanged, live screenshot not
  taken in this round:** the user changed the admin password via Change
  Password (as instructed after the Neon shift), so `admin/demo1234`
  now correctly returns 400 "Invalid credentials" and the test login
  cannot enter the console without the user's new password (never asked
  for). The `git diff` proves the admin header JSX is untouched, and the
  parent's post-deploy live check covers the admin console visually.

## Dark premium navbar (2026-11-10, user feedback)

The user rejected the previous (light) header redesign as a minor change and
chose "Dark premium navbar banao". **Only the student navbar changed; the
admin header/console is byte-identical** (`git diff` confirms: admin branch
JSX, admin header classes, and the admin STAFF badge are untouched; the new
dark styling renders only when `!isAdminView`).

What changed (`frontend/src/App.tsx` header block only):

- **Full dark gradient bar** — the plain white bar is gone. Navbar is now a
  rich `indigo-950 → #1b1740 → violet-950` gradient with a soft violet glow
  wash (radial, top-left) + a sky glow (top-right) and a deep indigo drop
  shadow, so it reads as a bold brand bar at first glance.
- **Glowing logo** — `LogoMark` keeps its indigo→violet gradient but now
  carries a violet glow (`shadow-[0_0_22px_rgba(167,139,250,0.55)]`, stronger
  on hover) and a violet ring.
- **White brand text** — "Skill Swap" in white, "Platform" in a
  violet-300 → sky-300 gradient, "WITH AI MATCHING" eyebrow in violet-300.
  No dark text on the bar anywhere, so readability is high.
- **Bright hairline** — the bottom edge now carries a brighter
  violet-400 → fuchsia-400 → sky-400 line (was indigo/violet/sky on white).
- **Dark search pill** — translucent white/10 fill, white/15 border, white
  text, indigo-200/60 placeholder, violet focus ring. Same value / `onChange`
  / handler — filtering behaviour unchanged.
- **Dark user chip** — translucent white/10 pill, white name, amber-300
  `★ {trust_score}` pill and violet-300 `✓` verified mark, all readable on
  the dark bar.
- **Admin stays clearly distinct** — admin is black slate-950 + emerald/teal
  + shield + "Admin Console" label; student is indigo/violet gradient +
  swap-arrows logo + no emerald anywhere. The rest of the student app
  (dashboard body, cards, sidebar) stays LIGHT — only the navbar is dark,
  which is what makes it striking.

### Verification (dark navbar round, coordinator, 2026-11-10)

- `npm run build` passes (strict TS + Vite), built with
  `VITE_API_URL=https://skillswap-v2-backend.onrender.com/api`.
- Visual verification: Playwright (`/tmp/verify_darknav.py`) against the
  production build served locally with `VITE_API_URL` pointing at the live
  Render backend (same test harness as the header round: loopback `socat`
  relay + `--disable-web-security`, test-only). **Student navbar PASSED**:
  desktop screenshot shows the dark gradient bar, glowing logo, white brand
  text, dark search pill and trust chip (`★ 100` + `✓` for maya);
  computed style confirms the gradient
  (`linear-gradient(to right, indigo-950, #1b1740, violet-950)`) and white
  brand text; 390px screenshot shows the wrapped two-row dark header with
  0px horizontal overflow; search "Python" filters to Leo only and clearing
  restores both matches; dashboard loads with Priya 79% / Leo 59%; no page
  errors. Screenshots: `/tmp/skillswap-v2-shots-darknav/`
  (`10-student-desktop-loaded`, `12-student-mobile-loaded`).
- **Admin console header — code-verified unchanged, live screenshot not
  taken in this round** (same reason as the header round: admin password is
  the user's own; never asked for). The `git diff` proves the admin header
  JSX is untouched, and the parent's post-deploy live check covers the
  admin console visually.

## Logo redesign (2026-11-10, user feedback)

User liked the dark premium navbar but ordered a prettier logo ("logo koi
pyara sa lgao"); everything else stays as-is for now. **Only the logo
changed** — `LogoMark` in `frontend/src/components/ui.tsx`, the
`.logo-mark` CSS in `frontend/src/styles.css`, plus a matching favicon
(`frontend/public/favicon.svg`, linked from `frontend/index.html`).
`App.tsx` (navbar, admin console, dashboard) is byte-identical.

- **New mark:** a full-round disc (old mark was a rounded square) with an
  indigo → violet → sky gradient, a white circular double-arrow loop inside
  (top arc flows right, bottom arc flows left, arrowheads at both ends —
  the "swap" in a circle) and a small white dot at the centre. The opaque
  disc reads cleanly on both the dark navbar and the light auth screen.
  Wordmark ("Skill Swap Platform") unchanged.
- **Verification (logo round, coordinator, 2026-11-10):** `npm run build`
  passes (strict TS + Vite), built with
  `VITE_API_URL=https://skillswap-v2-backend.onrender.com/api`.
  Playwright (`/tmp/verify_logo3.py`) against the production build served
  locally (same harness: loopback `socat` relay + `--disable-web-security`,
  test-only — the first two runs failed on a dead `127.0.0.1:3129` relay left
  over from cleanup, fixed by restarting it; the live backend login API
  itself was fine throughout). Screenshots inspected by the coordinator:
  desktop dark navbar + 390px navbar show the new circular loop mark with
  glow, login screen shows it on the hero panel; search "Python" filters
  to Leo only; dashboard loads Priya 79% / Leo 59%; 0px horizontal
  overflow at 390px; no page errors; `/favicon.svg` serves 200.
  Screenshots: `/tmp/skillswap-v2-shots-logo/`
  (`01-login-desktop`, `10-student-desktop-loaded-header`,
  `12-student-mobile-loaded-header`).

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
