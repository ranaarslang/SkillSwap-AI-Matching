"""API views for the Skill Swap Platform (JWT auth, base /api)."""
import re

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import authenticate, get_user_model
from django.db.models import Q
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .matcher import MATCH_THRESHOLD, CandidateSkills, get_matcher
from .models import (
    ChatMessage,
    IntegrityReview,
    Profile,
    SwapSession,
    UserSkill,
    recalculate_trust_score,
)
from .serializers import (
    ProfileSerializer,
    ProfileUpdateSerializer,
    ReviewSerializer,
    SessionSerializer,
    UserMiniSerializer,
    full_name_of,
)

User = get_user_model()

ALLOWED_TRANSITIONS = {
    SwapSession.Status.PENDING: {
        SwapSession.Status.ACCEPTED,
        SwapSession.Status.CANCELLED,
    },
    SwapSession.Status.ACCEPTED: {
        SwapSession.Status.COMPLETED,
        SwapSession.Status.CANCELLED,
    },
}


# ---------------------------------------------------------------- auth
def _tokens_for(user):
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def _user_payload(user):
    return {
        "id": user.id,
        "username": user.username,
        "full_name": full_name_of(user),
        "email": user.email,
    }


def _unique_username(email):
    base = slugify(email.split("@")[0]) or "user"
    base = re.sub(r"[^a-z0-9_.-]", "", base) or "user"
    username = base
    n = 2
    while User.objects.filter(username=username).exists():
        username = f"{base}-{n}"
        n += 1
    return username


@api_view(["POST"])
@permission_classes([AllowAny])
def signup(request):
    email = (request.data.get("email") or "").strip().lower()
    password = request.data.get("password") or ""
    full_name = (request.data.get("full_name") or "").strip()
    errors = {}
    if not email or "@" not in email:
        errors["email"] = "A valid email is required."
    elif User.objects.filter(email__iexact=email).exists():
        errors["email"] = "A user with this email already exists."
    if len(password) < 6:
        errors["password"] = "Password must be at least 6 characters."
    if not full_name:
        errors["full_name"] = "Full name is required."
    if errors:
        return Response(errors, status=status.HTTP_400_BAD_REQUEST)

    username = _unique_username(email)
    parts = full_name.split(None, 1)
    user = User.objects.create_user(
        username=username,
        email=email,
        password=password,
        first_name=parts[0],
        last_name=parts[1] if len(parts) > 1 else "",
    )
    Profile.objects.get_or_create(user=user)
    payload = _tokens_for(user)
    payload["user"] = _user_payload(user)
    return Response(payload, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    identifier = (request.data.get("email_or_username") or "").strip()
    # Also accept plain "email" / "username" keys for convenience.
    if not identifier:
        identifier = (request.data.get("email") or "").strip() or (
            request.data.get("username") or ""
        ).strip()
    password = request.data.get("password") or ""
    user = None
    if "@" in identifier:
        try:
            user = User.objects.get(email__iexact=identifier)
        except User.DoesNotExist:
            user = None
    else:
        try:
            user = User.objects.get(username__iexact=identifier)
        except User.DoesNotExist:
            user = None
    if user is not None:
        user = authenticate(username=user.username, password=password)
    if user is None:
        return Response(
            {"detail": "Invalid credentials."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    payload = _tokens_for(user)
    payload["user"] = _user_payload(user)
    return Response(payload, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    # JWTs are stateless: the server cannot revoke an access token without a
    # blacklist store. Logout = client discards its tokens; refresh tokens
    # are accepted here and ignored. Returns 200 per the contract.
    return Response({"detail": "Logged out."}, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok"})


# ---------------------------------------------------------------- profile
def _profile_data(user):
    profile, _ = Profile.objects.get_or_create(user=user)
    return ProfileSerializer(profile).data


def _skills_of(user, skill_type):
    return list(
        UserSkill.objects.filter(user=user, skill_type=skill_type)
        .order_by("skill_name")
        .values_list("skill_name", flat=True)
    )


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def profile_me(request):
    profile, _ = Profile.objects.get_or_create(user=request.user)
    if request.method == "GET":
        return Response(ProfileSerializer(profile).data)
    serializer = ProfileUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.update_profile(request.user, profile, serializer.validated_data)
    profile.refresh_from_db()
    return Response(ProfileSerializer(profile).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def profile_detail(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({"detail": "User not found."}, status=404)
    profile, _ = Profile.objects.get_or_create(user=user)
    return Response(ProfileSerializer(profile).data)


# ---------------------------------------------------------------- matching
def _scored_profiles(me):
    """All other users' profiles + match data, via the matcher interface.

    The matcher is swappable (see swaps/matcher.py): views never touch the
    vectoriser, they only build CandidateSkills inputs and merge the
    MatchResult dicts into the profile payloads.
    """
    me_profile, _ = Profile.objects.get_or_create(user=me)
    me_input = CandidateSkills(
        user_id=me.id,
        username=me.username,
        teach_skills=_skills_of(me, UserSkill.SkillType.TEACH),
        learn_skills=_skills_of(me, UserSkill.SkillType.LEARN),
        location=me_profile.location,
    )
    candidates = []
    profiles = {}
    for user in User.objects.exclude(id=me.id).order_by("username"):
        profile, _ = Profile.objects.get_or_create(user=user)
        profiles[user.id] = profile
        candidates.append(CandidateSkills(
            user_id=user.id,
            username=user.username,
            teach_skills=_skills_of(user, UserSkill.SkillType.TEACH),
            learn_skills=_skills_of(user, UserSkill.SkillType.LEARN),
            location=profile.location,
        ))
    results = []
    for candidate, match in get_matcher().rank_candidates(me_input,
                                                          candidates):
        item = ProfileSerializer(profiles[candidate.user_id]).data
        item.update(match.as_dict())
        results.append(item)
    return results


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def matches(request):
    scored = _scored_profiles(request.user)
    kept = [p for p in scored if p["match_score"] >= MATCH_THRESHOLD]
    kept.sort(key=lambda p: (-p["match_score"], p["user"]["username"]))
    return Response(kept)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def community(request):
    scored = _scored_profiles(request.user)
    kept = [p for p in scored if p["match_score"] < MATCH_THRESHOLD]
    kept.sort(key=lambda p: p["user"]["username"])
    return Response(kept)


# ---------------------------------------------------------------- sessions
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def sessions(request):
    me = request.user
    if request.method == "GET":
        qs = SwapSession.objects.filter(
            Q(partner_one=me) | Q(partner_two=me)
        ).order_by("-created_at")
        return Response(SessionSerializer(qs, many=True).data)

    partner_id = request.data.get("partner_id")
    calendar_date = request.data.get("calendar_date")
    duration_block = (request.data.get("duration_block") or "").strip()
    title = (request.data.get("title") or "").strip()
    if not partner_id or not calendar_date or not duration_block:
        return Response(
            {"detail": "partner_id, calendar_date and duration_block are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        partner = User.objects.get(id=partner_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Partner not found."}, status=404)
    if partner.id == me.id:
        return Response(
            {"detail": "You cannot book a session with yourself."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Double-booking guard: either partner already has a PENDING or ACCEPTED
    # session on the same date with the same duration block.
    clash = SwapSession.objects.filter(
        calendar_date=calendar_date,
        duration_block=duration_block,
        session_status__in=[
            SwapSession.Status.PENDING,
            SwapSession.Status.ACCEPTED,
        ],
    ).filter(Q(partner_one=me) | Q(partner_two=me)
             | Q(partner_one=partner) | Q(partner_two=partner)).exists()
    if clash:
        return Response(
            {"detail": "Double booking: one of you already has a pending or "
                       "accepted session on this date and time block."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    session = SwapSession.objects.create(
        partner_one=me,
        partner_two=partner,
        title=title,
        calendar_date=calendar_date,
        duration_block=duration_block,
        session_status=SwapSession.Status.PENDING,
    )
    return Response(
        SessionSerializer(session).data, status=status.HTTP_201_CREATED
    )


@api_view(["PUT"])
@permission_classes([IsAuthenticated])
def session_detail(request, session_id):
    try:
        session = SwapSession.objects.get(id=session_id)
    except SwapSession.DoesNotExist:
        return Response({"detail": "Session not found."}, status=404)
    me = request.user
    if me.id not in (session.partner_one_id, session.partner_two_id):
        return Response(
            {"detail": "Only a party to the session may change it."},
            status=status.HTTP_403_FORBIDDEN,
        )
    new_status = (request.data.get("session_status") or "").strip().upper()
    allowed = ALLOWED_TRANSITIONS.get(session.session_status, set())
    if new_status not in allowed:
        return Response(
            {"detail": f"Cannot move session from {session.session_status} "
                       f"to {new_status or '(empty)'}. Allowed: "
                       f"{sorted(allowed) or 'none'}."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    session.session_status = new_status
    session.save(update_fields=["session_status"])
    return Response(SessionSerializer(session).data)


# ---------------------------------------------------------------- messaging
def _message_payload(message, viewer):
    return {
        "id": message.id,
        "sender": UserMiniSerializer(message.sender).data,
        "recipient": UserMiniSerializer(message.receiver).data,
        "body": message.message_body,
        "created_at": message.sent_at.isoformat(),
        "is_mine": message.sender_id == viewer.id,
    }


def _broadcast_message(message):
    """Push a saved message to both the recipient's and sender's WS groups."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    base = {
        "id": message.id,
        "sender": UserMiniSerializer(message.sender).data,
        "recipient": UserMiniSerializer(message.receiver).data,
        "body": message.message_body,
        "created_at": message.sent_at.isoformat(),
    }
    for user_id, is_mine in (
        (message.receiver_id, False),
        (message.sender_id, True),
    ):
        payload = dict(base)
        payload["is_mine"] = is_mine
        async_to_sync(channel_layer.group_send)(
            f"user_{user_id}",
            {"type": "chat_message", "data": payload},
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def conversations(request):
    me = request.user
    msgs = ChatMessage.objects.filter(
        Q(sender=me) | Q(receiver=me)
    ).order_by("-sent_at")
    peers = {}
    for m in msgs:
        peer = m.receiver if m.sender_id == me.id else m.sender
        if peer.id not in peers:
            peers[peer.id] = {"peer": peer, "last": m}
    out = []
    for peer_id, info in peers.items():
        unread = ChatMessage.objects.filter(
            sender_id=peer_id, receiver=me, is_read=False
        ).count()
        out.append({
            "peer": UserMiniSerializer(info["peer"]).data,
            "last_message": {
                "body": info["last"].message_body,
                "created_at": info["last"].sent_at.isoformat(),
                "sender_id": info["last"].sender_id,
            },
            "unread_count": unread,
        })
    out.sort(key=lambda c: c["last_message"]["created_at"], reverse=True)
    return Response(out)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def messages(request):
    me = request.user
    if request.method == "GET":
        peer_id = request.query_params.get("peer")
        if not peer_id:
            return Response(
                {"detail": "Query parameter ?peer=<user_id> is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            peer = User.objects.get(id=peer_id)
        except (User.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "Peer not found."}, status=404)
        qs = ChatMessage.objects.filter(
            Q(sender=me, receiver=peer) | Q(sender=peer, receiver=me)
        ).order_by("sent_at")
        # Mark their messages to me as read.
        ChatMessage.objects.filter(
            sender=peer, receiver=me, is_read=False
        ).update(is_read=True)
        data = [
            _message_payload(m, me)
            for m in qs.select_related("sender", "receiver")
        ]
        return Response(data)

    recipient_id = request.data.get("recipient_id")
    body = (request.data.get("body") or "").strip()
    if not recipient_id or not body:
        return Response(
            {"detail": "recipient_id and a non-empty body are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        recipient = User.objects.get(id=recipient_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Recipient not found."}, status=404)
    message = ChatMessage.objects.create(
        sender=me, receiver=recipient, message_body=body
    )
    _broadcast_message(message)
    return Response(
        _message_payload(message, me), status=status.HTTP_201_CREATED
    )


# ---------------------------------------------------------------- reviews
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def reviews(request):
    me = request.user
    if request.method == "GET":
        user_id = request.query_params.get("user")
        qs = IntegrityReview.objects.all()
        if user_id:
            qs = qs.filter(target_user_id=user_id)
        qs = qs.order_by("-created_at")
        return Response(ReviewSerializer(qs, many=True).data)

    session_id = request.data.get("session_id")
    rating = request.data.get("rating_stars")
    feedback_text = request.data.get("feedback_text") or ""
    try:
        session = SwapSession.objects.get(id=session_id)
    except (SwapSession.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Session not found."}, status=404)
    if session.session_status != SwapSession.Status.COMPLETED:
        return Response(
            {"detail": "Reviews are only allowed for completed sessions."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if me.id not in (session.partner_one_id, session.partner_two_id):
        return Response(
            {"detail": "Only a party to the session may review it."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if IntegrityReview.objects.filter(session=session, author_user=me).exists():
        return Response(
            {"detail": "You have already reviewed this session."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        rating = int(rating)
    except (TypeError, ValueError):
        return Response(
            {"detail": "rating_stars must be an integer 1-5."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not 1 <= rating <= 5:
        return Response(
            {"detail": "rating_stars must be between 1 and 5."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    target = (
        session.partner_two
        if session.partner_one_id == me.id
        else session.partner_one
    )
    review = IntegrityReview.objects.create(
        session=session,
        author_user=me,
        target_user=target,
        rating_stars=rating,
        feedback_text=feedback_text or None,
    )
    recalculate_trust_score(target)
    return Response(
        ReviewSerializer(review).data, status=status.HTTP_201_CREATED
    )
