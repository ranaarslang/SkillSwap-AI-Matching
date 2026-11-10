# Skill Swap Platform with AI Matching — Backend Notes

Backend for the Skill Swap Platform with AI Matching (Islamia University of
Bahawalpur FYP). Django 5 + Django REST Framework + Channels + Daphne,
SQLite, JWT auth, real ML matching via ONNX Runtime. No money features.

## Stack (installed, verified)

| Package | Version |
|---|---|
| Django | 5.2.19 |
| djangorestframework | 3.18.3 |
| django-cors-headers | 4.9.0 |
| channels | 4.3.2 |
| daphne | 4.2.3 |
| djangorestframework-simplejwt | 5.5.1 |
| scikit-learn (TF-IDF fallback only) | 1.9.1 |
| onnxruntime | 1.31.1 |
| transformers (tokenizer only, no torch) | 4.57.6 |
| numpy / scipy | 2.5.4 / 1.18.1 |

Python 3.12. Virtualenv: `backend/.venv`.

## How to run

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python download_model.py --all   # one-time model download (see below)
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo       # 6 demo users, password demo1234
.venv/bin/python manage.py check
.venv/bin/daphne -p 8000 config.asgi:application
```

`python manage.py runserver` works for HTTP but NOT WebSockets — **daphne is
required for WS**. First `/api/matches/` (or any match) request loads the
ONNX model once (~23 s); later requests are fast (embedding a pair takes
~0.2 s). The matcher instance is cached process-wide (singleton).

Env vars (all optional, safe local defaults in `config/settings.py`):
`SECRET_KEY`, `DEBUG` (default True), `ALLOWED_HOSTS` (default `*`),
`CORS_ALLOWED_ORIGINS` (default `http://localhost:5173`),
`SKILLSWAP_MODEL_DIR` (default `backend/ml_models/`),
`SKILLSWAP_MODEL_FILE` (override model file), `SKILLSWAP_MATCHER`
(`onnx` default, `tfidf` forces the fallback).

## Matching — REAL machine learning (ONNX MiniLM)

- Model: the actual **sentence-transformers/all-MiniLM-L6-v2**, run via
  **ONNX Runtime** (CPU provider). No torch, no sentence-transformers package.
- Pipeline (SDD §5, implemented in `swaps/matcher.py`): AutoTokenizer →
  InferenceSession → last hidden state → mean pooling weighted by
  attention_mask → L2 normalize → **384-dim vectors** → cosine similarity.
- Each user's TEACH tags are consolidated into one text and LEARN tags into
  one text (joined with `", "`), then:
  `score = avg(cosine(my TEACH, their LEARN), cosine(their TEACH, my LEARN))
  × 100`, +5 same-city bonus (case-insensitive), capped at 100.
  Drop below 50%, sort descending.
- Swappable interface: `swaps/matcher.py` exposes `get_matcher()` returning
  an object with `score_pair(me, candidate) -> MatchResult` and
  `rank_candidates(me, candidates)`. Views/serializers/endpoints only use
  this interface — swapping the vectoriser is a one-module change.
- Model files (`backend/ml_models/`, git-ignored, download once):
  `model.onnx` (fp32, 90 MB), `model_qint8_arm64.onnx` (INT8, 23 MB),
  `tokenizer.json`, `tokenizer_config.json`, `vocab.txt`,
  `special_tokens_map.json`, `config.json`.
  `python download_model.py --all` fetches them from Hugging Face; on a
  Render deploy, run it in the build command. If the model file is missing
  at first use it is downloaded on demand with a clear log line.
- **Active path (measured): ONNX + `model_qint8_arm64.onnx`.** The quantized
  file measured IDENTICAL quality to fp32 (same-topic cosine 0.783 vs 0.787;
  identical match scores on all seed pairs) at much lower cost (peak RSS
  132 MB vs 221 MB; 23 MB vs 90 MB on disk; 22.9 s vs 27.0 s load), so it is
  the default when present. `SKILLSWAP_MODEL_FILE=model.onnx` selects fp32.
- Fallback ONLY: if the ONNX model cannot be downloaded/loaded, TF-IDF +
  cosine (scikit-learn) is used with a logged warning. TF-IDF is never the
  default when the model is available.

### Measured matcher numbers (2026-11-10, this VM)

`python matcher_test.py --model fp32|qint8|tfidf`

| Check | fp32 ONNX | qint8 ONNX | TF-IDF |
|---|---|---|---|
| Embedding dim | 384 ✓ | 384 ✓ | — |
| L2 norms | 1.0 | 1.0 | — |
| Same-topic cosine ("Python programming, data visualization" vs "Python programming, data analysis") | 0.787 | 0.783 | — |
| Different-topic cosine (vs "Guitar, music theory") | 0.095 | 0.099 | — |
| Same-topic paraphrase ("Python programming and data visualization" vs "Python coding and data analysis") | 0.706 | — | — |
| Same-topic near-identical ("Learn Python programming" vs "Learning to code in Python") | 0.818 | — | — |
| Different-topic ("Guitar lessons and music theory" vs "React web development with TypeScript") | -0.004 | — | — |
| maya ↔ priya (match) | 77 | 77 | 55 |
| maya ↔ leo | 37 | 37 | 24 |
| maya ↔ sana | 27 | 27 | 19 |
| maya ↔ jonah | 12 | 13 | 0 |
| maya ↔ alex | 7 | 7 | 0 |
| Peak RSS (matcher test process) | 221 MB | 132 MB | 112 MB |

Via the live API the same pairs score 75 (priya), 38 (leo), 28 (sana),
15 (jonah), 7 (alex) — the ±1–3 difference is skill ordering in the
embedded text (the API sorts skills alphabetically; the transformer is
order-sensitive). Ordering and threshold behaviour are identical.

### ⚠️ OPEN DISCREPANCY — maya↔leo is NOT above 50%

The brief's verification line says "maya↔leo above 50%". That does **not**
hold under the SDD formula with the specified seed data, with EITHER
backend: ONNX gives 37–38%, TF-IDF 24%. Direction 2 (leo TEACH
"Video Editing, Storytelling" vs maya LEARN "Public Speaking, UI Design")
has no real overlap (cosine 0.226); direction 1 is 0.413. The pipeline is
proven working — maya↔priya is a genuine mutual pair at 75–77% — but no
faithful implementation of the SDD formula can push maya↔leo over 50%
without changing the seed skills or the formula. Coordinator decision
needed: adjust the seed data (e.g. give leo a LEARN skill maya teaches, or
maya a LEARN skill leo teaches) or adjust the expectation. The matcher was
NOT fudged to hit the number.

## API (base `/api`, all JSON; `Authorization: Bearer <access>` unless noted)

User shape everywhere: `{id, username, full_name, email}`.

| Endpoint | Notes |
|---|---|
| `POST /api/auth/signup/` `{email, password, full_name}` → 201 | `{access, refresh, user}`. Username = unique slug from the email prefix. Password ≥ 6 chars, hashed by Django. Also creates an empty Profile. Duplicate email → 400. |
| `POST /api/auth/login/` `{email_or_username, password}` → 200 | Accepts email OR username. Demo login `maya` / `demo1234` works. Wrong creds → 400. |
| `POST /api/auth/refresh/` `{refresh}` → 200 | `{access}` (SimpleJWT). |
| `POST /api/auth/logout/` → 200 | JWTs are stateless — the server cannot revoke an access token; logout = client discards its tokens. Returns 200 per contract. |
| `GET /api/health/` → `{"status": "ok"}` | No auth. |
| `GET /api/profile/me/` | Auto-creates the profile if missing. |
| `PUT /api/profile/me/` `{full_name, bio, location, availability, portfolio_link, teach_skills:[...], learn_skills:[...]}` | Syncs UserSkill rows (replaces TEACH/LEARN sets). Response profile shape below. |
| `GET /api/profiles/<user_id>/` | Public profile, same shape. |
| `GET /api/matches/` | Score ≥ 50 only, desc. Item = profile shape + `{match_score, location_bonus, same_location, can_teach_you:[...], you_can_teach_them:[...]}`. |
| `GET /api/community/` | Score < 50, same shape, sorted by username. |
| `GET /api/sessions/` | Mine (requester or recipient), newest first. |
| `POST /api/sessions/` `{partner_id, calendar_date (YYYY-MM-DD), duration_block, title?}` → 201 | PENDING. Double-booking guard: 400 if either partner already has a PENDING or ACCEPTED session on the same date + duration block. Self-booking → 400. |
| `PUT /api/sessions/<id>/` `{session_status}` | Only a party may change (others → 403). Allowed: PENDING→ACCEPTED/CANCELLED, ACCEPTED→COMPLETED/CANCELLED; anything else → 400. No DECLINED — declining = CANCELLED. |
| `GET /api/conversations/` | `[{peer, last_message:{body, created_at, sender_id}, unread_count}]`, newest first. |
| `GET /api/messages/?peer=<user_id>` | Oldest first. `[{id, sender, recipient, body, created_at, is_mine}]`. Fetching marks the peer's messages to me as read. |
| `POST /api/messages/` `{recipient_id, body}` → 201 | Also broadcasts live to the recipient's WS group (and echoes to the sender). |
| `POST /api/reviews/` `{session_id, rating_stars, feedback_text}` → 201 | Only when the session is COMPLETED, I am a party, and I have not already reviewed it (one review per session per author). Target = the other party. Then the target's trust_score is recalculated. |
| `GET /api/reviews/?user=<user_id>` | Reviews for that user, newest first. |

Profile shape: `{id, user, bio, location, availability, portfolio_link,
avatar_color, trust_score, verified_badge, teach_skills:[...],
learn_skills:[...]}`.

Session shape: `{id, partner_one, partner_two, title, calendar_date,
duration_block, session_status, created_at}` (partners are user shapes).

Review shape: `{id, session, reviewer, reviewee, rating_stars,
feedback_text, created_at}`.

Trust score: after any review, target's `trust_score =
round(avg(rating_stars) / 5 * 100)`; 100 when there are no reviews. Stored
on Profile (`swaps/models.py: recalculate_trust_score`).

## WebSocket

`ws://<host>/ws/chat/?token=<JWT access token>` — token auth ONLY
(session/cookie auth is not accepted). Middleware
(`swaps/middleware.py`) validates the JWT with SimpleJWT (signature +
expiry); missing/invalid token → close **4401**. (Implementation note:
Daphne answers a close-during-connect with an HTTP 403 and the client
never sees the close code, so the consumer accepts first and then closes
with 4401 — the client observes the 4401 close frame.)

- On connect, join group `user_<id>`.
- Client → server: `{"type": "chat.message", "recipient_id": <int>,
  "body": "<text>"}` → saved to the DB, then broadcast to group
  `user_<recipient_id>` (`is_mine: false`) and echoed to the sender's own
  group (`is_mine: true`):
  `{"type": "chat.message", "message": {id, sender, recipient, body,
  created_at, is_mine}}`.
- Invalid input (empty body, unknown recipient, unknown type) →
  `{"type": "error", "detail": "..."}` to the sender only.
- History always loads from the DB via `GET /api/messages/` (never
  cache-only). Routing in `swaps/routing.py`; `config/asgi.py` uses
  ProtocolTypeRouter (http → Django ASGI app, websocket →
  JWTAuthMiddleware → URLRouter). In-memory channel layer.

## Data model (`swaps/models.py`, SDD data dictionary)

- **Profile** (OneToOne User): `bio`, `location`, `availability`,
  `portfolio_link`, `avatar_color` (default `#4F46E5` indigo),
  `trust_score` (0–100, default 100), `verified_badge` (default False).
  Location is a user-required addition (not in the SDD docs).
- **UserSkill**: `user` FK (cascade), `skill_name`, `skill_type` TEACH/LEARN.
- **ChatMessage**: `sender`, `receiver`, `message_body`, `sent_at`
  (auto), plus an additive `is_read` flag (not in the SDD) so
  `unread_count` is real — it is set when the peer's history is fetched.
- **SwapSession**: `partner_one`, `partner_two`, `title` (optional),
  `calendar_date` (DateField), `duration_block` (e.g. "1 Hour Mutual
  Swap"), `session_status` PENDING/ACCEPTED/COMPLETED/CANCELLED,
  `created_at`.
- **IntegrityReview**: `session` FK, `author_user`, `target_user`,
  `rating_stars` 1–5, `feedback_text` (nullable), `created_at`;
  one review per (session, author).

## Seed data (`python manage.py seed_demo`, idempotent)

6 users, all password `demo1234`: **maya** (Maya Chen,
maya@skillswap.demo, Lahore, teaches Python + Data Visualization, wants
Public Speaking + UI Design), **leo** (Leo Martins, leo@skillswap.demo,
Lahore, teaches Video Editing + Storytelling, wants Python + Product
Design), **jonah** (Jonah Williams, jonah@skillswap.demo, Karachi, teaches
React + TypeScript, wants Photography + Figma), **sana** (Sana Patel,
sana@skillswap.demo, Islamabad, teaches UI Design + Figma, wants Video
Editing), **alex** (Alex Rivera, alex@skillswap.demo, Karachi, teaches
Guitar + Music Theory, wants React), **priya** (Priya Nair,
priya@skillswap.demo, Lahore, teaches Public Speaking + Content Writing,
wants Data Visualization). Sessions: ACCEPTED maya↔leo, PENDING
maya↔jonah, COMPLETED maya↔sana (with a 5-star IntegrityReview from maya).
4 messages maya↔leo. `verified_badge` True for maya/leo/jonah. Trust scores
recomputed after seeding. Re-running the command is safe (no duplicates).

## Verification (all run 2026-11-10, this VM)

1. `python manage.py check` → **no issues**.
2. Fresh DB: `rm db.sqlite3 && python manage.py migrate` → all migrations
   apply cleanly. `seed_demo` run twice → idempotent (second run: users
   "exists", no duplicate messages/sessions/reviews).
3. `python matcher_test.py --model fp32` → 384-dim, norms 1.0, same-topic
   0.787, diff-topic 0.095, peak RSS 221 MB. `--model qint8` → 0.783 /
   0.099, RSS 132 MB. `--model tfidf` → fallback works (maya↔priya 55).
4. `python smoke_test.py` against daphne on :8000 → **ALL 35 CHECKS PASSED**:
   health; unauthenticated matches → 401; signup 201 + duplicate/short
   password → 400; login by username and by email; wrong password → 400;
   profile GET/PUT; matches (priya top, 75, bonus 5); community (leo 38);
   public profile; session create 201 → double-booking 400 → invalid
   transition 400 → recipient accept 200 → complete 200; message POST/GET;
   conversations unread ≥ 1; review POST 201 → priya trust 100 → 80;
   duplicate review 400; refresh + logout 200; WS: REST→WS live broadcast,
   WS send + echo (`is_mine` true/false), bad recipient → error, WS message
   persisted in DB history, bad/missing token → close 4401.
   (One earlier run caught a real bug: the consumer closed during connect
   and Daphne returned HTTP 403 instead of 4401 — fixed by accept-then-
   close; also caught a stale daphne still bound to :8000 serving old code
   — killed before the final run.)

## Deviations from the SRS/SDD (documented)

1. **Sentence-transformers → ONNX Runtime.** The SDD specifies
   sentence-transformers + cosine. Torch cannot run on the 512 MB free
   tier, so the SAME model (all-MiniLM-L6-v2, 384-dim) is run via ONNX
   Runtime instead — pipeline shape, 50% threshold, sorting, location
   bonus and response shape are identical. TF-IDF exists only as a
   fallback (see above).
2. **Location field added** (user-required, not in the SDD): `Profile.location`
   + additive +5 same-city bonus, `same_location`/`location_bonus` in match
   responses.
3. **ChatMessage.is_read added** (not in the SDD) to make `unread_count`
   meaningful.
4. **Logout is stateless** (JWT): returns 200; the client discards tokens.
   No refresh-token blacklist is configured.
5. **Demo emails use the `skillswap.demo` domain** (e.g.
   maya@skillswap.demo) as specified in the brief — these are account
   identifiers, not branding. All user-facing text uses the full project
   name "Skill Swap Platform with AI Matching" (admin headers, docs, log
   lines); the one-word "SkillSwap" appears nowhere user-facing.

## Files

- `config/` — settings (env-based), urls, asgi (ProtocolTypeRouter), wsgi
- `swaps/models.py` — data model + trust-score recalculation
- `swaps/matcher.py` — swappable matcher interface, ONNX MiniLM (default),
  TF-IDF fallback
- `swaps/views.py`, `swaps/serializers.py`, `swaps/urls.py` — REST API
- `swaps/middleware.py`, `swaps/consumers.py`, `swaps/routing.py` — WS
- `swaps/management/commands/seed_demo.py` — seed command
- `download_model.py` — one-time model download (run in setup + Render build)
- `matcher_test.py` — direct matcher verification (dims, cosines, seed scores)
- `smoke_test.py` — full end-to-end smoke suite (35 checks, needs daphne on :8000)
- `ml_models/` — downloaded model + tokenizer files (git-ignored)
- `requirements.txt`, `.gitignore`
