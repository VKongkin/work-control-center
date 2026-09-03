import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  peopleApi, departmentApi, vendorApi, systemApi, projectApi, categoryApi,
} from '../api/client';
import { Option } from '../lib/constants';
import { MUTATION_EVENT } from './useResource';

interface Lookups {
  people: Option[];
  departments: Option[];
  vendors: Option[];
  systems: Option[];
  projects: Option[];
  categories: Option[];
  /** id -> name, for rendering a foreign key as a readable label. */
  nameOf: (kind: keyof Omit<Lookups, 'nameOf' | 'reload'>, id?: number | null) => string;
  reload: () => void;
}

const empty: Option[] = [];
const LookupCtx = createContext<Lookups>({
  people: empty, departments: empty, vendors: empty,
  systems: empty, projects: empty, categories: empty,
  nameOf: () => '—',
  reload: () => {},
});

export const useLookups = () => useContext(LookupCtx);

const toOptions = (rows: any[], key = 'name'): Option[] =>
  rows.map((r) => ({ value: String(r.id), label: r[key] }));

export function LookupProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({
    people: empty, departments: empty, vendors: empty,
    systems: empty, projects: empty, categories: empty,
  });

  const load = useCallback(async () => {
    // Dropdowns should not break the page they live on, so failures are
    // swallowed here - the field simply renders with no options.
    const get = async (fn: () => Promise<any>, key = 'name') => {
      try {
        return toOptions((await fn()).data, key);
      } catch {
        return empty;
      }
    };
    const [people, departments, vendors, systems, projects, categories] = await Promise.all([
      get(() => peopleApi.getAll({ limit: 500 })),
      get(() => departmentApi.getAll({ limit: 500 })),
      get(() => vendorApi.getAll({ limit: 500 })),
      get(() => systemApi.getAll({ limit: 500 })),
      get(() => projectApi.getAll({ limit: 500 })),
      get(() => categoryApi.getAll({ limit: 500 })),
    ]);
    setState({ people, departments, vendors, systems, projects, categories });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Refresh when one of these entities changes anywhere in the app, so a
   * person added under Directory shows up in the next form the user opens
   * without them having to reload the page.
   */
  useEffect(() => {
    const FEEDS_LOOKUPS = new Set([
      'Person', 'Department', 'Vendor', 'System', 'Project', 'Category',
    ]);
    const onMutation = (e: Event) => {
      const label = (e as CustomEvent<{ label?: string }>).detail?.label;
      if (label && FEEDS_LOOKUPS.has(label)) load();
    };
    window.addEventListener(MUTATION_EVENT, onMutation);
    return () => window.removeEventListener(MUTATION_EVENT, onMutation);
  }, [load]);

  const nameOf: Lookups['nameOf'] = (kind, id) => {
    if (id === null || id === undefined) return '—';
    return (state as any)[kind]?.find((o: Option) => o.value === String(id))?.label ?? '—';
  };

  return (
    <LookupCtx.Provider value={{ ...state, nameOf, reload: load }}>
      {children}
    </LookupCtx.Provider>
  );
}
