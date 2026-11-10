import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AuthScreen from './components/AuthScreen'
import ProfilePanel from './components/ProfilePanel'
import Dashboard from './components/Dashboard'
import ChatHub from './components/ChatHub'
import FeedbackHub from './components/FeedbackHub'
import AdminPanel from './components/AdminPanel'
import ProfileModal from './components/ProfileModal'
import { Avatar, IconChat, IconLogout, IconShield, IconSpark, IconStar, IconSwap, IconUser } from './components/ui'
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

type Tab = 'profile' | 'dashboard' | 'chat' | 'feedback' | 'admin'

type TabDef = { id: Tab; label: string; short: string; Icon: (p: { className?: string }) => JSX.Element }

const TABS: TabDef[] = [
  { id: 'profile', label: 'Create Your Skill Account', short: 'Account', Icon: IconUser },
  { id: 'dashboard', label: 'AI Match Dashboard', short: 'Matches', Icon: IconSpark },
  { id: 'chat', label: 'Chat & Scheduler Hub', short: 'Chat', Icon: IconChat },
  { id: 'feedback', label: 'Session Feedback Hub', short: 'Feedback', Icon: IconStar },
]

const ADMIN_TAB: TabDef = { id: 'admin', label: 'Admin Panel', short: 'Admin', Icon: IconShield }

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
  const [viewingProfile, setViewingProfile] = useState<{ profile: MatchProfile; isMatch: boolean; hideScore?: boolean } | null>(null)
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
    setViewingProfile(null)
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
    setViewingProfile(null)
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

  // Staff users get the Admin entry; everyone else never sees it.
  const visibleTabs: TabDef[] = user?.is_staff ? [...TABS, ADMIN_TAB] : TABS

  if (!authed || !user) {
    return <AuthScreen onAuthed={handleAuthed} />
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Top bar — flex-wrap so the search input stays visible on phone widths */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <button onClick={() => setTab('dashboard')} className="flex shrink-0 items-center gap-2.5 text-left" aria-label="Skill Swap Platform with AI Matching — go to dashboard">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <IconSwap className="h-5 w-5" />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-bold tracking-tight text-slate-900">Skill Swap Platform</span>
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-indigo-600">with AI Matching</span>
            </span>
          </button>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search people, skills…"
            aria-label="Search matches"
            className="search min-w-[160px] flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Avatar user={user} color={profile?.avatar_color} size="sm" />
            <span className="hidden text-sm font-semibold text-slate-700 sm:block">{displayName(user)}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 pb-24 pt-6 md:pb-10">
        {/* Persistent left sidebar (desktop) */}
        <nav className="hidden w-64 shrink-0 md:block" aria-label="Main">
          <div className="sticky top-[76px] space-y-6">
            <div>
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Menu</p>
              <ul className="space-y-1">
                {visibleTabs.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => setTab(t.id)}
                      aria-current={tab === t.id ? 'page' : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                        tab === t.id ? 'bg-indigo-50 text-indigo-700 shadow-sm ring-1 ring-inset ring-indigo-100' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                      }`}
                    >
                      <t.Icon className="h-5 w-5 shrink-0" />
                      {t.label}
                      {t.id === 'chat' && unreadTotal > 0 && (
                        <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">{unreadTotal}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Avatar user={user} color={profile?.avatar_color} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{displayName(user)}</p>
                  <p className="truncate text-xs text-slate-500">{user.email}</p>
                  {profile && (
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">
                      ★ {profile.trust_score} trust{profile.verified_badge ? ' · ✓ Verified' : ''}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <IconLogout className="h-4 w-4" /> Log out
              </button>
            </div>
            <p className="px-3 text-[11px] leading-relaxed text-slate-400">
              Skill Swap Platform with AI Matching — teach what you know, learn what you don&apos;t.
            </p>
          </div>
        </nav>

        {/* Main content */}
        <main className="min-w-0 flex-1">
          {toast && (
            <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
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
              onViewProfile={(p) => setViewingProfile({ profile: p, isMatch: matches.some((m) => m.user.id === p.user.id), hideScore: false })}
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
          {tab === 'admin' && user.is_staff && (
            <AdminPanel
              currentUserId={user.id}
              onMessage={openChatWith}
            />
          )}
        </main>
      </div>

      {/* Full profile modal */}
      {viewingProfile && (
        <ProfileModal
          profile={viewingProfile.profile}
          isMatch={viewingProfile.isMatch}
          hideScore={viewingProfile.hideScore}
          onClose={() => setViewingProfile(null)}
          onMessage={openChatWith}
        />
      )}

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white md:hidden" aria-label="Main mobile">
        <ul className={`grid ${visibleTabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
          {visibleTabs.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`relative flex w-full flex-col items-center gap-0.5 py-3 text-[11px] font-semibold ${tab === t.id ? 'text-indigo-600' : 'text-slate-500'}`}
              >
                <t.Icon className="h-5 w-5" />
                {t.short}
                {t.id === 'chat' && unreadTotal > 0 && (
                  <span className="absolute right-4 top-1.5 rounded-full bg-red-500 px-1.5 py-px text-[10px] font-bold text-white">{unreadTotal}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
