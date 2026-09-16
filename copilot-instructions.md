# Working with Work Control Center

<!--
Copy this file to `.github/copilot-instructions.md` in whatever workspace you
open in VS Code. Copilot reads it automatically on every request in that
workspace, so it does not have to rediscover any of this each session.

The MCP server sends most of this in its `instructions` on connect, but not
every client shows that to the model. This file makes it certain.
-->

Work Control Center (WCC) is my own work-management system. It is connected as
the MCP server `work-control-center` and holds my runbooks, install guides,
notes, tasks and server inventory.

## Use it instead of answering from memory

When I ask about a runbook, a procedure, "how did I do X", a server, or what I
am working on, the answer is in WCC. Search it before saying you don't know.

## The tools

| Tool | Use it when |
|---|---|
| `search_knowledge` | I ask how something is done, or about a procedure. Words match in any order |
| `get_knowledge` | A search hit looks right and I need the full text |
| `create_knowledge` | I have worked something out worth keeping |
| `update_knowledge` | An article needs a correction or an extra step |
| `list_tasks` | "What am I working on", "what's late" — **and to get an id before updating** |
| `create_task` | I ask for anything to be noted, tracked, remembered or raised |
| `update_task` | Something is now done, blocked, or needs a new date |
| `list_servers` | I ask what runs where, or about an environment (DC, DR, UAT…) |

## Rules that save a round trip

- **`create_task` needs only `title`.** Everything else is optional. Do not ask
  me for a priority or a due date I did not give you — raise the task, it lands
  in the INBOX for triage, and I will sort it there.
- **Never invent an `id`.** Call `list_tasks` first and use the id it returns.
- **Search before you write.** If an article already covers the topic, use
  `update_knowledge` with `append` to add to it. Do not create a near-duplicate,
  and do not rewrite a whole body from memory — `append` exists so the rest of
  the runbook survives.
- **Resolve dates yourself.** "Next Friday" is not accepted. Work out the real
  calendar date and send `YYYY-MM-DD`.
- Plain words work for priority and status — "high", "urgent", "done", "blocked"
  are understood.

## When a tool call fails

Every failure comes back as a readable message saying what was wrong and what
the accepted values are. **Read it and try again with the correction.** A failed
tool call is not a reason to stop and it is not a reason to fall back to telling
me how I could do it manually. Fix the argument and call it again.

If it still fails after a second attempt, tell me the exact error text.

## Passwords

WCC stores server credentials, but **they are deliberately unreachable through
this interface** and no tool returns one. If I ask for a password, use
`list_servers` and tell me which vault holds it. Do not apologise for the
limitation or try to work around it — it is the design.
