import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, Lock, RefreshCw, CalendarRange, Search, X } from 'lucide-react';
import CrudPage, { FieldDef, ListRender } from '../components/CrudPage';
import Agenda from '../components/Agenda';
import { DetailRow } from '../components/DetailView';
import { calendarApi, meetingApi, meetingSync, apiError } from '../api/client';
import { requestRefresh } from '../hooks/useResource';
import { useCalendarWatch } from '../hooks/useCalendarWatch';
import { useToast } from '../components/Toast';
import { Button } from '../components/ui';
import { Meeting, SyncSummary } from '../types';
import { fmtDate } from '../lib/constants';
import { dayNumber, startOf } from '../lib/agenda';

const fields: FieldDef[] = [
  { key: 'title', label: 'Title', type: 'text', required: true, full: true },
  { key: 'meeting_date', label: 'Starts', type: 'datetime' },
  { key: 'ends_at', label: 'Ends', type: 'datetime' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'organizer', label: 'Organizer', type: 'text' },
  { key: 'primary_contact_id', label: 'Primary contact', type: 'lookup', lookup: 'people' },
  { key: 'participants', label: 'Participants', type: 'textarea', full: true, placeholder: 'Names, comma separated' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  { key: 'decisions', label: 'Decisions', type: 'textarea', full: true },
];

const isSynced = (m: Meeting) => !!m.source && m.source !== 'WCC';

function SourceBadges({ meeting }: { meeting: Meeting }) {
  const edited = meeting.locally_edited ?? [];
  return (
    <>
      {isSynced(meeting) && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
          title={
            meeting.last_synced_at
              ? `From your calendar. Last synced ${fmtDate(meeting.last_synced_at)}.`
              : 'From your connected calendar.'
          }
        >
          <CalendarCheck2 size={12} /> {meeting.source === 'microsoft' ? 'Outlook' : 'Calendar'}
        </span>
      )}
      {meeting.all_day && (
        <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
          All day
        </span>
      )}
      {meeting.is_cancelled && (
        <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200">
          Cancelled
        </span>
      )}
      {edited.length > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
          title={`Your edits to ${edited.join(', ')} are kept on every sync.`}
        >
          <Lock size={12} /> {edited.length} kept
        </span>
      )}
    </>
  );
}

type Scope = 'today' | 'upcoming' | 'all';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'all', label: 'All' },
];

export default function MeetingsPage() {
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [scope, setScope] = useState<Scope>('upcoming');
  const [query, setQuery] = useState('');

  // "in 40 min" has to keep being true while the page sits open, and a meeting
  // has to move itself from Up next to Happening now without a reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // The server syncs on its own schedule, so the list has to notice a refresh
  // that nobody on this page asked for.
  const { connections, refresh: refreshConnections } = useCalendarWatch((changed) => {
    const parts = [
      changed.created && `${changed.created} new`,
      changed.updated && `${changed.updated} updated`,
      changed.cancelled && `${changed.cancelled} cancelled`,
    ].filter(Boolean);
    if (parts.length) toast.success(`Calendar synced: ${parts.join(', ')}`);
  });

  async function syncNow() {
    setSyncing(true);
    try {
      const { data } = await calendarApi.syncAll();
      const totals: SyncSummary = { created: 0, updated: 0, unchanged: 0, protected: 0, cancelled: 0 };
      for (const r of data.results ?? []) {
        if (!r.ok) continue;
        for (const k of Object.keys(totals) as (keyof SyncSummary)[]) totals[k] += r.summary?.[k] ?? 0;
      }
      if (data.failed) {
        const first = (data.results ?? []).find((r: any) => !r.ok);
        toast.error(first?.error ?? 'A calendar could not be synced');
      }
      if (data.succeeded) {
        const parts = [
          totals.created && `${totals.created} new`,
          totals.updated && `${totals.updated} updated`,
          totals.cancelled && `${totals.cancelled} cancelled`,
          totals.protected && `${totals.protected} of your edits kept`,
        ].filter(Boolean);
        toast.success(parts.length ? `Synced: ${parts.join(', ')}` : 'Already up to date');
      }
      requestRefresh('Meeting');
      await refreshConnections();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSyncing(false);
    }
  }

  async function unlock(meeting: Meeting, field: string) {
    try {
      await meetingSync.unlock(meeting.id, field);
      toast.success(`${field.replace('_', ' ')} will follow the calendar again`);
      requestRefresh('Meeting');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  /** Calendar detail lives outside the form, so the detail view adds it here. */
  function extraDetailRows(row: Meeting): DetailRow[] {
    if (!isSynced(row)) return [];
    const edited = row.locally_edited ?? [];
    return [
      {
        label: 'Source',
        value: `${row.source === 'microsoft' ? 'Microsoft 365 calendar' : 'Published calendar feed'}${
          row.last_synced_at ? ` · last synced ${fmtDate(row.last_synced_at)}` : ''
        }`,
      },
      row.join_url
        ? {
            label: 'Join',
            value: (
              <a href={row.join_url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                Open the online meeting
              </a>
            ),
          }
        : { label: 'Join', value: null },
      edited.length
        ? {
            label: 'Your edits',
            wide: true,
            value: (
              <div className="space-y-1.5">
                <p className="text-slate-600">
                  These fields keep your version and are never overwritten by a sync.
                </p>
                <div className="flex flex-wrap gap-2">
                  {edited.map((f) => (
                    <button
                      key={f}
                      onClick={() => unlock(row, f)}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
                      title="Let this field follow the calendar again"
                    >
                      <Lock size={12} /> {f.replace(/_/g, ' ')}
                      <span className="text-amber-600">· release</span>
                    </button>
                  ))}
                </div>
              </div>
            ),
          }
        : { label: 'Your edits', value: null },
    ];
  }

  const header = (
    <>
      {connections.length > 0 && (
        <Button onClick={syncNow} disabled={syncing}>
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync calendar'}
        </Button>
      )}
      <Link
        to="/calendars"
        className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
      >
        <CalendarRange size={16} />
        {connections.length ? 'Calendars' : 'Connect a calendar'}
      </Link>
    </>
  );

  /** Scope and search narrow what the agenda is given; it does the grouping. */
  function visible(items: Meeting[]): Meeting[] {
    const today = dayNumber(now);
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      const start = startOf(m);
      // A meeting with no date is not in the past, so hiding it from the
      // default view would be losing it. Only "Today" can reasonably exclude it.
      if (scope === 'today' && (!start || dayNumber(start) !== today)) return false;
      if (scope === 'upcoming' && start && dayNumber(start) < today) return false;
      if (!q) return true;
      return [m.title, m.location, m.organizer, m.participants, m.notes, m.decisions]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }

  function renderList(list: ListRender<Meeting>) {
    const shown = visible(list.items);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Which meetings">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                onClick={() => setScope(s.value)}
                aria-pressed={scope === s.value}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  scope === s.value
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="meeting-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search meetings…"
              aria-label="Search meetings"
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

          <p className="text-sm text-slate-500">
            {shown.length} of {list.items.length}
          </p>
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <p className="font-medium text-slate-900">
              {query ? `Nothing matches “${query}”` : scope === 'today'
                ? 'Nothing in the diary today'
                : 'Nothing scheduled'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {query
                ? 'Searching titles, people, locations and notes.'
                : scope === 'all'
                  ? 'Meetings you create or sync from Outlook appear here.'
                  : 'Try “All” to include meetings that have already happened.'}
            </p>
          </div>
        ) : (
          <Agenda
            meetings={shown}
            now={now}
            onView={list.onView}
            onEdit={list.onEdit}
            onDelete={list.onDelete}
            blockedReason={list.blockedReason}
            badges={(m) => <SourceBadges meeting={m} />}
          />
        )}
      </div>
    );
  }

  return (
    <CrudPage<Meeting>
      title="Meetings" singular="Meeting" api={meetingApi}
      fields={fields} attachAs="meeting"
      labelKey="title"
      subtitle="Today first, then what is coming"
      emptyHint="Capture meetings so decisions do not live only in your head."
      headerExtra={header}
      rowBadges={(m) => <SourceBadges meeting={m} />}
      hideFields={(m) => (m?.all_day ? ['ends_at'] : [])}
      extraDetailRows={extraDetailRows}
      listParams={{ order: 'asc', limit: 500 }}
      renderList={renderList}
      blockDelete={(m) =>
        isSynced(m)
          ? 'This came from your connected calendar. Cancel it in Outlook, or disconnect the calendar to take ownership.'
          : null
      }
    />
  );
}
