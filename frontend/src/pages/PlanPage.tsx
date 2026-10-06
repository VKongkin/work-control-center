import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2, ClipboardList, Clock,
  Coffee, Copy, Crosshair, Hourglass, ListTodo, MoonStar, Pencil, Plus, Sparkles,
  Trash2,
} from 'lucide-react';
import { planApi, apiError } from '../api/client';
import { BlockKind, DayPlan, PlanBlock, PlanSuggestion } from '../types';
import { useToast } from '../components/Toast';
import { copyText } from '../lib/clipboard';
import { daysBetween, localDay, minutesOfDay, shiftDay } from '../lib/constants';
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

const REST: BlockKind[] = ['BREAK', 'LUNCH'];

const hours = (m: number) => (m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`);

/** A duration the way someone says it out loud: "25m", "1h 05m". */
const spoken = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const blank = {
  start: '09:00', end: '10:00', kind: 'WORK' as BlockKind,
  title: '', activity: '', theme: '',
};

/**
 * The wall clock, re-read every fifteen seconds.
 *
 * Fifteen rather than sixty because the number people actually read off this
 * page is "how long have I got", and a minute of lag in that number is a
 * minute of lag in the only thing the panel is for.
 *
 * Note what this does NOT do: ask the server what time it is. Blocks are
 * stored as minutes since local midnight, the server runs in UTC, and the
 * person is at UTC+7 - so the only clock that can say which block is running
 * is the one on their own machine.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

/** Where the day has got to. */
type Where =
  | { at: 'other-day'; days: number }
  | { at: 'before'; starts: number; until: number; first: PlanBlock | null }
  | { at: 'current'; live: PlanBlock[]; left: number; pct: number; next: PlanBlock | null }
  | { at: 'gap'; since: number; until: number; next: PlanBlock }
  | { at: 'after'; spare: number };

/**
 * Which block is running, and what is next.
 *
 * Kept as one function returning one value rather than six booleans scattered
 * through the markup: "nothing is running" has four different causes - the day
 * has not started, you are between two blocks, the plan has run out, or you
 * are looking at another date entirely - and each wants a different sentence.
 */
function whereInTheDay(
  plan: DayPlan, day: string, todayStr: string, nowMin: number,
): Where {
  if (day !== todayStr) return { at: 'other-day', days: daysBetween(todayStr, day) };

  const blocks = [...plan.blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const next = blocks.find((b) => b.start > nowMin) ?? null;
  const live = blocks.filter((b) => b.start <= nowMin && nowMin < b.end);

  if (live.length) {
    // Double-booked: lead with the one you are most likely to actually be
    // doing - work before a break, and something unticked before something
    // already ticked off - then by whichever ends first.
    const rank = (b: PlanBlock) => (REST.includes(b.kind) ? 1 : 0) + (b.done ? 2 : 0);
    const ordered = [...live].sort((a, b) => rank(a) - rank(b) || a.end - b.end);
    const head = ordered[0];
    return {
      at: 'current',
      live: ordered,
      left: head.end - nowMin,
      pct: Math.min(100, Math.max(0, ((nowMin - head.start) / head.minutes) * 100)),
      next,
    };
  }

  const opens = Math.min(plan.day_start, blocks.length ? blocks[0].start : plan.day_start);
  if (nowMin < opens) {
    return { at: 'before', starts: opens, until: opens - nowMin, first: blocks[0] ?? null };
  }
  if (next) {
    const ended = blocks.filter((b) => b.end <= nowMin).map((b) => b.end);
    return {
      at: 'gap',
      since: ended.length ? Math.max(...ended) : opens,
      until: next.start - nowMin,
      next,
    };
  }
  return { at: 'after', spare: Math.max(0, plan.day_end - nowMin) };
}

export default function PlanPage() {
  const toast = useToast();
  const now = useNow();
  const todayStr = localDay(now);
  const nowMin = minutesOfDay(now);
  const [day, setDay] = useState(todayStr);
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

  const shift = (days: number) => setDay(shiftDay(day, days));

  const biggest = useMemo(
    () => (plan?.breakdown.length ? plan.breakdown[0].minutes : 0), [plan]);

  /* ------------------------------------------------------------- the clock */
  const where = useMemo(
    () => (plan ? whereInTheDay(plan, day, todayStr, nowMin) : null),
    [plan, day, todayStr, nowMin]);

  // The block to put a ring around, and the one to scroll to.
  const currentId = where?.at === 'current' ? where.live[0].id : null;
  const focusId = currentId
    ?? (where?.at === 'gap' ? where.next.id : null)
    ?? (where?.at === 'before' ? where.first?.id ?? null : null);

  /** Blocks that have been and gone with nobody ticking them off. */
  const behind = useMemo(() => {
    if (!plan || day !== todayStr) return [];
    return plan.blocks.filter(
      (b) => b.end <= nowMin && !b.done && !REST.includes(b.kind));
  }, [plan, day, todayStr, nowMin]);

  const rows = useRef<Record<number, HTMLDivElement | null>>({});
  const jumpTo = useCallback((id: number | null) => {
    if (id == null) return;
    rows.current[id]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // Land on the part of the day that is actually happening. Once per day
  // loaded, not on every fifteen-second tick - a page that yanks itself back
  // into position while you are reading something else is worse than one that
  // never moved.
  const landed = useRef<string>('');
  useEffect(() => {
    if (!plan || loading || day !== todayStr) return;
    const mark = `${plan.id}:${day}`;
    if (landed.current === mark || focusId == null) return;
    landed.current = mark;
    const t = setTimeout(() => jumpTo(focusId), 120);
    return () => clearTimeout(t);
  }, [plan, loading, day, todayStr, focusId, jumpTo]);

  /** Add a block over the stretch that is empty right now. */
  function planThisGap(from: number, to: number) {
    setEditing(null);
    setForm({ ...blank, start: hhmm(from), end: hhmm(to) });
    setOpen(true);
  }

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
                <Button onClick={() => setCopyTo(todayStr)} id="copy-day">
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
        <Button onClick={() => setDay(todayStr)} disabled={day === todayStr}>Today</Button>
        {plan && day === todayStr && focusId != null && (
          <Button onClick={() => jumpTo(focusId)} id="jump-now">
            <Crosshair size={15} /> Jump to now
          </Button>
        )}
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
            {/* ------------------------------------------------------ right now */}
            {/* Sticky: a long day scrolls, and the whole point of this panel is
                to be readable without going looking for it. */}
            {where && (
              <section
                data-now
                data-now-state={where.at}
                className={`sticky top-2 z-10 rounded-xl border px-4 py-3.5 shadow-sm ${
                  where.at === 'current' ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-200'
                  : where.at === 'gap' ? 'border-amber-300 bg-amber-50'
                  : where.at === 'after' ? 'border-emerald-200 bg-emerald-50'
                  : 'border-slate-200 bg-slate-50'
                }`}
              >
                {where.at === 'other-day' ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-slate-600">
                      <CalendarClock size={14} className="mr-1.5 inline text-slate-400" />
                      {where.days === 1 ? 'Tomorrow’s plan'
                        : where.days === -1 ? 'Yesterday’s plan'
                        : where.days > 0 ? `${where.days} days ahead`
                        : `${Math.abs(where.days)} days ago`}
                      {' '}— nothing is running on this page.
                    </p>
                    <Button className="!py-1 !text-xs" onClick={() => setDay(todayStr)}>
                      Back to today
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <Clock size={13} />
                      <span data-now-clock>Now · {hhmm(nowMin)}</span>
                    </div>

                    {where.at === 'current' && (
                      <div className="mt-2 flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-semibold leading-tight text-slate-900"
                            data-now-block={where.live[0].id}>
                            {where.live[0].title}
                          </p>
                          {where.live[0].activity && (
                            <p className="mt-1 text-sm text-slate-700">{where.live[0].activity}</p>
                          )}
                          <p className="mt-1.5 font-mono text-xs text-slate-600" data-now-left>
                            {where.live[0].from}–{where.live[0].to} · {spoken(where.left)} left
                          </p>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100">
                            <div className="h-full rounded-full bg-blue-600 transition-all"
                              style={{ width: `${where.pct}%` }} data-now-bar />
                          </div>
                          {where.live.length > 1 && (
                            <p className="mt-2 text-xs text-amber-800" data-now-also>
                              At the same time: {where.live.slice(1).map((b) => `“${b.title}”`).join(', ')}
                            </p>
                          )}
                        </div>
                        <Button
                          variant={where.live[0].done ? undefined : 'primary'}
                          className="!py-1.5 !text-xs"
                          data-now-tick={where.live[0].id}
                          disabled={busy}
                          onClick={() => run(() => planApi.patchBlock(
                            where.live[0].id, { done: !where.live[0].done }))}
                        >
                          <CheckCircle2 size={14} /> {where.live[0].done ? 'Ticked' : 'Tick off'}
                        </Button>
                      </div>
                    )}

                    {where.at === 'gap' && (
                      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold leading-tight text-slate-900">
                            <Hourglass size={16} className="mr-1.5 inline text-amber-600" />
                            Nothing planned right now
                          </p>
                          <p className="mt-1 text-sm text-amber-900" data-now-left>
                            Free since {hhmm(where.since)} · {spoken(where.until)} until the next block
                          </p>
                        </div>
                        <Button
                          className="!py-1.5 !text-xs"
                          id="plan-the-gap"
                          onClick={() => planThisGap(where.since, where.next.start)}
                        >
                          <Plus size={14} /> Plan {hhmm(where.since)}–{where.next.from}
                        </Button>
                      </div>
                    )}

                    {where.at === 'before' && (
                      <div className="mt-2">
                        <p className="text-lg font-semibold leading-tight text-slate-900">
                          <MoonStar size={16} className="mr-1.5 inline text-slate-400" />
                          The day starts at {hhmm(where.starts)}
                        </p>
                        <p className="mt-1 text-sm text-slate-600" data-now-left>
                          {spoken(where.until)} from now
                        </p>
                      </div>
                    )}

                    {where.at === 'after' && (
                      <div className="mt-2">
                        <p className="text-lg font-semibold leading-tight text-slate-900">
                          <Coffee size={16} className="mr-1.5 inline text-emerald-600" />
                          That is the plan done
                        </p>
                        <p className="mt-1 text-sm text-slate-600" data-now-left>
                          {plan.blocks.filter((b) => b.done).length} of {plan.blocks.length} ticked off
                          {where.spare > 0 && ` · ${spoken(where.spare)} of the day left`}
                        </p>
                      </div>
                    )}

                    {(where.at === 'current' || where.at === 'gap' || where.at === 'before') && (
                      <p className="mt-2.5 border-t border-black/5 pt-2 text-xs text-slate-600"
                        data-now-next>
                        {where.at === 'gap' ? (
                          <>Up next <span className="font-mono">{where.next.from}</span> · {where.next.title}</>
                        ) : where.at === 'current' && where.next ? (
                          <>Up next <span className="font-mono">{where.next.from}</span> · {where.next.title}
                            {' '}(in {spoken(where.next.start - nowMin)})</>
                        ) : where.at === 'before' && where.first ? (
                          <>First <span className="font-mono">{where.first.from}</span> · {where.first.title}</>
                        ) : (
                          <>Nothing after this one.</>
                        )}
                      </p>
                    )}

                    {/* Not once the day is over: "0 of 8 ticked off" above has
                        already said this, in better words. */}
                    {behind.length > 0 && where.at !== 'after' && (
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"
                        data-behind={behind.length}>
                        {behind.length} earlier block{behind.length === 1 ? '' : 's'} not ticked off
                        <button
                          onClick={() => jumpTo(behind[0].id)}
                          className="font-medium text-blue-700 underline-offset-2 hover:underline"
                        >
                          show the first
                        </button>
                      </p>
                    )}
                  </>
                )}
              </section>
            )}

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

            {plan.blocks.map((b, i) => {
              const live = b.id === currentId;
              const past = day === todayStr && b.end <= nowMin;
              // The line between "has happened" and "has not": drawn above the
              // first block still to come, and only when it is not already
              // obvious from a block being highlighted as current.
              const lineHere = day === todayStr && where?.at !== 'current'
                && b.start > nowMin
                && (i === 0 || plan.blocks[i - 1].end <= nowMin)
                && nowMin >= Math.min(plan.day_start, plan.blocks[0].start);
              return (
              <div key={b.id}>
                {lineHere && (
                  <div className="flex items-center gap-2 py-1.5" data-now-line>
                    <span className="font-mono text-[11px] font-semibold text-rose-600">
                      {hhmm(nowMin)}
                    </span>
                    <span className="h-px flex-1 bg-rose-300" />
                    <span className="text-[10px] uppercase tracking-wide text-rose-500">now</span>
                  </div>
                )}
              <div
                ref={(el) => { rows.current[b.id] = el; }}
                data-block={b.id}
                {...(live ? { 'data-current': b.id } : {})}
                {...(past ? { 'data-past': '' } : {})}
                className={`group flex items-start gap-3 rounded-xl border px-4 py-3 transition ${TONE[b.kind]} ${
                  b.done ? 'opacity-60' : past ? 'opacity-70' : ''
                } ${live ? '!border-blue-400 ring-2 ring-blue-300' : ''}`}
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
                    {live && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-white"
                        data-now-pill>
                        <Clock size={9} /> now · {spoken(b.end - nowMin)} left
                      </span>
                    )}
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
              </div>
              );
            })}

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
