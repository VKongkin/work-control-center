import { Meeting } from '../types';

/**
 * Turning a list of meetings into a diary.
 *
 * Both the Meetings page and the Dashboard panel answer the same two
 * questions - what is on today, and what is next - so the answer lives here
 * rather than being worked out twice and drifting apart.
 *
 * Every comparison is done on local calendar days, not on elapsed hours: a
 * meeting at 23:00 tonight and one at 01:00 tomorrow are eleven hours before
 * and one hour after midnight, and calling the second one "today" because it
 * is closer would be wrong.
 */

export type BucketKey = 'today' | 'tomorrow' | 'week' | 'later' | 'undated' | 'past';

export interface DayGroup {
  /** Midnight of the day these meetings fall on; null for undated. */
  date: Date | null;
  meetings: Meeting[];
}

export interface Bucket {
  key: BucketKey;
  label: string;
  days: DayGroup[];
  count: number;
}

const DAY = 86400000;

export const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const dayNumber = (d: Date): number => Math.floor(startOfDay(d).getTime() / DAY);

/** Parsed start time, or null when a meeting has no date at all. */
export function startOf(meeting: Meeting): Date | null {
  if (!meeting.meeting_date) return null;
  const d = new Date(meeting.meeting_date);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function endOf(meeting: Meeting): Date | null {
  if (!meeting.ends_at) return null;
  const d = new Date(meeting.ends_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Happening right now: started, and not yet finished. */
export function isInProgress(meeting: Meeting, now = new Date()): boolean {
  if (meeting.is_cancelled) return false;
  const start = startOf(meeting);
  if (!start || start > now) return false;
  const end = endOf(meeting);
  // With no end time, treat it as the hour Outlook would have defaulted to -
  // long enough to be useful, short enough not to linger all day.
  const finish = end ?? new Date(start.getTime() + 3600000);
  return finish > now;
}

export function isToday(meeting: Meeting, now = new Date()): boolean {
  const start = startOf(meeting);
  return !!start && dayNumber(start) === dayNumber(now);
}

/**
 * The meeting to walk into next: one happening now, otherwise the soonest one
 * still to start today or later. Cancelled meetings are never "next".
 */
export function upNext(meetings: Meeting[], now = new Date()): Meeting | null {
  const live = meetings.find((m) => isInProgress(m, now));
  if (live) return live;
  const ahead = meetings
    .filter((m) => !m.is_cancelled && !m.all_day)
    .map((m) => ({ m, start: startOf(m) }))
    .filter((x): x is { m: Meeting; start: Date } => !!x.start && x.start > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  return ahead.length ? ahead[0].m : null;
}

export function todaysMeetings(meetings: Meeting[], now = new Date()): Meeting[] {
  return meetings
    .filter((m) => isToday(m, now))
    .sort(byStart);
}

export function byStart(a: Meeting, b: Meeting): number {
  // All-day entries head the day; they have no time to sort against.
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  const x = startOf(a)?.getTime() ?? Infinity;
  const y = startOf(b)?.getTime() ?? Infinity;
  return x - y;
}

function label(date: Date, now: Date): string {
  const diff = dayNumber(date) - dayNumber(now);
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const stamp = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (diff === 0) return `Today · ${weekday} ${stamp}`;
  if (diff === 1) return `Tomorrow · ${weekday} ${stamp}`;
  if (diff === -1) return `Yesterday · ${weekday} ${stamp}`;
  return `${weekday} ${stamp}`;
}

export function dayLabel(date: Date | null, now = new Date()): string {
  return date ? label(date, now) : 'No date set';
}

/**
 * Group meetings into the sections the page shows.
 *
 * `past` is returned in reverse - most recent first - because looking backwards
 * you want last week's meeting, not one from two months ago.
 */
export function bucket(meetings: Meeting[], now = new Date()): Bucket[] {
  const today = dayNumber(now);
  const groups: Record<BucketKey, Map<number, Meeting[]>> = {
    today: new Map(), tomorrow: new Map(), week: new Map(),
    later: new Map(), undated: new Map(), past: new Map(),
  };

  for (const meeting of meetings) {
    const start = startOf(meeting);
    if (!start) {
      push(groups.undated, -1, meeting);
      continue;
    }
    const day = dayNumber(start);
    const diff = day - today;
    // A meeting still running counts as today's even if it began yesterday
    // evening, because that is where you would look for it.
    if (diff === 0 || (diff < 0 && isInProgress(meeting, now))) push(groups.today, today, meeting);
    else if (diff < 0) push(groups.past, day, meeting);
    else if (diff === 1) push(groups.tomorrow, day, meeting);
    else if (diff <= 7) push(groups.week, day, meeting);
    else push(groups.later, day, meeting);
  }

  const build = (key: BucketKey, text: string, newestFirst = false): Bucket => {
    const days = [...groups[key].entries()]
      .sort((a, b) => (newestFirst ? b[0] - a[0] : a[0] - b[0]))
      .map(([day, list]) => ({
        date: day < 0 ? null : new Date(day * DAY),
        meetings: [...list].sort(byStart),
      }));
    return { key, label: text, days, count: days.reduce((n, d) => n + d.meetings.length, 0) };
  };

  return [
    build('today', 'Today'),
    build('tomorrow', 'Tomorrow'),
    build('week', 'The next 7 days'),
    build('later', 'Later'),
    build('undated', 'No date set'),
    build('past', 'Past meetings', true),
  ].filter((b) => b.count > 0);
}

function push(map: Map<number, Meeting[]>, day: number, meeting: Meeting) {
  const list = map.get(day);
  if (list) list.push(meeting);
  else map.set(day, [meeting]);
}

/** "in 40 min" / "started 10 min ago" / "in 3 days", for a meeting's start. */
export function relativeStart(meeting: Meeting, now = new Date()): string {
  const start = startOf(meeting);
  if (!start) return '';
  if (isInProgress(meeting, now)) return 'happening now';
  const minutes = Math.round((start.getTime() - now.getTime()) / 60000);
  const ago = minutes < 0;
  const n = Math.abs(minutes);
  const say = (text: string) => (ago ? `${text} ago` : `in ${text}`);
  if (n < 1) return 'starting now';
  if (n < 60) return say(`${n} min`);
  const hours = Math.round(n / 60);
  if (hours < 24) return say(`${hours} hour${hours === 1 ? '' : 's'}`);
  const days = Math.round(hours / 24);
  return say(`${days} day${days === 1 ? '' : 's'}`);
}

const clock = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Just the start: "10:30 AM", or "All day". */
export function startLabel(meeting: Meeting): string {
  if (meeting.all_day) return 'All day';
  const start = startOf(meeting);
  return start ? clock(start) : '—';
}

/** Just the end, ready to sit under the start: "– 12:00 PM". */
export function endLabel(meeting: Meeting): string {
  if (meeting.all_day) return '';
  const end = endOf(meeting);
  return end ? `– ${clock(end)}` : '';
}

/** "10:30 – 12:00", or "All day". */
export function timeRange(meeting: Meeting): string {
  if (meeting.all_day) return 'All day';
  const start = startOf(meeting);
  if (!start) return '';
  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const end = endOf(meeting);
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}
