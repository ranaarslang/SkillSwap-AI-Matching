import { useMemo, useState } from 'react'
import type { MatchProfile } from '../api'
import { displayName } from '../api'
import { Avatar, Chip, ScoreBadge, TrustBadge, VerifiedBadge } from './ui'

interface Props {
  matches: MatchProfile[]
  community: MatchProfile[]
  searchQuery: string
  onClearSearch: () => void
  onConnect: (profile: MatchProfile) => void
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

function MatchCard({ profile, isMatch, onConnect }: { profile: MatchProfile; isMatch: boolean; onConnect: () => void }) {
  const why: string[] = []
  if (profile.can_teach_you?.length) why.push(`They can teach you: ${profile.can_teach_you.join(', ')}`)
  if (profile.you_can_teach_them?.length) why.push(`You can teach them: ${profile.you_can_teach_them.join(', ')}`)
  return (
    <article className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Avatar user={profile.user} color={profile.avatar_color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-slate-900 truncate">{displayName(profile.user)}</h3>
            {profile.verified_badge && <VerifiedBadge />}
          </div>
          <p className="text-sm text-slate-500 truncate">@{profile.user.username}</p>
          {profile.location && <p className="text-sm text-slate-500 mt-0.5">📍 {profile.location}</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {isMatch ? <ScoreBadge score={profile.match_score} /> : <span className="text-xs font-semibold text-slate-400 bg-slate-100 rounded-full px-2.5 py-1">below 50%</span>}
          <TrustBadge score={profile.trust_score} />
        </div>
      </div>

      {why.length > 0 && <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{why.join(' · ')}</p>}
      {profile.same_location && profile.location_bonus > 0 && (
        <p className="text-sm text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2">+{profile.location_bonus} same-city bonus</p>
      )}
      {profile.bio && <p className="text-sm text-slate-600 line-clamp-3">{profile.bio}</p>}

      {profile.teach_skills?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1">Superpowers</p>
          <div className="flex flex-wrap gap-1.5">{profile.teach_skills.map((s) => <Chip key={s}>{s}</Chip>)}</div>
        </div>
      )}
      {profile.learn_skills?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1">Growth Desires</p>
          <div className="flex flex-wrap gap-1.5">
            {profile.learn_skills.map((s) => (
              <Chip key={s} tone="amber">{s}</Chip>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-slate-500 mt-auto pt-1">
        <span>{profile.availability ? `Available: ${profile.availability}` : ''}</span>
        {profile.portfolio_link && (
          <a href={profile.portfolio_link} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline font-medium">
            Portfolio ↗
          </a>
        )}
      </div>

      <button onClick={onConnect} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2">
        Connect &amp; Chat
      </button>
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
        <h1 className="text-xl font-extrabold text-slate-900">AI Match Dashboard</h1>
        <p className="text-sm text-slate-500">People whose skills complement yours, ranked by AI match score.</p>
      </div>

      {/* Stats row — real numbers from the API only */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div className="text-2xl font-extrabold text-indigo-600">{matches.length}</div>
          <div className="text-xs text-slate-500 font-medium">AI matches (50%+)</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div className="text-2xl font-extrabold text-indigo-600">{community.length}</div>
          <div className="text-xs text-slate-500 font-medium">In the community</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
          <div className="text-2xl font-extrabold text-indigo-600">{props.sessionCount}</div>
          <div className="text-xs text-slate-500 font-medium">Your sessions</div>
        </div>
      </div>

      {props.error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
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
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="All cities">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {q && (
          <span className="text-sm text-indigo-800 bg-indigo-50 rounded-lg px-3 py-2">
            {totalResults} result{totalResults === 1 ? '' : 's'} for &lsquo;{searchQuery.trim()}&rsquo;
            {' · '}
            <button onClick={onClearSearch} className="font-semibold hover:underline">Clear search</button>
          </span>
        )}
      </div>

      {props.loading ? (
        <p className="text-slate-500 text-sm">Finding your AI matches…</p>
      ) : totalResults === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
          <p className="font-semibold text-slate-800">
            {q ? `No results for '${searchQuery.trim()}'` : 'No matches found. Try updating your skill definitions.'}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {q ? 'Try a different name or skill.' : 'Add Superpowers and Growth Desires in your skill account to find matches.'}
          </p>
          {q && (
            <button onClick={onClearSearch} className="mt-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold px-4 py-2">
              Clear search
            </button>
          )}
        </div>
      ) : (
        <>
          {filteredMatches.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">Made for you</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredMatches.map((m) => (
                  <MatchCard key={m.user.id} profile={m} isMatch onConnect={() => props.onConnect(m)} />
                ))}
              </div>
            </section>
          )}
          {filteredCommunity.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">Also in the community</h2>
              <p className="text-sm text-slate-500 mb-3">Below 50% match — no shared skills yet, but worth a hello.</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredCommunity.map((m) => (
                  <MatchCard key={m.user.id} profile={m} isMatch={false} onConnect={() => props.onConnect(m)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
