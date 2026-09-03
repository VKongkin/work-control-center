import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, ArrowRight } from 'lucide-react';
import { apiError, searchApi } from '../api/client';
import { SearchResult } from '../types';
import { Badge, Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '../components/ui';

const ROUTE: Record<string, string> = {
  task: '/tasks',
  followup: '/followups',
  issue: '/issues',
  project: '/projects',
  person: '/people',
  department: '/departments',
  vendor: '/vendors',
  system: '/systems',
  meeting: '/meetings',
};

export default function SearchPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState('');

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults((await searchApi.search(q.trim())).data);
    } catch (err) {
      setError(apiError(err));
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  const kinds = results ? Array.from(new Set(results.map((r) => r.type))) : [];
  const visible = results?.filter((r) => !kind || r.type === kind) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Search" subtitle="Across tasks, follow-ups, issues, projects and people" />

      <form onSubmit={run} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-3 text-slate-400" size={18} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything…"
            className="block w-full rounded-lg border-0 py-2.5 pl-11 pr-3 text-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600"
          />
        </div>
        <Button variant="primary" type="submit" disabled={loading || !q.trim()}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <Spinner label="Searching…" />
      ) : results === null ? (
        <EmptyState title="Search your workspace" hint="Find anything by title or description." />
      ) : results.length === 0 ? (
        <EmptyState title={`Nothing matches "${q}"`} hint="Try a shorter or different term." />
      ) : (
        <>
          {kinds.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setKind('')}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${
                  kind === '' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
                }`}
              >
                All ({results.length})
              </button>
              {kinds.map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k === kind ? '' : k)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium capitalize ${
                    kind === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {k} ({results.filter((r) => r.type === k).length})
                </button>
              ))}
            </div>
          )}

          <p className="text-sm text-slate-500">
            {visible.length} result{visible.length === 1 ? '' : 's'}
          </p>

          <div className="grid gap-3">
            {visible.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => navigate(ROUTE[r.type] ?? '/')}
                className="group flex w-full items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{r.title}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
                      {r.type}
                    </span>
                    {r.status && <Badge value={r.status} />}
                  </div>
                  {r.description && <p className="mt-1 text-sm text-slate-600">{r.description}</p>}
                </div>
                <ArrowRight
                  size={16}
                  className="mt-1 shrink-0 text-slate-300 transition-colors group-hover:text-blue-600"
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
