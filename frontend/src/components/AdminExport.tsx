import { useState } from 'react'
import { api, ApiError } from '../api'

/** Round 4 — Data export (admin side). Staff-only CSV downloads of the
 * platform data: users, sessions, reviews. The file downloads straight
 * from the browser; nothing is stored on the server. */
const EXPORTS = [
  {
    kind: 'users' as const,
    title: 'Users',
    text: 'Every account: id, username, name, email, join date, status, staff flag, country, city, trust score, verified badge, teach and learn skills.',
  },
  {
    kind: 'sessions' as const,
    title: 'Sessions',
    text: 'Every swap session: id, both partners, title, date, duration, status, created date.',
  },
  {
    kind: 'reviews' as const,
    title: 'Reviews',
    text: 'Every review: id, session, author, target, stars (1–5), feedback text, created date.',
  },
]

export default function AdminExport() {
  const [busyKind, setBusyKind] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function download(kind: 'users' | 'sessions' | 'reviews') {
    setBusyKind(kind)
    setNotice('')
    setError('')
    try {
      await api.downloadAdminCsv(kind)
      setNotice(`skillswap-${kind} CSV downloaded.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not download the export.')
    } finally {
      setBusyKind(null)
    }
  }

  return (
    <section>
      <p className="mb-3 text-sm text-[var(--adm-text-dim)]">
        Download the platform data as CSV files (staff only). The files are generated on demand and
        download straight to your device.
      </p>
      {error && (
        <div role="alert" className="mb-3 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-400 ring-1 ring-inset ring-red-500/30">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-3 rounded-lg bg-[var(--adm-accent-soft)] px-3 py-2.5 text-sm text-[var(--adm-accent-text)] ring-1 ring-inset ring-[var(--adm-accent-ring)]">
          {notice}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {EXPORTS.map((e) => (
          <div key={e.kind} className="card flex flex-col p-4">
            <h3 className="text-sm font-bold text-[var(--adm-text)]">{e.title} CSV</h3>
            <p className="mt-1 flex-1 text-sm leading-relaxed text-[var(--adm-text-dim)]">{e.text}</p>
            <button
              onClick={() => download(e.kind)}
              disabled={busyKind !== null}
              className="btn-admin mt-3 w-full"
            >
              {busyKind === e.kind ? 'Downloading…' : `Download ${e.title} CSV`}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
