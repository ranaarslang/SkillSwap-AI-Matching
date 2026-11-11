"""Regression tests for the chat privacy filter (round 3c, hardened 3f).

The filter must flag phone numbers and links — and nothing else. In
particular the four seeded maya<->leo messages and ordinary chat text
(numbers, dates, versions, "e.g.", file names) must pass clean: a false
positive once made a whole thread look blocked (round 3f), so every
seeded/ordinary text below is a locked-in regression case.
"""
from django.test import SimpleTestCase

from .message_filter import flag_reasons

# The four seeded maya<->leo messages, verbatim from seed_demo.
SEEDED = [
    "Hi Leo! Excited for our Python session — "
    "I can show you how to automate your video exports.",
    "Hi Maya! That sounds perfect. I will bring a "
    "short clip so we can work on a real example.",
    "Great idea. Do you prefer weekday evenings? "
    "I am usually free after 7pm.",
    "Weeknights after 7 works for me too. See you then!",
]

ORDINARY = [
    # The text a live re-check quoted (paraphrased) when it wrongly
    # concluded a clean message was blocked — it must stay clean.
    "Hey Leo! I saw your Python skills and I would love to learn from you.",
    "2 years experience",
    "session at 5pm",
    "Rs 5000",
    "Let's meet on 2026-11-11",
    "Python 3.11 is great",
    "e.g. Tuesday works for me",
    "Mr. Smith will join us",
    "The value is 3.14",
    "see file.txt for the notes",
    "Rs 1,000,000 budget",
    "Call me at 7",
    "My birthday is 5 June 2001",
]

FLAGGED = [
    ("+92 326 8857485", ["phone"]),
    ("my number is 0300 1234567", ["phone"]),
    ("call 0300-123-4567", ["phone"]),
    ("check https://example.com for details", ["link"]),
    ("visit www.example.com", ["link"]),
    ("see python.org for the docs", ["link"]),
    ("my site is maya.dev", ["link"]),
    ("text me at 0321 1234567 or see bit.ly/abc", ["phone", "link"]),
]


class MessageFilterTests(SimpleTestCase):
    def test_seeded_messages_are_clean(self):
        for body in SEEDED:
            with self.subTest(body=body[:40]):
                self.assertEqual(flag_reasons(body), [])

    def test_ordinary_messages_are_clean(self):
        for body in ORDINARY:
            with self.subTest(body=body):
                self.assertEqual(flag_reasons(body), [])

    def test_phone_and_link_messages_are_flagged(self):
        for body, expected in FLAGGED:
            with self.subTest(body=body):
                self.assertEqual(flag_reasons(body), expected)

    def test_empty_body_is_clean(self):
        self.assertEqual(flag_reasons(""), [])
        self.assertEqual(flag_reasons(None), [])


# Round 5: staff messages skip the moderation hold, and the mini
# serializer carries is_staff (incoming-call "Admin" badge + admin
# message notices on the frontend).
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .serializers import UserMiniSerializer


class StaffMessageBypassTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username="admin", email="admin@example.com", password="demo1234",
            is_staff=True, is_superuser=True,
        )
        self.maya = User.objects.create_user(
            username="maya", email="maya@example.com", password="demo1234",
        )
        self.leo = User.objects.create_user(
            username="leo", email="leo@example.com", password="demo1234",
        )

    def test_staff_flagged_message_is_delivered_immediately(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        res = client.post(
            "/api/messages/",
            {"recipient_id": self.maya.id,
             "body": "Hi, please call me on 0300 1234567 or see example.com"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["moderation_status"], "approved")
        self.assertTrue(res.data["sender"]["is_staff"])

    def test_student_flagged_message_is_still_held(self):
        client = APIClient()
        client.force_authenticate(user=self.maya)
        res = client.post(
            "/api/messages/",
            {"recipient_id": self.leo.id, "body": "my number is 0300 1234567"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["moderation_status"], "pending")
        self.assertFalse(res.data["sender"]["is_staff"])

    def test_mini_serializer_carries_is_staff(self):
        self.assertTrue(UserMiniSerializer(self.admin).data["is_staff"])
        self.assertFalse(UserMiniSerializer(self.maya).data["is_staff"])
