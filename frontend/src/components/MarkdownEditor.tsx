import { useCallback, useRef, useState } from 'react';
import { Eye, FileText, ImagePlus, Loader2, Pencil } from 'lucide-react';
import Markdown from './Markdown';
import { attachmentApi, knowledgeApi, apiError } from '../api/client';
import { useToast } from '../components/Toast';

/**
 * The body of a runbook: markdown, with the two things a runbook actually
 * needs - a pasted screenshot and a Word document somebody sent you.
 *
 * Images become attachments and the body references them by URL. The
 * alternative, a base64 data URI inline, keeps everything in one field and
 * costs about a third more bytes than the image, in a column that search reads
 * on every query. A 300 KB screenshot would make the article unsearchable in
 * practice and the row enormous.
 *
 * That has one consequence worth being honest about: an image needs an article
 * to belong to, so pasting only works once the article has been saved. Rather
 * than inventing a hidden draft, the toolbar says so.
 */
export default function MarkdownEditor({
  value,
  onChange,
  articleId,
  error,
  onImported,
}: {
  value: string;
  onChange: (next: string) => void;
  /** null while the article is being created - nothing to attach files to yet. */
  articleId: number | null;
  error?: string;
  /** Called after a Word import changes the body server-side. */
  onImported?: () => void;
}) {
  const toast = useToast();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const docxRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [dragging, setDragging] = useState(false);

  /** Put text where the cursor is, not at the end. */
  const insert = useCallback((snippet: string) => {
    const el = ref.current;
    if (!el) { onChange(`${value}\n\n${snippet}\n`); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    // A block element needs a blank line around it or markdown swallows it
    // into the paragraph it landed in.
    const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const tail = after && !after.startsWith('\n') ? '\n\n' : '\n';
    const next = `${before}${lead}${snippet}${tail}${after}`;
    onChange(next);
    requestAnimationFrame(() => {
      const at = (before + lead + snippet).length;
      el.focus();
      el.setSelectionRange(at, at);
    });
  }, [value, onChange]);

  const uploadImages = useCallback(async (files: File[]) => {
    if (!files.length) return;
    if (!articleId) {
      toast.error('Save the article first — an image needs somewhere to live.');
      return;
    }
    setBusy(files.length > 1 ? `Uploading ${files.length} images…` : 'Uploading image…');
    try {
      const { data } = await attachmentApi.upload('knowledge', articleId, files);
      const snippet = data
        .map((f: any) => `![${f.filename}](/api/attachments/${f.id}/inline)`)
        .join('\n\n');
      insert(snippet);
      toast.success(files.length > 1 ? `${files.length} images added` : 'Image added');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(null);
    }
  }, [articleId, insert, toast]);

  /** Clipboard images arrive as files with no name; give them one. */
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const images = items
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter(Boolean) as File[];
    if (!images.length) return;      // ordinary text paste, leave it alone
    e.preventDefault();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    uploadImages(images.map((f, i) => new File(
      [f],
      f.name && f.name !== 'image.png' ? f.name : `pasted-${stamp}${images.length > 1 ? `-${i + 1}` : ''}.png`,
      { type: f.type },
    )));
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    setDragging(false);
    const docx = files.find((f) => f.name.toLowerCase().endsWith('.docx'));
    if (docx) { importDocx(docx); return; }
    uploadImages(files.filter((f) => f.type.startsWith('image/')));
  }

  async function importDocx(file: File) {
    setBusy('Converting the document…');
    try {
      const { data } = await knowledgeApi.importDocx(file, articleId ?? undefined);
      const bits = [`Imported ${file.name}`];
      if (data.images) bits.push(`${data.images} image${data.images === 1 ? '' : 's'}`);
      if (data.images_skipped) {
        bits.push(`${data.images_skipped} kept as attachments only (Word vector format)`);
      }
      toast.success(bits.join(' · '));
      if (data.warnings?.length) {
        toast.error(`Word styles that did not map: ${data.warnings.slice(0, 2).join('; ')}`);
      }
      // The server rewrote the body, so take its version rather than merging.
      onChange(data.article.body ?? '');
      onImported?.();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(null);
    }
  }

  const disabledHint = articleId ? undefined : 'Save the article first';

  return (
    <div className={error ? 'rounded-lg ring-1 ring-red-300' : ''}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <label className="block text-sm font-medium text-slate-700">Body</label>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!articleId || !!busy}
            title={disabledHint ?? 'Add an image'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <ImagePlus size={13} /> Image
          </button>
          <button
            type="button"
            onClick={() => docxRef.current?.click()}
            disabled={!!busy}
            title="Convert a Word document into this article"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <FileText size={13} /> Word
          </button>
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {preview ? <Pencil size={13} /> : <Eye size={13} />}
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
      </div>

      {preview ? (
        <div className="min-h-[16rem] rounded-lg border border-slate-200 bg-white px-4 py-3">
          {value.trim()
            ? <Markdown text={value} />
            : <p className="text-sm text-slate-400">Nothing written yet.</p>}
        </div>
      ) : (
        <textarea
          ref={ref}
          id="f-body"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          rows={16}
          spellCheck={false}
          placeholder={'# Steps\n\n1. …\n\nMarkdown. ``` for command blocks, - for lists.'}
          className={`block w-full rounded-lg border-0 px-3 py-2 font-mono text-sm text-slate-900 ring-1 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 ${
            dragging ? 'ring-2 ring-blue-500 bg-blue-50/40' : 'ring-slate-300'
          }`}
        />
      )}

      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
        {busy && <Loader2 size={12} className="animate-spin" />}
        {busy ?? (articleId
          ? 'Paste or drop a screenshot straight in. Drop a .docx to convert it.'
          : 'Save the article, then you can paste screenshots and import Word documents into it.')}
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      <input
        ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          uploadImages(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={docxRef} type="file" accept=".docx" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importDocx(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
