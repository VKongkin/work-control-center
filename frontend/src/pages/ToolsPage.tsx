import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Play, Pencil, Trash2, Star, Wrench, FileWarning, Files, Link2,
  RefreshCw, History,
} from 'lucide-react';
import { toolApi, toolFiles, apiError } from '../api/client';
import { Tool, ToolManifest } from '../types';
import { useResource, clean } from '../hooks/useResource';
import { useForm } from '../hooks/useForm';
import { useToast } from '../components/Toast';
import Attachments, { formatBytes } from '../components/Attachments';
import ImportFromLink from '../components/ImportFromLink';
import ToolHistory from '../components/ToolHistory';
import {
  Button, ConfirmDialog, EmptyState, ErrorBanner, ErrorSummary, Modal,
  PageHeader, SelectField, Spinner, TextAreaField, TextField,
} from '../components/ui';
import { maxLength, required } from '../lib/validators';

const RULES = {
  name: [required('Name'), maxLength(255, 'Name')],
};

const blank = { name: '', description: '', entry_path: 'index.html' };

export default function ToolsPage() {
  const params = useMemo(() => ({ limit: 200 }), []);
  const { items, loading, error, saving, refresh, create, update, remove } =
    useResource<Tool>(toolApi, 'Tool', params);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Tool | null>(null);
  const [managing, setManaging] = useState<Tool | null>(null);
  const [toDelete, setToDelete] = useState<Tool | null>(null);
  // null closed; {tool: null} importing a new tool; {tool} refreshing one.
  const [importing, setImporting] = useState<{ tool: Tool | null } | null>(null);
  const [tab, setTab] = useState<'files' | 'history'>('files');
  const [pulling, setPulling] = useState<number | null>(null);
  const [manifests, setManifests] = useState<Record<number, ToolManifest>>({});
  const form = useForm({ initial: blank, rules: RULES });

  /** Each tool's file list, so the card can say whether it will actually run. */
  const loadManifests = useCallback(async (tools: Tool[]) => {
    const entries = await Promise.all(
      tools.map(async (t) => {
        try {
          return [t.id, (await toolFiles.manifest(t.id)).data] as const;
        } catch {
          return [t.id, null] as const;
        }
      })
    );
    setManifests(Object.fromEntries(entries.filter(([, m]) => m)) as Record<number, ToolManifest>);
  }, []);

  useEffect(() => {
    if (items.length) loadManifests(items);
  }, [items, loadManifests]);

  function openNew() {
    setEditing(null);
    form.reset(blank);
    setOpen(true);
  }

  /**
   * The HTML files this tool actually has. Anything else cannot be an entry
   * point - the runner opens it in an iframe, and pointing that at a
   * stylesheet is a blank page and a confused half hour.
   */
  const entryOptions = useMemo(() => {
    const m = editing ? manifests[editing.id] : null;
    const paths = (m?.files ?? [])
      .map((f) => f.path)
      .filter((p) => /\.(html?|htm)$/i.test(p))
      .sort();
    // Keep whatever is currently recorded even if the file has gone, so
    // opening the form does not silently change the entry point.
    const current = editing?.entry_path;
    if (current && !paths.includes(current)) paths.unshift(current);
    return paths.map((p) => ({ value: p, label: p }));
  }, [editing, manifests]);

  function openEdit(t: Tool) {
    setEditing(t);
    form.reset({
      name: t.name,
      description: t.description ?? '',
      entry_path: t.entry_path ?? 'index.html',
    });
    setOpen(true);
  }

  async function submit() {
    const { ok, firstInvalid } = form.validate();
    if (!ok) {
      document.querySelector<HTMLElement>(`[role="dialog"] #f-${firstInvalid}`)?.focus();
      return;
    }
    const payload = clean({ ...form.values }) as Partial<Tool>;
    const result = editing ? await update(editing.id, payload) : await create(payload);
    if (result === true) {
      setOpen(false);
      // A brand new tool has no files yet, so go straight to uploading them.
      if (!editing) {
        const fresh = (await toolApi.getAll({ limit: 200 })).data as Tool[];
        const made = fresh.find((t) => t.name === form.values.name);
        if (made) setManaging(made);
      }
    } else if (typeof result === 'string') form.setServerError(result);
  }

  /**
   * Fetch the stored link again. Only ever on a click: a tool that re-pulled
   * itself would change under you mid-incident, which is the worst possible
   * moment for the page in front of you to become a different page.
   */
  async function pull(t: Tool) {
    setPulling(t.id);
    try {
      const { data } = await toolFiles.pull(t.id);
      const d = data.changes;
      const moved = d ? d.added.length + d.changed.length + d.removed.length : 0;
      toast.success(moved
        ? `${t.name} updated — ${moved} file${moved === 1 ? '' : 's'} changed, now v${data.version}`
        : `${t.name} is already up to date`);
      await refresh();
      const fresh = (await toolApi.getAll({ limit: 200 })).data as Tool[];
      loadManifests(fresh);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setPulling(null);
    }
  }

  async function togglePin(t: Tool) {
    const done = await update(t.id, { pinned: !t.pinned } as Partial<Tool>, true);
    if (done === true) toast.success(t.pinned ? 'Unpinned' : 'Pinned to the sidebar');
  }

  const set = (k: keyof typeof blank) => (v: string) => form.setField(k as string, v);
  const fx = (k: keyof typeof blank) => ({
    name: k as string,
    error: form.errors[k as string],
    onBlur: () => form.blur(k as string),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tools"
        subtitle="Small web apps you have built, running in place"
        action={
          <div className="flex gap-2">
            <Button onClick={() => setImporting({ tool: null })} id="import-tool">
              <Link2 size={16} /> Import from link
            </Button>
            <Button variant="primary" onClick={openNew}>
              <Plus size={16} /> New Tool
            </Button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {loading ? (
        <Spinner label="Loading tools…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No tools yet"
          hint="Paste a repository link, or upload a folder containing index.html and its assets."
          action={
            <div className="flex justify-center gap-2">
              <Button onClick={() => setImporting({ tool: null })}>
                <Link2 size={16} /> Import from link
              </Button>
              <Button variant="primary" onClick={openNew}>
                <Plus size={16} /> New Tool
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((t) => {
            const m = manifests[t.id];
            const runnable = m?.runnable;
            return (
              <div
                key={t.id}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <Wrench size={17} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{t.name}</p>
                      <p className="text-xs text-slate-500">
                        {m ? `${m.file_count} file${m.file_count === 1 ? '' : 's'} · ${formatBytes(m.total_bytes)}` : '—'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => togglePin(t)}
                    aria-label={t.pinned ? `Unpin ${t.name}` : `Pin ${t.name}`}
                    className={`rounded-lg p-1.5 transition-colors ${
                      t.pinned ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'
                    }`}
                  >
                    <Star size={16} fill={t.pinned ? 'currentColor' : 'none'} />
                  </button>
                </div>

                {t.description && (
                  <p className="mt-3 line-clamp-2 text-sm text-slate-600">{t.description}</p>
                )}

                {t.source_url && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Link2 size={11} className="shrink-0" />
                    <span className="truncate" title={t.source_url}>{t.source_url}</span>
                    {t.source_ref && (
                      <span className="shrink-0 rounded bg-slate-100 px-1 font-mono text-slate-500">
                        {t.source_ref}
                      </span>
                    )}
                  </p>
                )}

                {m && !runnable && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                    <FileWarning size={14} className="mt-px shrink-0" />
                    No HTML file yet — upload one to run this.
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-1.5 pt-1">
                  {runnable ? (
                    <Link
                      to={`/tools/${t.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      <Play size={14} /> Open
                    </Link>
                  ) : (
                    <Button variant="primary" onClick={() => { setTab('files'); setManaging(t); }}>
                      <Files size={14} /> Add files
                    </Button>
                  )}
                  <Button onClick={() => { setTab('files'); setManaging(t); }}
                    aria-label={`Files of ${t.name}`}>
                    <Files size={14} /> Files
                  </Button>
                  {t.source_url && (
                    <Button
                      onClick={() => pull(t)}
                      disabled={pulling === t.id}
                      aria-label={`Pull ${t.name}`}
                      data-pull={t.id}
                      title={`Fetch ${t.source_url} again`}
                    >
                      <RefreshCw size={14} className={pulling === t.id ? 'animate-spin' : ''} />
                      {pulling === t.id ? 'Pulling…' : 'Pull'}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => openEdit(t)} aria-label={`Edit ${t.name}`}>
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost" onClick={() => setToDelete(t)} aria-label={`Delete ${t.name}`}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Details */}
      <Modal
        open={open}
        dirty={form.isDirty && !saving}
        title={editing ? 'Edit tool' : 'New tool'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create tool'}
            </Button>
          </>
        }
      >
        <ErrorSummary errors={form.errorList} serverError={form.serverError} />
        <div className="grid grid-cols-1 gap-4">
          <TextField
            {...fx('name')} label="Name" required value={form.values.name}
            onChange={set('name')} placeholder="Subnet Helper"
          />
          <TextAreaField
            {...fx('description')} label="Description" value={form.values.description}
            onChange={set('description')} placeholder="What it does, and when you reach for it"
          />
          {/* A picker, not a text box. Typing this by hand meant a typo
              produced a tool that would not run and said nothing about why,
              and there is no reason to allow naming a file that is not
              there. Before any files exist there is nothing to pick from, so
              it falls back to the box. */}
          {editing && entryOptions.length > 0 ? (
            <SelectField
              {...fx('entry_path')}
              label="Entry file"
              value={form.values.entry_path}
              onChange={set('entry_path')}
              options={entryOptions}
              placeholder="— pick the page that opens —"
              hint={entryOptions.length === 1
                ? 'The only page in this tool.'
                : `${entryOptions.length} pages in this tool. Usually index.html.`}
            />
          ) : (
            <TextField
              {...fx('entry_path')} label="Entry file" value={form.values.entry_path}
              onChange={set('entry_path')}
              hint={editing
                ? 'No files uploaded yet, so there is nothing to choose from.'
                : 'Which file opens when the tool runs. Usually index.html.'}
            />
          )}
        </div>
      </Modal>

      {/* Files */}
      <Modal
        open={!!managing}
        wide
        title={managing ? `${managing.name}` : 'Files'}
        onClose={() => { setManaging(null); if (items.length) loadManifests(items); }}
        footer={
          <Button
            variant="primary"
            onClick={() => { setManaging(null); if (items.length) loadManifests(items); }}
          >
            Done
          </Button>
        }
      >
        <div className="mb-4 flex items-center gap-1 border-b border-slate-200">
          {(['files', 'history'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              data-tab={k}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
                tab === k
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {k === 'history' ? <History size={14} className="mr-1 inline" /> : null}
              {k}
            </button>
          ))}
          {managing && (
            <div className="ml-auto flex gap-2 pb-1.5">
              {managing.source_url && (
                <Button
                  className="!py-1 !text-xs"
                  disabled={pulling === managing.id}
                  onClick={() => pull(managing)}
                >
                  <RefreshCw size={13} className={pulling === managing.id ? 'animate-spin' : ''} />
                  Pull
                </Button>
              )}
              <Button
                className="!py-1 !text-xs"
                id="refresh-from-link"
                onClick={() => { const x = managing; setManaging(null); setImporting({ tool: x }); }}
              >
                <Link2 size={13} /> {managing.source_url ? 'Change link' : 'From a link'}
              </Button>
            </div>
          )}
        </div>

        {tab === 'files' ? (
          <>
            <p className="mb-4 text-sm text-slate-600">
              Choose the folder containing <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">index.html</code>.
              Its structure is preserved, so relative links to CSS, JS and images keep working.
            </p>
            {managing && (
              <Attachments
                entityType="tool"
                entityId={managing.id}
                allowFolder
                onChange={() => { if (items.length) loadManifests(items); }}
              />
            )}
          </>
        ) : (
          managing && (
            <ToolHistory
              tool={managing}
              onChanged={() => { if (items.length) loadManifests(items); refresh(); }}
            />
          )
        )}
      </Modal>

      <ImportFromLink
        open={!!importing}
        tool={importing?.tool ?? null}
        onClose={() => setImporting(null)}
        onImported={async () => {
          await refresh();
          const fresh = (await toolApi.getAll({ limit: 200 })).data as Tool[];
          loadManifests(fresh);
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Delete tool"
        message={`"${toDelete?.name}" and all of its files will be permanently removed.`}
        busy={saving}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await remove(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
