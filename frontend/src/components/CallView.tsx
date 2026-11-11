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
        {call.remoteStream ? (
          <video ref={remoteRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300">
            <span className="w-20 h-20 rounded-full bg-indigo-600 text-white flex items-center justify-center text-2xl font-bold">
              {initials(call.peer)}
            </span>
            <p className="text-sm font-medium">{statusText(call)}</p>
            {call.status === 'incoming' && <p className="text-xs text-slate-400">Answer to turn on your camera and microphone.</p>}
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
          <>
            <button onClick={props.onDecline} className="rounded-full bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3">
              Decline
            </button>
            <button onClick={props.onAccept} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-3">
              Accept video call
            </button>
          </>
        ) : call.status === 'ended' ? (
          <p className="text-slate-200 text-sm font-medium">{call.notice ?? 'Call ended.'}</p>
        ) : (
          <>
            <button
              onClick={props.onToggleMute}
              disabled={!call.localStream}
              className="rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-semibold px-5 py-3"
            >
              {call.muted ? '🔇 Unmute' : '🎙 Mute'}
            </button>
            <button
              onClick={props.onToggleCamera}
              disabled={!call.localStream || call.screenSharing}
              title={call.screenSharing ? 'Camera controls are off while sharing your screen' : undefined}
              className="rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-semibold px-5 py-3"
            >
              {call.cameraOff ? '📹 Camera on' : '📷 Camera off'}
            </button>
            <button
              onClick={props.onToggleScreenShare}
              disabled={!call.localStream}
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
