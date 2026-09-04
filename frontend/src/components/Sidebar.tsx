import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { toolApi } from '../api/client';
import { Tool } from '../types';
import { MUTATION_EVENT } from '../hooks/useResource';
import {
  Home, Inbox, CheckSquare, Clock, BarChart3, AlertCircle, Users, Building,
  Package, Server, Bug, CalendarDays, Tag, Search, X, Wrench, Star, CalendarRange,
} from 'lucide-react';

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

const GROUPS = [
  {
    label: null,
    items: [
      { icon: Home, label: 'Dashboard', to: '/', end: true },
      { icon: Inbox, label: 'Inbox', to: '/tasks?status=INBOX' },
      { icon: CheckSquare, label: 'Tasks', to: '/tasks' },
      { icon: Clock, label: 'Follow-ups', to: '/followups' },
      { icon: AlertCircle, label: 'Alerts', to: '/alerts' },
      { icon: Search, label: 'Search', to: '/search' },
    ],
  },
  {
    label: 'Work',
    items: [
      { icon: BarChart3, label: 'Projects', to: '/projects' },
      { icon: Bug, label: 'Issues', to: '/issues' },
      { icon: CalendarDays, label: 'Meetings', to: '/meetings' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { icon: CalendarRange, label: 'Calendars', to: '/calendars' },
    ],
  },
  {
    label: 'Build',
    items: [
      { icon: Wrench, label: 'Tools', to: '/tools' },
    ],
  },
  {
    label: 'Directory',
    items: [
      { icon: Users, label: 'People', to: '/people' },
      { icon: Building, label: 'Departments', to: '/departments' },
      { icon: Package, label: 'Vendors', to: '/vendors' },
      { icon: Server, label: 'Systems', to: '/systems' },
      { icon: Tag, label: 'Categories', to: '/categories' },
    ],
  },
];

export default function Sidebar({ open, onToggle }: SidebarProps) {
  const location = useLocation();

  // Pinned tools get their own shortcuts, so a tool you reach for daily is one
  // click away rather than two.
  const [pinned, setPinned] = useState<Tool[]>([]);
  useEffect(() => {
    const load = async () => {
      try {
        const rows = (await toolApi.getAll({ limit: 200 })).data as Tool[];
        setPinned(rows.filter((t) => t.pinned));
      } catch {
        setPinned([]);
      }
    };
    load();
    const onMutation = (e: Event) => {
      if ((e as CustomEvent<{ label?: string }>).detail?.label === 'Tool') load();
    };
    window.addEventListener(MUTATION_EVENT, onMutation);
    return () => window.removeEventListener(MUTATION_EVENT, onMutation);
  }, []);

  /**
   * Two entries share /tasks (Inbox is /tasks?status=INBOX), so matching on
   * pathname alone would light both up. Entries carrying a query string are
   * active only when that query is actually applied, and the plain entry only
   * when it is not.
   */
  const isActive = (to: string) => {
    const [path, query] = to.split('?');
    if (location.pathname !== path) return false;
    if (query) return location.search.includes(query);
    return !GROUPS.some(
      (g) => g.items.some((i) => {
        const [p, q] = i.to.split('?');
        return q && p === path && location.search.includes(q);
      })
    );
  };

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
      active
        ? 'bg-blue-50 font-medium text-blue-700'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
          onClick={onToggle}
          aria-hidden
        />
      )}

      <aside
        className={`${open ? 'translate-x-0' : '-translate-x-full'} fixed z-50 h-screen w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white transition-transform duration-200 md:static md:translate-x-0`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div>
            <p className="text-base font-semibold tracking-tight text-slate-900">
              Work Control Center
            </p>
            <p className="text-xs text-slate-500">What needs your attention</p>
          </div>
          <button onClick={onToggle} className="text-slate-400 hover:text-slate-600 md:hidden">
            <X size={18} />
          </button>
        </div>

        <nav className="space-y-5 px-3 pb-8">
          {GROUPS.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.label}
                      to={item.to}
                      className={linkClass(isActive(item.to))}
                      onClick={() => window.innerWidth < 768 && onToggle()}
                    >
                      <Icon size={17} className="shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
          {pinned.length > 0 && (
            <div>
              <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Pinned tools
              </p>
              <div className="space-y-0.5">
                {pinned.map((t) => (
                  <NavLink
                    key={t.id}
                    to={`/tools/${t.id}`}
                    className={linkClass(location.pathname === `/tools/${t.id}`)}
                    onClick={() => window.innerWidth < 768 && onToggle()}
                    title={t.description ?? t.name}
                  >
                    <Star size={17} className="shrink-0" />
                    <span className="truncate">{t.name}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </nav>
      </aside>
    </>
  );
}
