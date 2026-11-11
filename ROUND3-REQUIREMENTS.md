# SkillSwap v2 — Round 3 requirements (FROZEN 2026-11-11 13:33 PKT)

User order: note everything, build it now, no more additions in this round.
The user will check the live build and send remaining feedback afterwards.

## Source A — typed message (2026-11-11 12:33 PKT)
1. **Rating feature — visible and easy.** Average stars + review count on match cards,
   community cards, ProfileModal; obvious "Rate" action on completed sessions
   (session rows + FeedbackHub). Rules UNCHANGED: 1–5 stars, 0 blocked, one review
   per session per author, completed-session partners only,
   trust = round(avg_stars/5 x 100).
2. **New users must show in the admin panel.** Refetch on Users-view open + Refresh
   button + joined date + "New" badge for accounts < 7 days old. Backend already
   returns all users (frontend staleness was the bug).
3. **Search by name + show ID.** Backend `GET /api/users/search/?q=` (JWT, exclude
   self + staff, match first_name/last_name/username icontains; return id, username,
   display name, location, teach/learn, trust, average rating) + "Find people" UI
   opening ProfileModal with ID shown (e.g. "ID 12 · @leo"). Admin users table/detail
   must also show the numeric ID.

## Source B — voice note (boy, 71s, addresses recipient as "Umar bhai")
4. **Admin panel is a must** — it already exists; check for gaps only.
5. **Everything inside the application** — people contact each other to learn/teach
   skills, but the work must not leave the app.
6. **In-app VIDEO CALL option** — WebRTC, existing Django Channels WS layer for
   signaling, peer-to-peer media, no media server.
7. **DOCUMENTS sending option in-app** — file attachments on chat messages
   (backend storage, size cap, images/PDF/docs).
8. **CODE showing/sharing option in-app** — code-block message type, monospace rendering.
9. **Fiverr policy analogy** — on Fiverr you cannot take a client to WhatsApp; the
   deal stays inside Fiverr. Same here: no WhatsApp/external-contact button anywhere.

## Clarifications added during the day
10. **Rating — users must be able to GIVE ratings** (12:19 PKT). The submit flow must
    work end-to-end (open Rate action → pick 1–5 stars + optional text → submit →
    review saves → target's average + trust update), verified in API + UI, including
    the duplicate-review block and the 0-star block. Not view-only.
11. **Quality bar — viva-ready** (12:22 PKT). Final-year project, submitted at a high
    level, checked by top professors, viva will be taken. Must be proper, complete,
    error-free. Full audit before finishing: SRS/SDD traceability (every requirement
    → implemented + verified, or listed as missing), clean-clone run following README
    exactly (a professor will run it this way), error sweep (manage.py check,
    fresh-DB migrate + seed, full API smoke, strict TS build, zero console errors
    desktop + 390px). Final report must include an EXPLICIT GAP LIST — anything
    missing, unverifiable end-to-end, or trippable. No "error-free" claim unless the
    clean-clone run + sweep actually pass.
12. **Back button on every sub-view/detail screen** (13:26 PKT). ProfileModal,
    AdminUserDetail, ChatHub conversation view (esp. mobile), any other drill-down.
    Returns to the previous view without logout or state loss.
13. **Chat privacy — admin approval flow** (13:26 PKT). No number/link is shared
    directly: a flagged message (phone-number-like or URL/link patterns, detected
    server-side at creation, WS path included) is saved PENDING — sender sees
    "waiting for admin approval", recipient does NOT see it. Admin console gets a
    staff-only "Message Approvals" queue (Approve / Reject). Approve → delivered
    (WS broadcast + visible). Reject → never delivered, sender sees rejected.
    Normal messages still deliver instantly; ordinary numbers ("2 years", "5pm",
    "Rs 5000") must NOT trigger approval.
14. **Location — all world countries** (13:30 PKT). Country dropdown with the full
    ISO 3166 list (~195 countries, bundled statically, no external API) + city/area
    free text, wherever location is entered (signup + profile edit); show country +
    city on cards, ProfileModal, search results, admin table/detail. Backward
    compatible with existing demo users (city-only values). +5 same-city bonus
    unchanged; matching works regardless of country.

## Standing constraints (do not change)
- Do NOT touch the old SkillSwap-Platform repo.
- Do NOT change the admin password (live admin password is the user's own).
- Do NOT change demo data semantics, branding, dark navbar, Option B logo,
  admin dark theme, ML matching, 50% threshold.
- Admin flows are verified LOCALLY with a seeded admin only — never attempt live
  admin login.

## Done when
- All 14 items built, locally verified (desktop + 390px), pushed to main,
  Render deploy Live, final report with commit + deploy time + GAP LIST, and the
  parent's live verification of the student side as maya/demo1234.
