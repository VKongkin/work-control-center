import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Render a runbook.
 *
 * Sanitised on the way out even though the text is your own. A runbook is
 * pasted together from vendor documentation, ticket comments and wiki exports,
 * and "it is only my own notes" stops being true the moment one is pasted in
 * from somewhere else. The cost of sanitising is nothing; the cost of not
 * doing it is a stored script running with your session.
 */
export default function Markdown({ text, className = '' }: { text?: string | null; className?: string }) {
  const html = useMemo(() => {
    if (!text) return '';
    const raw = marked.parse(text, { async: false, breaks: true, gfm: true }) as string;
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [text]);

  if (!text) return null;

  return (
    <div
      // Tailwind's typography plugin is not installed, so the handful of
      // elements a runbook actually uses are styled here rather than pulling in
      // a dependency for four selectors.
      className={`wcc-markdown text-sm leading-relaxed text-slate-700 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
