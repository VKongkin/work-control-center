import CrudPage, { ColumnDef, FieldDef } from '../components/CrudPage';
import { departmentApi } from '../api/client';
import { Department } from '../types';

const fields: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'contact_person_id', label: 'Contact person', type: 'lookup', lookup: 'people' },
  { key: 'description', label: 'Description', type: 'textarea', full: true },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  { key: 'active', label: 'Active', type: 'checkbox' },
];

const columns: ColumnDef<Department>[] = [
  { header: 'Name', key: 'name' },
  { header: 'Description', key: 'description' },
  { header: 'Contact', cell: (r, lk) => <span className="text-slate-600">{lk.nameOf('people', r.contact_person_id)}</span> },
  { header: 'Status', key: 'active' },
];

export default function DepartmentsPage() {
  return (
    <CrudPage<Department>
      title="Departments" singular="Department" api={departmentApi}
      fields={fields} columns={columns} archivable
      subtitle="Teams you depend on"
      emptyHint="Model the teams you hand work to, so follow-ups can name them."
    />
  );
}
