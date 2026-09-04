import { ReactNode, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Archive, RotateCcw } from 'lucide-react';
import DetailView, { DetailRow } from './DetailView';
import { useResource, clean, toId } from '../hooks/useResource';
import { useLookups } from '../hooks/useLookups';
import { useForm } from '../hooks/useForm';
import {
  Badge, Button, CheckboxField, ConfirmDialog, DateField, EmptyState, ErrorBanner,
  ComboboxField, ErrorSummary, Modal, PageHeader, SelectField, Spinner, TextAreaField, TextField,
} from './ui';
import { Option, fmtDate, labelFor, toDateInput } from '../lib/constants';
import { Rule, email, maxLength, phone, required, saneDate } from '../lib/validators';

// Records the upload endpoint recognises. Directory entries are references,
// not work items, so they carry no files.
const ATTACHABLE = new Set(['task', 'followup', 'issue', 'meeting', 'project']);

type Lookups = ReturnType<typeof useLookups>;
type LookupKey = 'people' | 'departments' | 'vendors' | 'systems' | 'projects' | 'categories';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'date' | 'checkbox' | 'lookup';
  /** static options for `select` */
  options?: Option[];
  /** which lookup list to draw from for `lookup` */
  lookup?: LookupKey;
  required?: boolean;
  full?: boolean;
  placeholder?: string;
  hint?: string;
  /** starting value for a new record; falls back to the first option */
  defaultValue?: string;
  /** extra checks beyond the ones implied by `type` and `required` */
  rules?: Rule[];
}

export interface ColumnDef<T> {
  header: string;
  /** how to render the cell; falls back to the raw field value */
  cell?: (row: T, lk: Lookups) => ReactNode;
  key?: keyof T & string;
  kind?: 'badge' | 'date' | 'text';
}

interface Props<T> {
  title: string;
  subtitle?: string;
  singular: string;
  api: any;
  fields: FieldDef[];
  columns: ColumnDef<T>[];
  /** field used in the delete confirmation copy */
  labelKey?: keyof T & string;
  emptyHint?: string;
  /**
   * These records are archived rather than destroyed, so anything already
   * pointing at them keeps working. The page says so, and offers a way back.
   */
  archivable?: boolean;
  /** extra sentence on the delete confirmation, e.g. what happens to linked rows */
  deleteNote?: string;
  /** entity_type used for file uploads; omit for records that carry no files */
  attachAs?: string;
}

export default function CrudPage<T extends { id: number }>({
  title, subtitle, singular, api, fields, columns, labelKey = 'name' as any, emptyHint,
  archivable, deleteNote, attachAs,
}: Props<T>) {
  const [showArchived, setShowArchived] = useState(false);
  const params = useMemo(
    () => (archivable && showArchived ? { limit: 200, include_inactive: true } : { limit: 200 }),
    [archivable, showArchived]
  );
  const { items, loading, error, saving, refresh, create, update, remove } =
    useResource<T>(api, singular, params);
  const lk = useLookups();

  const blank = useMemo(() => {
    const o: Record<string, any> = {};
    for (const f of fields) {
      if (f.type === 'checkbox') o[f.key] = true;
      // A status or severity column is not nullable, so a new record starts on
      // the first choice rather than on nothing. Lookups stay empty - an
      // unassigned owner is a legitimate state.
      else if (f.type === 'select' && f.options?.length)
        o[f.key] = f.defaultValue ?? f.options[0].value;
      else o[f.key] = '';
    }
    return o;
  }, [fields]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [viewing, setViewing] = useState<T | null>(null);
  const [toDelete, setToDelete] = useState<T | null>(null);

  // Validation rules follow from each field's declared type, so a page only
  // spells out the unusual ones.
  const rules = useMemo(() => {
    const r: Record<string, Rule[]> = {};
    for (const f of fields) {
      const list: Rule[] = [];
      if (f.required) list.push(required(f.label));
      if (f.type === 'email') list.push(email);
      if (f.type === 'tel') list.push(phone);
      if (f.type === 'date') list.push(saneDate);
      if (f.type === 'text' || f.type === 'email') list.push(maxLength(255, f.label));
      if (f.rules) list.push(...f.rules);
      if (list.length) r[f.key] = list;
    }
    return r;
  }, [fields]);

  const form = useForm({ initial: blank, rules });

  function openNew() {
    setEditing(null);
    form.reset(blank);
    setOpen(true);
  }

  function openEdit(row: T) {
    setEditing(row);
    const o: Record<string, any> = {};
    for (const f of fields) {
      const v = (row as any)[f.key];
      if (f.type === 'checkbox') o[f.key] = v ?? true;
      else if (f.type === 'date') o[f.key] = toDateInput(v);
      else if (f.type === 'lookup') o[f.key] = v ? String(v) : '';
      // A stored null in a non-nullable enum would be sent straight back as
      // null and rejected, so fall back to a valid choice.
      else if (f.type === 'select' && f.options?.length)
        o[f.key] = v ?? f.defaultValue ?? f.options[0].value;
      else o[f.key] = v ?? '';
    }
    form.reset(o);
    setOpen(true);
  }

  async function submit() {
    const { ok: valid, firstInvalid } = form.validate();
    if (!valid) {
      // Put the cursor on the problem rather than making them hunt for it.
      const el = document.querySelector<HTMLElement>(
        `[role="dialog"] #f-${firstInvalid}`
      );
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      return;
    }
    const payload: Record<string, any> = {};
    for (const f of fields) {
      payload[f.key] = f.type === 'lookup' ? toId(form.values[f.key]) : form.values[f.key];
    }
    const result = editing
      ? await update(editing.id, clean(payload) as Partial<T>)
      : await create(clean(payload) as Partial<T>);
    if (result === true) setOpen(false);
    else if (typeof result === 'string') form.setServerError(result);
  }

  /** The same field definitions that drive the form also describe the record. */
  function detailRows(row: T): DetailRow[] {
    return fields.map((f) => {
      const raw = (row as any)[f.key];
      let value: any = raw;
      if (f.type === 'lookup') value = lk.nameOf(f.lookup!, raw);
      else if (f.type === 'date') value = fmtDate(raw);
      else if (f.type === 'checkbox') value = raw ? 'Active' : 'Archived';
      else if (f.type === 'select') value = <Badge value={raw} />;
      else if (raw === null || raw === undefined || raw === '') value = null;
      if (value === '—') value = null;
      return { label: f.label, value, wide: f.type === 'textarea' || f.full };
    });
  }

  const optionsFor = (f: FieldDef): Option[] =>
    f.type === 'lookup' ? (lk[f.lookup!] as Option[]) : f.options ?? [];

  function cellValue(col: ColumnDef<T>, row: T): ReactNode {
    if (col.cell) return col.cell(row, lk);
    const raw = col.key ? (row as any)[col.key] : null;
    if (col.kind === 'badge') return <Badge value={raw} />;
    if (col.kind === 'date') return <span className="text-slate-600">{fmtDate(raw)}</span>;
    if (raw === null || raw === undefined || raw === '') return <span className="text-slate-400">—</span>;
    if (typeof raw === 'boolean')
      return <Badge value={raw ? 'ACTIVE' : 'CANCELLED'} />;
    return <span className="text-slate-600">{String(raw)}</span>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        subtitle={subtitle ?? `${items.length} record${items.length === 1 ? '' : 's'}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {archivable && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-600 ring-1 ring-inset ring-slate-300">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                Show archived
              </label>
            )}
            <Button variant="primary" onClick={openNew}>
              <Plus size={16} /> New {singular}
            </Button>
          </div>
        }
      />

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {loading ? (
        <Spinner label={`Loading ${title.toLowerCase()}…`} />
      ) : items.length === 0 ? (
        <EmptyState
          title={`No ${title.toLowerCase()} yet`}
          hint={emptyHint}
          action={
            <Button variant="primary" onClick={openNew}>
              <Plus size={16} /> New {singular}
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                <tr>
                  {columns.map((c) => (
                    <th key={c.header} className="px-4 py-3 font-medium">{c.header}</th>
                  ))}
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70">
                    {columns.map((c, i) => (
                      <td key={c.header} className="px-4 py-3">
                        {i === 0 ? (
                          <button
                            onClick={() => setViewing(row)}
                            className="text-left font-medium text-slate-900 hover:text-blue-700"
                          >
                            {cellValue(c, row)}
                          </button>
                        ) : (
                          cellValue(c, row)
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => openEdit(row)} aria-label="Edit">
                          <Pencil size={15} />
                        </Button>
                        {archivable && (row as any).active === false ? (
                          <Button
                            variant="ghost" aria-label="Restore"
                            className="text-emerald-700 hover:bg-emerald-50"
                            onClick={() => update(row.id, { active: true } as Partial<T>)}
                          >
                            <RotateCcw size={15} />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost" onClick={() => setToDelete(row)}
                            aria-label={archivable ? 'Archive' : 'Delete'}
                            className="text-red-600 hover:bg-red-50"
                          >
                            {archivable ? <Archive size={15} /> : <Trash2 size={15} />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={open}
        wide={fields.length > 6}
        dirty={form.isDirty && !saving}
        title={editing ? `Edit ${singular.toLowerCase()}` : `New ${singular.toLowerCase()}`}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : `Create ${singular.toLowerCase()}`}
            </Button>
          </>
        }
      >
        <ErrorSummary errors={form.errorList} serverError={form.serverError} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((f) => {
            const set = (v: any) => form.setField(f.key, v);
            const shared = {
              key: f.key,
              name: f.key,
              label: f.label,
              required: f.required,
              hint: f.hint,
              error: form.errors[f.key],
              onBlur: () => form.blur(f.key),
              className: f.full ? 'sm:col-span-2' : '',
            };
            const value = form.values[f.key] ?? '';
            if (f.type === 'textarea')
              return <TextAreaField {...shared} value={value} onChange={set} placeholder={f.placeholder} />;
            if (f.type === 'lookup')
              return <ComboboxField {...shared} value={value} onChange={set} options={optionsFor(f)} />;
            if (f.type === 'select')
              return <SelectField {...shared} value={value} onChange={set} options={optionsFor(f)} />;
            if (f.type === 'date')
              return <DateField {...shared} value={value} onChange={set} />;
            if (f.type === 'checkbox')
              return <CheckboxField key={f.key} label={f.label} checked={!!form.values[f.key]} onChange={set} />;
            return <TextField {...shared} type={f.type} value={value} onChange={set} placeholder={f.placeholder} />;
          })}
        </div>
      </Modal>

      {viewing && (
        <DetailView
          open
          onClose={() => setViewing(null)}
          title={String((viewing as any)[labelKey] ?? singular)}
          rows={detailRows(viewing)}
          entityType={attachAs && ATTACHABLE.has(attachAs) ? attachAs : undefined}
          entityId={viewing.id}
          onEdit={() => { const row = viewing; setViewing(null); openEdit(row); }}
          onDelete={() => { const row = viewing; setViewing(null); setToDelete(row); }}
          deleteLabel={archivable ? 'Archive' : 'Delete'}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title={archivable ? `Archive ${singular.toLowerCase()}` : `Delete ${singular.toLowerCase()}`}
        confirmLabel={archivable ? 'Archive' : 'Delete'}
        message={
          archivable
            ? `"${(toDelete as any)?.[labelKey]}" will be hidden from lists. Anything already linked to it keeps working, and you can restore it with "Show archived".`
            : `"${(toDelete as any)?.[labelKey]}" will be permanently removed. This cannot be undone.${deleteNote ? ' ' + deleteNote : ''}`
        }
        busy={saving}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) await remove(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
