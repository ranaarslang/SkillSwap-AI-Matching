import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, type CatalogSkill } from '../api'

/** Round 4 — Skills management (admin side). The catalog is stored in
 * the backend; the SkillPicker at signup and profile edit reads it, so
 * a skill added here shows up for every student immediately. Removing
 * a skill only hides it from the picker — students who already picked
 * it keep it on their profile. */
export default function AdminSkills() {
  const [skills, setSkills] = useState<CatalogSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [busyAdd, setBusyAdd] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editGroup, setEditGroup] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setSkills(await api.getAdminSkills())
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not load the skill catalog.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const groups = useMemo(() => {
    const map = new Map<string, CatalogSkill[]>()
    for (const s of skills) {
      if (!s.is_active) continue
      const list = map.get(s.group) || []
      list.push(s)
      map.set(s.group, list)
    }
    return [...map.entries()]
  }, [skills])

  const allGroups = useMemo(
    () => [...new Set(skills.map((s) => s.group))].sort(),
    [skills],
  )

  async function addSkill(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusyAdd(true)
    setNotice('')
    setError('')
    try {
      const created = await api.adminCreateSkill(newName.trim(), newGroup.trim() || 'General')
      setSkills((prev) => [...prev, created])
      setNotice(`"${created.name}" added to the catalog (${created.group}). It is now available in the SkillPicker.`)
      setNewName('')
      setNewGroup('')
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not add the skill.')
    } finally {
      setBusyAdd(false)
    }
  }

  async function saveRename(s: CatalogSkill) {
    const name = editName.trim()
    const group = editGroup.trim()
    if (!name && !group) {
      setEditingId(null)
      return
    }
    setBusyId(s.id)
    setNotice('')
    setError('')
    try {
      const updated = await api.adminUpdateSkill(s.id, {
        ...(name ? { name } : {}),
        ...(group ? { group } : {}),
      })
      setSkills((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setNotice(`Skill updated to "${updated.name}" (${updated.group}).`)
      setEditingId(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not rename the skill.')
    } finally {
      setBusyId(null)
    }
  }

  async function removeSkill(s: CatalogSkill) {
    setConfirmDeleteId(null)
    setBusyId(s.id)
    setNotice('')
    setError('')
    try {
      const res = await api.adminDeleteSkill(s.id)
      setSkills((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_active: false } : x)))
      setNotice(res.detail)
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Could not remove the skill.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-[var(--adm-text-dim)]">
          {skills.filter((s) => s.is_active).length} skills in the catalog. Adding, renaming or removing
          a skill here updates the SkillPicker for every student at signup and profile edit.
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

      <form onSubmit={addSkill} className="card mb-4 flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="new-skill-name" className="mb-1 block text-sm font-medium text-[var(--adm-text)]">
            New skill name
          </label>
          <input
            id="new-skill-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Public Speaking"
            className="input-dark"
            maxLength={120}
            required
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <label htmlFor="new-skill-group" className="mb-1 block text-sm font-medium text-[var(--adm-text)]">
            Group
          </label>
          <input
            id="new-skill-group"
            type="text"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            placeholder="e.g. Business & Life"
            list="admin-skill-groups"
            className="input-dark"
            maxLength={80}
          />
          <datalist id="admin-skill-groups">
            {allGroups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        <button type="submit" disabled={busyAdd || !newName.trim()} className="btn-admin">
          {busyAdd ? 'Adding…' : 'Add skill'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-[var(--adm-text-dim)]">Loading skills…</p>
      ) : groups.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--adm-text-dim)]">No active skills in the catalog.</p>
      ) : (
        <div className="space-y-4">
          {groups.map(([group, list]) => (
            <div key={group} className="card p-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--adm-text-faint)]">{group}</h3>
              <ul className="mt-2 space-y-1.5">
                {list.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--adm-surface-2)]">
                    {editingId === s.id ? (
                      <>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          aria-label="Skill name"
                          className="input-dark min-w-[140px] flex-1 px-2 py-1 text-sm"
                          maxLength={120}
                        />
                        <input
                          type="text"
                          value={editGroup}
                          onChange={(e) => setEditGroup(e.target.value)}
                          aria-label="Skill group"
                          list="admin-skill-groups"
                          className="input-dark min-w-[120px] flex-1 px-2 py-1 text-sm"
                          maxLength={80}
                        />
                        <button
                          onClick={() => saveRename(s)}
                          disabled={busyId === s.id}
                          className="btn-admin px-3 py-1.5 text-xs"
                        >
                          {busyId === s.id ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingId(null)} className="btn-admin-secondary px-3 py-1.5 text-xs">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm font-semibold text-[var(--adm-text)]">{s.name}</span>
                        <button
                          onClick={() => {
                            setEditingId(s.id)
                            setEditName(s.name)
                            setEditGroup(s.group)
                          }}
                          className="btn-admin-secondary px-3 py-1.5 text-xs"
                        >
                          Rename
                        </button>
                        {confirmDeleteId === s.id ? (
                          <span className="flex gap-2">
                            <button
                              onClick={() => removeSkill(s)}
                              disabled={busyId === s.id}
                              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                            >
                              Confirm remove
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)} className="btn-admin-secondary px-3 py-1.5 text-xs">
                              Keep
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(s.id)}
                            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"
                          >
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-[var(--adm-text-faint)]">
            Removing a skill hides it from the SkillPicker only — students who already picked it keep it on their profile.
          </p>
        </div>
      )}
    </section>
  )
}
