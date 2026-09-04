import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, Lock, Video, RefreshCw, CalendarRange } from 'lucide-react';
import CrudPage, { ColumnDef, FieldDef } from '../components/CrudPage';
import { DetailRow } from '../components/DetailView';
import { calendarApi, meetingApi, meetingSync, apiError } from '../api/client';
import { requestRefresh } from '../hooks/useResource';
import { useToast } from '../components/Toast';
import { Button } from '../components/ui';
import { CalendarConnection, Meeting, SyncSummary } from '../types';
import { fmtDate, fmtDateTime } from '../lib/constants';

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

const columns: ColumnDef<Meeting>[] = [
  { header: 'Meeting', key: 'title' },
  {
    header: 'When',
    // An all-day entry has no time of day; printing "12:00 AM" would invent one.
    cell: (r) => (
      <span className="text-slate-600">
        {r.all_day ? `${fmtDate(r.meeting_date)} · all day` : fmtDateTime(r.meeting_date)}
      </span>
    ),
  },
  {
    header: 'Where',
    cell: (r) =>
      r.join_url ? (
        <a
          href={r.join_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <Video size={14} /> Join
        </a>
      ) : (
        <span className="text-slate-600">{r.location || '—'}</span>
      ),
  },
  { header: 'Participants', key: 'participants' },
  {
    header: 'Contact',
    cell: (r, lk) => <span className="text-slate-600">{lk.nameOf('people', r.primary_contact_id)}</span>,
  },
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

export default function MeetingsPage() {
  const toast = useToast();
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    calendarApi
      .getAll()
      .then((r) => setConnections(r.data as CalendarConnection[]))
      .catch(() => setConnections([]));
  }, []);

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
      const fresh = await calendarApi.getAll();
      setConnections(fresh.data as CalendarConnection[]);
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

  return (
    <CrudPage<Meeting>
      title="Meetings" singular="Meeting" api={meetingApi}
      fields={fields} columns={columns} attachAs="meeting"
      labelKey="title"
      subtitle="Notes, decisions and who was there"
      emptyHint="Capture meetings so decisions do not live only in your head."
      headerExtra={header}
      rowBadges={(m) => <SourceBadges meeting={m} />}
      hideFields={(m) => (m?.all_day ? ['ends_at'] : [])}
      extraDetailRows={extraDetailRows}
      blockDelete={(m) =>
        isSynced(m)
          ? 'This came from your connected calendar. Cancel it in Outlook, or disconnect the calendar to take ownership.'
          : null
      }
    />
  );
}
