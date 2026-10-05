"""The day plan: the shape of a day, and whether it adds up.

A planner is only worth opening if its totals are right, so most of this suite
is arithmetic: four hours of go-live really is four hours, breaks are not
counted as work, a double-booking is reported rather than quietly averaged,
and the hour nobody planned is named instead of vanishing.

The rest is about the two places this touches real data - a block built from a
task finishes that task when it is ticked, and starting a day lays down the
meetings already in the diary.

    WCC_API=http://localhost:8012 python3 tests/plan_suite.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

RUN = str(int(time.time()))[-6:]
B = os.environ.get("WCC_API", "http://localhost:8000")

ok = fail = 0
failures = []


def call(method, path, body=None):
    req = urllib.request.Request(B + path, method=method)
    req.add_header("Content-Type", "application/json")
    data = json.dumps(body, default=str).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw[:250]


def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  \033[32mPASS\033[0m  {name}")
    else:
        fail += 1
        failures.append(name)
        print(f"  \033[31mFAIL\033[0m  {name}  {detail}")


def section(t):
    print(f"\n\033[1m{t}\033[0m")


def themes(plan):
    return {r["theme"]: r["hours"] for r in plan["breakdown"]}


# Far enough out that a real diary is unlikely to collide with the fixtures.
DAY = (date(2031, 3, 3) + timedelta(days=int(RUN) % 90)).isoformat()
NEXT = (date.fromisoformat(DAY) + timedelta(days=1)).isoformat()
made_plans, made_tasks, made_meetings = [], [], []

try:
    section("A day with a shape")

    s, plan = call("POST", "/api/plans", {
        "plan_date": DAY, "title": f"VDA go-live prep {RUN}",
        "day_start": "08:00", "day_end": "17:00",
        "blocks": [
            {"start": "08:00", "end": "10:30", "title": "VDA go-live planning",
             "theme": "VDA go-live", "activity": "Readiness checklist, endpoints, rollback."},
            {"start": "10:30", "end": "10:45", "kind": "BREAK", "title": "Break"},
            {"start": "10:45", "end": "12:15", "title": "VDA go-live planning (continue)",
             "theme": "VDA go-live"},
            {"start": "12:15", "end": "13:15", "kind": "LUNCH", "title": "Lunch"},
            {"start": "13:15", "end": "15:15", "title": "MBS/API pre-production",
             "theme": "MBS/API preprod"},
            {"start": "15:15", "end": "15:30", "kind": "BREAK", "title": "Break"},
            {"start": "15:30", "end": "17:00", "title": "Performance test analysis",
             "theme": "Performance tests"},
        ],
    })
    check("a day can be planned in one go", s == 200, f"{s} {str(plan)[:200]}")
    made_plans.append(plan["id"])

    check("the times come back as a clock, not as minutes",
          plan["blocks"][0]["from"] == "08:00" and plan["blocks"][0]["to"] == "10:30",
          str(plan["blocks"][0])[:120])
    check("blocks come back in the order the day runs",
          [b["from"] for b in plan["blocks"]] == sorted(b["from"] for b in plan["blocks"]),
          str([b["from"] for b in plan["blocks"]]))

    section("The arithmetic")

    t = themes(plan)
    check("the go-live really is four hours", t.get("VDA go-live") == 4.0, str(t))
    check("pre-production really is two", t.get("MBS/API preprod") == 2.0, str(t))
    check("performance analysis really is an hour and a half",
          t.get("Performance tests") == 1.5, str(t))
    check("the breakdown is ordered by where the time went",
          [r["theme"] for r in plan["breakdown"]][0] == "VDA go-live",
          str([r["theme"] for r in plan["breakdown"]]))

    # The distinction a planner lives or dies by: a break is time off, not
    # time spent. Counting it as work makes every day look productive.
    check("breaks are not counted as work", plan["work_minutes"] == 450,
          f"{plan['work_minutes']} minutes")
    check("but they are still counted", plan["rest_minutes"] == 90,
          f"{plan['rest_minutes']} minutes")
    check("and they stay out of the breakdown",
          not any("Break" in r["theme"] or "Lunch" in r["theme"] for r in plan["breakdown"]),
          str(list(t)))
    check("work and rest together fill the planned time",
          plan["work_minutes"] + plan["rest_minutes"] == plan["planned_minutes"],
          f"{plan['work_minutes']}+{plan['rest_minutes']} vs {plan['planned_minutes']}")
    check("a full day has nothing unplanned", plan["unplanned_minutes"] == 0,
          str(plan["unplanned_minutes"]))
    check("nothing is double-booked", plan["overlaps"] == [], str(plan["overlaps"]))

    section("Time nobody planned")

    s, gappy = call("POST", "/api/plans", {
        "plan_date": NEXT, "day_start": "08:00", "day_end": "17:00",
        "blocks": [{"start": "08:00", "end": "09:00", "title": "Standup and triage"},
                   {"start": "14:00", "end": "15:00", "title": "Vendor follow-up"}],
    })
    made_plans.append(gappy["id"])
    check("the hours nobody claimed are named",
          [(g["from"], g["to"]) for g in gappy["gaps"]]
          == [("09:00", "14:00"), ("15:00", "17:00")], str(gappy["gaps"]))
    check("and totalled, so the day is honest about itself",
          gappy["unplanned_minutes"] == 7 * 60, str(gappy["unplanned_minutes"]))
    check("the planned part is only what was planned",
          gappy["work_minutes"] == 120, str(gappy["work_minutes"]))

    section("Two things at once")

    s, clash = call("POST", f"/api/plans/{plan['id']}/blocks",
                    {"start": "14:00", "end": "15:00", "kind": "MEETING",
                     "title": f"Vendor call {RUN}"})
    check("a block that overlaps another is accepted, not refused",
          s == 200, f"{s} {str(clash)[:160]}")
    check("but it is reported, with both names and the minutes they share",
          len(clash["overlaps"]) == 1
          and clash["overlaps"][0]["minutes"] == 60
          and "Vendor call" in clash["overlaps"][0]["b"]["title"],
          str(clash["overlaps"]))
    clash_id = [b for b in clash["blocks"] if b["title"].startswith("Vendor call")][0]["id"]
    s, cleared = call("DELETE", f"/api/plans/blocks/{clash_id}")
    check("removing it clears the warning", cleared["overlaps"] == [], str(cleared["overlaps"]))

    section("Times a person would actually type")

    s, r = call("POST", f"/api/plans/{plan['id']}/blocks",
                {"start": "9:05", "end": "9:35", "title": "Typed without a leading zero"})
    check("a time typed as 9:05 is understood",
          s == 200 and any(b["from"] == "09:05" for b in r["blocks"]), f"{s} {str(r)[:160]}")
    typed = [b for b in r["blocks"] if b["from"] == "09:05"][0]["id"]
    call("DELETE", f"/api/plans/blocks/{typed}")

    s, r = call("POST", f"/api/plans/{plan['id']}/blocks",
                {"start": "11:00", "end": "10:00", "title": "Backwards"})
    check("a block that ends before it starts is refused readably",
          s == 422 and "ends before it starts" in str(r), f"{s} {str(r)[:160]}")
    s, r = call("POST", f"/api/plans/{plan['id']}/blocks",
                {"start": "09:00", "end": "10:00", "title": "Nonsense kind", "kind": "SIESTA"})
    check("a kind of block that does not exist says what the kinds are",
          s == 422 and "WORK" in str(r), f"{s} {str(r)[:160]}")
    s, r = call("POST", f"/api/plans/{plan['id']}/blocks",
                {"start": "half nine", "end": "10:00", "title": "Words"})
    check("a time that is not a time is refused, not stored as zero",
          s == 422, f"{s} {str(r)[:160]}")

    section("A block that is really a task")

    s, task = call("POST", "/api/tasks", {
        "title": f"Review MQ channel status {RUN}", "priority": "P1_HIGH",
        "status": "IN_PROGRESS", "next_action": "Check the DR pair first"})
    made_tasks.append(task["id"])

    s, withtask = call("POST", f"/api/plans/{plan['id']}/blocks", {
        "start": "17:00", "end": "17:30", "title": task["title"],
        "theme": "MQ", "task_id": task["id"]})
    check("a block can be built from a task", s == 200, f"{s} {str(withtask)[:160]}")
    block = [b for b in withtask["blocks"] if b["task_id"] == task["id"]][0]

    s, ticked = call("PATCH", f"/api/plans/blocks/{block['id']}", {"done": True})
    check("ticking it reports which task that finished",
          (ticked.get("completed_task") or {}).get("id") == task["id"],
          str(ticked.get("completed_task")))
    s, after = call("GET", f"/api/tasks/{task['id']}")
    check("and the task really is complete, not just crossed out here",
          after["status"] == "COMPLETED", after["status"])
    check("the done total counts the minutes that were ticked",
          ticked["done_minutes"] == 30, str(ticked["done_minutes"]))

    s, r = call("POST", f"/api/plans/{plan['id']}/blocks",
                {"start": "07:00", "end": "07:30", "title": "Ghost", "task_id": 999999})
    check("a block pointing at a task that does not exist is refused",
          s == 422, f"{s} {str(r)[:160]}")

    section("Starting a day from the diary")

    seed_day = (date.fromisoformat(DAY) + timedelta(days=2)).isoformat()
    s, m1 = call("POST", "/api/meetings", {
        "title": f"VDA vendor sync {RUN}",
        "meeting_date": f"{seed_day}T09:30:00", "ends_at": f"{seed_day}T10:30:00"})
    made_meetings.append(m1["id"])
    s, m2 = call("POST", "/api/meetings", {
        "title": f"Change board {RUN}",
        "meeting_date": f"{seed_day}T15:00:00", "ends_at": f"{seed_day}T16:00:00"})
    made_meetings.append(m2["id"])

    s, seeded = call("POST", f"/api/plans/seed?on={seed_day}")
    check("a day can be started from what is already in the diary", s == 200,
          f"{s} {str(seeded)[:200]}")
    made_plans.append(seeded["id"])
    titles = [b["title"] for b in seeded["blocks"]]
    check("both meetings are laid down first",
          any("VDA vendor sync" in t for t in titles)
          and any("Change board" in t for t in titles), str(titles))
    check("at the times the diary says",
          [(b["from"], b["to"]) for b in seeded["blocks"] if b["kind"] == "MEETING"]
          == [("09:30", "10:30"), ("15:00", "16:00")],
          str([(b["from"], b["to"]) for b in seeded["blocks"]]))
    check("they are marked as meetings rather than work",
          all(b["kind"] == "MEETING" for b in seeded["blocks"] if b["meeting_id"]),
          str([(b["title"], b["kind"]) for b in seeded["blocks"]]))
    check("and they point back at the diary entry",
          sorted(b["meeting_id"] for b in seeded["blocks"] if b["meeting_id"])
          == sorted([m1["id"], m2["id"]]), str(seeded["blocks"]))
    check("lunch is put in without being asked",
          any(b["kind"] == "LUNCH" for b in seeded["blocks"]), str(titles))
    check("meetings do not count as the day's own work",
          seeded["work_minutes"] == 120, str(seeded["work_minutes"]))
    # 540 in the day, less two hours of meetings and an hour of lunch.
    check("so what is left is the time actually free",
          seeded["unplanned_minutes"] == 360, str(seeded["unplanned_minutes"]))

    s, again = call("POST", f"/api/plans/seed?on={seed_day}")
    check("starting the same day twice is refused rather than duplicated",
          again if s == 409 else False, f"{s} {str(again)[:160]}")

    section("Tomorrow usually looks like today")

    far = (date.fromisoformat(DAY) + timedelta(days=5)).isoformat()
    # Read the day back first: blocks have been added since it was created, and
    # comparing a copy against a stale snapshot tests nothing but my memory.
    s, live = call("GET", f"/api/plans/day/{DAY}")
    s, copied = call("POST", f"/api/plans/{plan['id']}/copy?to={far}")
    check("a day's shape can be copied forward", s == 200, f"{s} {str(copied)[:160]}")
    made_plans.append(copied["id"])
    check("with the same blocks at the same times",
          [(b["from"], b["to"]) for b in copied["blocks"]]
          == [(b["from"], b["to"]) for b in live["blocks"]],
          str([(b["from"], b["to"]) for b in copied["blocks"]]))
    check("and the same breakdown", themes(copied) == themes(live),
          f"{themes(copied)} vs {themes(live)}")
    check("but nothing already ticked, because that day has not happened",
          not any(b["done"] for b in copied["blocks"]),
          str([(b["title"], b["done"]) for b in copied["blocks"]]))
    check("and no task is finished twice by a copy",
          all(b["task_id"] is None for b in copied["blocks"]),
          str([b["task_id"] for b in copied["blocks"]]))

    s, r = call("POST", f"/api/plans/{plan['id']}/copy?to={far}")
    check("copying onto a day that already has a plan is refused", s == 409, f"{s}")

    section("Taking it somewhere else")

    s, ex = call("GET", f"/api/plans/{plan['id']}/export")
    check("the timetable reads as a timetable",
          "08:00–10:30  VDA go-live planning" in ex["timetable"], ex["timetable"][:160])
    check("it says where the time went underneath",
          "Where the time goes" in ex["timetable"] and "VDA go-live — 4.0h" in ex["timetable"],
          ex["timetable"][-200:])
    check("the checklist is tickable lines, not a timetable",
          ex["checklist"].startswith("[") and "08:00" not in ex["checklist"],
          ex["checklist"][:160])
    check("a ticked block shows as ticked", "[x]" in ex["checklist"], ex["checklist"][:200])
    check("breaks do not become to-dos",
          "Lunch" not in ex["checklist"] and "Break" not in ex["checklist"],
          ex["checklist"])
    check("a pipe in an activity cannot break the markdown table",
          "|" in ex["markdown"], ex["markdown"][:120])

    section("One plan per day")

    s, r = call("POST", "/api/plans", {"plan_date": DAY, "title": "A second opinion"})
    check("a day cannot have two plans disagreeing about the same hours",
          s == 409 and "already has a plan" in str(r), f"{s} {str(r)[:160]}")

    s, r = call("GET", "/api/plans/day/2020-01-01")
    check("a day with no plan says so rather than inventing an empty one",
          s == 404 and "No plan" in str(r), f"{s} {str(r)[:120]}")

    s, rows = call("GET", f"/api/plans?limit=50&since={DAY}")
    check("recent days list newest first",
          s == 200 and [p["plan_date"] for p in rows] == sorted(
              (p["plan_date"] for p in rows), reverse=True),
          str([p["plan_date"] for p in rows]))

    section("What deserves an hour")

    s, picks = call("GET", f"/api/plans/suggest/tasks?on={DAY}")
    check("the planner can say what is worth planning", s == 200 and isinstance(picks, list),
          f"{s} {str(picks)[:120]}")
    check("and nothing already finished is suggested",
          not any(p["id"] == task["id"] for p in picks), str(picks[:3]))
    if picks:
        check("overdue work comes before everything else",
              [p["overdue"] for p in picks] == sorted(
                  (p["overdue"] for p in picks), reverse=True),
              str([(p["title"][:20], p["overdue"]) for p in picks[:5]]))

finally:
    for pid in made_plans:
        call("DELETE", f"/api/plans/{pid}")
    for tid in made_tasks:
        call("DELETE", f"/api/tasks/{tid}")
    for mid in made_meetings:
        call("DELETE", f"/api/meetings/{mid}")

print(f"\n{'=' * 52}\n  \033[1m{ok} passed, {fail} failed\033[0m\n{'=' * 52}")
if failures:
    print("Failed:")
    for f in failures:
        print("  -", f)
sys.exit(1 if fail else 0)
