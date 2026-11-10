import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AuthScreen from './components/AuthScreen'
import ProfilePanel from './components/ProfilePanel'
import Dashboard from './components/Dashboard'
import ChatHub from './components/ChatHub'
import FeedbackHub from './components/FeedbackHub'
import { Avatar } from './components/ui'
import {
  api,
  ApiError,
  ChatSocket,
  ACCESS_KEY,
  USER_KEY,
  clearAuth,
  displayName,
  getAccessToken,
} from './api'
import type { ChatMessage, Conversation, MatchProfile, Profile, SessionItem, User, WsStatus } from './api'

type Tab = 'profile' | 'dashboard' | 'chat' | 'feedback'

const TABS: { id: Tab; label: string; short: string; icon: string }[] = [
  { id: 'profile', label: 'Create Your Skill Account', short: 'Account', icon: '👤' },
  { id: 'dashboard', label: 'AI Match Dashboard', short: 'Matches', icon: '🤖' },
  { id: 'chat', label: 'Chat & Scheduler Hub', short: 'Chat', icon: '💬' },
  { id: 'feedback', label: 'Session Feedback Hub', short: 'Feedback', icon: '⭐' },
]

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY)
      return raw ? (JSON.parse(raw) as User) : null
    } catch {
      return null
    }
  })
  const [authed, setAuthed] = useState<boolean>(() => !!getAccessToken())
  const [tab, setTab] = useState<Tab>('dashboard')
  const [searchQuery, setSearchQuery] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [matches, setMatches] = useState<MatchProfile[]>([])
  const [community, setCommunity] = useState<MatchProfile[]>([])
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedPeer, setSelectedPeer] = useState<User | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [wsStatus, setWsStatus] = useState<WsStatus>('offline')
  const [toast, setToast] = useState('')
  const socketRef = useRef<ChatSocket | null>(null)
  const selectedPeerRef = useRef<User | null>(null)
  selectedPeerRef.current = selectedPeer

  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [p, m, c, s, conv] = await Promise.all([
        api.getMyProfile(),
        api.getMatches(),
        api.getCommunity(),
        api.getSessions(),
        api.getConversations(),
      ])
      setProfile(p)
      setMatches(m)
      setCommunity(c)
      setSessions(s)
      setConversations(conv)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.detail : 'Could not load your data.')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api.getSessions())
    } catch {
      /* keep old list; error shown on full load */
    }
  }, [])

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await api.getConversations())
    } catch {
      /* keep old list */
    }
  }, [])

  const doLogout = useCallback(() => {
    socketRef.current?.close()
    clearAuth()
    setUser(null)
    setAuthed(false)
    setProfile(null)
    setMatches([])
    setCommunity([])
    setSessions([])
    setConversations([])
    setSelectedPeer(null)
    setMessages([])
    setTab('dashboard')
  }, [])

  // Route back to login when the API client gives up on refresh (401).
  useEffect(() => {
    const onUnauthorized = () => doLogout()
    window.addEventListener('skillswap:unauthorized', onUnauthorized)
    return () => window.removeEventListener('skillswap:unauthorized', onUnauthorized)
  }, [doLogout])

  // Load data + open the live-chat socket after login
  useEffect(() => {
    if (!authed) return
    loadAll()
    const socket = new ChatSocket()
    socketRef.current = socket
    socket.onStatus = (s) => setWsStatus(s)
    socket.onMessage = (msg) => {
      const peer = selectedPeerRef.current
      if (peer && (msg.sender.id === peer.id || msg.recipient.id === peer.id)) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
      }
      refreshConversations()
    }
    socket.onReconnect = () => {
      // Reconnect: reload history from the REST API so nothing is missed.
      const peer = selectedPeerRef.current
      if (peer) {
        api.getMessages(peer.id).then(setMessages).catch(() => undefined)
      }
      refreshConversations()
    }
    socket.connect()
    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [authed, loadAll, refreshConversations])

  function handleAuthed(u: User) {
    setUser(u)
    setAuthed(true)
    setTab('dashboard')
  }

  async function handleLogout() {
    try {
      await api.logout()
    } catch {
      /* token may already be invalid — still log out locally */
    }
    doLogout()
  }

  async function selectPeer(peer: User | null) {
    setSelectedPeer(peer)
    setMessages([])
    setMessagesError('')
    if (!peer) return
    setMessagesLoading(true)
    try {
      setMessages(await api.getMessages(peer.id))
    } catch (err) {
      setMessagesError(err instanceof ApiError ? err.detail : 'Could not load messages.')
    } finally {
      setMessagesLoading(false)
    }
  }

  function openChatWith(peerProfile: MatchProfile) {
    setSelectedPeer(peerProfile.user)
    setTab('chat')
    selectPeer(peerProfile.user)
  }

  // When a message is sent via REST, also push it over the socket for live delivery.
  function handleSent(msg: ChatMessage) {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    if (selectedPeer) socketRef.current?.send(selectedPeer.id, msg.body)
  }

  function handleSearchChange(v: string) {
    setSearchQuery(v)
    if (v && tab !== 'dashboard') setTab('dashboard')
  }

  const peerProfiles = useMemo(() => {
    const map = new Map<number, MatchProfile>()
    ;[...matches, ...community].forEach((p) => map.set(p.user.id, p))
    return map
  }, [matches, community])

  const unreadTotal = conversations.reduce((n, c) => n + c.unread_count, 0)

  if (!authed || !user) {
    return <AuthScreen onAuthed={handleAuthed} />
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar — flex-wrap so the search input stays visible on phone widths */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <button onClick={() => setTab('dashboard')} className="text-xl font-extrabold text-indigo-600 shrink-0">
            Skill Swap Platform with AI Matching
          </button>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search people, skills…"
            aria-label="Search matches"
            className="search flex-1 min-w-[160px] rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <Avatar user={user} color={profile?.avatar_color} size="sm" />
            <span className="hidden sm:block text-sm font-semibold text-slate-700">{displayName(user)}</span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 pb-24 md:pb-10 flex gap-6">
        {/* Persistent left sidebar (desktop) */}
        <nav className="hidden md:block w-60 shrink-0" aria-label="Main">
          <div className="sticky top-20 space-y-1">
            <ul className="space-y-1">
              {TABS.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setTab(t.id)}
                    aria-current={tab === t.id ? 'page' : undefined}
                    className={`w-full text-left rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-3 ${
                      tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span aria-hidden>{t.icon}</span> {t.label}
                    {t.id === 'chat' && unreadTotal > 0 && (
                      <span className="ml-auto rounded-full bg-red-500 text-white text-[11px] font-bold px-2 py-0.5">{unreadTotal}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={handleLogout}
              className="w-full text-left rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-3 text-red-700 hover:bg-red-50 mt-4"
            >
              <span aria-hidden>🚪</span> Log out
            </button>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {toast && (
            <div role="status" className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-2.5">
              {toast}
            </div>
          )}
          {tab === 'profile' && (
            <ProfilePanel
              user={user}
              profile={profile}
              onSaved={(p) => {
                setProfile(p)
                setToast('Profile saved ✓ Loading your AI matches…')
                loadAll()
                setTab('dashboard')
              }}
            />
          )}
          {tab === 'dashboard' && (
            <Dashboard
              matches={matches}
              community={community}
              searchQuery={searchQuery}
              onClearSearch={() => setSearchQuery('')}
              onConnect={openChatWith}
              sessionCount={sessions.length}
              loading={loading}
              error={loadError}
            />
          )}
          {tab === 'chat' && (
            <ChatHub
              conversations={conversations}
              peerProfiles={peerProfiles}
              selectedPeer={selectedPeer}
              messages={messages}
              messagesLoading={messagesLoading}
              messagesError={messagesError}
              wsStatus={wsStatus}
              currentUserId={user.id}
              sessions={sessions}
              onSelectPeer={selectPeer}
              onSent={handleSent}
              onRefreshConversations={refreshConversations}
              onSessionsChanged={refreshSessions}
            />
          )}
          {tab === 'feedback' && (
            <FeedbackHub sessions={sessions} currentUserId={user.id} peerProfiles={peerProfiles} loading={loading} error={loadError} />
          )}
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200" aria-label="Main mobile">
        <ul className="grid grid-cols-4">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`w-full py-3 text-[11px] font-semibold flex flex-col items-center gap-0.5 ${tab === t.id ? 'text-indigo-600' : 'text-slate-500'}`}
              >
                <span aria-hidden className="text-lg leading-none">{t.icon}</span>
                {t.short}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
