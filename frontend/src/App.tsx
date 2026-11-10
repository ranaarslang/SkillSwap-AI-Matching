import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AuthScreen from './components/AuthScreen'
import ProfilePanel from './components/ProfilePanel'
import Dashboard from './components/Dashboard'
import ChatHub from './components/ChatHub'
import FeedbackHub from './components/FeedbackHub'
import AdminPanel from './components/AdminPanel'
import ProfileModal from './components/ProfileModal'
import { Avatar, IconChat, IconLogout, IconSearch, IconShield, IconSpark, IconStar, IconUser, LogoMark } from './components/ui'
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
  const [adminLogin, setAdminLogin] = useState<boolean>(() => window.location.hash === '#/admin-login')
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
    // Leaving the admin login page returns to the normal student login.
    if (window.location.hash === '#/admin-login') window.location.hash = ''
    setAdminLogin(false)
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

  // Dedicated admin login lives at #/admin-login (no signup there).
  useEffect(() => {
    const onHash = () => setAdminLogin(window.location.hash === '#/admin-login')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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

  function handleAuthed(u: User, opts?: { adminLogin?: boolean }) {
    setUser(u)
    setAuthed(true)
    // Staff signing in through the dedicated admin login page land
    // straight on the Admin Panel; everyone else lands on the dashboard.
    setTab(opts?.adminLogin && u.is_staff ? 'admin' : 'dashboard')
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

  // The admin area is a different product surface: a dark console with an
  // emerald accent, so it can never be mistaken for the student app.
  const isAdminView = tab === 'admin' && !!user?.is_staff

  if (!authed || !user) {
    return <AuthScreen variant={adminLogin ? 'admin' : undefined} onAuthed={handleAuthed} />
  }

  return (
    <div
      className={`min-h-screen ${isAdminView ? 'bg-slate-950 text-slate-200' : ''}`}
      style={isAdminView ? { backgroundImage: 'radial-gradient(50rem 24rem at 85% -10%, rgba(16,185,129,0.10), transparent 60%)' } : undefined}
    >
      {/* Top bar — flex-wrap so the search input stays visible on phone widths */}
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur ${
          isAdminView
            ? 'border-slate-800 bg-slate-950/95 shadow-[0_1px_12px_rgba(0,0,0,0.45)]'
            : 'border-violet-400/20 bg-gradient-to-r from-indigo-950 via-[#1b1740] to-violet-950 shadow-[0_8px_30px_-6px_rgba(30,27,75,0.7)]'
        }`}
      >
        {/* Student-only dark-premium dressing: a soft violet glow wash plus a
            bright gradient hairline along the bottom edge. Admin keeps its
            plain dark border. */}
        {!isAdminView && (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_10rem_at_12%_-40%,rgba(139,92,246,0.35),transparent_60%),radial-gradient(30rem_8rem_at_88%_-30%,rgba(56,189,248,0.22),transparent_60%)]" />
            <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-violet-400 via-fuchsia-400 to-sky-400" />
          </>
        )}
        <div className="relative mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          {isAdminView ? (
            <button onClick={() => setTab('dashboard')} className="flex shrink-0 items-center gap-2.5 text-left" aria-label="Admin Console — back to student app">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30">
                <IconShield className="h-5 w-5" />
              </span>
              <span className="leading-tight">
                <span className="block text-[15px] font-extrabold tracking-tight text-white">Admin Console</span>
                <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-400">Skill Swap Platform</span>
              </span>
            </button>
          ) : (
            <button onClick={() => setTab('dashboard')} className="group flex shrink-0 items-center gap-3 text-left transition hover:opacity-95" aria-label="Skill Swap Platform with AI Matching — go to dashboard">
              <LogoMark className="h-11 w-11 ring-1 ring-violet-300/50 shadow-[0_0_22px_rgba(167,139,250,0.55)] transition group-hover:shadow-[0_0_28px_rgba(167,139,250,0.75)]" />
              <span className="leading-tight">
                <span className="block text-[17px] font-extrabold tracking-tight text-white">Skill Swap <span className="bg-gradient-to-r from-violet-300 to-sky-300 bg-clip-text text-transparent">Platform</span></span>
                <span className="block text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300">with AI Matching</span>
              </span>
            </button>
          )}
          {!isAdminView && (
            <div className="relative min-w-[180px] flex-1 sm:mx-4 sm:max-w-md">
              <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-200/70" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search people, skills…"
                aria-label="Search matches"
                className="search w-full rounded-full border border-white/15 bg-white/10 py-2 pl-10 pr-4 text-sm text-white shadow-sm placeholder:text-indigo-200/60 focus:border-violet-300/60 focus:bg-white/15 focus:outline-none focus:ring-4 focus:ring-violet-400/25"
              />
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {isAdminView ? (
              <>
                <Avatar user={user} color={profile?.avatar_color} size="sm" />
                <span className="hidden text-sm font-semibold text-slate-200 sm:block">{displayName(user)}</span>
                <span className="hidden rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-inset ring-emerald-500/30 sm:block">
                  Staff
                </span>
              </>
            ) : (
              <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pl-1 pr-2.5 shadow-sm backdrop-blur">
                <Avatar user={user} color={profile?.avatar_color} size="sm" />
                <span className="hidden text-sm font-semibold text-white sm:block">{displayName(user)}</span>
                {profile && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-300 ring-1 ring-inset ring-amber-400/30" title={`Trust score ${profile.trust_score} out of 100`}>
                    <span className="text-amber-300">★</span> {profile.trust_score}
                  </span>
                )}
                {profile?.verified_badge && (
                  <span className="hidden text-[11px] font-bold text-violet-300 sm:inline" title="Verified account">✓</span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 pb-24 pt-6 md:pb-10">
        {/* Persistent left sidebar (desktop) */}
        <nav className="hidden w-64 shrink-0 md:block" aria-label="Main">
          <div className="sticky top-[76px] space-y-6">
            <div>
              <p className={`mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider ${isAdminView ? 'text-emerald-400/80' : 'text-slate-400'}`}>
                {isAdminView ? 'Console' : 'Menu'}
              </p>
              <ul className="space-y-1">
                {visibleTabs.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => setTab(t.id)}
                      aria-current={tab === t.id ? 'page' : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                        tab === t.id
                          ? isAdminView
                            ? 'bg-emerald-500/15 text-emerald-300 shadow-sm ring-1 ring-inset ring-emerald-500/30'
                            : 'bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 shadow-sm ring-1 ring-inset ring-indigo-100'
                          : isAdminView
                            ? 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                            : 'text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'
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
            {isAdminView && (
              <button
                onClick={() => setTab('dashboard')}
                className="flex w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-slate-300 shadow-sm transition-colors hover:border-slate-700 hover:text-white"
              >
                ← Back to student app
              </button>
            )}
            <div className={isAdminView ? 'rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg' : 'card p-4'}>
              <div className="flex items-center gap-3">
                <Avatar user={user} color={profile?.avatar_color} />
                <div className="min-w-0">
                  <p className={`truncate text-sm font-bold ${isAdminView ? 'text-white' : 'text-slate-900'}`}>{displayName(user)}</p>
                  <p className={`truncate text-xs ${isAdminView ? 'text-slate-400' : 'text-slate-500'}`}>{user.email}</p>
                  {profile && (
                    <p className={`mt-0.5 text-xs font-semibold ${isAdminView ? 'text-slate-400' : 'text-slate-500'}`}>
                      <span className="text-amber-500">★</span> {profile.trust_score} trust{profile.verified_badge ? ' · ✓ Verified' : ''}
                    </p>
                  )}
                </div>
              </div>
              {profile && (
                <div className="mt-3">
                  <div className={`flex justify-between text-[11px] font-semibold ${isAdminView ? 'text-slate-500' : 'text-slate-400'}`}>
                    <span>Trust score</span>
                    <span className={isAdminView ? 'text-slate-300' : 'text-slate-600'}>{profile.trust_score} / 100</span>
                  </div>
                  <div className={`mt-1 h-1.5 overflow-hidden rounded-full ${isAdminView ? 'bg-slate-800' : 'bg-slate-100'}`}>
                    <div
                      className={`h-full rounded-full transition-all ${isAdminView ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500'}`}
                      style={{ width: `${Math.max(4, Math.min(100, profile.trust_score))}%` }}
                    />
                  </div>
                </div>
              )}
              <button
                onClick={handleLogout}
                className={isAdminView ? 'btn-admin-secondary mt-4 w-full' : 'btn-secondary mt-4 w-full'}
              >
                <IconLogout className="h-4 w-4" /> Log out
              </button>
            </div>
            <p className={`px-3 text-[11px] leading-relaxed ${isAdminView ? 'text-slate-500' : 'text-slate-400'}`}>
              {isAdminView
                ? 'Admin Console — staff only. Every action here is an admin action.'
                : 'Skill Swap Platform with AI Matching — teach what you know, learn what you don’t.'}
            </p>
          </div>
        </nav>

        {/* Main content */}
        <main className={`min-w-0 flex-1 ${isAdminView ? 'admin-console' : ''}`}>
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
      <nav
        className={`fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur md:hidden ${
          isAdminView
            ? 'border-slate-800 bg-slate-950/95 shadow-[0_-4px_20px_rgba(0,0,0,0.4)]'
            : 'border-slate-200/80 bg-white/95 shadow-[0_-4px_20px_rgba(15,23,42,0.07)]'
        }`}
        aria-label="Main mobile"
      >
        <ul className={`grid ${visibleTabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
          {visibleTabs.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`relative flex w-full flex-col items-center gap-0.5 py-3 text-[11px] font-semibold ${
                  tab === t.id
                    ? isAdminView
                      ? 'text-emerald-400'
                      : 'text-indigo-600'
                    : isAdminView
                      ? 'text-slate-500'
                      : 'text-slate-500'
                }`}
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
