"""WebSocket auth middleware — JWT access token via ?token=<jwt>.

Session/cookie auth is NOT accepted here. The token is validated with
SimpleJWT (signature + expiry); missing/invalid tokens get scope user =
AnonymousUser and the consumer closes the connection with code 4401.
"""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

User = get_user_model()


@database_sync_to_async
def _get_user(user_id):
    try:
        return User.objects.get(id=user_id)
    except User.DoesNotExist:
        return AnonymousUser()


class JWTAuthMiddleware:
    """Reads ?token= from the query string and sets scope['user']."""


    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query = parse_qs(scope.get("query_string", b"").decode())
        token_values = query.get("token", [])
        scope["user"] = AnonymousUser()
        if token_values:
            try:
                access_token = AccessToken(token_values[0])
                user_id = access_token.get("user_id")
                if user_id is not None:
                    scope["user"] = await _get_user(user_id)
            except (InvalidToken, TokenError, Exception):
                scope["user"] = AnonymousUser()
        return await self.inner(scope, receive, send)
