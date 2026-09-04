# Syncing your Outlook calendar

WCC can pull your meetings in from Microsoft 365 so your diary and your notes
live in one place. There are two ways to connect, and which one you can use
depends on what your IT department allows. You can set up either from
**Calendars** in the sidebar.

Both routes feed the same sync engine, so everything under
[What syncing does](#what-syncing-does) is true either way.

---

## Route 1 — Published calendar link

**Needs nothing from IT.** Set it up yourself in about a minute.

1. Open Outlook on the web and go to
   **Settings → Calendar → Shared calendars**.
2. Under *Publish a calendar*, pick your calendar, choose
   **Can view all details**, and press **Publish**.
3. Copy the **ICS** link. Not the HTML one — that is a web page, and WCC will
   tell you so if you paste it by mistake.
4. In WCC: **Calendars → Connect a calendar**, leave the first option selected,
   paste the link, and save.
5. Press **Test** to see how many meetings it can read, then **Sync now**.

### What this route gives up

- The link is a secret URL. Anyone who has it can read your calendar, so treat
  it like a password and do not paste it into a ticket or a chat.
- Outlook refreshes a published feed on its own schedule, so a meeting added
  minutes ago may take a while to appear.
- No `joinUrl` field, so WCC finds the Teams link in the meeting body instead.
  It usually works; occasionally there is nothing to find.
- Some banks disable calendar publishing outright. If the option is not there,
  use route 2.

---

## Route 2 — Microsoft 365 sign-in

**Needs an app registration in your company's Entra ID** (formerly Azure AD).
Someone with directory access has to create it once; after that you sign in
with your own account and nothing is shared.

### What to ask for

> Please register an application in Entra ID for a personal productivity tool.
> It needs:
> - **Public client / native** — no client secret, no redirect URI to a server.
> - **Allow public client flows: Yes** (this enables device code sign-in).
> - Delegated Microsoft Graph permission **`Calendars.Read`** — read-only, and
>   only my own calendar.
> - No application permissions, and no admin consent for the whole tenant.
>
> I need the **Directory (tenant) ID** and the **Application (client) ID**.

That is the smallest set of rights that can do the job: delegated and
read-only, acting only as the person signed in. It cannot write to a calendar,
cannot see anyone else's, and there is no secret to leak.

### Setting it up in WCC

1. **Calendars → Connect a calendar**, choose *Microsoft 365 sign-in*.
2. Paste the tenant ID (or your domain, e.g. `contoso.onmicrosoft.com`) and the
   client ID.
3. Save, then press **Sign in**. WCC shows a short code.
4. Open **microsoft.com/devicelogin**, type the code, and sign in with your
   work account. The WCC window notices on its own.
5. Press **Sync now**.

Your password never reaches this app. What is stored is a refresh token,
encrypted at rest with a key held in the database (`WCC_SECRET_KEY` overrides
it if you would rather supply your own). **Sign out** discards the token and
keeps every meeting already synced.

---

## What syncing does

| | |
|---|---|
| **Your notes and decisions** | Never touched. Sync only writes calendar fields. |
| **A field you edit by hand** | Kept forever. The field is remembered and skipped on every future sync. |
| **A meeting removed from Outlook** | Marked *Cancelled* here. Never deleted — your notes on it survive. |
| **Deleting a synced meeting** | Refused. Cancel it in Outlook, or disconnect the calendar. |
| **Deleting a meeting you created** | Always allowed. |
| **Disconnecting a calendar** | Keeps every meeting and hands them back to you as ordinary WCC records. |

### The edit rule, concretely

Say Outlook gives a meeting the room `Conf-4-02-VC(HYB)` and you rename it to
`Room 4.02`. WCC records that you edited *location*. From then on:

- the **title** keeps tracking Outlook — rename the meeting there and it
  updates here;
- the **location** stays `Room 4.02`, however many times it syncs.

Open the meeting and you will see your edit listed under **Your edits**, with a
*release* control beside it. Releasing it lets that field follow Outlook again.

### Recurring meetings

A weekly stand-up arrives as one entry carrying a repeat rule, so WCC expands it
into individual meetings — one per date in the sync window. Each is separate, so
you can take notes on this week's without touching last week's. Cancelled single
occurrences are skipped, and a moved or extended one keeps its own time.

### Times and your timezone

Outlook publishes meeting times in **UTC**. WCC converts them once, on the way
in, to the clock you actually work by — set per calendar under
**Show meeting times in**. A new calendar defaults to whatever zone your browser
is set to, so this is usually right without being touched.

If it is wrong, a 10:30 meeting shows up at the UTC time instead: in Phnom Penh
(UTC+7) that reads as 03:30. The connection card says so plainly when no zone is
set, and offers to fix it.

**Changing the zone corrects meetings that are already stored.** Each one is
anchored back to the instant it stood for and read again in the new zone, so a
daylight-saving boundary in the middle of the range is handled per meeting
rather than by one flat offset. Two things are deliberately left alone: a time
you edited by hand (it is already the time you wanted), and an all-day entry
(it has no time of day, and shifting it would drag a holiday onto the evening
before).

`WCC_TIMEZONE` sets the fallback for any calendar with no zone of its own.

The stored times are wall-clock in that zone rather than UTC, which is what the
rest of WCC does for every date it holds. The trade-off is that they stay
anchored to that zone rather than following you abroad — for a work diary, that
is usually what you want.

### The sync window

Each connection syncs a window around today — 7 days back and 60 days ahead by
default, both adjustable. Meetings outside the window are **left exactly as they
are**: not refreshed, not cancelled, not removed. That is deliberate, so
narrowing the window can never look like data loss.

---

## Running it on a work laptop

Nothing here calls out to anything except Microsoft (or the URL you pasted).
The database stays on the machine running Docker. If you run WCC on both a home
and a work machine, each has its own database, so connect the calendar on
whichever one you actually use for work — or on both, and they will sync
independently.

If your company proxies outbound HTTPS, the backend container needs the usual
`HTTPS_PROXY` environment variable set for either route to reach the network.

---

## When something goes wrong

The connection card shows the error verbatim. The ones worth naming:

| Message | What it means |
|---|---|
| *That URL did not return a calendar* | You copied the HTML link, or the page behind it. Go back for the ICS one. |
| *The calendar URL returned 404* | Publishing was turned off, or the link was regenerated. Publish again and re-paste. |
| `AADSTS7000218` / *invalid_client* | The app registration does not allow public client flows. Ask for **Allow public client flows: Yes**. |
| `AADSTS65001` | Consent has not been given for `Calendars.Read`. Sign in again, or ask for consent. |
| `AADSTS50020` | The account signed in does not belong to that tenant. |
| *The stored sign-in could not be read* | `WCC_SECRET_KEY` changed. Press **Sign in** again. |
| Meetings are hours out | The calendar's timezone is unset or wrong. Fix **Show meeting times in**; meetings already synced are corrected with it. |
| *not a timezone this server recognises* | Use an IANA name such as `Asia/Phnom_Penh`, not an abbreviation like `ICT`. |

**Test** fetches without writing anything, so it is always safe to press while
you are working out which link is the right one.
