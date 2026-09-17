# Connecting an AI assistant to Work Control Center

WCC exposes an agent interface so an AI assistant can answer "what's the runbook
for failing MQ over to DR", raise a task from a chat, or append what you just
learned to a note — without you leaving the window you are already in.

**It is not a Copilot feature.** What WCC speaks is the Model Context Protocol,
which is an open standard, so *any* MCP client can use it. Copilot Studio is one
option and it is the one that costs money. [Which assistant should I
use?](#which-assistant-should-i-use) compares the free ones first.

**There is now a shorter route.** WCC has its own Assistant page, which runs the
same tools without any of the client setup below — no MCP configuration, no key
pasted in each morning, no VS Code open just to ask a question. If that is all
you wanted, read [0. The Assistant page](#0-the-assistant-page-inside-wcc) and
stop there. The rest of this document is for connecting *someone else's*
assistant — Copilot in VS Code, Copilot Studio, Claude Desktop — which is worth
doing when you want WCC's answers inside a window you are already working in.

**Do these in order.** Steps 1–3 take ten minutes, happen entirely on your own
machine, and need nobody's permission or licence.

| | |
|---|---|
| [0. The Assistant page, inside WCC](#0-the-assistant-page-inside-wcc) | One extra compose file. Nothing to install |
| [1. Turn it on](#1-turn-it-on) | Two keys in `.env`, restart |
| [2. Prove it works](#2-prove-it-works) | `make agent-check` |
| [3. Connect a client on your own machine](#3-connect-a-client-on-your-own-machine) | LM Studio, VS Code or Claude Desktop, over localhost |
| [4. Connect Microsoft Copilot](#4-connect-microsoft-copilot) | Only if you have a Copilot Studio licence |

Before any of it: **the assistant never sees a password.** Not by configuration
— by construction. [The boundary](#the-boundary) explains exactly what that
means.

---

## 0. The Assistant page, inside WCC

**Sidebar → Assistant.** A chat box in WCC itself, with the same eight tools the
MCP interface publishes. It searches your runbooks, reads your inventory and
raises your tasks, and it shows you every tool it used rather than hiding the
work behind a spinner.

The difference from everything below is what you *don't* do: there is no MCP
client to install, no `mcp.json`, no agent key pasted into a config, and nothing
to start before you can ask a question. The tool-calling loop runs inside WCC's
own backend, so the only thing WCC needs is somewhere to send the thinking.

### Setting it up, with nothing to install

If installing LM Studio is awkward — a managed laptop, a change request, a rule
about unapproved software — you do not need it. Docker is already here, because
that is how WCC runs, and Docker Desktop can serve the model itself:

```bash
docker compose -f docker-compose.yml -f docker-compose.model.yml up -d
```

That is the whole setup. No account, no API key, no second application, and
**nothing leaves the machine** — which is the part that matters when the thing
being asked about is the bank's server inventory.

Two conditions. Docker Desktop must be **4.40+ on macOS or 4.41+ on Windows**,
with *Settings → AI → Enable Docker Model Runner* ticked. And the first `up`
downloads the model, several GB, once — after that it is cached like any image.

Change the model with `WCC_MODEL` in `.env`. It must support **tool calling**,
or the assistant will chat pleasantly and never touch your data:

```bash
WCC_MODEL=ai/qwen3          # the default, ~4.7GB, good at tool calling
```

`docker model ls` shows what is downloaded and `docker model rm` frees the
space. On Linux Docker Engine rather than Desktop, install the plugin
(`sudo apt-get install docker-model-plugin`) and change the URL in
`docker-compose.model.yml` to `http://172.17.0.1:12434/engines/v1`, which is
what a container uses there.

### Setting it up with LM Studio

One variable, or two if the model is not on the same machine:

```bash
# .env
WCC_LLM_BASE_URL=http://host.docker.internal:1234/v1
WCC_LLM_MODEL=qwen2.5-7b-instruct
```

```bash
docker compose up -d
```

That points it at **LM Studio** on your own machine: free, works at a bank, and
your runbooks never leave the laptop. Install LM Studio, download a model that
advertises **tool use / function calling** (LM Studio can filter for it — a model
without it will ignore WCC's tools entirely), then **Developer → Start Server**.
Nothing else in LM Studio needs configuring; WCC is the client here, not the
host, so you can skip its `mcp.json` completely.

Then open the Assistant page. If it shows an amber banner instead of a chat box,
it is telling you exactly which variable is missing.

**`host.docker.internal`, not `localhost`.** Inside the container, `localhost`
*is* the container — the single most common way this fails. The compose files
already map that name on plain Linux Docker as well as Docker Desktop. If you
run the backend from source rather than in Docker, use `http://localhost:1234/v1`.

`WCC_LLM_MODEL` unset means the page politely says so and does nothing. Nothing
else in WCC is affected, so leaving it off is a perfectly good state.

### Ollama instead

```bash
WCC_LLM_BASE_URL=http://host.docker.internal:11434/v1
WCC_LLM_MODEL=qwen2.5:7b
```

### A free hosted model, and the question to ask first

Several providers give away an OpenAI-compatible endpoint, and WCC will talk to
any of them — it is two variables, as always. Before reaching for one, though,
read what the free tier does with what you send it, because "free" is often
paid for in exactly the currency you cannot spend here.

Google says it outright about the Gemini API's unpaid tier: content submitted
is used "to provide, improve, and develop Google products and services", human
reviewers may read it, and the terms instruct you plainly — **"Do not submit
sensitive, confidential, or personal information to the Unpaid Services."**
A runbook describing how the bank's middleware fails over, or an inventory
naming its hosts, is all three. The paid tier does not train on your prompts;
the free one is not built for this.

That is not Google being unusual. It is the normal shape of a free AI tier, and
it is worth checking for whichever provider you are considering rather than
assuming. Two that are genuinely OpenAI-compatible and free to start:

```bash
# Groq
WCC_LLM_BASE_URL=https://api.groq.com/openai/v1
WCC_LLM_MODEL=<a model from their catalogue that supports tool use>
WCC_LLM_API_KEY=<from console.groq.com>

# Google Gemini - read the paragraph above before using this with real runbooks
WCC_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
WCC_LLM_MODEL=<a current Gemini model>
WCC_LLM_API_KEY=<from aistudio.google.com>
```

Both need the container to reach the internet, which on a bank's network is its
own conversation. `tests/chat_suite.py` pins the exact URL each provider's
documentation gives, so a wrong join cannot silently become a 404 — but nobody
here has run WCC against either account, so treat the model names as something
to look up rather than copy.

**The honest recommendation:** use the Docker route above. It costs nothing,
installs nothing, needs no account, and asks nobody's permission — because the
question "where did our runbooks go" never arises. Save a hosted model for when
the company licences one properly, which is what the Azure section below is for.

### Azure OpenAI, when the company licence arrives

This is the path to plan for if the bank buys Microsoft's premium licensing. The
base URL ends at the *deployment*, the model name **is** the deployment name, and
Azure is the only provider that fails without an api-version:

```bash
WCC_LLM_BASE_URL=https://<resource>.openai.azure.com/openai/deployments/<deployment>
WCC_LLM_MODEL=<deployment>
WCC_LLM_API_KEY=<the key from the Azure portal>
WCC_LLM_API_VERSION=2024-10-21
```

Miss `WCC_LLM_API_VERSION` and Azure answers 404 with nothing that explains why.
The key is sent as both `Authorization: Bearer` and `api-key`, so the same
variable works whichever the endpoint expects — which is also why OpenAI itself,
vLLM, llama.cpp or anything else OpenAI-compatible needs no code change, only a
different base URL.

Note what changes when you do this: with Azure, your runbooks and server names
**do** leave the building on every question. That is a policy conversation, and
it is worth having before the licence is bought rather than after.

### Copilot Studio later, not instead

The premium licence and this page are not alternatives. Keep this page for
yourself, and use Copilot Studio ([step 4](#4-connect-microsoft-copilot)) if the
point is to give *colleagues* access through Teams without each of them running
anything. They read the same tools and the same data either way.

### What it will not do

It cannot read a stored password — not as a setting you could switch on, but
because no tool returns one and the chat module cannot reach the vault at all.
Ask for one and it will tell you which vault holds it. [The
boundary](#the-boundary) is the same for this page as for MCP, and for the same
structural reason.

It also does not stream a word at a time. A turn here usually means calling a
tool and then thinking again, and a half-written tool call is not something worth
animating — so it waits, then shows you the whole turn including what it touched.

---

## Which assistant should I use?

| | Cost | Where your runbooks go | Verdict |
|---|---|---|---|
| **WCC's Assistant page + Docker serving the model** | Free, including at work | **Nowhere.** The model runs on your machine | **Start here.** Nothing to install at all — Docker is already here |
| WCC's Assistant page + **LM Studio** | Free, including at work | **Nowhere** | Same, if you would rather have the model in its own app |
| WCC's Assistant page + a **free hosted tier** | Free, with limits | The provider's cloud — and free tiers usually train on it | Fine for trying it out. Read [the question to ask first](#a-free-hosted-model-and-the-question-to-ask-first) before real runbooks |
| **LM Studio + a local model** | Free, including at work | **Nowhere.** The model runs on your machine | Same privacy, and a chat window outside WCC. Needs `mcp.json` |
| VS Code + **GitHub Copilot Free** | Free, 50 chat requests/month | GitHub / Microsoft cloud | Fine for occasional lookups. The cap is monthly and low |
| **Continue** or **Cline** in VS Code, pointed at a local model | Free, open source | Nowhere, with a local model | If you want it inside the editor without the cap |
| VS Code + GitHub Copilot **Pro** | $10/month, personal | Microsoft cloud | If you already pay for it |
| **Copilot Studio** | Licensed, per-message capacity packs | Microsoft cloud | Only worth it for a Teams rollout to colleagues |

Two things to know before choosing:

**The local option is not a downgrade here — it is the better answer.** Your
runbooks describe the bank's middleware and your inventory names its servers.
With a cloud assistant that content leaves the building on every query and lands
in someone's prompt logs. With a model running on your laptop it never leaves,
which removes the policy conversation entirely. That is a real advantage, not a
consolation prize.

**Do not trust older blog posts about Gemini CLI.** Google shut its free tier
for individual developers on 18 June 2026. Plenty of "free MCP setup" articles
still recommend it.

### LM Studio, concretely

Free for commercial and work use since July 2025 — no form, no licence request.
It has been an MCP host since version 0.3.17.

1. Install LM Studio and download a model. Pick one advertised as supporting
   **tool use / function calling** — LM Studio can filter for it. Tool calling is
   the whole mechanism here, and a model without it will simply ignore WCC.
   Around 7–8B parameters is the usual floor for reliable tool use, and that
   wants roughly 8 GB of free RAM.
2. Right sidebar → **Program** → **Install** → **Edit `mcp.json`**:

```json
{
  "mcpServers": {
    "work-control-center": {
      "url": "http://localhost:8000/api/agent/mcp",
      "headers": {
        "Authorization": "Bearer PASTE_YOUR_WCC_AGENT_KEY_HERE"
      }
    }
  }
}
```

3. Ask it something only WCC knows: *"search my runbooks for MQ failover"*.

WCC accepts the key either as `Authorization: Bearer <key>` or as
`X-API-Key: <key>`, so LM Studio's own header format works unchanged.

The honest caveat: a small local model is a weaker reasoner than a frontier
cloud model. For "find the runbook and show it to me", which is most of what
this is for, that gap barely matters. For "read these five runbooks and work out
why the failover failed", it will.

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
`localhost`, needs no gateway, no tunnel, no licence and no approval from
anyone, and it proves the interface works before you spend an afternoon on
tenant configuration. If the answer you want is "ask a question, get the
runbook", this may be all you ever need.

### LM Studio (free, and nothing leaves the machine)

See [Which assistant should I use?](#lm-studio-concretely) above for the
`mcp.json` and the model requirement. This is the recommended route.

### VS Code (GitHub Copilot, agent mode)

Agent mode and MCP are included on the **Free** plan, capped at 50 chat requests
a month — enough to try it and enough for occasional lookups, not enough for
daily use. Pro is $10/month if you want the cap lifted.

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

### Continue or Cline, pointed at a local model

Both are free, open-source VS Code extensions with MCP support, and both can use
a model served locally by LM Studio or Ollama — so there is no monthly cap and
nothing leaves the machine. Use this if you want the assistant inside the editor
but not the Copilot Free request limit.

### Claude Desktop, or any other MCP client

Same endpoint, same key. The interface is a standard MCP server over streamable
HTTP (protocol `2025-06-18`), so anything that speaks MCP can use it — Claude
Desktop, Zed, Cherry Studio, Jan, and others. WCC accepts the key as either
`X-API-Key: <key>` or `Authorization: Bearer <key>`, which covers both
conventions clients use.

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
asks you to start a trial or shows no environment, you need a licence and a
Power Platform environment from whoever administers it.

**Copilot Studio is not free**, and a trial that expires is not a plan. It is
licensed per capacity — messages are metered — on top of whatever Microsoft 365
Copilot licensing your organisation has. Two consequences worth being clear
about before you spend an afternoon here:

- Everything in this section only pays off if **colleagues** are going to use
  the agent from Teams. For your own use, [step 3](#3-connect-a-client-on-your-own-machine)
  does the same job for nothing.
- It is also the option that sends your runbooks and server inventory to
  Microsoft's cloud, which the local option does not. Weigh that before
  requesting budget for it, not after.

If it does let you in and a rollout to the team is the actual goal, carry on.

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

## When the assistant tries once and then gives up

The symptom: you ask it to create a task, the call fails, and it does nothing
further — no retry, no explanation, no more tool calls for the rest of the
session.

That was a real defect, found by driving `/api/agent/mcp` the way a client does
and sending the arguments a model actually produces. Three of them —
`priority: "high"`, `priority: "HIGH"`, `status: "TODO"` — reached the database
as invalid enum values, raised inside SQLAlchemy, and escaped as a bare **HTTP
500 with a plain-text body**. A client expecting JSON-RPC cannot parse that, so
it treats the server as broken rather than the argument as wrong, and stops.

Three things changed:

- **No tool failure can produce a 500 any more.** Everything comes back as an
  `isError` result, which is what the MCP spec asks for and what lets a model
  read the message and try again. Verified by sweeping every tool and every
  field with nonsense values — 722 calls, all returning parsable JSON-RPC.
- **The obvious synonyms are accepted.** "high" is `P1_HIGH`, "urgent" is
  `P0_CRITICAL`, "todo" is `INBOX`, "done" is `COMPLETED`, and a trailing `Z` on
  a date is fine. A model writes what a person writes; arguing with it costs a
  round trip at best.
- **When a value really is unusable, the error says what would work.** Not
  `create_task() missing 1 required positional argument: 'title'`, which tells a
  model nothing, but a sentence naming the field, the allowed values and the
  instruction to call again.

`status` also had no `enum` in its schema, which is precisely why models were
inventing `TODO`. It has one now, as do `priority` on all three task tools.

### Telling it how to work

The server sends usage guidance in its MCP `instructions` on connect — search
before answering, get ids from `list_tasks`, append rather than rewrite, resolve
dates yourself, and that an `isError` reply means correct the argument rather
than abandon the task.

Not every client shows that text to the model. For VS Code, make it certain:
copy [`copilot-instructions.md`](copilot-instructions.md) from this repository
to `.github/copilot-instructions.md` in the workspace you actually work in.
Copilot reads that file on every request, so it never has to rediscover how your
tools behave.

Two other things worth checking in VS Code if it still will not act:

- The chat has to be in **Agent** mode. Ask and Edit modes cannot call tools.
- Open the tool picker in the chat box and confirm the eight `work-control-center`
  tools are ticked. VS Code caps how many tools can be active at once, and a
  crowded workspace can leave yours switched off.

## The boundary

The claim is that **no assistant can obtain a stored password from WCC** — not
Copilot over MCP, and not the Assistant page inside WCC itself — and it is worth
being precise about why, because "we didn't add that tool" is not a reason to
trust anything.

- No tool returns one. Not `list_servers`, not any argument to it.
- Account names are excluded too, unless you deliberately set
  `WCC_AGENT_EXPOSE_ACCOUNTS=1`. Passwords are excluded at every setting; there
  is no flag that includes them.
- `app/api/agent.py` does not import `app/services/vault.py`, does not reference
  the `secret_ciphertext` column, and imports nothing that leads to either. The
  module has no path to a credential to expose by accident.
- The published OpenAPI document contains no route, operation or schema with
  "secret", "password", "credential" or "reveal" in it.
- The Assistant page adds nothing to this. `app/api/chat.py` serves
  `agent.TOOLS` — the same list, not a private one — and does not import the
  vault either. A tool added once appears in both places and cannot drift apart.

Each of those is a test in `tests/knowledge_suite.py`, including a sweep that
stores a known password, calls **every tool the agent offers with several
argument shapes**, and fails if that password appears anywhere in any reply. If
someone adds a leaky tool later, that test goes red.

Passwords are reachable only through the app's own UI, only when `WCC_VAULT_KEY`
is set, and every reveal is written to an access log with whatever reason you
gave. `tests/chat_ui_suite.mjs` puts a real password in the vault and then asks
the Assistant page for it, failing if either the password or the account holding
it reaches the screen.

## The environment variables

| Variable | Default | What it does |
|---|---|---|
| `WCC_AGENT_KEY` | *(unset)* | Turns the agent interface on and is the key it requires. Unset means every agent route returns 401 |
| `WCC_VAULT_KEY` | *(unset)* | Encrypts stored passwords. Unset means the server inventory works normally but storing a password is refused. **Not** read from or written to the database — keep it in your own password manager |
| `WCC_AGENT_EXPOSE_ACCOUNTS` | `0` | Set to `1` to let `list_servers` include account usernames and where their credentials live. Still never a password |
| `WCC_LLM_MODEL` | *(unset)* | The model behind the **Assistant page**. Unset means that page says so and does nothing; the rest of WCC is unaffected. Nothing to do with `WCC_AGENT_KEY`, which is for *other* assistants connecting in |
| `WCC_LLM_BASE_URL` | `http://host.docker.internal:1234/v1` | Where that model lives. The default is LM Studio on the host — from inside the container, `localhost` is the container |
| `WCC_LLM_API_KEY` | *(unset)* | Only for a hosted model. Sent as both `Authorization: Bearer` and `api-key`, so one variable covers OpenAI and Azure |
| `WCC_LLM_API_VERSION` | *(unset)* | Azure OpenAI only, e.g. `2024-10-21`. Azure returns 404 without it. Leave unset for everything else |

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
| The Assistant page shows an amber "no model is configured" banner | `WCC_LLM_MODEL` is not reaching the container. Same fix as the first row — `.env` *and* the compose file |
| "Could not reach the model at …" | The model's server is not running, or the URL says `localhost` where it needs `host.docker.internal`. Inside the container, `localhost` is the container |
| "The model's reply was not in the expected shape" | That URL is answering, but it is not an OpenAI-compatible chat-completions endpoint. Check the path ends in `/v1` (or, for Azure, at the deployment with `WCC_LLM_API_VERSION` set) |
| The Assistant answers but never uses a tool | The model does not support function calling. Pick one advertised as supporting tool use; below roughly 7B, tool use is unreliable even when supported |
| "I stopped after 6 rounds of tool calls" | The model looped instead of answering — usually a small model with a vague question. Ask again more specifically |

## Opening a server in one click

Each account on the Servers page carries three buttons — **Remote Desktop**,
**WinSCP** and **MobaXterm** — ordered so a Windows box leads with RDP and
everything else leads with a shell. Clicking one copies the stored password to
the clipboard and hands the client the host, port and username.

**The password is copied, not embedded, and that is deliberate.** Two hard
limits shaped this:

- An `.rdp` file cannot carry a password. Windows stores it as a DPAPI blob
  encrypted to one user on one machine, so nothing generated elsewhere could
  ever decrypt there. Microsoft did that on purpose.
- A password *can* go in an `sftp://` URL, and it must not. The browser writes
  every URL it navigates to into history, and a bank credential in browser
  history is precisely what the vault exists to prevent.

So one paste is the honest cost. Everything else — hostname, port, username — is
filled in for you, and that is the part you would otherwise be hunting for.
Opening a client is recorded in the access log exactly like a reveal, because
the plaintext leaves either way.

### Which address it dials

Three fields, and they are not interchangeable:

| Field | Example | What it is for |
|---|---|---|
| **IP address** | `10.20.4.11` | **What the buttons dial.** |
| **DNS name** | `mbsapp01.bank.local` | The record it resolves by. Used when there is no IP |
| **Hostname** | `MBSAPP01` | What the box calls itself. The last resort |

The IP wins because a name only works if the machine you are sitting at can
resolve it, and a laptop on VPN frequently cannot — split-horizon DNS, a suffix
the VPN does not push, a DR record still pointing at the DC box. The IP means
the same thing from everywhere. The toast names the address it used and which
field it came from, so it is never a guess.

One consequence worth knowing. An `.rdp` aimed at an IP cannot verify the
server's identity: Kerberos looks up a service principal by name and an IP has
none, so it falls back to NTLM, and the machine's certificate names the host
rather than the address. So Windows will ask whether you trust the machine —
*"Do you want to connect despite these certificate errors?"*, **Yes** / **No** —
exactly as it does when you type the same address into mstsc yourself. Say yes
and tick the box, and it stops asking for that machine.

The file sets `authentication level:i:2` for that reason. Microsoft's numbering
is not in the order you would guess, and it is worth writing down because
getting it backwards produces a dead end rather than an error:

| | |
|---|---|
| `0` | connect anyway, no warning |
| `1` | **do not connect** — *"You cannot proceed because authentication is required"*, with only an **OK** button |
| `2` | **warn, and let me choose** — Yes / No. What WCC uses, and what mstsc does by default |
| `3` | unspecified |

If you ever see the OK-only dialog, something is forcing `1` — either an edited
`.rdp` or the *Configure server authentication for client* group policy set to
"Do not connect".

### Ports

Leave the port fields on a server blank unless they are unusual. Blank means 22
and 3389, and the links then omit the port entirely, which is what every client
expects. Set `ssh_port` or `rdp_port` only for the boxes that differ, and the
port appears in the link, the `.rdp` file and the copyable command.

### Making the buttons work the first time

Remote Desktop needs nothing — it downloads a `.rdp` file that Windows opens.

`sftp://` and `ssh://` are protocol handlers, and the browser can only hand them
to an application that has registered for them:

- **WinSCP** registers `sftp://` and `scp://` during installation. If it does
  not fire, open WinSCP → *Options* → *Preferences* → *Integration* →
  *Applications* and register it there.
- **MobaXterm** does not register `ssh://` by default. Settings →
  *Configuration* → *Terminal* has the option, or use PuTTY, which does.
- The first click shows a browser prompt asking to open the external
  application. Tick "always allow" and it stops asking.

If a handler is not registered the click does nothing at all — the page stays
where it is. That is the browser declining, not WCC failing. Use the copyable
command shown in the toast in the meantime.

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

Sources:

- [Connect your agent to an existing MCP server (Copilot Studio)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- [Plugins for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins)
- [Build a plugin for a declarative agent from an MCP server](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins)
- [Configure authentication for MCP and API plugins](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication)
- [Connect to custom on-premises APIs using the data gateway](https://www.microsoft.com/en-us/power-platform/blog/power-automate/on-premise-apis/)
- [MCP servers in VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
- [GitHub Copilot plans and pricing](https://github.com/features/copilot/plans) — agent mode and MCP on the Free plan, and its limits
- [LM Studio as an MCP host](https://lmstudio.ai/docs/app/plugins/mcp)
- [LM Studio is free for use at work](https://lmstudio.ai/blog/free-for-work)
