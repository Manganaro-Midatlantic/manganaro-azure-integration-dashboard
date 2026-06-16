import fs from "node:fs";
import path from "node:path";
import type {
  ActivityGroup,
  ActivityRun,
  DashboardData,
  IntegrationRun,
} from "./types";

const CSV_FILE = "query_data.csv";

/** RFC 4180 parser — fields may contain quoted commas, escaped quotes, and newlines */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

/** Parses both ISO 8601 ("2026-06-12T00:02:17.0000000") and US locale ("6/12/2026, 12:02:17.000 AM") */
function parseTimestamp(text: string): number {
  // ISO 8601 from Logic App / KQL datetime_utc_to_local
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (iso) {
    const [, y, mo, d, h, min, s, frac] = iso;
    const ms = frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0;
    // Timestamps are already NY-local wall-clock (KQL datetime_utc_to_local) with no
    // offset. Build the epoch in UTC so the value is independent of the host's zone;
    // formatters render it back with timeZone "UTC" to reproduce the original clock.
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min), Number(s), ms);
  }
  // US locale from manual KQL export: "6/12/2026, 12:02:17.000 AM"
  const m = text.match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)(?:\.(\d+))?\s*(AM|PM)/i);
  if (!m) return NaN;
  const [, mo, d, y, h, min, s, ms, ampm] = m;
  let hour = Number(h) % 12;
  if (ampm.toUpperCase() === "PM") hour += 12;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, Number(min), Number(s), Number(ms ?? 0));
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const SECRET_KEY_PATTERN = /api[-_]?key|authorization|password|secret|token/i;

/** Drop credential fields anywhere in a payload so they never reach the browser */
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  return value;
}

/** ADF bookkeeping in activity outputs that is never useful when debugging a record */
const OUTPUT_NOISE_KEYS = new Set([
  "ADFWebActivityResponseHeaders",
  "ADFHttpStatusCodeInResponse",
  "effectiveIntegrationRuntime",
  "executionDuration",
  "durationInQueue",
  "billingReference",
  "outputLogsLocation",
  "outputTruncated",
]);

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** Remove ADF noise keys and empty leftovers; returns null if nothing meaningful remains */
function cleanOutput(output: unknown): unknown {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return isEmptyValue(output) ? null : output;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(output as Record<string, unknown>)) {
    if (OUTPUT_NOISE_KEYS.has(k)) continue;
    if (isEmptyValue(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Flatten ADF's nested errors object ({"0":{"field":["msg"]}}) into readable lines */
function extractErrorMessages(errors: unknown, prefix = ""): string[] {
  if (errors === null || errors === undefined) return [];
  if (typeof errors === "string") return [prefix ? `${prefix}: ${errors}` : errors];
  if (Array.isArray(errors)) return errors.flatMap((e) => extractErrorMessages(e, prefix));
  if (typeof errors === "object") {
    return Object.entries(errors as Record<string, unknown>).flatMap(([k, v]) => {
      // numeric keys are record indexes, not field names — skip them in the label
      const label = /^\d+$/.test(k) ? prefix : k;
      return extractErrorMessages(v, label);
    });
  }
  return [String(errors)];
}

const METRIC_KEYS = [
  "processed",
  "creates",
  "updates",
  "recordsAffected",
  "resultSetCount",
  "count",
] as const;

function extractMetrics(input: unknown, output: unknown): [string, string][] {
  const metrics: [string, string][] = [];
  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    const o = output as Record<string, unknown>;
    for (const k of METRIC_KEYS) {
      if (typeof o[k] === "number" || typeof o[k] === "string") {
        metrics.push([k, String(o[k])]);
      }
    }
  }
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const i = input as Record<string, unknown>;
    if (i.ItemsCount !== undefined) metrics.push(["items", String(i.ItemsCount)]);
  }
  return metrics;
}

/**
 * Pull SQL out of the places ADF hides it: Script activities use
 * {"scripts":[{"type":"Query","text":"..."}]}, Lookups use source.sqlReaderQuery.
 */
function extractSql(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const i = input as Record<string, unknown>;

  if (typeof i.text === "string") return i.text;

  if (Array.isArray(i.scripts)) {
    const parts = i.scripts
      .map((s) =>
        s !== null && typeof s === "object" && typeof (s as Record<string, unknown>).text === "string"
          ? ((s as Record<string, unknown>).text as string)
          : null,
      )
      .filter((s): s is string => s !== null);
    if (parts.length > 0) return parts.join("\n\n");
  }

  const source = i.source;
  if (source !== null && typeof source === "object" && !Array.isArray(source)) {
    const s = source as Record<string, unknown>;
    for (const key of ["sqlReaderQuery", "oracleReaderQuery", "query"]) {
      if (typeof s[key] === "string") return s[key] as string;
    }
  }
  if (typeof i.query === "string") return i.query;
  return null;
}

/**
 * Curated record-identifying fields to surface (in place of the raw API response)
 * for each WebActivity step, keyed by activity name. Each rule pulls one value out
 * of the request body. Field names differ per step (e.g. material is "name" on
 * create but "material_name" on assignment), so the mapping is explicit.
 */
type MetaRule = { label: string; from: (b: Record<string, unknown>) => string | undefined };

function asText(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ") || undefined;
  return String(v);
}

const RECORD_META_RULES: Record<string, MetaRule[]> = {
  "POST equipment": [{ label: "Equipment ID", from: (b) => asText(b.equipment_id) }],
  "POST project_equipment": [
    { label: "Equipment ID: ", from: (b) => asText(b.equipment_id) },
    { label: "Job(s): ", from: (b) => asText(b.job_numbers) },
  ],
  "POST equipment_pricing": [
    { label: "Equipment ID: ", from: (b) => asText(b.equipment_id) },
    { label: "Job(s): ", from: (b) => asText(b.job_numbers) },
  ],
  "POST material": [{ label: "Material", from: (b) => asText(b.name) }],
  "POST project_material": [
    { label: "Material: ", from: (b) => asText(b.material_name) },
    { label: "Job(s): ", from: (b) => asText(b.job_numbers) },
  ],
  "POST material_pricing": [
    { label: "Material", from: (b) => asText(b.material_name) },
    { label: "Job(s)", from: (b) => asText(b.job_numbers) },
  ],
  "POST EWO employee": [{ label: "Company Supplied ID", from: (b) => asText(b.company_supplied_id) }],
  "POST employee_project": [
    { label: "Company Supplied ID: ", from: (b) => asText(b.company_supplied_id) },
    { label: "Job(s): ", from: (b) => asText(b.job_numbers) },
  ],
  "POST employee_pricing": [
    { label: "Company Supplied ID: ", from: (b) => asText(b.company_supplied_id) },
    { label: "Job(s): ", from: (b) => asText(b.job_numbers) },
  ],
  "POST project": [
    { label: "Job Number: ", from: (b) => asText(b.job_number) },
    { label: "Name: ", from: (b) => asText(b.name) },
  ],
  "POST cost_code": [
    { label: "Code: ", from: (b) => asText(b.code) },
    { label: "Description: ", from: (b) => asText(b.description) },
  ],
  "POST budget": [
    { label: "Job Number: ", from: (b) => asText(b.job_number) },
    { label: "Cost Code: ", from: (b) => asText(b.cost_code) },
  ],
  "POST employee": [
    {
      label: "Name: ",
      from: (b) =>
        asText([asText(b.first_name), asText(b.last_name)].filter(Boolean).join(" ")),
    },
  ],
  "POST employee_group": [
    { label: "Company Supplied ID: ", from: (b) => asText(b.company_supplied_id) },
    { label: "Group IDs: ", from: (b) => asText(b.company_group_ids) },
  ],
};

function extractRecordMeta(activityName: string, body: unknown): [string, string][] {
  const rules = RECORD_META_RULES[activityName];
  if (!rules || body === null || typeof body !== "object" || Array.isArray(body)) return [];
  const b = body as Record<string, unknown>;
  const out: [string, string][] = [];
  for (const rule of rules) {
    const v = rule.from(b);
    if (v !== undefined) out.push([rule.label, v]);
  }
  return out;
}

/**
 * Body field that identifies the record for grouping. Only the multi-step
 * integrations are listed — their create/assign/price calls share this value, so
 * they collapse under one record. Single-step integrations are intentionally
 * absent (nothing to consolidate).
 */
const RECORD_KEY_FIELD: Record<string, string> = {
  "POST equipment": "equipment_id",
  "POST project_equipment": "equipment_id",
  "POST equipment_pricing": "equipment_id",
  "POST material": "name",
  "POST project_material": "material_name",
  "POST material_pricing": "material_name",
  "POST EWO employee": "company_supplied_id",
  "POST employee_project": "company_supplied_id",
  "POST employee_pricing": "company_supplied_id",
  "POST employee": "company_supplied_id",
  "POST employee_group": "company_supplied_id",
};

function recordKeyFor(activityName: string, body: unknown): string | undefined {
  const field = RECORD_KEY_FIELD[activityName];
  if (!field || body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  return asText((body as Record<string, unknown>)[field]);
}

function buildActivity(r: string[], index: number): ActivityRun {
  const [pipelineName, activityName, activityType, inputText, outputText, status, start, end] = r;

  const input = stripSecrets(tryParseJson(inputText));
  const rawOutput = stripSecrets(tryParseJson(outputText));
  const outputObj =
    rawOutput !== null && typeof rawOutput === "object" && !Array.isArray(rawOutput)
      ? (rawOutput as Record<string, unknown>)
      : null;

  // For web calls the interesting request data is the body; method/url shown separately.
  let method: string | undefined;
  let url: string | undefined;
  let body: unknown = input;
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const i = input as Record<string, unknown>;
    if (typeof i.method === "string") method = i.method;
    if (typeof i.url === "string") url = i.url;
    if (i.body !== undefined) body = i.body;
  }

  const sql = extractSql(input);
  const bodyRaw =
    sql ?? (body === null ? inputText : JSON.stringify(body, null, 2));
  // When the payload IS the SQL script, don't repeat it in the request fields
  if (sql !== null && body !== null && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.scripts) || typeof b.text === "string") body = null;
  }

  const output = cleanOutput(rawOutput);
  const httpStatus =
    outputObj && typeof outputObj.ADFHttpStatusCodeInResponse === "string"
      ? outputObj.ADFHttpStatusCodeInResponse
      : undefined;

  return {
    id: `a${index}`,
    pipelineName,
    activityName,
    activityType,
    status,
    method,
    url,
    body,
    bodyRaw,
    sql,
    httpStatus,
    metrics: extractMetrics(input, rawOutput),
    errorMessages: outputObj ? extractErrorMessages(outputObj.errors) : [],
    recordMeta: extractRecordMeta(activityName, body),
    recordKey: recordKeyFor(activityName, body),
    output,
    outputRaw: output !== null ? JSON.stringify(output, null, 2) : "",
    startMs: parseTimestamp(start),
    endMs: parseTimestamp(end),
  };
}

function groupByActivityName(children: ActivityRun[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  const byName = new Map<string, ActivityGroup>();
  for (const c of children) {
    let g = byName.get(c.activityName);
    if (!g) {
      g = { name: c.activityName, activityType: c.activityType, activities: [], errorCount: 0 };
      byName.set(c.activityName, g);
      groups.push(g);
    }
    g.activities.push(c);
    if (c.status !== "Succeeded") g.errorCount++;
  }
  // Within a group whose rows carry a record identity (cost codes, budgets,
  // projects…), order the rows ascending by that identity (natural order).
  for (const g of groups) {
    if (g.activities.some((a) => a.recordMeta.length > 0)) {
      g.activities.sort((a, b) =>
        recordSortKey(a).localeCompare(recordSortKey(b), undefined, { numeric: true }),
      );
    }
  }
  // Order groups by when they actually started — a ForEach loop starts before
  // the activities inside it, even though the CSV lists it after (it ends last).
  groups.sort(
    (a, b) =>
      Math.min(...a.activities.map((x) => x.startMs)) -
      Math.min(...b.activities.map((x) => x.startMs)),
  );
  return groups;
}

/** Sort key from a row's record identity, e.g. "23-2301823.|LAA.100000." */
function recordSortKey(a: ActivityRun): string {
  return a.recordMeta.map(([, v]) => v).join("|");
}

/**
 * Build the activity groups for a run. Multi-step integrations consolidate by
 * record identity — the create/assign/price calls that share a recordKey collapse
 * into one expandable record (dropping the now-redundant ForEach containers). Runs
 * with nothing to consolidate (single-step integrations, SQL scripts) fall back to
 * grouping by activity name.
 */
function buildGroups(children: ActivityRun[]): ActivityGroup[] {
  const byKey = new Map<string, ActivityRun[]>();
  for (const c of children) {
    if (c.recordKey === undefined) continue;
    const list = byKey.get(c.recordKey) ?? [];
    list.push(c);
    byKey.set(c.recordKey, list);
  }
  const consolidates = [...byKey.values()].some((acts) => acts.length > 1);
  if (!consolidates) return groupByActivityName(children);

  const keyed = new Set<string>();
  const recordGroups: ActivityGroup[] = [];
  for (const [key, acts] of byKey) {
    acts.forEach((a) => keyed.add(a.id));
    acts.sort((a, b) => a.startMs - b.startMs);
    recordGroups.push({
      name: key,
      activityType: "",
      activities: acts,
      errorCount: acts.filter((a) => a.status !== "Succeeded").length,
      isRecordGroup: true,
    });
  }
  // Ascending by record identity (natural order so 23-… sorts before 25-…)
  recordGroups.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  // Keep any non-ForEach leftovers (rare) as activity-name groups; drop the now-
  // redundant ForEach loop containers.
  const rest = children.filter((c) => !keyed.has(c.id) && c.activityType !== "ForEach");
  return [...recordGroups, ...groupByActivityName(rest)];
}

/**
 * Record count for an integration. When consolidated by record, it's simply the
 * number of records (with errors = records that had any failed step). Otherwise each
 * business record fans out into one activity per step, so the count is the widest
 * non-ForEach step group, not the sum across steps.
 */
function countRecords(groups: ActivityGroup[]): {
  records: number;
  successCount: number;
  errorCount: number;
} {
  const recordGroups = groups.filter((g) => g.isRecordGroup);
  if (recordGroups.length > 0) {
    const records = recordGroups.length;
    const errorCount = recordGroups.filter((g) => g.errorCount > 0).length;
    return { records, successCount: records - errorCount, errorCount };
  }
  let widest: ActivityGroup | null = null;
  for (const g of groups) {
    if (g.activityType === "ForEach") continue; // containers, not records
    if (!widest || g.activities.length > widest.activities.length) widest = g;
  }
  if (!widest) return { records: 0, successCount: 0, errorCount: 0 };
  const records = widest.activities.length;
  return { records, successCount: records - widest.errorCount, errorCount: widest.errorCount };
}

/** Activity names to hide from the dashboard entirely (e.g. lookups being retired). */
const HIDDEN_ACTIVITY_NAMES = new Set(["Check for new Budgets", "For Each new Budget", "Check for new Projects", "For Each New Project", "Check for new Cost Code Status", "For Each new Cost Code Status", "Check for new Cost Codes", "For Each new Cost Code"]);

/** Parse CSV text into a DashboardData object */
export function parseDashboardData(
  text: string,
  source: string,
  availableDays: string[] = [],
  currentDay: string | null = null,
): DashboardData {
  const rows = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.length >= 8);
  const activities = rows
    .slice(1)
    .map(buildActivity)
    .filter((a) => !HIDDEN_ACTIVITY_NAMES.has(a.activityName));

  // MASTER ExecutePipeline activities are the top-level integrations; everything the
  // referenced child pipeline logged inside the parent's time window belongs to it.
  const masters = activities.filter(
    (a) => a.pipelineName === "MASTER" && a.activityType === "ExecutePipeline",
  );
  const claimed = new Set<string>();

  const runs: IntegrationRun[] = masters.map((m, i) => {
    const inputObj = m.body as { pipeline?: { referenceName?: string } } | null;
    const childPipeline = inputObj?.pipeline?.referenceName ?? "";
    const SLACK_MS = 5000;
    const children = activities.filter(
      (a) =>
        a.pipelineName === childPipeline &&
        a.startMs >= m.startMs - SLACK_MS &&
        a.startMs <= m.endMs + SLACK_MS &&
        !claimed.has(a.id),
    );
    for (const c of children) claimed.add(c.id);

    const groups = buildGroups(children);
    const { records, successCount, errorCount } = countRecords(groups);
    return {
      id: `run${i}`,
      name: m.activityName,
      childPipeline,
      status: m.status,
      startMs: m.startMs,
      endMs: m.endMs,
      records,
      successCount,
      errorCount,
      groups,
    };
  });

  // Activities not claimed by any MASTER window surfaced as standalone runs.
  const orphans = activities.filter(
    (a) => a.pipelineName !== "MASTER" && !claimed.has(a.id),
  );
  const orphansByPipe = new Map<string, ActivityRun[]>();
  for (const o of orphans) {
    const list = orphansByPipe.get(o.pipelineName) ?? [];
    list.push(o);
    orphansByPipe.set(o.pipelineName, list);
  }
  for (const [pipe, list] of orphansByPipe) {
    const groups = buildGroups(list);
    const { records, successCount, errorCount } = countRecords(groups);
    runs.push({
      id: `orphan-${pipe}`,
      name: `${pipe} (standalone)`,
      childPipeline: pipe,
      // any failed step flags the run, even if it isn't the widest group
      status: groups.some((g) => g.errorCount > 0) ? "Failed" : "Succeeded",
      startMs: Math.min(...list.map((a) => a.startMs)),
      endMs: Math.max(...list.map((a) => a.endMs)),
      records,
      successCount,
      errorCount,
      groups,
    });
  }

  runs.sort((a, b) => a.startMs - b.startMs);

  // Header totals reflect deduplicated records (sum of per-integration counts),
  // not raw activity rows.
  return {
    generatedFrom: source,
    totalActivities: runs.reduce((sum, r) => sum + r.records, 0),
    totalErrors: runs.reduce((sum, r) => sum + r.errorCount, 0),
    runs,
    availableDays,
    currentDay,
  };
}

let cached: { mtimeMs: number; data: DashboardData } | null = null;

export function loadDashboardData(): DashboardData {
  const file = path.join(process.cwd(), CSV_FILE);
  const { mtimeMs } = fs.statSync(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.data;
  const text = fs.readFileSync(file, "utf8");
  const data = parseDashboardData(text, CSV_FILE, [], null);
  cached = { mtimeMs, data };
  return data;
}
