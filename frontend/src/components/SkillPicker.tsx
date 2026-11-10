import { useState } from 'react'
import { SKILL_CATALOG, MAX_SKILLS_PER_LIST } from '../skills'

interface Props {
  id: string
  label: string
  hint?: string
  selected: string[]
  onChange: (next: string[]) => void
  tone?: 'indigo' | 'emerald'
  error?: string
}

/**
 * Skill picker: grouped toggle chips from the curated catalog plus a
 * free-text "add your own skill" input. Selected skills are shown as
 * removable chips above the catalog.
 */
export default function SkillPicker({ id, label, hint, selected, onChange, tone = 'indigo', error }: Props) {
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState('')

  const selectedLower = new Set(selected.map((s) => s.toLowerCase()))
  const atMax = selected.length >= MAX_SKILLS_PER_LIST

  function toggle(skill: string) {
    if (selectedLower.has(skill.toLowerCase())) {
      onChange(selected.filter((s) => s.toLowerCase() !== skill.toLowerCase()))
    } else if (!atMax) {
      onChange([...selected, skill])
    }
  }

  function addCustom() {
    const name = custom.trim()
    setCustomError('')
    if (!name) return
    if (name.length > 120) {
      setCustomError('That skill name is too long (max 120 characters).')
      return
    }
    if (selectedLower.has(name.toLowerCase())) {
      setCustomError(`"${name}" is already selected.`)
      return
    }
    if (atMax) {
      setCustomError(`You can pick up to ${MAX_SKILLS_PER_LIST} skills here.`)
      return
    }
    onChange([...selected, name])
    setCustom('')
  }

  const chipOn =
    tone === 'emerald'
      ? 'bg-emerald-600 text-white border-emerald-600'
      : 'bg-indigo-600 text-white border-indigo-600'
  const chipOff = 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400 hover:text-indigo-700'

  return (
    <fieldset>
      <legend className="block text-sm font-semibold text-slate-800">
        {label}
        <span className="ml-1 text-red-600" aria-hidden>*</span>
      </legend>
      {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}

      {/* Selected skills */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5" aria-live="polite">
          {selected.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              title={`Remove ${s}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${chipOn}`}
            >
              {s} <span aria-hidden>×</span>
            </button>
          ))}
          <span className="text-xs text-slate-400 self-center">
            {selected.length} selected
          </span>
        </div>
      )}

      {/* Catalog groups */}
      <div className="mt-3 space-y-3">
        {SKILL_CATALOG.map((group) => (
          <div key={group.label}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.skills.map((skill) => {
                const on = selectedLower.has(skill.toLowerCase())
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => toggle(skill)}
                    aria-pressed={on}
                    disabled={!on && atMax}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${on ? chipOn : chipOff}`}
                  >
                    {on ? '✓ ' : ''}{skill}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Free-text add */}
      <div className="mt-3">
        <label htmlFor={`${id}-custom`} className="block text-xs font-medium text-slate-500 mb-1">
          Don&apos;t see your skill? Add your own
        </label>
        <div className="flex gap-2">
          <input
            id={`${id}-custom`}
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value)
              setCustomError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            placeholder="e.g. Calligraphy"
            maxLength={120}
            className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!custom.trim()}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {customError && <p className="text-xs text-red-600 mt-1">{customError}</p>}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600 mt-2 font-medium">{error}</p>
      )}
    </fieldset>
  )
}
