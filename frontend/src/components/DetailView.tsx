import { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import Attachments from './Attachments';
import { Button, Modal } from './ui';

export interface DetailRow {
  label: string;
  value: ReactNode;
  /** Long prose spans the full width instead of sitting in a column. */
  wide?: boolean;
}

/**
 * Read-only view of one record.
 *
 * Opening a record used to drop straight into the edit form, which meant
 * reading something risked changing it, and every field was a form control
 * rather than a value you could scan. Looking and editing are separate now.
 */
export default function DetailView({
  open, onClose, title, subtitle, badges, rows, entityType, entityId,
  onEdit, onDelete, editLabel = 'Edit', deleteLabel = 'Delete', extra,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  rows: DetailRow[];
  /** When given, the record's files are shown and can be managed here. */
  entityType?: string;
  entityId?: number;
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
  extra?: ReactNode;
}) {
  const shown = rows.filter((r) => r.value !== null && r.value !== undefined && r.value !== '');

  return (
    <Modal
      open={open}
      wide
      title={title}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <Button variant="ghost" onClick={onDelete} className="mr-auto text-red-600 hover:bg-red-50">
              <Trash2 size={15} /> {deleteLabel}
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
          {onEdit && (
            <Button variant="primary" onClick={onEdit}>
              <Pencil size={15} /> {editLabel}
            </Button>
          )}
        </>
      }
    >
      {(subtitle || badges) && (
        <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
          {badges}
          {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {shown.map((r) => (
          <div key={r.label} className={r.wide ? 'sm:col-span-2' : ''}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {r.label}
            </dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      {shown.length === 0 && (
        <p className="text-sm text-slate-500">Nothing recorded beyond the title yet.</p>
      )}

      {extra}

      {entityType && entityId !== undefined && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
            Files
          </h3>
          <Attachments entityType={entityType} entityId={entityId} compact />
        </div>
      )}
    </Modal>
  );
}
