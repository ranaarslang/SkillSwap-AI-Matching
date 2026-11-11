// In-app video calls (round 3b): WebRTC peer-to-peer media, with the
// Django Channels socket carrying ONLY the signaling (invite / offer /
// answer / ICE / end). No media ever touches the server, and no call ever
// leaves the app for WhatsApp or another tool.
//
// Flow: caller startCall() -> getUserMedia + RTCPeerConnection + invite.
// Callee sees an incoming call, taps Accept -> getUserMedia + PC, answers
// the pending offer. Both sides exchange ICE candidates through the
// socket. Either side can end; a disconnect mid-call notifies the peer
// (server side, consumers.py).
// STUN only (stun.l.google.com) — enough for the direct peer-to-peer
// case; no TURN server is provisioned, so calls across restrictive NATs
// may fail to connect (the UI then says the connection failed).
import type { ChatSocket, User } from './api'

export type CallDirection = 'outgoing' | 'incoming'
export type CallStatus = 'ringing' | 'incoming' | 'connecting' | 'connected' | 'ended'

export interface CallState {
  callId: string
  peer: User
  direction: CallDirection
  status: CallStatus
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  muted: boolean
  cameraOff: boolean
  /** Human-readable end reason, shown while status === 'ended'. */
  notice: string | null
}

const STUN_URL = 'stun:stun.l.google.com:19302'
const RING_TIMEOUT_MS = 30_000
const ENDED_NOTICE_MS = 2_500
// If the peer connection never reaches 'connected' (e.g. a network that
// blocks the UDP that WebRTC ICE needs), fail loudly instead of hanging
// on "Connecting…" forever.
const CONNECT_TIMEOUT_MS = 20_000

function newCallId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

type SocketRef = { current: ChatSocket | null }

export class CallManager {
  onChange: ((state: CallState | null) => void) | null = null

  private socketRef: SocketRef
  private me: User
  private call: CallState | null = null
  private pc: RTCPeerConnection | null = null
  private pendingOffer: RTCSessionDescriptionInit | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private ringTimer: ReturnType<typeof setTimeout> | null = null
  private endTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(socketRef: SocketRef, me: User) {
    this.socketRef = socketRef
    this.me = me
  }

  private emit() {
    this.onChange?.(this.call ? { ...this.call } : null)
  }

  private setStatus(status: CallStatus, notice?: string | null) {
    if (!this.call) return
    this.call = { ...this.call, status, notice: notice ?? this.call.notice }
    if (status === 'connecting') {
      // Arm the stuck-connection timeout; cleared on 'connected' or end.
      if (this.connectTimer) clearTimeout(this.connectTimer)
      const callId = this.call.callId
      this.connectTimer = setTimeout(() => {
        const current = this.call
        if (current && current.callId === callId && current.status === 'connecting') {
          this.endCall('Connection failed — check your network and try again.')
        }
      }, CONNECT_TIMEOUT_MS)
    } else if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.emit()
  }

  private clearTimers() {
    if (this.ringTimer) clearTimeout(this.ringTimer)
    if (this.endTimer) clearTimeout(this.endTimer)
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.ringTimer = null
    this.endTimer = null
    this.connectTimer = null
  }

  private createPeerConnection(peerId: number, callId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URL }] })
    this.pc = pc
    pc.ontrack = (ev) => {
      if (!this.call) return
      this.call = { ...this.call, remoteStream: ev.streams[0] ?? null }
      this.emit()
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.socketRef.current?.sendCall('call.ice', {
          to_user_id: peerId,
          call_id: callId,
          candidate: ev.candidate.toJSON(),
        })
      }
    }
    pc.onconnectionstatechange = () => {
      if (!this.call) return
      if (pc.connectionState === 'connected') this.setStatus('connected')
      else if (pc.connectionState === 'failed') this.endCall('Connection failed — the call could not connect.')
    }
    return pc
  }

  private async attachLocalMedia(pc: RTCPeerConnection): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      if (!this.call) {
        stream.getTracks().forEach((t) => t.stop())
        return false
      }
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      this.call = { ...this.call, localStream: stream, muted: false, cameraOff: false }
      this.emit()
      return true
    } catch {
      return false
    }
  }

  private async flushCandidates() {
    if (!this.pc) return
    const queued = this.pendingCandidates
    this.pendingCandidates = []
    for (const c of queued) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c))
      } catch {
        /* stale candidate — ignore */
      }
    }
  }

  // ---------------------------------------------------------------- caller
  async startCall(peer: User) {
    if (this.call && this.call.status !== 'ended') return
    if (peer.id === this.me.id) return
    const callId = newCallId()
    this.clearTimers()
    this.call = {
      callId,
      peer,
      direction: 'outgoing',
      status: 'ringing',
      localStream: null,
      remoteStream: null,
      muted: false,
      cameraOff: false,
      notice: null,
    }
    this.pendingOffer = null
    this.pendingCandidates = []
    this.emit()
    const pc = this.createPeerConnection(peer.id, callId)
    const ok = await this.attachLocalMedia(pc)
    if (!ok || !this.call || this.call.callId !== callId) {
      if (this.call?.callId === callId) {
        this.cleanup(`Could not access your camera or microphone. Check the browser permission and try again.`)
      }
      return
    }
    this.socketRef.current?.sendCall('call.invite', { to_user_id: peer.id, call_id: callId })
    this.ringTimer = setTimeout(() => {
      if (this.call?.callId === callId && this.call.status === 'ringing') {
        this.endCall(`No answer — ${peer.full_name || peer.username} may be offline.`)
      }
    }, RING_TIMEOUT_MS)
  }

  // ---------------------------------------------------------------- callee
  async acceptCall() {
    const call = this.call
    if (!call || call.status !== 'incoming') return
    // Tell the caller we accepted — they create the offer next. The offer
    // then arrives via handleEvent and is applied there (or here, if it
    // somehow arrived first).
    this.socketRef.current?.sendCall('call.accept', { call_id: call.callId })
    this.setStatus('connecting')
    const pc = this.createPeerConnection(call.peer.id, call.callId)
    const ok = await this.attachLocalMedia(pc)
    if (!ok || !this.call || this.call.callId !== call.callId) {
      if (this.call?.callId === call.callId) {
        this.cleanup('Could not access your camera or microphone. Check the browser permission and try again.')
      }
      return
    }
    await this.applyOfferAndAnswer()
  }

  /** Apply the pending offer (if any) and send back an answer. */
  private async applyOfferAndAnswer() {
    const call = this.call
    const sdp = this.pendingOffer
    if (!call || !this.pc || !sdp) return
    this.pendingOffer = null
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
      await this.flushCandidates()
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this.socketRef.current?.sendCall('call.answer', {
        to_user_id: call.peer.id,
        call_id: call.callId,
        sdp: this.pc.localDescription?.toJSON(),
      })
      this.setStatus('connecting')
    } catch {
      this.endCall('The call could not connect.')
    }
  }

  declineCall() {
    const call = this.call
    if (!call || call.status !== 'incoming') return
    this.socketRef.current?.sendCall('call.decline', { call_id: call.callId })
    this.cleanup('Call declined.')
  }

  // ---------------------------------------------------------------- shared
  endCall(notice?: string) {
    const call = this.call
    if (!call || call.status === 'ended') return
    this.socketRef.current?.sendCall('call.end', { call_id: call.callId })
    this.cleanup(notice ?? 'Call ended.')
  }

  toggleMute() {
    if (!this.call?.localStream) return
    const muted = !this.call.muted
    this.call.localStream.getAudioTracks().forEach((t) => {
      t.enabled = !muted
    })
    this.call = { ...this.call, muted }
    this.emit()
  }

  toggleCamera() {
    if (!this.call?.localStream) return
    const off = !this.call.cameraOff
    this.call.localStream.getVideoTracks().forEach((t) => {
      t.enabled = !off
    })
    this.call = { ...this.call, cameraOff: off }
    this.emit()
  }

  private cleanup(notice: string) {
    this.clearTimers()
    const callId = this.call?.callId
    if (this.pc) {
      try {
        this.pc.close()
      } catch {
        /* already closed */
      }
      this.pc = null
    }
    if (this.call?.localStream) {
      this.call.localStream.getTracks().forEach((t) => t.stop())
    }
    this.pendingOffer = null
    this.pendingCandidates = []
    if (this.call) {
      this.call = { ...this.call, status: 'ended', notice, localStream: null, remoteStream: null }
      this.emit()
      this.endTimer = setTimeout(() => {
        const current = this.call
        if (current && current.callId === callId && current.status === 'ended') {
          this.call = null
          this.emit()
        }
      }, ENDED_NOTICE_MS)
    }
  }

  /** Handle one call.* frame from the socket. */
  async handleEvent(ev: Record<string, unknown>) {
    const type = ev.type as string
    const callId = ev.call_id as string | undefined
    if (!callId) return

    if (type === 'call.incoming') {
      // Busy in another call: decline politely, don't interrupt.
      if (this.call && this.call.status !== 'ended') {
        this.socketRef.current?.sendCall('call.decline', { call_id: callId })
        return
      }
      const fromUser = ev.from_user as User | undefined
      if (!fromUser) return
      this.clearTimers()
      this.call = {
        callId,
        peer: fromUser,
        direction: 'incoming',
        status: 'incoming',
        localStream: null,
        remoteStream: null,
        muted: false,
        cameraOff: false,
        notice: null,
      }
      this.pendingOffer = null
      this.pendingCandidates = []
      this.emit()
      return
    }

    const call = this.call
    if (!call || call.callId !== callId) return

    if (type === 'call.accepted') {
      if (call.direction !== 'outgoing' || call.status !== 'ringing' || !this.pc) return
      if (this.ringTimer) {
        clearTimeout(this.ringTimer)
        this.ringTimer = null
      }
      try {
        const offer = await this.pc.createOffer()
        await this.pc.setLocalDescription(offer)
        this.socketRef.current?.sendCall('call.offer', {
          to_user_id: call.peer.id,
          call_id: callId,
          sdp: this.pc.localDescription?.toJSON(),
        })
        this.setStatus('connecting')
      } catch {
        this.endCall('The call could not connect.')
      }
    } else if (type === 'call.offer') {
      const sdp = ev.sdp as RTCSessionDescriptionInit | undefined
      if (!sdp) return
      this.pendingOffer = sdp
      if (this.pc) await this.applyOfferAndAnswer()
    } else if (type === 'call.answer') {
      const sdp = ev.sdp as RTCSessionDescriptionInit | undefined
      if (!sdp || !this.pc) return
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
        await this.flushCandidates()
      } catch {
        /* duplicate answer — ignore */
      }
    } else if (type === 'call.ice') {
      const candidate = ev.candidate as RTCIceCandidateInit | undefined
      if (!candidate) return
      if (this.pc && this.pc.remoteDescription) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate))
        } catch {
          /* stale candidate — ignore */
        }
      } else {
        this.pendingCandidates.push(candidate)
      }
    } else if (type === 'call.declined') {
      if (call.direction === 'outgoing' && call.status === 'ringing') {
        this.cleanup(`${call.peer.full_name || call.peer.username} declined the call.`)
      }
    } else if (type === 'call.ended') {
      if (call.status !== 'ended') {
        // The peer already ended it — clean up locally without re-sending.
        this.cleanup('Call ended.')
      }
    } else if (type === 'call.offline') {
      if (call.direction === 'outgoing' && call.status === 'ringing') {
        this.cleanup(`${call.peer.full_name || call.peer.username} is offline right now.`)
      }
    }
  }
}
