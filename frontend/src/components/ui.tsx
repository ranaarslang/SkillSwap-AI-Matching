import type { User } from '../api'
import { displayName, initials } from '../api'

// ---- Inline SVG icons (professional, no emoji in the nav) -----------------
function Svg({ d, className = 'h-5 w-5' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  )
}

export const IconUser = ({ className }: { className?: string }) => (
  <Svg className={className} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
)

export const IconSpark = ({ className }: { className?: string }) => (
  <Svg className={className} d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
)

export const IconChat = ({ className }: { className?: string }) => (
  <Svg className={className} d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
)

export const IconStar = ({ className }: { className?: string }) => (
  <Svg className={className} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
)

export const IconLogout = ({ className }: { className?: string }) => (
  <Svg className={className} d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
)

export const IconClose = ({ className }: { className?: string }) => (
  <Svg className={className} d="M18 6L6 18M6 6l12 12" />
)

export const IconPin = ({ className }: { className?: string }) => (
  <Svg className={className} d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
)

export const IconCheck = ({ className }: { className?: string }) => (
  <Svg className={className} d="M20 6L9 17l-5-5" />
)

export const IconSwap = ({ className }: { className?: string }) => (
  <Svg className={className} d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
)

export const IconShield = ({ className }: { className?: string }) => (
  <Svg className={className} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" />
)

export const IconSearch = ({ className }: { className?: string }) => (
  <Svg className={className} d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35" />
)

// ---- Primitives ------------------------------------------------------------
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  const iconCls = className.includes('h-11') ? 'h-6 w-6' : className.includes('h-8') ? 'h-4 w-4' : 'h-5 w-5'
  return (
    <span className={`logo-mark shrink-0 ${className}`} aria-hidden>
      <IconSwap className={iconCls} />
    </span>
  )
}

export function Avatar({ user, color, size = 'md' }: { user: User; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-16 w-16 text-xl' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-11 w-11 text-sm'
  return (
    <div
      className={`${cls} shrink-0 rounded-full flex items-center justify-center font-bold text-white ring-2 ring-white shadow-md`}
      style={{ backgroundColor: color || '#4F46E5', boxShadow: '0 4px 12px -2px rgb(15 23 42 / 0.25), inset 0 -10px 18px rgb(0 0 0 / 0.18)' }}
      aria-hidden
    >
      {initials(user)}
    </div>
  )
}

export function Chip({ children, tone = 'indigo' }: { children: React.ReactNode; tone?: 'indigo' | 'emerald' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/25' : 'bg-indigo-50 text-indigo-700 ring-indigo-600/25'
  return <span className={`inline-block rounded-full ring-1 ring-inset ${cls} text-xs font-semibold px-2.5 py-1 shadow-sm`}>{children}</span>
}

/** Prominent match-score ring (SVG): the score is the hero of a match card. */
export function ScoreRing({ score, size = 68 }: { score: number; size?: number }) {
  const r = 28
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score))
  const offset = c * (1 - pct / 100)
  const gradId = `score-grad-${score >= 75 ? 'hi' : score >= 60 ? 'mid' : 'lo'}`
  const stops =
    score >= 75
      ? [['#7c3aed', '0%'], ['#4f46e5', '100%']]
      : score >= 60
        ? [['#6366f1', '0%'], ['#4f46e5', '100%']]
        : [['#0ea5e9', '0%'], ['#6366f1', '100%']]
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${score}% match`}>
      <svg width={size} height={size} viewBox="0 0 68 68" className="-rotate-90">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            {stops.map(([color, off]) => (
              <stop key={off} offset={off} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
        <circle cx="34" cy="34" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle
          cx="34"
          cy="34"
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-extrabold leading-none tracking-tight text-slate-900">{score}%</span>
        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">match</span>
      </div>
    </div>
  )
}

export function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-xs font-bold px-2.5 py-1 shadow-sm">
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" /> {score}% match
    </span>
  )
}

export function TrustBadge({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 text-xs font-semibold px-2.5 py-1 shadow-sm" title="Trust score (0–100)">
      <span className="text-amber-500">★</span>&nbsp;{score} trust
    </span>
  )
}

export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold px-2.5 py-1 shadow-sm" title="Verified account">
      ✓ Verified
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800 ring-amber-200',
    ACCEPTED: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    DECLINED: 'bg-red-100 text-red-800 ring-red-200',
    COMPLETED: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
    CANCELLED: 'bg-slate-200 text-slate-700 ring-slate-300',
  }
  const label = status.charAt(0) + status.slice(1).toLowerCase()
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset text-xs font-semibold px-2.5 py-1 shadow-sm ${map[status] || 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
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
