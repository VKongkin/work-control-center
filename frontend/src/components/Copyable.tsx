import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { copyText } from '../lib/clipboard';

/**
 * A value you are about to type somewhere else.
 *
 * Every field on a server row exists to be retyped into a terminal, a browser
 * or a ticket, so each one is a button that copies itself. The confirmation is
 * inline rather than a toast: this is a thing you click twenty times in an
 * afternoon and twenty toasts is a punishment.
 *
 * Some values are web links - a management console lives in the IP field as
 * often as an address does - so a link also opens on double-click.
 */

/** Only http(s). A stored value could say `javascript:` and must never run. */
export function asUrl(raw?: string | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (/^https?:\/\/\S+$/i.test(value)) return value;
  // A bare www. host is what people paste out of a browser bar.
  if (/^www\.\S+\.\S+$/i.test(value)) return `https://${value}`;
  return null;
}

export default function Copyable({
  value,
  label,
  className = '',
}: {
  value: string;
  /** What this is, for the screen reader and the tooltip: "IP address". */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const url = asUrl(value);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (pending.current) window.clearTimeout(pending.current);
  }, []);

  async function doCopy() {
    const ok = await copyText(value);
    setCopied(ok);
    setFailed(!ok);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setCopied(false); setFailed(false); }, 1400);
  }

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();          // never toggles the row open
    if (!url) { doCopy(); return; }
    // A double-click fires two clicks first, so on a link the copy waits long
    // enough for the second one to cancel it. Only links pay that delay;
    // everything else copies on the spot.
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => { pending.current = null; doCopy(); }, 250);
  }

  function onDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!url) return;
    if (pending.current) { window.clearTimeout(pending.current); pending.current = null; }
    // noopener is what stops the opened page reaching back through
    // window.opener; noreferrer keeps the internal URL out of its logs.
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      data-copyable={label}
      aria-label={url
        ? `${label} ${value}. Click to copy, double-click to open.`
        : `Copy ${label} ${value}`}
      title={url
        ? `${label} — click to copy, double-click to open`
        : `${label} — click to copy`}
      // No truncation: the whole point is to read the value and copy it, and a
      // console URL clipped to "…:8443/t…" is worse than one that wraps.
      className={`group/copy -mx-0.5 inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left align-baseline break-words transition hover:bg-slate-100 hover:text-slate-900 ${
        copied ? 'bg-emerald-50 text-emerald-700' : ''
      } ${failed ? 'bg-amber-50 text-amber-800' : ''} ${className}`}
    >
      <span className="break-words">{value}</span>
      {copied && <Check size={11} className="shrink-0" />}
      {failed && <span className="shrink-0 text-[10px]">select it instead</span>}
      {url && !copied && !failed && (
        <ExternalLink size={10} className="shrink-0 text-slate-400 group-hover/copy:text-blue-600" />
      )}
    </button>
  );
}
