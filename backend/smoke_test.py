"""End-to-end smoke test for the skillswap-v2 backend (run against daphne on :8000).
Exits non-zero on any failed check; prints PASS/FAIL per step.
"""
import asyncio
import json
import sys
import time
import urllib.request
import urllib.error

import websockets

BASE = "http://127.0.0.1:8000"
WS_BASE = "ws://127.0.0.1:8000"
# Unique per run so the suite is re-runnable against the same database.
RUN_ID = int(time.time())
failures = []


def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {detail}")
    if not cond:
        failures.append(name)


def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return e.code, {"raw": raw.decode(errors="replace")}


def main():
    # 1. health (no auth) + auth required elsewhere
    s, b = req("GET", "/api/health/")
    check("health 200 {status: ok}", s == 200 and b.get("status") == "ok", str(b))
    s, b = req("GET", "/api/matches/")
    check("matches without JWT -> 401", s == 401, f"got {s}")

    # 2. signup a brand-new user
    s, b = req("POST", "/api/auth/signup/", body={
        "email": f"testuser-{RUN_ID}@example.com", "password": "testpass1",
        "full_name": "Test User"})
    check("signup 201 + tokens + username from email",
          s == 201 and b.get("access") and b.get("refresh")
          and b["user"]["username"] == f"testuser-{RUN_ID}", str(b))
    test_token = b.get("access")
    s, b = req("POST", "/api/auth/signup/", body={
        "email": f"testuser-{RUN_ID}@example.com", "password": "testpass1",
        "full_name": "Test User"})
    check("duplicate email signup -> 400", s == 400, f"got {s}")
    s, b = req("POST", "/api/auth/signup/", body={
        "email": "short@example.com", "password": "123",
        "full_name": "Short Pass"})
    check("short password signup -> 400", s == 400, f"got {s}")

    # 3. login as maya by username + wrong password
    s, b = req("POST", "/api/auth/login/", body={
        "email_or_username": "maya", "password": "demo1234"})
    check("login maya/demo1234 by username -> 200 + JWT",
          s == 200 and b.get("access") and b["user"]["username"] == "maya", str(b))
    maya_token, maya_refresh = b.get("access"), b.get("refresh")
    maya_id = b["user"]["id"]
    s, b = req("POST", "/api/auth/login/", body={
        "email_or_username": "maya@skillswap.demo", "password": "demo1234"})
    check("login maya by email -> 200",
          s == 200 and b["user"]["username"] == "maya", f"got {s}")
    s, b = req("POST", "/api/auth/login/", body={
        "email_or_username": "maya", "password": "wrongpass"})
    check("wrong password -> 400", s == 400, f"got {s}")

    # 4. profile me GET + PUT (same values as seed — no net change)
    s, b = req("GET", "/api/profile/me/", token=maya_token)
    check("GET profile/me maya: Lahore, verified, trust 100",
          s == 200 and b["location"] == "Lahore"
          and b["verified_badge"] is True and b["trust_score"] == 100
          and b["teach_skills"] == ["Data Visualization", "Python"], str(b))
    s, b = req("PUT", "/api/profile/me/", token=maya_token, body={
        "bio": b["bio"], "location": "Lahore", "availability": "Weeknights",
        "teach_skills": ["Python", "Data Visualization"],
        "learn_skills": ["Public Speaking", "UI Design"]})
    check("PUT profile/me syncs skills",
          s == 200 and b["location"] == "Lahore"
          and sorted(b["teach_skills"]) == ["Data Visualization", "Python"], str(b))

    # 5. matches / community (real ONNX MiniLM numbers — see NOTES.md).
    # Scores depend slightly on skill order in the embedded text, so assert
    # ranges/ordering, not exact values.
    s, matches = req("GET", "/api/matches/", token=maya_token)
    top = matches[0] if matches else {}
    check("GET matches: priya top (>= 70) with location bonus 5",
          s == 200 and top.get("user", {}).get("username") == "priya"
          and top.get("match_score", 0) >= 70
          and top.get("location_bonus") == 5
          and top.get("same_location") is True
          and top.get("can_teach_you") == ["Public Speaking"]
          and top.get("you_can_teach_them") == ["Data Visualization"],
          str([(m["user"]["username"], m["match_score"]) for m in matches]))
    s, community = req("GET", "/api/community/", token=maya_token)
    leo_row = [c for c in community if c["user"]["username"] == "leo"]
    check("GET community: leo present, below 50 (30-45)",
          s == 200 and len(leo_row) == 1
          and 30 <= leo_row[0]["match_score"] <= 45,
          str([(c["user"]["username"], c["match_score"]) for c in community]))

    # 6. public profile
    s, b = req("GET", f"/api/profiles/{maya_id}/", token=maya_token)
    check("GET profiles/<id> public profile",
          s == 200 and b["user"]["username"] == "maya", str(b))

    # 7. sessions: create, double-booking reject, accept, complete
    s, b = req("POST", "/api/auth/login/", body={
        "email_or_username": "priya", "password": "demo1234"})
    priya_token, priya_id = b["access"], b["user"]["id"]
    s, sess = req("POST", "/api/sessions/", token=maya_token, body={
        "partner_id": priya_id, "calendar_date": "2026-11-20",
        "duration_block": "1 Hour Mutual Swap",
        "title": "Data Viz for Public Speaking"})
    check("POST session maya->priya 201 PENDING",
          s == 201 and sess.get("session_status") == "PENDING", str(sess))
    sess_id = sess.get("id")
    s, b = req("POST", "/api/sessions/", token=maya_token, body={
        "partner_id": priya_id, "calendar_date": "2026-11-20",
        "duration_block": "1 Hour Mutual Swap", "title": "dup"})
    check("double booking same date+block -> 400", s == 400, f"got {s} {b}")
    s, b = req("PUT", f"/api/sessions/{sess_id}/", token=maya_token,
               body={"session_status": "COMPLETED"})
    check("PENDING -> COMPLETED directly -> 400", s == 400, f"got {s}")
    s, b = req("PUT", f"/api/sessions/{sess_id}/", token=priya_token,
               body={"session_status": "ACCEPTED"})
    check("recipient accepts -> 200 ACCEPTED",
          s == 200 and b.get("session_status") == "ACCEPTED", str(b))
    s, b = req("GET", "/api/sessions/", token=maya_token)
    check("GET sessions lists mine",
          s == 200 and any(x["id"] == sess_id for x in b), f"got {len(b)}")

    # 8. messages via REST
    s, b = req("POST", "/api/auth/login/", body={
        "email_or_username": "leo", "password": "demo1234"})
    leo_token, leo_id = b["access"], b["user"]["id"]
    s, msg = req("POST", "/api/messages/", token=maya_token, body={
        "recipient_id": leo_id, "body": "Hello from smoke test"})
    check("POST message maya->leo 201",
          s == 201 and msg.get("body") == "Hello from smoke test"
          and msg.get("is_mine") is True, str(msg))
    s, b = req("GET", f"/api/messages/?peer={leo_id}", token=maya_token)
    check("GET messages maya<->leo contains REST + seed history, oldest first",
          s == 200 and len(b) >= 5 and b[-1]["body"] == "Hello from smoke test"
          and b[0]["is_mine"] is True, f"got {len(b)} msgs")
    s, b = req("GET", "/api/conversations/", token=leo_token)
    maya_conv = [c for c in b if c["peer"]["username"] == "maya"]
    check("GET conversations leo: maya thread, unread >= 1",
          s == 200 and maya_conv and maya_conv[0]["unread_count"] >= 1,
          str(b))

    # 9. complete session + review -> trust score change
    s, b = req("PUT", f"/api/sessions/{sess_id}/", token=maya_token,
               body={"session_status": "COMPLETED"})
    check("ACCEPTED -> COMPLETED -> 200",
          s == 200 and b.get("session_status") == "COMPLETED", str(b))
    s, b = req("POST", "/api/reviews/", token=maya_token, body={
        "session_id": sess_id, "rating_stars": 4,
        "feedback_text": "Great session!"})
    check("POST review 4 stars -> 201",
          s == 201 and b.get("rating_stars") == 4
          and b.get("reviewee", {}).get("username") == "priya", str(b))
    s, b = req("GET", f"/api/profiles/{priya_id}/", token=maya_token)
    check("priya trust_score 100 -> 80 after 4-star review",
          s == 200 and b.get("trust_score") == 80, str(b.get("trust_score")))
    s, b = req("POST", "/api/reviews/", token=maya_token, body={
        "session_id": sess_id, "rating_stars": 5, "feedback_text": "dup"})
    check("duplicate review same session -> 400", s == 400, f"got {s}")
    s, b = req("GET", f"/api/reviews/?user={priya_id}", token=maya_token)
    check("GET reviews?user=priya lists the 4-star review",
          s == 200 and len(b) >= 1
          and any(r["rating_stars"] == 4 for r in b), str(b))

    # 10. refresh + logout
    s, b = req("POST", "/api/auth/refresh/", body={"refresh": maya_refresh})
    check("POST refresh -> 200 new access",
          s == 200 and b.get("access"), str(b))
    s, b = req("POST", "/api/auth/logout/", token=maya_token)
    check("POST logout -> 200", s == 200, f"got {s}")

    # 11. WebSocket: valid JWT, REST->WS broadcast, WS send+echo, bad token
    asyncio.run(ws_checks(maya_token, leo_token, leo_id, maya_id))

    print()
    if failures:
        print(f"FAILED: {len(failures)} checks: {failures}")
        sys.exit(1)
    print("ALL SMOKE CHECKS PASSED")


async def ws_checks(maya_token, leo_token, leo_id, maya_id):
    # Leo connects; maya sends via REST; leo must receive it live.
    async with websockets.connect(
            f"{WS_BASE}/ws/chat/?token={leo_token}") as leo_ws:
        s, msg = req("POST", "/api/messages/", token=maya_token, body={
            "recipient_id": leo_id, "body": "WS live-delivery test"})
        assert s == 201, f"REST post for WS test failed: {s} {msg}"
        got = json.loads(await asyncio.wait_for(leo_ws.recv(), timeout=5))
        check("WS: REST POST broadcasts live to recipient group",
              got.get("type") == "chat.message"
              and got["message"]["body"] == "WS live-delivery test"
              and got["message"]["is_mine"] is False, str(got))

    # Maya connects and sends via WS; she gets the echo, leo gets it live.
    async with websockets.connect(
            f"{WS_BASE}/ws/chat/?token={maya_token}") as maya_ws, \
            websockets.connect(
            f"{WS_BASE}/ws/chat/?token={leo_token}") as leo_ws:
        await maya_ws.send(json.dumps({
            "type": "chat.message", "recipient_id": leo_id,
            "body": "Hello via websocket"}))
        echo = json.loads(await asyncio.wait_for(maya_ws.recv(), timeout=5))
        check("WS: sender gets echo with is_mine=true",
              echo.get("type") == "chat.message"
              and echo["message"]["body"] == "Hello via websocket"
              and echo["message"]["is_mine"] is True, str(echo))
        live = json.loads(await asyncio.wait_for(leo_ws.recv(), timeout=5))
        check("WS: recipient gets live message with is_mine=false",
              live.get("type") == "chat.message"
              and live["message"]["body"] == "Hello via websocket"
              and live["message"]["is_mine"] is False, str(live))
        # Invalid input -> error to sender only.
        await maya_ws.send(json.dumps({
            "type": "chat.message", "recipient_id": 99999, "body": "x"}))
        err = json.loads(await asyncio.wait_for(maya_ws.recv(), timeout=5))
        check("WS: bad recipient -> error to sender only",
              err.get("type") == "error" and "Recipient" in err.get("detail", ""),
              str(err))
        # The WS-sent message persisted to the DB.
        s, hist = req("GET", f"/api/messages/?peer={leo_id}", token=maya_token)
        check("WS-sent message saved in DB history",
              s == 200 and any(m["body"] == "Hello via websocket" for m in hist),
              f"got {len(hist)} msgs")

    # Bad / missing token -> close 4401.
    for label, url in (
        ("bad token", f"{WS_BASE}/ws/chat/?token=invalid.invalid.invalid"),
        ("no token", f"{WS_BASE}/ws/chat/"),
    ):
        try:
            async with websockets.connect(url) as ws:
                await asyncio.wait_for(ws.recv(), timeout=5)
            check(f"WS {label} -> close 4401", False, "connection stayed open")
        except websockets.exceptions.ConnectionClosed as e:
            check(f"WS {label} -> close 4401", e.code == 4401, f"code={e.code}")
        except Exception as e:  # noqa: BLE001
            check(f"WS {label} -> close 4401", False, f"unexpected: {e!r}")


if __name__ == "__main__":
    main()
