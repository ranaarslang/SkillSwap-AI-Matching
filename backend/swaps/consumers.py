"""Real-time chat + video-call signaling consumer.

Connect:  ws://<host>/ws/chat/?token=<JWT access token>
  - invalid/missing token -> close code 4401
  - on connect, join group "user_<id>"

Chat (client -> server):
  {"type": "chat.message", "recipient_id": <int>, "body": "<text>",
   "code_language": "<python|...>" (optional)}
  -> message is saved to the DB, then broadcast to group
     "user_<recipient_id>" (is_mine=false) and echoed to the sender's own
     group "user_<sender_id>" (is_mine=true):
  {"type": "chat.message", "message": {id, sender, recipient, body,
                                       created_at, is_mine, code_language,
                                       attachment}}
  Invalid input -> {"type": "error", "detail": "..."} to the sender only.

Video calls (WebRTC peer-to-peer media; this consumer only RELAYS the
signaling — no media ever touches the server):
  caller:  {"type": "call.invite",  "to_user_id": <int>, "call_id": "<uuid>"}
  callee:  {"type": "call.accept",  "call_id": "<uuid>"}  (or "call.decline")
  caller:  {"type": "call.offer",   "to_user_id": <int>, "call_id": "<uuid>",
            "sdp": {...}}
  callee:  {"type": "call.answer",  "to_user_id": <int>, "call_id": "<uuid>",
            "sdp": {...}}
  either:  {"type": "call.ice",     "to_user_id": <int>, "call_id": "<uuid>",
            "candidate": {...}}
  either:  {"type": "call.end",     "call_id": "<uuid>"}
  Relays:  {"type": "call.incoming", "call_id": ..., "from_user": {...}}
           {"type": "call.accepted"/"call.declined"/"call.ended",
            "call_id": ..., "from_user_id": ...}
           {"type": "call.offer"/"call.answer"/"call.ice",
            "call_id": ..., "from_user_id": ..., "sdp"/"candidate": ...}
  Invite to an offline user -> {"type": "call.offline", "call_id": ...,
                                "to_user_id": ...} to the caller only.
  One call per user at a time; a second invite while busy is rejected
  with {"type": "error", ...}.

Presence + call state live in module-level dicts. That is correct for
this deployment (one Daphne worker: Render free tier runs a single
worker, and local dev runs one worker) and for the in-memory channel
layer — it would NOT be correct with multiple workers (that needs
Redis). If the backend ever scales to several workers, move ONLINE_USERS
and ACTIVE_CALLS into the channel layer / a shared store.
"""
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth import get_user_model

from .message_filter import flag_reasons
from .models import CODE_LANGUAGES, ChatMessage
from .serializers import UserMiniSerializer, attachment_payload
from .views import _attachment_of

User = get_user_model()

# user ids currently holding a live WS connection (single worker — see note)
ONLINE_USERS: set = set()
# call_id -> {"caller": int, "callee": int, "state": "ringing"|"active"}
ACTIVE_CALLS: dict = {}

CALL_TYPES = {"call.invite", "call.accept", "call.decline", "call.offer",
              "call.answer", "call.ice", "call.end"}


@database_sync_to_async
def _get_user(user_id):
    try:
        return User.objects.get(id=user_id)
    except User.DoesNotExist:
        return None


@database_sync_to_async
def _save_message(sender, receiver, body, code_language=None):
    # Round 3c: a number or a link is HELD for admin approval — saved as
    # pending and only the sender is told. Never rejected at the door,
    # never delivered until approved. Normal messages are created
    # approved and flow instantly. Round 5: staff messages skip the
    # hold — the admin IS the moderator, so an admin message to a student
    # (e.g. from the user record) must reach them immediately.
    message = ChatMessage.objects.create(
        sender=sender, receiver=receiver, message_body=body,
        code_language=code_language,
    )
    reasons = flag_reasons(body)
    if reasons and not sender.is_staff:
        message.moderation_status = ChatMessage.ModerationStatus.PENDING
        message.flag_reason = ",".join(reasons)
        message.save(update_fields=["moderation_status", "flag_reason"])
    return message


@database_sync_to_async
def _user_dict(user):
    return UserMiniSerializer(user).data


@database_sync_to_async
def _message_payload_for(message, viewer):
    """Full WS message payload, incl. code language + signed attachment
    URL for this viewer (same shape as the REST _message_payload)."""
    att = _attachment_of(message)
    return {
        "id": message.id,
        "sender": UserMiniSerializer(message.sender).data,
        "recipient": UserMiniSerializer(message.receiver).data,
        "body": message.message_body,
        "created_at": message.sent_at.isoformat(),
        "is_mine": message.sender_id == viewer.id,
        "code_language": message.code_language,
        "attachment": attachment_payload(att, viewer) if att else None,
        # Round 3c: moderation — pending/rejected messages are only ever
        # sent to their sender, never to the recipient.
        "moderation_status": message.moderation_status,
        "flag_reason": message.flag_reason,
    }


class ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            # Daphne answers a close-during-connect with an HTTP 403 and the
            # client never sees the close code, so accept first and then
            # close with 4401 — the client observes the 4401 close frame.
            await self.accept()
            await self.close(code=4401)
            return
        self.user = user
        self.group_name = f"user_{user.id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        ONLINE_USERS.add(user.id)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(
                self.group_name, self.channel_name
            )
        if hasattr(self, "user"):
            ONLINE_USERS.discard(self.user.id)
            # If I was mid-call, tell the other side it ended.
            for call_id, call in list(ACTIVE_CALLS.items()):
                if self.user.id in (call["caller"], call["callee"]):
                    peer_id = (call["callee"] if self.user.id == call["caller"]
                               else call["caller"])
                    del ACTIVE_CALLS[call_id]
                    await self.channel_layer.group_send(
                        f"user_{peer_id}",
                        {"type": "call_event",
                         "data": {"type": "call.ended", "call_id": call_id,
                                  "from_user_id": self.user.id,
                                  "reason": "peer disconnected"}},
                    )

    async def receive_json(self, content, **kwargs):
        msg_type = content.get("type")
        if msg_type == "chat.message":
            await self._handle_chat_message(content)
        elif msg_type in CALL_TYPES:
            await self._handle_call(content)
        else:
            await self.send_json(
                {"type": "error", "detail": "Unknown message type."}
            )

    # ---------------------------------------------------------------- chat
    async def _handle_chat_message(self, content):
        recipient_id = content.get("recipient_id")
        body = (content.get("body") or "").strip()
        if not body:
            await self.send_json(
                {"type": "error", "detail": "body must not be empty."}
            )
            return
        code_language = content.get("code_language") or None
        if code_language is not None:
            code_language = str(code_language).strip().lower()
            if code_language not in CODE_LANGUAGES:
                await self.send_json(
                    {"type": "error",
                     "detail": f"Unsupported code language: {code_language}."}
                )
                return
        recipient = await _get_user(recipient_id)
        if recipient is None:
            await self.send_json(
                {"type": "error", "detail": "Recipient not found."}
            )
            return
        message = await _save_message(
            self.user, recipient, body, code_language
        )
        # To the recipient (is_mine=false) and echo to the sender (true).
        # Round 3c: a held (pending) message goes to the sender ONLY —
        # the recipient never sees it until an admin approves it.
        targets = ((self.user, True),)
        if message.moderation_status == ChatMessage.ModerationStatus.APPROVED:
            targets = ((recipient, False), (self.user, True))
        for viewer, is_mine in targets:
            payload = await _message_payload_for(message, viewer)
            payload["is_mine"] = is_mine
            await self.channel_layer.group_send(
                f"user_{viewer.id}",
                {"type": "chat_message", "data": payload},
            )

    async def chat_message(self, event):
        await self.send_json({"type": "chat.message", "message": event["data"]})

    # ---------------------------------------------------------------- calls
    async def _handle_call(self, content):
        msg_type = content["type"]
        call_id = content.get("call_id")
        if not isinstance(call_id, str) or not call_id or len(call_id) > 64:
            await self.send_json(
                {"type": "error", "detail": "call_id is required."}
            )
            return

        if msg_type == "call.invite":
            await self._call_invite(content, call_id)
            return
        call = ACTIVE_CALLS.get(call_id)
        if call is None:
            await self.send_json(
                {"type": "error", "detail": "Unknown or ended call."}
            )
            return
        if self.user.id not in (call["caller"], call["callee"]):
            await self.send_json(
                {"type": "error", "detail": "You are not part of this call."}
            )
            return
        peer_id = (call["callee"] if self.user.id == call["caller"]
                   else call["caller"])

        if msg_type == "call.accept":
            if self.user.id != call["callee"] or call["state"] != "ringing":
                await self.send_json(
                    {"type": "error", "detail": "This call cannot be accepted."}
                )
                return
            call["state"] = "active"
            await self._relay(peer_id, {"type": "call.accepted",
                                        "call_id": call_id,
                                        "from_user_id": self.user.id})
        elif msg_type == "call.decline":
            if self.user.id != call["callee"] or call["state"] != "ringing":
                await self.send_json(
                    {"type": "error", "detail": "This call cannot be declined."}
                )
                return
            del ACTIVE_CALLS[call_id]
            await self._relay(peer_id, {"type": "call.declined",
                                        "call_id": call_id,
                                        "from_user_id": self.user.id})
        elif msg_type in ("call.offer", "call.answer"):
            sdp = content.get("sdp")
            if not isinstance(sdp, dict) or "type" not in sdp:
                await self.send_json(
                    {"type": "error", "detail": "sdp is required."}
                )
                return
            await self._relay(peer_id, {"type": msg_type, "call_id": call_id,
                                        "from_user_id": self.user.id,
                                        "sdp": sdp})
        elif msg_type == "call.ice":
            candidate = content.get("candidate")
            if not isinstance(candidate, dict):
                await self.send_json(
                    {"type": "error", "detail": "candidate is required."}
                )
                return
            await self._relay(peer_id, {"type": "call.ice", "call_id": call_id,
                                        "from_user_id": self.user.id,
                                        "candidate": candidate})
        elif msg_type == "call.end":
            del ACTIVE_CALLS[call_id]
            await self._relay(peer_id, {"type": "call.ended", "call_id": call_id,
                                        "from_user_id": self.user.id})

    async def _call_invite(self, content, call_id):
        to_user_id = content.get("to_user_id")
        if to_user_id == self.user.id:
            await self.send_json(
                {"type": "error", "detail": "You cannot call yourself."}
            )
            return
        recipient = await _get_user(to_user_id)
        if recipient is None:
            await self.send_json(
                {"type": "error", "detail": "Recipient not found."}
            )
            return
        if call_id in ACTIVE_CALLS:
            await self.send_json(
                {"type": "error", "detail": "This call already exists."}
            )
            return
        if any(self.user.id in (c["caller"], c["callee"])
               for c in ACTIVE_CALLS.values()):
            await self.send_json(
                {"type": "error", "detail": "You are already in a call."}
            )
            return
        if to_user_id not in ONLINE_USERS:
            await self.send_json({"type": "call.offline", "call_id": call_id,
                                  "to_user_id": to_user_id})
            return
        ACTIVE_CALLS[call_id] = {"caller": self.user.id,
                                 "callee": to_user_id, "state": "ringing"}
        from_user = await _user_dict(self.user)
        await self.channel_layer.group_send(
            f"user_{to_user_id}",
            {"type": "call_event",
             "data": {"type": "call.incoming", "call_id": call_id,
                      "from_user": from_user}},
        )

    async def _relay(self, peer_id, data):
        await self.channel_layer.group_send(
            f"user_{peer_id}", {"type": "call_event", "data": data}
        )

    async def call_event(self, event):
        await self.send_json(event["data"])
