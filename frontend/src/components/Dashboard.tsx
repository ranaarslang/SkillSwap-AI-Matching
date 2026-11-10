import { useMemo, useState } from 'react'
import type { MatchProfile } from '../api'
import { displayName } from '../api'
import { Avatar, Chip, IconPin, ScoreBadge, TrustBadge, VerifiedBadge } from './ui'

interface Props {
  matches: MatchProfile[]
  community: MatchProfile[]
  searchQuery: string
  onClearSearch: () => void
  onConnect: (profile: MatchProfile) => void
  onViewProfile: (profile: MatchProfile) => void
  sessionCount: number
  loading: boolean
  error: string
}

function matchesQuery(p: MatchProfile, q: string): boolean {
  const hay = [displayName(p.user), p.user.username, p.bio, p.location, ...p.teach_skills, ...p.learn_skills]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

function MatchCard({
  profile,
  isMatch,
  onConnect,
  onViewProfile,
}: {
  profile: MatchProfile
  isMatch: boolean
  onConnect: () => void
  onViewProfile: () => void
}) {
  const why: string[] = []
  if (profile.can_teach_you?.length) why.push(`They can teach you: ${profile.can_teach_you.join(', ')}`)
  if (profile.you_can_teach_them?.length) why.push(`You can teach them: ${profile.you_can_teach_them.join(', ')}`)
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <button onClick={onViewProfile} aria-label={`View ${displayName(profile.user)}'s profile`} className="shrink-0 rounded-full">
          <Avatar user={profile.user} color={profile.avatar_color} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onViewProfile} className="truncate font-bold text-slate-900 hover:text-indigo-700 hover:underline">
              {displayName(profile.user)}
            </button>
            {profile.verified_badge && <VerifiedBadge />}
          </div>
          <p className="truncate text-sm text-slate-500">@{profile.user.username}</p>
          {profile.location && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-slate-500">
              <IconPin className="h-3.5 w-3.5" /> {profile.location}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {isMatch ? <ScoreBadge score={profile.match_score} /> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">below 50%</span>}
          <TrustBadge score={profile.trust_score} />
        </div>
      </div>

      {why.length > 0 && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-100">{why.join(' · ')}</p>}
      {profile.same_location && profile.location_bonus > 0 && (
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-100">+{profile.location_bonus} same-city bonus</p>
      )}
      {profile.bio && <p className="line-clamp-3 text-sm leading-relaxed text-slate-600">{profile.bio}</p>}

      {profile.teach_skills?.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Can teach you</p>
          <div className="flex flex-wrap gap-1.5">{profile.teach_skills.map((s) => <Chip key={s}>{s}</Chip>)}</div>
        </div>
      )}
      {profile.learn_skills?.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Wants to learn</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.learn_skills.map((s) => (
              <Chip key={s} tone="emerald">{s}</Chip>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between pt-1 text-xs text-slate-500">
        <span>{profile.availability ? `Available: ${profile.availability}` : ''}</span>
        {profile.portfolio_link && (
          <a href={profile.portfolio_link} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:underline">
            Portfolio ↗
          </a>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={onConnect} className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
          Message
        </button>
        <button onClick={onViewProfile} className="flex-1 rounded-lg border border-slate-300 bg-white py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          View profile
        </button>
      </div>
    </article>
  )
}

export default function Dashboard(props: Props) {
  const { matches, community, searchQuery, onClearSearch } = props
  const [cityFilter, setCityFilter] = useState('All cities')

  const cities = useMemo(() => {
    const set = new Set<string>()
    ;[...matches, ...community].forEach((p) => {
      if (p.location) set.add(p.location)
    })
    return [...set].sort()
  }, [matches, community])

  const q = searchQuery.trim().toLowerCase()
  const applyFilters = (list: MatchProfile[]) =>
    list.filter((m) => (!q || matchesQuery(m, q)) && (cityFilter === 'All cities' || m.location === cityFilter))
  const filteredMatches = useMemo(() => applyFilters(matches), [matches, q, cityFilter])
  const filteredCommunity = useMemo(() => applyFilters(community), [community, q, cityFilter])
  const totalResults = filteredMatches.length + filteredCommunity.length

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">AI Match Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">People whose skills complement yours, ranked by AI match score. Click any name to see their full profile.</p>
      </div>

      {/* Stats row — real numbers from the API only */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { value: matches.length, label: 'AI matches (50%+)' },
          { value: community.length, label: 'In the community' },
          { value: props.sessionCount, label: 'Your sessions' },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className="text-2xl font-bold tracking-tight text-indigo-600">{s.value}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>

      {props.error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          Couldn&apos;t load matches: {props.error}
        </div>
      )}

      {/* Location filter */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="city-filter" className="text-sm font-semibold text-slate-600">Location</label>
        <select
          id="city-filter"
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="All cities">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {q && (
          <span className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 ring-1 ring-inset ring-indigo-100">
            {totalResults} result{totalResults === 1 ? '' : 's'} for &lsquo;{searchQuery.trim()}&rsquo;
            {' · '}
            <button onClick={onClearSearch} className="font-semibold hover:underline">Clear search</button>
          </span>
        )}
      </div>

      {props.loading ? (
        <p className="text-sm text-slate-500">Finding your AI matches…</p>
      ) : totalResults === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="font-semibold text-slate-800">
            {q ? `No results for '${searchQuery.trim()}'` : 'No matches found. Try updating your skill definitions.'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {q ? 'Try a different name or skill.' : 'Add Superpowers and Growth Desires in your skill account to find matches.'}
          </p>
          {q && (
            <button onClick={onClearSearch} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
              Clear search
            </button>
          )}
        </div>
      ) : (
        <>
          {filteredMatches.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-bold tracking-tight text-slate-900">
                Made for you <span className="ml-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">{filteredMatches.length}</span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredMatches.map((m) => (
                  <MatchCard key={m.user.id} profile={m} isMatch onConnect={() => props.onConnect(m)} onViewProfile={() => props.onViewProfile(m)} />
                ))}
              </div>
            </section>
          )}
          {filteredCommunity.length > 0 && (
            <section>
              <h2 className="mb-1 text-lg font-bold tracking-tight text-slate-900">
                Also in the community <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">{filteredCommunity.length}</span>
              </h2>
              <p className="mb-3 text-sm text-slate-500">Below 50% match — no shared skills yet, but worth a hello.</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredCommunity.map((m) => (
                  <MatchCard key={m.user.id} profile={m} isMatch={false} onConnect={() => props.onConnect(m)} onViewProfile={() => props.onViewProfile(m)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
