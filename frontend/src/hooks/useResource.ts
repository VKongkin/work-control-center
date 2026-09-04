import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiError } from '../api/client';
import { useToast } from '../components/Toast';

interface Api<T> {
  getAll: (params?: any) => Promise<{ data: T[] }>;
  create: (data: Partial<T>) => Promise<{ data: T }>;
  update: (id: number, data: Partial<T>) => Promise<{ data: T }>;
  delete: (id: number) => Promise<any>;
}

/**
 * List state plus the three mutations, sharing one loading/error surface.
 * Every mutation refreshes the list so the table can never drift from the server.
 *
 * create/update/remove resolve to `true` on success, or the server's message on
 * failure, so a form can show it inline instead of only as a toast that the
 * user has to remember while fixing the field.
 */
export function useResource<T extends { id: number }>(
  api: Api<T>,
  label: string,
  params?: Record<string, any>
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const key = JSON.stringify(params ?? {});
  const stableParams = useMemo(() => JSON.parse(key), [key]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAll(stableParams);
      setItems(res.data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [api, stableParams]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Something outside this page changed these records - a calendar sync, say.
  // Without this the table would keep showing the pre-sync list until the user
  // reloaded, which is exactly the stale-data problem we set out to remove.
  useEffect(() => {
    const onRefresh = (e: Event) => {
      if ((e as CustomEvent<{ label?: string }>).detail?.label === label) refresh();
    };
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
  }, [label, refresh]);

  const create = useCallback(
    async (data: Partial<T>): Promise<true | string> => {
      setSaving(true);
      try {
        await api.create(data);
        announce(label);
        toast.success(`${label} created`);
        await refresh();
        return true;
      } catch (err) {
        const message = apiError(err);
        toast.error(message);
        return message;
      } finally {
        setSaving(false);
      }
    },
    [api, label, refresh, toast]
  );

  const update = useCallback(
    async (id: number, data: Partial<T>, quiet = false): Promise<true | string> => {
      setSaving(true);
      try {
        await api.update(id, data);
        announce(label);
        if (!quiet) toast.success(`${label} updated`);
        await refresh();
        return true;
      } catch (err) {
        const message = apiError(err);
        toast.error(message);
        return message;
      } finally {
        setSaving(false);
      }
    },
    [api, label, refresh, toast]
  );

  const remove = useCallback(
    async (id: number): Promise<true | string> => {
      setSaving(true);
      try {
        await api.delete(id);
        announce(label);
        toast.success(`${label} deleted`);
        await refresh();
        return true;
      } catch (err) {
        const message = apiError(err);
        toast.error(message);
        return message;
      } finally {
        setSaving(false);
      }
    },
    [api, label, refresh, toast]
  );

  return { items, loading, error, saving, refresh, create, update, remove };
}

/**
 * Broadcast that a record changed.
 *
 * The relation dropdowns are shared app-wide and used to load once at startup,
 * so a person added under Directory stayed invisible to every form until a
 * page refresh. Announcing the change here lets anything holding cached copies
 * refresh itself, without each page having to remember to ask.
 */
export const MUTATION_EVENT = 'wcc:mutated';

function announce(label: string) {
  window.dispatchEvent(new CustomEvent(MUTATION_EVENT, { detail: { label } }));
}

/**
 * Ask any list of `label` to reload.
 *
 * Separate from MUTATION_EVENT on purpose: that one says "a record changed, so
 * cached dropdowns are stale", and every list already refreshes itself after
 * its own edits. This one is for changes made somewhere else entirely.
 */
export const REFRESH_EVENT = 'wcc:refresh';

export function requestRefresh(label: string) {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT, { detail: { label } }));
}

/** Strip '' -> null so empty form fields clear the column instead of failing validation. */
export function clean<T extends Record<string, any>>(obj: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === '' ? null : v;
  return out;
}

/** '' | '3' -> null | 3, for foreign-key <select> values. */
export const toId = (v: string): number | null => (v === '' ? null : Number(v));
