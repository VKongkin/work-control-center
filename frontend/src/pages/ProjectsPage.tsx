import CrudPage, { ColumnDef, FieldDef } from '../components/CrudPage';
import { projectApi } from '../api/client';
import { Project } from '../types';
import { PRIORITIES, PROJECT_STATUSES } from '../lib/constants';

const fields: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', required: true, full: true },
  { key: 'description', label: 'Description', type: 'textarea', full: true },
  { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUSES },
  { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, defaultValue: 'P2_MEDIUM' },
  { key: 'start_date', label: 'Start date', type: 'date' },
  { key: 'target_date', label: 'Target date', type: 'date' },
  { key: 'owner', label: 'Owner', type: 'text', full: true },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];

const columns: ColumnDef<Project>[] = [
  { header: 'Project', key: 'name' },
  { header: 'Status', key: 'status', kind: 'badge' },
  { header: 'Priority', key: 'priority', kind: 'badge' },
  { header: 'Target', key: 'target_date', kind: 'date' },
  { header: 'Owner', key: 'owner' },
];

export default function ProjectsPage() {
  return (
    <CrudPage<Project>
      title="Projects" singular="Project" api={projectApi}
      fields={fields} columns={columns} attachAs="project"
      deleteNote="Tasks and issues in this project are kept - they just stop being linked to it."
      subtitle="Grouped bodies of work"
      emptyHint="Group related tasks under a project to see them together."
    />
  );
}
