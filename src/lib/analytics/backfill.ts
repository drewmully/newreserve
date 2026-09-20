export type BackfillPage<T> = { rows: T[]; nextCursor: string | null; complete: boolean };
export type BackfillStore<T> = {
  /** Must atomically persist page rows AND its checkpoint with compare-and-swap. */
  commitPage(expectedCursor: string | null, page: BackfillPage<T>): Promise<boolean>;
};
/** One bounded invocation; the scheduler resumes from the stored cursor, not page zero. */
export async function runBackfillBatch<T>(input: {
  cursor: string | null; maxPages: number; maxRowsPerPage: number; approvalRef: string;
  fetchPage: (cursor: string | null) => Promise<BackfillPage<T>>; store: BackfillStore<T>;
}) {
  if (!input.approvalRef || !Number.isSafeInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 20 ||
      !Number.isSafeInteger(input.maxRowsPerPage) || input.maxRowsPerPage < 1 || input.maxRowsPerPage > 1000) throw new Error("unapproved_backfill_bounds");
  let cursor = input.cursor;
  const seen = new Set<string>(cursor ? [cursor] : []);
  let written = 0;
  for (let i = 0; i < input.maxPages; i++) {
    const page = await input.fetchPage(cursor);
    if (page.rows.length > input.maxRowsPerPage || page.complete !== (page.nextCursor === null) ||
        page.nextCursor !== null && seen.has(page.nextCursor)) throw new Error("invalid_backfill_page");
    if (!await input.store.commitPage(cursor, page)) throw new Error("checkpoint_conflict");
    written += page.rows.length; cursor = page.nextCursor;
    if (page.complete) return { cursor, written, complete: true };
    seen.add(cursor!);
  }
  return { cursor, written, complete: false };
}
