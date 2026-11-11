"""API views for the Skill Swap Platform (JWT auth, base /api)."""
import os
import re

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import authenticate, get_user_model
from django.core import signing
from django.db.models import Avg, Q
from django.http import FileResponse
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .matcher import MATCH_THRESHOLD, CandidateSkills, get_matcher
from .message_filter import flag_reasons
from .models import (
    ALLOWED_ATTACHMENT_EXTENSIONS,
    CODE_LANGUAGES,
    MAX_ATTACHMENT_BYTES,
    ChatAttachment,
    ChatMessage,
    IntegrityReview,
    Profile,
    SwapSession,
    UserSkill,
    recalculate_trust_score,
)
from .serializers import (
    ATTACHMENT_URL_MAX_AGE_SECONDS,
    ATTACHMENT_URL_SALT,
    ProfileSerializer,
    ProfileUpdateSerializer,
    ReviewSerializer,
    SessionSerializer,
    UserMiniSerializer,
    attachment_payload,
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
        "is_staff": bool(user.is_staff),
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


def _clean_skill_names(raw):
    """Trim, dedupe (case-insensitive) and cap a list of skill names."""
    seen = set()
    out = []
    if not isinstance(raw, (list, tuple)):
        return out
    for item in raw:
        name = str(item).strip()
        if name and len(name) <= 120 and name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out[:20]


def _create_skills(user, names, skill_type):
    for name in _clean_skill_names(names):
        UserSkill.objects.get_or_create(
            user=user, skill_name=name, skill_type=skill_type
        )


@api_view(["POST"])
@permission_classes([AllowAny])
def signup(request):
    email = (request.data.get("email") or "").strip().lower()
    password = request.data.get("password") or ""
    full_name = (request.data.get("full_name") or "").strip()
    teach_skills = _clean_skill_names(request.data.get("teach_skills"))
    learn_skills = _clean_skill_names(request.data.get("learn_skills"))
    errors = {}
    if not email or "@" not in email:
        errors["email"] = "A valid email is required."
    elif User.objects.filter(email__iexact=email).exists():
        errors["email"] = "A user with this email already exists."
    if len(password) < 6:
        errors["password"] = "Password must be at least 6 characters."
    if not full_name:
        errors["full_name"] = "Full name is required."
    if not teach_skills:
        errors["teach_skills"] = "Pick at least one skill you can teach."
    if not learn_skills:
        errors["learn_skills"] = "Pick at least one skill you want to learn."
    if errors:
        return Response(errors, status=status.HTTP_400_BAD_REQUEST)

    # Round 3c: location is country + city, taken at signup when given.
    country = (request.data.get("country") or "").strip()[:100]
    location = (request.data.get("location") or "").strip()[:120]

    username = _unique_username(email)
    parts = full_name.split(None, 1)
    user = User.objects.create_user(
        username=username,
        email=email,
        password=password,
        first_name=parts[0],
        last_name=parts[1] if len(parts) > 1 else "",
    )
    profile, _ = Profile.objects.get_or_create(user=user)
    if country:
        profile.country = country
    if location:
        profile.location = location
    if country or location:
        profile.save(update_fields=["country", "location"])
    _create_skills(user, teach_skills, UserSkill.SkillType.TEACH)
    _create_skills(user, learn_skills, UserSkill.SkillType.LEARN)
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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """Let a logged-in user change their OWN password.

    The admin panel's reset-password is for fixing other users' accounts;
    this is the self-service route (used by the Profile "Change Password"
    section, including the admin changing their own password). The new
    password takes effect immediately for the next login.
    """
    current = request.data.get("current_password") or ""
    new_password = request.data.get("new_password") or ""
    if not request.user.check_password(current):
        return Response(
            {"detail": "Your current password is incorrect."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(new_password) < 6:
        return Response(
            {"detail": "New password must be at least 6 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    request.user.set_password(new_password)
    request.user.save(update_fields=["password"])
    return Response({"detail": "Password changed."}, status=status.HTTP_200_OK)


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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def search_users(request):
    """Directory search: find any student by name/username.

    The dashboard's navbar search only filters the matches/community
    lists loaded at login, so a friend who signed up later (or with no
    skill overlap) is unfindable there. This is a live server-side
    search over all student accounts: first/last name or username,
    icontains. Excludes the caller and staff accounts; capped at 20.
    """
    q = (request.query_params.get("q") or "").strip()
    if len(q) < 2:
        return Response(
            {"detail": "Search needs at least 2 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    qs = (
        User.objects.filter(is_staff=False)
        .exclude(id=request.user.id)
        .filter(
            Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
            | Q(username__icontains=q)
        )
        .order_by("username")[:20]
    )
    profiles = [Profile.objects.get_or_create(user=u)[0] for u in qs]
    return Response(ProfileSerializer(profiles, many=True).data)


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
    # Staff/admin accounts are not students — they never appear as matches.
    for user in User.objects.exclude(id=me.id).filter(is_staff=False).order_by("username"):
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
def _attachment_of(message):
    """The message's ChatAttachment, or None. Reverse OneToOne raises
    DoesNotExist when the relation wasn't pre-fetched, so catch it."""
    try:
        return message.attachment
    except ChatAttachment.DoesNotExist:
        return None


def _message_payload(message, viewer):
    att = _attachment_of(message)
    return {
        "id": message.id,
        "sender": UserMiniSerializer(message.sender).data,
        "recipient": UserMiniSerializer(message.receiver).data,
        "body": message.message_body,
        "created_at": message.sent_at.isoformat(),
        "is_mine": message.sender_id == viewer.id,
        # Round 3b: code snippets + file attachments ride on the message.
        "code_language": message.code_language,
        "attachment": attachment_payload(att, viewer) if att else None,
        # Round 3c: moderation — pending/rejected messages are only ever
        # sent to their sender, never to the recipient.
        "moderation_status": message.moderation_status,
        "flag_reason": message.flag_reason,
    }


def _broadcast_message(message, only_sender=False):
    """Push a saved message to the recipient's and sender's WS groups.

    The payload is built per viewer (the attachment download URL is signed
    for that viewer), so each side gets its own copy. Flagged (pending or
    rejected) messages go to the sender ONLY — the recipient never sees
    them until an admin approves.
    """
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    targets = [(message.sender, True)]
    if not only_sender:
        targets.append((message.receiver, False))
    for viewer, is_mine in targets:
        payload = _message_payload(message, viewer)
        payload["is_mine"] = is_mine
        async_to_sync(channel_layer.group_send)(
            f"user_{viewer.id}",
            {"type": "chat_message", "data": payload},
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def conversations(request):
    me = request.user
    msgs = ChatMessage.objects.filter(
        Q(sender=me) | Q(receiver=me)
    ).order_by("-sent_at").select_related("sender", "receiver", "attachment")
    peers = {}
    for m in msgs:
        # Round 3c: a pending/rejected message is visible only to its
        # sender. For the recipient it must not even create a preview.
        if (m.moderation_status != ChatMessage.ModerationStatus.APPROVED
                and m.sender_id != me.id):
            continue
        peer = m.receiver if m.sender_id == me.id else m.sender
        if peer.id not in peers:
            peers[peer.id] = {"peer": peer, "last": m}
    out = []
    for peer_id, info in peers.items():
        unread = ChatMessage.objects.filter(
            sender_id=peer_id, receiver=me, is_read=False,
            moderation_status=ChatMessage.ModerationStatus.APPROVED,
        ).count()
        last = info["last"]
        last_att = _attachment_of(last)
        if last.moderation_status == ChatMessage.ModerationStatus.PENDING:
            preview = "⏳ Waiting for admin approval"
        elif last.moderation_status == ChatMessage.ModerationStatus.REJECTED:
            preview = "🚫 Message not approved"
        else:
            preview = last.message_body
        out.append({
            "peer": UserMiniSerializer(info["peer"]).data,
            "last_message": {
                "body": preview,
                "created_at": last.sent_at.isoformat(),
                "sender_id": last.sender_id,
                "attachment_name": last_att.original_filename if last_att else None,
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
        # Round 3c: pending/rejected messages are visible only to their
        # sender — the recipient never sees them until an admin approves.
        qs = ChatMessage.objects.filter(
            (Q(sender=me, receiver=peer) | Q(sender=peer, receiver=me))
            & (Q(moderation_status=ChatMessage.ModerationStatus.APPROVED)
               | Q(sender=me))
        ).order_by("sent_at")
        # Mark their messages to me as read (only approved ones can be
        # unread — pending messages are invisible to the recipient).
        ChatMessage.objects.filter(
            sender=peer, receiver=me, is_read=False,
            moderation_status=ChatMessage.ModerationStatus.APPROVED,
        ).update(is_read=True)
        data = [
            _message_payload(m, me)
            for m in qs.select_related("sender", "receiver", "attachment")
        ]
        return Response(data)

    recipient_id = request.data.get("recipient_id")
    body = (request.data.get("body") or "").strip()
    code_language = request.data.get("code_language") or None
    if code_language is not None:
        code_language = str(code_language).strip().lower()
        if code_language not in CODE_LANGUAGES:
            return Response(
                {"detail": f"Unsupported code language: {code_language}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
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
        sender=me, receiver=recipient, message_body=body,
        code_language=code_language,
    )
    # Round 3c: a number or a link is HELD for admin approval — saved as
    # pending and only the sender is told. Never rejected at the door,
    # never delivered until approved.
    reasons = flag_reasons(body)
    if reasons:
        message.moderation_status = ChatMessage.ModerationStatus.PENDING
        message.flag_reason = ",".join(reasons)
        message.save(update_fields=["moderation_status", "flag_reason"])
        _broadcast_message(message, only_sender=True)
    else:
        _broadcast_message(message)
    return Response(
        _message_payload(message, me), status=status.HTTP_201_CREATED
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_message(request):
    """Send a document/file inside a chat (round 3b, in-app document
    sharing). Multipart: recipient_id, optional body, file. The file is
    stored on the backend; the returned message carries a signed download
    URL for the viewer. 10 MB cap, images/PDF/docs only."""
    me = request.user
    recipient_id = request.data.get("recipient_id")
    body = (request.data.get("body") or "").strip()
    upload = request.FILES.get("file")
    if not recipient_id:
        return Response(
            {"detail": "recipient_id is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if upload is None:
        return Response(
            {"detail": "No file attached."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if upload.size > MAX_ATTACHMENT_BYTES:
        return Response(
            {"detail": "File is too large — the limit is 10 MB."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    ext = os.path.splitext(upload.name)[1].lower()
    if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
        return Response(
            {"detail": f"File type {ext or '(none)'} is not allowed. "
                       "Send an image, a PDF or a document."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        recipient = User.objects.get(id=recipient_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Recipient not found."}, status=404)
    if recipient.id == me.id:
        return Response(
            {"detail": "You cannot send a file to yourself."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    message = ChatMessage.objects.create(
        sender=me, receiver=recipient, message_body=body
    )
    ChatAttachment.objects.create(
        message=message,
        file=upload,
        original_filename=upload.name[:255],
        content_type=upload.content_type or "",
        size=upload.size,
    )
    # Round 3c: a flagged caption holds the whole message (file included)
    # for admin approval, exactly like a flagged text message.
    reasons = flag_reasons(body)
    if reasons:
        message.moderation_status = ChatMessage.ModerationStatus.PENDING
        message.flag_reason = ",".join(reasons)
        message.save(update_fields=["moderation_status", "flag_reason"])
        _broadcast_message(message, only_sender=True)
    else:
        _broadcast_message(message)
    return Response(
        _message_payload(message, me), status=status.HTTP_201_CREATED
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def download_attachment(request, attachment_id):
    """Serve one chat attachment. Auth is the signed ?t= token minted by
    attachment_download_url (bound to one viewer, 1 hour). The viewer must
    be a participant of the message, or staff (moderation). Images stream
    inline so <img> can show them; other files download."""
    token = request.query_params.get("t") or ""
    try:
        claims = signing.loads(
            token, salt=ATTACHMENT_URL_SALT,
            max_age=ATTACHMENT_URL_MAX_AGE_SECONDS,
        )
    except signing.BadSignature:
        return Response(
            {"detail": "This download link is invalid or has expired."},
            status=status.HTTP_403_FORBIDDEN,
        )
    try:
        attachment = ChatAttachment.objects.select_related(
            "message__sender", "message__receiver"
        ).get(id=attachment_id)
    except (ChatAttachment.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Attachment not found."}, status=404)
    if claims.get("att") != attachment.id:
        return Response({"detail": "Invalid download link."},
                        status=status.HTTP_403_FORBIDDEN)
    try:
        viewer = User.objects.get(id=claims.get("u"))
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Invalid download link."},
                        status=status.HTTP_403_FORBIDDEN)
    msg = attachment.message
    if viewer.id not in (msg.sender_id, msg.receiver_id) and not viewer.is_staff:
        return Response({"detail": "You are not part of this chat."},
                        status=status.HTTP_403_FORBIDDEN)
    if not attachment.file or not os.path.exists(attachment.file.path):
        return Response(
            {"detail": "This file is no longer available on the server."},
            status=status.HTTP_410_GONE,
        )
    is_image = attachment.file.name.lower().endswith(
        (".jpg", ".jpeg", ".png", ".gif", ".webp")
    )
    return FileResponse(
        open(attachment.file.path, "rb"),
        content_type=attachment.content_type or "application/octet-stream",
        as_attachment=not is_image,
        filename=None if is_image else attachment.original_filename,
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
        # Round 3c audit fix (REQ-05.1): the Feedback Hub must hide
        # partners the user has ALREADY reviewed — even after a reload.
        # `?author=me` lists only the current user's authored reviews so
        # the UI can seed its reviewed-session list from the server
        # instead of relying on in-visit state alone.
        if request.query_params.get("author") == "me":
            qs = qs.filter(author_user=me)
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


# ---------------------------------------------------------------- admin
# Staff-only management endpoints. IsAdminUser requires is_staff; the
# admin demo account (seed_demo.py) is a staff superuser. Public
# endpoints above are untouched by this section.
def _admin_user_data(user):
    """Full profile payload + account flags for the admin users table."""
    profile, _ = Profile.objects.get_or_create(user=user)
    data = ProfileSerializer(profile).data
    data["is_active"] = user.is_active
    data["is_staff"] = user.is_staff
    data["date_joined"] = user.date_joined.isoformat()
    return data


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_stats(request):
    sessions = SwapSession.objects.all()
    avg_trust = Profile.objects.aggregate(avg=Avg("trust_score"))["avg"]
    return Response({
        "total_users": User.objects.count(),
        "total_students": User.objects.filter(is_staff=False).count(),
        "total_sessions": sessions.count(),
        "sessions_pending": sessions.filter(
            session_status=SwapSession.Status.PENDING).count(),
        "sessions_accepted": sessions.filter(
            session_status=SwapSession.Status.ACCEPTED).count(),
        "sessions_completed": sessions.filter(
            session_status=SwapSession.Status.COMPLETED).count(),
        "sessions_cancelled": sessions.filter(
            session_status=SwapSession.Status.CANCELLED).count(),
        "total_messages": ChatMessage.objects.count(),
        "total_reviews": IntegrityReview.objects.count(),
        "average_trust_score": round(avg_trust, 1) if avg_trust is not None else 100,
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_users(request):
    q = (request.query_params.get("q") or "").strip()
    qs = User.objects.all().order_by("username")
    if q:
        qs = qs.filter(
            Q(username__icontains=q)
            | Q(email__icontains=q)
            | Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
        )
    return Response([_admin_user_data(u) for u in qs])


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_toggle_user_active(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "User not found."}, status=404)
    if user.id == request.user.id:
        return Response(
            {"detail": "You cannot deactivate your own admin account."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user.is_active = not user.is_active
    user.save(update_fields=["is_active"])
    return Response(_admin_user_data(user))


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_toggle_verified(request, user_id):
    """Round 3c audit fix (SRS REQ-01.4): let an admin toggle a user's
    profile validation badge — the badge existed in the model and was
    displayed, but no admin control could change it."""
    try:
        user = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "User not found."}, status=404)
    profile, _ = Profile.objects.get_or_create(user=user)
    profile.verified_badge = not profile.verified_badge
    profile.save(update_fields=["verified_badge"])
    return Response(_admin_user_data(user))


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_sessions(request):
    status_filter = (request.query_params.get("status") or "").strip().upper()
    qs = SwapSession.objects.all().order_by("-created_at")
    if status_filter:
        qs = qs.filter(session_status=status_filter)
    return Response(SessionSerializer(qs, many=True).data)


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_reviews(request):
    qs = IntegrityReview.objects.all().order_by("-created_at")
    return Response(ReviewSerializer(qs, many=True).data)


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def admin_delete_review(request, review_id):
    try:
        review = IntegrityReview.objects.get(id=review_id)
    except (IntegrityReview.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Review not found."}, status=404)
    target = review.target_user
    review.delete()
    new_trust = recalculate_trust_score(target)
    return Response({
        "detail": "Review deleted.",
        "target_user_id": target.id,
        "trust_score": new_trust,
    })


# ---------------------------------------------------------------- admin (2)
# Issue-resolution powers: user detail, password reset, trust override,
# message deletion, session cancellation. All IsAdminUser.
def _admin_user_detail_data(user):
    """Full record for investigating one user: profile + sessions +
    reviews received/given + recent messages."""
    profile, _ = Profile.objects.get_or_create(user=user)
    data = _admin_user_data(user)
    sessions = SwapSession.objects.filter(
        Q(partner_one=user) | Q(partner_two=user)
    ).order_by("-created_at")
    data["sessions"] = SessionSerializer(sessions, many=True).data
    data["reviews_received"] = ReviewSerializer(
        IntegrityReview.objects.filter(target_user=user).order_by("-created_at"),
        many=True,
    ).data
    data["reviews_given"] = ReviewSerializer(
        IntegrityReview.objects.filter(author_user=user).order_by("-created_at"),
        many=True,
    ).data
    msgs = ChatMessage.objects.filter(
        Q(sender=user) | Q(receiver=user)
    ).order_by("-sent_at")[:20]
    data["recent_messages"] = [_message_payload(m, user) for m in msgs]
    return data


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_user_detail(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "User not found."}, status=404)
    return Response(_admin_user_detail_data(user))


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_reset_password(request, user_id):
    import secrets
    import string

    try:
        user = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "User not found."}, status=404)
    password = (request.data.get("password") or "").strip()
    generated = False
    if not password:
        alphabet = string.ascii_letters + string.digits
        password = "Temp-" + "".join(secrets.choice(alphabet) for _ in range(8))
        generated = True
    if len(password) < 6:
        return Response(
            {"detail": "Password must be at least 6 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user.set_password(password)
    user.save(update_fields=["password"])
    return Response({
        "detail": f"Password reset for {user.username}.",
        "temporary_password": password,
        "generated": generated,
        "advise": "Share this once with the user and ask them to change it after login.",
    })


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_set_trust(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "User not found."}, status=404)
    try:
        value = int(request.data.get("trust_score"))
    except (TypeError, ValueError):
        return Response(
            {"detail": "trust_score must be an integer."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    value = max(0, min(100, value))  # clamp 0-100
    profile, _ = Profile.objects.get_or_create(user=user)
    profile.trust_score = value
    profile.save(update_fields=["trust_score"])
    return Response(_admin_user_data(user))


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def admin_delete_message(request, message_id):
    try:
        message = ChatMessage.objects.get(id=message_id)
    except (ChatMessage.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Message not found."}, status=404)
    message.delete()
    return Response({"detail": "Message deleted."})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_cancel_session(request, session_id):
    try:
        session = SwapSession.objects.get(id=session_id)
    except (SwapSession.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Session not found."}, status=404)
    if session.session_status not in (
        SwapSession.Status.PENDING,
        SwapSession.Status.ACCEPTED,
    ):
        return Response(
            {"detail": f"Cannot cancel a session with status {session.session_status}."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    session.session_status = SwapSession.Status.CANCELLED
    session.save(update_fields=["session_status"])
    return Response(SessionSerializer(session).data)


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_message_approvals(request):
    """Round 3c: the Message Approvals queue — every chat message held
    by the privacy filter (phone number or link), oldest first, with
    sender, recipient, content and timestamp, for the admin to approve
    or reject."""
    pending = (
        ChatMessage.objects.filter(
            moderation_status=ChatMessage.ModerationStatus.PENDING
        )
        .select_related("sender", "receiver", "attachment")
        .order_by("sent_at")
    )
    return Response([_message_payload(m, request.user) for m in pending])


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_approve_message(request, message_id):
    """Approve a held message: it is delivered to the recipient (WS
    broadcast + visible in their chat) and the sender's bubble updates
    from 'waiting' to normal."""
    try:
        message = ChatMessage.objects.get(id=message_id)
    except (ChatMessage.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Message not found."}, status=404)
    message.moderation_status = ChatMessage.ModerationStatus.APPROVED
    message.save(update_fields=["moderation_status"])
    _broadcast_message(message)
    return Response(_message_payload(message, request.user))


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_reject_message(request, message_id):
    """Reject a held message: it is never delivered. The sender is told
    (their bubble shows 'rejected'); the recipient never sees it."""
    try:
        message = ChatMessage.objects.get(id=message_id)
    except (ChatMessage.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Message not found."}, status=404)
    message.moderation_status = ChatMessage.ModerationStatus.REJECTED
    message.save(update_fields=["moderation_status"])
    _broadcast_message(message, only_sender=True)
    return Response(_message_payload(message, request.user))
