/**
 * In-memory stand-in for the Supabase service client, for the event-backbone
 * tests.
 *
 * It exists to enforce the two constraints the build actually depends on, so a
 * test can prove them rather than assert them:
 *
 *   * inbound_event (source, source_event_id) is UNIQUE — the idempotency
 *     mechanism. A second identical delivery gets a 23505, not a second row.
 *   * customers.email is UNIQUE — the constraint whose violation arms
 *     mully-hub's destructive email-collision recovery.
 *
 * Only the query shapes the backbone actually issues are implemented. Anything
 * else throws loudly rather than quietly returning empty, so a future call
 * shape cannot pass a test by accident.
 */

type Row = Record<string, unknown>;

interface Filter {
  op: "eq" | "in" | "is" | "not-is" | "gte" | "lte" | "lt" | "gt";
  col: string;
  val: unknown;
}

const UNIQUE_VIOLATION = { code: "23505", message: "duplicate key value violates unique constraint" };

export interface FakeState {
  tables: Record<string, Row[]>;
  sequences: Record<string, number>;
  rpcCalls: { name: string; args: unknown }[];
}

function matches(row: Row, filter: Filter): boolean {
  const value = row[filter.col];
  switch (filter.op) {
    case "eq":
      return String(value) === String(filter.val);
    case "in":
      return (filter.val as unknown[]).some((v) => String(v) === String(value));
    case "is":
      return filter.val === null ? value === null || value === undefined : value === filter.val;
    case "not-is":
      return filter.val === null ? value !== null && value !== undefined : value !== filter.val;
    case "gte":
      return String(value) >= String(filter.val);
    case "lte":
      return String(value) <= String(filter.val);
    case "lt":
      return String(value) < String(filter.val);
    case "gt":
      return String(value) > String(filter.val);
  }
}

function uniqueConflict(state: FakeState, table: string, candidate: Row, ignoreId?: unknown): boolean {
  const rows = state.tables[table] ?? [];
  if (table === "inbound_event") {
    return rows.some(
      (row) =>
        row.source === candidate.source && row.source_event_id === candidate.source_event_id,
    );
  }
  if (table === "customers") {
    return rows.some((row) => {
      if (String(row.id) !== String(ignoreId) && String(row.id) === String(candidate.id)) return true;
      const a = candidate.email;
      const b = row.email;
      return typeof a === "string" && typeof b === "string" && a === b;
    });
  }
  return false;
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private limitN: number | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private returning = false;

  constructor(
    private state: FakeState,
    private table: string,
    private mode: "select" | "insert" | "update" | "upsert",
    private payload?: Row | Row[],
    private upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {}

  select(_cols?: string) {
    this.returning = true;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ op: "eq", col, val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.filters.push({ op: "in", col, val });
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push({ op: "is", col, val });
    return this;
  }
  not(col: string, op: string, val: unknown) {
    if (op !== "is") throw new Error(`fakeSupabase: unsupported not(${op})`);
    this.filters.push({ op: "not-is", col, val });
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push({ op: "gte", col, val });
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push({ op: "lte", col, val });
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push({ op: "lt", col, val });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  async single() {
    const { data, error } = await this.run();
    if (error) return { data: null, error };
    const rows = data as Row[];
    if (rows.length !== 1) {
      return { data: null, error: { code: "PGRST116", message: "expected exactly one row" } };
    }
    return { data: rows[0], error: null };
  }

  async maybeSingle() {
    const { data, error } = await this.run();
    if (error) return { data: null, error };
    const rows = data as Row[];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private rows(): Row[] {
    return this.state.tables[this.table] ?? (this.state.tables[this.table] = []);
  }

  private nextId(): number {
    const next = (this.state.sequences[this.table] ?? 0) + 1;
    this.state.sequences[this.table] = next;
    return next;
  }

  private async run(): Promise<{ data: unknown; error: unknown }> {
    const rows = this.rows();

    if (this.mode === "select") {
      let out = rows.filter((row) => this.filters.every((f) => matches(row, f)));
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        out = [...out].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (this.limitN !== null) out = out.slice(0, this.limitN);
      return { data: out, error: null };
    }

    if (this.mode === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const inserted: Row[] = [];
      for (const candidate of incoming) {
        if (uniqueConflict(this.state, this.table, candidate)) {
          return { data: null, error: { ...UNIQUE_VIOLATION } };
        }
        const row: Row = {
          id: candidate.id ?? this.nextId(),
          received_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          attempts: 0,
          ...candidate,
        };
        rows.push(row);
        inserted.push(row);
      }
      return { data: this.returning ? inserted : null, error: null };
    }

    if (this.mode === "upsert") {
      const candidate = this.payload as Row;
      const existing = rows.find((row) => String(row.id) === String(candidate.id));
      if (existing) {
        if (this.upsertOpts?.ignoreDuplicates) return { data: null, error: null };
        Object.assign(existing, candidate);
        return { data: this.returning ? [existing] : null, error: null };
      }
      if (uniqueConflict(this.state, this.table, candidate)) {
        return { data: null, error: { ...UNIQUE_VIOLATION } };
      }
      rows.push({ ...candidate });
      return { data: this.returning ? [candidate] : null, error: null };
    }

    // update
    const target = rows.filter((row) => this.filters.every((f) => matches(row, f)));
    for (const row of target) Object.assign(row, this.payload as Row);
    return { data: this.returning ? target : null, error: null };
  }
}

export function createFakeSupabase(seed?: Partial<FakeState>) {
  const state: FakeState = {
    tables: { inbound_event: [], customers: [], backbone_alert: [], job_runs: [], ...(seed?.tables ?? {}) },
    sequences: { ...(seed?.sequences ?? {}) },
    rpcCalls: [],
  };

  const client = {
    from(table: string) {
      return {
        select: (cols?: string) => new Query(state, table, "select").select(cols),
        insert: (payload: Row | Row[]) => new Query(state, table, "insert", payload),
        update: (payload: Row) => new Query(state, table, "update", payload),
        upsert: (payload: Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) =>
          new Query(state, table, "upsert", payload, opts),
      };
    },

    async rpc(name: string, args?: unknown) {
      state.rpcCalls.push({ name, args });

      if (name === "event_backbone_find_customer_by_email") {
        const email = String((args as { p_email: string }).p_email ?? "");
        const hits = (state.tables.customers ?? [])
          .filter((row) => String(row.email ?? "").toLowerCase() === email.toLowerCase())
          .sort((a, b) => (BigInt(String(a.id)) < BigInt(String(b.id)) ? -1 : 1));
        return { data: hits.slice(0, 1).map((row) => ({ id: row.id, email: row.email })), error: null };
      }

      if (name === "event_backbone_next_synthetic_id") {
        const base = BigInt("9000000000000000");
        let max = base;
        for (const row of state.tables.customers ?? []) {
          const id = BigInt(String(row.id));
          if (id >= base && id > max) max = id;
        }
        return { data: String(max + BigInt(1)), error: null };
      }

      throw new Error(`fakeSupabase: unstubbed rpc ${name}`);
    },
  };

  return { client, state };
}
