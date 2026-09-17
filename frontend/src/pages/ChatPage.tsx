import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Bot, Loader2, MessageSquarePlus, Send, Trash2, Wrench,
} from 'lucide-react';
import { chatApi, apiError } from '../api/client';
import Markdown from '../components/Markdown';
import { useToast } from '../components/Toast';
import { Button, PageHeader, Spinner } from '../components/ui';
import { ChatMessage, ChatStatus, ChatThread } from '../types';
import { requestRefresh } from '../hooks/useResource';
import { fmtDateTime } from '../lib/constants';

/**
 * The assistant, inside WCC.
 *
 * The same eight tools the MCP endpoint publishes, but the loop runs on the
 * server here - so there is no client to install, no MCP config, and no key to
 * paste in every morning. That was the whole complaint about the VS Code route.
 *
 * Tool calls are shown rather than hidden. This assistant can create tasks and
 * rewrite runbooks; what it touched is not a detail to bury behind a spinner.
 */

/**
 * Which list a tool call invalidates. Only the writing tools are here: a turn
 * that merely searched has changed nothing, and telling every open list to
 * reload after a question would be noise.
 */
const TOUCHES: Record<string, string> = {
  create_task: 'Task',
  update_task: 'Task',
  create_knowledge: 'Article',
  update_knowledge: 'Article',
};

const SUGGESTIONS = [
  'What runbooks do I have for DR?',
  'What is overdue?',
  'Raise a task to review the MQ channel status, high priority',
  'Which servers run WebSphere?',
];

export default function ChatPage() {
  const toast = useToast();
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // Selecting a conversation loads it. Starting one mid-send must not, or the
  // fetch races the turn and whichever lands last wins.
  const skipLoad = useRef(false);

  const loadThreads = useCallback(async () => {
    try {
      const { data } = await chatApi.threads();
      setThreads(data);
      return data;
    } catch (err) {
      toast.error(apiError(err));
      return [];
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      try {
        const [st] = await Promise.all([chatApi.status(), loadThreads()]);
        setStatus(st.data);
      } catch (err) {
        toast.error(apiError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadThreads, toast]);

  useEffect(() => {
    if (active == null) { setMessages([]); return; }
    if (skipLoad.current) { skipLoad.current = false; return; }
    chatApi.messages(active)
      .then(({ data }) => setMessages(data))
      .catch((err) => toast.error(apiError(err)));
  }, [active, toast]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  async function send(text?: string) {
    const body = (text ?? draft).trim();
    if (!body || sending) return;

    let threadId = active;
    if (threadId == null) {
      try {
        const { data } = await chatApi.newThread();
        threadId = data.id;
        skipLoad.current = true;
        setActive(data.id);
        setThreads((prev) => [data, ...prev]);
      } catch (err) {
        toast.error(apiError(err));
        return;
      }
    }

    setDraft('');
    setSending(true);
    // Shown immediately with a negative id so the question does not vanish
    // while the model thinks. The turn comes back with the stored row for it,
    // which replaces this one - hence dropping every negative id below.
    setMessages((prev) => [...prev, { id: -Date.now(), role: 'user', content: body }]);

    try {
      const { data } = await chatApi.send(threadId, body);
      setMessages((prev) => [...prev.filter((m) => m.id > 0), ...data.messages]);
      setThreads((prev) => prev.map((t) =>
        t.id === data.thread.id ? { ...t, title: data.thread.title } : t));
      // The turn may have created a task or edited an article; whatever list is
      // open behind this page should not still be showing the old copy.
      const touched = new Set(
        data.messages
          .map((m) => (m.tool_name ? TOUCHES[m.tool_name] : undefined))
          .filter(Boolean) as string[],
      );
      touched.forEach(requestRefresh);
    } catch (err) {
      toast.error(apiError(err));
      // The question was stored before the model was called, so a model that
      // fails leaves it on the server whatever this page does. Rather than
      // guess, take the conversation as it actually is - which keeps the
      // question visible to ask again from, instead of losing the typing.
      try {
        const { data } = await chatApi.messages(threadId);
        setMessages(data);
      } catch {
        setMessages((prev) => prev.filter((m) => m.id > 0));
        setDraft(body);
      }
    } finally {
      setSending(false);
      boxRef.current?.focus();
    }
  }

  async function removeThread(id: number) {
    try {
      await chatApi.deleteThread(id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (active === id) setActive(null);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  if (loading) return <Spinner label="Loading…" />;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col space-y-4">
      <PageHeader
        title="Assistant"
        subtitle="Asks your runbooks, raises your tasks — using the same tools Copilot would"
        action={
          <Button
            id="new-conversation"
            onClick={() => { setActive(null); setMessages([]); setDraft(''); }}
          >
            <MessageSquarePlus size={16} /> New conversation
          </Button>
        }
      />

      {status && !status.enabled && <NoModel status={status} />}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* ------------------------------------------------ conversations */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto lg:block">
          <p className="mb-1.5 px-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Conversations
          </p>
          {threads.length === 0 ? (
            <p className="px-2 text-xs text-slate-400">No conversations yet.</p>
          ) : (
            <ul className="space-y-0.5" data-list>
              {threads.map((t) => (
                <li key={t.id} data-row-id={t.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => setActive(t.id)}
                    className={`min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                      active === t.id
                        ? 'bg-blue-50 font-medium text-blue-800'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    title={t.title}
                  >
                    {t.title}
                  </button>
                  <button
                    onClick={() => removeThread(t.id)}
                    aria-label={`Delete ${t.title}`}
                    className="rounded p-1 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ------------------------------------------------------ the chat */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-chat-log>
            {messages.length === 0 ? (
              <Opening onPick={(q) => send(q)} disabled={!status?.enabled || sending} />
            ) : (
              <div className="space-y-3">
                {messages.map((m) => <Bubble key={m.id} message={m} />)}
                {sending && (
                  <div className="flex items-center gap-2 px-1 text-sm text-slate-400">
                    <Loader2 size={14} className="animate-spin" />
                    Thinking, and using tools if it needs them…
                  </div>
                )}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-100 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={boxRef}
                id="chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter is a new line. Same as every chat
                  // this person already uses.
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                rows={2}
                disabled={!status?.enabled || sending}
                placeholder={status?.enabled
                  ? 'Ask about a runbook, a server, or what is overdue…'
                  : 'Configure a model to switch this on'}
                className="min-h-[2.75rem] flex-1 resize-none rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 disabled:bg-slate-50"
              />
              <Button
                variant="primary"
                onClick={() => send()}
                disabled={!draft.trim() || sending || !status?.enabled}
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Send
              </Button>
            </div>
            {status?.enabled && (
              <p className="mt-1.5 px-1 text-[11px] text-slate-400">
                {status.model} · {status.tools.length} tools · passwords are not among them
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function NoModel({ status }: { status: ChatStatus }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="text-sm text-amber-900">
        <p className="font-medium">No model is configured, so the chat cannot answer yet.</p>
        <p className="mt-1 text-amber-800">{status.detail}</p>
        <p className="mt-2 text-xs text-amber-800">
          The quickest route is LM Studio on this machine — free, and nothing
          leaves it. <code className="rounded bg-amber-100 px-1">COPILOT.md</code> has
          the three environment variables and the Azure OpenAI settings for later.
        </p>
      </div>
    </div>
  );
}

function Opening({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Bot size={26} className="text-slate-300" />
      <p className="mt-2 font-medium text-slate-900">Ask about your own work</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        It searches your runbooks, reads your servers and raises your tasks. It
        cannot read a stored password — that is not a setting, it has no path to one.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            disabled={disabled}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Tool results arrive as one long line of JSON, which is what the model wants
 * and the worst thing to put in front of a person. Indent it if it parses, and
 * leave anything else - an error sentence, mostly - exactly as it came.
 */
function pretty(text: string | null): string {
  const raw = text ?? '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** A tool result, folded away. Visible on demand, not in your face. */
function ToolCall({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const failed = (message.content ?? '').startsWith('ERROR:');
  return (
    <div className="px-1">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-tool-call={message.tool_name ?? ''}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-inset transition ${
          failed
            ? 'bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100'
            : 'bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100'
        }`}
      >
        <Wrench size={12} />
        {message.tool_name}
        {failed && ' — refused'}
      </button>
      {open && (
        <pre className="mt-1.5 max-h-72 max-w-[46rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-200">
          {pretty(message.content)}
        </pre>
      )}
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') return <ToolCall message={message} />;

  // An assistant turn that only requested tools has no words of its own; the
  // chips below it are the content, so an empty bubble would be noise.
  if (message.role === 'assistant' && !message.content?.trim()) return null;

  const mine = message.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`} data-role={message.role}>
      <div
        className={`max-w-[46rem] rounded-2xl px-4 py-2.5 ${
          mine ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-800 ring-1 ring-inset ring-slate-200'
        }`}
      >
        {mine ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : (
          <Markdown text={message.content} />
        )}
        {message.created_at && (
          <p className={`mt-1 text-[10px] ${mine ? 'text-blue-200' : 'text-slate-400'}`}>
            {fmtDateTime(message.created_at)}
          </p>
        )}
      </div>
    </div>
  );
}
