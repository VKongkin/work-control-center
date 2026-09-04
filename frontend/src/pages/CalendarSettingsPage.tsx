import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarCheck2, Check, Copy, ExternalLink, Link2, Plug, RefreshCw, Trash2,
  AlertTriangle, Building2, Rss,
} from 'lucide-react';
import { calendarApi, apiError } from '../api/client';
import { requestRefresh } from '../hooks/useResource';
import { useToast } from '../components/Toast';
import {
  Button, EmptyState, ErrorBanner, Modal, PageHeader, SelectField, Spinner, TextField,
} from '../components/ui';
import { CalendarConnection, DeviceCode } from '../types';
import { fmtDate } from '../lib/constants';

const PROVIDERS = [
  { value: 'ics', label: 'Published calendar link (no IT approval needed)' },
  { value: 'microsoft', label: 'Microsoft 365 sign-in (needs an app registration)' },
];

const BLANK = {
  provider: 'ics',
  display_name: 'My work calendar',
  ics_url: '',
  tenant_id: '',
  client_id: '',
  days_back: '7',
  days_ahead: '60',
};

export default function CalendarSettingsPage() {
  const toast = useToast();
  const [items, setItems] = useState<CalendarConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'new' | null>(null);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarConnection | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [formError, setFormError] = useState<string | null>(null);

  const [signIn, setSignIn] = useState<{ connection: CalendarConnection; code: DeviceCode } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await calendarApi.getAll();
      setItems(data as CalendarConnection[]);
      setError(null);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...BLANK });
    setFormError(null);
    setOpen(true);
  }

  function openEdit(row: CalendarConnection) {
    setEditing(row);
    setForm({
      provider: row.provider,
      display_name: row.display_name ?? '',
      ics_url: row.ics_url ?? '',
      tenant_id: row.tenant_id ?? '',
      client_id: row.client_id ?? '',
      days_back: String(row.days_back ?? 7),
      days_ahead: String(row.days_ahead ?? 60),
    });
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    setBusy('new');
    setFormError(null);
    const payload: any = {
      provider: form.provider,
      display_name: form.display_name.trim(),
      days_back: Number(form.days_back) || 7,
      days_ahead: Number(form.days_ahead) || 60,
    };
    if (form.provider === 'ics') payload.ics_url = form.ics_url.trim();
    else {
      payload.tenant_id = form.tenant_id.trim();
      payload.client_id = form.client_id.trim();
    }
    try {
      if (editing) await calendarApi.update(editing.id, payload);
      else await calendarApi.create(payload);
      toast.success(editing ? 'Calendar updated' : 'Calendar added');
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(apiError(err));
    } finally {
      setBusy(null);
    }
  }

  async function test(row: CalendarConnection) {
    setBusy(row.id);
    try {
      const { data } = await calendarApi.test(row.id);
      toast.success(
        data.found
          ? `Found ${data.found} meeting${data.found === 1 ? '' : 's'}${
              data.sample?.length ? `, starting with "${data.sample[0]}"` : ''
            }`
          : 'The calendar was reachable but had nothing in the window'
      );
    } catch (err) {
      toast.error(apiError(err));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function sync(row: CalendarConnection) {
    setBusy(row.id);
    try {
      const { data } = await calendarApi.sync(row.id);
      const s = data.summary ?? {};
      const parts = [
        s.created && `${s.created} new`,
        s.updated && `${s.updated} updated`,
        s.cancelled && `${s.cancelled} cancelled`,
        s.protected && `${s.protected} of your edits kept`,
      ].filter(Boolean);
      toast.success(parts.length ? `Synced: ${parts.join(', ')}` : 'Already up to date');
      requestRefresh('Meeting');
      await load();
    } catch (err) {
      toast.error(apiError(err));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: CalendarConnection) {
    setBusy(row.id);
    try {
      const { data } = await calendarApi.delete(row.id);
      toast.success(data?.detail ?? 'Calendar disconnected');
      requestRefresh('Meeting');
      await load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(null);
    }
  }

  async function beginSignIn(row: CalendarConnection) {
    setBusy(row.id);
    try {
      const { data } = await calendarApi.beginSignIn(row.id);
      setSignIn({ connection: row, code: data as DeviceCode });
    } catch (err) {
      toast.error(apiError(err));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function signOut(row: CalendarConnection) {
    setBusy(row.id);
    try {
      await calendarApi.signOut(row.id);
      toast.success('Signed out. Meetings already synced are kept.');
      await load();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendars"
        subtitle="Bring your Outlook meetings in, and keep your own edits"
        action={
          <Button variant="primary" onClick={openNew}>
            <Plug size={16} /> Connect a calendar
          </Button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <Spinner label="Loading calendars…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No calendar connected"
          hint="Sync your Outlook meetings so your diary and your notes live in one place. Meetings you create here stay yours; synced ones are kept up to date."
          action={
            <Button variant="primary" onClick={openNew}>
              <Plug size={16} /> Connect a calendar
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {items.map((row) => (
            <ConnectionCard
              key={row.id}
              row={row}
              busy={busy === row.id}
              onEdit={() => openEdit(row)}
              onTest={() => test(row)}
              onSync={() => sync(row)}
              onRemove={() => remove(row)}
              onSignIn={() => beginSignIn(row)}
              onSignOut={() => signOut(row)}
            />
          ))}
        </div>
      )}

      <HowTo />

      <Modal
        open={open}
        wide
        title={editing ? 'Edit calendar' : 'Connect a calendar'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy === 'new'}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy === 'new'}>
              {busy === 'new' ? 'Saving…' : editing ? 'Save changes' : 'Add calendar'}
            </Button>
          </>
        }
      >
        {formError && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            name="provider" label="How to connect" className="sm:col-span-2"
            value={form.provider}
            onChange={(v: string) => setForm({ ...form, provider: v })}
            options={PROVIDERS}
            hint={
              form.provider === 'ics'
                ? 'Outlook can publish your calendar to a private link. Nothing needs approving, and no password is shared.'
                : 'Signs you in with your work account. Needs a client ID from an app registration in your company tenant.'
            }
          />
          <TextField
            name="display_name" label="Name" className="sm:col-span-2"
            value={form.display_name}
            onChange={(v: string) => setForm({ ...form, display_name: v })}
            placeholder="Work calendar"
          />

          {form.provider === 'ics' ? (
            <TextField
              name="ics_url" label="Published calendar link" className="sm:col-span-2"
              value={form.ics_url}
              onChange={(v: string) => setForm({ ...form, ics_url: v })}
              placeholder="https://outlook.office365.com/owa/calendar/.../calendar.ics"
              hint="Outlook → Settings → Calendar → Shared calendars → Publish. Copy the ICS link, not the HTML one."
            />
          ) : (
            <>
              <TextField
                name="tenant_id" label="Tenant ID or domain"
                value={form.tenant_id}
                onChange={(v: string) => setForm({ ...form, tenant_id: v })}
                placeholder="contoso.onmicrosoft.com"
              />
              <TextField
                name="client_id" label="Application (client) ID"
                value={form.client_id}
                onChange={(v: string) => setForm({ ...form, client_id: v })}
                placeholder="00000000-0000-0000-0000-000000000000"
                hint="From the app registration in Entra ID."
              />
            </>
          )}

          <TextField
            name="days_back" label="Sync from (days back)"
            value={form.days_back}
            onChange={(v: string) => setForm({ ...form, days_back: v })}
          />
          <TextField
            name="days_ahead" label="Sync to (days ahead)"
            value={form.days_ahead}
            onChange={(v: string) => setForm({ ...form, days_ahead: v })}
            hint="Meetings outside this window are left exactly as they are."
          />
        </div>
      </Modal>

      {signIn && (
        <DeviceCodeDialog
          connection={signIn.connection}
          code={signIn.code}
          onDone={async (ok, message) => {
            setSignIn(null);
            if (ok) toast.success(message ?? 'Signed in');
            else if (message) toast.error(message);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ConnectionCard({
  row, busy, onEdit, onTest, onSync, onRemove, onSignIn, onSignOut,
}: {
  row: CalendarConnection;
  busy: boolean;
  onEdit: () => void;
  onTest: () => void;
  onSync: () => void;
  onRemove: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const microsoft = row.provider === 'microsoft';
  const signedIn = row.status === 'connected' || !!row.account;
  const needsSignIn = microsoft && !signedIn;

  const summary = (() => {
    if (!row.last_sync_summary) return null;
    try {
      const s = JSON.parse(row.last_sync_summary);
      const parts = [
        s.created && `${s.created} new`,
        s.updated && `${s.updated} updated`,
        s.cancelled && `${s.cancelled} cancelled`,
        s.protected && `${s.protected} of your edits kept`,
      ].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'no changes';
    } catch {
      return null;
    }
  })();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-slate-100 p-1.5 text-slate-600">
              {microsoft ? <Building2 size={16} /> : <Rss size={16} />}
            </span>
            <p className="font-semibold text-slate-900">{row.display_name}</p>
            <StatusPill status={row.status} needsSignIn={needsSignIn} />
          </div>
          <p className="mt-1.5 truncate text-sm text-slate-500">
            {microsoft
              ? row.account
                ? `Signed in as ${row.account}`
                : `${row.tenant_id ?? 'tenant'} · ${row.client_id ?? 'no client id'}`
              : row.ics_url}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {row.last_sync_at
              ? `Last synced ${fmtDate(row.last_sync_at)}${summary ? ` — ${summary}` : ''}`
              : 'Never synced'}
            {' · '}
            {row.days_back ?? 7} days back, {row.days_ahead ?? 60} ahead
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {needsSignIn ? (
            <Button variant="primary" onClick={onSignIn} disabled={busy}>
              <Link2 size={15} /> Sign in
            </Button>
          ) : (
            <Button variant="primary" onClick={onSync} disabled={busy}>
              <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Sync now
            </Button>
          )}
          <Button onClick={onTest} disabled={busy}>Test</Button>
          <Button onClick={onEdit} disabled={busy}>Edit</Button>
          {microsoft && signedIn && (
            <Button onClick={onSignOut} disabled={busy}>Sign out</Button>
          )}
          <Button
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="text-red-600 hover:bg-red-50"
            aria-label="Disconnect"
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>

      {row.status === 'error' && row.last_error && (
        <div className="mt-4 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{row.last_error}</span>
        </div>
      )}

      {confirming && (
        <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="font-medium">Disconnect {row.display_name}?</p>
          <p className="mt-1">
            Your meetings are kept — they simply become ordinary WCC meetings you can edit and
            delete freely. Nothing is removed.
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant="primary"
              className="!bg-red-600 hover:!bg-red-700"
              onClick={() => { setConfirming(false); onRemove(); }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status, needsSignIn }: { status?: string | null; needsSignIn: boolean }) {
  const map: Record<string, string> = {
    connected: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    error: 'bg-red-50 text-red-700 ring-red-200',
    not_connected: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  const label = needsSignIn ? 'Sign-in needed' : status === 'connected' ? 'Connected'
    : status === 'error' ? 'Error' : 'Not synced yet';
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${map[status ?? 'not_connected'] ?? map.not_connected}`}>
      {label}
    </span>
  );
}

/**
 * Device code sign-in.
 *
 * The user types a short code on Microsoft's own page, so this app never sees
 * their password and no redirect URI has to be registered - which matters on a
 * locked-down work laptop.
 */
function DeviceCodeDialog({
  connection, code, onDone,
}: {
  connection: CalendarConnection;
  code: DeviceCode;
  onDone: (ok: boolean, message?: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [seconds, setSeconds] = useState(code.expires_in ?? 900);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let interval = Math.max(3, code.interval ?? 5);

    const tick = async () => {
      if (stopped.current) return;
      try {
        const { data } = await calendarApi.pollSignIn(connection.id, code.device_code);
        if (stopped.current) return;
        if (data.pending) {
          if (data.slow_down) interval += 5;
          setTimeout(tick, interval * 1000);
          return;
        }
        setWaiting(false);
        onDone(true, data.account ? `Signed in as ${data.account}` : 'Signed in');
      } catch (err) {
        if (stopped.current) return;
        setWaiting(false);
        onDone(false, apiError(err));
      }
    };

    const timer = setTimeout(tick, interval * 1000);
    const countdown = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => {
      stopped.current = true;
      clearTimeout(timer);
      clearInterval(countdown);
    };
  }, [connection.id, code.device_code, code.interval]);

  const minutes = Math.floor(seconds / 60);

  return (
    <Modal
      open
      title="Sign in to Microsoft"
      onClose={() => onDone(false)}
      footer={<Button onClick={() => onDone(false)}>Cancel</Button>}
    >
      <ol className="space-y-4 text-sm text-slate-700">
        <li>
          <p className="font-medium text-slate-900">1. Open the sign-in page</p>
          <a
            href={code.verification_uri}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <ExternalLink size={15} /> {code.verification_uri.replace('https://', '')}
          </a>
        </li>
        <li>
          <p className="font-medium text-slate-900">2. Enter this code</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="rounded-lg bg-slate-100 px-4 py-2 font-mono text-xl tracking-[0.2em] text-slate-900">
              {code.user_code}
            </code>
            <Button
              onClick={() => {
                navigator.clipboard?.writeText(code.user_code);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </li>
        <li>
          <p className="font-medium text-slate-900">3. Sign in with your work account</p>
          <p className="mt-1 text-slate-600">
            This window notices automatically — leave it open.
          </p>
        </li>
      </ol>

      <div className="mt-5 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        {waiting && <RefreshCw size={15} className="animate-spin" />}
        <span>
          {waiting
            ? `Waiting for you to finish — the code expires in ${minutes || 1} minute${minutes === 1 ? '' : 's'}.`
            : 'Done.'}
        </span>
      </div>
    </Modal>
  );
}

function HowTo() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <CalendarCheck2 size={17} /> Which one should I use?
      </h2>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="font-medium text-slate-900">Published calendar link</p>
          <p className="mt-1 text-slate-600">
            Works today, on any laptop, with nothing to approve. In Outlook on the web:
            Settings → Calendar → Shared calendars → Publish a calendar, choose
            <em> Can view all details</em>, then copy the <strong>ICS</strong> link.
          </p>
          <p className="mt-2 text-slate-500">
            Some banks disable publishing. If the option is missing, use the sign-in route.
          </p>
        </div>
        <div>
          <p className="font-medium text-slate-900">Microsoft 365 sign-in</p>
          <p className="mt-1 text-slate-600">
            Richer detail and no shared link. Someone with access to Entra ID registers an
            application, enables <em>public client / device code flow</em>, and grants the
            delegated permission <code className="rounded bg-slate-100 px-1">Calendars.Read</code>.
            You then sign in here with your own account.
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="font-medium text-slate-900">What syncing will and will not do</p>
        <ul className="mt-2 space-y-1.5 text-slate-600">
          <li>• Your notes, decisions and contacts are never touched.</li>
          <li>• Any calendar field you edit by hand is kept, on every future sync.</li>
          <li>• A meeting removed from Outlook is marked cancelled here, never deleted.</li>
          <li>• Synced meetings cannot be deleted here; ones you create can.</li>
          <li>• Your password is never stored. Sign-in tokens are encrypted in the database.</li>
        </ul>
      </div>
    </div>
  );
}
