/**
 * A stand-in for the Supabase client, for the demo build only.
 *
 * The app talks to Supabase from almost every component, with no data layer in
 * between (see CLAUDE.md), so the only place a demo can intervene is the client
 * itself. This implements the slice of PostgREST the app actually uses —
 * measured, not guessed: every `.from()` chain, both embedded selects, storage
 * uploads and the three auth calls.
 *
 * Three decisions worth knowing about:
 *
 * - **Rows come back whole, not projected to the selected columns.** A superset
 *   never breaks a screen; a mis-parsed projection silently empties one. The
 *   exception is `head: true`, which must return no rows because the caller
 *   wants the count.
 * - **Writes are real, and they are in memory.** Marking attendance, approving a
 *   fee or entering marks all behave exactly as they do against Postgres, and
 *   all of it is gone on refresh. That is the point: every visitor gets the same
 *   college back, and the Reset button does it without one.
 * - **`fetch` is patched for `/api/admin/*` and `/api/teacher/*`.** Those routes
 *   are Express, not Supabase, and without them Manage Admins and Teachers would
 *   be the only screens in the demo that error.
 *
 * Nothing here is imported by the production build — see supabaseClient.js.
 */

import { buildDemoDatabase, DEMO_PASSWORD } from "./demoData";
import { PRIMARY_KEY, RELATIONS, TIMESTAMP_DEFAULTS } from "./demoSchema";

/**
 * Built by `createDemoClient()`, not here. Nothing in this module may run at
 * import time: the production build drops the whole file only because it has no
 * side effects to preserve, and a `buildDemoDatabase()` call at module scope
 * would quietly ship the demo college to the real site.
 */
let db = null;
const listeners = new Set();

/** Throws the seeded college away and builds it again. */
export function resetDemoDatabase() {
  db = buildDemoDatabase();
  listeners.forEach((l) => l());
}

export function onDemoReset(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------- utilities */

const nowIso = () => new Date().toISOString();

let idCounter = 500000;
const newId = () => `feedfeed-0000-4000-8000-${String((idCounter += 1)).padStart(12, "0")}`;

const isDateOnly = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Postgres compares a date column to a date; our rows sometimes hold a full
 *  timestamp, so the row side is trimmed to match the filter's precision. */
function align(rowValue, filterValue) {
  if (isDateOnly(filterValue) && typeof rowValue === "string" && rowValue.length > 10) {
    return rowValue.slice(0, 10);
  }
  return rowValue;
}

const nullish = (v) => v === null || v === undefined;

function looseEq(a, b) {
  if (nullish(a) && nullish(b)) return true;
  if (nullish(a) || nullish(b)) return false;
  return String(a) === String(b);
}

function compare(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== "" && b !== "") return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

const likeToRegExp = (pattern, flags) =>
  new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, flags);

function testOne(rowValue, op, value) {
  const a = align(rowValue, value);
  switch (op) {
    case "eq": return looseEq(a, value);
    case "neq": return !looseEq(a, value);
    case "gt": return !nullish(a) && compare(a, value) > 0;
    case "gte": return !nullish(a) && compare(a, value) >= 0;
    case "lt": return !nullish(a) && compare(a, value) < 0;
    case "lte": return !nullish(a) && compare(a, value) <= 0;
    case "is":
      if (value === null) return nullish(a);
      return a === value;
    case "in": return (value || []).some((v) => looseEq(a, v));
    case "like": return !nullish(a) && likeToRegExp(value).test(String(a));
    case "ilike": return !nullish(a) && likeToRegExp(value, "i").test(String(a));
    // Array columns: `contains` needs all of them, `overlaps` needs any.
    case "cs": return Array.isArray(a) && (value || []).every((v) => a.includes(v));
    case "ov": return Array.isArray(a) && (value || []).some((v) => a.includes(v));
    default: return true;
  }
}

/**
 * `.or("cnic.eq.X,cnic.eq.Y")` — PostgREST's own syntax, and only the `eq`
 * form the app builds. Anything more exotic passes rather than silently
 * excluding rows.
 */
function testOrString(row, expression) {
  return String(expression)
    .split(",")
    .some((clause) => {
      const [column, op, ...rest] = clause.split(".");
      if (!column || !op) return true;
      return testOne(row[column], op, rest.join("."));
    });
}

function matches(row, filter) {
  if (filter.or) return testOrString(row, filter.or);
  const result = testOne(row[filter.column], filter.op, filter.value);
  return filter.negate ? !result : result;
}

/* ------------------------------------------------------- select parsing */

/**
 * Splits a PostgREST select string into plain columns and embedded relations,
 * recursively — `"*, fees(id, label, students(id, name))"` is two levels deep in
 * FeeVerification, so one level would not do.
 */
function parseSelect(select) {
  const columns = [];
  const embeds = [];
  const text = String(select || "*");

  let token = "";
  let i = 0;

  const flush = () => {
    const t = token.trim();
    if (t) columns.push(t);
    token = "";
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === "(") {
      // The token so far names the relation; take the balanced group after it.
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "(") depth += 1;
        if (text[j] === ")") depth -= 1;
        j += 1;
      }
      const inner = text.slice(i + 1, j - 1);
      const rawName = token.trim();
      token = "";
      const inner_ = rawName.endsWith("!inner");
      embeds.push({
        name: inner_ ? rawName.slice(0, -"!inner".length) : rawName.replace(/!left$/, ""),
        inner: inner_,
        select: parseSelect(inner),
      });
      i = j;
      // Skip the separator that follows the group.
      while (i < text.length && (text[i] === "," || text[i] === " ")) i += 1;
      continue;
    }
    if (ch === ",") { flush(); i += 1; continue; }
    token += ch;
    i += 1;
  }
  flush();

  return { columns, embeds };
}

/* ---------------------------------------------------------- the executor */

/** Filters whose column is `<embed>.<column>` belong to that embed, not here. */
function splitFilters(filters, embeds) {
  const names = new Set(embeds.map((e) => e.name));
  const own = [];
  const nested = {};

  filters.forEach((f) => {
    if (f.or || !f.column?.includes(".")) { own.push(f); return; }
    const [head, ...rest] = f.column.split(".");
    if (!names.has(head)) { own.push(f); return; }
    (nested[head] ||= []).push({ ...f, column: rest.join(".") });
  });

  return { own, nested };
}

/**
 * Attaches every embedded relation to `row`, applying that embed's own filters.
 * Returns null when an `!inner` embed matched nothing — PostgREST drops the
 * parent row in that case, and FeeVerification relies on it to hide fees whose
 * student is in the deleted bin.
 */
function attachEmbeds(row, table, parsed, nestedFilters) {
  const out = { ...row };

  for (const embed of parsed.embeds) {
    const relation = RELATIONS[table]?.[embed.name];
    if (!relation) continue;

    const filters = nestedFilters[embed.name] || [];
    const split = splitFilters(filters, embed.select.embeds);
    const source = db[relation.table] || [];

    let related =
      relation.kind === "one"
        ? source.filter((r) => looseEq(r[relation.foreignKey], row[relation.localKey]))
        : source.filter((r) => looseEq(r[relation.foreignKey], row[relation.localKey]));

    related = related.filter((r) => split.own.every((f) => matches(r, f)));

    const resolved = [];
    for (const r of related) {
      const withChildren = attachEmbeds(r, relation.table, embed.select, split.nested);
      if (withChildren) resolved.push(withChildren);
    }

    if (relation.kind === "one") {
      const first = resolved[0] || null;
      if (embed.inner && !first) return null;
      out[embed.name] = first;
    } else {
      if (embed.inner && resolved.length === 0) return null;
      out[embed.name] = resolved;
    }
  }

  return out;
}

function sortRows(rows, orders) {
  if (orders.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const av = a[o.column];
      const bv = b[o.column];
      if (nullish(av) && nullish(bv)) continue;
      if (nullish(av)) return o.nullsFirst ? -1 : 1;
      if (nullish(bv)) return o.nullsFirst ? 1 : -1;
      const c = compare(av, bv);
      if (c !== 0) return o.ascending ? c : -c;
    }
    return 0;
  });
}

/* ------------------------------------------------------- query builder */

const ok = (data, extra = {}) => ({ data, error: null, status: 200, statusText: "OK", ...extra });

function noRows() {
  return {
    data: null,
    error: {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
      details: "The result contains 0 rows",
      hint: null,
    },
    status: 406,
    statusText: "Not Acceptable",
  };
}

function createQuery(table) {
  const q = {
    _table: table,
    _mode: "select",
    _select: "*",
    _filters: [],
    _orders: [],
    _limit: null,
    _range: null,
    _single: null,
    _payload: null,
    _onConflict: null,
    _returning: false,
    _count: null,
    _head: false,
  };

  const filter = (column, op, value) => { q._filters.push({ column, op, value }); return api; };

  const api = {
    select(select = "*", options = {}) {
      if (q._mode === "select") {
        q._select = select;
        q._count = options.count || null;
        q._head = !!options.head;
      } else {
        // Chained after a write: this is the RETURNING clause.
        q._returning = true;
        q._select = select;
      }
      return api;
    },

    insert(payload) { q._mode = "insert"; q._payload = payload; return api; },
    update(payload) { q._mode = "update"; q._payload = payload; return api; },
    upsert(payload, options = {}) {
      q._mode = "upsert";
      q._payload = payload;
      q._onConflict = options.onConflict || PRIMARY_KEY;
      return api;
    },
    delete() { q._mode = "delete"; return api; },

    eq: (c, v) => filter(c, "eq", v),
    neq: (c, v) => filter(c, "neq", v),
    gt: (c, v) => filter(c, "gt", v),
    gte: (c, v) => filter(c, "gte", v),
    lt: (c, v) => filter(c, "lt", v),
    lte: (c, v) => filter(c, "lte", v),
    is: (c, v) => filter(c, "is", v),
    in: (c, v) => filter(c, "in", v),
    like: (c, v) => filter(c, "like", v),
    ilike: (c, v) => filter(c, "ilike", v),
    contains: (c, v) => filter(c, "cs", v),
    containedBy: (c, v) => filter(c, "cs", v),
    overlaps: (c, v) => filter(c, "ov", v),
    not(column, op, value) { q._filters.push({ column, op, value, negate: true }); return api; },
    or(expression) { q._filters.push({ or: expression }); return api; },
    filter: (c, op, v) => filter(c, op, v),

    order(column, options = {}) {
      q._orders.push({
        column,
        ascending: options.ascending !== false,
        nullsFirst: !!options.nullsFirst,
      });
      return api;
    },
    limit(n) { q._limit = n; return api; },
    range(from, to) { q._range = [from, to]; return api; },
    single() { q._single = "single"; return api; },
    maybeSingle() { q._single = "maybe"; return api; },
    // The app never reads these back, but supabase-js exposes them and a stray
    // call should not explode.
    throwOnError() { return api; },
    abortSignal() { return api; },

    then(resolve, reject) {
      return Promise.resolve()
        .then(() => run(q))
        .then(resolve, reject);
    },
    catch(fn) { return api.then((r) => r).catch(fn); },
    finally(fn) { return api.then((r) => { fn(); return r; }); },
  };

  return api;
}

function run(q) {
  const table = (db[q._table] ||= []);

  if (q._mode === "select") return runSelect(q, table);
  if (q._mode === "insert") return runInsert(q, table);
  if (q._mode === "update") return runUpdate(q, table);
  if (q._mode === "upsert") return runUpsert(q, table);
  if (q._mode === "delete") return runDelete(q, table);
  return ok([]);
}

function runSelect(q, table) {
  const parsed = parseSelect(q._select);
  const { own, nested } = splitFilters(q._filters, parsed.embeds);

  let rows = table.filter((r) => own.every((f) => matches(r, f)));

  if (parsed.embeds.length > 0) {
    rows = rows.map((r) => attachEmbeds(r, q._table, parsed, nested)).filter(Boolean);
  } else {
    rows = rows.map((r) => ({ ...r }));
  }

  rows = sortRows(rows, q._orders);

  const count = q._count ? rows.length : null;

  if (q._range) rows = rows.slice(q._range[0], q._range[1] + 1);
  if (q._limit != null) rows = rows.slice(0, q._limit);

  if (q._head) return ok(null, { count });

  if (q._single === "single") {
    if (rows.length !== 1) return { ...noRows(), count };
    return ok(rows[0], { count });
  }
  if (q._single === "maybe") return ok(rows[0] || null, { count });

  return ok(rows, { count });
}

function withDefaults(table, row) {
  const out = { ...row };
  if (!out[PRIMARY_KEY]) out[PRIMARY_KEY] = newId();
  (TIMESTAMP_DEFAULTS[table] || []).forEach((column) => {
    if (out[column] === undefined) out[column] = nowIso();
  });
  return out;
}

function runInsert(q, table) {
  const incoming = Array.isArray(q._payload) ? q._payload : [q._payload];
  const created = incoming.map((row) => withDefaults(q._table, row));
  table.push(...created);
  return ok(q._returning ? (q._single ? created[0] : created.map((r) => ({ ...r }))) : null);
}

function runUpdate(q, table) {
  const targets = table.filter((r) => q._filters.every((f) => matches(r, f)));
  targets.forEach((row) => Object.assign(row, q._payload));
  if (!q._returning) return ok(null);
  const copies = targets.map((r) => ({ ...r }));
  if (q._single === "single") return copies.length === 1 ? ok(copies[0]) : noRows();
  return ok(copies);
}

function runUpsert(q, table) {
  const incoming = Array.isArray(q._payload) ? q._payload : [q._payload];
  const keys = String(q._onConflict).split(",").map((k) => k.trim());
  const result = [];

  incoming.forEach((row) => {
    const existing = table.find((r) => keys.every((k) => looseEq(r[k], row[k])));
    if (existing) {
      Object.assign(existing, row);
      result.push({ ...existing });
    } else {
      const created = withDefaults(q._table, row);
      table.push(created);
      result.push({ ...created });
    }
  });

  return ok(q._returning ? (q._single ? result[0] : result) : null);
}

function runDelete(q, table) {
  const removed = [];
  for (let i = table.length - 1; i >= 0; i -= 1) {
    if (q._filters.every((f) => matches(table[i], f))) removed.push(...table.splice(i, 1));
  }
  return ok(q._returning ? removed : null);
}

/* --------------------------------------------------------------- storage */

const uploaded = new Map(); // `${bucket}/${path}` -> { url, updated_at }

function objectUrlFor(body) {
  try {
    if (typeof URL !== "undefined" && URL.createObjectURL && body instanceof Blob) {
      return URL.createObjectURL(body);
    }
  } catch {
    /* Node, or a browser refusing the blob — fall through to the placeholder. */
  }
  return "data:text/plain,Demo%20file";
}

function storageFrom(bucket) {
  return {
    async upload(path, body) {
      uploaded.set(`${bucket}/${path}`, { url: objectUrlFor(body), updated_at: nowIso() });
      return { data: { path, id: newId(), fullPath: `${bucket}/${path}` }, error: null };
    },
    async update(path, body) { return this.upload(path, body); },
    getPublicUrl(path) {
      const hit = uploaded.get(`${bucket}/${path}`);
      return { data: { publicUrl: hit?.url || `data:text/plain,Demo%20file%20${encodeURIComponent(path)}` } };
    },
    async createSignedUrl(path) {
      return { data: { signedUrl: this.getPublicUrl(path).data.publicUrl }, error: null };
    },
    async list(prefix = "", options = {}) {
      const wanted = `${bucket}/${prefix}${prefix.endsWith("/") || prefix === "" ? "" : "/"}`;
      const rows = [...uploaded.entries()]
        .filter(([key]) => key.startsWith(wanted))
        .map(([key, value]) => ({
          name: key.slice(wanted.length),
          id: key,
          updated_at: value.updated_at,
          created_at: value.updated_at,
          metadata: {},
        }))
        .filter((row) => !row.name.includes("/"))
        .filter((row) => (options.search ? row.name.includes(options.search) : true));
      return { data: options.limit ? rows.slice(0, options.limit) : rows, error: null };
    },
    async remove(paths) {
      (Array.isArray(paths) ? paths : [paths]).forEach((p) => uploaded.delete(`${bucket}/${p}`));
      return { data: [], error: null };
    },
    async download() { return { data: null, error: { message: "Downloads are not part of the demo." } }; },
  };
}

/* ------------------------------------------------------------------ auth */

let session = null;

function accounts() {
  return [
    ...db.admin_profiles.map((a) => ({ email: a.email, user_id: a.user_id })),
    ...db.teachers.filter((t) => t.email && t.user_id).map((t) => ({ email: t.email, user_id: t.user_id })),
  ];
}

const auth = {
  async signInWithPassword({ email, password }) {
    const account = accounts().find((a) => a.email?.toLowerCase() === String(email || "").toLowerCase());
    if (!account || password !== DEMO_PASSWORD) {
      return { data: { user: null, session: null }, error: { message: "Invalid login credentials", status: 400 } };
    }
    const user = { id: account.user_id, email: account.email };
    session = { access_token: `demo-token-${account.user_id}`, user };
    return { data: { user, session }, error: null };
  },
  async getSession() { return { data: { session }, error: null }; },
  async getUser() { return { data: { user: session?.user || null }, error: null }; },
  async signOut() { session = null; return { error: null }; },
  onAuthStateChange() {
    return { data: { subscription: { unsubscribe() {} } } };
  },
};

/* ------------------------------------------- the Express routes, in-browser */

/**
 * Manage Admins and Teachers post to `server.js`, which holds the service role
 * key. There is no server in the demo, so those six routes are answered here
 * instead — otherwise they would be the only screens that fail.
 */
function handleApi(path, body) {
  if (path.endsWith("/api/admin/create")) {
    const { email, name, whatsapp = null, permissions = [], allowedPrograms = [] } = body;
    if (db.admin_profiles.some((a) => a.email === email)) {
      return { ok: false, status: 400, json: { error: "An admin with this email already exists." } };
    }
    db.admin_profiles.push({
      id: newId(), user_id: newId(), email, name,
      whatsapp,
      is_super_admin: false, permissions, allowed_programs: allowedPrograms,
      created_at: nowIso(), created_by: session?.user?.id || null,
    });
    return { ok: true, status: 200, json: { success: true } };
  }

  if (path.endsWith("/api/admin/update")) {
    const { targetUserId, email, name, whatsapp, permissions, allowedPrograms } = body;
    const admin = db.admin_profiles.find((a) => a.user_id === targetUserId);
    if (!admin) {
      return { ok: false, status: 404, json: { error: "Admin not found." } };
    }
    if (email) admin.email = email;
    if (name !== undefined) admin.name = name || null;
    if (whatsapp !== undefined) admin.whatsapp = whatsapp || null;
    if (permissions !== undefined) admin.permissions = Array.isArray(permissions) ? permissions : [];
    if (allowedPrograms !== undefined) admin.allowed_programs = Array.isArray(allowedPrograms) ? allowedPrograms : [];
    return { ok: true, status: 200, json: { success: true } };
  }

  if (path.endsWith("/api/admin/delete")) {
    db.admin_profiles = db.admin_profiles.filter((a) => a.user_id !== body.targetUserId);
    return { ok: true, status: 200, json: { success: true } };
  }

  if (path.endsWith("/api/teacher/create")) {
    const { teacherId, email, name, qualification, phone, subjects = [], programs = [], rights = [] } = body;
    const existing = teacherId ? db.teachers.find((t) => t.id === teacherId) : null;
    if (existing) {
      Object.assign(existing, { user_id: newId(), email, is_active: true });
    } else {
      db.teachers.push({
        id: newId(), user_id: newId(), email, name, qualification, phone,
        subject: subjects[0] || null, subjects, programs, rights,
        is_active: true, created_at: nowIso(),
      });
    }
    return { ok: true, status: 200, json: { success: true } };
  }

  if (path.endsWith("/api/teacher/password")) return { ok: true, status: 200, json: { success: true } };

  if (path.endsWith("/api/teacher/delete")) {
    db.teachers = db.teachers.filter((t) => t.id !== body.teacherId);
    return { ok: true, status: 200, json: { success: true } };
  }

  if (path.endsWith("/api/send-credentials")) return { ok: true, status: 200, json: { success: true } };

  return null;
}

function installApiShim() {
  if (typeof window === "undefined" || window.__cmgcDemoFetch) return;
  const original = window.fetch?.bind(window);
  window.__cmgcDemoFetch = true;

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (/\/api\/(admin|teacher|send-credentials)/.test(url)) {
      let body;
      try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
      const answer = handleApi(url, body);
      if (answer) {
        return new Response(JSON.stringify(answer.json), {
          status: answer.status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return original ? original(input, init) : Promise.reject(new Error("fetch unavailable"));
  };
}

/* ----------------------------------------------------------------- client */

export function createDemoClient() {
  db = buildDemoDatabase();
  installApiShim();
  return {
    from: (table) => createQuery(table),
    storage: { from: storageFrom },
    auth,
    // Present so a stray call fails softly rather than throwing.
    rpc: async () => ok(null),
    // Handy from the console during a presentation.
    _demo: { reset: resetDemoDatabase, db: () => db },
  };
}
