# Connecting Microsoft Copilot to Work Control Center

WCC exposes an agent interface so Copilot can answer "what's the runbook for
failing MQ over to DR", raise a task from a chat, or append what you just
learned to a note — without you leaving Teams.

Two things to settle before any of it matters:

1. **Copilot never sees a password.** Not by configuration — by construction.
   [The boundary](#the-boundary) explains what that means and how it is enforced.
2. **Copilot runs in Microsoft's cloud. WCC runs on your laptop or an internal
   server.** Something has to bridge that gap, and which bridge you use is the
   only real decision here. [Getting Copilot to reach it](#getting-copilot-to-reach-it).

---

## Turning the interface on

It is off until you give it a key. Generate one:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Put it in your `.env` next to the database URL:

```env
WCC_AGENT_KEY=the-long-random-string-you-just-generated
```

Restart, then check:

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

## Two ways to plug it in

The same capability is published twice, because Copilot accepts two shapes:

- **`POST /api/agent/mcp`** — a Model Context Protocol server over streamable
  HTTP (protocol version `2025-06-18`). This is the one to use with Copilot
  Studio's MCP wizard, and with any other MCP client — Claude Desktop, VS Code,
  whatever you end up with.
- **`GET /api/agent/openapi.json`** — an OpenAPI 3.0 document describing the
  same eight tools as plain `POST` endpoints, for the API-plugin route and for
  Power Platform custom connectors.

Both authenticate with `X-API-Key: <WCC_AGENT_KEY>`.

The OpenAPI document is hand-written rather than generated from the app's
routes. That is deliberate: a generated document grows whatever you add to the
application, and one day that would be a credential endpoint. This one only ever
describes what it lists.

## Getting Copilot to reach it

This is the part that takes an afternoon, and it is worth understanding before
you start rather than halfway through.

Copilot calls your tools **from Microsoft's cloud**. `http://localhost:8000` on
your work laptop is not somewhere Microsoft can call. Neither, normally, is
`http://mbsapp01.bank.local:8000`. So one of the following has to be true:

### Option A — Copilot Studio with an on-premises data gateway *(the bank-friendly one)*

Copilot Studio reaches external systems through Power Platform connectors, and
Power Platform connectors can reach an internal API through the **on-premises
data gateway**: you install the gateway on a machine inside the network, and it
makes the outbound connection. Your API stays internal and is never exposed to
the internet.

Roughly:

1. Run WCC somewhere on the internal network with a stable address — a small VM,
   or a server, not your laptop. Give it HTTPS if your network expects it.
2. Install the on-premises data gateway on a machine that can reach it, and
   register it to your tenant.
3. In Power Apps, create a **custom connector**, importing
   `/api/agent/openapi.json`. Set the host to WCC's internal address, tick
   "Connect via on-premises data gateway", and set the API key security scheme.
4. Test the connector, then add it to an agent in Copilot Studio.

This is the route to propose to whoever owns Copilot at the bank, because the
answer to "does this open a hole to the internet" is no.

### Option B — a reachable HTTPS endpoint

If WCC is published — a DMZ host, a reverse proxy, an approved tunnel — then the
M365 Copilot extensibility routes (a declarative agent with an MCP plugin or an
API plugin) point at it directly. Faster to set up, and a conversation to have
with security first. If you go this way, use OAuth or Entra SSO rather than the
API key: a shared static key is fine on an internal network and thin on a public
one.

### Option C — not Copilot at all, for now

The MCP endpoint is a standard MCP server. Any MCP client running **on your own
machine** can use it over `localhost` with no gateway, no tunnel and no
approval — Claude Desktop, VS Code, and others. If what you actually want is
"ask a question and get the runbook", this works today and costs nothing.

> I could not confirm from Microsoft's own documentation whether the M365
> Copilot MCP-plugin route supports a private endpoint; the pages describe
> authentication but say nothing about network reachability. Treat Option B as
> requiring a reachable endpoint until someone with the tenant proves otherwise.

## The boundary

The claim is that **Copilot cannot obtain a stored password from WCC**, and it
is worth being precise about why, because "we didn't add that tool" is not a
reason to trust anything.

- No tool returns one. Not `list_servers`, not any argument to it.
- Account names are excluded too, unless you deliberately set
  `WCC_AGENT_EXPOSE_ACCOUNTS=1`. Passwords are excluded at every setting; there
  is no flag that includes them.
- `app/api/agent.py` does not import `app/services/vault.py`, does not
  reference the `secret_ciphertext` column, and imports nothing that leads to
  either. The module has no path to a credential to expose by accident.
- The published OpenAPI document contains no route, operation or schema with
  "secret", "password", "credential" or "reveal" in it.

Each of those is a test in `tests/knowledge_suite.py`, including a sweep that
stores a known password, calls **every tool the agent offers with several
argument shapes**, and fails if that password appears anywhere in any reply.
If someone adds a leaky tool later, that test goes red.

Passwords are reachable only through the app's own UI, only when
`WCC_VAULT_KEY` is set, and every reveal is written to an access log with
whatever reason you gave.

## The environment variables

| Variable | Default | What it does |
|---|---|---|
| `WCC_AGENT_KEY` | *(unset)* | Turns the agent interface on and is the key it requires. Unset means every agent route returns 401 |
| `WCC_VAULT_KEY` | *(unset)* | Encrypts stored passwords. Unset means the server inventory works normally but storing a password is refused. **Not** read from or written to the database — keep it in your own password manager |
| `WCC_AGENT_EXPOSE_ACCOUNTS` | `0` | Set to `1` to let `list_servers` include account usernames and where their credentials live. Still never a password |

Generate a proper vault key rather than typing a passphrase:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Losing it means the stored passwords cannot be read back. That is the point of
holding it somewhere the database is not.

## Before you put real credentials in this

Say this part plainly: banks normally require privileged credentials to live in
a managed PAM vault — CyberArk, Delinea, Azure Key Vault — with its own
approvals, rotation and audit trail. WCC's vault is Fernet encryption with a key
in an environment variable and an append-only access log. That is a real
improvement on a notebook or a spreadsheet, and it is not a PAM product.

The `vault_location` field on every account exists for exactly this reason: it
records *where the credential of record lives*, so you can use WCC as the map
even where you are not allowed to use it as the safe. Check with your security
team before it becomes the safe.

---

Sources for the Microsoft side:

- [Plugins for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-plugins)
- [Build a plugin for a declarative agent from an MCP server](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/build-mcp-plugins)
- [Configure authentication for MCP and API plugins](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication)
- [Connect your agent to an existing MCP server (Copilot Studio)](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- [Connect to custom on-premises APIs using the data gateway](https://www.microsoft.com/en-us/power-platform/blog/power-automate/on-premise-apis/)
