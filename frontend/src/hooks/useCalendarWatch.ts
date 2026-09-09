import { useCallback, useEffect, useRef, useState } from 'react';
import { calendarApi } from '../api/client';
import { CalendarConnection } from '../types';
import { requestRefresh } from './useResource';

/**
 * Notice when the server has synced a calendar behind your back.
 *
 * Syncing now happens on a schedule in the backend, which means the meeting
 * list can go stale while you are sitting on the page looking at it - the exact
 * complaint that started this work. There is no push channel, so this checks
 * the connections periodically and reloads the list when a sync has landed.
 *
 * Two things keep it cheap: it only runs while the tab is actually visible, and
 * it checks immediately on becoming visible again, so a laptop opened after
 * lunch catches up at once rather than waiting out another interval.
 */
export function useCalendarWatch(
  onSynced?: (changed: { created: number; updated: number; cancelled: number }) => void,
  pollSeconds = 60
) {
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const stamps = useRef<Record<number, string>>({});
  const primed = useRef(false);
  const notify = useRef(onSynced);
  notify.current = onSynced;

  const check = useCallback(async () => {
    let rows: CalendarConnection[];
    try {
      rows = (await calendarApi.getAll()).data as CalendarConnection[];
    } catch {
      return; // a failed poll is not worth telling anyone about
    }
    setConnections(rows);

    const seen: Record<number, string> = {};
    let moved = false;
    for (const row of rows) {
      const at = row.last_sync_at ?? '';
      seen[row.id] = at;
      if (primed.current && at && stamps.current[row.id] !== at) moved = true;
    }
    const wasPrimed = primed.current;
    stamps.current = seen;
    primed.current = true;

    // The first check only establishes a baseline; announcing then would fire
    // on every page load for a sync that happened hours ago.
    if (!wasPrimed || !moved) return;

    requestRefresh('Meeting');
    const totals = { created: 0, updated: 0, cancelled: 0 };
    for (const row of rows) {
      if (!row.last_sync_summary) continue;
      try {
        const s = JSON.parse(row.last_sync_summary);
        totals.created += s.created ?? 0;
        totals.updated += s.updated ?? 0;
        totals.cancelled += s.cancelled ?? 0;
      } catch {
        /* a summary we cannot read is not worth failing over */
      }
    }
    notify.current?.(totals);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (!timer) timer = setInterval(check, pollSeconds * 1000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    // Checking on every visibility change, not just on resuming the timer, is
    // what makes a tab you come back to correct straight away rather than at
    // the end of whatever interval it was part-way through.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        check();
        start();
      } else {
        stop();
      }
    };

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [check, pollSeconds]);

  return { connections, refresh: check };
}
