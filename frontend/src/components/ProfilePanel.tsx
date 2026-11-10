import { useState } from 'react'
import type { Profile, User } from '../api'
import { api, ApiError } from '../api'
import SkillPicker from './SkillPicker'

const AVAILABILITY_OPTIONS = ['Weekdays', 'Weeknights', 'Weekends', 'Flexible']

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
  const [teach, setTeach] = useState<string[]>(profile?.teach_skills || [])
  const [learn, setLearn] = useState<string[]>(profile?.learn_skills || [])
  const [availability, setAvailability] = useState(profile?.availability || 'Flexible')
  const [portfolioLink, setPortfolioLink] = useState(profile?.portfolio_link || '')
  const [error, setError] = useState('')
  const [teachError, setTeachError] = useState('')
  const [learnError, setLearnError] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setToast('')
    setTeachError('')
    setLearnError('')
    let ok = true
    if (teach.length === 0) {
      setTeachError('Pick at least one skill you can teach.')
      ok = false
    }
    if (learn.length === 0) {
      setLearnError('Pick at least one skill you want to learn.')
      ok = false
    }
    if (!ok) return
    setBusy(true)
    try {
      const updated = await api.updateMyProfile({
        full_name: fullName,
        bio,
        location,
        availability,
        portfolio_link: portfolioLink,
        teach_skills: teach,
        learn_skills: learn,
      })
      onSaved(updated)
      setToast('Saved ✓ Now finding your AI matches…')
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create Your Skill Account</h1>
      <p className="mt-1 text-sm text-slate-500">
        Tell Skill Swap Platform with AI Matching what you can teach and what you want to learn — the AI matcher uses this to find your best swaps.
        Signed in as <span className="font-semibold text-slate-700">@{user.username}</span> · {user.email}
      </p>
      <form onSubmit={save} className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6 sm:p-7">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pf-name">Full name</label>
          <input id="pf-name" className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pf-bio">Bio</label>
          <textarea id="pf-bio" rows={3} className={inputCls} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell others what you do and what you love learning…" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pf-location">Location (city / area)</label>
            <input id="pf-location" className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bahawalpur" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pf-availability">Availability</label>
            <select id="pf-availability" className={inputCls} value={availability} onChange={(e) => setAvailability(e.target.value)}>
              {AVAILABILITY_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        </div>
        <SkillPicker
          id="pf-teach"
          label="Superpowers — skills you teach"
          hint="Other students see these on your profile and can ask you to teach them."
          selected={teach}
          onChange={(v) => {
            setTeach(v)
            setTeachError('')
          }}
          tone="indigo"
          error={teachError}
        />
        <SkillPicker
          id="pf-learn"
          label="Growth Desires — skills you want to learn"
          hint="Students who teach these will see you as a match."
          selected={learn}
          onChange={(v) => {
            setLearn(v)
            setLearnError('')
          }}
          tone="emerald"
          error={learnError}
        />
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pf-portfolio">Portfolio link</label>
          <input id="pf-portfolio" type="url" className={inputCls} value={portfolioLink} onChange={(e) => setPortfolioLink(e.target.value)} placeholder="https://…" />
        </div>
        {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</div>}
        {toast && <div role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">{toast}</div>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 sm:w-auto">
          {busy ? 'Saving…' : 'Save & Find AI Matches'}
        </button>
      </form>
    </div>
  )
}
