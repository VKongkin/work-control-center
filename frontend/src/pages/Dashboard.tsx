import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, Eye, Plus, TrendingUp, Zap, ArrowRight,
} from 'lucide-react';
import StatCard from '../components/StatCard';
import { alertsApi, apiError, dashboardApi, taskApi } from '../api/client';
import { Alert, DashboardStats, Task } from '../types';
import { Badge, Button, ErrorBanner, PageHeader, Spinner } from '../components/ui';
import { fmtDate, isOverdue } from '../lib/constants';

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [attention, setAttention] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, alertsRes, tasksRes] = await Promise.all([
        dashboardApi.getStats(),
        alertsApi.getAll(),
        taskApi.getAll({ limit: 200 }),
      ]);
      setStats(statsRes.data.stats);
      setAlerts(alertsRes.data);

      // "Needs attention" = open work that is critical or past its due date.
      const open = (tasksRes.data as Task[]).filter(
        (t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
      );
      const rank = { P0_CRITICAL: 0, P1_HIGH: 1, P2_MEDIUM: 2, P3_LOW: 3 } as Record<string, number>;
      setAttention(
        open
          .filter((t) => t.priority === 'P0_CRITICAL' || isOverdue(t.due_date, t.status))
          .sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9))
          .slice(0, 6)
      );
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!stats) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="What needs your attention"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => navigate('/tasks?new=1')}>
              <Plus size={16} /> New Task
            </Button>
            <Button onClick={() => navigate('/followups')}>
              <Plus size={16} /> New Follow-up
            </Button>
          </div>
        }
      />

      {/* Every tile is a saved view - clicking drills into the filtered list. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<AlertTriangle size={26} />} label="Critical" value={stats.critical} color="red"
          onClick={() => navigate('/tasks?priority=P0_CRITICAL')}
        />
        <StatCard
          icon={<Clock size={26} />} label="Follow-ups due" value={stats.followups_due} color="yellow"
          onClick={() => navigate('/followups?status=FOLLOW_UP_DUE')}
        />
        <StatCard
          icon={<AlertCircle size={26} />} label="Overdue" value={stats.overdue} color="red"
          onClick={() => navigate('/alerts?severity=high')}
        />
        <StatCard
          icon={<Zap size={26} />} label="Due today" value={stats.today} color="blue"
          onClick={() => navigate('/tasks')}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<TrendingUp size={26} />} label="In progress" value={stats.in_progress} color="blue"
          onClick={() => navigate('/tasks?status=IN_PROGRESS')}
        />
        <StatCard
          icon={<AlertCircle size={26} />} label="Blocked" value={stats.blocked} color="red"
          onClick={() => navigate('/tasks?status=BLOCKED')}
        />
        <StatCard
          icon={<Eye size={26} />} label="Forgotten" value={stats.forgotten} color="purple"
          onClick={() => navigate('/alerts')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Needs attention */}
        <div className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Needs attention</h2>
            <Link to="/tasks" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              All tasks <ArrowRight size={14} />
            </Link>
          </div>
          {attention.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              Nothing critical or overdue. Good place to be.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((t) => (
                <li key={t.id}>
                  <Link
                    to="/tasks"
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{t.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Due {fmtDate(t.due_date)}
                        {isOverdue(t.due_date, t.status) && (
                          <span className="ml-1.5 font-medium text-red-600">· overdue</span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Badge value={t.priority} />
                      <Badge value={t.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Throughput */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Open items</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">{stats.total_tasks}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Completed today</p>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-3xl font-semibold text-emerald-600">{stats.completed_today}</p>
              <CheckCircle2 className="text-emerald-500" size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">
            Active alerts{alerts.length > 0 && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {alerts.length}
              </span>
            )}
          </h2>
          <Link to="/alerts" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
            View all <ArrowRight size={14} />
          </Link>
        </div>
        {alerts.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No active alerts.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {alerts.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{a.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{a.description}</p>
                </div>
                <Badge value={a.severity.toUpperCase()} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
