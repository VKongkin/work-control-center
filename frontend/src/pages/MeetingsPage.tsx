import CrudPage, { ColumnDef, FieldDef } from '../components/CrudPage';
import { meetingApi } from '../api/client';
import { Meeting } from '../types';

const fields: FieldDef[] = [
  { key: 'title', label: 'Title', type: 'text', required: true, full: true },
  { key: 'meeting_date', label: 'Date', type: 'date' },
  { key: 'primary_contact_id', label: 'Primary contact', type: 'lookup', lookup: 'people' },
  { key: 'participants', label: 'Participants', type: 'textarea', full: true, placeholder: 'Names, comma separated' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  { key: 'decisions', label: 'Decisions', type: 'textarea', full: true },
];

const columns: ColumnDef<Meeting>[] = [
  { header: 'Meeting', key: 'title' },
  { header: 'Date', key: 'meeting_date', kind: 'date' },
  { header: 'Participants', key: 'participants' },
  { header: 'Contact', cell: (r, lk) => <span className="text-slate-600">{lk.nameOf('people', r.primary_contact_id)}</span> },
];

export default function MeetingsPage() {
  return (
    <CrudPage<Meeting>
      title="Meetings" singular="Meeting" api={meetingApi}
      fields={fields} columns={columns}
      labelKey="title"
      subtitle="Notes, decisions and who was there"
      emptyHint="Capture meetings so decisions do not live only in your head."
    />
  );
}
