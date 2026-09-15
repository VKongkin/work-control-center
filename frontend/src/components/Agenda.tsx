import { ReactNode, useMemo, useState } from 'react';
import { ChevronRight, Pencil, Trash2, Video } from 'lucide-react';
import { Meeting } from '../types';
import {
  Bucket, bucket, dayLabel, endLabel, isInProgress, relativeStart, startLabel, timeRange, upNext,
} from '../lib/agenda';

/**
 * Meetings as a diary rather than a table.
 *
 * A table sorted by a date column makes you scan for today; an agenda puts it
 * first and says how long until the next one. Past meetings are still here -
 * the notes on them are the point - but they are folded away, because nobody
 * opens this page to read last month's.
 */

interface Props {
  meetings: Meeting[];
  onView: (m: Meeting) => void;
  onEdit: (m: Meeting) => void;
  onDelete: (m: Meeting) => void;
  blockedReason: (m: Meeting) => string | null;
  badges?: (m: Meeting) => ReactNode;
  /** Redrawn every minute by the page, so "in 40 min" stays true. */
  now: Date;
}

export default function Agenda({
  meetings, onView, onEdit, onDelete, blockedReason, badges, now,
}: Props) {
  const buckets = useMemo(() => bucket(meetings, now), [meetings, now]);
  const next = useMemo(() => upNext(meetings, now), [meetings, now]);
  const [showPast, setShowPast] = useState(false);

  const upcoming = buckets.filter((b) => b.key !== 'past');
  const past = buckets.find((b) => b.key === 'past');

  return (
    <div className="space-y-6">
      {next && <UpNext meeting={next} now={now} onView={onView} />}

      {upcoming.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="font-medium text-slate-900">Nothing scheduled</p>
          <p className="mt-1 text-sm text-slate-500">
            {past?.count
              ? 'Your diary is clear from here. Past meetings are below.'
              : 'Meetings you create or sync from Outlook will appear here.'}
          </p>
        </div>
      )}

      {upcoming.map((b) => (
        <Section
          key={b.key} bucket={b} now={now}
          onView={onView} onEdit={onEdit} onDelete={onDelete}
          blockedReason={blockedReason} badges={badges}
        />
      ))}

      {past && past.count > 0 && (
        <div>
          <button
            onClick={() => setShowPast((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
            aria-expanded={showPast}
          >
            <ChevronRight
              size={16}
              className={`transition-transform ${showPast ? 'rotate-90' : ''}`}
            />
            Past meetings
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {past.count}
            </span>
          </button>
          {showPast && (
            <div className="mt-2">
              <Section
                bucket={past} now={now} muted
                onView={onView} onEdit={onEdit} onDelete={onDelete}
                blockedReason={blockedReason} badges={badges}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UpNext({ meeting, now, onView }: { meeting: Meeting; now: Date; onView: (m: Meeting) => void }) {
  const live = isInProgress(meeting, now);
  return (
    <div
      className={`rounded-xl border p-5 ${
        live ? 'border-emerald-300 bg-emerald-50' : 'border-blue-200 bg-blue-50'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-wider ${
            live ? 'text-emerald-700' : 'text-blue-700'
          }`}>
            {live ? 'Happening now' : 'Up next'}
          </p>
          <button
            onClick={() => onView(meeting)}
            className="mt-1 block text-left text-lg font-semibold text-slate-900 hover:underline"
          >
            {meeting.title}
          </button>
          <p className="mt-1 text-sm text-slate-600">
            {timeRange(meeting)} · {relativeStart(meeting, now)}
            {meeting.location && !meeting.join_url ? ` · ${meeting.location}` : ''}
          </p>
        </div>
        {meeting.join_url && (
          <a
            href={meeting.join_url}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white ${
              live ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <Video size={16} /> Join
          </a>
        )}
      </div>
    </div>
  );
}

function Section({
  bucket: b, now, onView, onEdit, onDelete, blockedReason, badges, muted,
}: {
  bucket: Bucket;
  now: Date;
  onView: (m: Meeting) => void;
  onEdit: (m: Meeting) => void;
  onDelete: (m: Meeting) => void;
  blockedReason: (m: Meeting) => string | null;
  badges?: (m: Meeting) => ReactNode;
  muted?: boolean;
}) {
  const isToday = b.key === 'today';
  return (
    <section>
      <h2 className={`mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider ${
        isToday ? 'text-blue-700' : 'text-slate-400'
      }`}>
        {b.label}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-slate-600">
          {b.count}
        </span>
      </h2>

      <div className={`overflow-hidden rounded-xl border bg-white ${
        isToday ? 'border-blue-200 ring-1 ring-blue-100' : 'border-slate-200'
      }`}>
        {b.days.map((day, i) => (
          <div key={day.date?.toISOString() ?? 'undated'}>
            {/* One heading per day, except inside Today and Tomorrow where the
                section heading has already said which day it is. */}
            {b.key !== 'today' && b.key !== 'tomorrow' && b.key !== 'undated' && (
              <p className={`px-4 py-2 text-xs font-medium text-slate-500 ${
                i === 0 ? 'bg-slate-50' : 'border-t border-slate-200 bg-slate-50'
              }`}>
                {dayLabel(day.date, now)}
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {day.meetings.map((m) => (
                <Row
                  key={m.id} meeting={m} now={now} muted={muted}
                  // "in 3 days" on every future row is noise; it earns its place
                  // only for the day you are actually living through.
                  showRelative={b.key === 'today'}
                  onView={onView} onEdit={onEdit} onDelete={onDelete}
                  blockedReason={blockedReason} badges={badges}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Row({
  meeting, now, onView, onEdit, onDelete, blockedReason, badges, muted, showRelative,
}: {
  meeting: Meeting;
  now: Date;
  onView: (m: Meeting) => void;
  onEdit: (m: Meeting) => void;
  onDelete: (m: Meeting) => void;
  blockedReason: (m: Meeting) => string | null;
  badges?: (m: Meeting) => ReactNode;
  muted?: boolean;
  showRelative?: boolean;
}) {
  const live = isInProgress(meeting, now);
  const blocked = blockedReason(meeting);
  const cancelled = !!meeting.is_cancelled;
  const end = endLabel(meeting);

  return (
    <li
      data-row-id={meeting.id}
      className={`group px-4 py-3 transition-colors hover:bg-slate-50/80 sm:flex sm:items-start sm:gap-4 ${
        live ? 'bg-emerald-50/60' : ''
      }`}
    >
      {/* Narrow screens get the times on one line above the title, because a
          fixed time column there leaves the title too little room to read. */}
      <p className={`mb-1 flex flex-wrap items-center gap-2 text-xs tabular-nums sm:hidden ${
        live ? 'font-semibold text-emerald-700' : 'font-medium text-slate-600'
      }`}>
        <span>{timeRange(meeting)}</span>
        {showRelative && !meeting.all_day && !cancelled && (
          <span className={live ? '' : 'font-normal text-slate-400'}>
            {relativeStart(meeting, now)}
          </span>
        )}
      </p>

      {/* Fixed width so the eye runs straight down the column, and the start and
          end stacked so a 12-hour locale cannot wrap them into a mess. */}
      <div className={`hidden w-24 shrink-0 whitespace-nowrap pt-0.5 text-sm tabular-nums sm:block ${
        cancelled || muted ? 'text-slate-400' : 'text-slate-700'
      }`}>
        <p className={live ? 'font-semibold text-emerald-700' : 'font-medium'}>
          {startLabel(meeting)}
        </p>
        {end && <p className="text-xs text-slate-400">{end}</p>}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onView(meeting)}
            className={`text-left text-sm font-medium hover:text-blue-700 ${
              cancelled ? 'text-slate-500 line-through' : muted ? 'text-slate-600' : 'text-slate-900'
            }`}
          >
            {meeting.title}
          </button>
          {badges?.(meeting)}
          {showRelative && !meeting.all_day && !cancelled && (
            <span className={`hidden text-xs sm:inline ${
              live ? 'font-medium text-emerald-700' : 'text-slate-400'
            }`}>
              {relativeStart(meeting, now)}
            </span>
          )}
        </div>
        {(meeting.location || meeting.organizer || meeting.participants) && (
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {[meeting.location, meeting.organizer, meeting.participants]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>

      <div className="mt-2 flex shrink-0 items-center gap-1 sm:mt-0">
        {meeting.join_url && !cancelled && (
          <a
            href={meeting.join_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            <Video size={15} /> Join
          </a>
        )}
        {/* Hidden until hover on a pointer device, so the diary reads cleanly -
            but always visible on touch, where hover never happens. */}
        <button
          onClick={() => onEdit(meeting)}
          aria-label="Edit"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={() => onDelete(meeting)}
          aria-label="Delete"
          disabled={!!blocked}
          title={blocked ?? undefined}
          className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-50 focus:opacity-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}
