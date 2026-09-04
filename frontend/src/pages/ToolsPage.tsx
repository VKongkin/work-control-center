import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Play, Pencil, Trash2, Star, Wrench, FileWarning, Files,
} from 'lucide-react';
import { apiError, toolApi, toolFiles } from '../api/client';
import { Tool, ToolManifest } from '../types';
import { useResource, clean } from '../hooks/useResource';
import { useForm } from '../hooks/useForm';
import { useToast } from '../components/Toast';
import Attachments, { formatBytes } from '../components/Attachments';
import {
  Button, ConfirmDialog, EmptyState, ErrorBanner, ErrorSummary, Modal,
  PageHeader, Spinner, TextAreaField, TextField,
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
          <Button variant="primary" onClick={openNew}>
            <Plus size={16} /> New Tool
          </Button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {loading ? (
        <Spinner label="Loading tools…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No tools yet"
          hint="Upload a folder containing index.html and its assets, and it runs here."
          action={
            <Button variant="primary" onClick={openNew}>
              <Plus size={16} /> New Tool
            </Button>
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
                    <Button variant="primary" onClick={() => setManaging(t)}>
                      <Files size={14} /> Add files
                    </Button>
                  )}
                  <Button onClick={() => setManaging(t)} aria-label={`Files of ${t.name}`}>
                    <Files size={14} /> Files
                  </Button>
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
          <TextField
            {...fx('entry_path')} label="Entry file" value={form.values.entry_path}
            onChange={set('entry_path')}
            hint="Which file opens when the tool runs. Usually index.html."
          />
        </div>
      </Modal>

      {/* Files */}
      <Modal
        open={!!managing}
        wide
        title={managing ? `Files — ${managing.name}` : 'Files'}
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
      </Modal>

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
