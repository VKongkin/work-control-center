import CrudPage, { ColumnDef, FieldDef } from '../components/CrudPage';
import { issueApi } from '../api/client';
import { Issue } from '../types';
import { ISSUE_SEVERITIES, ISSUE_STATUSES } from '../lib/constants';

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

const columns: ColumnDef<Issue>[] = [
  { header: 'Issue', key: 'title' },
  { header: 'Severity', key: 'severity', kind: 'badge' },
  { header: 'Status', key: 'status', kind: 'badge' },
  { header: 'System', cell: (r, lk) => <span className="text-slate-600">{lk.nameOf('systems', r.system_id)}</span> },
  { header: 'Owner', cell: (r, lk) => <span className="text-slate-600">{lk.nameOf('people', r.responsible_person_id)}</span> },
  { header: 'Detected', key: 'detected_at', kind: 'date' },
];

export default function IssuesPage() {
  return (
    <CrudPage<Issue>
      title="Issues" singular="Issue" api={issueApi}
      fields={fields} columns={columns} attachAs="issue"
      labelKey="title"
      subtitle="Incidents and problems under investigation"
      emptyHint="Log incidents here to keep root cause and resolution together."
    />
  );
}
