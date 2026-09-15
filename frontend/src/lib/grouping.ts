import { Issue, Task } from '../types';
import { dayNumber, startOfDay } from './agenda';

/**
 * Grouping work by the question each page is really asking.
 *
 * Meetings ask "what is on today". Tasks ask "what is late and what is next" -
 * so they group by urgency, not by status, because a P0 due last week and a P0
 * due next month are not the same problem. Issues ask "what is broken and how
 * badly" - so they group by severity.
 *
 * Both share the shape the list component renders, and both fold away the work
 * that is finished: it is still reachable, but it is not what you came for.
 */

export interface Group<T> {
  key: string;
  label: string;
  items: T[];
  /** Rendered collapsed, behind a toggle. */
  collapsed?: boolean;
  /** Draws the heading and border in a colour that matches the meaning. */
  tone?: 'danger' | 'warning' | 'active' | 'muted';
}

/* ------------------------------------------------------------------ tasks */

export const TASK_DONE = new Set(['COMPLETED', 'CANCELLED']);

export const isDone = (t: Task): boolean => TASK_DONE.has(t.status);

const PRIORITY_RANK: Record<string, number> = {
  P0_CRITICAL: 0, P1_HIGH: 1, P2_MEDIUM: 2, P3_LOW: 3,
};

export function dueDayNumber(task: Task): number | null {
  if (!task.due_date) return null;
  const d = new Date(task.due_date);
  return Number.isNaN(d.getTime()) ? null : dayNumber(d);
}

/** Whole days late, or 0 when it is not late. */
export function daysLate(task: Task, now = new Date()): number {
  const due = dueDayNumber(task);
  if (due === null || isDone(task)) return 0;
  const diff = dayNumber(now) - due;
  return diff > 0 ? diff : 0;
}

/** "4 days late" / "due today" / "in 3 days" / "" when there is no due date. */
export function dueLabel(task: Task, now = new Date()): string {
  const due = dueDayNumber(task);
  if (due === null) return '';
  const diff = due - dayNumber(now);
  if (diff === 0) return 'due today';
  if (diff === 1) return 'due tomorrow';
  if (diff === -1) return '1 day late';
  if (diff < 0) return `${-diff} days late`;
  if (diff <= 7) return `in ${diff} days`;
  return new Date(due * 86400000).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short',
  });
}

/**
 * Within a group, the most pressing first: priority, then the nearest due
 * date, then title so the order never wobbles between renders.
 */
export function byUrgency(a: Task, b: Task): number {
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p !== 0) return p;
  const x = dueDayNumber(a);
  const y = dueDayNumber(b);
  if (x !== y) return (x ?? Infinity) - (y ?? Infinity);
  return a.title.localeCompare(b.title);
}

export function groupTasks(tasks: Task[], now = new Date()): Group<Task>[] {
  const today = dayNumber(now);
  const bucket: Record<string, Task[]> = {
    overdue: [], today: [], week: [], later: [], undated: [], done: [],
  };

  for (const task of tasks) {
    if (isDone(task)) { bucket.done.push(task); continue; }
    const due = dueDayNumber(task);
    if (due === null) { bucket.undated.push(task); continue; }
    const diff = due - today;
    if (diff < 0) bucket.overdue.push(task);
    else if (diff === 0) bucket.today.push(task);
    else if (diff <= 7) bucket.week.push(task);
    else bucket.later.push(task);
  }

  const groups: Group<Task>[] = [
    { key: 'overdue', label: 'Overdue', items: bucket.overdue, tone: 'danger' },
    { key: 'today', label: 'Due today', items: bucket.today, tone: 'warning' },
    { key: 'week', label: 'The next 7 days', items: bucket.week, tone: 'active' },
    { key: 'later', label: 'Later', items: bucket.later },
    { key: 'undated', label: 'No due date', items: bucket.undated },
    // Finished work is kept, not hidden - but it is not what the page is for.
    { key: 'done', label: 'Done', items: bucket.done, collapsed: true, tone: 'muted' },
  ];

  for (const g of groups) g.items.sort(byUrgency);
  return groups.filter((g) => g.items.length > 0);
}

/* ----------------------------------------------------------------- issues */

export const ISSUE_CLOSED = new Set(['RESOLVED', 'CLOSED']);

export const isClosed = (i: Issue): boolean => ISSUE_CLOSED.has(i.status);

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const SEVERITY_TONE: Record<string, Group<Issue>['tone']> = {
  CRITICAL: 'danger', HIGH: 'warning', MEDIUM: 'active', LOW: undefined,
};

/** Whole days since it was detected, for an issue still open. */
export function daysOpen(issue: Issue, now = new Date()): number | null {
  if (!issue.detected_at) return null;
  const d = new Date(issue.detected_at);
  if (Number.isNaN(d.getTime())) return null;
  const end = isClosed(issue) && issue.resolved_at ? new Date(issue.resolved_at) : now;
  const days = Math.round(
    (startOfDay(end).getTime() - startOfDay(d).getTime()) / 86400000
  );
  return days < 0 ? 0 : days;
}

export function ageLabel(issue: Issue, now = new Date()): string {
  const days = daysOpen(issue, now);
  if (days === null) return '';
  const verb = isClosed(issue) ? 'took' : 'open';
  if (days === 0) return isClosed(issue) ? 'same day' : 'open today';
  return `${verb} ${days} day${days === 1 ? '' : 's'}`;
}

export function groupIssues(issues: Issue[], now = new Date()): Group<Issue>[] {
  const open = issues.filter((i) => !isClosed(i));
  const closed = issues.filter(isClosed);

  const bySeverity = new Map<string, Issue[]>();
  for (const issue of open) {
    const key = SEVERITY_ORDER.includes(issue.severity as any) ? issue.severity : 'LOW';
    const list = bySeverity.get(key);
    if (list) list.push(issue);
    else bySeverity.set(key, [issue]);
  }

  // Oldest first inside a severity: an issue that has been open a fortnight is
  // more of a problem than one raised this morning at the same severity.
  const byAge = (a: Issue, b: Issue) => (daysOpen(b, now) ?? -1) - (daysOpen(a, now) ?? -1);

  const groups: Group<Issue>[] = SEVERITY_ORDER
    .filter((s) => (bySeverity.get(s) ?? []).length > 0)
    .map((s) => ({
      key: s,
      label: s.charAt(0) + s.slice(1).toLowerCase(),
      items: (bySeverity.get(s) ?? []).sort(byAge),
      tone: SEVERITY_TONE[s],
    }));

  if (closed.length) {
    groups.push({
      key: 'resolved',
      label: 'Resolved',
      items: closed.sort((a, b) => (daysOpen(a, now) ?? 0) - (daysOpen(b, now) ?? 0)),
      collapsed: true,
      tone: 'muted',
    });
  }
  return groups;
}
