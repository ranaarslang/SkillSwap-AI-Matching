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
// STUN (stun.l.google.com) + a free TURN relay (Open Relay Project,
// openrelay.metered.ca — public demo credentials, no account). STUN alone
// only finds a peer's public address; when both devices sit behind
// restrictive NATs (mobile data, most home Wi-Fi) the direct UDP path
// fails and the call never connects. TURN relays the encrypted media so
// real-device calls connect across networks. If the TURN relay is ever
// unreachable, the browser simply falls back to the direct path.
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
  /** True while the local screen (not the camera) is being sent. */
  screenSharing: boolean
  /** The getDisplayMedia stream, shown in the local preview while sharing. */
  screenStream: MediaStream | null
  /** Human-readable end reason, shown while status === 'ended'. */
  notice: string | null
  /** Round 3f: set when camera/mic could not be acquired (permission
   * denied, no devices). The call does NOT end for this — the user can
   * still talk via screen share, and the UI shows this instead of
   * killing the call with "Could not access your camera or microphone". */
  mediaError: string | null
}

const STUN_URL = 'stun:stun.l.google.com:19302'
const TURN_URLS = [
  'turn:openrelay.metered.ca:80',
  'turn:openrelay.metered.ca:443',
  'turn:openrelay.metered.ca:443?transport=tcp',
  'turn:openrelay.metered.ca:3478',
]
// Second free TURN provider (no signup, public demo credentials): if the
// Open Relay service is ever down or overloaded, the browser tries this
// one too. A dead entry costs nothing — it simply yields no candidates.
const TURN_FALLBACK_URL = 'turn:turn.anyfirewall.com:443?transport=tcp'
const TURN_FALLBACK_USERNAME = 'webrtc'
const TURN_FALLBACK_CREDENTIAL = 'webrtc'
const TURN_USERNAME = 'openrelayproject'
const TURN_CREDENTIAL = 'openrelayproject'
const RING_TIMEOUT_MS = 30_000
const ENDED_NOTICE_MS = 2_500
// If the peer connection never reaches 'connected' (e.g. a network that
// blocks the UDP that WebRTC ICE needs), fail loudly instead of hanging
// on "Connecting…" forever. 45s, not 20s: on a phone the camera
// permission prompt + a slow TURN allocate can eat 20s before ICE even
// starts checking pairs.
const CONNECT_TIMEOUT_MS = 45_000

/** Simple two-tone phone ring via Web Audio — no audio file needed.
 * Starts on an incoming call (and a softer ringback while dialling);
 * stops the moment the call is answered, declined, connected or ended.
 * Every step is guarded: audio must never break a call. A browser may
 * keep the context suspended until the user has interacted with the
 * page — resume() is best-effort and a failure just means silence. */
class Ringtone {
  private ctx: AudioContext | null = null
  private osc: OscillatorNode | null = null
  private gain: GainNode | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  start(kind: 'incoming' | 'ringback') {
    try {
      this.stop()
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      const ctx = new AC()
      this.ctx = ctx
      void ctx.resume().catch(() => {})
      this.osc = ctx.createOscillator()
      this.gain = ctx.createGain()
      this.osc.type = 'sine'
      this.osc.frequency.value = kind === 'incoming' ? 880 : 660
      this.gain.gain.value = 0
      this.osc.connect(this.gain)
      this.gain.connect(ctx.destination)
      this.osc.start()
      // Ring pattern on a 250ms tick: two short bursts, then a pause
      // (2.5s cycle). Ringback is quieter than the incoming ring.
      const volume = kind === 'incoming' ? 0.08 : 0.035
      let step = 0
      this.timer = setInterval(() => {
        if (!this.gain || !this.ctx) return
        step += 1
        const phase = step % 10
        const target = phase === 0 || phase === 1 || phase === 3 || phase === 4 ? volume : 0
        this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03)
      }, 250)
    } catch {
      /* audio unavailable — the call still works, just silently */
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    try {
      this.osc?.stop()
    } catch {
      /* already stopped */
    }
    this.osc = null
    this.gain = null
    if (this.ctx) {
      void this.ctx.close().catch(() => {})
      this.ctx = null
    }
  }
}

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
  /** The sender carrying the screen track when it was added with
   * addTrack (no camera sender existed) — needed to remove it on stop. */
  private screenSender: RTCRtpSender | null = null
  private pendingOffer: RTCSessionDescriptionInit | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private ringTimer: ReturnType<typeof setTimeout> | null = null
  private endTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private ringtone = new Ringtone()
  /** Resolved once the callee's local media is attached (or the attempt
   * is over). The answer must wait for it — answering before the tracks
   * exist sends a receive-only answer and the callee's media is never
   * negotiated (no renegotiation handler exists). */
  private mediaReady: Promise<void> | null = null
  private mediaReadyResolve: (() => void) | null = null
  /** ICE diagnostics for a failed call: what the browser actually
   * gathered and received, so the failure notice can say WHY instead of
   * only "Connection failed". Reset per peer connection. */
  private iceStats = {
    host: 0,
    srflx: 0,
    relay: 0,
    gatheringComplete: false,
    remoteCandidates: 0,
    remoteDescriptionSet: false,
  }

  /** Why this call failed, in plain words — built from the ICE stats
   * gathered so far. Used by the connect timeout and by the peer
   * connection's 'failed' state. */
  private diagnoseFailure(): string {
    const s = this.iceStats
    if (!s.remoteDescriptionSet) {
      return 'Connection failed — the call setup never completed (the offer/answer was lost). Please try again.'
    }
    if (s.host + s.srflx + s.relay === 0) {
      return 'Connection failed — no network path was found at all. Check your connection and try again.'
    }
    if (s.relay === 0) {
      return 'Connection failed — the relay server (TURN) could not be reached and no direct path worked. Try again on a different network.'
    }
    if (s.remoteCandidates === 0) {
      return 'Connection failed — the other side sent no network details. Please try again.'
    }
    return 'Connection failed — no direct or relayed path worked between the two devices. Try again on a different network.'
  }

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
          this.endCall(this.diagnoseFailure())
        }
      }, CONNECT_TIMEOUT_MS)
    } else if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    if (status === 'connected') this.ringtone.stop()
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
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: STUN_URL },
        { urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL },
        { urls: TURN_FALLBACK_URL, username: TURN_FALLBACK_USERNAME, credential: TURN_FALLBACK_CREDENTIAL },
      ],
    })
    this.pc = pc
    this.iceStats = { host: 0, srflx: 0, relay: 0, gatheringComplete: false, remoteCandidates: 0, remoteDescriptionSet: false }
    pc.ontrack = (ev) => {
      if (!this.call) return
      this.call = { ...this.call, remoteStream: ev.streams[0] ?? null }
      this.emit()
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        // candidate string: "candidate:<foundation> <comp> <proto> ...
        // typ <host|srflx|relay> ..." — count the type for diagnosis.
        const parts = ev.candidate.candidate.split(' ')
        const typIdx = parts.indexOf('typ')
        const typ = typIdx >= 0 ? parts[typIdx + 1] : ''
        if (typ === 'host') this.iceStats.host += 1
        else if (typ === 'srflx') this.iceStats.srflx += 1
        else if (typ === 'relay') this.iceStats.relay += 1
        this.socketRef.current?.sendCall('call.ice', {
          to_user_id: peerId,
          call_id: callId,
          candidate: ev.candidate.toJSON(),
        })
      }
    }
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') this.iceStats.gatheringComplete = true
    }
    pc.onconnectionstatechange = () => {
      if (!this.call) return
      if (pc.connectionState === 'connected') this.setStatus('connected')
      else if (pc.connectionState === 'failed') this.endCall(this.diagnoseFailure())
    }
    return pc
  }

  // Round 3f: camera/mic failure must NOT kill the call. Try video+audio,
  // then audio-only, then proceed with no local media at all (the call
  // still rings/connects, and screen share — which needs no camera or
  // mic — stays available). Returns what was acquired; mediaError
  // describes the shortfall for the UI banner.
  private async attachLocalMedia(pc: RTCPeerConnection): Promise<'full' | 'audio' | 'none'> {
    const setStream = (stream: MediaStream): boolean => {
      if (!this.call) {
        stream.getTracks().forEach((t) => t.stop())
        return false
      }
      stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      this.call = { ...this.call, localStream: stream, muted: false, cameraOff: false, mediaError: null }
      this.emit()
      return true
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      return setStream(stream) ? 'full' : 'none'
    } catch {
      /* fall through to audio-only */
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!setStream(stream)) return 'none'
      if (this.call) {
        this.call = {
          ...this.call,
          mediaError: 'Camera unavailable — audio only. You can still share your screen.',
        }
        this.emit()
      }
      return 'audio'
    } catch {
      /* fall through to no media */
    }
    if (this.call) {
      this.call = {
        ...this.call,
        mediaError: 'Could not access your camera or microphone. You can still share your screen.',
      }
      this.emit()
    }
    return 'none'
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
      screenSharing: false,
      screenStream: null,
      notice: null,
      mediaError: null,
    }
    this.pendingOffer = null
    this.pendingCandidates = []
    this.emit()
    const pc = this.createPeerConnection(peer.id, callId)
    // Round 3f: a failed camera/mic no longer ends the call — the invite
    // still goes out and screen share stays available.
    await this.attachLocalMedia(pc)
    if (!this.call || this.call.callId !== callId) return
    this.socketRef.current?.sendCall('call.invite', { to_user_id: peer.id, call_id: callId })
    this.ringtone.start('ringback')
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
    this.ringtone.stop()
    // Tell the caller we accepted — they create the offer next. The offer
    // then arrives via handleEvent and is applied there (or here, if it
    // somehow arrived first). The answer waits for local media: answering
    // before the camera/mic tracks exist sends a receive-only answer and
    // the callee's media is never negotiated.
    this.mediaReady = new Promise<void>((resolve) => {
      this.mediaReadyResolve = resolve
    })
    this.socketRef.current?.sendCall('call.accept', { call_id: call.callId })
    this.setStatus('connecting')
    const pc = this.createPeerConnection(call.peer.id, call.callId)
    // Round 3f: a failed camera/mic no longer ends the call — the answer
    // still goes out and screen share stays available.
    await this.attachLocalMedia(pc)
    if (this.mediaReadyResolve) {
      this.mediaReadyResolve()
      this.mediaReadyResolve = null
    }
    if (!this.call || this.call.callId !== call.callId) return
    await this.applyOfferAndAnswer()
  }

  /** Apply the pending offer (if any) and send back an answer. Waits for
   * local media first, so the answer carries the caller's audio/video
   * tracks instead of a receive-only placeholder. The offer is read
   * AFTER the wait: this runs from two places (the offer handler and
   * acceptCall) and both can park on the same wait — whoever resumes
   * first consumes the offer, the other must see it gone and return
   * instead of answering twice (a second setRemoteDescription throws
   * and kills the call). */
  private async applyOfferAndAnswer() {
    const call = this.call
    if (!call || !this.pc) return
    if (this.mediaReady) await this.mediaReady
    const sdp = this.pendingOffer
    if (!this.call || !this.pc || !sdp || this.call.callId !== call.callId) return
    this.pendingOffer = null
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
      this.iceStats.remoteDescriptionSet = true
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
    this.ringtone.stop()
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
    // No audio track (no mic) — nothing to mute; the button is disabled
    // in the UI too, but guard here as well.
    if (!this.call?.localStream || this.call.localStream.getAudioTracks().length === 0) return
    const muted = !this.call.muted
    this.call.localStream.getAudioTracks().forEach((t) => {
      t.enabled = !muted
    })
    this.call = { ...this.call, muted }
    this.emit()
  }

  toggleCamera() {
    // No video track (no camera, or audio-only) — nothing to switch off.
    if (!this.call?.localStream || this.call.localStream.getVideoTracks().length === 0) return
    const off = !this.call.cameraOff
    this.call.localStream.getVideoTracks().forEach((t) => {
      t.enabled = !off
    })
    this.call = { ...this.call, cameraOff: off }
    this.emit()
  }

  // ---------------------------------------------------------------- screen share
  /** Share the screen instead of the camera (replaceTrack on the video
   * sender, so the remote side sees the screen on the same track).
   * Stopping — button toggle or the browser's native "Stop sharing" —
   * swaps the camera track back in. The mic audio track is untouched,
   * so mute keeps working while sharing. */
  async toggleScreenShare() {
    if (!this.call || !this.pc || this.call.status === 'ended') return
    if (this.call.screenSharing) {
      this.stopScreenShare()
      return
    }
    const callId = this.call.callId
    let screen: MediaStream
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    } catch {
      return // user cancelled the picker, or the browser denied it
    }
    if (!this.call || !this.pc || this.call.callId !== callId) {
      screen.getTracks().forEach((t) => t.stop())
      return
    }
    const screenTrack = screen.getVideoTracks()[0]
    // Round 3f: screen share must work even with no camera/mic. When a
    // camera video sender exists, swap its track; when there is none
    // (getUserMedia failed), add the screen as a new video track.
    let sender = this.pc.getSenders().find((s) => s.track?.kind === 'video')
    if (!screenTrack) {
      screen.getTracks().forEach((t) => t.stop())
      return
    }
    try {
      if (sender) {
        await sender.replaceTrack(screenTrack)
      } else {
        sender = this.pc.addTrack(screenTrack, screen)
        this.screenSender = sender
      }
    } catch {
      screen.getTracks().forEach((t) => t.stop())
      return
    }
    // The browser's native "Stop sharing" ends the track — revert then.
    screenTrack.onended = () => {
      this.stopScreenShare()
    }
    this.call = { ...this.call, screenSharing: true, screenStream: screen }
    this.emit()
  }

  private stopScreenShare() {
    const call = this.call
    if (!call || !call.screenSharing) return
    const screenTrack = call.screenStream?.getVideoTracks()[0]
    call.screenStream?.getTracks().forEach((t) => {
      try {
        t.stop()
      } catch {
        /* already stopped */
      }
    })
    const cameraTrack = call.localStream?.getVideoTracks()[0]
    // The sender carrying the screen track: the one added for it, or the
    // camera sender whose track was replaced.
    const sender =
      this.screenSender ??
      this.pc?.getSenders().find((s) => s.track === screenTrack)
    if (sender) {
      if (cameraTrack) {
        sender.replaceTrack(cameraTrack).catch(() => {})
      } else {
        // No camera to revert to — remove the screen track entirely.
        try {
          this.pc?.removeTrack(sender)
        } catch {
          /* already removed */
        }
      }
    }
    this.screenSender = null
    this.call = { ...call, screenSharing: false, screenStream: null }
    this.emit()
  }

  private cleanup(notice: string) {
    this.clearTimers()
    this.ringtone.stop()
    // Unblock any answer waiting on local media — the call is over.
    if (this.mediaReadyResolve) {
      this.mediaReadyResolve()
      this.mediaReadyResolve = null
    }
    this.mediaReady = null
    const callId = this.call?.callId
    if (this.pc) {
      try {
        this.pc.close()
      } catch {
        /* already closed */
      }
      this.pc = null
    }
    this.screenSender = null
    if (this.call?.localStream) {
      this.call.localStream.getTracks().forEach((t) => t.stop())
    }
    if (this.call?.screenStream) {
      this.call.screenStream.getTracks().forEach((t) => t.stop())
    }
    this.pendingOffer = null
    this.pendingCandidates = []
    if (this.call) {
      this.call = { ...this.call, status: 'ended', notice, localStream: null, remoteStream: null, screenSharing: false, screenStream: null, mediaError: null }
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
        screenSharing: false,
        screenStream: null,
        notice: null,
        mediaError: null,
      }
      this.pendingOffer = null
      this.pendingCandidates = []
      this.emit()
      this.ringtone.start('incoming')
      return
    }

    const call = this.call
    if (!call || call.callId !== callId) return

    if (type === 'call.accepted') {
      if (call.direction !== 'outgoing' || call.status !== 'ringing' || !this.pc) return
      this.ringtone.stop()
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
        this.iceStats.remoteDescriptionSet = true
        await this.flushCandidates()
      } catch {
        /* duplicate answer — ignore */
      }
    } else if (type === 'call.ice') {
      const candidate = ev.candidate as RTCIceCandidateInit | undefined
      if (!candidate) return
      this.iceStats.remoteCandidates += 1
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
