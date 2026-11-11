# Traceability — Proposal / SRS v1.0 / SDD v1.0 → Implementation

**Project:** Skill Swap Platform with AI Matching (Islamia University of
Bahawalpur, FYP). **Checked:** 2026-11-11, round 3c audit, against the live
codebase on `main` (commit `2f416e6` + round-3c changes).

Status legend: ✅ implemented + verified · ⚠️ implemented with a documented
deviation · ❌ missing (fixed where feasible) · 🔍 not measured in this
environment.

## 1. Functional requirements (SRS §3.2)

| Req | Requirement | Status | Evidence |
|---|---|---|---|
| REQ-01.1 | Sign up with email + password; full-name profile fields | ✅ | `swaps/views.py:signup`, `AuthScreen.tsx` (2-step: account + skills). Verified: API + UI signup (round 3c visual run). |
| REQ-01.2 | Passwords stored salted + hashed, never plaintext | ✅ | Django `create_user` (PBKDF2 hashing). Verified: DB stores hashes; the live admin password persists on Neon Postgres. |
| REQ-01.3 | Free-form teach/learn skill fields, stored separately as TEACH / LEARN | ✅ | `SkillPicker` (36-skill catalog + free text), `USER_SKILL.skill_type` TEACH/LEARN. Verified: API + UI (signup requires ≥1 teach and ≥1 learn). |
| REQ-01.4 | Admin can toggle a profile validation badge so account credibility is clear | ✅ (fixed in round 3c audit) | **Was missing** — the badge was display-only. Added `POST /api/admin/users/<id>/toggle-verified/` (`IsAdminUser`) + a "Mark as verified / Remove verification ✓" button in `AdminUserDetail.tsx`. Verified in the clean-clone API pass. |
| REQ-02.1 | Group user text tags into continuous strings when a profile updates | ✅ | `matcher.py:_skills_text` joins TEACH/LEARN tags into one string per side; matching runs on profile data. |
| REQ-02.2 | 384-dim vectors from a sentence-transformer model | ✅ | Real `all-MiniLM-L6-v2` via ONNX Runtime (no torch), 384-dim. Verified live: same-topic cosine 0.881, different-topic 0.065. |
| REQ-02.3 | Cosine similarity between user vectors | ✅ | `matcher.py:score_pair` — cosine of TEACH↔LEARN and LEARN↔TEACH, averaged. |
| REQ-02.4 | 50% compatibility threshold | ✅ | `MATCH_THRESHOLD = 50`; candidates below 50% go to "Also in the community". Verified: Maya → Priya 79, Leo 59 (both ≥50); Sana 24, Alex 7 (community). |
| REQ-02.5 | Matches sorted descending by similarity | ✅ | `rank_candidates` sorts by `-score`. Verified: Priya 79 above Leo 59 on every check. |
| REQ-03.1 | Isolated, stateful connection rooms per pairing | ⚠️ | Per-user WebSocket groups (`user_<id>`) + per-call state (`ACTIVE_CALLS` by call id). Deviation: rooms are per-user groups, not per-pair rooms — the isolation guarantee is identical (a message is only delivered to its two participants). |
| REQ-03.2 | Instant message delivery without page reload | ✅ | WS broadcast (`chat.message`) + REST echo; verified live in rounds 3b/3c (two-browser delivery). |
| REQ-03.3 | Message rows show context labels for the active learning topic | ✅ | `ChatHub.tsx` renders "Trading: {skill}" in the conversation header. |
| REQ-03.4 | Persistent message history, reloadable after a connection drop | ✅ | `CHAT_MESSAGE` rows; `GET /api/messages/?peer=` reloads history on reconnect. Verified: history survives reload; WS auto-reconnect reloads it. |
| REQ-04.1 | Calendar date picker widget (day/month/year) | ✅ | `<input type="date">` (`#sched-date`) in the ChatHub scheduler. Verified in the UI. |
| REQ-04.2 | Duration-block selector | ✅ | `<select>` — "30 Minutes", "1 Hour Mutual Swap", "2 Hours". |
| REQ-04.3 | Booking creates a session record with status PENDING | ✅ | `POST /api/sessions/` → PENDING. Verified API + UI (round 3c visual run). |
| REQ-04.4 | Prevent conflicting calendar-slot confirmations | ✅ | Server-side double-booking → 400; verified in the API smoke suite. |
| REQ-05.1 | Review options limited to completed-session partners without a review | ✅ (fixed in round 3c audit) | `FeedbackHub` lists completed partners minus reviewed sessions ("All caught up" when done). **Was visit-only:** the reviewed list lived in component state, so after navigating away and back the hub re-listed already-reviewed partners (submit then failed with a 400). Fixed: `GET /api/reviews/?author=me` + the hub seeds its reviewed-session list from the server on mount. Verified in the clean-clone re-run (43/43). |
| REQ-05.2 | Interactive 1–5 star controls | ✅ | Star radio buttons in `FeedbackHub`; `RatingStars` display on cards and profiles. |
| REQ-05.3 | A 0-star review cannot be submitted | ✅ | Submit disabled at 0 stars (UI) + server 400 (API). Verified both paths. |
| REQ-05.4 | Review saves, comment is optional, trust score recalculates instantly | ✅ | `IntegrityReview` + `recalculate_trust_score` (round(avg/5×100)); dashboard cards refresh immediately after submit. Verified: 4★ → target avg 4.0, trust 80. |

## 2. Use cases (SRS §3.1)

| Use case | Status | Evidence |
|---|---|---|
| UC1 — new user creates a profile, system generates AI matches and ranks them; no matches ≥50% → "No matches found. Try updating your skill definitions." | ✅ | Exact empty-state text is rendered by `Dashboard.tsx`; match flow verified end-to-end. |
| UC2 — user connects with a match and books a session; postcondition: a PENDING session record is logged | ⚠️ | PENDING record is created and listed under "My sessions" (verified). Deviation: the confirmation appears as an inline message in the scheduler panel, not as an embedded panel inside the message thread as the SDD sketches. |
| UC3 — partner completes a session and gives 1–5 stars + comment; trust recalculates | ✅ | Verified API + UI (round 3c: submit → avg 4.0, trust 80). |
| UC4 — admin monitors activity, reviews reports, updates trust / deactivates users | ✅ | Admin console: stats, users (activate/deactivate, trust override, password reset, verified-badge toggle), sessions (cancel), reviews (delete), message approvals. Verified locally as a seeded admin. |

## 3. Data dictionary (SDD §4) — all five tables implemented

| Table | Fields | Status |
|---|---|---|
| USER | username, email, password (hashed), first/last name, trust_score (default 100), verified_badge | ✅ (+ additive: `country` on the profile, per the round-3c user order) |
| USER_SKILL | user FK (cascade), skill_name (≤200), skill_type TEACH/LEARN | ✅ |
| CHAT_MESSAGE | sender FK, receiver FK, message_body, sent_at | ✅ (+ additive: `code_language`, `moderation_status`, `flag_reason`; attachments via `ChatAttachment`) |
| SWAP_SESSION | partner_one/two FKs, calendar_date, duration_block (≤50), session_status PENDING/ACCEPTED/COMPLETED/CANCELLED | ✅ |
| INTEGRITY_REVIEW | target FK, author FK, rating_stars 1–5, feedback_text (nullable) | ✅ |

## 4. Non-functional requirements (SRS §3.3)

| Requirement | Status | Evidence / note |
|---|---|---|
| Matching 100 candidates in ≤500 ms | 🔍 not measured | Only 6 demo users exist locally; the matcher embeds per pair and is fast on this set, but no 100-candidate timing run was done. **Gap.** |
| Message latency ≤100 ms | 🔍 not measured | Local WS delivery is observed instant in tests, but no timing measurement was taken. **Gap.** |
| 99.5% availability / 24×7 | 🔍 depends on hosting | The app itself is stateless; the live deployment runs on Render's free tier, which sleeps the backend after idle (~30 s wake). Uptime is a hosting property, not an app property. **Documented limit.** |
| Cascade deletes (a deleted user purges their skills/messages) | ✅ | FK `on_delete=CASCADE` throughout; verified in the clean-clone API pass (delete a user → their skill rows are gone). |
| Passwords salted-hashed | ✅ | See REQ-01.2. |
| WebSocket auto-reconnect + history reload | ⚠️ | Implemented (`ChatSocket` reconnect + `onReconnect` history reload); the reconnect path itself was not exercised by killing a socket in tests. **Minor gap — verified in code, not in a live drop test.** |
| Route guards (unauthenticated → login) | ✅ | API returns 401 without a token; the frontend redirects to login. Verified. |
| Decoupled, modular architecture | ✅ | Django backend / React frontend, separate deployables. |
| Browser compatibility (Chrome, Firefox, Safari, Edge) | 🔍 | Only Chromium was tested (Playwright). Firefox/Safari/Edge not exercised. **Gap.** |
| Database adaptability | ✅ | Same Django ORM code runs on SQLite locally and Neon Postgres live (proven by both deployments). |
| W3C / RFC 7519 standards | ⚠️ | JWT via SimpleJWT (RFC 7519) — by construction. HTML/CSS was not run through a W3C validator. **Minor gap.** |
| **Inverse requirements** — no money features; chat never cache-only; no review without a completed session | ✅ | Verified by grep (no payment code) and by the API rules (reviews on PENDING → 400; duplicate → 400). |

## 5. SDD component / UI design (§5–§6)

| SDD item | Status | Note |
|---|---|---|
| Matching pipeline: ingest → 384-dim vectors → cross-matrix cosine → ≥50% filter → sorted response | ✅ | Implemented in `matcher.py` (`score_pair`, `rank_candidates`). |
| "AI Computation Layer" as an isolated Python microservice | ⚠️ | **Documented deviation:** the matcher runs in-process via ONNX Runtime, not as a separate microservice — torch cannot run on the 512 MB free tier, and the pipeline shape, threshold and sorting are unchanged. Noted in `BUILD_SUMMARY.md` deviation 9. |
| Four panels: Create Your Skill Account / AI Match Dashboard / Chat & Scheduler Hub / Session Feedback Hub | ✅ | All four exist; a 5th (Admin Console) was added by user order. |
| Deep indigo `#4F46E5` on white cards, left sidebar, mobile-first | ✅ | Design tokens + dark premium navbar (user-picked) + distinct dark admin console. |
| Skills entry as comma-separated text boxes | ⚠️ | **Deviation (better UX):** a `SkillPicker` with a 36-skill catalog + free text replaces raw comma-separated input; the same TEACH/LEARN data is stored. |
| Feedback submit returns focus to the profile panel | ⚠️ | **Deviation:** after submitting, the Feedback Hub stays and shows "Thank you" + "All caught up" (so multiple reviews can be given without navigating). The review itself is saved and trust recalculates. |
| SDD §6.3.3: "Finalize & Track Session" green button | ✅ | Button text matches; booking verified. |

## 6. User-ordered additions beyond the SRS/SDD (rounds 1–3c)

Admin panel, 2-step signup with skill picker, premium dark navbar, Option B
logo, video call (WebRTC signaling over the existing WebSocket), file and
code sharing in chat, rating visibility + "★ Rate" action on completed
sessions, Find people directory search with numeric IDs, Back buttons on
every sub-view, chat privacy filter (flagged number/link → admin approval
queue, delivered only if approved), world-country location (ISO 3166 +
city), stay-in-app principle (no WhatsApp/external-contact button anywhere).
All implemented and verified locally in rounds 3/3b/3c; see
`ROUND3-REQUIREMENTS.md` and `BUILD_SUMMARY.md`.

## 7. Open gaps (carried into the final report)

1. **Video-call media not verified end-to-end** — this sandbox blocks all
   UDP sockets, so a peer connection can never reach `connected` here.
   Signaling, UI, ring/accept/decline/end and timeouts are verified; a live
   two-user call on real devices is still needed.
2. **Latency targets unmeasured** — 500 ms matching (100 candidates) and
   100 ms message latency have no timing runs.
3. **Browser coverage** — Chromium only; Firefox/Safari/Edge untested.
4. **WS reconnect not exercised** by actually dropping a socket in tests
   (implemented + history reloads; the drop path is unverified).
5. **W3C markup not validator-checked.**
6. **Render free-tier limits** — backend sleeps after idle (~30 s wake);
   uploaded files live on ephemeral disk and are wiped on deploy/restart
   (a paid disk or object storage would be needed for permanent files).
7. **Match scores jitter ±1 between server starts** (78/79, 59/60) — ONNX
   Runtime floating-point nondeterminism on a borderline rounding; the
   invariants (both ≥50, Priya > Leo, +5 same-city bonus) always hold.
