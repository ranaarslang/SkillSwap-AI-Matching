import { useEffect, useState } from 'react'
import type { Profile, User } from '../api'
import { api, ApiError } from '../api'
import { COUNTRIES } from '../countries'
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
  const [country, setCountry] = useState(profile?.country || '')
  const [location, setLocation] = useState(profile?.location || '')

  // The profile loads asynchronously after login/signup, and the panel
  // can mount before it arrives (the dashboard heading renders first).
  // Re-sync the form whenever the profile prop lands, so a saved
  // country/city is never shown as empty. (After a save, onSaved updates
  // the same prop to the saved values, so this resets to what was saved.)
  useEffect(() => {
    setFullName(profile?.user.full_name || user.full_name || '')
    setBio(profile?.bio || '')
    setCountry(profile?.country || '')
    setLocation(profile?.location || '')
    setTeach(profile?.teach_skills || [])
    setLearn(profile?.learn_skills || [])
    setAvailability(profile?.availability || 'Flexible')
    setPortfolioLink(profile?.portfolio_link || '')
  }, [profile, user])
  const [teach, setTeach] = useState<string[]>(profile?.teach_skills || [])
  const [learn, setLearn] = useState<string[]>(profile?.learn_skills || [])
  const [availability, setAvailability] = useState(profile?.availability || 'Flexible')
  const [portfolioLink, setPortfolioLink] = useState(profile?.portfolio_link || '')
  const [error, setError] = useState('')
  const [teachError, setTeachError] = useState('')
  const [learnError, setLearnError] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwToast, setPwToast] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    setPwToast('')
    if (newPassword.length < 6) {
      setPwError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.')
      return
    }
    setPwBusy(true)
    try {
      await api.changePassword({ current_password: currentPassword, new_password: newPassword })
      setPwToast('Password changed. Use your new password next time you log in.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPwError(err instanceof ApiError ? err.detail : 'Could not change your password.')
    } finally {
      setPwBusy(false)
    }
  }

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
        country,
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

  const inputCls = 'input'

  return (
    <div className="max-w-2xl">
      <p className="eyebrow">Your Skill Account</p>
      <h1 className="page-title mt-1">Create Your Skill Account</h1>
      <p className="page-sub">
        Tell Skill Swap Platform with AI Matching what you can teach and what you want to learn — the AI matcher uses this to find your best swaps.
        Signed in as <span className="font-semibold text-slate-700">@{user.username}</span> · {user.email}
      </p>
      <form onSubmit={save} className="card mt-6 space-y-6 p-6 sm:p-7">
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
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pf-country">Country</label>
            <select id="pf-country" className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)} autoComplete="country-name">
              <option value="">Select country…</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pf-location">City / area</label>
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
        <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto">
          {busy ? 'Saving…' : 'Save & Find AI Matches'}
        </button>
      </form>

      <form onSubmit={changePassword} className="card mt-6 space-y-4 p-6 sm:p-7">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Change Password</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Set a password of your own — it takes effect immediately and stays yours. (Your current password is checked first.)
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pw-current">Current password</label>
          <input id="pw-current" type="password" className={inputCls} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pw-new">New password</label>
          <input id="pw-new" type="password" className={inputCls} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} autoComplete="new-password" placeholder="At least 6 characters" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pw-confirm">Confirm new password</label>
          <input id="pw-confirm" type="password" className={inputCls} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" placeholder="Repeat the new password" />
        </div>
        {pwError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">{pwError}</div>}
        {pwToast && <div role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">{pwToast}</div>}
        <button type="submit" disabled={pwBusy} className="btn-primary w-full sm:w-auto">
          {pwBusy ? 'Changing…' : 'Change Password'}
        </button>
      </form>
    </div>
  )
}
