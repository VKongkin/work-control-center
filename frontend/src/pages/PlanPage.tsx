import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2, ClipboardList, Copy,
  ListTodo, Pencil, Plus, Sparkles, Trash2,
} from 'lucide-react';
import { planApi, apiError } from '../api/client';
import { BlockKind, DayPlan, PlanBlock, PlanSuggestion } from '../types';
import { useToast } from '../components/Toast';
import { copyText } from '../lib/clipboard';
import {
  Button, ConfirmDialog, EmptyState, ErrorBanner, Modal, PageHeader, SelectField,
  Spinner, TextAreaField, TextField,
} from '../components/ui';

/**
 * A plan for one day.
 *
 * Separate from Meetings on purpose. The diary answers "what have I agreed to
 * attend"; this answers "what am I going to do with the rest of it", which is
 * the question nobody can answer at six o'clock. The two meet once, at Start
 * the day, which lays the diary down first so what is left on screen is the
 * time actually available.
 *
 * The totals are not stored anywhere. They are recomputed by the server on
 * every edit, because a cached total is a total that goes quietly wrong the
 * first time a block moves.
 */
const KINDS: { value: BlockKind; label: string }[] = [
  { value: 'WORK', label: 'Work' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'BREAK', label: 'Break' },
  { value: 'LUNCH', label: 'Lunch' },
  { value: 'BUFFER', label: 'Buffer / follow-up' },
];

const TONE: Record<BlockKind, string> = {
  WORK: 'border-blue-200 bg-blue-50/40',
  MEETING: 'border-violet-200 bg-violet-50/40',
  BREAK: 'border-slate-200 bg-slate-50',
  LUNCH: 'border-slate-200 bg-slate-50',
  BUFFER: 'border-amber-200 bg-amber-50/40',
};

const BAR: Record<string, string> = {
  0: 'bg-blue-600', 1: 'bg-violet-500', 2: 'bg-emerald-500',
  3: 'bg-amber-500', 4: 'bg-rose-500', 5: 'bg-slate-400',
};

const today = () => new Date().toISOString().slice(0, 10);
const hours = (m: number) => (m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`);

const blank = {
  start: '09:00', end: '10:00', kind: 'WORK' as BlockKind,
  title: '', activity: '', theme: '',
};

export default function PlanPage() {
  const toast = useToast();
  const [day, setDay] = useState(today());
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<PlanBlock | null>(null);
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [suggestions, setSuggestions] = useState<PlanSuggestion[]>([]);
  const [toDelete, setToDelete] = useState<PlanBlock | null>(null);
  const [copyTo, setCopyTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await planApi.forDay(day);
      setPlan(data);
    } catch (err: any) {
      if (err?.response?.status === 404) setPlan(null);   // no plan yet, not a failure
      else setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => { load(); }, [load]);

  async function run(what: () => Promise<{ data: DayPlan }>, after?: string) {
    setBusy(true);
    try {
      const { data } = await what();
      setPlan(data);
      if (data.completed_task) {
        toast.success(`Ticked off — "${data.completed_task.title}" is marked complete`);
      } else if (after) toast.success(after);
      return data;
    } catch (err) {
      toast.error(apiError(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startDay() {
    setBusy(true);
    try {
      const { data } = await planApi.seed(day);
      setPlan(data);
      const fromDiary = data.blocks.filter((b) => b.meeting_id).length;
      toast.success(fromDiary
        ? `Day started with ${fromDiary} meeting${fromDiary === 1 ? '' : 's'} from your diary`
        : 'Day started — nothing in the diary to work around');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  function openNew() {
    setEditing(null);
    // Start where the day currently runs out, which is nearly always where the
    // next block belongs.
    const end = plan?.blocks.length ? plan.blocks[plan.blocks.length - 1].to : '09:00';
    const [h, m] = end.split(':').map(Number);
    const plus = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    setForm({ ...blank, start: end, end: plus });
    setOpen(true);
  }

  function openEdit(b: PlanBlock) {
    setEditing(b);
    setForm({
      start: b.from, end: b.to, kind: b.kind, title: b.title,
      activity: b.activity ?? '', theme: b.theme ?? '',
    });
    setOpen(true);
  }

  async function save() {
    if (!plan || !form.title.trim()) return;
    const body = {
      start: form.start, end: form.end, kind: form.kind,
      title: form.title.trim(), activity: form.activity.trim() || undefined,
      theme: form.theme.trim() || undefined,
    };
    const done = editing
      ? await run(() => planApi.patchBlock(editing.id, body), 'Block updated')
      : await run(() => planApi.addBlock(plan.id, body), 'Block added');
    if (done) setOpen(false);
  }

  async function pickTasks() {
    try {
      const { data } = await planApi.suggestions(day);
      setSuggestions(data);
      setPicking(true);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function addFromTask(t: PlanSuggestion) {
    if (!plan) return;
    const last = plan.blocks.length ? plan.blocks[plan.blocks.length - 1].to : '09:00';
    const [h, m] = last.split(':').map(Number);
    const end = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    await run(() => planApi.addBlock(plan.id, {
      start: last, end, title: t.title, kind: 'WORK',
      activity: t.next_action || undefined, task_id: t.id,
    }), `"${t.title}" blocked out`);
  }

  async function copyOut(which: 'timetable' | 'checklist') {
    if (!plan) return;
    try {
      const { data } = await planApi.exportText(plan.id);
      if (await copyText(data[which])) toast.success(`${which === 'checklist' ? 'Task list' : 'Timetable'} copied`);
      else toast.error('The clipboard is not available here.');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  const shift = (days: number) => {
    const d = new Date(day + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setDay(d.toISOString().slice(0, 10));
  };

  const biggest = useMemo(
    () => (plan?.breakdown.length ? plan.breakdown[0].minutes : 0), [plan]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Day plan"
        subtitle="Where the hours go — separate from your diary, and aware of it"
        action={
          <div className="flex flex-wrap gap-2">
            {plan && (
              <>
                <Button onClick={() => copyOut('checklist')} id="copy-checklist">
                  <ClipboardList size={16} /> Copy task list
                </Button>
                <Button onClick={() => copyOut('timetable')}>
                  <Copy size={16} /> Copy timetable
                </Button>
                <Button onClick={() => setCopyTo(today())} id="copy-day">
                  <CalendarPlus size={16} /> Copy to…
                </Button>
              </>
            )}
            {plan && (
              <Button variant="primary" onClick={openNew} id="add-block">
                <Plus size={16} /> Add block
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => shift(-1)} aria-label="Previous day">←</Button>
        <input
          type="date"
          id="plan-date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-blue-600"
        />
        <Button onClick={() => shift(1)} aria-label="Next day">→</Button>
        <Button onClick={() => setDay(today())}>Today</Button>
        {plan && (
          <span className="ml-1 text-sm text-slate-500" data-day-span>
            {plan.from}–{plan.to} · {hours(plan.work_minutes)} of work planned
            {plan.unplanned_minutes > 0 && `, ${hours(plan.unplanned_minutes)} unplanned`}
          </span>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <Spinner label="Loading the day…" />
      ) : !plan ? (
        <EmptyState
          title={`Nothing planned for ${day}`}
          hint="Start the day and WCC lays your meetings down first, so what is left on screen is the time you actually have."
          action={
            <Button variant="primary" onClick={startDay} disabled={busy} id="start-day">
              <CalendarClock size={16} /> Start the day
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* --------------------------------------------------- the timetable */}
          <div className="space-y-2 lg:col-span-2" data-timetable>
            {plan.overlaps.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                data-clashes>
                <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">
                    {plan.overlaps.length} block{plan.overlaps.length === 1 ? '' : 's'} double-booked
                  </p>
                  {plan.overlaps.map((c, i) => (
                    <p key={i} className="mt-0.5 text-amber-800">
                      “{c.a.title}” and “{c.b.title}” share {hours(c.minutes)} around {c.b.from}.
                    </p>
                  ))}
                </div>
              </div>
            )}

            {plan.blocks.length === 0 && (
              <EmptyState title="An empty day" hint="Add a block, or pull one from your tasks." />
            )}

            {plan.blocks.map((b) => (
              <div
                key={b.id}
                data-block={b.id}
                className={`group flex items-start gap-3 rounded-xl border px-4 py-3 transition ${TONE[b.kind]} ${
                  b.done ? 'opacity-60' : ''
                }`}
              >
                <button
                  onClick={() => run(() => planApi.patchBlock(b.id, { done: !b.done }))}
                  disabled={busy}
                  aria-label={b.done ? `Mark ${b.title} not done` : `Mark ${b.title} done`}
                  data-tick={b.id}
                  className={`mt-0.5 shrink-0 rounded-full transition ${
                    b.done ? 'text-emerald-600' : 'text-slate-300 hover:text-slate-500'
                  }`}
                >
                  <CheckCircle2 size={19} />
                </button>

                <div className="w-[7.5rem] shrink-0 font-mono text-sm text-slate-600">
                  {b.from}–{b.to}
                  <div className="text-[11px] text-slate-400">{hours(b.minutes)}</div>
                </div>

                <div className="min-w-0 flex-1">
                  <p className={`font-medium text-slate-900 ${b.done ? 'line-through' : ''}`}>
                    {b.title}
                  </p>
                  {b.activity && <p className="mt-0.5 text-sm text-slate-600">{b.activity}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {b.theme && (
                      <span className="rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                        {b.theme}
                      </span>
                    )}
                    {b.task_id && (
                      <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5 text-[11px] text-blue-700 ring-1 ring-inset ring-blue-200">
                        <ListTodo size={10} /> task #{b.task_id}
                      </span>
                    )}
                    {b.meeting_id && (
                      <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1.5 py-0.5 text-[11px] text-violet-700 ring-1 ring-inset ring-violet-200">
                        <CalendarClock size={10} /> from your diary
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button onClick={() => openEdit(b)} aria-label={`Edit ${b.title}`}
                    className="rounded p-1.5 text-slate-400 hover:bg-white hover:text-slate-700">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => setToDelete(b)} aria-label={`Remove ${b.title}`}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            {plan.gaps.length > 0 && (
              <p className="px-1 pt-1 text-xs text-slate-400" data-gaps>
                Unplanned: {plan.gaps.map((g) => `${g.from}–${g.to}`).join(', ')}
              </p>
            )}
          </div>

          {/* ------------------------------------------------ where it goes */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4" data-breakdown>
              <p className="text-sm font-semibold text-slate-900">Where the time goes</p>
              {plan.breakdown.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Nothing planned yet.</p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {plan.breakdown.map((r, i) => (
                    <li key={r.theme} data-slice={r.theme}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate text-slate-700">{r.theme}</span>
                        <span className="shrink-0 font-medium text-slate-900">{r.hours}h</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${BAR[String(i % 6)]}`}
                          style={{ width: `${biggest ? (r.minutes / biggest) * 100 : 0}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Work</dt><dd>{hours(plan.work_minutes)}</dd></div>
                <div className="flex justify-between"><dt>Breaks</dt><dd>{hours(plan.rest_minutes)}</dd></div>
                <div className="flex justify-between"><dt>Unplanned</dt><dd>{hours(plan.unplanned_minutes)}</dd></div>
                <div className="flex justify-between font-medium text-slate-700">
                  <dt>Done so far</dt><dd>{hours(plan.done_minutes)}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-900">Pull from your tasks</p>
              <p className="mt-1 text-xs text-slate-500">
                Overdue first. Blocking one out links it, so ticking the block finishes the task.
              </p>
              <Button className="mt-3 w-full justify-center" onClick={pickTasks} id="pick-tasks">
                <Sparkles size={15} /> What needs an hour today?
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- dialogs */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit block' : 'Add a block'}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy || !form.title.trim()}>
              {editing ? 'Save' : 'Add'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <TextField label="From" name="block-start" value={form.start}
            onChange={(v) => setForm({ ...form, start: v })} placeholder="08:00" />
          <TextField label="To" name="block-end" value={form.end}
            onChange={(v) => setForm({ ...form, end: v })} placeholder="10:30" />
          <TextField className="col-span-2" label="Task" name="block-title" required
            value={form.title} onChange={(v) => setForm({ ...form, title: v })}
            placeholder="VDA go-live planning" />
          <TextAreaField className="col-span-2" label="Activity" name="block-activity"
            value={form.activity} onChange={(v) => setForm({ ...form, activity: v })}
            placeholder="What you will actually be doing in this block" />
          <TextField label="Theme" name="block-theme" value={form.theme}
            onChange={(v) => setForm({ ...form, theme: v })}
            hint="Groups the breakdown" placeholder="VDA go-live" />
          <SelectField label="Kind" name="block-kind" value={form.kind}
            onChange={(v) => setForm({ ...form, kind: v as BlockKind })}
            options={KINDS} placeholder="" />
        </div>
      </Modal>

      <Modal
        open={picking}
        wide
        onClose={() => setPicking(false)}
        title="What needs an hour today?"
        footer={<Button variant="primary" onClick={() => setPicking(false)}>Done</Button>}
      >
        {suggestions.length === 0 ? (
          <EmptyState title="Nothing open" hint="No live tasks to plan around." />
        ) : (
          <ul className="space-y-1.5" data-suggestions>
            {suggestions.map((t) => (
              <li key={t.id} data-suggestion={t.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-900">{t.title}</p>
                  <p className="text-[11px] text-slate-500">
                    {t.priority.replace('_', ' ')}
                    {t.due_date && ` · due ${t.due_date}`}
                    {t.overdue && <span className="font-medium text-red-600"> · overdue</span>}
                  </p>
                </div>
                <Button className="!py-1 !text-xs" onClick={() => addFromTask(t)} disabled={busy}>
                  <Plus size={13} /> Block an hour
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={copyTo !== null}
        onClose={() => setCopyTo(null)}
        title="Copy this day's shape"
        footer={
          <>
            <Button onClick={() => setCopyTo(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || !copyTo}
              onClick={async () => {
                if (!plan || !copyTo) return;
                setBusy(true);
                try {
                  await planApi.copy(plan.id, copyTo);
                  toast.success(`Copied to ${copyTo}`);
                  setCopyTo(null);
                  setDay(copyTo);
                } catch (err) {
                  toast.error(apiError(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Copy
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          The blocks, times and themes come across. Ticks and links to tasks do not —
          a copy is a plan for a day that has not happened yet.
        </p>
        <input
          type="date"
          id="copy-to-date"
          value={copyTo ?? ''}
          onChange={(e) => setCopyTo(e.target.value)}
          className="rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300"
        />
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Remove block"
        message={`"${toDelete?.title}" comes out of the plan. The task behind it, if any, is left alone.`}
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await run(() => planApi.removeBlock(toDelete.id));
          setToDelete(null);
        }}
      />
    </div>
  );
}
