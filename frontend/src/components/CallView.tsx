// In-app video-call overlay (round 3b). Rendered at App level so an
// incoming call rings no matter which tab the user is on. Local video is
// muted (no echo); remote video plays the peer's stream.
import { useEffect, useRef, useState } from 'react'
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

export default function CallView(props: Props) {
  const { call } = props
  const localRef = useRef<HTMLVideoElement>(null)
  const remoteRef = useRef<HTMLVideoElement>(null)
  // Autoplay with sound can be blocked when the remote stream arrives
  // after the Accept tap's user activation expires — then fall back to
  // muted playback and offer an unmute button.
  const [remoteMuted, setRemoteMuted] = useState(false)

  // While sharing, the local preview shows the screen, not the camera.
  const previewStream = call.screenSharing && call.screenStream ? call.screenStream : call.localStream

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = previewStream
  }, [previewStream])
  useEffect(() => {
    const v = remoteRef.current
    if (v && call.remoteStream) {
      v.srcObject = call.remoteStream
      v.play().catch(() => {
        v.muted = true
        setRemoteMuted(true)
        v.play().catch(() => {})
      })
    }
  }, [call.remoteStream])

  function unmuteRemote() {
    const v = remoteRef.current
    if (!v) return
    v.muted = false
    setRemoteMuted(false)
    v.play().catch(() => {})
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col" role="dialog" aria-label="Video call">
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
        ) : call.remoteStream ? (
          <video ref={remoteRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300">
            <span className="w-20 h-20 rounded-full bg-indigo-600 text-white flex items-center justify-center text-2xl font-bold">
              {initials(call.peer)}
            </span>
            <p className="text-sm font-medium">{statusText(call)}</p>
          </div>
        )}

        {previewStream && (
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-3 right-3 w-28 sm:w-44 aspect-video rounded-xl object-cover ring-2 ring-white/70 bg-slate-800"
          />
        )}
        {/* Round 3f: camera/mic failure is a banner, not a dead end — the
            call stays live and screen share (which needs neither) works. */}
        {call.mediaError && call.status !== 'ended' && (
          <p className="absolute top-3 left-1/2 -translate-x-1/2 max-w-[90%] text-center rounded-full bg-amber-500/90 text-slate-950 text-xs font-semibold px-3 py-2">
            ⚠ {call.mediaError}
          </p>
        )}
        {call.screenSharing && (
          <span className="absolute bottom-3 right-3 w-28 sm:w-44 aspect-video rounded-xl bg-slate-800/60 flex items-end justify-center pb-1.5 text-[11px] font-semibold text-emerald-300 pointer-events-none">
            🖥 Sharing your screen
          </span>
        )}
        {remoteMuted && call.remoteStream && (
          <button
            onClick={unmuteRemote}
            className="absolute top-3 left-3 rounded-full bg-slate-800/80 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-2"
          >
            🔊 Tap to unmute
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
              title="Share your screen — works even without a camera or microphone"
              className="rounded-full bg-slate-700 hover:bg-slate-600 text-white font-semibold px-5 py-3"
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
