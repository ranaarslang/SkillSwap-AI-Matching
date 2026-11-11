# Skill Swap Platform with AI Matching

A complete full-stack skill-exchange platform: students create a profile with
the skills they can teach ("Superpowers") and want to learn ("Growth Desires"),
get AI-matched with other students, book learning sessions, chat in real time,
and leave reviews that build a trust score. Built to the project's SRS/SDD
(Islamia University of Bahawalpur) with real machine learning for matching.

- **Backend:** Django 5 + Django REST Framework + Channels (WebSocket), SQLite
- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Matching:** the real `sentence-transformers/all-MiniLM-L6-v2` transformer
  running on ONNX Runtime — no torch, no sentence-transformers package
- **Auth:** JWT (SimpleJWT), email + password + full name

## Quick start (run locally)

You need Python 3.12 and Node 18+.

### 1. Backend (terminal 1)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python download_model.py --all   # downloads the AI model (~115 MB) once
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo       # creates 6 demo students
.venv/bin/daphne -b 127.0.0.1 -p 8000 config.asgi:application
```

The API is now at `http://127.0.0.1:8000/api`. Use **daphne** (not
`runserver`) — the live chat WebSocket only works under an ASGI server.
The model downloads automatically on first use if you skip
`download_model.py`, but running it once up front is faster.

### 2. Frontend (terminal 2)

```bash
cd frontend
npm install
VITE_API_URL=http://localhost:8000/api npm run dev
```

Open **http://localhost:5173** and log in with a demo account below.

To build for production:

```bash
VITE_API_URL=http://localhost:8000/api npm run build   # output in frontend/dist/
```

## Demo logins (all passwords are `demo1234`)

| Login | Name | City | Teaches | Wants to learn |
|---|---|---|---|---|
| `maya` | Maya Chen | Lahore | Python, Data Visualization | Public Speaking, UI Design, Storytelling |
| `leo` | Leo Martins | Lahore | Video Editing, Storytelling | Python, Product Design |
| `jonah` | Jonah Williams | Karachi | React, TypeScript | Photography, Figma |
| `sana` | Sana Patel | Islamabad | UI Design, Figma | Video Editing |
| `alex` | Alex Rivera | Karachi | Guitar, Music Theory | React |
| `priya` | Priya Nair | Lahore | Public Speaking, Content Writing | Data Visualization |

You can also log in with the demo email, e.g. `maya@skillswap.demo`.
Signing up with your own email works too. Seeded data already includes an
accepted session (Maya ↔ Leo), a pending session (Maya ↔ Jonah), a completed
session with a 5-star review (Maya ↔ Sana), and chat history between Maya
and Leo.

The demo **admin** account is `admin` / `demo1234` (seeded as staff). The
admin console lives at `#/admin-login` — login only, no signup. (On the live
deployment the admin password was changed by the owner via Change Password;
use the seeded one only on a local run.)

## What each feature does

- **Sign up / Log in** — email + password + full name; JWT access + refresh
  tokens. Unauthenticated users are always sent back to the login screen.
  **Sign-up is two steps:** step 1 is the account (name, email, password,
  country + city), step 2 picks the skills you teach and want to learn from
  a 36-skill catalog (plus free text) — at least one teach skill and one
  learn skill are required.
- **Create Your Skill Account** — full name, bio, country + city (country is
  a dropdown with the full ISO 3166 world list, city is free text),
  Superpowers (skills you teach), Growth Desires (skills you want to learn),
  availability, portfolio link. Everything saves to the database
  (SQLite locally, Postgres on Render via `DATABASE_URL`).
  "Save & Find AI Matches" saves and jumps to the dashboard.
- **AI Match Dashboard** — real transformer embeddings compare your TEACH
  skills against each student's LEARN skills and vice versa (cosine
  similarity, both directions averaged). Only matches at 50% or above are
  shown, sorted best-first, each with a % badge, a plain "why matched" line
  (e.g. "They can teach you: Storytelling"), a trust-score badge, a
  **star rating (average stars + review count)**, and a same-city bonus (+5,
  shown on the card). Below-50% students appear separately under "Also in
  the community". A location filter narrows the list by city; the search box
  finds people by name, bio, or either skill list — on phones too.
- **Find people** — typing at least 2 characters in the navbar search opens
  a directory search that finds ANY user by name (not just your matches),
  showing their **numeric ID** (e.g. "ID 3 · @leo"), rating, skills and
  location. Clicking a result opens their profile with the ID shown.
- **Chat & Scheduler Hub** — pick a conversation, read the full history from
  the database, and send messages that arrive live on the other student's
  screen (WebSocket authenticated with your JWT). Every message shows a
  **"Trading: …" context label** (the skill being exchanged). Book a session
  from the same place: pick a date, a duration ("30 Minutes", "1 Hour
  Mutual Swap", "2 Hours") and press "Finalize & Track Session" — the
  booking is saved as PENDING and double-booking the same slot is rejected.
  Accept, cancel, or mark sessions complete from the list.
- **Video call (in-app)** — from a chat or a profile, start a video call
  without leaving the app (WebRTC peer-to-peer media, call signaling over
  the existing WebSocket; Google public STUN). The other student gets an
  incoming-call overlay with Accept/Decline, and either side can mute, turn
  off the camera, or end the call. A 30-second ring timeout and a 20-second
  stuck-connection timeout fail loudly instead of hanging.
- **Document sharing (in-app)** — attach a file to a chat message (images,
  PDF, docs, spreadsheets, slides; 10 MB cap). Images render as previews,
  other files as download chips. Downloads use a signed, 1-hour link that
  only the two participants (or staff) can open.
- **Code sharing (in-app)** — send a code snippet in chat with a language
  picker (16 languages + "other"); it renders as a dark monospace block
  with a Copy button.
- **Chat privacy filter (admin approval)** — phone numbers and links in chat
  are NOT delivered directly. A message containing a number or a link is
  saved as *pending* and the sender sees "⏳ Waiting for admin approval";
  the recipient never sees it until an admin approves it in the **Message
  Approvals** queue (reject → the sender sees it as rejected). Ordinary
  numbers ("2 years experience", "session at 5pm", "Rs 5000") pass through
  instantly. Nothing in chat pushes anyone to WhatsApp or any external app
  — the whole deal stays inside the application.
- **Session Feedback Hub** — after a session is completed, pick that partner
  from the dropdown (or tap **"★ Rate …" on the completed session**), give
  1–5 stars (0 stars cannot be submitted) and a comment. Submitting saves
  the review and recalculates the partner's trust score (average stars →
  0–100), and their stars update on the dashboard immediately. One review
  per session per author; reviews are only possible for completed-session
  partners.
- **Admin panel (staff only)** — a dedicated dark admin console at
  `#/admin-login` (login only, no signup; non-staff logins are rejected).
  Stats (users, sessions, messages, reviews, average trust), a searchable
  users table that refetches every time it opens (so a just-signed-up user
  appears immediately) with **ID, joined date and a "New" badge** for
  accounts created in the last 7 days, per-user detail (profile, skills,
  sessions with cancel, reviews, recent messages with delete, password
  reset, trust override, activate/deactivate, **verification-badge toggle**),
  a sessions table with status filter, a reviews list with delete, and the
  **Message Approvals** queue for flagged chat messages. Every admin
  endpoint returns 403 for non-staff.
- **Back buttons** — every sub-view has a visible "← Back": profile modal
  (back to the dashboard), admin user detail (back to the users list), chat
  conversation on phones (back to the conversations list), signup step 2
  (back to step 1), admin login (back to student login).

## Project structure

```
skillswap-v2/
├── README.md                 # this file
├── BUILD_SUMMARY.md          # endpoints, verification log, deviations
├── backend/                  # Django 5 + DRF + Channels, SQLite
│   ├── config/               # settings (env-based), urls, asgi/wsgi
│   ├── swaps/                # models, serializers, views, matcher, consumers,
│   │                         # message_filter (chat privacy filter)
│   ├── ml_models/            # all-MiniLM-L6-v2 ONNX model + tokenizer
│   ├── download_model.py     # one-time model download (also a deploy step)
│   ├── matcher_test.py       # embedding quality checks
│   ├── smoke_test.py         # 35 API + WebSocket checks
│   ├── NOTES.md              # backend notes + verification log
│   └── requirements.txt
└── frontend/                 # React + TS + Vite + Tailwind
    ├── src/
    │   ├── api.ts            # JWT client, refresh, ChatSocket
    │   ├── App.tsx           # sidebar layout + routing between panels
    │   ├── call.ts           # WebRTC CallManager (video calls)
    │   ├── countries.ts      # static ISO 3166 world country list
    │   └── components/       # AuthScreen, ProfilePanel, Dashboard,
    │                         # ChatHub, FeedbackHub, CallView,
    │                         # AdminPanel, AdminUserDetail, ui
    └── NOTES.md              # frontend notes + verification log
```

## Deployment notes

- Backend settings are env-based (`SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`,
  `CORS_ALLOWED_ORIGINS`) with safe local defaults.
- On a host like Render, run `python download_model.py --all` as part of the
  build so the model is present before the server starts. The active model is
  the 23 MB INT8 quantized one (`model_qint8_arm64.onnx`) — same match
  quality as the 90 MB fp32 model at roughly half the memory.
- JWT access tokens are short-lived; the frontend refreshes them
  automatically. In Testing-style deployments, re-authorization may be
  needed when tokens expire.
- There are no money features anywhere in this project (no carts, checkout,
  points, or paywalls), per the specification.
