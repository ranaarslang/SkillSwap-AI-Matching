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

## What each feature does

- **Sign up / Log in** — email + password + full name; JWT access + refresh
  tokens. Unauthenticated users are always sent back to the login screen.
- **Create Your Skill Account** — full name, bio, city/area (location),
  Superpowers (skills you teach), Growth Desires (skills you want to learn),
  availability, portfolio link. Everything saves to the SQLite database.
  "Save & Find AI Matches" saves and jumps to the dashboard.
- **AI Match Dashboard** — real transformer embeddings compare your TEACH
  skills against each student's LEARN skills and vice versa (cosine
  similarity, both directions averaged). Only matches at 50% or above are
  shown, sorted best-first, each with a % badge, a plain "why matched" line
  (e.g. "They can teach you: Storytelling"), a trust-score badge, and a
  same-city bonus (+5, shown on the card). Below-50% students appear
  separately under "Also in the community". A location filter narrows the
  list by city; the search box finds people by name, bio, or either skill
  list — on phones too.
- **Chat & Scheduler Hub** — pick a conversation, read the full history from
  the database, and send messages that arrive live on the other student's
  screen (WebSocket authenticated with your JWT). Book a session from the
  same place: pick a date, a duration ("30 Minutes", "1 Hour Mutual Swap",
  "2 Hours") and press "Finalize & Track Session" — the booking is saved as
  PENDING and double-booking the same slot is rejected. Accept, cancel, or
  mark sessions complete from the list.
- **Session Feedback Hub** — after a session is completed, pick that partner
  from the dropdown, give 1–5 stars (0 stars cannot be submitted) and a
  comment. Submitting recalculates the partner's trust score (average stars
  → 0–100). Reviews are only possible for completed-session partners.

## Project structure

```
skillswap-v2/
├── README.md                 # this file
├── BUILD_SUMMARY.md          # endpoints, verification log, deviations
├── backend/                  # Django 5 + DRF + Channels, SQLite
│   ├── config/               # settings (env-based), urls, asgi/wsgi
│   ├── swaps/                # models, serializers, views, matcher, consumers
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
    │   └── components/       # AuthScreen, ProfilePanel, Dashboard,
    │                         # ChatHub, FeedbackHub, ui
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
