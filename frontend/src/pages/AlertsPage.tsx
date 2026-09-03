import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, ArrowRight } from 'lucide-react';
import { alertsApi, apiError } from '../api/client';
import { Alert } from '../types';
import { Badge, Button, EmptyState, ErrorBanner, PageHeader, Spinner } from '../components/ui';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export default function AlertsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [severity, setSeverity] = useState(searchParams.get('severity') ?? '');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAlerts((await alertsApi.getAll()).data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setSearchParams(severity ? { severity } : {}, { replace: true });
  }, [severity, setSearchParams]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of alerts) c[a.severity] = (c[a.severity] ?? 0) + 1;
    return c;
  }, [alerts]);

  const visible = useMemo(
    () => (severity ? alerts.filter((a) => a.severity === severity) : alerts),
    [alerts, severity]
  );

  /** Alerts point at a task or a follow-up; send the user to the right list. */
  function open(a: Alert) {
    if (a.entity_type === 'followup') navigate('/followups');
    else navigate('/tasks');
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alerts"
        subtitle="Detected automatically from your open work"
        action={
          <Button onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSeverity('')}
          className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
            severity === '' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
          }`}
        >
          All ({alerts.length})
        </button>
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => setSeverity(s === severity ? '' : s)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium capitalize transition-colors ${
              severity === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
            }`}
          >
            {s} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <Spinner label="Checking for alerts…" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={alerts.length ? 'Nothing at this severity' : 'No active alerts'}
          hint={alerts.length ? 'Try another severity.' : 'Nothing is overdue, blocked or forgotten right now.'}
        />
      ) : (
        <div className="grid gap-3">
          {visible.map((a) => (
            <button
              key={a.id}
              onClick={() => open(a)}
              className="group flex w-full items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900">{a.title}</p>
                  <Badge value={a.severity.toUpperCase()} />
                </div>
                <p className="mt-1 text-sm text-slate-600">{a.description}</p>
                <p className="mt-1.5 text-xs uppercase tracking-wide text-slate-400">
                  {a.type.replace(/_/g, ' ')}
                </p>
              </div>
              <ArrowRight
                size={16}
                className="mt-1 shrink-0 text-slate-300 transition-colors group-hover:text-blue-600"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
