"""Real-time chat consumer.

Connect:  ws://<host>/ws/chat/?token=<JWT access token>
  - invalid/missing token -> close code 4401
  - on connect, join group "user_<id>"

Client -> server:
  {"type": "chat.message", "recipient_id": <int>, "body": "<text>"}
  -> message is saved to the DB, then broadcast to group
     "user_<recipient_id>" (is_mine=false) and echoed to the sender's own
     group "user_<sender_id>" (is_mine=true):
  {"type": "chat.message", "message": {id, sender, recipient, body,
                                       created_at, is_mine}}
  Invalid input -> {"type": "error", "detail": "..."} to the sender only.

History always loads from the DB via GET /api/messages/ (never cache-only).
"""
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth import get_user_model

from .models import ChatMessage
from .serializers import UserMiniSerializer

User = get_user_model()


@database_sync_to_async
def _get_user(user_id):
    try:
        return User.objects.get(id=user_id)
    except User.DoesNotExist:
        return None


@database_sync_to_async
def _save_message(sender, receiver, body):
    return ChatMessage.objects.create(
        sender=sender, receiver=receiver, message_body=body
    )


@database_sync_to_async
def _user_dict(user):
    return UserMiniSerializer(user).data


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
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(
                self.group_name, self.channel_name
            )

    async def receive_json(self, content, **kwargs):
        if content.get("type") != "chat.message":
            await self.send_json(
                {"type": "error", "detail": "Unknown message type."}
            )
            return
        recipient_id = content.get("recipient_id")
        body = (content.get("body") or "").strip()
        if not body:
            await self.send_json(
                {"type": "error", "detail": "body must not be empty."}
            )
            return
        recipient = await _get_user(recipient_id)
        if recipient is None:
            await self.send_json(
                {"type": "error", "detail": "Recipient not found."}
            )
            return
        message = await _save_message(self.user, recipient, body)
        sender_data = await _user_dict(self.user)
        recipient_data = await _user_dict(recipient)
        base = {
            "id": message.id,
            "sender": sender_data,
            "recipient": recipient_data,
            "body": message.message_body,
            "created_at": message.sent_at.isoformat(),
        }
        # To the recipient (is_mine=false) and echo to the sender (true).
        await self.channel_layer.group_send(
            f"user_{recipient.id}",
            {"type": "chat_message",
             "data": {**base, "is_mine": False}},
        )
        await self.channel_layer.group_send(
            self.group_name,
            {"type": "chat_message",
             "data": {**base, "is_mine": True}},
        )

    async def chat_message(self, event):
        await self.send_json({"type": "chat.message", "message": event["data"]})
