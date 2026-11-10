import { useState } from 'react'
import { api, ApiError, ACCESS_KEY, REFRESH_KEY, USER_KEY } from '../api'
import type { User } from '../api'
import SkillPicker from './SkillPicker'
import { IconCheck, IconShield, LogoMark } from './ui'

const FEATURES = [
  { title: 'AI-powered matching', text: 'Our AI pairs your teaching skills with people who want to learn them — and vice versa.' },
  { title: 'Real conversations', text: 'Message your matches, schedule a swap session, and learn together live.' },
  { title: 'Trusted community', text: 'Every completed session builds a trust score, so you always know who you are learning from.' },
]

export default function AuthScreen({ onAuthed, variant }: { onAuthed: (user: User, opts?: { adminLogin?: boolean }) => void; variant?: 'admin' }) {
  const isAdmin = variant === 'admin'
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [step, setStep] = useState<1 | 2>(1)
  const [emailOrUsername, setEmailOrUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [teachSkills, setTeachSkills] = useState<string[]>([])
  const [learnSkills, setLearnSkills] = useState<string[]>([])
  const [teachError, setTeachError] = useState('')
  const [learnError, setLearnError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function switchMode(next: 'login' | 'signup') {
    setMode(next)
    setStep(1)
    setError('')
    setTeachError('')
    setLearnError('')
  }

  function continueToSkills(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!fullName.trim() || !email.trim() || password.length < 6) return
    setStep(2)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setTeachError('')
    setLearnError('')
    if (mode === 'signup') {
      let ok = true
      if (teachSkills.length === 0) {
        setTeachError('Pick at least one skill you can teach — your matches are built from this.')
        ok = false
      }
      if (learnSkills.length === 0) {
        setLearnError('Pick at least one skill you want to learn — your matches are built from this.')
        ok = false
      }
      if (!ok) return
    }
    setBusy(true)
    try {
      const res =
        mode === 'login'
          ? await api.login({ email_or_username: emailOrUsername, password })
          : await api.signup({ email, password, full_name: fullName, teach_skills: teachSkills, learn_skills: learnSkills })
      // Dedicated admin login: staff only. A student signing in here is
      // turned away with a clear message — they use the student login.
      if (isAdmin && !res.user.is_staff) {
        localStorage.removeItem(ACCESS_KEY)
        localStorage.removeItem(REFRESH_KEY)
        localStorage.removeItem(USER_KEY)
        setError('This login is for staff only. Please use the student login to sign in as a student.')
        return
      }
      localStorage.setItem(ACCESS_KEY, res.access)
      localStorage.setItem(REFRESH_KEY, res.refresh)
      localStorage.setItem(USER_KEY, JSON.stringify(res.user))
      onAuthed(res.user, { adminLogin: isAdmin })
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls = isAdmin ? 'input-dark' : 'input'
  const labelCls = isAdmin
    ? 'mb-1 block text-sm font-medium text-slate-300'
    : 'mb-1 block text-sm font-medium text-slate-700'
  const alertCls = isAdmin
    ? 'rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-inset ring-red-500/30'
    : 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200'

  return (
    <div className="min-h-screen bg-slate-100 lg:grid lg:grid-cols-2">
      {/* Brand panel — desktop only */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-950 px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* Glow orbs */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-indigo-500/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute bottom-10 -left-20 h-72 w-72 rounded-full bg-violet-500/25 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.08),transparent_45%)]" aria-hidden />
        <div className="relative">
          <div className="flex items-center gap-3">
            <LogoMark className="h-11 w-11" />
            <span className="text-lg font-extrabold tracking-tight leading-tight">
              Skill Swap <span className="text-indigo-300">Platform</span>
              <span className="block text-sm font-semibold text-indigo-300">with AI Matching</span>
            </span>
          </div>
          <h1 className="mt-14 text-[2.6rem] font-extrabold leading-[1.08] tracking-tight">
            Teach what you know.<br />
            <span className="bg-gradient-to-r from-indigo-300 to-sky-300 bg-clip-text text-transparent">Learn what you don&apos;t.</span>
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-indigo-200">
            A student skill-exchange platform where your teaching skills find
            the people who want to learn them — matched by AI, booked in
            minutes, and reviewed by the community.
          </p>
          <ul className="mt-10 space-y-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3 rounded-xl bg-white/5 px-3 py-3 ring-1 ring-white/10 backdrop-blur-sm">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 shadow">
                  <IconCheck className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{f.title}</span>
                  <span className="block text-sm text-indigo-200">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-indigo-300">Skill Swap Platform with AI Matching — a student skill-exchange platform.</p>
      </aside>

      {/* Form column */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          {/* Mobile brand header */}
          <div className="mb-6 text-center lg:hidden">
            <div className="mx-auto mb-3">
              <LogoMark className="mx-auto h-11 w-11" />
            </div>
            <div className="text-xl font-extrabold tracking-tight text-slate-900">Skill Swap Platform with AI Matching</div>
            <p className="mt-1 text-sm text-slate-500">Teach what you know. Learn what you don&apos;t.</p>
          </div>

          <div
            className={
              isAdmin
                ? 'animate-rise rounded-panel border border-slate-800 bg-slate-950 p-6 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.6)] sm:p-8'
                : 'animate-rise rounded-panel border border-slate-200/90 bg-white p-6 shadow-lift sm:p-8'
            }
          >
            {isAdmin ? (
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30">
                    <IconShield className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-400">Admin Console</p>
                    <h2 className="text-xl font-extrabold tracking-tight text-white">Admin Login</h2>
                    <p className="text-sm text-slate-400">Staff only — sign in to manage the platform.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex rounded-lg bg-slate-100 p-1" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  onClick={() => switchMode('login')}
                  className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${mode === 'login' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Log in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  onClick={() => switchMode('signup')}
                  className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${mode === 'signup' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Sign up
                </button>
              </div>
            )}

            {mode === 'signup' && (
              <ol className="mt-5 flex items-center gap-2 text-xs font-semibold" aria-label="Sign-up progress">
                <li className={`flex items-center gap-1.5 ${step >= 1 ? 'text-indigo-700' : 'text-slate-400'}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>1</span>
                  Your account
                </li>
                <li className="h-px flex-1 bg-slate-200" aria-hidden />
                <li className={`flex items-center gap-1.5 ${step === 2 ? 'text-indigo-700' : 'text-slate-400'}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${step === 2 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>2</span>
                  Your skills
                </li>
              </ol>
            )}

            {mode === 'login' ? (
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label className={labelCls} htmlFor="email_or_username">Email or username</label>
                  <input id="email_or_username" className={inputCls} value={emailOrUsername} onChange={(e) => setEmailOrUsername(e.target.value)} required autoComplete="username" placeholder="you@university.edu" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="password">Password</label>
                  <input id="password" type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••" />
                </div>
                {error && (
                  <div role="alert" className={alertCls}>{error}</div>
                )}
                <button type="submit" disabled={busy} className={isAdmin ? 'btn-admin w-full' : 'btn-primary w-full'}>
                  {busy ? 'Please wait…' : 'Log in'}
                </button>
              </form>
            ) : step === 1 ? (
              <form onSubmit={continueToSkills} className="mt-6 space-y-4">
                <div>
                  <label className={labelCls} htmlFor="full_name">Full name</label>
                  <input id="full_name" className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" placeholder="e.g. Maya Chen" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="su-email">Email</label>
                  <input id="su-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@university.edu" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="su-password">Password</label>
                  <input id="su-password" type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" placeholder="At least 6 characters" />
                </div>
                <button type="submit" className={isAdmin ? 'btn-admin w-full' : 'btn-primary w-full'}>
                  Continue to your skills →
                </button>
                <p className="text-center text-xs text-slate-400">Step 2 asks what you can teach and what you want to learn — both are required so other students can find you.</p>
              </form>
            ) : (
              <form onSubmit={submit} className="mt-6 space-y-6">
                <SkillPicker
                  id="su-teach"
                  label="What can you teach?"
                  hint="These are your Superpowers — other students will see them on your profile and can ask you to teach them."
                  selected={teachSkills}
                  onChange={(v) => {
                    setTeachSkills(v)
                    setTeachError('')
                  }}
                  tone="indigo"
                  error={teachError}
                />
                <SkillPicker
                  id="su-learn"
                  label="What do you want to learn?"
                  hint="These are your Growth Desires — students who teach these will see you as a match."
                  selected={learnSkills}
                  onChange={(v) => {
                    setLearnSkills(v)
                    setLearnError('')
                  }}
                  tone="emerald"
                  error={learnError}
                />
                {error && (
                  <div role="alert" className={alertCls}>{error}</div>
                )}
                <div className="flex gap-3">
                  <button type="button" onClick={() => setStep(1)} className="btn-secondary">
                    ← Back
                  </button>
                  <button type="submit" disabled={busy} className="btn-primary flex-1">
                    {busy ? 'Creating your account…' : 'Create account'}
                  </button>
                </div>
              </form>
            )}

            {isAdmin ? (
              <p className="mt-5 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-400 shadow-sm">
                Staff accounts never appear in student matching. If you are a student, use the normal login instead.
              </p>
            ) : (
              <div className="mt-5 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-violet-50 px-3.5 py-2.5 text-sm text-indigo-800 shadow-sm">
                <span className="font-semibold">Try the demo:</span> maya / demo1234 (also leo / demo1234)
              </div>
            )}
          </div>
          {isAdmin ? (
            <p className="mt-4 text-center text-sm">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  window.location.hash = ''
                }}
                className="font-semibold text-emerald-400 hover:text-emerald-300"
              >
                ← Back to student login
              </a>
            </p>
          ) : (
            <p className="mt-4 text-center text-sm text-slate-500">
              Staff member?{' '}
              <a
                href="#/admin-login"
                onClick={(e) => {
                  e.preventDefault()
                  window.location.hash = '#/admin-login'
                }}
                className="font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Admin Login →
              </a>
            </p>
          )}
          <p className="mt-4 text-center text-xs text-slate-400">Skill Swap Platform with AI Matching — a student skill-exchange platform.</p>
        </div>
      </main>
    </div>
  )
}
