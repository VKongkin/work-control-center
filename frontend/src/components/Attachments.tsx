import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, FolderOpen, FileText, Image as ImageIcon, Download, Trash2, Paperclip,
} from 'lucide-react';
import { apiError, attachmentApi } from '../api/client';
import { Attachment } from '../types';
import { useToast } from './Toast';
import { Button, ConfirmDialog, Spinner } from './ui';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const isImage = (t: string) => t.startsWith('image/');

/**
 * Files attached to one record.
 *
 * Three ways in, because people reach for different ones: drag something from
 * the desktop, pick files from Finder or Explorer, or pick a whole folder. A
 * folder keeps its structure, which is what makes an uploaded tool still work.
 */
export default function Attachments({
  entityType,
  entityId,
  /** Folder picking only makes sense for tools; a task wants plain files. */
  allowFolder = false,
  compact = false,
  onChange,
}: {
  entityType: string;
  entityId: number;
  allowFolder?: boolean;
  compact?: boolean;
  onChange?: () => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toDelete, setToDelete] = useState<Attachment | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await attachmentApi.list(entityType, entityId)).data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = useCallback(
    async (files: File[], paths?: string[]) => {
      if (!files.length) return;
      setBusy(true);
      try {
        await attachmentApi.upload(entityType, entityId, files, paths);
        toast.success(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`);
        await load();
        onChange?.();
      } catch (err) {
        toast.error(apiError(err));
      } finally {
        setBusy(false);
      }
    },
    [entityType, entityId, load, onChange, toast]
  );

  function pickedFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    // webkitRelativePath is set only for a folder pick; the server strips the
    // wrapper directory so index.html ends up at the root.
    const paths = files.map((f) => (f as any).webkitRelativePath || f.name);
    send(files, paths);
  }

  async function dropped(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) send(files, files.map((f) => f.name));
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={dropped}
        className={`rounded-xl border-2 border-dashed px-4 transition-colors ${
          compact ? 'py-4' : 'py-6'
        } ${dragging ? 'border-blue-400 bg-blue-50/60' : 'border-slate-300 bg-slate-50/50'}`}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <Upload className={dragging ? 'text-blue-500' : 'text-slate-400'} size={compact ? 18 : 22} />
          <p className="text-sm text-slate-600">
            {dragging ? 'Drop to upload' : 'Drag files here, or'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => fileInput.current?.click()} disabled={busy}>
              <FileText size={14} /> Choose files
            </Button>
            {allowFolder && (
              <Button onClick={() => folderInput.current?.click()} disabled={busy}>
                <FolderOpen size={14} /> Choose folder
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-400">Up to 10 MB per file</p>
        </div>

        <input
          ref={fileInput} type="file" multiple hidden
          onChange={(e) => { pickedFiles(e.target.files); e.target.value = ''; }}
        />
        {allowFolder && (
          <input
            ref={folderInput} type="file" hidden
            // Not in the React types, but supported by Chrome, Edge and Safari.
            {...({ webkitdirectory: '', directory: '' } as any)}
            onChange={(e) => { pickedFiles(e.target.files); e.target.value = ''; }}
          />
        )}
      </div>

      {busy && <p className="mt-3 text-sm text-slate-500">Uploading…</p>}

      {loading ? (
        <Spinner label="Loading files…" />
      ) : items.length === 0 ? (
        !busy && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-400">
            <Paperclip size={14} /> No files yet
          </p>
        )
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {items.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
              {isImage(f.content_type) ? (
                <img
                  src={attachmentApi.inlineUrl(f.id)}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded object-cover ring-1 ring-slate-200"
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-400">
                  {isImage(f.content_type) ? <ImageIcon size={16} /> : <FileText size={16} />}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{f.path}</p>
                <p className="text-xs text-slate-500">
                  {formatBytes(f.size)} · {f.content_type}
                </p>
              </div>
              <a
                href={attachmentApi.downloadUrl(f.id)}
                download={f.filename}
                aria-label={`Download ${f.filename}`}
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <Download size={15} />
              </a>
              <button
                onClick={() => setToDelete(f)}
                aria-label={`Delete ${f.filename}`}
                className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete file"
        message={`"${toDelete?.path}" will be permanently removed.`}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (toDelete) {
            try {
              await attachmentApi.remove(toDelete.id);
              toast.success('File deleted');
              await load();
              onChange?.();
            } catch (err) {
              toast.error(apiError(err));
            }
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
