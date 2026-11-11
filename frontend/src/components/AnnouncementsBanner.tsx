import { useCallback, useEffect, useState } from 'react'
import { api, type Announcement } from '../api'

/** Round 4 — the student-side announcements banner. Admin announcements
 * show here (all student views) until the student dismisses them or
 * they are deleted / expire. Dismissals are per-device (localStorage),
 * keyed by announcement id, so a new announcement always shows again. */
const DISMISSED_KEY = 'skillswap-dismissed-announcements'

function readDismissed(): Set<number> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    return new Set((JSON.parse(raw) as unknown[]).filter((x) => typeof x === 'number') as number[])
  } catch {
    return new Set()
  }
}

export default function AnnouncementsBanner() {
  const [items, setItems] = useState<Announcement[]>([])
  const [dismissed, setDismissed] = useState<Set<number>>(() => readDismissed())

  const load = useCallback(async () => {
    try {
      setItems(await api.getAnnouncements())
    } catch {
      /* announcements are non-critical — a failed load hides the banner */
      setItems([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function dismiss(id: number) {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(id)
      try {
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]))
      } catch {
        /* storage unavailable — the banner just shows again next visit */
      }
      return next
    })
  }

  const visible = items.filter((a) => !dismissed.has(a.id))
  if (visible.length === 0) return null

  return (
    <div className="mb-4 space-y-2" role="region" aria-label="Announcements">
      {visible.map((a) => (
        <div
          key={a.id}
          className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3 shadow-sm"
        >
          <span aria-hidden className="mt-0.5 text-base">📢</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-indigo-900">{a.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-indigo-800 break-words">{a.body}</p>
            {a.expires_at && (
              <p className="mt-0.5 text-xs text-indigo-500">
                Until {new Date(a.expires_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <button
            onClick={() => dismiss(a.id)}
            aria-label={`Dismiss announcement: ${a.title}`}
            className="shrink-0 rounded-md px-2 py-1 text-sm font-bold text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
