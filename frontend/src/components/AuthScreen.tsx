import { useState } from 'react'
import { api, ApiError, ACCESS_KEY, REFRESH_KEY, USER_KEY } from '../api'
import type { User } from '../api'

export default function AuthScreen({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [emailOrUsername, setEmailOrUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res =
        mode === 'login'
          ? await api.login({ email_or_username: emailOrUsername, password })
          : await api.signup({ email, password, full_name: fullName })
      localStorage.setItem(ACCESS_KEY, res.access)
      localStorage.setItem(REFRESH_KEY, res.refresh)
      localStorage.setItem(USER_KEY, JSON.stringify(res.user))
      onAuthed(res.user)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-2xl font-extrabold text-indigo-600">Skill Swap Platform with AI Matching</div>
          <p className="text-slate-500 text-sm mt-1">Teach what you know. Learn what you don&apos;t.</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
          <div className="flex rounded-lg bg-slate-100 p-1 mb-6" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => setMode('login')}
              className={`flex-1 rounded-md py-2 text-sm font-semibold ${mode === 'login' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => setMode('signup')}
              className={`flex-1 rounded-md py-2 text-sm font-semibold ${mode === 'signup' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="full_name">Full name</label>
                  <input id="full_name" className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="su-email">Email</label>
                  <input id="su-email" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="email_or_username">Email or username</label>
                <input id="email_or_username" className={inputCls} value={emailOrUsername} onChange={(e) => setEmailOrUsername(e.target.value)} required autoComplete="username" />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="password">Password</label>
              <input id="password" type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </div>
            {error && (
              <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-2.5 text-sm"
            >
              {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>

          <div className="mt-5 rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-sm text-indigo-800">
            <span className="font-semibold">Try the demo:</span> maya / demo1234 (also leo / demo1234)
          </div>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">Skill Swap Platform with AI Matching — a student skill-exchange platform.</p>
      </div>
    </div>
  )
}
