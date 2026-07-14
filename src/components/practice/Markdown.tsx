import type { ReactNode } from 'react';

/**
 * Tiny internal markdown-to-React renderer (SPEC-PRACTICE.md §8) — no
 * dependency. Supports exactly what question/solution content needs:
 * `#`/`##`/`###` headings, unordered lists (`-`/`*`), paragraphs (blank-line
 * separated), and inline `**bold**` / `` `code` ``. Anything else is rendered
 * as plain text — this is intentionally not a general-purpose parser.
 */

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c${i++}`}
          className="rounded px-1 py-0.5 font-mono text-[11px]"
          style={{ background: 'var(--chip-bg)' }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'text-[15px] font-semibold text-foreground mt-1 first:mt-0',
  2: 'text-[13px] font-semibold text-foreground mt-3 first:mt-0',
  3: 'text-[12px] font-semibold uppercase tracking-wide text-muted mt-3 first:mt-0',
};

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let paragraphBuf: string[] = [];
  let listBuf: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return;
    const k = `p-${key++}`;
    blocks.push(
      <p key={k} className="text-[12px] leading-relaxed text-foreground/90">
        {parseInline(paragraphBuf.join(' '), k)}
      </p>,
    );
    paragraphBuf = [];
  };

  const flushList = () => {
    if (listBuf.length === 0) return;
    const k = `l-${key++}`;
    blocks.push(
      <ul key={k} className="flex flex-col gap-1 pl-1 text-[12px] leading-snug text-foreground/90">
        {listBuf.map((item, idx) => (
          <li key={`${k}-${idx}`} className="flex gap-1.5">
            <span className="mt-[2px] text-accent">•</span>
            <span>{parseInline(item, `${k}-${idx}`)}</span>
          </li>
        ))}
      </ul>,
    );
    listBuf = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    const listMatch = /^[-*]\s+(.*)$/.exec(line);

    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length as 1 | 2 | 3;
      const k = `h-${key++}`;
      const content = parseInline(headingMatch[2], k);
      const HeadingTag = (`h${level}` as unknown) as 'h1' | 'h2' | 'h3';
      blocks.push(
        <HeadingTag key={k} className={HEADING_CLASS[level]}>
          {content}
        </HeadingTag>,
      );
    } else if (listMatch) {
      flushParagraph();
      listBuf.push(listMatch[1]);
    } else if (line === '') {
      flushParagraph();
      flushList();
    } else if (listBuf.length > 0) {
      // Non-empty line that isn't itself a new item/heading — a wrapped
      // continuation of the current list item's text.
      listBuf[listBuf.length - 1] = `${listBuf[listBuf.length - 1]} ${line}`;
    } else {
      paragraphBuf.push(line);
    }
  }
  flushParagraph();
  flushList();

  return <div className={`flex flex-col gap-2 ${className ?? ''}`}>{blocks}</div>;
}
