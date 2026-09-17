import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen, CheckCircle2, FileText, Pencil, Pin, Search, Trash2, X,
} from 'lucide-react';
import CrudPage, { FieldDef, ListRender } from '../components/CrudPage';
import GroupedList from '../components/GroupedList';
import Markdown from '../components/Markdown';
import MarkdownEditor from '../components/MarkdownEditor';
import { DetailRow } from '../components/DetailView';
import { knowledgeApi, apiError } from '../api/client';
import { requestRefresh } from '../hooks/useResource';
import { useToast } from '../components/Toast';
import { Badge, Button, SelectField } from '../components/ui';
import { KnowledgeArticle } from '../types';
import { fmtDate } from '../lib/constants';
import { Group } from '../lib/grouping';

const KINDS = [
  { value: 'RUNBOOK', label: 'Runbook' },
  { value: 'GUIDE', label: 'Install guide' },
  { value: 'NOTE', label: 'Note' },
  { value: 'REFERENCE', label: 'Reference' },
];

const STATUSES = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const ENVIRONMENTS = [
  { value: 'ALL', label: 'Any environment' },
  { value: 'DC', label: 'DC' },
  { value: 'DR', label: 'DR' },
  { value: 'UAT', label: 'UAT' },
  { value: 'SIT', label: 'SIT' },
  { value: 'DEV', label: 'DEV' },
];

const fields: FieldDef[] = [
  { key: 'title', label: 'Title', type: 'text', required: true, full: true },
  { key: 'kind', label: 'Kind', type: 'select', options: KINDS, defaultValue: 'NOTE' },
  { key: 'status', label: 'Status', type: 'select', options: STATUSES, defaultValue: 'DRAFT' },
  { key: 'environment', label: 'Applies to', type: 'select', options: ENVIRONMENTS, defaultValue: 'ALL' },
  { key: 'system_id', label: 'System', type: 'lookup', lookup: 'systems' },
  { key: 'summary', label: 'Summary', type: 'text', full: true, placeholder: 'One line — what this is for' },
  { key: 'tags', label: 'Tags', type: 'text', full: true, placeholder: 'was, mq, cutover — comma separated' },
  {
    key: 'body', label: 'Body', type: 'textarea', full: true,
    // Drawn by MarkdownEditor instead of a plain textarea: a runbook wants a
    // preview, a pasted screenshot and the Word document somebody emailed you.
    render: ({ value, onChange, row, error }) => (
      <MarkdownEditor
        value={value}
        onChange={onChange}
        articleId={row?.id ?? null}
        error={error}
      />
    ),
  },
  { key: 'last_verified_at', label: 'Last verified', type: 'date' },
];

/** Runbooks first: they are the ones you open mid-incident. */
const ORDER = ['RUNBOOK', 'GUIDE', 'NOTE', 'REFERENCE'];
const LABEL: Record<string, string> = {
  RUNBOOK: 'Runbooks', GUIDE: 'Install guides', NOTE: 'Notes', REFERENCE: 'Reference',
};

/** Roughly how long a runbook can go unverified before it is a rumour. */
const STALE_DAYS = 180;

function isStale(a: KnowledgeArticle): boolean {
  if (a.kind !== 'RUNBOOK') return false;
  if (!a.last_verified_at) return true;
  const days = (Date.now() - new Date(a.last_verified_at).getTime()) / 86400000;
  return days > STALE_DAYS;
}

export default function KnowledgePage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState(params.get('kind') ?? '');
  const [environment, setEnvironment] = useState(params.get('environment') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');

  const listParams = useMemo(
    () => ({ limit: 500, kind: kind || undefined, environment: environment || undefined }),
    [kind, environment]
  );

  function sync(next: Record<string, string>) {
    const merged = { kind, environment, q: query, ...next };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(merged)) if (v) out[k] = v;
    setParams(out, { replace: true });
  }

  const docxRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  /**
   * Import a Word document as a new article. Separate from the one inside the
   * editor because this is the common case - somebody sends you a vendor's
   * install guide and it should become an article without you first inventing
   * an empty one to paste it into.
   */
  async function importNew(file: File) {
    setImporting(true);
    try {
      const { data } = await knowledgeApi.importDocx(file);
      const extra = data.images ? ` · ${data.images} image${data.images === 1 ? '' : 's'}` : '';
      toast.success(`Imported "${data.article.title}"${extra}. Saved as a draft — check it before publishing.`);
      requestRefresh('Article');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setImporting(false);
    }
  }

  async function markVerified(article: KnowledgeArticle) {
    try {
      await knowledgeApi.markVerified(article.id);
      toast.success('Marked as verified today');
      requestRefresh('Article');
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  function extraDetailRows(row: KnowledgeArticle): DetailRow[] {
    const tags = (row.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    return [
      tags.length
        ? {
            label: 'Tags',
            value: (
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {t}
                  </span>
                ))}
              </div>
            ),
          }
        : { label: 'Tags', value: null },
      row.body
        ? { label: 'Body', wide: true, value: <Markdown text={row.body} /> }
        : { label: 'Body', value: null },
      row.kind === 'RUNBOOK'
        ? {
            label: 'Verification',
            wide: true,
            value: (
              <div className="flex flex-wrap items-center gap-3">
                <span className={isStale(row) ? 'text-amber-700' : 'text-slate-600'}>
                  {row.last_verified_at
                    ? `Last confirmed working ${fmtDate(row.last_verified_at)}`
                    : 'Never confirmed against a real run'}
                </span>
                <button
                  onClick={() => markVerified(row)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                >
                  <CheckCircle2 size={13} /> I just ran this — it works
                </button>
              </div>
            ),
          }
        : { label: 'Verification', value: null },
    ];
  }

  function renderList(list: ListRender<KnowledgeArticle>) {
    // The server already filtered by kind and environment; searching here keeps
    // typing responsive and the group counts honest. Word by word, matching the
    // server: nobody remembers the word order of a runbook they wrote in March,
    // so "dr failover mq" has to find "Failover MQ to DR".
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = words.length
      ? list.items.filter((a) => {
          const hay = [a.title, a.summary, a.body, a.tags].join(' ').toLowerCase();
          return words.every((w) => hay.includes(w));
        })
      : list.items;

    const pinned = shown.filter((a) => a.pinned);
    const groups: Group<KnowledgeArticle>[] = [];
    if (pinned.length) {
      groups.push({ key: 'pinned', label: 'Pinned', items: pinned, tone: 'active' });
    }
    for (const k of ORDER) {
      const items = shown.filter((a) => a.kind === k && !a.pinned);
      if (items.length) {
        groups.push({
          key: k, label: LABEL[k], items,
          tone: k === 'RUNBOOK' ? 'danger' : undefined,
        });
      }
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            name="filter-kind" label="Kind" value={kind}
            onChange={(v: string) => { setKind(v); sync({ kind: v }); }}
            options={KINDS} placeholder="Everything" className="min-w-[150px]"
          />
          <SelectField
            name="filter-environment" label="Environment" value={environment}
            onChange={(v: string) => { setEnvironment(v); sync({ environment: v }); }}
            options={ENVIRONMENTS.filter((e) => e.value !== 'ALL')}
            placeholder="Any" className="min-w-[130px]"
          />
          <div className="relative min-w-[14rem] flex-1 sm:max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="knowledge-search"
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); sync({ q: e.target.value }); }}
              placeholder="Search titles, bodies and tags…"
              aria-label="Search knowledge"
              className="block w-full rounded-lg border-0 py-2 pl-9 pr-8 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); sync({ q: '' }); }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <p className="py-2 text-sm text-slate-500">{shown.length} of {list.items.length}</p>
        </div>

        <GroupedList<KnowledgeArticle>
          groups={groups}
          empty={
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <BookOpen size={22} className="mx-auto text-slate-300" />
              <p className="mt-2 font-medium text-slate-900">
                {list.items.length ? 'Nothing matches' : 'Nothing written down yet'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {list.items.length
                  ? 'Try a wider kind, or clear the search.'
                  : 'Runbooks, install guides and the things you had to work out once.'}
              </p>
            </div>
          }
          row={(article) => (
            <Row
              article={article}
              onView={() => list.onView(article)}
              onEdit={() => list.onEdit(article)}
              onDelete={() => list.onDelete(article)}
            />
          )}
        />
      </div>
    );
  }

  return (
    <CrudPage<KnowledgeArticle>
      title="Knowledge" singular="Article" api={knowledgeApi}
      fields={fields} attachAs="knowledge"
      labelKey="title"
      subtitle="Runbooks, install guides and what you worked out once"
      listParams={listParams}
      renderList={renderList}
      headerExtra={
        <>
          <Button onClick={() => docxRef.current?.click()} disabled={importing}>
            <FileText size={16} /> {importing ? 'Converting…' : 'Import Word'}
          </Button>
          <input
            ref={docxRef} type="file" accept=".docx" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importNew(f);
              e.target.value = '';
            }}
          />
        </>
      }
      extraDetailRows={extraDetailRows}
      // The body is rendered as markdown below; showing the raw source too
      // would put the same runbook on screen twice.
      // `tags` is a comma-separated string in the database; the detail view
      // shows it as chips rather than "was,mbs,restart".
      omitDetailFields={['body', 'tags']}
    />
  );
}

function Row({
  article, onView, onEdit, onDelete,
}: {
  article: KnowledgeArticle;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tags = (article.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const stale = isStale(article);

  return (
    <div className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {article.pinned && <Pin size={13} className="shrink-0 text-blue-600" />}
          <button
            onClick={onView}
            className="text-left text-sm font-medium text-slate-900 hover:text-blue-700"
          >
            {article.title}
          </button>
          {article.environment && article.environment !== 'ALL' && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              {article.environment}
            </span>
          )}
          {article.status !== 'PUBLISHED' && <Badge value={article.status} />}
          {/* A runbook nobody has run in six months is a rumour, so say so. */}
          {stale && (
            <span
              className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
              title={article.last_verified_at
                ? `Not confirmed working since ${fmtDate(article.last_verified_at)}`
                : 'Never confirmed against a real run'}
            >
              unverified
            </span>
          )}
        </div>
        {article.summary && (
          <p className="mt-0.5 truncate text-xs text-slate-500">{article.summary}</p>
        )}
        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onEdit}
          aria-label="Edit"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete"
          className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-50 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
