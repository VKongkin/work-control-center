import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { taskApi } from '../api/client';
import { Task } from '../types';
import { useResource, clean, toId } from '../hooks/useResource';
import { useLookups } from '../hooks/useLookups';
import { useForm } from '../hooks/useForm';
import {
  Badge, Button, ComboboxField, ConfirmDialog, DateField, EmptyState, ErrorBanner,
  ErrorSummary, Modal, PageHeader, SelectField, Spinner, TextAreaField, TextField,
} from '../components/ui';
import { PRIORITIES, TASK_STATUSES, fmtDate, isOverdue, toDateInput } from '../lib/constants';
import { maxLength, required, requiredWhen, saneDate } from '../lib/validators';

const RULES = {
  title: [required('Title'), maxLength(255, 'Title')],
  due_date: [saneDate],
  // A blocked task with no stated reason is the thing that quietly rots.
  blocked_reason: [requiredWhen('status', 'BLOCKED', 'Blocked reason')],
};

const blank = {
  title: '', description: '', status: 'INBOX', priority: 'P2_MEDIUM', due_date: '',
  project_id: '', system_id: '', department_id: '', responsible_person_id: '',
  vendor_id: '', category_id: '', next_action: '', blocked_reason: '', notes: '',
};
type Form = typeof blank;

export default function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [priority, setPriority] = useState(searchParams.get('priority') ?? '');
  const [projectId, setProjectId] = useState(searchParams.get('project_id') ?? '');
  const [q, setQ] = useState('');

  const params = useMemo(
    () => ({
      status: status || undefined,
      priority: priority || undefined,
      project_id: projectId || undefined,
      limit: 200,
    }),
    [status, priority, projectId]
  );

  const { items, loading, error, saving, refresh, create, update, remove } =
    useResource<Task>(taskApi, 'Task', params);
  const lk = useLookups();

  const [editing, setEditing] = useState<Task | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Task | null>(null);
  const form = useForm({ initial: blank, rules: RULES });

  // Keep the URL in step with the filters so a filtered view can be linked to.
  useEffect(() => {
    const next: Record<string, string> = {};
    if (status) next.status = status;
    if (priority) next.priority = priority;
    if (projectId) next.project_id = projectId;
    setSearchParams(next, { replace: true });
  }, [status, priority, projectId, setSearchParams]);

  // The dashboard links here with ?new=1 to open a blank task form.
  useEffect(() => {
    if (searchParams.get('new') === '1') openNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        (t.description ?? '').toLowerCase().includes(needle)
    );
  }, [items, q]);

  function openNew() {
    setEditing(null);
    form.reset({ ...blank, project_id: projectId });
    setOpen(true);
  }

  function openEdit(t: Task) {
    setEditing(t);
    form.reset({
      title: t.title,
      description: t.description ?? '',
      status: t.status,
      priority: t.priority,
      due_date: toDateInput(t.due_date),
      project_id: t.project_id ? String(t.project_id) : '',
      system_id: t.system_id ? String(t.system_id) : '',
      department_id: t.department_id ? String(t.department_id) : '',
      responsible_person_id: t.responsible_person_id ? String(t.responsible_person_id) : '',
      vendor_id: t.vendor_id ? String(t.vendor_id) : '',
      category_id: t.category_id ? String(t.category_id) : '',
      next_action: t.next_action ?? '',
      blocked_reason: t.blocked_reason ?? '',
      notes: t.notes ?? '',
    });
    setOpen(true);
  }

  async function submit() {
    const { ok: valid, firstInvalid } = form.validate();
    if (!valid) {
      const el = document.querySelector<HTMLElement>(
        `[role="dialog"] #f-${firstInvalid}`
      );
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      return;
    }
    const v = form.values as Form;
    const payload = clean({
      ...v,
      title: v.title.trim(),
      project_id: toId(v.project_id),
      system_id: toId(v.system_id),
      department_id: toId(v.department_id),
      responsible_person_id: toId(v.responsible_person_id),
      vendor_id: toId(v.vendor_id),
      category_id: toId(v.category_id),
    }) as unknown as Partial<Task>;

    const result = editing ? await update(editing.id, payload) : await create(payload);
    if (result === true) setOpen(false);
    else if (typeof result === 'string') form.setServerError(result);
  }

  const set = (k: keyof Form) => (v: string) => form.setField(k as string, v);
  const fx = (k: keyof Form) => ({
    name: k as string,
    error: form.errors[k as string],
    onBlur: () => form.blur(k as string),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        subtitle={`${visible.length} of ${items.length} shown`}
        action={
          <Button variant="primary" onClick={openNew}>
            <Plus size={16} /> New Task
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block min-w-[190px] flex-1">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Search</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by title…"
              className="block w-full rounded-lg border-0 py-2 pl-9 pr-3 text-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600"
            />
          </div>
        </label>
        <SelectField
          name="filter-status" label="Status" value={status} onChange={setStatus}
          options={TASK_STATUSES} placeholder="All statuses" className="min-w-[150px]"
        />
        <SelectField
          name="filter-priority" label="Priority" value={priority} onChange={setPriority}
          options={PRIORITIES} placeholder="All priorities" className="min-w-[150px]"
        />
        <SelectField
          name="filter-project" label="Project" value={projectId} onChange={setProjectId}
          options={lk.projects} placeholder="All projects" className="min-w-[160px]"
        />
        {(status || priority || projectId || q) && (
          <Button
            onClick={() => { setStatus(''); setPriority(''); setProjectId(''); setQ(''); }}
          >
            Clear
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {loading ? (
        <Spinner label="Loading tasks…" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={items.length ? 'No tasks match these filters' : 'No tasks yet'}
          hint={items.length ? 'Try clearing a filter.' : 'Create your first task to get started.'}
          action={
            !items.length && (
              <Button variant="primary" onClick={openNew}>
                <Plus size={16} /> New Task
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <td className="max-w-[320px] px-4 py-3">
                      <button
                        onClick={() => openEdit(t)}
                        className="text-left font-medium text-slate-900 hover:text-blue-700"
                      >
                        {t.title}
                      </button>
                      {t.description && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">{t.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {/* Changing status is the most frequent action, so it is inline. */}
                      <select
                        value={t.status}
                        onChange={(e) => update(t.id, { status: e.target.value } as Partial<Task>, true)}
                        className="rounded-lg border-0 bg-transparent py-1 pl-1 pr-7 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-blue-600"
                      >
                        {TASK_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3"><Badge value={t.priority} /></td>
                    <td className="px-4 py-3">
                      <span className={isOverdue(t.due_date, t.status) ? 'font-medium text-red-600' : 'text-slate-600'}>
                        {fmtDate(t.due_date)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {lk.nameOf('people', t.responsible_person_id)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {lk.nameOf('projects', t.project_id)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => openEdit(t)} aria-label="Edit">
                          <Pencil size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setToDelete(t)}
                          aria-label="Delete"
                          className="text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={open}
        wide
        dirty={form.isDirty && !saving}
        title={editing ? 'Edit task' : 'New task'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create task'}
            </Button>
          </>
        }
      >
        <ErrorSummary errors={form.errorList} serverError={form.serverError} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            {...fx('title')} label="Title" required value={form.values.title}
            onChange={set('title')} placeholder="What needs doing?" className="sm:col-span-2"
          />
          <TextAreaField
            {...fx('description')} label="Description" value={form.values.description}
            onChange={set('description')} className="sm:col-span-2"
          />
          <SelectField {...fx('status')} label="Status" value={form.values.status} onChange={set('status')} options={TASK_STATUSES} placeholder="Inbox" />
          <SelectField {...fx('priority')} label="Priority" value={form.values.priority} onChange={set('priority')} options={PRIORITIES} placeholder="P2 · Medium" />
          <DateField
            {...fx('due_date')} label="Due date" value={form.values.due_date} onChange={set('due_date')}
            hint="Leave empty if there is no deadline"
          />
          <ComboboxField {...fx('category_id')} label="Category" value={form.values.category_id} onChange={set('category_id')} options={lk.categories} />
          <ComboboxField {...fx('project_id')} label="Project" value={form.values.project_id} onChange={set('project_id')} options={lk.projects} />
          <ComboboxField {...fx('system_id')} label="System" value={form.values.system_id} onChange={set('system_id')} options={lk.systems} />
          <ComboboxField {...fx('department_id')} label="Department" value={form.values.department_id} onChange={set('department_id')} options={lk.departments} />
          <ComboboxField {...fx('vendor_id')} label="Vendor" value={form.values.vendor_id} onChange={set('vendor_id')} options={lk.vendors} />
          <ComboboxField
            {...fx('responsible_person_id')} label="Responsible person"
            value={form.values.responsible_person_id} onChange={set('responsible_person_id')}
            options={lk.people} className="sm:col-span-2"
          />
          <TextField {...fx('next_action')} label="Next action" value={form.values.next_action} onChange={set('next_action')} className="sm:col-span-2" />
          {form.values.status === 'BLOCKED' && (
            <TextField
              {...fx('blocked_reason')} label="Blocked reason" required
              value={form.values.blocked_reason} onChange={set('blocked_reason')}
              placeholder="What is holding this up?" className="sm:col-span-2"
            />
          )}
          <TextAreaField {...fx('notes')} label="Notes" value={form.values.notes} onChange={set('notes')} className="sm:col-span-2" />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete task"
        message={`"${toDelete?.title}" will be permanently removed. This cannot be undone.`}
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
