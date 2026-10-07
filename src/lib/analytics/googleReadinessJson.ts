/** Existing parseEvidence scanner semantics, copied for the server-only Google
 * readiness adapter. Only types, export name and the tighter byte cap differ. */
export function parseGoogleReadinessJson(text: string): unknown {
  if (Buffer.byteLength(text) > 16384) throw new Error("invalid_evidence");
  let at = 0;
  const bad = (): never => { throw new Error("invalid_evidence"); };
  const space = () => { while (/[ \t\r\n]/.test(text[at] ?? "") && at < text.length) at++; };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      if (text[at] === "\\") { at += 2; continue; }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    return bad();
  };
  const value = (depth: number): void => {
    if (depth > 32) bad();
    space();
    if (text[at] === '"') { string(); return; }
    const open = text[at];
    if (open === "{" || open === "[") {
      at++; space();
      const close = open === "{" ? "}" : "]", keys = new Set();
      if (text[at] === close) { at++; return; }
      for (;;) {
        space();
        if (open === "{") {
          if (text[at] !== '"') bad();
          const key = string();
          if (keys.has(key)) bad();
          keys.add(key); space();
          if (text[at++] !== ":") bad();
        }
        value(depth + 1); space();
        if (text[at] === close) { at++; return; }
        if (text[at++] !== ",") bad();
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match) bad();
    at += match![0].length;
  };
  value(0); space();
  if (at !== text.length) bad();
  return JSON.parse(text);
}
