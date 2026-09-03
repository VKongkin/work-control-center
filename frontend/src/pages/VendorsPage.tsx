import CrudPage, { ColumnDef, FieldDef } from '../components/CrudPage';
import { vendorApi } from '../api/client';
import { Vendor } from '../types';

const fields: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'type', label: 'Type', type: 'text', placeholder: 'e.g. Payment Processor' },
  { key: 'primary_contact_id', label: 'Primary contact', type: 'lookup', lookup: 'people' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  { key: 'active', label: 'Active', type: 'checkbox' },
];

const columns: ColumnDef<Vendor>[] = [
  { header: 'Name', key: 'name' },
  { header: 'Type', key: 'type' },
  { header: 'Contact', cell: (r, lk) => <span className="text-slate-600">{lk.nameOf('people', r.primary_contact_id)}</span> },
  { header: 'Email', key: 'email' },
  { header: 'Status', key: 'active' },
];

export default function VendorsPage() {
  return (
    <CrudPage<Vendor>
      title="Vendors" singular="Vendor" api={vendorApi}
      fields={fields} columns={columns} archivable
      subtitle="External organisations and service providers"
      emptyHint="Add the vendors you chase so waiting items have an owner."
    />
  );
}
