import { useState } from 'react'
import type { Profile, User } from '../api'
import { api, ApiError } from '../api'

const AVAILABILITY_OPTIONS = ['Weekdays', 'Weeknights', 'Weekends', 'Flexible']

function parseSkills(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

export default function ProfilePanel({
  user,
  profile,
  onSaved,
}: {
  user: User
  profile: Profile | null
  onSaved: (p: Profile) => void
}) {
  const [fullName, setFullName] = useState(profile?.user.full_name || user.full_name || '')
  const [bio, setBio] = useState(profile?.bio || '')
  const [location, setLocation] = useState(profile?.location || '')
  const [teach, setTeach] = useState((profile?.teach_skills || []).join(', '))
  const [learn, setLearn] = useState((profile?.learn_skills || []).join(', '))
  const [availability, setAvailability] = useState(profile?.availability || 'Flexible')
  const [portfolioLink, setPortfolioLink] = useState(profile?.portfolio_link || '')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setToast('')
    setBusy(true)
    try {
      const updated = await api.updateMyProfile({
        full_name: fullName,
        bio,
        location,
        availability,
        portfolio_link: portfolioLink,
        teach_skills: parseSkills(teach),
        learn_skills: parseSkills(learn),
      })
      onSaved(updated)
      setToast('Saved ✓ Now finding your AI matches…')
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-extrabold text-slate-900 mb-1">Create Your Skill Account</h1>
      <p className="text-sm text-slate-500 mb-6">
        Tell Skill Swap Platform with AI Matching what you can teach and what you want to learn — the AI matcher uses this to find your best swaps.
        Signed in as <span className="font-semibold text-slate-700">@{user.username}</span> · {user.email}
      </p>
      <form onSubmit={save} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pf-name">Full name</label>
          <input id="pf-name" className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pf-bio">Bio</label>
          <textarea id="pf-bio" rows={3} className={inputCls} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell others what you do and what you love learning…" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pf-location">Location (city / area)</label>
          <input id="pf-location" className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bahawalpur" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pf-teach">Superpowers — skills you teach (comma-separated)</label>
          <input id="pf-teach" className={inputCls} value={teach} onChange={(e) => setTeach(e.target.value)} placeholder="e.g. Python, Guitar, Photography" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pf-learn">Growth Desires — skills you want to learn (comma-separated)</label>
          <input id="pf-learn" className={inputCls} value={learn} onChange={(e) => setLearn(e.target.value)} placeholder="e.g. React, Spanish, Piano" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pf-availability">Availability</label>
          <select id="pf-availability" className={inputCls} value={availability} onChange={(e) => setAvailability(e.target.value)}>
            {AVAILABILITY_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pf-portfolio">Portfolio link</label>
          <input id="pf-portfolio" type="url" className={inputCls} value={portfolioLink} onChange={(e) => setPortfolioLink(e.target.value)} placeholder="https://…" />
        </div>
        {error && <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        {toast && <div role="status" className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">{toast}</div>}
        <button type="submit" disabled={busy} className="w-full sm:w-auto rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold px-6 py-2.5">
          {busy ? 'Saving…' : 'Save & Find AI Matches'}
        </button>
      </form>
    </div>
  )
}
