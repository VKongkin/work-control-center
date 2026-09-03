import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, PhoneCall, Check } from 'lucide-react';
import { followupApi } from '../api/client';
import { FollowUp } from '../types';
import { useResource, clean, toId } from '../hooks/useResource';
import { useLookups } from '../hooks/useLookups';
import { useForm } from '../hooks/useForm';
import {
  Badge, Button, ComboboxField, ConfirmDialog, DateField, EmptyState, ErrorBanner,
  ErrorSummary, Modal, PageHeader, SelectField, Spinner, TextAreaField, TextField,
} from '../components/ui';
import { FOLLOWUP_STATUSES, WAITING_FOR_TYPES, fmtDate, isOverdue, toDateInput } from '../lib/constants';
import { maxLength, notBefore, required, saneDate } from '../lib/validators';

const RULES = {
  title: [required('Title'), maxLength(255, 'Title')],
  waiting_for_type: [required('Waiting for')],
  requested_date: [saneDate],
  // A delivery cannot be expected before it was asked for.
  expected_date: [saneDate, notBefore('requested_date', 'Requested on', 'Expected by')],
  follow_up_date: [saneDate, notBefore('requested_date', 'Requested on', 'Follow up on')],
  last_contact_date: [saneDate],
};

const blank = {
  title: '', description: '', status: 'WAITING', waiting_for_type: 'PERSON',
  person_id: '', department_id: '', vendor_id: '',
  requested_date: '', expected_date: '', follow_up_date: '', last_contact_date: '',
  next_action: '', notes: '',
};
type Form = typeof blank;

export default function FollowUpsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const params = useMemo(() => ({ status: status || undefined, limit: 200 }), [status]);

  // Keep the URL in step with the filter so a filtered view can be linked to,
  // bookmarked, and restored with the back button.
  useEffect(() => {
    setSearchParams(status ? { status } : {}, { replace: true });
  }, [status, setSearchParams]);

  const { items, loading, error, saving, refresh, create, update, remove } =
    useResource<FollowUp>(followupApi, 'Follow-up', params);
  const lk = useLookups();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FollowUp | null>(null);
  const [toDelete, setToDelete] = useState<FollowUp | null>(null);
  const form = useForm({ initial: blank, rules: RULES });

  function openNew() {
    setEditing(null);
    form.reset(blank);
    setOpen(true);
  }

  function openEdit(f: FollowUp) {
    setEditing(f);
    form.reset({
      title: f.title,
      description: f.description ?? '',
      status: f.status,
      waiting_for_type: f.waiting_for_type,
      person_id: f.person_id ? String(f.person_id) : '',
      department_id: f.department_id ? String(f.department_id) : '',
      vendor_id: f.vendor_id ? String(f.vendor_id) : '',
      requested_date: toDateInput(f.requested_date),
      expected_date: toDateInput(f.expected_date),
      follow_up_date: toDateInput(f.follow_up_date),
      last_contact_date: toDateInput(f.last_contact_date),
      next_action: f.next_action ?? '',
      notes: f.notes ?? '',
    });
    setOpen(true);
  }

  async function submit() {
    const { ok: valid, firstInvalid } = form.validate();
    if (!valid) {
      const el = document.querySelector<HTMLElement>(
        `[role="dialog"] #f-${firstInvalid}`
      );
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
      return;
    }
    const v = form.values as Form;
    const payload = clean({
      ...v,
      title: v.title.trim(),
      person_id: toId(v.person_id),
      department_id: toId(v.department_id),
      vendor_id: toId(v.vendor_id),
    }) as unknown as Partial<FollowUp>;
    const result = editing ? await update(editing.id, payload) : await create(payload);
    if (result === true) setOpen(false);
    else if (typeof result === 'string') form.setServerError(result);
  }

  const set = (k: keyof Form) => (v: string) => form.setField(k as string, v);

  /**
   * Changing who we are waiting on drops the target that no longer applies.
   * Without this, picking a person and then switching to a vendor saved both
   * links, leaving the row pointing at someone it is not actually waiting on.
   */
  const setWaitingForType = (v: string) => {
    form.setServerError(null);
    form.setValues((current) => ({
      ...current,
      waiting_for_type: v,
      person_id: v === 'PERSON' ? current.person_id : '',
      department_id: v === 'DEPARTMENT' ? current.department_id : '',
      vendor_id: v === 'VENDOR' ? current.vendor_id : '',
    }));
  };
  const fx = (k: keyof Form) => ({
    name: k as string,
    error: form.errors[k as string],
    onBlur: () => form.blur(k as string),
  });

  /** Who we are waiting on, resolved through whichever relation is set. */
  function waitingOn(f: FollowUp): string {
    if (f.waiting_for_type === 'PERSON') return lk.nameOf('people', f.person_id);
    if (f.waiting_for_type === 'DEPARTMENT') return lk.nameOf('departments', f.department_id);
    return lk.nameOf('vendors', f.vendor_id);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Follow-ups"
        subtitle="Everything you are waiting on from someone else"
        action={
          <Button variant="primary" onClick={openNew}>
            <Plus size={16} /> New Follow-up
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <SelectField
          name="filter-status" label="Status" value={status} onChange={setStatus}
          options={FOLLOWUP_STATUSES} placeholder="All statuses" className="min-w-[170px]"
        />
        {status && <Button onClick={() => setStatus('')}>Clear</Button>}
      </div>

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {loading ? (
        <Spinner label="Loading follow-ups…" />
      ) : items.length === 0 ? (
        <EmptyState
          title={status ? 'Nothing with that status' : 'No follow-ups yet'}
          hint="Track anything you are waiting on so it cannot quietly stall."
          action={
            !status && (
              <Button variant="primary" onClick={openNew}>
                <Plus size={16} /> New Follow-up
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3">
          {items.map((f) => {
            const late = isOverdue(f.expected_date, f.status) || f.status === 'OVERDUE';
            return (
              <div
                key={f.id}
                className={`rounded-xl border bg-white p-5 ${late ? 'border-red-200' : 'border-slate-200'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => openEdit(f)}
                        className="text-left font-semibold text-slate-900 hover:text-blue-700"
                      >
                        {f.title}
                      </button>
                      <Badge value={f.status} />
                    </div>
                    {f.description && <p className="mt-1 text-sm text-slate-600">{f.description}</p>}

                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-slate-400">Waiting on</dt>
                        <dd className="text-slate-700">{waitingOn(f)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Expected</dt>
                        <dd className={late ? 'font-medium text-red-600' : 'text-slate-700'}>
                          {fmtDate(f.expected_date)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Follow up on</dt>
                        <dd className="text-slate-700">{fmtDate(f.follow_up_date)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Last contact</dt>
                        <dd className="text-slate-700">{fmtDate(f.last_contact_date)}</dd>
                      </div>
                    </dl>

                    {f.next_action && (
                      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <span className="font-medium text-slate-700">Next: </span>
                        {f.next_action}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {f.status !== 'RECEIVED' && (
                      <>
                        <Button
                          onClick={() => update(f.id, { last_contact_date: today } as Partial<FollowUp>)}
                          title="Record that you chased this today"
                        >
                          <PhoneCall size={14} /> Log contact
                        </Button>
                        <Button
                          onClick={() => update(f.id, { status: 'RECEIVED' } as Partial<FollowUp>)}
                        >
                          <Check size={14} /> Received
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" onClick={() => openEdit(f)} aria-label="Edit">
                      <Pencil size={15} />
                    </Button>
                    <Button
                      variant="ghost" onClick={() => setToDelete(f)} aria-label="Delete"
                      className="text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        wide
        dirty={form.isDirty && !saving}
        title={editing ? 'Edit follow-up' : 'New follow-up'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create follow-up'}
            </Button>
          </>
        }
      >
        <ErrorSummary errors={form.errorList} serverError={form.serverError} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            {...fx('title')} label="Title" required value={form.values.title}
            onChange={set('title')} placeholder="What are you waiting for?" className="sm:col-span-2"
          />
          <TextAreaField {...fx('description')} label="Description" value={form.values.description} onChange={set('description')} className="sm:col-span-2" />
          <SelectField {...fx('status')} label="Status" value={form.values.status} onChange={set('status')} options={FOLLOWUP_STATUSES} placeholder="Waiting" />
          <SelectField
            {...fx('waiting_for_type')} label="Waiting for" required
            value={form.values.waiting_for_type} onChange={setWaitingForType}
            options={WAITING_FOR_TYPES} placeholder="Person"
          />
          {/* Only the relation matching the chosen type is offered. */}
          {form.values.waiting_for_type === 'PERSON' && (
            <ComboboxField {...fx('person_id')} label="Person" value={form.values.person_id} onChange={set('person_id')} options={lk.people} className="sm:col-span-2" />
          )}
          {form.values.waiting_for_type === 'DEPARTMENT' && (
            <ComboboxField {...fx('department_id')} label="Department" value={form.values.department_id} onChange={set('department_id')} options={lk.departments} className="sm:col-span-2" />
          )}
          {form.values.waiting_for_type === 'VENDOR' && (
            <ComboboxField {...fx('vendor_id')} label="Vendor" value={form.values.vendor_id} onChange={set('vendor_id')} options={lk.vendors} className="sm:col-span-2" />
          )}
          <DateField {...fx('requested_date')} label="Requested on" value={form.values.requested_date} onChange={set('requested_date')} />
          <DateField
            {...fx('expected_date')} label="Expected by" value={form.values.expected_date}
            onChange={set('expected_date')} hint="Drives the overdue warning"
          />
          <DateField {...fx('follow_up_date')} label="Follow up on" value={form.values.follow_up_date} onChange={set('follow_up_date')} />
          <DateField {...fx('last_contact_date')} label="Last contact" value={form.values.last_contact_date} onChange={set('last_contact_date')} />
          <TextField {...fx('next_action')} label="Next action" value={form.values.next_action} onChange={set('next_action')} className="sm:col-span-2" />
          <TextAreaField {...fx('notes')} label="Notes" value={form.values.notes} onChange={set('notes')} className="sm:col-span-2" />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete follow-up"
        message={`"${toDelete?.title}" will be permanently removed.`}
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
