import { ReactNode, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Group } from '../lib/grouping';

/**
 * A list broken into labelled sections, each countable and one of them foldable.
 *
 * The Meetings agenda proved the shape: put the thing you came for at the top,
 * keep the rest reachable, and never make someone scan a flat table for it.
 * Tasks and Issues ask different questions, so they supply their own groups and
 * their own row content; everything about how a section looks lives here.
 */

const TONE: Record<string, { heading: string; border: string }> = {
  danger: { heading: 'text-red-700', border: 'border-red-200 ring-1 ring-red-100' },
  warning: { heading: 'text-amber-700', border: 'border-amber-200 ring-1 ring-amber-100' },
  active: { heading: 'text-blue-700', border: 'border-blue-200 ring-1 ring-blue-100' },
  muted: { heading: 'text-slate-400', border: 'border-slate-200' },
};
const PLAIN = { heading: 'text-slate-400', border: 'border-slate-200' };

interface Props<T extends { id: number }> {
  groups: Group<T>[];
  row: (item: T) => ReactNode;
  /** Shown when every group is empty. */
  empty?: ReactNode;
}

export default function GroupedList<T extends { id: number }>({ groups, row, empty }: Props<T>) {
  const visible = groups.filter((g) => !g.collapsed);
  const foldable = groups.filter((g) => g.collapsed);

  // No data-list marker here: the page that owns this list puts it on its own
  // wrapper, and two nested markers make "the list" ambiguous.
  if (groups.length === 0) return <>{empty}</>;

  return (
    <div className="space-y-6">
      {visible.map((g) => (
        <Section key={g.key} group={g} row={row} />
      ))}
      {foldable.map((g) => (
        <Foldable key={g.key} group={g} row={row} />
      ))}
    </div>
  );
}

function Section<T extends { id: number }>({ group, row }: { group: Group<T>; row: (i: T) => ReactNode }) {
  const tone = TONE[group.tone ?? ''] ?? PLAIN;
  return (
    <section>
      <h2 className={`mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider ${tone.heading}`}>
        {group.label}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-slate-600">
          {group.items.length}
        </span>
      </h2>
      <div className={`overflow-hidden rounded-xl border bg-white ${tone.border}`}>
        <ul className="divide-y divide-slate-100">
          {group.items.map((item) => (
            <li key={item.id} data-row-id={item.id} className="group">
              {row(item)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Foldable<T extends { id: number }>({ group, row }: { group: Group<T>; row: (i: T) => ReactNode }) {
  const [open, setOpen] = useState(false);

  // A section that empties out while open would otherwise leave an expanded
  // arrow over nothing.
  useEffect(() => {
    if (group.items.length === 0) setOpen(false);
  }, [group.items.length]);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
      >
        <ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {group.label}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {group.items.length}
        </span>
      </button>
      {open && (
        <div className="mt-2">
          <Section group={{ ...group, collapsed: false }} row={row} />
        </div>
      )}
    </div>
  );
}
