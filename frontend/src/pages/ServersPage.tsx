import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ChevronRight, Copy, Eye, EyeOff, FolderSync, History, KeyRound,
  Monitor, Pencil, Plus, Search, Server as ServerIcon, Terminal, Trash2, X,
} from 'lucide-react';
import { serverApi, apiError } from '../api/client';
import { useToast } from '../components/Toast';
import { useLookups } from '../hooks/useLookups';
import { useForm } from '../hooks/useForm';
import {
  Button, ConfirmDialog, EmptyState, ErrorBanner, ErrorSummary, Modal, PageHeader,
  SelectField, Spinner, TextAreaField, TextField,
} from '../components/ui';
import { ServerAccount, SecretAccessEntry, Server, VaultStatus, ConnectMethod } from '../types';
import { copyText, downloadText } from '../lib/clipboard';
import {
  GroupBy, ServerGroup, envTone, groupServers,
} from '../lib/serverGroups';
import { fmtDate } from '../lib/constants';
import { maxLength, required } from '../lib/validators';

const ENVIRONMENTS = [
  { value: 'DC', label: 'DC — primary' },
  { value: 'DR', label: 'DR — standby' },
  { value: 'UAT', label: 'UAT' },
  { value: 'SIT', label: 'SIT' },
  { value: 'DEV', label: 'DEV' },
  { value: 'OTHER', label: 'Other' },
];

const ACCOUNT_TYPES = [
  { value: 'AD', label: 'AD / domain' },
  { value: 'LOCAL', label: 'Local' },
  { value: 'SERVICE', label: 'Service account' },
  // The WebSphere/MQ/Tomcat console logins, which are neither a domain user
  // nor a Unix account and were otherwise getting filed under "Other".
  { value: 'APPLICATION', label: 'Application console' },
  { value: 'DATABASE', label: 'Database' },
  { value: 'APPLIANCE', label: 'Appliance' },
  { value: 'OTHER', label: 'Other' },
];

const blankServer = {
  name: '', hostname: '', ip_address: '', environment: 'DC', os: '', role: '',
  ssh_port: '', rdp_port: '', system_id: '', notes: '',
};

/** Which clients to offer, and in what order, for a given box. */
const CONNECTIONS: { method: ConnectMethod; label: string; hint: string; Icon: any }[] = [
  { method: 'rdp', label: 'Remote Desktop', hint: 'Windows', Icon: Monitor },
  { method: 'sftp', label: 'WinSCP', hint: 'files', Icon: FolderSync },
  { method: 'ssh', label: 'MobaXterm', hint: 'shell', Icon: Terminal },
];

/** A Windows box leads with RDP; anything else leads with a shell. */
function connectionsFor(server: Server) {
  const windows = /win/i.test(server.os ?? '');
  return windows ? CONNECTIONS : [...CONNECTIONS.slice(1), CONNECTIONS[0]];
}
const blankAccount = {
  username: '', account_type: 'LOCAL', purpose: '', vault_location: '', notes: '',
};

export default function ServersPage() {
  const toast = useToast();
  const lk = useLookups();

  const [servers, setServers] = useState<Server[]>([]);
  const [accounts, setAccounts] = useState<Record<number, ServerAccount[]>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();
  const groupBy = ((params.get('group') as GroupBy) || 'service');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function setGroupBy(next: GroupBy) {
    const out: Record<string, string> = {};
    if (next !== 'service') out.group = next;
    setParams(out, { replace: true });
    setCollapsed(new Set());
  }

  const [serverOpen, setServerOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [toDelete, setToDelete] = useState<Server | null>(null);
  const serverForm = useForm({
    initial: blankServer,
    rules: { name: [required('Name'), maxLength(255, 'Name')] },
  });

  const [accountFor, setAccountFor] = useState<Server | null>(null);
  const [editingAccount, setEditingAccount] = useState<ServerAccount | null>(null);
  const accountForm = useForm({
    initial: blankAccount,
    rules: { username: [required('Username'), maxLength(255, 'Username')] },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, status] = await Promise.all([
        serverApi.getAll({ limit: 500 }),
        serverApi.vaultStatus(),
      ]);
      setServers(rows.data as Server[]);
      setVault(status.data);
      setError(null);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadAccounts = useCallback(async (serverId: number) => {
    try {
      const { data } = await serverApi.accounts(serverId);
      setAccounts((prev) => ({ ...prev, [serverId]: data }));
    } catch (err) {
      toast.error(apiError(err));
    }
  }, [toast]);

  function toggle(server: Server) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(server.id)) next.delete(server.id);
      else { next.add(server.id); loadAccounts(server.id); }
      return next;
    });
  }

  /* ------------------------------------------------------------- servers */

  function openNewServer() {
    setEditingServer(null);
    serverForm.reset(blankServer);
    setServerOpen(true);
  }

  function openEditServer(s: Server) {
    setEditingServer(s);
    serverForm.reset({
      name: s.name, hostname: s.hostname ?? '', ip_address: s.ip_address ?? '',
      environment: s.environment, os: s.os ?? '', role: s.role ?? '',
      ssh_port: s.ssh_port ? String(s.ssh_port) : '',
      rdp_port: s.rdp_port ? String(s.rdp_port) : '',
      system_id: s.system_id ? String(s.system_id) : '', notes: s.notes ?? '',
    });
    setServerOpen(true);
  }

  async function saveServer() {
    const { ok } = serverForm.validate();
    if (!ok) return;
    const v = serverForm.values as typeof blankServer;
    const payload = {
      ...v,
      system_id: v.system_id ? Number(v.system_id) : null,
      hostname: v.hostname || null, ip_address: v.ip_address || null,
      os: v.os || null, role: v.role || null, notes: v.notes || null,
      // Blank means "the usual one", which is stored as null so the connect
      // links can leave the port out of the URL entirely.
      ssh_port: v.ssh_port ? Number(v.ssh_port) : null,
      rdp_port: v.rdp_port ? Number(v.rdp_port) : null,
    };
    try {
      if (editingServer) await serverApi.update(editingServer.id, payload as any);
      else await serverApi.create(payload as any);
      toast.success(editingServer ? 'Server updated' : 'Server added');
      setServerOpen(false);
      await load();
    } catch (err) {
      serverForm.setServerError(apiError(err));
    }
  }

  /* ------------------------------------------------------------ accounts */

  function openNewAccount(server: Server) {
    setAccountFor(server);
    setEditingAccount(null);
    accountForm.reset(blankAccount);
  }

  function openEditAccount(server: Server, account: ServerAccount) {
    setAccountFor(server);
    setEditingAccount(account);
    accountForm.reset({
      username: account.username, account_type: account.account_type,
      purpose: account.purpose ?? '', vault_location: account.vault_location ?? '',
      notes: account.notes ?? '',
    });
  }

  async function saveAccount() {
    const { ok } = accountForm.validate();
    if (!ok || !accountFor) return;
    const v = accountForm.values as typeof blankAccount;
    const payload = {
      ...v, purpose: v.purpose || null,
      vault_location: v.vault_location || null, notes: v.notes || null,
    };
    try {
      if (editingAccount) await serverApi.updateAccount(editingAccount.id, payload as any);
      else await serverApi.addAccount(accountFor.id, payload as any);
      toast.success(editingAccount ? 'Account updated' : 'Account added');
      await loadAccounts(accountFor.id);
      setAccountFor(null);
    } catch (err) {
      accountForm.setServerError(apiError(err));
    }
  }

  const visible = servers.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return q.split(/\s+/).every((word) =>
      [s.name, s.hostname, s.ip_address, s.role, s.os, s.notes]
        .some((v) => (v ?? '').toLowerCase().includes(word)));
  });

  // Recomputed only when something that affects it changes: with a few hundred
  // servers this runs on every keystroke in the search box otherwise.
  const groups = useMemo(
    () => groupServers(visible, groupBy, (id) => lk.nameOf('systems', id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible.map((s) => s.id).join(','), groupBy, lk.systems]
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Servers"
        subtitle="What runs where, which accounts exist, and where their credentials live"
        action={
          <Button variant="primary" onClick={openNewServer}>
            <Plus size={16} /> New Server
          </Button>
        }
      />

      {vault && <VaultNotice status={vault} />}
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          id="server-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, hostname, IP, role…"
          aria-label="Search servers"
          className="block w-full rounded-lg border-0 py-2 pl-9 pr-8 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Group by</span>
        {([
          ['service', 'Service'],
          ['environment', 'Environment'],
          ['role', 'What it runs'],
        ] as [GroupBy, string][]).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setGroupBy(value)}
            aria-pressed={groupBy === value}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
              groupBy === value
                ? 'bg-blue-50 text-blue-800 ring-blue-200'
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">
          {visible.length === servers.length
            ? `${servers.length} servers in ${groups.length} groups`
            : `${visible.length} of ${servers.length} servers`}
        </span>
      </div>

      {loading ? (
        <Spinner label="Loading servers…" />
      ) : (
        <div data-list className="space-y-6">
          {groups.length === 0 ? (
            <EmptyState
              title={servers.length ? 'Nothing matches' : 'No servers recorded'}
              hint={servers.length
                ? 'Try a shorter search.'
                : 'Record the boxes you look after, their accounts, and where each credential actually lives.'}
              action={!servers.length && (
                <Button variant="primary" onClick={openNewServer}>
                  <Plus size={16} /> New Server
                </Button>
              )}
            />
          ) : groups.map((g) => (
            <section key={g.key}>
              <GroupHeader
                group={g}
                collapsed={collapsed.has(g.key)}
                onToggle={() => setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.key)) next.delete(g.key); else next.add(g.key);
                  return next;
                })}
              />
              <div hidden={collapsed.has(g.key)}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <ul className="divide-y divide-slate-100">
                  {g.items.map((s) => (
                    <li key={s.id} data-row-id={s.id} className="group">
                      <ServerRow
                        server={s}
                        open={expanded.has(s.id)}
                        systemName={lk.nameOf('systems', s.system_id)}
                        showSystem={groupBy !== 'service'}
                        accountCount={accounts[s.id]?.length}
                        onToggle={() => toggle(s)}
                        onEdit={() => openEditServer(s)}
                        onDelete={() => setToDelete(s)}
                      />
                      {expanded.has(s.id) && (
                        <Accounts
                          server={s}
                          rows={accounts[s.id]}
                          vault={vault}
                          onAdd={() => openNewAccount(s)}
                          onEdit={(a) => openEditAccount(s, a)}
                          onChanged={() => loadAccounts(s.id)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------ server form */}
      <Modal
        open={serverOpen}
        wide
        dirty={serverForm.isDirty}
        title={editingServer ? 'Edit server' : 'New server'}
        onClose={() => setServerOpen(false)}
        footer={
          <>
            <Button onClick={() => setServerOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveServer}>
              {editingServer ? 'Save changes' : 'Create server'}
            </Button>
          </>
        }
      >
        <ErrorSummary errors={serverForm.errorList} serverError={serverForm.serverError} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField name="name" label="Name" required className="sm:col-span-2"
            value={serverForm.values.name} onChange={(v: string) => serverForm.setField('name', v)}
            error={serverForm.errors.name} onBlur={() => serverForm.blur('name')}
            placeholder="MBS-APP-01" />
          <TextField name="hostname" label="Hostname"
            value={serverForm.values.hostname} onChange={(v: string) => serverForm.setField('hostname', v)}
            placeholder="mbsapp01.bank.local" />
          <TextField name="ip_address" label="IP address"
            value={serverForm.values.ip_address} onChange={(v: string) => serverForm.setField('ip_address', v)} />
          <SelectField name="environment" label="Environment" options={ENVIRONMENTS}
            value={serverForm.values.environment}
            onChange={(v: string) => serverForm.setField('environment', v)} />
          <SelectField name="system_id" label="System" options={lk.systems} placeholder="None"
            value={serverForm.values.system_id}
            onChange={(v: string) => serverForm.setField('system_id', v)} />
          <TextField name="os" label="Operating system"
            value={serverForm.values.os} onChange={(v: string) => serverForm.setField('os', v)}
            placeholder="RHEL 8.6" />
          <TextField name="role" label="What it runs"
            value={serverForm.values.role} onChange={(v: string) => serverForm.setField('role', v)}
            placeholder="WebSphere ND 9.0.5" />
          <TextField name="ssh_port" label="SSH port" type="number"
            value={serverForm.values.ssh_port}
            onChange={(v: string) => serverForm.setField('ssh_port', v)}
            placeholder="22" hint="Only if it is not 22." />
          <TextField name="rdp_port" label="RDP port" type="number"
            value={serverForm.values.rdp_port}
            onChange={(v: string) => serverForm.setField('rdp_port', v)}
            placeholder="3389" hint="Only if it is not 3389." />
          <TextAreaField name="notes" label="Notes" className="sm:col-span-2"
            value={serverForm.values.notes} onChange={(v: string) => serverForm.setField('notes', v)} />
        </div>
      </Modal>

      {/* ----------------------------------------------------- account form */}
      <Modal
        open={!!accountFor}
        wide
        dirty={accountForm.isDirty}
        title={editingAccount ? 'Edit account' : `New account on ${accountFor?.name ?? ''}`}
        onClose={() => setAccountFor(null)}
        footer={
          <>
            <Button onClick={() => setAccountFor(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveAccount}>
              {editingAccount ? 'Save changes' : 'Add account'}
            </Button>
          </>
        }
      >
        <ErrorSummary errors={accountForm.errorList} serverError={accountForm.serverError} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField name="username" label="Username" required
            value={accountForm.values.username}
            onChange={(v: string) => accountForm.setField('username', v)}
            error={accountForm.errors.username} onBlur={() => accountForm.blur('username')}
            placeholder="svc_mbs_app" />
          <SelectField name="account_type" label="Type" options={ACCOUNT_TYPES}
            value={accountForm.values.account_type}
            onChange={(v: string) => accountForm.setField('account_type', v)} />
          <TextField name="purpose" label="What it is for" className="sm:col-span-2"
            value={accountForm.values.purpose}
            onChange={(v: string) => accountForm.setField('purpose', v)}
            placeholder="Runs the WAS node agent" />
          <TextField name="vault_location" label="Where the credential lives" className="sm:col-span-2"
            value={accountForm.values.vault_location}
            onChange={(v: string) => accountForm.setField('vault_location', v)}
            placeholder="CyberArk safe MW-PROD"
            hint="The system of record for this password — a vault safe, a team manager, a person to ask." />
          <TextAreaField name="notes" label="Notes" className="sm:col-span-2"
            value={accountForm.values.notes}
            onChange={(v: string) => accountForm.setField('notes', v)} />
        </div>
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          The password itself is set separately, from the account row — so editing
          a username can never carry one along by accident.
        </p>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete server"
        confirmLabel="Delete"
        message={`"${toDelete?.name}" and the accounts recorded on it will be removed. The credential access log is kept.`}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await serverApi.delete(toDelete.id);
            toast.success('Server deleted');
            await load();
          } catch (err) {
            toast.error(apiError(err));
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}

/** Says plainly whether this install can hold passwords at all. */
function VaultNotice({ status }: { status: VaultStatus }) {
  if (status.configured) return null;
  return (
    <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">Password storage is off</p>
        <p className="mt-1">
          No <code className="rounded bg-amber-100 px-1">{status.env_var}</code> is set, so
          passwords cannot be stored here. Everything else works — servers, accounts,
          account types, and where each credential actually lives.
        </p>
        <p className="mt-1 text-amber-800">
          Set that variable to a key kept somewhere other than the database and
          restart to turn it on. Check your company's policy on credential storage first.
        </p>
      </div>
    </div>
  );
}

function GroupHeader({
  group, collapsed, onToggle,
}: {
  group: ServerGroup;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Show' : 'Hide'} ${group.label}`}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-blue-700"
      >
        <ChevronRight size={15}
          className={`text-slate-400 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        {group.label}
      </button>

      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
        {group.items.length} {group.items.length === 1 ? 'node' : 'nodes'}
      </span>

      {/* Where those nodes live, without having to open the group. */}
      {group.envCounts.map(({ env, count }) => (
        <span key={env}
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${envTone(env)}`}>
          {env} {count}
        </span>
      ))}

      {/* Says the grouping is a guess from the role, so it is obvious which
          servers still need a system assigning in the Directory. */}
      {group.derived && (
        <span className="text-[11px] italic text-slate-400">grouped by what it runs</span>
      )}
    </div>
  );
}

function ServerRow({
  server, open, systemName, showSystem, accountCount, onToggle, onEdit, onDelete,
}: {
  server: Server;
  open: boolean;
  systemName: string;
  showSystem: boolean;
  accountCount?: number;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // The system is the group heading when grouping by service, so repeating it
  // on every row is noise. The role is not repeated either when it *is* the
  // heading - see `showSystem`.
  const meta = [
    server.hostname, server.ip_address, server.os, server.role,
    showSystem && systemName !== '—' ? systemName : null,
  ].filter(Boolean);

  return (
    <div className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/80">
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} accounts on ${server.name}`}
        className="mt-0.5 rounded p-0.5 text-slate-400 hover:text-slate-700"
      >
        <ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <ServerIcon size={16} className="mt-0.5 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onToggle} className="text-left text-sm font-medium text-slate-900 hover:text-blue-700">
            {server.name}
          </button>
          {/* Now that the group is a service, the environment has to be on the
              row - it is the difference between the live box and the standby. */}
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${envTone(server.environment)}`}>
            {server.environment}
          </span>
          {accountCount !== undefined && accountCount > 0 && (
            <span className="text-[11px] text-slate-400">
              {accountCount} {accountCount === 1 ? 'account' : 'accounts'}
            </span>
          )}
        </div>
        {meta.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-slate-500">{meta.join(' · ')}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button onClick={onEdit} aria-label="Edit"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          <Pencil size={15} />
        </button>
        <button onClick={onDelete} aria-label="Delete"
          className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-50 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function Accounts({
  server, rows, vault, onAdd, onEdit, onChanged,
}: {
  server: Server;
  rows?: ServerAccount[];
  vault: VaultStatus | null;
  onAdd: () => void;
  onEdit: (a: ServerAccount) => void;
  onChanged: () => void;
}) {
  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 pl-12">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Accounts on {server.name}
        </p>
        <Button onClick={onAdd} className="!py-1 !text-xs">
          <Plus size={13} /> Add account
        </Button>
      </div>
      {rows === undefined ? (
        <p className="py-2 text-xs text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-xs text-slate-500">
          No accounts recorded yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((a) => (
            <AccountRow key={a.id} account={a} vault={vault} server={server}
              onEdit={() => onEdit(a)} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountRow({
  account, vault, server, onEdit, onChanged,
}: {
  account: ServerAccount;
  vault: VaultStatus | null;
  server: Server;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setting, setSetting] = useState(false);
  const [draft, setDraft] = useState('');
  const [log, setLog] = useState<SecretAccessEntry[] | null>(null);
  const [connecting, setConnecting] = useState<ConnectMethod | null>(null);
  const [pasteMe, setPasteMe] = useState<string | null>(null);

  /**
   * Open this account in a desktop client.
   *
   * The password goes to the clipboard and nowhere else. It cannot go in the
   * .rdp file - Windows only accepts a DPAPI blob encrypted on the machine
   * that will use it - and it must not go in the sftp:// URL, because the
   * browser writes navigated URLs to history. One paste is the honest cost.
   */
  async function connect(method: ConnectMethod) {
    setConnecting(method);
    try {
      const { data } = await serverApi.connect(account.id, method);

      let copied = false;
      if (data.secret) {
        copied = await copyText(data.secret);
        if (!copied) setPasteMe(data.secret);   // clipboard blocked - show it
      }

      if (data.launch.kind === 'file') {
        downloadText(data.launch.filename, data.launch.content, data.launch.mime);
      } else {
        // A protocol handler that is not registered simply does nothing, so
        // this cannot navigate the page away from WCC.
        window.location.href = data.launch.value;
      }

      const where = `${data.host}${data.port_is_default ? '' : ':' + data.port}`;
      if (data.secret && copied) {
        toast.success(`${data.label}: password copied — paste it when asked (${where})`);
      } else if (data.secret_error) {
        toast.error(`Opening ${data.label} without a password: ${data.secret_error}`);
      } else if (data.secret) {
        toast.success(`${data.label} opening. The clipboard is blocked, so the password is shown below.`);
      } else {
        toast.success(`${data.label} opening for ${data.username} at ${where}. No password is stored here.`);
      }
      onChanged();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setConnecting(null);
    }
  }

  // Shown only when the clipboard refused, and only for as long as a reveal.
  useEffect(() => {
    if (!pasteMe) return;
    const t = setTimeout(() => setPasteMe(null), 60000);
    return () => clearTimeout(t);
  }, [pasteMe]);

  // A revealed password does not sit on screen indefinitely. Nothing stops
  // someone copying it, but it should not still be there after a coffee.
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), 60000);
    return () => clearTimeout(t);
  }, [revealed]);

  async function reveal() {
    setBusy(true);
    try {
      const { data } = await serverApi.reveal(account.id, 'viewed in Servers');
      setRevealed(data.secret);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await serverApi.setSecret(account.id, draft || null);
      toast.success(draft ? 'Password stored' : 'Password cleared');
      setDraft('');
      setSetting(false);
      onChanged();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function showLog() {
    if (log) { setLog(null); return; }
    try {
      const { data } = await serverApi.accessLog(account.id);
      setLog(data);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-slate-900">{account.username}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
          account.account_type === 'AD'
            ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
            : 'bg-slate-100 text-slate-600 ring-slate-200'
        }`}>
          {account.account_type}
        </span>
        {account.purpose && <span className="text-xs text-slate-500">{account.purpose}</span>}

        <div className="ml-auto flex items-center gap-1">
          {account.has_secret ? (
            <Button
              onClick={() => (revealed ? setRevealed(null) : reveal())}
              disabled={busy || !account.secret_readable}
              title={account.secret_readable ? undefined : 'The vault key has changed or is missing'}
              className="!py-1 !text-xs"
            >
              {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
              {revealed ? 'Hide' : 'Reveal'}
            </Button>
          ) : (
            <span className="text-xs text-slate-400">no password stored</span>
          )}
          <Button onClick={() => setSetting((v) => !v)} disabled={!vault?.configured}
            title={vault?.configured ? undefined : 'Password storage is off on this install'}
            className="!py-1 !text-xs">
            <KeyRound size={13} /> {account.has_secret ? 'Change' : 'Set'}
          </Button>
          <button onClick={showLog} aria-label="Access log"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <History size={14} />
          </button>
          <button onClick={onEdit} aria-label="Edit account"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Pencil size={14} />
          </button>
        </div>
      </div>

      {/* One click to the client, for the thing this is actually for: getting
          onto the box at two in the morning without hunting for a hostname. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {connectionsFor(server).map(({ method, label, hint, Icon }) => (
          <button
            key={method}
            onClick={() => connect(method)}
            disabled={connecting !== null}
            title={`Open ${label} for ${account.username} on ${server.hostname || server.ip_address || server.name}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-50"
          >
            <Icon size={13} />
            {connecting === method ? 'Opening…' : label}
            <span className="text-slate-400">{hint}</span>
          </button>
        ))}
        {account.has_secret && (
          <span className="text-[11px] text-slate-400">
            password is copied for you
          </span>
        )}
      </div>

      {pasteMe && (
        <div className="mt-2 rounded-lg bg-amber-50 p-2 ring-1 ring-inset ring-amber-200">
          <p className="text-[11px] font-medium text-amber-800">
            The clipboard is not available on this page, so copy it by hand:
          </p>
          <code className="mt-1 block select-all break-all font-mono text-sm text-slate-900">
            {pasteMe}
          </code>
        </div>
      )}

      {account.vault_location && (
        <p className="mt-1 text-xs text-slate-500">
          Credential of record: <span className="text-slate-700">{account.vault_location}</span>
        </p>
      )}

      {revealed && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2">
          <code className="flex-1 select-all font-mono text-sm text-emerald-300">{revealed}</code>
          <button
            onClick={async () => {
              const ok = await copyText(revealed);
              if (ok) toast.success('Copied');
              else toast.error('The clipboard is blocked on this page — select the text instead.');
            }}
            aria-label="Copy password"
            className="rounded p-1 text-slate-400 hover:text-white"
          >
            <Copy size={14} />
          </button>
        </div>
      )}
      {revealed && (
        <p className="mt-1 text-[11px] text-slate-400">
          This reveal was recorded, and hides itself after a minute.
        </p>
      )}

      {setting && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New password — leave blank to clear"
            aria-label={`Password for ${account.username}`}
            className="min-w-[14rem] flex-1 rounded-lg border-0 px-3 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-blue-600"
          />
          <Button variant="primary" onClick={save} disabled={busy} className="!py-1 !text-xs">
            Save
          </Button>
          <Button onClick={() => { setSetting(false); setDraft(''); }} className="!py-1 !text-xs">
            Cancel
          </Button>
        </div>
      )}

      {log && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Access log
          </p>
          {log.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {log.map((e) => (
                <li key={e.id} className="text-xs text-slate-600">
                  <span className={`font-medium ${
                    e.action === 'REVEAL' ? 'text-amber-700'
                      : e.action === 'DENIED' ? 'text-red-600' : 'text-slate-700'
                  }`}>{e.action}</span>
                  {' · '}{fmtDate(e.at)}
                  {e.detail ? ` · ${e.detail}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
