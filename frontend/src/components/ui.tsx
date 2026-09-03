import { ReactNode, useCallback, useEffect, useState } from 'react';
import { X, Inbox, AlertTriangle } from 'lucide-react';
import { TONE, labelFor, Option } from '../lib/constants';

/* ---------------------------------------------------------------- Badge */

export function Badge({ value, className = '' }: { value?: string | null; className?: string }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const tone = TONE[value] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${tone} ${className}`}
    >
      {labelFor(value)}
    </span>
  );
}

/* ---------------------------------------------------------------- Modal */

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** When true, closing asks before throwing away edits. */
  dirty?: boolean;
}

export function Modal({ open, title, onClose, children, footer, wide, dirty }: ModalProps) {
  const [askDiscard, setAskDiscard] = useState(false);

  const attemptClose = useCallback(() => {
    if (dirty) setAskDiscard(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (askDiscard) setAskDiscard(false);
        else attemptClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, attemptClose, askDiscard]);

  useEffect(() => {
    if (!open) setAskDiscard(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={attemptClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative my-8 w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} rounded-xl bg-white shadow-xl ring-1 ring-slate-200`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            onClick={attemptClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {askDiscard ? (
          <div className="px-6 py-6">
            <p className="font-medium text-slate-900">Discard your changes?</p>
            <p className="mt-1 text-sm text-slate-600">
              You have edits that have not been saved yet.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setAskDiscard(false)}>Keep editing</Button>
              <Button variant="danger" onClick={onClose}>Discard changes</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 py-5">{children}</div>
            {footer && (
              <div className="flex justify-end gap-2 rounded-b-xl border-t border-slate-200 bg-slate-50 px-6 py-4">
                {footer}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Buttons */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
};

export function Button({ variant = 'secondary', className = '', ...rest }: BtnProps) {
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600',
    secondary:
      'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600',
    ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:outline-slate-400',
  }[variant];
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

/* ---------------------------------------------------------------- Fields */

const fieldBase =
  'block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-inset disabled:bg-slate-50 transition-shadow';
const fieldOk = 'ring-slate-300 focus:ring-blue-600';
const fieldBad = 'ring-red-400 bg-red-50/40 focus:ring-red-500';

function Label({ label, required, htmlFor }: { label: string; required?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
      {label}
      {required && (
        <span className="ml-0.5 text-red-500" aria-label="required">*</span>
      )}
    </label>
  );
}

function FieldNote({ error, hint, id }: { error?: string; hint?: string; id: string }) {
  if (error)
    return (
      <span id={`${id}-error`} role="alert" className="mt-1.5 flex items-start gap-1 text-xs text-red-600">
        <AlertCircleIcon />
        {error}
      </span>
    );
  if (hint) return <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>;
  return null;
}

function AlertCircleIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-px h-3.5 w-3.5 shrink-0 fill-current" aria-hidden>
      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 8.25a.9.9 0 110-1.8.9.9 0 010 1.8z" />
    </svg>
  );
}

interface BaseField {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  name?: string;
  onBlur?: () => void;
}

const idFor = (name: string | undefined, label: string) =>
  `f-${name ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export function TextField({
  label, value, onChange, required, error, hint, placeholder, type = 'text',
  className = '', name, onBlur,
}: BaseField & {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const id = idFor(name, label);
  return (
    <div className={className}>
      <Label label={label} required={required} htmlFor={id} />
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${fieldBase} ${error ? fieldBad : fieldOk}`}
      />
      <FieldNote error={error} hint={hint} id={id} />
    </div>
  );
}

export function TextAreaField({
  label, value, onChange, rows = 3, placeholder, className = '', name, error, hint, onBlur,
}: BaseField & {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const id = idFor(name, label);
  return (
    <div className={className}>
      <Label label={label} htmlFor={id} />
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={!!error}
        className={`${fieldBase} ${error ? fieldBad : fieldOk}`}
      />
      <FieldNote error={error} hint={hint} id={id} />
    </div>
  );
}

export function SelectField({
  label, value, onChange, options, required, placeholder = '—', className = '',
  name, error, hint, onBlur,
}: BaseField & {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
}) {
  const id = idFor(name, label);
  return (
    <div className={className}>
      <Label label={label} required={required} htmlFor={id} />
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={!!error}
        className={`${fieldBase} ${error ? fieldBad : fieldOk}`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldNote error={error} hint={hint} id={id} />
    </div>
  );
}

export function DateField({
  label, value, onChange, className = '', name, error, hint, required, onBlur,
}: BaseField & { value: string; onChange: (v: string) => void }) {
  const id = idFor(name, label);
  return (
    <div className={className}>
      <Label label={label} required={required} htmlFor={id} />
      <input
        id={id}
        name={name}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={!!error}
        className={`${fieldBase} ${error ? fieldBad : fieldOk}`}
      />
      <FieldNote error={error} hint={hint} id={id} />
    </div>
  );
}

/** Collected problems, shown at the top of a form after a failed submit. */
export function ErrorSummary({ errors, serverError }: { errors: string[]; serverError?: string | null }) {
  if (!serverError && errors.length === 0) return null;
  return (
    <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3.5" role="alert">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 shrink-0 text-red-500" size={16} />
        <div className="min-w-0 text-sm">
          {serverError ? (
            <>
              <p className="font-medium text-red-800">Could not save</p>
              <p className="mt-0.5 text-red-700">{serverError}</p>
            </>
          ) : (
            <>
              <p className="font-medium text-red-800">
                {errors.length === 1 ? 'One thing needs fixing' : `${errors.length} things need fixing`}
              </p>
              <ul className="mt-1 space-y-0.5 text-red-700">
                {errors.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CheckboxField({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 pt-6">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
      />
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

/* ---------------------------------------------------------------- States */

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      <p className="mt-3 text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  title, hint, action,
}: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 py-16 text-center">
      <Inbox className="mx-auto text-slate-300" size={40} />
      <p className="mt-3 font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <AlertTriangle className="mt-0.5 shrink-0 text-red-500" size={18} />
      <div className="flex-1">
        <p className="text-sm font-medium text-red-800">Something went wrong</p>
        <p className="mt-0.5 text-sm text-red-700">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Confirm */

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Delete', onConfirm, onCancel, busy,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Page header */

export function PageHeader({
  title, subtitle, action,
}: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
