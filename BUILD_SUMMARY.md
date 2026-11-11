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

## Logo swap — Option B, user-chosen (2026-11-10, user feedback)

User rejected the circular loop mark ("kya bkwas logo lgaya ha") and picked
**Option B** from three generated concepts: two abstract figures (violet +
sky) passing a glowing golden star between them. **Only the logo changed**
— `App.tsx` (navbar, admin console, dashboard) is byte-identical again.

- **New mark:** the chosen AI-generated tile, shipped as
  `frontend/public/logo.png` (512×512) and rendered by `LogoMark`
  (`frontend/src/components/ui.tsx`) as an `<img>` (44px navbar, 44px auth
  screens, `rounded-[22%]`). Favicon is the same mark as
  `frontend/public/favicon.png` (192×192, linked from
  `frontend/index.html`); the old `favicon.svg` was deleted.
- **White corners:** the source image has a white canvas outside its dark
  rounded square. Fixed in the file itself, not in CSS: PIL cropped the
  content and applied a rounded-rect alpha mask (radius measured from the
  image, ~190px at 1600px) so the PNG's corners are transparent. Automated
  check in the verify script reads the PNG's corner pixels — alpha 0 at all
  four corners, 255 at centre. The dark navbar shows no white corners.
  The three generated options live in `logo-options/` (not committed).
- **Verification (Option B round, coordinator, 2026-11-10):** `npm run
  build` passes (strict TS + Vite), built with
  `VITE_API_URL=https://skillswap-v2-backend.onrender.com/api`.
  Playwright (`/tmp/verify_logo_b.py`, `/tmp/verify_search_b2.py`)
  against the production build served locally on `:8471` (harness: loopback
  `socat` relay `:3129` → egress proxy, `--disable-web-security`
  test-only — the preview origin is not in the backend's CORS list, so
  without the flag the login API is blocked by the browser; the live site
  origin is allowed, so this is a test-only limitation). Two early failures
  were harness-only: Chromium cannot use the credential-embedded
  `HTTPS_PROXY` URL (tunnel fails) and the IPv6-only proxy hostname — the
  socat relay fixed both. Screenshots inspected by the coordinator: desktop
  dark navbar shows the Option B tile with glow and the user chip
  (★100 ✓), login screen shows it on the hero panel, 390px navbar shows
  it clean with 0px horizontal overflow; search "Python" filters to Leo
  only, clearing restores Priya; dashboard loads Priya 79% / Leo 59%; no
  page errors; `/logo.png` and `/favicon.png` serve 200. Screenshots:
  `/tmp/skillswap-v2-shots-logo-b/` (`01-login-desktop`,
  `10-student-desktop-loaded-header`, `12-student-mobile-loaded-header`,
  `13-header-loaded-trust`, `14-search-python`).

## Deliberately left out

- Nothing the SRS/SDD requires is missing. Out of scope for this build (not
  requested): production deployment (Render/Netlify wiring is for the parent
  to run — `backend/download_model.py --all` belongs in the build command),
  password-reset emails, and any payment/money features (explicitly excluded
  by the spec).

## Round 3 — rating visibility, new users in admin, find people by name (2026-11-11, user feedback)

The user ordered three edits by voice note + text (2026-11-11 ~12:33 PKT):
(1) a rating feature, (2) new users must show in the admin panel, (3) search
any user by name and show their ID — for students AND admin. **No new rating
model was invented:** the existing 1–5 star `IntegrityReview` (completed-
session partners only, one per session per author, trust recalculates as
`round(avg/5*100)`) is now surfaced everywhere. Matcher, threshold,
branding, navbar, logo and admin theme are untouched.

### 1. Rating, visible and easy
- **Backend:** `ProfileSerializer` now exposes `average_rating` (one-decimal
  average of received reviews, `null` when unrated) and `review_count`
  (`serializers.py: rating_stats_for()` + a per-profile cache so the two
  fields share one aggregate query). It flows to matches, community,
  profile detail AND the admin users list (which serializes through it).
- **UI:** new `RatingStars` component (`ui.tsx`) — `★★★★☆ 4.0 (1)` pill,
  or a muted "No ratings yet" pill when unrated; average always shown with
  one decimal (`toFixed(1)` — JS renders `4.0` as `4` otherwise).
  Shown on match cards, community cards, directory cards, the profile
  modal header (next to the trust badge) and the modal's Reviews heading
  ("★ 4.0 average").
- **Rate action:** completed sessions in ChatHub's "My sessions" now have a
  **"★ Rate {first name}"** button that jumps to the Feedback Hub with that
  session pre-selected (`preselectSessionId` prop on `FeedbackHub`). After a
  successful submit the partner leaves the rateable list ("All caught up —
  one review per session"); the server still enforces the rules (0/6 stars
  → 400, duplicate → 400, non-completed session → 400).

### 2. New users show in the admin panel
- **Root cause:** the backend already returned ALL users
  (`admin_users` ordered by username, no filter). The frontend loaded the
  list once at panel mount, so a user who signed up while the panel was
  open never appeared until a manual Refresh. Fix (`AdminPanel.tsx`):
  the users list (and the stats, so "Total users" can't disagree with the
  Users tab count) is re-fetched **every time the Users view opens**,
  plus the existing manual Refresh button.
- **Also added:** an **ID** column (numeric user id), a **Joined** column
  (date_joined), and a **"New" badge** for accounts created in the last 7
  days. The user-detail view header now reads `ID {id} · @{username} ·
  {email}`.

### 3. Find people by name + show the ID (students and admin)
- **Backend:** new `GET /api/users/search/?q=` (`views.search_users`,
  JWT auth) — first/last name or username `icontains`, min 2 chars (400
  below), excludes the caller and staff accounts, capped at 20, returns
  full `ProfileSerializer` payloads (id, username, display name, location,
  teach/learn skills, trust score, average rating). 401 unauthenticated.
- **Student app:** the navbar search already existed but only filtered the
  matches/community lists loaded at login — a friend who signed up later
  (or with no skill overlap) was unfindable there. `Dashboard.tsx` now
  runs a debounced (300 ms) live directory search whenever the navbar query
  has ≥2 characters and renders a **"Find people"** section (count badge,
  compact cards with `ID {id} · @{username}`, location, skills, rating,
  Message + View profile). Results open `ProfileModal` with the score
  hidden (`hideScore`) and the ID shown; `ProfileModal`'s profile type was
  widened to accept plain profiles (match fields optional).
- **Admin side:** the users table and user-detail view show the numeric ID
  (above); the existing admin `?q=` search is unchanged.

### Verification (round 3, coordinator, 2026-11-11)

- Backend: `manage.py check` clean; fresh-DB migrate + `seed_demo` clean.
  API smoke script (`~/workspace/.scratch-skillswap-r3/verify-r3.py`,
  local Daphne :8000): **34/35 passed** — the 1 "failure" is the test's
  own wrong expectation (it looked for Sana in matches; she scores 24%
  for Maya, so she is in community — verified directly: community Sana
  `(24, 5.0, 1)`). Covered: rating fields on matches/community/profile/
  admin payloads; search finds Leo (case-insensitive), community member
  Jonah, and just-signed-up Zara immediately; search excludes self and
  staff; 1-char → 400; unauthenticated → 401; admin list has all seeded
  users + Zara with `date_joined`; non-admin → 403 on admin endpoints;
  complete maya↔leo session → 4★ review → Leo avg 4.0, count 1, trust 80;
  duplicate → 400; 0/6 stars → 400; review on PENDING → 400.
- Frontend: `npm run build` passes (strict TS + Vite).
- Visual verification: Playwright
  (`~/workspace/.scratch-skillswap-r3/visual-r3.py`, vite preview :4173 +
  local Daphne :8000, clean env, no proxy) — **26/26 passed** at desktop
  1280×800 AND 390px phone width: Leo card `★★★★☆ 4.0 (1)`, unrated card
  "No ratings yet", Find people finds Leo (`ID 3 · @leo`) and just-signed-
  up Zara, profile modal shows `ID 3 · @leo` + `★ 4.0 average`, Rate
  button pre-selects Leo in Feedback Hub, Priya 5★ submit shows the trust
  update, admin list shows Zara with New badge + ID + Joined, Omar (signed
  up mid-test) appears after a tab re-open with New badge, admin detail
  shows Omar's ID, 0px horizontal overflow at 390px, no page errors
  anywhere. Screenshots:
  `~/workspace/.scratch-skillswap-r3/shots-r3/` (`01`–`12`).
- Two test-harness notes (not app bugs): the service restart mid-round
  wiped `/tmp` (scripts + Playwright venv + Daphne log gone) — round-3
  working files now live in `~/workspace/.scratch-skillswap-r3/` which
  survives restarts; and Django's SQLite AUTOINCREMENT never reuses a
  deleted id, so test users' ids (Zara 10, Omar 11) are resolved live in
  the scripts, never hardcoded.
- **Rating submit, re-verified explicitly (user clarification 2026-11-11
  12:19 PKT, "rating hum dy b saken ye b ensure krna"):** the submit
  flow works end-to-end, not just the display. API (verify-r3.py,
  re-run after a fresh seed): complete a session → POST a 4★ review →
  target avg 4.0, count 1, trust 80; duplicate review for the same
  session → 400; 0 stars → 400; 6 stars → 400; review on a PENDING
  session → 400. UI (visual-r3.py, re-run 26/26): the ★ Rate button on
  a completed session opens the Feedback Hub with that partner
  pre-selected, the star picker + optional text submits, and the trust
  update shows immediately. Both re-runs passed after a clean seed.
- **Not verified live:** the parent must live-verify the student side as
  maya/demo1234 on https://skillswap-j5lg.onrender.com (Find people,
  ratings, Rate button) and the admin side with the user's own admin
  password (new-user list, ID/Joined/New). The live admin password is the
  user's own and unknown here, so admin flows were verified locally only
  with the seeded admin account.

## Round 3b — in-app video call, document sharing, code sharing (2026-11-11, voice-note scope)

The user's friend's voice note added four more requirements, implemented
after round 3 landed (commit `35c536d`): (1) video call INSIDE the app,
(2) document/file sharing in chat, (3) code sharing in chat, (4) the
stay-in-app principle — no WhatsApp/external handoff anywhere. The admin
panel (item 5) was already mandatory and complete; no new admin work was
needed beyond showing attachments in the admin message view.

### 1. In-app video call (WebRTC, signaling over the existing Channels WS)
- **Backend (`swaps/consumers.py`):** the consumer now dispatches
  `call.*` frames alongside `chat.message`. Signaling only — no media
  touches the server. Flow: `call.invite` → `call.incoming` (with the
  caller's mini profile) → `call.accept`/`call.decline` →
  `call.offer`/`call.answer`/`call.ice` relayed between the two
  participants → `call.end`/`call.ended`. Invite to an offline user →
  `call.offline`; invite to self, unknown call, or a second concurrent
  call → `error`. One call per user at a time. A disconnect mid-call
  notifies the peer (`call.ended`, reason "peer disconnected").
  Presence (`ONLINE_USERS`) and call state (`ACTIVE_CALLS`) live in
  module-level dicts — correct for this deployment (one Daphne worker:
  Render free tier runs a single worker, and the channel layer is the
  in-memory one); documented in the consumer docstring as a
  multi-worker limitation (would need Redis).
- **Frontend (`src/call.ts` `CallManager` + `src/components/CallView.tsx`):**
  `RTCPeerConnection` with the public Google STUN server, `getUserMedia`
  (camera + mic), remote/local video, mute + camera toggles, ring (30s),
  incoming Accept/Decline, End. The overlay renders at App level so a
  call rings on any tab. Call buttons: chat header ("📹 Video call",
  disabled while the socket is down) and the profile modal. If the peer
  connection never reaches `connected` (e.g. a network that blocks the
  UDP WebRTC needs), a 20s timeout fails loudly ("Connection failed —
  check your network and try again.") instead of hanging on
  "Connecting…". Remote autoplay falls back to muted + a "Tap to
  unmute" button when the browser blocks autoplay with sound.
- **Verification:** API/WS smoke (`verify-r3b.py`, in-process
  `WebsocketCommunicator` + live Daphne): invite → incoming, accept →
  accepted, offer/answer/ICE relayed, end relayed, offline invite →
  `call.offline`, self-invite → error, unknown type → error, invalid
  token → 4401 — all pass. Browser (visual-r3b.py, two pages, Chromium
  fake media): ringing → incoming → Accept → both sides reach
  `Connecting` (offer/answer exchanged), callee's remote stream object
  created, End closes the overlay on both sides, the 20s stuck-call
  timeout fires "Connection failed" and clears by itself — all pass.
  **NOT verified end-to-end:** the peer connection never reaches
  `connected` in this sandbox because the VM blocks ALL UDP sockets
  (`PermissionError` on a plain UDP bind; a pure-JS loopback PC pair
  also stays at connectionState `new` after 15s with 6/6 ICE
  candidates exchanged). Media therefore cannot be verified locally;
  it needs a live two-user test on real devices (phones/browsers on
  the open internet, where UDP works). See the audit section below.

### 2. Document sharing (file attachments in chat)
- **Backend:** new `ChatAttachment` model (migration `0002`,
  `OneToOneField` to `ChatMessage`, randomised uuid filename under
  `attachments/<year>/<month>/`, original name/size/content-type
  stored; `delete()` removes the stored file too, so admin message
  deletion cleans up). `POST /api/messages/upload/` (multipart:
  `recipient_id`, optional `body`, `file`): 10 MB cap, allowlist =
  images (jpg/jpeg/png/gif/webp), PDF, docs (doc/docx/txt/md/csv/xls/
  xlsx/ppt/pptx); anything else → 400. The message is broadcast over
  WS like any other message. Download: `GET /api/attachments/<id>/
  download/?t=<signed>` — the token binds the attachment id to one
  viewer for 1 hour (`django.core.signing`, salt
  `skillswap-attachment`); the view re-checks the viewer is a
  participant or staff, serves images inline (so `<img>` works) and
  other files as downloads, 410 when the file is gone. `/media/` is
  never exposed directly. **Ephemeral-disk note:** on Render's free
  tier the disk is wiped on deploy/restart, so an uploaded file
  survives only until then (same as the old SQLite data before Neon).
- **Frontend:** 📎 attach button in the chat composer (hidden file
  input, same allowlist in `accept=`), "Uploading…" state, errors
  shown inline. Images render as a preview (click opens full size);
  other files render as a download chip (name + size + Download).
  The conversation list shows `📎 {filename}` when the last message is
  a file. The admin user-detail recent-messages list shows the
  attachment name + size (moderation visibility).
- **Verification:** API smoke 23/23 (see below); browser: image upload
  renders in the sender's thread AND arrives live on the peer's side
  (visual-r3b.py). Validation: exe → 400, oversized → 400, tampered
  token → 403, non-participant token → 403.

### 3. Code sharing (code snippets in chat)
- **Backend:** `ChatMessage.code_language` (migration `0002`; allowlist
  of 16 languages + `other`, validated in both the REST `POST
  /api/messages/` and the WS `chat.message` handler; invalid → 400 /
  WS `error`). The payload carries `code_language` everywhere the
  message does (REST history, WS broadcast, admin detail).
- **Frontend:** `</>` button in the composer opens a code composer
  (language select + monospace textarea + "Send code"); the message
  renders as a dark monospace block with a `Code · {language}` header
  and a Copy button (clipboard, "Copied ✓" feedback).
- **Verification:** API smoke (REST + WS round-trip, invalid language
  → 400) and browser (visual-r3b.py: snippet renders as a code block
  on the sender's side and arrives live on the peer's side).

### 4. Stay-in-app principle
- No WhatsApp/external-contact button exists anywhere in the app
  (verified by grep: no `wa.me` / `whatsapp` references in the
  frontend or backend). Chat, calls, files, code and sessions all
  happen inside the application; the Message buttons already keep
  users in-app. This is a product principle, documented here so a
  future change doesn't quietly add an external handoff.

### Bug found + fixed while building 3b (duplicate chat messages)
- **Root cause:** `App.handleSent` sent every message TWICE — once
  via REST (the server saves the row AND broadcasts it live) and once
  over the WS (the consumer saved a SECOND row and broadcast that
  too). Probed live: one UI send created **2 DB rows** and showed
  **3 times** in the DOM (thread ×2 + list preview). Fix: REST is the
  single send path; the WS re-send was removed with an explanatory
  comment. Re-verified: one UI send = 1 DB row, shown once in the
  thread (visual-r3b.py, unique probe per run).

### Verification (round 3b, coordinator, 2026-11-11)
- Backend: `manage.py check` clean; migration `0002` applies cleanly
  on a fresh DB. API/WS smoke (`~/workspace/.scratch-skillswap-r3/
  verify-r3b.py`, live Daphne :8000 + in-process WS): **23/23 passed**
  — code message (REST + WS, invalid language → 400), PNG/PDF upload
  (201 + attachment payload), signed download (200 + exact bytes),
  exe → 400, oversized → 400, tampered token → 403, non-participant
  token → 403, REST POST creates exactly 1 row, full call-signaling
  sequence, offline/self/unknown/invalid-token cases. Two real bugs
  were found and fixed during this run: `attachment_upload_path`
  used `instance.created_at` (None before save — `TypeError`) and the
  WS 4401 test asserted the wrong thing (the close frame arrives as
  an output event after connect).
- Frontend: `npm run build` passes (strict TS + Vite; two TS
  narrowing errors fixed en route).
- Visual verification: Playwright
  (`~/workspace/.scratch-skillswap-r3/visual-r3b.py`, vite preview
  :4173 + local Daphne :8000, clean env, no proxy) — **22/22 passed**
  at desktop 1280×800 AND 390px phone width: single-row send,
  code block send + live delivery, image upload + live delivery,
  call ringing → incoming → Connecting, callee remote stream object,
  End closes both overlays, 20s stuck-call timeout, profile-modal
  Video call button, mobile composer (attach + code buttons, no
  overflow), no page errors anywhere. Screenshots:
  `~/workspace/.scratch-skillswap-r3/shots-r3b/` (`01`–`06`).
- **Not verified live:** the parent must live-verify on
  https://skillswap-j5lg.onrender.com as maya/demo1234 (video call
  button, file upload, code share) — and, critically, a real two-user
  video call on real devices, because the media path cannot be
  verified in this sandbox (UDP blocked; see §1 above).

## Round 3c — Back buttons, chat privacy filter (admin approval), world-country location, quality audit (2026-11-11, user feedback)

Requirements frozen 2026-11-11 13:33 PKT (user: "sab chezen note kr lo ab
ye bnao phir baki chezen bad me btao ga check kar k"). The full list of 14
is in `ROUND3-REQUIREMENTS.md`, committed with this round for the viva.

### 12. Back button on every sub-view
- ProfileModal gained a visible "← Back" button top-left
  (`aria-label="Back to dashboard"`). AdminUserDetail already had
  "← Back to users"; AuthScreen already had "← Back" (signup step 2 →
  step 1) and "← Back to student login" (admin login); ChatHub already
  had a mobile-only "← Back" in the conversation header (`md:hidden`,
  `aria-label="Back to conversations"`); desktop ChatHub is two-pane
  (list always visible, no drill-down). The admin console sidebar also
  has "← Back to student app". All verified in the UI at desktop +
  390px: Back returns to the previous view without logging out or
  losing state.

### 13. Chat privacy filter — admin approval (REPLACES the hard-block 400)
- Detection (`backend/swaps/message_filter.py`, new): `flag_reasons(body)`
  → `['phone']` and/or `['link']`. Phone: `+92` + ≥7 more digits, or any
  digit run of 10–15 digits allowing spaces/dashes/dots/parens. Link:
  `https?://`, `www.`, bare domain + TLD list. Unit cases 14/14
  (incl. "2 years experience", "session at 5pm", "Rs 5000",
  "Rs 1,000,000 per year", "2026-11-11" all PASS; Pakistani mobile,
  +92, youtube.com, bit.ly, www.example.com all flagged). Documented
  trade-off: a bare 10+ digit run (e.g. a Unix timestamp literal in a
  code snippet) IS flagged as phone-like — it is indistinguishable
  from a phone number.
- Model: `ChatMessage.moderation_status` (PENDING/APPROVED/REJECTED,
  default APPROVED) + `flag_reason` — migration `0003`. Normal messages
  flow instantly exactly as before.
- REST `POST /api/messages/` + `POST /api/messages/upload/` (body
  caption): flagged → saved PENDING, broadcast to sender ONLY; normal
  → broadcast to both. `GET /api/messages/?peer=` history: pending /
  rejected visible only to sender; mark-as-read only on approved.
  `GET /api/conversations/`: incoming pending/rejected create no
  preview (preview shows "⏳ Waiting for admin approval" / "🚫 Message
  not approved" for the sender's own held messages); unread counts
  only approved messages.
- WS `consumers.py` `_handle_chat_message` + `_save_message`: same
  filter; flagged → PENDING + echo to sender only. Payloads carry
  `moderation_status` + `flag_reason`.
- Admin endpoints (all `IsAdminUser`): `GET /api/admin/message-approvals/`
  (pending list, oldest first), `POST /api/admin/message-approvals/<id>/approve/`
  (→ APPROVED + broadcast to BOTH sides), `POST /api/admin/message-approvals/<id>/reject/`
  (→ REJECTED + broadcast to sender only). Non-admin → 403.
- Frontend: `ChatMessage` type gains `moderation_status` + `flag_reason`;
  `ChatMessageBody` renders "⏳ Waiting for admin approval — it will be
  shared only if the admin approves it." / "🚫 Not approved by the admin
  — this message was not delivered."; App `onMessage` + `handleSent`
  now REPLACE in place by message id (so an approval broadcast with the
  same id flips the sender's bubble from "waiting" to normal instead of
  being dropped as a duplicate); AdminPanel new **"Approvals (N)"** tab
  (4th tab) with sender → recipient, body, "FLAGGED: PHONE/LINK" badge,
  timestamp, Message #, Approve/Reject buttons + notice;
  `api.getMessageApprovals/approveMessage/rejectMessage`. No client-side
  regex duplication — the server response drives the waiting state.
- Bug found + fixed during visual verification (Approvals tab
  staleness): the queue was only re-fetched when the tab opened, so a
  newly held message never appeared while the admin sat on the tab.
  Fix: Refresh button on the Approvals section (mirroring Users) + 20s
  auto-poll while the tab is open.

### 14. Location — all world countries
- `Profile.country` (CharField max 100, blank, default "") + `location`
  stays the city/area free text — migration `0004`. `ProfileSerializer`
  + `ProfileUpdateSerializer` + signup accept `country`; admin payload
  gets it automatically via `ProfileSerializer`.
- Frontend `src/countries.ts`: static ISO 3166 list (~195 + Taiwan /
  Kosovo / Puerto Rico, no external API). `formatLocation(p)` helper
  (`"City, Country"`, either part may be missing) used on match cards,
  community cards, DirectoryCard, ProfileModal, AdminPanel users table,
  AdminUserDetail header. Signup step 1: country `<select>` + city
  input (both optional); ProfilePanel: country select + city input
  (replacing the single location input). Dashboard `matchesQuery`
  haystack now includes `p.country`. Backward compatible: existing demo
  users have city-only `location` + empty `country` (verified via API +
  UI). **+5 same-city bonus UNCHANGED** (compares `location` only);
  matching works regardless of country. Verified: signup with United
  States + New York → profile saves/shows "New York, United States",
  directory search finds them, admin list shows them.

### Bugs found + fixed during round 3c visual verification
- **ProfilePanel stale initial state:** the dashboard heading renders
  before `loadAll` finishes, so the panel could mount with
  `profile=null` and its `useState` initializers captured empty
  country/city forever (a pre-existing pattern affecting all profile
  fields). Fix: `useEffect` in ProfilePanel re-syncs all form fields
  whenever the `profile`/`user` prop lands (after a save, `onSaved`
  updates the same prop to the saved values, so it resets to what was
  saved).
- **Match cards stale after review submit:** after submitting a review,
  the dashboard cards kept showing the old rating until reload. Fix:
  `FeedbackHub` gains `onReviewed` prop; App's new `refreshMatches`
  (re-fetch `/matches/` + `/community/`) is passed as `onReviewed`, so
  the new stars show immediately.

### Verification (round 3c, coordinator, 2026-11-11)
- Backend: `manage.py check` clean; migrations `0003` + `0004` apply
  cleanly on a fresh DB. API/WS smoke
  (`~/workspace/.scratch-skillswap-r3/verify-r3c.py`, live Daphne :8000
  + in-process WS): **45/45 passed** (35 REST + 10 WS): filter units;
  number → 201 pending/phone, recipient doesn't see it (history +
  conversations preview), sender sees pending, admin queue lists it,
  non-admin 403, approve → recipient sees it approved; link → pending,
  reject → never delivered, sender sees rejected; ordinary numbers pass
  instantly; file upload with flagged caption held then approved; WS
  flagged number → sender echo only, in-process admin approve →
  recipient receives it + sender bubble flips (same id), WS link →
  reject, WS normal message instant. Regression re-runs on a fresh
  seed: verify-r3.py 34/35 (the 1 failure is the known round-3 harness
  artifact — Sana in matches), verify-r3b.py 23/23.
- Frontend: `npm run build` passes (strict TS + Vite).
- Visual verification: Playwright
  (`~/workspace/.scratch-skillswap-r3/visual-r3c.py`, vite preview
  :4173 + local Daphne :8000) — **28/28 passed** desktop 1280×800 +
  390px: all four Back buttons, moderation flow end-to-end in the UI
  (admin approves/rejects via the Approvals tab), rating submit via
  Rate button, location signup UI, directory + admin display, 0px
  overflow at 390px, zero page errors. Screenshots:
  `~/workspace/.scratch-skillswap-r3/shots-r3c/` (`01`–`11`).

## Round 3d — fix round (2026-11-11, from the parent's live check 14:25–14:28 PKT)
Two real issues found live on round 3c, fixed here; one investigated.

### Issue 1 — Rate button still offered for already-reviewed sessions
The Feedback Hub correctly hid reviewed partners (server-seeded list), but
the Chat & Scheduler Hub "My sessions" list showed "★ Rate Sana" on
completed sessions maya had already reviewed. Fix: `ChatHub.tsx` now
seeds the same list (`GET /api/reviews/?author=me`) on mount and whenever
the sessions list changes, and hides the Rate button for reviewed session
ids. The server still rejects a duplicate review with 400 as a backstop.

### Issue 2 — No Back button in the chat view (desktop)
The conversation header's "← Back" was `md:hidden` (mobile only), so the
live desktop check found no way back except the left navigation. Fix:
the button now shows at ALL widths; it deselects the peer and returns to
the conversations list / "Pick a conversation" empty state.

### Issue 3 — investigated: video-call button disabled, pill "Offline"
Root cause found in `ChatSocket` (`api.ts`): reconnects were capped at 5
retries (~30s total) and reused the token captured at connect time.
Two ways that strands the socket offline: (a) a cold free-tier backend
takes ~30–60s to wake — longer than the 5-retry window; (b) the access
token lives 60 min, so a drop after an hour retried on a dead token
(server closes 4401) and then gave up. Fix (small): retries are now
unbounded with backoff capped at 15s, and every attempt first refreshes
the access token (`refreshAccessToken`, exported wrapper around the
existing `tryRefresh`) and reconnects with the fresh token. The "Offline"
pill and the disabled call button are correct behaviour while the socket
is down; the socket now recovers on its own. A real two-user video call
is still NOT verified (known gap — needs a live two-device test).

### Verification (round 3d, coordinator, 2026-11-11)
- `npx tsc --noEmit` clean; `manage.py check` clean.
- Playwright (`~/workspace/.scratch-skillswap-r3/verify-r3d.py`, vite
  preview :4173 + local Daphne :8000) — **15/15 passed** as maya
  (demo1234), desktop 1280×800 + 390px: no "★ Rate Sana" in My sessions
  (completed Sana session still listed); Feedback Hub "All caught up";
  duplicate review via API still 400; Back button visible + working at
  both widths; socket Live → Offline while Daphne is down 40s → Live
  again after restart with NO reload; socket recovers Live with a
  corrupted access token (refresh path) and the user stays logged in;
  zero page errors. Screenshots: `~/workspace/.scratch-skillswap-r3/shots-r3d/`.
  (First run was 14/15: the Sana-list check ran before `loadAll()` had
  finished — the sessions list was still empty, not a product bug. The
  script now waits for a non-zero session count first.)

## Round 3e — fix round (2026-11-11, three user reports 14:41–14:47 PKT)

### Back button missing on BOTH sides (user: "back ka button dono trf nahi ha")
Audited every drill-down/sub-view at 1280×800 AND 390px, student +
admin. Already present and verified working: ProfileModal
("← Back to dashboard"), ChatHub conversation ("← Back to
conversations", fixed in 3d), AdminUserDetail ("← Back to users"),
desktop sidebar "← Back to student app", AuthScreen admin-login
("← Back to student login"), admin top-bar brand → dashboard.
**Gaps found and fixed:** (1) `CallView.tsx` had only "End call" — added
a "← Back" button in the call header (incoming → decline, else end call,
then back to the chat); (2) mobile admin had NO explicit Back (sidebar
hidden below `md`) — added a mobile-only "← Back to student app"
button at the top of the admin main area (`App.tsx`, `md:hidden`,
`aria-label="Back to student app"`). Admin tabs (users/sessions/
reviews/approvals) are flat lists with inline actions — no drill-in
except AdminUserDetail, so no Back needed there.

### Rating dead-end (user: "rating deny wala button b bas 2 profile par ha… already likh ata ha")
Root cause, two parts. (a) Maya's only completed-session partner was
Sana, already reviewed 5 stars, so there was NO rateable target anywhere
on the live site. Fix: `seed_demo.py` now adds a maya–Leo COMPLETED
session (date TODAY−7, "Python Automation for Video Editing", NO review
— deliberate). `update_or_create` keyed on (partners, date), so a
same-day re-seed finds it again; the admin password is untouched and no
live-user data is wiped. (b) The Rate button could flash for a reviewed
partner before the reviewed-list fetch resolved (`reviewedSessionIds`
started as `[]` in ChatHub, FeedbackHub and ProfileModal). Fix: all
three now treat the list as unknown until the fetch completes
(`null` / `reviewsLoaded`), hiding every Rate button and showing
"Loading your sessions…" in the hub until then; the Feedback Hub
pre-select is not consumed until the list is known. The ProfileModal
now also shows "★ Rate {name}" (new props `sessions`, `currentUserId`,
`onRateSession`; student side only, gated on `onRateSession` being
passed) when a completed unreviewed session with that user exists, and
the hub prefers an unreviewed session per partner when building the
list. Verified end-to-end as maya: "★ Rate Leo" on the session row and
in Leo's profile → submit 4 stars → Thank-you + Leo trust 100 → 80,
average 4.0 (1 review) via API → button gone everywhere, hub
"All caught up"; duplicate review via API still 400.

### Video call: screen share + working mute/camera-off (user report 14:44 PKT)
`call.ts`: `CallState.screenSharing` + `screenStream`, `toggleScreenShare()`
(`getDisplayMedia` video-only; `replaceTrack` on the video sender so the
remote side sees the screen; the screen track's `onended` and the stop
button both revert to the camera; mic audio is untouched so mute works
while sharing). `CallView.tsx`: "🖥 Share screen" / "⏹ Stop sharing"
button, "🖥 Sharing your screen" indicator, local preview shows the
screen stream while sharing, camera button disabled while sharing with
an explanatory title, "Camera off" overlay suppressed while sharing.
Mute/camera toggles already flipped `track.enabled` on the local stream
tracks (3b) — verified here: mute disables the audio track (label flips
to "🔇 Unmute"), camera-off disables the video track (label flips to
"📹 Camera on", "Camera off" overlay in the preview). Bonus finding:
calling an offline peer ends the call in ~2s with "{name} is offline
right now." (`call.offline` from the backend) — correct behaviour, not
a bug; the toggle tests use a second browser as Leo (online, not
answering) so the call stays ringing. **Still NOT verified: a real
two-user call** — remote screen-share rendering and remote mute/
camera-off reflection need a live two-device test (sandbox blocks UDP,
so the peer connection cannot reach "connected" here).

### Country list in the user panel (user report 14:47 PKT: "just 3 country")
Audit of EVERY country selector: signup (`#su-country`, AuthScreen) and
profile edit (`#pf-country`, ProfilePanel) both already map the shared
`COUNTRIES` list (`frontend/src/countries.ts`, 196 entries) — verified
by opening each dropdown and counting 197 options incl. the placeholder,
with Afghanistan, Pakistan, United Kingdom, United States and Zimbabwe
all present; saving Pakistan in the profile edit persists via API and
shows as "Lahore, Pakistan" in the admin users table. No hardcoded
short list exists anywhere in the code or in git history (the list was
added whole in 3c). The "3 countries" the user saw is most plausibly
the three demo locations on the live site (Lahore / Karachi / Islamabad
— city-only demo data, deliberately left as-is per the task) or a
stale cached bundle on their phone. **Correction to the 3d deploy
report:** the live site WAS running round 3d all along. The earlier
"deploy stuck" alarm was a hash-comparison mistake — my local build
used `VITE_API_URL=http://localhost:8000/api` while Render builds with
the onrender URL, so the hashes differed. Rebuilding 161597d with the
Render URL produces exactly the live bundle `index-_VDh77CI.js`. The
Render static deploy works and is fast; verify it the same way (build
with the Render URL, compare hashes) instead of comparing against a
localhost-URL build.

### Verification (round 3e, 2026-11-11)
- `npx tsc --noEmit` clean; `manage.py check` clean.
- Playwright (`~/workspace/.scratch-skillswap-r3/verify-r3e.py`, vite
  preview :4173 + local Daphne :8000) — **52/52 passed** as maya
  (demo1234) + a second browser as Leo (online, not answering) + local
  seeded admin, desktop 1280×800 + 390px: both country dropdowns 197
  options with the 5 spot countries; Pakistan save persists; all Back
  buttons on both sides at both widths (ProfileModal, ChatHub, CallView,
  AdminUserDetail, admin mobile + desktop, admin-login); Rate Leo
  present (session row + ProfileModal), submit 4★ → trust 80, gone
  everywhere after, duplicate 400; mute/camera track flips + labels +
  overlay; screen share start/stop + badge + camera-track restore;
  incoming call shows on Leo's side, Leo's side clears on end; zero
  page errors on every context. Screenshots:
  `~/workspace/.scratch-skillswap-r3/shots-r3e/`. (Two test-only races
  fixed along the way: the profile-save wait used `#pf-name`, which is
  'Maya Chen' from the login user object before the profile loads — the
  script now waits for the "Remove Python" skill chip; the mobile-admin
  wait used "Admin Panel" text, which resolves to the hidden desktop
  sidebar button on mobile — it now waits for the Users tab content.)

## Round 3f — fix round (2026-11-11, two issues from the parent's live re-check 15:16–15:18 PKT)

### Issue A — moderation false positive + chat input disabled (reported serious)
**Investigation — the filter did NOT flag the message.** Evidence, all
checked against the live site/API on 2026-11-11 ~15:20 PKT:
- `message_filter.flag_reasons()` returns `[]` for all four seeded
  maya↔leo texts and for the quoted text ("Hey Leo! I saw your Python
  skills…"); locked in as regression tests in
  `backend/swaps/tests.py` (seeded + ordinary texts clean; phone/link
  flagged; `manage.py test swaps` passes).
- Live API as maya showed all four seeded messages `approved` with
  empty `flag_reason`; the only non-approved message in the thread was
  the 14:26 verification test message ("my number is 0300 1234567"),
  correctly flagged `phone` and since REJECTED by the user in the admin
  queue. Two "ok" messages sent after it are APPROVED — clean messages
  send fine while a flagged one is pending/rejected.
- The strings "blocked by moderation" and "Chat is unavailable until
  your message is approved" exist nowhere in the repo, git history, or
  the live bundle — the re-check's wording was a paraphrase of the ⏳/🚫
  states. **The real defect was the conversation preview:** it showed
  the most recent message whatever its state, so one held/rejected
  message made the whole thread read "⏳ Waiting for admin approval" /
  "🚫 Message not approved" — the thread looked blocked even though
  every other message was fine and the composer never was disabled
  (no code path disables it on pending state).
**Fix:** `views.conversations()` now previews the last APPROVED message
and returns `pending_count` (own held messages); a held message is only
a small "⏳ N waiting for approval" badge (`api.ts` Conversation type +
`ChatHub.tsx` list). The held message's ⏳/🚫 note stays attached to
that one bubble only. No live data was touched: the rejected test
message stays as history (correct outcome); the fix only changes what
the preview shows, so the live thread now previews the last delivered
message again.

### Issue B — screen-share button invisible when camera/mic fail
Root cause: `call.ts` `startCall`/`acceptCall` called `cleanup()` when
`getUserMedia` threw, so the call ended instantly with "Could not
access your camera or microphone" and `CallView` rendered only the
ended notice — no control bar at all. All three control buttons were
also `disabled={!call.localStream}`.
**Fix:** `call.ts` — new `CallState.mediaError`; `attachLocalMedia`
now falls back video+audio → audio-only → no media and never kills
the call (invite/answer still go out); `toggleScreenShare` uses
`addTrack` when no camera video sender exists (tracked via
`screenSender`, removed on stop when there is no camera to revert
to); `toggleMute`/`toggleCamera` guard on actual track presence.
`CallView.tsx` — the control bar renders in every active state; Mute /
Camera disable only without their tracks, Share screen stays enabled
whenever the call is active (getDisplayMedia needs no camera/mic),
and the media failure shows as an amber banner instead of a dead end.

### Verification (round 3f, 2026-11-11)
- `manage.py test swaps` — 4 tests pass (filter regression cases).
- `npx tsc --noEmit` clean.
- Playwright + API (`~/workspace/.scratch-skillswap-r3/verify-r3f.py`,
  vite preview :4173 + local Daphne :8000, fresh seed) — **40/40
  passed**, desktop 1280×800 + 390px, zero page errors: preview stays
  the last approved body with a pending message present,
  `pending_count` 0→1→0 through hold/approve/reject; clean message
  sends (API + UI) while one is pending; recipient never sees pending;
  composer enabled on desktop + 390px; approve delivers to Leo, reject
  stays invisible; happy-path call (media, mute, share, stop, Back);
  no-media call stays ringing with banner, Share enabled, Mute/Camera
  disabled, share starts/stops via a stubbed getDisplayMedia (canvas
  stream) with no camera/mic. Screenshots:
  `~/workspace/.scratch-skillswap-r3/shots-r3f/`. (Two test-only fixes
  along the way: the approvals-queue check used POST on a GET-only
  endpoint; the 390px navigation used the hidden desktop sidebar —
  mobile uses the bottom nav "Chat" button. One run also caught a stale
  vite preview serving the pre-3f bundle — rebuilt and re-verified.)
- **Still NOT verified: a real two-user call** — remote screen-share
  rendering and remote mute/camera-off reflection need a live
  two-device test (sandbox blocks UDP). Screen share without camera/mic
  is verified only to the local badge/track level here.

## Round 4 — admin-panel features + console themes (2026-11-11, user-approved 15:31 PKT "Haan, missing wali add kar do" + theme direction 15:35 PKT "koi pyara sa combination ho professional wali look ho lekin user sy alg ho")

Six missing admin features, all inside the existing dark admin console, staff-only (`IsAdminUser`):

1. **Reports / complaints** — students report another user from their profile (`⚑ Report` button in `ProfileModal.tsx`; reason bad behaviour / fake skills / spam / other + free text, `POST /api/reports/`). Admin Reports queue (`GET /api/admin/reports/?status=`, `POST /api/admin/reports/<id>/resolve/`) shows reporter, reported user, reason, text, time, status; resolve = dismiss / warn (note) / deactivate the reported user. Stored in DB (`UserReport`). Verified end-to-end: warn resolves + stores, re-resolve 400, deactivate path (throwaway user → reported → deactivated → login 400, shows Inactive), bad reason / self-report / unknown user 400/400/404.
2. **Skills management** — `SkillCatalog` model (name unique, group, `is_active`); migration `0006` seeds the existing 36 skills in the same 5 groups/order. Admin adds / renames / removes (`GET|POST /api/admin/skills/`, `PUT|DELETE /api/admin/skills/<id>/`); remove is soft (picker hides it, existing USER_SKILL rows kept); re-adding a removed name reactivates the same row. The SkillPicker at signup and profile edit reads `GET /api/skills/` (public) and falls back to the hardcoded list only if the request fails. Verified: add → catalog 36→37, duplicate 400, rename shows in the public catalog, remove hides it, re-add reactivates the same id, picker shows an admin-added skill live ("Zither").
3. **Analytics** — `GET /api/admin/analytics/` (staff-only): new users per week (12 weeks) + per month (6 months), sessions by status per week, matches made (= sessions created), completion rate. No chart dependency — lightweight div-based bar/grouped-bar charts in `AdminAnalytics.tsx` using the theme accent + semantic status colors. Verified: shape, weekly signups sum to total users, totals match `/admin/stats/`, completion rate consistent.
4. **Announcements** — admin composes title + text + optional expiry (`GET|POST /api/admin/announcements/`, `DELETE /api/admin/announcements/<id>/`); students see active, unexpired ones as a dismissible banner (`AnnouncementsBanner.tsx`, student views only, dismissals in localStorage per announcement id). Verified: student list empty → create → student sees → delete → gone; banner shows + dismisses in the UI; create from the admin UI.
5. **Audit log** — `AuditLog` model (admin, action, target type/id/label, detail, time). A single middleware (`swaps/audit_middleware.py`, registered after `AuthenticationMiddleware`) writes one row per successful mutating `/api/admin/*` request by a staff user — it covers the new round-4 actions AND the pre-round-4 ones (activate/deactivate, password reset, trust override, verified toggle, session cancel, review/message delete, message approve/reject). GETs, failures and non-staff requests are never logged; the middleware never raises. Admin views it at `GET /api/admin/audit-log/?action=&q=` (filterable by action / admin / target / detail). Verified: exactly one row per action (count before/after a single add grows by +1 — no duplicates), filters work, student 403, verified-toggle + session-cancel rows appear. Known limit: entries exist only from this deploy onward — earlier admin actions were never recorded (no backfill).
6. **Data export** — staff-only CSV endpoints `GET /api/admin/export/{users,sessions,reviews}.csv` (real `HttpResponse`, `text/csv`, `Content-Disposition: attachment`). The admin Export tab downloads them via `api.downloadAdminCsv` (browser download, no server storage). Verified: headers + rows (users export contains maya), student 403, a real file downloads from the UI.

**Admin console themes (user direction 15:35 PKT)** — the console stays DARK in all variants (clearly distinct from the light student app) with three switchable professional combinations, implemented as CSS custom properties on `[data-admin-theme]` (set on the app shell in admin view + the admin login page) + a theme switcher in the Admin Panel header (persisted in localStorage `skillswap-admin-theme`):
- **A — Midnight Gold (default, strongest):** deep midnight-navy canvas `#0A1128`, warm gold accent. Live by default.
- **B — Emerald Noir:** deep green-charcoal canvas, emerald accent (polished version of the original green console).
- **C — Graphite Copper:** warm graphite canvas, copper accent.
STAFF/admin identity markers are identical in all three (dark canvas, "Staff Only" eyebrow, STAFF badge, dark admin login page); the header shield + subtitle follow the theme accent. The user picks one in a single tap in the console — no single take-it-or-leave-it theme. Screenshots (local admin console, desktop 1280×800 + 390px): `~/workspace/skillswap-v2/admin-theme-options/theme-{gold,emerald,copper}.png` (+ `theme-gold-390px.png`).

### Verification (round 4, 2026-11-11)
- `manage.py check` clean; `npx tsc --noEmit` clean; `vite build` clean (Render URL).
- Playwright + API (`~/workspace/.scratch-skillswap-r3/verify-r4.py`, vite preview :4173 + local Daphne :8000, fresh seed) — **86/86 passed**, desktop 1280×800 + 390px, zero page errors: all API checks above; student banner show/dismiss; profile-modal report submit; SkillPicker live catalog; admin theme switch (all 3, persists across reload, back to default), all 10 admin tabs render, report resolve / announcement create / CSV download from the UI; no horizontal overflow at 390px. (Two test-only fixes along the way: the reload-persistence check forgot the active tab resets to the dashboard on reload; the `text=resolved` wait matched the invisible `<option>Resolved only</option>` — now waits on the `[role='status']` notice. One real test-expectation fix: re-adding a skill reactivates by its stored name — after a rename, the stored name is the renamed one.)
- Theme screenshots visually checked: all three read as distinct, professional dark consoles; the gold default has a coherent gold shield/subtitle/tab/highlights.

## Mobile profile menu (2026-11-11, user report 18:27 PKT: "mobile par open kar k dekha ha to wahn profile icon sy log out setting wgera ka b option nahi ha")

Cause: the header avatar was a plain `div` (student) / fragment (admin) — not a button, no menu. The only Log out button lived in the desktop sidebar user card, hidden below the `md` breakpoint, so phones had no way to log out or reach Settings. Fix (`App.tsx`, `ProfilePanel.tsx`): the header chip is now a real `<button>` (`aria-haspopup="menu"`, `aria-expanded`, `aria-label="Account menu"`) that opens a tap menu on every width — Profile / Settings (opens the profile tab), Change Password (opens the profile tab and scrolls the `#change-password` card into view, focus on its heading), Log out (existing `handleLogout`), plus Back to student app in the admin view. Closes on outside tap/click, Escape, tab change, or after choosing an item; right-aligned, `w-56` capped to `max-w-[calc(100vw-1rem)]` so it never overflows at 390px. Desktop sidebar Log out untouched.

### Verification (profile menu, 2026-11-11)
- `npx tsc --noEmit` clean; `vite build` clean.
- Playwright (`~/workspace/.scratch-skillswap-r3/verify-profile-menu.py`, vite preview :4173 + local Daphne :8000, fresh seed) — **20/20 passed**, desktop 1280×800 + 390px + local seeded admin, zero page errors: chip is a button with `aria-haspopup`; menu opens with all three items; outside tap / Escape close it; Change Password scrolls the card into view with heading focused; Profile / Settings opens the profile tab; Log out signs out to the login screen (both widths); 390px menu fully inside the viewport; admin menu adds Back to student app and it returns to the dashboard. Screenshots: `~/workspace/.scratch-skillswap-r3/shots-profile-menu/`.

## Quality audit (round 3c, 2026-11-11) — traceability + clean-clone run

- `TRACEABILITY.md` (committed with this round): every SRS REQ-01–05 +
  non-functional requirement + SDD §4–§6 item mapped to implemented +
  verified, implemented with a documented deviation, or missing.
- **One genuine gap found and fixed in the audit (SRS REQ-01.4):** the
  admin could NOT toggle a user's profile validation badge — the badge
  existed in the model and was displayed, but no admin control could
  change it. Added `POST /api/admin/users/<id>/toggle-verified/`
  (`IsAdminUser`) + a "Mark as verified / Remove verification ✓"
  button in `AdminUserDetail.tsx` ("Fix an issue" section). Verified:
  `~/workspace/.scratch-skillswap-r3/audit-r3c.py` **7/7 passed**
  (toggle flips + restores, non-admin → 403, unknown user → 404,
  cascade delete purges a deleted user's skill rows and messages).
- **Clean-clone run:** fresh `git clone` of
  `https://github.com/ranaarslang/SkillSwap-AI-Matching` → README
  followed exactly (venv, pip install, `download_model.py --all`,
  migrate, seed_demo, daphne :8000, `npm install`, `npm run dev`
  :5173) → Playwright click-through of every feature (see
  `~/workspace/.scratch-skillswap-r3/visual-clean-clone.py`) with zero
  page/console errors at desktop 1280×800 and 390px.
  - The first clean-clone pass (39/43) caught **one more real gap
    (REQ-05.1)**: the Feedback Hub hid already-reviewed partners only
    from in-visit state, so after navigating away and back it re-listed
    them and the submit then failed with a 400. Fixed in the same round:
    `GET /api/reviews/?author=me` (new filter) + the hub seeds its
    reviewed-session list from the server on mount
    (`api.getMyReviews()`).
  - That fix exposed a **second latent bug in the same hub**: the
    "Thank you" confirmation banner lived INSIDE the review form, and a
    successful submit makes the partner un-rateable, so the form
    unmounts and flips to "All caught up" — the user never saw the
    trust update (the review itself saved fine; the confirmation was
    lost). Fixed by moving the banner outside the form/empty-state
    ternary so it survives the flip.
  - The remaining 3 failures in that first pass were test races (the
    dashboard heading renders before `loadAll` finishes; the panel
    mounts before the profile lands) — the app already showed the
    values a few seconds later, verified by a dedicated probe
    (`probe-clean-clone.py`). The re-run after both fixes passed
    **43/43**.
- **README updated in this round:** the "What each feature does"
  section now covers the admin panel, video call, file/code sharing,
  Find people, rating visibility, Message Approvals, country location
  and Back buttons, and documents the seeded admin login.
- **Open gaps (see TRACEABILITY.md §7):** a real two-user video call is
  not verified end-to-end (sandbox blocks UDP — remote screen-share
  rendering and remote mute/camera-off reflection need a live two-device
  test; local track toggles + screen-share start/stop + replaceTrack
  wiring ARE verified in round 3e, single-browser with fake devices); latency targets unmeasured (500 ms matching / 100 ms
  message); browser coverage is Chromium only; W3C markup not
  validator-checked; Render free-tier limits (backend sleeps after
  idle, uploaded files live on ephemeral disk); match scores jitter
  ±1 between server starts (ONNX floating-point nondeterminism;
  invariants always hold).
  (Closed in round 3d: WS reconnect IS now exercised by actually
  dropping the socket — 40s outage + corrupted-token recovery, both
  back to Live with no reload.)
- **Deviations confirmed in the audit:** SDD §5 "AI Computation Layer"
  as an isolated microservice → in-process ONNX matcher (torch cannot
  run on the 512 MB free tier); SDD §6.3.1 comma-separated skill text
  boxes → SkillPicker catalog + free text; SDD §6.3.4 feedback submit
  returning focus to the profile panel → stays on the Feedback Hub
  with "Thank you" + "All caught up"; SDD UC2 session confirmation as
  an embedded panel in the chat log → inline message in the scheduler
  panel; REQ-03.1 per-pair rooms → per-user WS groups (same isolation).

## Files

- [README.md](sandbox://workspace/skillswap-v2/README.md) — run instructions, demo logins, feature guide
- [backend/NOTES.md](sandbox://workspace/skillswap-v2/backend/NOTES.md) — backend endpoints, verification log
- [frontend/NOTES.md](sandbox://workspace/skillswap-v2/frontend/NOTES.md) — frontend pages, verification log
- [backend/swaps/matcher.py](sandbox://workspace/skillswap-v2/backend/swaps/matcher.py) — swappable matcher (ONNX + TF-IDF fallback)
- [backend/download_model.py](sandbox://workspace/skillswap-v2/backend/download_model.py) — one-time model download
- [backend/smoke_test.py](sandbox://workspace/skillswap-v2/backend/smoke_test.py) — 35 API + WS checks
- [backend/matcher_test.py](sandbox://workspace/skillswap-v2/backend/matcher_test.py) — embedding quality checks
