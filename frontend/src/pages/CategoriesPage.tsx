import CrudPage, { ColumnDef, FieldDef } from '../components/CrudPage';
import { categoryApi } from '../api/client';
import { Category } from '../types';

const fields: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'description', label: 'Description', type: 'textarea', full: true },
];

const columns: ColumnDef<Category>[] = [
  { header: 'Name', key: 'name' },
  { header: 'Description', key: 'description' },
];

export default function CategoriesPage() {
  return (
    <CrudPage<Category>
      title="Categories" singular="Category" api={categoryApi}
      fields={fields} columns={columns}
      deleteNote="Tasks using this category are kept - they simply become uncategorised."
      subtitle="How you group work"
      emptyHint="Categories let you slice tasks by the kind of work they are."
    />
  );
}
