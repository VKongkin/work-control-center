import CrudPage, { ColumnDef, FieldDef } from '../components/CrudPage';
import { systemApi } from '../api/client';
import { SystemRecord } from '../types';

const fields: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'environment', label: 'Environment', type: 'select', options: [
    { value: 'PRODUCTION', label: 'Production' },
    { value: 'UAT', label: 'UAT' },
    { value: 'STAGING', label: 'Staging' },
    { value: 'DEVELOPMENT', label: 'Development' },
  ] },
  { key: 'owner', label: 'Owner', type: 'text', placeholder: 'Owning team' },
  { key: 'description', label: 'Description', type: 'textarea', full: true },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  { key: 'active', label: 'Active', type: 'checkbox' },
];

const columns: ColumnDef<SystemRecord>[] = [
  { header: 'Name', key: 'name' },
  { header: 'Environment', key: 'environment' },
  { header: 'Owner', key: 'owner' },
  { header: 'Description', key: 'description' },
  { header: 'Status', key: 'active' },
];

export default function SystemsPage() {
  return (
    <CrudPage<SystemRecord>
      title="Systems" singular="System" api={systemApi}
      fields={fields} columns={columns} archivable
      subtitle="Applications and infrastructure you look after"
      emptyHint="Register the systems you support so issues can be attributed."
    />
  );
}
