import CrudPage, { ColumnDef, FieldDef } from '../components/CrudPage';
import { peopleApi } from '../api/client';
import { Person } from '../types';

const fields: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'role', label: 'Role', type: 'text', placeholder: 'e.g. Network Manager' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'department_id', label: 'Department', type: 'lookup', lookup: 'departments' },
  { key: 'vendor_id', label: 'Vendor', type: 'lookup', lookup: 'vendors' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  { key: 'active', label: 'Active', type: 'checkbox' },
];

const columns: ColumnDef<Person>[] = [
  { header: 'Name', key: 'name' },
  { header: 'Role', key: 'role' },
  { header: 'Email', key: 'email' },
  { header: 'Department', cell: (r, lk) => <span className="text-slate-600">{lk.nameOf('departments', r.department_id)}</span> },
  { header: 'Vendor', cell: (r, lk) => <span className="text-slate-600">{lk.nameOf('vendors', r.vendor_id)}</span> },
  { header: 'Status', key: 'active' },
];

export default function PeoplePage() {
  return (
    <CrudPage<Person>
      title="People" singular="Person" api={peopleApi}
      fields={fields} columns={columns} archivable
      subtitle="Contacts across departments and vendors"
      emptyHint="Add the people you work with so tasks and follow-ups can point at them."
    />
  );
}
