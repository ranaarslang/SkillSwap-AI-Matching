"""Chat privacy filter (round 3c): no phone numbers, no links in chat.

This is the enforcement of the stay-in-app principle — nobody may share
a number or a link to take a conversation to WhatsApp or anywhere else.

Detection runs SERVER-side at message creation (REST and WebSocket).
A flagged message is NOT rejected and NOT delivered: it is saved as
PENDING and waits for an admin to approve or reject it (see
views.admin_message_approvals). Normal messages are unaffected and flow
instantly, exactly as before.

Patterns (tuned against false positives — see the tests):
- Phone-like: an international +92 number, or any digit run of 10-15
  digits allowing spaces/dashes/dots/parens between digits.
  Ordinary short numbers PASS: "2 years experience", "session at 5pm",
  "Rs 5000", dates like 2026-11-11 (8 digits), "Rs 1,000,000"
  (commas break the run).
- Link-like: http(s):// URLs, www. links, and bare domains
  (name.tld for a common-TLD list). "e.g.", "Mr. Smith", "3.14" and
  "file.txt" do not match.
"""
import re

# +92 followed by at least 7 more digits (a plausible (partial) number).
PHONE_INTL_RE = re.compile(r"\+92[\s\-]*\d(?:[\s\-]*\d){6,}")

# Any run of 10-15 digits, allowing spaces / dashes / dots / parens
# between digits (covers 03001234567, 0300 1234567, 0300-123-4567).
DIGIT_RUN_RE = re.compile(r"\d(?:[\s\-\.\(\)]*\d){9,14}")

_TLDS = (
    "com|net|org|io|co|pk|me|gg|ly|app|dev|xyz|online|link|info|biz|"
    "edu|gov|ai|tv|cc|to|be|gl|gd|is|sh|so|fm|am"
)
LINK_RE = re.compile(
    r"(?:https?://\S+|www\.\S+|\b[a-z0-9\-]+\.(?:" + _TLDS + r")\b)",
    re.IGNORECASE,
)

BLOCKED_MESSAGE = "Sharing phone numbers or links is not allowed in chat."


def flag_reasons(body):
    """Return the list of matched kinds ('phone' and/or 'link') for a
    message body, or [] when the message is clean."""
    if not body:
        return []
    reasons = []
    if PHONE_INTL_RE.search(body) or DIGIT_RUN_RE.search(body):
        reasons.append("phone")
    if LINK_RE.search(body):
        reasons.append("link")
    return reasons
