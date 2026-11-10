// API client for the Skill Swap Platform with AI Matching backend (JWT auth, per SRS/SDD).
// API base is driven ONLY by the VITE_API_URL env var (read at build/dev
// time via import.meta.env); it is never hardcoded to a host here.
export const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:8000/api'

export const ACCESS_KEY = 'skillswap_access'
export const REFRESH_KEY = 'skillswap_refresh'
export const USER_KEY = 'skillswap_user'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY)
}

export function wsUrlFromApiBase(): string {
  const base = API_BASE.replace(/\/api\/?$/, '')
  const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  return `${wsBase}/ws/chat/`
}

export interface User {
  id: number
  username: string
  full_name: string
  email: string
}

export interface Profile {
  id: number
  user: User
  bio: string
  location: string
  availability: string
  portfolio_link: string
  avatar_color: string
  trust_score: number
  verified_badge: boolean
  teach_skills: string[]
  learn_skills: string[]
}

export interface MatchProfile extends Profile {
  match_score: number
  location_bonus: number
  same_location: boolean
  can_teach_you: string[]
  you_can_teach_them: string[]
}

export type SessionStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'

export interface SessionItem {
  id: number
  partner_one: User
  partner_two: User
  title: string
  calendar_date: string
  duration_block: string
  session_status: SessionStatus | string
  created_at: string
}

export interface Conversation {
  peer: User
  last_message: { body: string; created_at: string; sender_id: number } | null
  unread_count: number
}

export interface ChatMessage {
  id: number
  sender: User
  recipient: User
  body: string
  created_at: string
  is_mine: boolean
}

export interface Review {
  id: number
  session_id: number
  rating_stars: number
  feedback_text: string
}

export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
    this.detail = detail
  }
}

export function clearAuth() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(USER_KEY)
}

function extractDetail(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>
    if (typeof d.detail === 'string') return d.detail
    if (Array.isArray(d.non_field_errors) && typeof d.non_field_errors[0] === 'string') return d.non_field_errors[0]
    const parts = Object.values(d)
      .flat()
      .filter((v) => typeof v === 'string') as string[]
    if (parts.length) return parts.join(' ')
  }
  return fallback
}

let refreshPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refresh = localStorage.getItem(REFRESH_KEY)
      if (!refresh) return false
      try {
        const res = await fetch(`${API_BASE}/auth/refresh/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh }),
        })
        if (!res.ok) return false
        const data = (await res.json()) as { access?: string }
        if (!data.access) return false
        localStorage.setItem(ACCESS_KEY, data.access)
        return true
      } catch {
        return false
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Is the backend running?')
  }
  if (res.status === 401 && !retried && getAccessToken()) {
    const ok = await tryRefresh()
    if (ok) return request<T>(path, init, true)
    clearAuth()
    window.dispatchEvent(new Event('skillswap:unauthorized'))
    throw new ApiError(401, 'Your session expired. Please log in again.')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    throw new ApiError(res.status, extractDetail(data, `Request failed (${res.status})`))
  }
  return data as T
}

export const api = {
  signup: (body: { email: string; password: string; full_name: string }) =>
    request<{ access: string; refresh: string; user: User }>('/auth/signup/', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email_or_username: string; password: string }) =>
    request<{ access: string; refresh: string; user: User }>('/auth/login/', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/auth/logout/', { method: 'POST', body: JSON.stringify({}) }),
  getMyProfile: () => request<Profile>('/profile/me/'),
  updateMyProfile: (body: {
    full_name?: string
    bio?: string
    location?: string
    availability?: string
    portfolio_link?: string
    teach_skills?: string[]
    learn_skills?: string[]
  }) => request<Profile>('/profile/me/', { method: 'PUT', body: JSON.stringify(body) }),
  getProfile: (userId: number) => request<Profile>(`/profiles/${userId}/`),
  getMatches: () => request<MatchProfile[]>('/matches/'),
  getCommunity: () => request<MatchProfile[]>('/community/'),
  getSessions: () => request<SessionItem[]>('/sessions/'),
  createSession: (body: { partner_id: number; calendar_date: string; duration_block: string; title?: string }) =>
    request<SessionItem>('/sessions/', { method: 'POST', body: JSON.stringify(body) }),
  updateSession: (id: number, body: { session_status: string }) =>
    request<SessionItem>(`/sessions/${id}/`, { method: 'PUT', body: JSON.stringify(body) }),
  getConversations: () => request<Conversation[]>('/conversations/'),
  getMessages: (peerId: number) => request<ChatMessage[]>(`/messages/?peer=${peerId}`),
  sendMessage: (body: { recipient_id: number; body: string }) =>
    request<ChatMessage>('/messages/', { method: 'POST', body: JSON.stringify(body) }),
  createReview: (body: { session_id: number; rating_stars: number; feedback_text: string }) =>
    request<Review>('/reviews/', { method: 'POST', body: JSON.stringify(body) }),
  getReviews: (userId: number) => request<Review[]>(`/reviews/?user=${userId}`),
}

// ---- WebSocket live chat helper -------------------------------------------
// Connects to ws(s)://<api-host>/ws/chat/?token=<JWT access token>.
// Reconnects automatically on drop (max 5 retries, exponential backoff).
export type WsStatus = 'connecting' | 'live' | 'offline'

export class ChatSocket {
  private ws: WebSocket | null = null
  private retries = 0
  private closedByUs = false
  private readonly maxRetries = 5
  onMessage: ((msg: ChatMessage) => void) | null = null
  onStatus: ((s: WsStatus) => void) | null = null
  onReconnect: (() => void) | null = null

  connect() {
    const token = getAccessToken()
    if (!token) return
    this.closedByUs = false
    this.retries = 0
    this.openSocket(token)
  }

  private openSocket(token: string) {
    this.onStatus?.('connecting')
    const url = `${wsUrlFromApiBase()}?token=${encodeURIComponent(token)}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect(token)
      return
    }
    this.ws = ws
    ws.onopen = () => {
      const wasReconnect = this.retries > 0
      this.retries = 0
      this.onStatus?.('live')
      if (wasReconnect) this.onReconnect?.()
    }
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string)
        if (data?.type === 'chat.message' && data.message) {
          this.onMessage?.(data.message as ChatMessage)
        }
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      this.ws = null
      if (!this.closedByUs) {
        this.onStatus?.('offline')
        this.scheduleReconnect(token)
      }
    }
    ws.onerror = () => {
      // onclose will follow; reconnect is handled there
    }
  }

  private scheduleReconnect(token: string) {
    if (this.closedByUs || this.retries >= this.maxRetries) return
    const delay = Math.min(1000 * 2 ** this.retries, 15000)
    this.retries += 1
    window.setTimeout(() => {
      if (!this.closedByUs) this.openSocket(token)
    }, delay)
  }

  send(recipientId: number, body: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat.message', recipient_id: recipientId, body }))
    }
  }

  close() {
    this.closedByUs = true
    this.ws?.close()
    this.ws = null
  }
}

export function displayName(u: User): string {
  return (u.full_name || '').trim() || u.username
}

export function initials(u: User): string {
  return displayName(u)
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
