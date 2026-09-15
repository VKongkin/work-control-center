import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Search, Trash2, X } from 'lucide-react';
import CrudPage, { FieldDef, ListRender } from '../components/CrudPage';
import GroupedList from '../components/GroupedList';
import { issueApi } from '../api/client';
import { Issue } from '../types';
import { useLookups } from '../hooks/useLookups';
import { Badge, SelectField } from '../components/ui';
import { ISSUE_SEVERITIES, ISSUE_STATUSES, fmtDate } from '../lib/constants';
import { ageLabel, groupIssues, isClosed } from '../lib/grouping';

const fields: FieldDef[] = [
  { key: 'title', label: 'Title', type: 'text', required: true, full: true },
  { key: 'description', label: 'Description', type: 'textarea', full: true },
  { key: 'severity', label: 'Severity', type: 'select', options: ISSUE_SEVERITIES, defaultValue: 'MEDIUM' },
  { key: 'status', label: 'Status', type: 'select', options: ISSUE_STATUSES },
  { key: 'system_id', label: 'System', type: 'lookup', lookup: 'systems' },
  { key: 'project_id', label: 'Project', type: 'lookup', lookup: 'projects' },
  { key: 'department_id', label: 'Department', type: 'lookup', lookup: 'departments' },
  { key: 'vendor_id', label: 'Vendor', type: 'lookup', lookup: 'vendors' },
  { key: 'responsible_person_id', label: 'Responsible person', type: 'lookup', lookup: 'people', full: true },
  { key: 'detected_at', label: 'Detected', type: 'date' },
  { key: 'resolved_at', label: 'Resolved', type: 'date' },
  { key: 'root_cause', label: 'Root cause', type: 'textarea', full: true },
  { key: 'resolution', label: 'Resolution', type: 'textarea', full: true },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];

type Scope = 'open' | 'all' | 'resolved';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
  { value: 'resolved', label: 'Resolved' },
];

export default function IssuesPage() {
  const lk = useLookups();
  const [params, setParams] = useSearchParams();

  const [scope, setScope] = useState<Scope>((params.get('scope') as Scope) || 'open');
  const [severity, setSeverity] = useState(params.get('severity') ?? '');
  const [systemId, setSystemId] = useState(params.get('system_id') ?? '');
  const [query, setQuery] = useState('');

  // Severity and system narrow the request itself; scope and search are cheap
  // enough to do here, and doing them here keeps the group counts honest.
  const listParams = useMemo(
    () => ({
      limit: 500,
      severity: severity || undefined,
      system_id: systemId || undefined,
    }),
    [severity, systemId]
  );

  /** Keep the URL in step so a filtered view can be linked to or bookmarked. */
  function sync(next: Partial<{ scope: Scope; severity: string; system_id: string }>) {
    const merged = {
      scope: next.scope ?? scope,
      severity: next.severity ?? severity,
      system_id: next.system_id ?? systemId,
    };
    const out: Record<string, string> = {};
    if (merged.scope !== 'open') out.scope = merged.scope;
    if (merged.severity) out.severity = merged.severity;
    if (merged.system_id) out.system_id = merged.system_id;
    setParams(out, { replace: true });
  }

  function renderList(list: ListRender<Issue>) {
    const q = query.trim().toLowerCase();
    const shown = list.items.filter((i) => {
      if (scope === 'open' && isClosed(i)) return false;
      if (scope === 'resolved' && !isClosed(i)) return false;
      if (!q) return true;
      return [i.title, i.description, i.root_cause, i.resolution, i.notes,
              lk.nameOf('systems', i.system_id), lk.nameOf('people', i.responsible_person_id)]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });

    const filtered = !!(severity || systemId || query.trim() || scope !== 'open');

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Which issues">
            {SCOPES.map((s) => (
              <button
                key={s.value}
                onClick={() => { setScope(s.value); sync({ scope: s.value }); }}
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

          <SelectField
            name="filter-severity" label="Severity" value={severity}
            onChange={(v: string) => { setSeverity(v); sync({ severity: v }); }}
            options={ISSUE_SEVERITIES} placeholder="All severities"
            className="min-w-[150px]"
          />
          <SelectField
            name="filter-system" label="System" value={systemId}
            onChange={(v: string) => { setSystemId(v); sync({ system_id: v }); }}
            options={lk.systems} placeholder="All systems"
            className="min-w-[160px]"
          />

          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="issue-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search issues…"
              aria-label="Search issues"
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

          <p className="py-2 text-sm text-slate-500">
            {shown.length} of {list.items.length}
          </p>
        </div>

        <GroupedList<Issue>
          groups={groupIssues(shown)}
          empty={
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <p className="font-medium text-slate-900">
                {filtered ? 'Nothing matches these filters' : 'No issues logged'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {filtered
                  ? 'Try a wider severity, or the All scope.'
                  : 'Log incidents here to keep root cause and resolution together.'}
              </p>
            </div>
          }
          row={(issue) => (
            <Row
              issue={issue}
              systemName={lk.nameOf('systems', issue.system_id)}
              ownerName={lk.nameOf('people', issue.responsible_person_id)}
              onView={() => list.onView(issue)}
              onEdit={() => list.onEdit(issue)}
              onDelete={() => list.onDelete(issue)}
            />
          )}
        />
      </div>
    );
  }

  return (
    <CrudPage<Issue>
      title="Issues" singular="Issue" api={issueApi}
      fields={fields} attachAs="issue"
      labelKey="title"
      subtitle="Worst first, with what is still open on top"
      listParams={listParams}
      renderList={renderList}
    />
  );
}

function Row({
  issue, systemName, ownerName, onView, onEdit, onDelete,
}: {
  issue: Issue;
  systemName: string;
  ownerName: string;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const closed = isClosed(issue);
  const age = ageLabel(issue);
  // The severity is already the section heading, so the row carries what the
  // heading cannot: how long it has been sitting there, and where.
  const meta = [
    systemName !== '—' ? systemName : null,
    ownerName !== '—' ? ownerName : null,
    age || null,
    issue.detected_at ? `detected ${fmtDate(issue.detected_at)}` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onView}
            className={`text-left text-sm font-medium hover:text-blue-700 ${
              closed ? 'text-slate-600' : 'text-slate-900'
            }`}
          >
            {issue.title}
          </button>
          <Badge value={issue.status} />
        </div>
        {meta.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-slate-500">{meta.join(' · ')}</p>
        )}
        {issue.description && (
          <p className="mt-0.5 truncate text-xs text-slate-400">{issue.description}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* Hover-revealed on a pointer device, always there on touch. */}
        <button
          onClick={onEdit}
          aria-label="Edit"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete"
          className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-50 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
