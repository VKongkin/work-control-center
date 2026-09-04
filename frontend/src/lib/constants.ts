export interface Option {
  value: string;
  label: string;
}

export const TASK_STATUSES: Option[] = [
  { value: 'INBOX', label: 'Inbox' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const PRIORITIES: Option[] = [
  { value: 'P0_CRITICAL', label: 'P0 · Critical' },
  { value: 'P1_HIGH', label: 'P1 · High' },
  { value: 'P2_MEDIUM', label: 'P2 · Medium' },
  { value: 'P3_LOW', label: 'P3 · Low' },
];

export const FOLLOWUP_STATUSES: Option[] = [
  { value: 'WAITING', label: 'Waiting' },
  { value: 'FOLLOW_UP_DUE', label: 'Follow-up Due' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const WAITING_FOR_TYPES: Option[] = [
  { value: 'PERSON', label: 'Person' },
  { value: 'DEPARTMENT', label: 'Department' },
  { value: 'VENDOR', label: 'Vendor' },
];

export const PROJECT_STATUSES: Option[] = [
  { value: 'PLANNED', label: 'Planned' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const ISSUE_SEVERITIES: Option[] = [
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

export const ISSUE_STATUSES: Option[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'INVESTIGATING', label: 'Investigating' },
  { value: 'MITIGATING', label: 'Mitigating' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

/** Tailwind classes per enum value, used by <Badge>. */
export const TONE: Record<string, string> = {
  // task status
  INBOX: 'bg-slate-100 text-slate-700 ring-slate-200',
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 ring-blue-200',
  BLOCKED: 'bg-red-50 text-red-700 ring-red-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-slate-200',
  // priority
  P0_CRITICAL: 'bg-red-50 text-red-700 ring-red-200',
  P1_HIGH: 'bg-orange-50 text-orange-700 ring-orange-200',
  P2_MEDIUM: 'bg-slate-100 text-slate-700 ring-slate-200',
  P3_LOW: 'bg-slate-50 text-slate-500 ring-slate-200',
  // follow-up status
  WAITING: 'bg-blue-50 text-blue-700 ring-blue-200',
  FOLLOW_UP_DUE: 'bg-amber-50 text-amber-800 ring-amber-200',
  OVERDUE: 'bg-red-50 text-red-700 ring-red-200',
  RECEIVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  // project status
  PLANNED: 'bg-slate-100 text-slate-700 ring-slate-200',
  ACTIVE: 'bg-blue-50 text-blue-700 ring-blue-200',
  ON_HOLD: 'bg-amber-50 text-amber-800 ring-amber-200',
  // issue severity / status
  CRITICAL: 'bg-red-50 text-red-700 ring-red-200',
  HIGH: 'bg-orange-50 text-orange-700 ring-orange-200',
  MEDIUM: 'bg-amber-50 text-amber-800 ring-amber-200',
  LOW: 'bg-slate-100 text-slate-600 ring-slate-200',
  OPEN: 'bg-red-50 text-red-700 ring-red-200',
  INVESTIGATING: 'bg-amber-50 text-amber-800 ring-amber-200',
  MITIGATING: 'bg-blue-50 text-blue-700 ring-blue-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const ALL_LABELS: Option[] = [
  ...TASK_STATUSES, ...PRIORITIES, ...FOLLOWUP_STATUSES, ...WAITING_FOR_TYPES,
  ...PROJECT_STATUSES, ...ISSUE_SEVERITIES, ...ISSUE_STATUSES,
];

export function labelFor(value?: string | null): string {
  if (!value) return '—';
  return ALL_LABELS.find((o) => o.value === value)?.label ?? value;
}

/** ISO timestamp -> "3 Sep 2026", or an em dash when empty. */
export function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** ISO timestamp -> "2026-09-03" for <input type="date">. */
export function toDateInput(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * ISO timestamp -> "2026-09-03T09:00" for <input type="datetime-local">.
 * Built from the local parts rather than toISOString, which would shift the
 * clock by the timezone offset and quietly move every meeting.
 */
export function toDateTimeInput(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Date plus time, for records where the time of day is the point. */
export function fmtDateTime(value?: string | null): string {
  if (!value) return '\u2014';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** The zone this browser is set to, e.g. "Asia/Phnom_Penh". */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Every IANA zone this browser knows, for the picker. Older browsers have no
 * such list, so the caller falls back to typing a name.
 */
export function knownTimeZones(): string[] {
  try {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    return anyIntl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

export function isOverdue(due?: string | null, status?: string): boolean {
  if (!due || status === 'COMPLETED' || status === 'CANCELLED') return false;
  const d = new Date(due);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}
