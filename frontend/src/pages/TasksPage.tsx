import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { taskApi } from '../api/client';
import { Task } from '../types';
import { useResource, clean, toId } from '../hooks/useResource';
import { useLookups } from '../hooks/useLookups';
import { useForm } from '../hooks/useForm';
import DetailView from '../components/DetailView';
import GroupedList from '../components/GroupedList';
import {
  Badge, Button, ComboboxField, ConfirmDialog, DateField, EmptyState, ErrorBanner,
  ErrorSummary, Modal, PageHeader, SelectField, Spinner, TextAreaField, TextField,
} from '../components/ui';
import { PRIORITIES, TASK_STATUSES, fmtDate, isOverdue, toDateInput } from '../lib/constants';
import { daysLate, dueLabel, groupTasks, isDone } from '../lib/grouping';
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
  const [viewing, setViewing] = useState<Task | null>(null);
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
      ) : (
        <div data-list>
        {visible.length === 0 ? (
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
        <GroupedList<Task>
          groups={groupTasks(visible)}
          row={(t) => (
            <div className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge value={t.priority} />
                  <button
                    onClick={() => setViewing(t)}
                    className={`text-left text-sm font-medium hover:text-blue-700 ${
                      isDone(t) ? 'text-slate-500' : 'text-slate-900'
                    }`}
                  >
                    {t.title}
                  </button>
                  {/* How late, in words. A date column made you work that out. */}
                  {dueLabel(t) && !isDone(t) && (
                    <span className={`text-xs ${
                      daysLate(t) > 0 ? 'font-medium text-red-600' : 'text-slate-400'
                    }`}>
                      {dueLabel(t)}
                    </span>
                  )}
                </div>
                {t.next_action && (
                  <p className="mt-0.5 truncate text-xs text-slate-600">
                    Next: {t.next_action}
                  </p>
                )}
                {t.status === 'BLOCKED' && t.blocked_reason && (
                  <p className="mt-0.5 truncate text-xs text-red-600">
                    Blocked: {t.blocked_reason}
                  </p>
                )}
                {(lk.nameOf('people', t.responsible_person_id) !== '—' ||
                  lk.nameOf('projects', t.project_id) !== '—') && (
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {[lk.nameOf('people', t.responsible_person_id),
                      lk.nameOf('projects', t.project_id)]
                      .filter((v) => v !== '—')
                      .join(' · ')}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {/* Changing status is the most frequent action, so it stays inline. */}
                <select
                  value={t.status}
                  aria-label={`Status of ${t.title}`}
                  onChange={(e) => update(t.id, { status: e.target.value } as Partial<Task>, true)}
                  className="rounded-lg border-0 bg-transparent py-1 pl-1 pr-7 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-blue-600"
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => openEdit(t)}
                  aria-label="Edit"
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => setToDelete(t)}
                  aria-label="Delete"
                  className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-50 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          )}
        />
        )}
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

      {viewing && (
        <DetailView
          open
          onClose={() => setViewing(null)}
          title={viewing.title}
          badges={<><Badge value={viewing.priority} /><Badge value={viewing.status} /></>}
          subtitle={
            isOverdue(viewing.due_date, viewing.status)
              ? <span className="font-medium text-red-600">Overdue since {fmtDate(viewing.due_date)}</span>
              : undefined
          }
          rows={[
            { label: 'Description', value: viewing.description, wide: true },
            { label: 'Due date', value: fmtDate(viewing.due_date) },
            { label: 'Owner', value: lk.nameOf('people', viewing.responsible_person_id) },
            { label: 'Project', value: lk.nameOf('projects', viewing.project_id) },
            { label: 'System', value: lk.nameOf('systems', viewing.system_id) },
            { label: 'Department', value: lk.nameOf('departments', viewing.department_id) },
            { label: 'Vendor', value: lk.nameOf('vendors', viewing.vendor_id) },
            { label: 'Category', value: lk.nameOf('categories', viewing.category_id) },
            { label: 'Next action', value: viewing.next_action, wide: true },
            { label: 'Blocked reason', value: viewing.blocked_reason, wide: true },
            { label: 'Notes', value: viewing.notes, wide: true },
            { label: 'Completed', value: viewing.completed_at ? fmtDate(viewing.completed_at) : null },
          ].map((r) => (r.value === '—' ? { ...r, value: null } : r))}
          entityType="task"
          entityId={viewing.id}
          onEdit={() => { const t = viewing; setViewing(null); openEdit(t); }}
          onDelete={() => { const t = viewing; setViewing(null); setToDelete(t); }}
        />
      )}

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
