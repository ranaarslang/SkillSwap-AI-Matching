// In-app video-call overlay (round 3b). Rendered at App level so an
// incoming call rings no matter which tab the user is on. Local video is
// muted (no echo); remote video plays the peer's stream.
//
// Round 6 attach rules — the video elements are ALWAYS mounted (not
// conditionally rendered) and get their stream from a callback ref as
// well as an effect, so a track that arrives before the view mounts (or
// a remount with an existing stream) can never leave a blank video:
// attach runs on mount AND on every stream change. Audio: browsers
// block autoplay WITH sound once the Accept tap's user activation
// expires (slow network), so play() falls back to muted — and any tap
// during the call (a real gesture) retries unmuted playback, plus a
// big centered "Tap to hear" card instead of a tiny chip.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CallState } from '../call'
import { displayName, initials } from '../api'

interface Props {
  call: CallState
  onAccept: () => void
  onDecline: () => void
  onEnd: () => void
  onToggleMute: () => void
  onToggleCamera: () => void
  onToggleScreenShare: () => void
}

function statusText(call: CallState): string {
  switch (call.status) {
    case 'ringing':
      return `Calling ${displayName(call.peer)}…`
    case 'incoming':
      return `${displayName(call.peer)} is calling you`
    case 'connecting':
      return 'Connecting…'
    case 'connected':
      return `In a call with ${displayName(call.peer)}`
    case 'ended':
      return call.notice ?? 'Call ended.'
  }
}

/** Live, enabled video tracks in a stream (a disabled track renders
 * black — the peer's camera is off — so it does not count as video). */
function liveVideoTracks(stream: MediaStream | null): MediaStreamTrack[] {
  if (!stream) return []
  return stream.getVideoTracks().filter((t) => t.enabled && t.readyState === 'live')
}

export default function CallView(props: Props) {
  const { call } = props
  const localElRef = useRef<HTMLVideoElement | null>(null)
  const remoteElRef = useRef<HTMLVideoElement | null>(null)
  // Autoplay with sound can be blocked when the remote stream arrives
  // after the Accept tap's user activation expires — then fall back to
  // muted playback and offer a big unmute card.
  const [remoteMuted, setRemoteMuted] = useState(false)
  // Mirrors of the current streams, so the callback refs (which run on
  // mount, outside any effect) can attach a stream that already exists.
  const remoteStreamRef = useRef<MediaStream | null>(null)
  remoteStreamRef.current = call.remoteStream
  const previewStreamRef = useRef<MediaStream | null>(null)

  // While sharing, the local preview shows the screen, not the camera.
  const previewStream = call.screenSharing && call.screenStream ? call.screenStream : call.localStream
  previewStreamRef.current = previewStream

  // A new call resets the muted flag (the component can stay mounted
  // across calls while callState is non-null).
  useEffect(() => {
    setRemoteMuted(false)
  }, [call.callId])

  /** Try to play the remote video WITH sound. Returns true when sound
   * is on. On autoplay-policy rejection, fall back to muted video and
   * let the user unmute with one tap (a real gesture). The unmute card
   * clears the moment the user taps (their intent is clear) — it must
   * not wait on the play() promise, which can stay pending on a
   * stalled stream with no frames yet; the card only comes back if
   * play() actually rejects. */
  const playRemoteWithSound = useCallback(async (v: HTMLVideoElement): Promise<boolean> => {
    v.muted = false
    setRemoteMuted(false)
    try {
      await v.play()
      return true
    } catch {
      v.muted = true
      setRemoteMuted(true)
      v.play().catch(() => {})
      return false
    }
  }, [])

  /** Attach the remote stream to a video element and try sound. */
  const attachRemote = useCallback(
    (el: HTMLVideoElement | null, stream: MediaStream | null) => {
      if (!el || !stream) return
      if (el.srcObject !== stream) el.srcObject = stream
      void playRemoteWithSound(el)
    },
    [playRemoteWithSound],
  )

  // Callback ref: attaches on mount, even when the stream arrived
  // before this element existed. The effect below covers the stream
  // arriving after mount. Together they close the mount race.
  const remoteRef = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteElRef.current = el
      attachRemote(el, remoteStreamRef.current)
    },
    [attachRemote],
  )
  const localRef = useCallback((el: HTMLVideoElement | null) => {
    localElRef.current = el
    if (el && previewStreamRef.current) {
      if (el.srcObject !== previewStreamRef.current) el.srcObject = previewStreamRef.current
      el.play().catch(() => {})
    }
  }, [])

  useEffect(() => {
    attachRemote(remoteElRef.current, call.remoteStream)
  }, [call.remoteStream, attachRemote])
  useEffect(() => {
    const v = localElRef.current
    if (v && previewStream) {
      if (v.srcObject !== previewStream) v.srcObject = previewStream
      v.play().catch(() => {})
    }
  }, [previewStream])

  /** Any tap during the call is a real user gesture — use it to retry
   * unmuted playback if the browser muted the remote audio. */
  function tryUnmuteFromGesture() {
    const v = remoteElRef.current
    if (remoteMuted && v && call.remoteStream) void playRemoteWithSound(v)
  }

  function unmuteRemote() {
    const v = remoteElRef.current
    if (!v) return
    void playRemoteWithSound(v)
  }

  const remoteVideoTracks = liveVideoTracks(call.remoteStream)
  const remoteHasVideo = remoteVideoTracks.length > 0
  const remoteHasAudio = (call.remoteStream?.getAudioTracks().length ?? 0) > 0
  const previewVideoTracks = liveVideoTracks(previewStream)
  const previewHasVideo = previewVideoTracks.length > 0
  const screenShareSupported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
  const waitingText =
    call.status === 'connected'
      ? `Waiting for ${displayName(call.peer)}'s video…`
      : statusText(call)

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col"
      role="dialog"
      aria-label="Video call"
      onPointerDown={tryUnmuteFromGesture}
    >
      <header className="flex items-center justify-between px-4 sm:px-6 py-4 text-white">
        <div className="flex items-center gap-3 min-w-0">
          {/* Back leaves the call (declines an incoming one) and returns
              to the chat — the overlay has no other way out. */}
          <button
            onClick={() => (call.status === 'incoming' ? props.onDecline() : props.onEnd())}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-indigo-200 hover:bg-white/10 hover:text-white"
            aria-label="Back to chat"
          >
            ← Back
          </button>
          <div className="min-w-0">
            <p className="font-bold text-lg leading-tight">{displayName(call.peer)}</p>
            <p className="text-sm text-slate-300">{statusText(call)}</p>
          </div>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-600 text-white">In-app video call</span>
      </header>

      <div className="relative flex-1 min-h-0 mx-4 sm:mx-6 rounded-2xl overflow-hidden bg-slate-900 ring-1 ring-slate-700">
        {call.status === 'incoming' ? (
          // Full-screen incoming call: big caller, Admin badge, ringing
          // indicator — visible on any tab, impossible to miss.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
            <span className="relative flex h-28 w-28 items-center justify-center rounded-full bg-indigo-600 text-4xl font-bold text-white ring-4 ring-indigo-400/40 sm:h-36 sm:w-36 sm:text-5xl">
              {initials(call.peer)}
              <span className="absolute inset-0 animate-ping rounded-full bg-indigo-500/30" aria-hidden />
            </span>
            <div>
              <p className="text-3xl font-extrabold leading-tight text-white sm:text-4xl">{displayName(call.peer)}</p>
              {call.peer.is_staff && (
                <span className="mt-2 inline-block rounded-full bg-amber-400 px-3 py-1 text-xs font-extrabold uppercase tracking-widest text-slate-950">
                  Admin
                </span>
              )}
              <p className="mt-2 text-lg font-semibold text-indigo-200">📹 Video call</p>
              <p className="mt-1 animate-pulse text-sm font-medium text-slate-300">🔔 Ringing… tap Accept to answer</p>
            </div>
          </div>
        ) : (
          <>
            {/* Always mounted (see the header note): hidden until the
                remote stream exists, so the element is ready the moment
                a track arrives. */}
            <video
              ref={remoteRef}
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
              style={{ visibility: call.remoteStream ? 'visible' : 'hidden' }}
            />
            {!call.remoteStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900 text-slate-300">
                <span className="w-20 h-20 rounded-full bg-indigo-600 text-white flex items-center justify-center text-2xl font-bold">
                  {initials(call.peer)}
                </span>
                <p className="text-sm font-medium">{waitingText}</p>
              </div>
            )}
            {call.remoteStream && !remoteHasVideo && (
              // Audio-only peer (or their camera is off): the video
              // element stays mounted so the audio keeps playing — the
              // avatar overlay explains the picture instead of black.
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/90 text-slate-300">
                <span className="w-20 h-20 rounded-full bg-indigo-600 text-white flex items-center justify-center text-2xl font-bold">
                  {initials(call.peer)}
                </span>
                <p className="text-sm font-medium">
                  {remoteHasAudio ? `${displayName(call.peer)}'s camera is off` : `${displayName(call.peer)} — audio only`}
                </p>
              </div>
            )}
          </>
        )}

        {/* Local preview: always mounted too; hidden when there is no
            video to show (audio-only stream) so it never renders a
            black box. */}
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-3 right-3 w-28 sm:w-44 aspect-video rounded-xl object-cover ring-2 ring-white/70 bg-slate-800"
          style={{ visibility: previewStream && previewHasVideo ? 'visible' : 'hidden' }}
        />
        {previewStream && !previewHasVideo && (
          <span className="absolute bottom-3 right-3 rounded-xl bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-200 ring-2 ring-white/70">
            🎙 Audio only
          </span>
        )}
        {/* Round 3f: camera/mic failure is a banner, not a dead end — the
            call stays live and screen share (which needs neither) works. */}
        {call.mediaError && call.status !== 'ended' && (
          <p className="absolute top-3 left-1/2 -translate-x-1/2 max-w-[90%] text-center rounded-full bg-amber-500/90 text-slate-950 text-xs font-semibold px-3 py-2">
            ⚠ {call.mediaError}
          </p>
        )}
        {call.screenShareError && call.status !== 'ended' && (
          <p className="absolute top-3 left-1/2 -translate-x-1/2 max-w-[90%] text-center rounded-full bg-amber-500/90 text-slate-950 text-xs font-semibold px-3 py-2">
            ⚠ {call.screenShareError}
          </p>
        )}
        {call.screenSharing && (
          <span className="absolute bottom-3 right-3 w-28 sm:w-44 aspect-video rounded-xl bg-slate-800/60 flex items-end justify-center pb-1.5 text-[11px] font-semibold text-emerald-300 pointer-events-none">
            🖥 Sharing your screen
          </span>
        )}
        {/* The browser muted the remote audio (autoplay policy): a big
            centered card — one tap (a real gesture) turns sound on.
            Any other tap in the overlay retries unmuted playback too. */}
        {remoteMuted && call.remoteStream && call.status !== 'ended' && (
          <button
            onClick={unmuteRemote}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-slate-950/85 px-6 py-5 text-center text-white ring-1 ring-white/30"
          >
            <span className="block text-4xl">🔊</span>
            <span className="mt-2 block text-base font-bold">Tap to hear {displayName(call.peer)}</span>
            <span className="mt-1 block text-sm text-slate-300">Your browser muted the call&apos;s sound — one tap turns it on.</span>
          </button>
        )}
        {call.cameraOff && call.localStream && !call.screenSharing && (
          <span className="absolute bottom-3 right-3 w-28 sm:w-44 aspect-video rounded-xl bg-slate-800/80 flex items-center justify-center text-xs font-semibold text-slate-200">
            Camera off
          </span>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-5">
        {call.status === 'incoming' ? (
          <div className="flex w-full max-w-lg flex-col-reverse gap-3 sm:flex-row sm:justify-center">
            <button onClick={props.onDecline} aria-label="Decline call" className="rounded-full bg-red-600 px-8 py-4 text-lg font-bold text-white hover:bg-red-700">
              ✕ Decline
            </button>
            <button onClick={props.onAccept} aria-label="Accept video call" className="rounded-full bg-emerald-600 px-8 py-4 text-lg font-bold text-white hover:bg-emerald-700">
              ✓ Accept video call
            </button>
          </div>
        ) : call.status === 'ended' ? (
          <p className="max-w-2xl text-center text-sm font-medium text-slate-200">{call.notice ?? 'Call ended.'}</p>
        ) : (
          <>
            {/* Round 3f: the control bar renders whatever the media state.
                Mute/Camera need their local tracks, so they disable without
                them; Share screen uses getDisplayMedia — independent of
                camera/mic — so it stays enabled even when getUserMedia
                failed and there is no local stream at all. */}
            <button
              onClick={props.onToggleMute}
              disabled={!call.localStream || call.localStream.getAudioTracks().length === 0}
              title={!call.localStream ? 'No microphone available' : undefined}
              className="rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-semibold px-5 py-3"
            >
              {call.muted ? '🔇 Unmute' : '🎙 Mute'}
            </button>
            <button
              onClick={props.onToggleCamera}
              disabled={!call.localStream || call.localStream.getVideoTracks().length === 0 || call.screenSharing}
              title={call.screenSharing ? 'Camera controls are off while sharing your screen' : !call.localStream ? 'No camera available' : undefined}
              className="rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-semibold px-5 py-3"
            >
              {call.cameraOff ? '📹 Camera on' : '📷 Camera off'}
            </button>
            <button
              onClick={props.onToggleScreenShare}
              disabled={!screenShareSupported}
              title={
                screenShareSupported
                  ? 'Share your screen — works even without a camera or microphone'
                  : "Screen sharing isn't supported on this device or browser"
              }
              className="rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-semibold px-5 py-3"
            >
              {call.screenSharing ? '⏹ Stop sharing' : '🖥 Share screen'}
            </button>
            <button onClick={props.onEnd} className="rounded-full bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3">
              End call
            </button>
          </>
        )}
      </div>
    </div>
  )
}
