import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Loader2 } from 'lucide-react';
import { toolFiles, apiError } from '../api/client';
import { ImportResult, ImportStatus, Tool } from '../types';
import { Button, Modal, TextField } from './ui';
import { formatBytes } from './Attachments';

/**
 * Build a tool from a repository link.
 *
 * The folder is usually already in Git, and uploading it by hand is the
 * tedious version of `git clone` - worse, it goes stale silently. Paste the
 * page you would browse the files on and WCC fetches them itself.
 *
 * The result is shown rather than summarised as "done": which files arrived,
 * which branch they came from, and what was deliberately left behind. An
 * import that quietly dropped half a tool would be discovered when it failed
 * to run, which is the wrong moment.
 */
export default function ImportFromLink({
  open, onClose, onImported, tool,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
  /** Set to refresh an existing tool rather than create a new one. */
  tool?: Tool | null;
}) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl(''); setName(''); setError(null); setDone(null);
    toolFiles.importStatus()
      .then(({ data }) => setStatus(data))
      .catch((err) => setError(apiError(err)));
  }, [open]);

  async function run() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await toolFiles.importLink({
        url: url.trim(),
        ...(tool ? { tool_id: tool.id } : name.trim() ? { name: name.trim() } : {}),
      });
      setDone(data);
      onImported(data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  const off = status && !status.enabled;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tool ? `Refresh ${tool.name} from a link` : 'Import a tool from a link'}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button
              variant="primary"
              onClick={run}
              disabled={busy || !url.trim() || !!off}
              id="do-import"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
              {busy ? 'Fetching…' : 'Import'}
            </Button>
          </>
        )
      }
    >
      {off && (
        <div
          className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
          data-import-off
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">Importing from a link is switched off.</p>
            <p className="mt-1 text-amber-800">{status?.detail}</p>
          </div>
        </div>
      )}

      {done ? (
        <div className="space-y-3" data-import-done>
          <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600" />
            <div className="text-sm text-green-900">
              <p className="font-medium">
                {done.imported} file{done.imported === 1 ? '' : 's'} imported
                {done.ref ? ` from ${done.ref}` : ''} · {formatBytes(done.bytes)}
              </p>
              <p className="mt-1 text-green-800">
                {done.runnable
                  ? `It opens at ${done.entry_path}.`
                  : 'No HTML file came across, so this will not run yet.'}
              </p>
            </div>
          </div>

          <div className="max-h-48 overflow-auto rounded-lg border border-slate-200">
            <ul className="divide-y divide-slate-100 text-xs">
              {done.files.map((f) => (
                <li key={f} className="px-3 py-1.5 font-mono text-slate-600">{f}</li>
              ))}
            </ul>
          </div>

          {Object.keys(done.skipped || {}).length > 0 && (
            <p className="text-xs text-slate-500">
              Left behind:{' '}
              {Object.entries(done.skipped)
                .map(([why, n]) => `${n} ${why}`)
                .join(', ')}
              . A tool is the page and its assets, not the whole repository.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <TextField
            label="Repository link"
            name="import-url"
            value={url}
            onChange={setUrl}
            disabled={busy || !!off}
            placeholder="https://github.com/you/your-tool"
            hint="A repository, a branch, a folder inside one, or a direct link to a .tar.gz or .zip."
          />

          {!tool && (
            <TextField
              label="Name it (optional)"
              name="import-name"
              value={name}
              onChange={setName}
              disabled={busy || !!off}
              placeholder="Taken from the link if you leave this blank"
            />
          )}

          {tool && (
            <p className="text-xs text-slate-500">
              This replaces the files in <strong>{tool.name}</strong>. A tool is one
              folder, and half of an old version mixed with half of a new one is
              worse than either.
            </p>
          )}

          {status?.enabled && (
            <p className="text-xs text-slate-500">
              WCC will fetch from {status.hosts.join(', ')} and nowhere else.
              {status.token_set ? ' A token is set for private repositories.' : ''}
            </p>
          )}

          {error && (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              data-import-error
            >
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
