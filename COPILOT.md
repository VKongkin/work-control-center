# Connecting Copilot to Work Control Center

WCC exposes an agent interface so an AI assistant can answer "what's the runbook
for failing MQ over to DR", raise a task from a chat, or append what you just
learned to a note — without you leaving the window you are already in.

**Do these in order.** Steps 1–3 take ten minutes, happen entirely on your own
machine, and need nobody's permission. Step 4 is where Copilot comes in, and
which route you take depends on something you need to find out first.

| | |
|---|---|
| [1. Turn it on](#1-turn-it-on) | Two keys in `.env`, restart |
| [2. Prove it works](#2-prove-it-works) | `make agent-check` |
| [3. Connect a client on your own machine](#3-connect-a-client-on-your-own-machine) | VS Code or Claude Desktop, over localhost. Works today |
| [4. Connect Microsoft Copilot](#4-connect-microsoft-copilot) | Copilot Studio, and the network problem |

Before any of it: **Copilot never sees a password.** Not by configuration — by
construction. [The boundary](#the-boundary) explains exactly what that means.

---

## 1. Turn it on

The agent interface is off until you give it a key. Generate two — one for the
agent, one for the password vault:

```bash
# the agent key
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# the vault key (only if you want to store server passwords)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Put them in `.env` in the project root — create it from the example if you have
not already:

```bash
cp .env.example .env     # first time only
```

```env
WCC_AGENT_KEY=the-first-long-random-string
WCC_VAULT_KEY=the-second-one
```

Then restart so the backend picks them up:

```bash
docker compose up -d          # published images
# or, if you are running from source:
make dev                      # = docker compose -f docker-compose.build.yml up -d --build
```

> **If you set the keys and nothing changed**, it is almost certainly this:
> Compose reads `.env` for its own substitution but does not hand it to the
> container unless the variable is named in the compose file. Both compose files
> now name every `WCC_*` variable. If you are on an older copy of them, that is
> the bug.

## 2. Prove it works

```bash
make agent-check
```

It reads the key out of `.env`, calls the interface, and tells you what it
found. You are looking for `enabled: true`, eight tools, and
`secrets_included: false`.

If you would rather do it by hand:

```bash
curl http://localhost:8000/api/agent/status
```

```json
{
  "enabled": true,
  "protocol_version": "2025-06-18",
  "tools": ["search_knowledge", "get_knowledge", "create_knowledge",
            "update_knowledge", "list_tasks", "create_task",
            "update_task", "list_servers"],
  "accounts_included": false,
  "secrets_included": false
}
```

`/status` is readable without the key on purpose, so you can check setup without
having the key to hand. Everything else returns 401 without it.

Before going further, put something in Knowledge worth finding — a real runbook,
not a test note. An agent connected to an empty knowledge base looks broken.

## 3. Connect a client on your own machine

**Do this first, whatever you eventually want.** It runs on your laptop over
`localhost`, needs no gateway, no tunnel and no approval from anyone, and it
proves the interface works before you spend an afternoon on tenant
configuration. If the answer you want is "ask a question, get the runbook", this
may be all you ever need.

### VS Code (GitHub Copilot, agent mode)

Create `.vscode/mcp.json` in whatever folder you work in:

```json
{
  "servers": {
    "work-control-center": {
      "type": "http",
      "url": "http://localhost:8000/api/agent/mcp",
      "headers": { "X-API-Key": "${input:wcc-key}" }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "wcc-key",
      "description": "WCC_AGENT_KEY",
      "password": true
    }
  ]
}
```

VS Code prompts for the key the first time and keeps it out of the file — which
matters, because that file is in a repository.

Then open Copilot Chat, switch it to **Agent** mode, and ask something only WCC
knows: *"what runbooks do I have for DR?"*. The tool picker in the chat should
list the eight WCC tools.

`MCP: Add Server` in the Command Palette does the same thing through a wizard if
you prefer.

### Claude Desktop, or any other MCP client

Same endpoint, same header. The interface is a standard MCP server over
streamable HTTP (protocol `2025-06-18`), so anything that speaks MCP can use it.

## 4. Connect Microsoft Copilot

### First, find out which Copilot you have

"The company allows Microsoft Copilot" covers three different products, and only
one of them can be pointed at a custom MCP server by you:

| What you have | Can it use WCC? |
|---|---|
| **Microsoft 365 Copilot** — the chat in Teams, Word, Outlook | Not on its own. It needs an *agent* built for it, which means one of the two below |
| **Copilot Studio** — a Power Platform app at `copilotstudio.microsoft.com` | **Yes, and this is the route.** Add WCC as an MCP tool to an agent, publish the agent to Teams |
| **GitHub Copilot in VS Code** | Yes — that is [step 3](#3-connect-a-client-on-your-own-machine), already done |

Open `https://copilotstudio.microsoft.com` and see whether it lets you in. If it
does, continue. If it asks you to start a trial or shows no environment, you
need a licence and a Power Platform environment from whoever administers it —
that is the ask to send, and it is a smaller ask than it sounds.

### The network problem, which you have to solve first

Copilot Studio calls your tools **from Microsoft's cloud**. `http://localhost:8000`
on your work laptop is not somewhere Microsoft can call, and neither, normally,
is `http://mbsapp01.bank.local:8000`. So before the wizard is any use:

**Option A — an internal server plus the on-premises data gateway.** Run WCC on
a machine inside the network with a stable address, install the on-premises data
gateway on a machine that can reach it, and build a Power Platform **custom
connector** from `/api/agent/openapi.json` with "Connect via on-premises data
gateway" ticked. Your API stays internal and is never published to the internet.
This is the version to propose to whoever owns Copilot at the bank, because the
answer to "does this open a hole to the internet" is no.

**Option B — a reachable HTTPS endpoint.** A DMZ host, a reverse proxy, or an
approved tunnel. Much faster, and a conversation to have with security *first*,
not after. If you go this way, use OAuth rather than the API key: a shared static
key is fine on an internal network and thin on a public one.

Either way, WCC needs to be somewhere other than your laptop before Copilot
Studio can see it. That is the real work; the wizard below is ten minutes.

### Finding your Server URL

> **Being domain-joined does not make your machine reachable from Microsoft.**
> Domain join is about *identity* — your laptop trusts the bank's AD and the
> bank's AD trusts your laptop, so you sign in with your domain account and
> Kerberos works. It says nothing about who can open a TCP connection to you.
> `bank.local` is an internal DNS zone that resolves only on the bank's network.
> Microsoft's cloud cannot resolve it and could not route to it if it could.

Three different questions get three different URLs. Work out which one you are
actually asking.

**1. For a client on the same machine** (VS Code, Claude Desktop — [step 3](#3-connect-a-client-on-your-own-machine)):

```
http://localhost:8000/api/agent/mcp
```

That is the whole answer. Nothing to look up.

**2. For a colleague on the bank network.** You need your machine's name or
address. In PowerShell:

```powershell
hostname                                                   # short name
[System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName # fully qualified
(Get-CimInstance Win32_ComputerSystem).Domain              # the domain you joined
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' } |
  Select-Object IPAddress, InterfaceAlias
```

`ipconfig /all` shows the same things: **Host Name**, **Primary Dns Suffix**,
**IPv4 Address**. The URL is then:

```
http://<hostname>.<primary dns suffix>:8000/api/agent/mcp
```

Confirm it before trusting it, from a *different* machine on the network:

```powershell
nslookup <hostname>.<domain>                       # does DNS know the name?
Test-NetConnection <hostname>.<domain> -Port 8000  # can it open the port?
curl http://<hostname>.<domain>:8000/health        # does WCC answer?
```

If `Test-NetConnection` fails, it is almost always Windows Firewall. As
administrator:

```powershell
New-NetFirewallRule -DisplayName "WCC API" -Direction Inbound `
  -Protocol TCP -LocalPort 8000 -Action Allow
```

**Read [the warning below](#before-you-expose-any-port) before you open that
port.** A laptop is also a poor host regardless: it sleeps, its DHCP address
changes, and it leaves the building at six o'clock.

**3. For Copilot Studio.** None of the above works, because none of it is
reachable from Microsoft's cloud. You need one of:

- a name in a **public** DNS zone (`wcc.sbibank.com.kh`, not `.local`) pointing
  at something in the bank's DMZ, with HTTPS and a real certificate; or
- the **on-premises data gateway**, in which case the URL you give the custom
  connector is the internal one from (2) — the gateway makes the outbound
  connection from inside, so nothing is published.

Both of those are requests to your network team, not things you can configure
yourself. Which is fine: the ask is small and specific. *"I need an internal
Linux VM with a fixed IP and a DNS record, running Docker, and an on-premises
data gateway registered to our Power Platform environment so Copilot Studio can
reach it."*

**Do not reach for a tunnel** (ngrok, dev tunnels, Cloudflare Tunnel) to skip
this. On a bank network they are usually blocked, always a policy conversation,
and in this case genuinely dangerous — see below.

### Before you expose any port

**WCC has no login.** Everything under `/api` — tasks, meetings, the server
inventory, and `POST /api/servers/accounts/{id}/reveal` — answers anyone who can
open a TCP connection to it. The `WCC_AGENT_KEY` protects only `/api/agent/*`.
Port 3000 is not safer: nginx proxies `/api/` through to the same backend.

That is a sound design for `localhost` on one person's machine, which is what it
has been until now. It stops being sound the moment the port is reachable by
anyone else. Concretely: if you put this on a shared server with passwords in the
vault, any colleague who can reach port 8000 or 3000 can read them, and the
access log will faithfully record that it happened without recording who.

So:

- **Keep it on localhost** while it is only you. [Step 3](#3-connect-a-client-on-your-own-machine)
  needs nothing else.
- **Before it goes on a server**, either leave `WCC_VAULT_KEY` unset there — the
  inventory and `vault_location` still work, and no password is stored to leak —
  or put authentication in front of it (a reverse proxy with SSO, or network
  rules that admit only your workstation).
- **Never publish it to the internet as it stands**, tunnel included.

### The Copilot Studio wizard

Once the URL is reachable:

1. Open your agent in Copilot Studio and go to **Tools**.
2. **Add a tool** → **New tool** → **Model Context Protocol**.
3. Fill in:
   - **Server name**: `Work Control Center`
   - **Server description**: *Runbooks, install guides, work items and server inventory.*
   - **Server URL**: `https://<your-host>/api/agent/mcp`
4. **Authentication type**: **API key**.
5. **Type**: **Header**.
6. **Name**: `X-API-Key` — exactly that, it is what WCC reads.
7. **Create**.
8. On **Add tool**, choose **Create a new connection**, paste the value of
   `WCC_AGENT_KEY`, and connect.
9. **Add to agent**.
10. Test it in the Copilot Studio test pane before publishing: *"search my
    runbooks for MQ"*. Then publish the agent to Teams.

Copilot Studio supports streamable transport only, which is what WCC speaks, so
there is nothing to choose there.

### If the MCP wizard will not take an internal URL

Use the OpenAPI document instead — this is the path that supports the gateway
explicitly. In Power Apps, **Custom connectors** → **New** → **Import an OpenAPI
file**, and give it `/api/agent/openapi.json`. Set the host, tick the gateway
option, set the security to API key in the `X-API-Key` header, then add the
connector to your agent as a tool. Same eight operations, described as plain
REST.

---

## What Copilot can do

| Tool | What it does |
|---|---|
| `search_knowledge` | Find notes, runbooks and install guides. Words match in any order |
| `get_knowledge` | Read one in full |
| `create_knowledge` | Write a new note or runbook |
| `update_knowledge` | Change one, or **append** to it without rewriting what is there |
| `list_tasks` | What is open, what is overdue |
| `create_task` | Raise one. It lands in the inbox to be triaged, not in the active list |
| `update_task` | Change status, priority, due date, next action |
| `list_servers` | The inventory: name, hostname, environment, OS, what it runs |

Nothing else. No issues, no meetings, no people, no calendar — those stay in the
app, because a tool Copilot never needed is a surface that can only cost you.

Both shapes describe the same eight operations:

- **`POST /api/agent/mcp`** — MCP over streamable HTTP, protocol `2025-06-18`.
- **`GET /api/agent/openapi.json`** — OpenAPI 3.0, the same tools as plain
  `POST` endpoints, for API plugins and Power Platform custom connectors.

Both authenticate with `X-API-Key: <WCC_AGENT_KEY>`. The OpenAPI document is
hand-written rather than generated from the app's routes — a generated document
grows whatever you add to the application, and one day that would be a
credential endpoint.

## The boundary

The claim is that **Copilot cannot obtain a stored password from WCC**, and it is
worth being precise about why, because "we didn't add that tool" is not a reason
to trust anything.

- No tool returns one. Not `list_servers`, not any argument to it.
- Account names are excluded too, unless you deliberately set
  `WCC_AGENT_EXPOSE_ACCOUNTS=1`. Passwords are excluded at every setting; there
  is no flag that includes them.
- `app/api/agent.py` does not import `app/services/vault.py`, does not reference
  the `secret_ciphertext` column, and imports nothing that leads to either. The
  module has no path to a credential to expose by accident.
- The published OpenAPI document contains no route, operation or schema with
  "secret", "password", "credential" or "reveal" in it.

Each of those is a test in `tests/knowledge_suite.py`, including a sweep that
stores a known password, calls **every tool the agent offers with several
argument shapes**, and fails if that password appears anywhere in any reply. If
someone adds a leaky tool later, that test goes red.

Passwords are reachable only through the app's own UI, only when `WCC_VAULT_KEY`
is set, and every reveal is written to an access log with whatever reason you
gave.

## The environment variables

| Variable | Default | What it does |
|---|---|---|
| `WCC_AGENT_KEY` | *(unset)* | Turns the agent interface on and is the key it requires. Unset means every agent route returns 401 |
| `WCC_VAULT_KEY` | *(unset)* | Encrypts stored passwords. Unset means the server inventory works normally but storing a password is refused. **Not** read from or written to the database — keep it in your own password manager |
| `WCC_AGENT_EXPOSE_ACCOUNTS` | `0` | Set to `1` to let `list_servers` include account usernames and where their credentials live. Still never a password |

Losing `WCC_VAULT_KEY` means the stored passwords cannot be read back. That is
the point of holding it somewhere the database is not.

## When it does not work

| What you see | What it is |
|---|---|
| `{"enabled": false}` from `/status` | `WCC_AGENT_KEY` is not reaching the container. Check it is in `.env` *and* named in the compose file, then `docker compose up -d` |
| `401 Bad or missing API key` | The header name is wrong (`X-API-Key`, exactly) or the value does not match |
| `503 The agent interface is switched off` | Same as the first row — the key is genuinely unset |
| The client connects but lists no tools | It is talking to `/api/agent/openapi.json` expecting MCP, or to `/api/agent/mcp` expecting REST. They are different endpoints |
| Copilot Studio says it cannot reach the server | The network problem above. It is not a configuration error and no amount of retrying fixes it |
| `409` when storing a password | `WCC_VAULT_KEY` is unset or has changed. The inventory still works; only storing and revealing are affected |

## Before you put real credentials in this

Say this part plainly: banks normally require privileged credentials to live in a
managed PAM vault — CyberArk, Delinea, Azure Key Vault — with its own approvals,
rotation and audit trail. WCC's vault is Fernet encryption with a key in an
environment variable and an append-only access log. That is a real improvement on
a notebook or a spreadsheet, and it is not a PAM product.

The `vault_location` field on every account exists for exactly this reason: it
records *where the credential of record lives*, so you can use WCC as the map
even where you are not allowed to use it as the safe. Check with your security
team before it becomes the safe.

---

Sources for the Microsoft side:

- [Connect your agent to an existing MCP server (Copilot Studio)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- [Plugins for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins)
- [Build a plugin for a declarative agent from an MCP server](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins)
- [Configure authentication for MCP and API plugins](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication)
- [Connect to custom on-premises APIs using the data gateway](https://www.microsoft.com/en-us/power-platform/blog/power-automate/on-premise-apis/)
- [MCP servers in VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
