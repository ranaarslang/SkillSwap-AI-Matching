import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, displayName, type Announcement } from '../api'

/** Round 4 — Announcements (admin side). The admin composes a title +
 * text (optional expiry date); students see it as a dismissible banner
 * until it is deleted or expires. */
export default function AdminAnnouncements() {
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [expires, setExpires] = useState('')
  const [busyCreate, setBusyCreate] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await api.getAdminAnnouncements())
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not load announcements.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return
    setBusyCreate(true)
    setNotice('')
    setError('')
    try {
      const created = await api.adminCreateAnnouncement({
        title: title.trim(),
        body: body.trim(),
        ...(expires ? { expires_at: expires } : {}),
      })
      setItems((prev) => [created, ...prev])
      setNotice(`Announcement "${created.title}" is now live for all students.`)
      setTitle('')
      setBody('')
      setExpires('')
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not create the announcement.')
    } finally {
      setBusyCreate(false)
    }
  }

  async function remove(a: Announcement) {
    setConfirmDeleteId(null)
    setBusyId(a.id)
    setNotice('')
    setError('')
    try {
      const res = await api.adminDeleteAnnouncement(a.id)
      setItems((prev) => prev.filter((x) => x.id !== a.id))
      setNotice(res.detail)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not delete the announcement.')
    } finally {
      setBusyId(null)
    }
  }

  const now = Date.now()
  const isLive = (a: Announcement) =>
    a.is_active && (!a.expires_at || new Date(a.expires_at).getTime() > now)

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-[var(--adm-text-dim)]">
          Announcements show to all students as a dismissible banner until deleted or expired.
        </p>
        <button onClick={load} className="btn-admin-secondary">
          Refresh
        </button>
      </div>
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

      <form onSubmit={create} className="card mb-4 space-y-3 p-4">
        <div>
          <label htmlFor="ann-title" className="mb-1 block text-sm font-medium text-[var(--adm-text)]">
            Title
          </label>
          <input
            id="ann-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. New feature: in-app video calls"
            className="input-dark"
            maxLength={200}
            required
          />
        </div>
        <div>
          <label htmlFor="ann-body" className="mb-1 block text-sm font-medium text-[var(--adm-text)]">
            Message
          </label>
          <textarea
            id="ann-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What should every student know?"
            rows={3}
            className="input-dark resize-y"
            maxLength={2000}
            required
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="ann-expires" className="mb-1 block text-sm font-medium text-[var(--adm-text)]">
              Expires on (optional)
            </label>
            <input
              id="ann-expires"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="input-dark w-auto"
            />
          </div>
          <button type="submit" disabled={busyCreate || !title.trim() || !body.trim()} className="btn-admin">
            {busyCreate ? 'Posting…' : 'Post announcement'}
          </button>
          <p className="text-xs text-[var(--adm-text-faint)]">Leave the date empty and it stays up until you delete it.</p>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-[var(--adm-text-dim)]">Loading announcements…</p>
      ) : items.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--adm-text-dim)]">No announcements yet.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--adm-text)]">
                    {a.title}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${
                      isLive(a)
                        ? 'bg-[var(--adm-accent-soft)] text-[var(--adm-accent-text)] ring-[var(--adm-accent-ring)]'
                        : 'bg-red-500/15 text-red-300 ring-red-500/30'
                    }`}>
                      {isLive(a) ? 'Live' : 'Expired'}
                    </span>
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--adm-text-dim)] break-words">{a.body}</p>
                  <p className="mt-1 text-xs text-[var(--adm-text-faint)]">
                    Posted {new Date(a.created_at).toLocaleString()}
                    {a.created_by ? ` by ${displayName(a.created_by)}` : ''}
                    {a.expires_at ? ` · Expires ${new Date(a.expires_at).toLocaleDateString()}` : ' · No expiry'}
                  </p>
                </div>
                {confirmDeleteId === a.id ? (
                  <span className="flex gap-2">
                    <button
                      onClick={() => remove(a)}
                      disabled={busyId === a.id}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      Confirm delete
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="btn-admin-secondary px-3 py-1.5 text-xs">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(a.id)}
                    className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
