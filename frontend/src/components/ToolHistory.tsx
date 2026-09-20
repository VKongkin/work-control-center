import { useCallback, useEffect, useState } from 'react';
import {
  Download, FileDiff, History, Loader2, RotateCcw, Upload,
} from 'lucide-react';
import { toolFiles, apiError } from '../api/client';
import { Tool, ToolVersion } from '../types';
import { useToast } from '../components/Toast';
import { Button, ConfirmDialog, EmptyState } from './ui';
import { formatBytes } from './Attachments';
import { fmtDateTime } from '../lib/constants';

/**
 * Every version this tool has had.
 *
 * The question this answers is "it worked yesterday" — which, before there was
 * a history, had no answer at all: a pull overwrote what came before and that
 * was the end of it. Now each pull and each upload leaves a version, what
 * changed is listed rather than implied, and going back is a button.
 *
 * Going back is itself recorded as a version rather than deleting what came
 * after. The next question after a rollback is always "what was I running when
 * it broke", and a history that quietly loses that is worse than none.
 */
const ORIGIN: Record<string, { label: string; tone: string; Icon: typeof Upload }> = {
  import: { label: 'Pulled', tone: 'bg-blue-50 text-blue-700 ring-blue-200', Icon: Download },
  upload: { label: 'Uploaded', tone: 'bg-slate-100 text-slate-600 ring-slate-200', Icon: Upload },
  restore: { label: 'Restored', tone: 'bg-amber-50 text-amber-800 ring-amber-200', Icon: RotateCcw },
};

export default function ToolHistory({
  tool, onChanged,
}: {
  tool: Tool;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<ToolVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ToolVersion | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await toolFiles.versions(tool.id);
      setRows(data);
    } catch (err) {
      toast.error(apiError(err));
      setRows([]);
    }
  }, [tool.id, toast]);

  useEffect(() => { load(); }, [load]);

  async function restore(v: ToolVersion) {
    setBusy(true);
    try {
      const { data } = await toolFiles.restore(tool.id, v.id);
      toast.success(data.message);
      await load();
      onChanged();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  if (rows === null) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
        <Loader2 size={14} className="animate-spin" /> Loading history…
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No versions yet"
        hint="A version is recorded the first time files are uploaded or pulled."
      />
    );
  }

  return (
    <div className="space-y-2" data-tool-history>
      <ul className="space-y-2">
        {rows.map((v) => {
          const o = ORIGIN[v.origin] ?? ORIGIN.upload;
          const { added, changed, removed } = v.changes;
          const touched = added.length + changed.length + removed.length;
          return (
            <li
              key={v.id}
              data-version={v.number}
              className={`rounded-lg border px-3 py-2.5 ${
                v.current ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium text-slate-900">
                  v{v.number}
                </span>
                <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${o.tone}`}>
                  <o.Icon size={11} /> {o.label}
                </span>
                {v.current && (
                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    current
                  </span>
                )}
                {v.source_ref && (
                  <span className="font-mono text-[11px] text-slate-500">{v.source_ref}</span>
                )}
                <span className="text-xs text-slate-500">
                  {v.file_count} file{v.file_count === 1 ? '' : 's'} · {formatBytes(v.total_bytes)}
                </span>
                <span className="ml-auto text-xs text-slate-400">
                  {v.created_at ? fmtDateTime(v.created_at) : ''}
                </span>
                {!v.current && (
                  <Button
                    className="!py-1 !text-xs"
                    disabled={busy}
                    onClick={() => setConfirm(v)}
                    data-restore={v.number}
                  >
                    <RotateCcw size={12} /> Restore
                  </Button>
                )}
              </div>

              {touched > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <FileDiff size={11} className="text-slate-400" />
                  {added.length > 0 && (
                    <span className="text-green-700" title={added.join('\n')}>
                      +{added.length} added
                    </span>
                  )}
                  {changed.length > 0 && (
                    <span className="text-amber-700" title={changed.join('\n')}>
                      ~{changed.length} changed
                    </span>
                  )}
                  {removed.length > 0 && (
                    <span className="text-red-700" title={removed.join('\n')}>
                      −{removed.length} removed
                    </span>
                  )}
                  <span className="truncate font-mono text-slate-400">
                    {[...changed, ...added, ...removed].slice(0, 3).join(', ')}
                    {touched > 3 ? ` +${touched - 3} more` : ''}
                  </span>
                </div>
              )}

              {v.note && <p className="mt-1 truncate text-[11px] text-slate-500">{v.note}</p>}
            </li>
          );
        })}
      </ul>

      <p className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-slate-400">
        <History size={11} />
        Files are stored once per version and shared between them, so keeping
        history costs only what actually changed.
      </p>

      <ConfirmDialog
        open={!!confirm}
        title={`Restore version ${confirm?.number}`}
        message={
          `The tool's files go back to how version ${confirm?.number} had them ` +
          `(${confirm?.file_count} file${confirm?.file_count === 1 ? '' : 's'}). ` +
          `Nothing is lost — where you are now is kept as a version of its own.`
        }
        confirmLabel="Restore"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && restore(confirm)}
      />
    </div>
  );
}
