import { useMemo, useState } from 'react'
import type { ChatMessage, Conversation, MatchProfile, SessionItem, User, WsStatus } from '../api'
import { api, ApiError, displayName } from '../api'
import { Avatar, StatusBadge, fmtDate } from './ui'

const DURATION_OPTIONS = ['30 Minutes', '1 Hour Mutual Swap', '2 Hours']

interface Props {
  conversations: Conversation[]
  peerProfiles: Map<number, MatchProfile>
  selectedPeer: User | null
  messages: ChatMessage[]
  messagesLoading: boolean
  messagesError: string
  wsStatus: WsStatus
  currentUserId: number
  sessions: SessionItem[]
  onSelectPeer: (peer: User | null) => void
  onSent: (msg: ChatMessage) => void
  onRefreshConversations: () => void
  onSessionsChanged: () => void
}

function otherPerson(s: SessionItem, me: number): User {
  return s.partner_one.id === me ? s.partner_two : s.partner_one
}

export default function ChatHub(props: Props) {
  const { conversations, selectedPeer, messages, sessions } = props
  const [filter, setFilter] = useState('')
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const [schedDate, setSchedDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10))
  const [schedDuration, setSchedDuration] = useState(DURATION_OPTIONS[1])
  const [schedError, setSchedError] = useState('')
  const [schedOk, setSchedOk] = useState('')
  const [schedBusy, setSchedBusy] = useState(false)
  const [sessionActionError, setSessionActionError] = useState('')

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => {
      const p = props.peerProfiles.get(c.peer.id)
      const hay = [displayName(c.peer), c.peer.username, ...(p?.teach_skills || []), ...(p?.learn_skills || []), p?.bio || '']
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [conversations, filter, props.peerProfiles])

  // Context label: top overlapping skill with the selected peer
  const peerProfile = selectedPeer ? props.peerProfiles.get(selectedPeer.id) : undefined
  const tradingSkill =
    peerProfile?.can_teach_you?.[0] || peerProfile?.you_can_teach_them?.[0] || peerProfile?.teach_skills?.[0] || 'Skill swap'

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || !selectedPeer || sending) return
    setSendError('')
    setSending(true)
    try {
      // REST first — the source of truth. "Sent" only after this succeeds.
      const created = await api.sendMessage({ recipient_id: selectedPeer.id, body })
      props.onSent(created)
      setDraft('')
      props.onRefreshConversations()
    } catch (err) {
      setSendError(err instanceof ApiError ? err.detail : 'Message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  async function finalizeSession(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPeer) return
    setSchedError('')
    setSchedOk('')
    setSchedBusy(true)
    try {
      await api.createSession({
        partner_id: selectedPeer.id,
        calendar_date: schedDate,
        duration_block: schedDuration,
        title: `Skill swap with ${displayName(selectedPeer)}`,
      })
      setSchedOk('Session scheduled — status PENDING. It now appears in My sessions below.')
      props.onSessionsChanged()
    } catch (err) {
      // Server double-booking (or other) errors are shown verbatim.
      setSchedError(err instanceof ApiError ? err.detail : 'Could not schedule the session.')
    } finally {
      setSchedBusy(false)
    }
  }

  async function setSessionStatus(s: SessionItem, status: string) {
    setSessionActionError('')
    try {
      await api.updateSession(s.id, { session_status: status })
      props.onSessionsChanged()
    } catch (err) {
      setSessionActionError(err instanceof ApiError ? err.detail : 'Could not update the session.')
    }
  }

  const mySessions = useMemo(
    () => [...sessions].sort((a, b) => +new Date(b.calendar_date) - +new Date(a.calendar_date)),
    [sessions],
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Chat &amp; Scheduler Hub</h1>
        <p className="text-sm text-slate-500">Message your matches, then lock in a swap session.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid md:grid-cols-[300px_1fr] min-h-[480px]">
          {/* Conversation list */}
          <aside className={`border-b md:border-b-0 md:border-r border-slate-200 ${selectedPeer ? 'hidden md:block' : ''}`}>
            <div className="p-3 border-b border-slate-200">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search chats by name or skill…"
                aria-label="Search conversations"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {filtered.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                {conversations.length === 0 ? 'No messages yet — say hello!' : `No chats match "${filter.trim()}".`}
              </p>
            ) : (
              <ul>
                {filtered.map((c) => {
                  const p = props.peerProfiles.get(c.peer.id)
                  const active = selectedPeer?.id === c.peer.id
                  return (
                    <li key={c.peer.id}>
                      <button
                        onClick={() => props.onSelectPeer(c.peer)}
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 ${active ? 'bg-indigo-50' : ''}`}
                      >
                        <Avatar user={c.peer} color={p?.avatar_color} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-sm text-slate-900 truncate">{displayName(c.peer)}</span>
                            {c.unread_count > 0 && (
                              <span className="shrink-0 rounded-full bg-indigo-600 text-white text-[11px] font-bold px-2 py-0.5">{c.unread_count}</span>
                            )}
                          </span>
                          <span className="block text-xs text-slate-500 truncate">
                            {c.last_message ? c.last_message.body : 'No messages yet — say hello!'}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>

          {/* Message pane */}
          <section className={`flex flex-col ${selectedPeer ? '' : 'hidden md:flex'}`}>
            {!selectedPeer ? (
              <div className="flex-1 flex items-center justify-center p-8 text-center">
                <div>
                  <p className="font-semibold text-slate-800">Pick a conversation</p>
                  <p className="text-sm text-slate-500 mt-1">Choose someone from the list, or connect from the AI Match Dashboard.</p>
                </div>
              </div>
            ) : (
              <>
                <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 flex-wrap">
                  <button onClick={() => props.onSelectPeer(null)} className="md:hidden text-indigo-600 text-sm font-semibold" aria-label="Back to conversations">
                    ← Back
                  </button>
                  <Avatar user={selectedPeer} color={peerProfile?.avatar_color} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{displayName(selectedPeer)}</p>
                    <p className="text-xs text-indigo-700 font-medium truncate">Trading: {tradingSkill}</p>
                  </div>
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      props.wsStatus === 'live' ? 'bg-emerald-100 text-emerald-800' : props.wsStatus === 'connecting' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'
                    }`}
                    title={props.wsStatus === 'live' ? 'Connected to live chat' : 'Socket down — messages still send via the API'}
                  >
                    {props.wsStatus === 'live' ? '● Live' : props.wsStatus === 'connecting' ? '● Connecting…' : '● Offline — messages still send'}
                  </span>
                </header>

                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 max-h-[380px]">
                  {props.messagesLoading ? (
                    <p className="text-sm text-slate-500">Loading messages…</p>
                  ) : props.messagesError ? (
                    <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
                      Couldn&apos;t load messages: {props.messagesError}
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="text-center text-sm text-slate-500 py-10">No messages yet — say hello!</p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.is_mine || m.sender.id === props.currentUserId
                      return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] rounded-xl px-3.5 py-2 text-sm ${mine ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p className={`text-[11px] mt-1 ${mine ? 'text-indigo-200' : 'text-slate-400'}`}>
                              {new Date(m.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {sendError && (
                  <div role="alert" className="mx-4 mb-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{sendError}</div>
                )}
                <form onSubmit={send} className="flex gap-2 px-4 py-3 border-t border-slate-200">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Message ${displayName(selectedPeer)}…`}
                    aria-label="Message"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button type="submit" disabled={sending || !draft.trim()} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2">
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </form>

                {/* Scheduler */}
                <form onSubmit={finalizeSession} className="border-t border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
                  <p className="font-semibold text-sm text-slate-800">Schedule a session with {displayName(selectedPeer)}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="sched-date">Date</label>
                      <input
                        id="sched-date"
                        type="date"
                        value={schedDate}
                        onChange={(e) => setSchedDate(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="sched-duration">Duration</label>
                      <select
                        id="sched-duration"
                        value={schedDuration}
                        onChange={(e) => setSchedDuration(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {DURATION_OPTIONS.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {schedError && <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{schedError}</div>}
                  {schedOk && <div role="status" className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">{schedOk}</div>}
                  <button type="submit" disabled={schedBusy} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold px-5 py-2.5">
                    {schedBusy ? 'Scheduling…' : 'Finalize & Track Session'}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      </div>

      {/* My sessions */}
      <section>
        <h2 className="text-lg font-bold text-slate-900 mb-3">My sessions ({mySessions.length})</h2>
        {sessionActionError && (
          <div role="alert" className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{sessionActionError}</div>
        )}
        {mySessions.length === 0 ? (
          <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 p-4">
            No sessions yet — pick a date above with a chat partner to schedule your first swap.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {mySessions.map((s) => {
              const other = otherPerson(s, props.currentUserId)
              const iAmPartnerTwo = s.partner_two.id === props.currentUserId
              return (
                <article key={s.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <div className="flex items-start gap-3">
                    <Avatar user={other} color={props.peerProfiles.get(other.id)?.avatar_color} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-slate-900">{s.title || `Skill swap with ${displayName(other)}`}</h3>
                      <p className="text-sm text-slate-500">with {displayName(other)} (@{other.username})</p>
                      <p className="text-sm text-slate-600 mt-1">{fmtDate(s.calendar_date)} · {s.duration_block}</p>
                    </div>
                    <StatusBadge status={s.session_status} />
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {s.session_status === 'PENDING' && iAmPartnerTwo && (
                      <button onClick={() => setSessionStatus(s, 'ACCEPTED')} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2">Accept</button>
                    )}
                    {(s.session_status === 'PENDING' || s.session_status === 'ACCEPTED') && (
                      <button onClick={() => setSessionStatus(s, 'CANCELLED')} className="rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm font-semibold px-4 py-2">Cancel</button>
                    )}
                    {s.session_status === 'ACCEPTED' && (
                      <button onClick={() => setSessionStatus(s, 'COMPLETED')} className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2">Mark complete</button>
                    )}
                    {s.session_status === 'PENDING' && !iAmPartnerTwo && (
                      <span className="text-xs text-slate-500 self-center">Waiting for {displayName(other)} to accept.</span>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
