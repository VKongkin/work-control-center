import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, ExternalLink, Maximize2, Minimize2, ShieldCheck } from 'lucide-react';
import { apiError, toolApi, toolFiles } from '../api/client';
import { Tool, ToolManifest } from '../types';
import { Button, EmptyState, ErrorBanner, Spinner } from '../components/ui';

/**
 * Runs an uploaded tool.
 *
 * The tool is served from this app's own host, so it goes inside an iframe
 * without `allow-same-origin`. That gives it an opaque origin: its HTML, CSS
 * and JavaScript run normally and relative paths resolve, but it cannot read
 * this app's storage, call its API as you, or reach into the page around it.
 * A tool with a bug cannot damage your real work.
 */
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads';

export default function ToolRunPage() {
  const { id } = useParams();
  const toolId = Number(id);

  const [tool, setTool] = useState<Tool | null>(null);
  const [manifest, setManifest] = useState<ToolManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, m] = await Promise.all([toolApi.getById(toolId), toolFiles.manifest(toolId)]);
      setTool(t.data as Tool);
      setManifest(m.data as ToolManifest);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [toolId]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape leaves full screen, matching what the button does.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  if (loading) return <Spinner label="Loading tool…" />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!tool) return null;

  if (!manifest?.runnable || !manifest.entry_path) {
    return (
      <div className="space-y-5">
        <Link to="/tools" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700">
          <ArrowLeft size={15} /> All tools
        </Link>
        <EmptyState
          title={`${tool.name} has no page to open`}
          hint="Upload a folder containing an HTML file, then try again."
          action={<Link to="/tools"><Button variant="primary">Manage files</Button></Link>}
        />
      </div>
    );
  }

  const src = `${toolFiles.entryUrl(tool.id, manifest.entry_path)}?v=${nonce}`;

  const frame = (
    <iframe
      key={nonce}
      src={src}
      title={tool.name}
      sandbox={SANDBOX}
      className="h-full w-full border-0 bg-white"
    />
  );

  if (full) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <p className="text-sm font-medium text-slate-800">{tool.name}</p>
          <div className="flex gap-1.5">
            <Button onClick={() => setNonce((n) => n + 1)}><RefreshCw size={14} /> Reload</Button>
            <Button onClick={() => setFull(false)}><Minimize2 size={14} /> Exit full screen</Button>
          </div>
        </div>
        <div className="flex-1">{frame}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/tools" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700">
            <ArrowLeft size={15} /> All tools
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{tool.name}</h1>
          {tool.description && <p className="mt-1 text-sm text-slate-500">{tool.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setNonce((n) => n + 1)}><RefreshCw size={14} /> Reload</Button>
          <Button onClick={() => setFull(true)}><Maximize2 size={14} /> Full screen</Button>
          <a
            href={toolFiles.entryUrl(tool.id, manifest.entry_path)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-50"
          >
            <ExternalLink size={14} /> New tab
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <ShieldCheck size={14} className="shrink-0 text-emerald-600" />
          <p className="text-xs text-slate-500">
            Sandboxed — this tool runs isolated and cannot read or change your work data.
          </p>
          <span className="ml-auto truncate font-mono text-xs text-slate-400">
            {manifest.entry_path}
          </span>
        </div>
        <div className="h-[calc(100vh-19rem)] min-h-[420px]">{frame}</div>
      </div>
    </div>
  );
}
