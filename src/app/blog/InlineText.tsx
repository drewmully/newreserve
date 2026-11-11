import Link from "next/link";
import { Fragment } from "react";

const LINK = /\[([^\]]+)\]\(((?:\/|https:\/\/)[^)\s]*)\)/g;

/**
 * Renders [label](/path) as internal links and [label](https://...) as
 * external source links (new tab); everything else as plain text.
 */
export function InlineText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(m[2].startsWith("/")
      ? <Link key={i} href={m[2]} className="underline underline-offset-4 decoration-1">{m[1]}</Link>
      : <a key={i} href={m[2]} target="_blank" rel="noopener" className="underline underline-offset-4 decoration-1">{m[1]}</a>);
    last = i + m[0].length;
  }
  if (last === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, k) => <Fragment key={k}>{p}</Fragment>)}</>;
}
