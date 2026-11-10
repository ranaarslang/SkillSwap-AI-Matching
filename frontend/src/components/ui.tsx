import type { User } from '../api'
import { displayName, initials } from '../api'

export function Avatar({ user, color, size = 'md' }: { user: User; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-16 w-16 text-xl' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-11 w-11 text-sm'
  return (
    <div
      className={`${cls} shrink-0 rounded-full flex items-center justify-center font-bold text-white`}
      style={{ backgroundColor: color || '#4F46E5' }}
      aria-hidden
    >
      {initials(user)}
    </div>
  )
}

export function Chip({ children, tone = 'indigo' }: { children: React.ReactNode; tone?: 'indigo' | 'amber' }) {
  const cls = tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700'
  return <span className={`inline-block rounded-full ${cls} text-xs font-medium px-2.5 py-1`}>{children}</span>
}

export function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1">
      {score}% match
    </span>
  )
}

export function TrustBadge({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-sky-100 text-sky-800 text-xs font-bold px-2.5 py-1" title="Trust score (0–100)">
      ★ {score} trust
    </span>
  )
}

export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-600 text-white text-xs font-bold px-2.5 py-1" title="Verified account">
      ✓ Verified
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800',
    ACCEPTED: 'bg-emerald-100 text-emerald-800',
    DECLINED: 'bg-red-100 text-red-800',
    COMPLETED: 'bg-indigo-100 text-indigo-800',
    CANCELLED: 'bg-slate-200 text-slate-700',
  }
  const label = status.charAt(0) + status.slice(1).toLowerCase()
  return (
    <span className={`inline-flex items-center rounded-full text-xs font-semibold px-2.5 py-1 ${map[status] || 'bg-slate-100 text-slate-700'}`}>
      {label}
    </span>
  )
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function displayUserName(u: User): string {
  return displayName(u)
}
