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
    output,
    outputRaw: output !== null ? JSON.stringify(output, null, 2) : "",
    startMs: parseTimestamp(start),
    endMs: parseTimestamp(end),
  };
}

/** ForEach loops are containers around real work, not records themselves */
function isRecordActivity(a: ActivityRun): boolean {
  return a.activityType !== "ForEach";
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
  // Order groups by when they actually started — a ForEach loop starts before
  // the activities inside it, even though the CSV lists it after (it ends last).
  groups.sort(
    (a, b) =>
      Math.min(...a.activities.map((x) => x.startMs)) -
      Math.min(...b.activities.map((x) => x.startMs)),
  );
  return groups;
}

/** Parse CSV text into a DashboardData object */
export function parseDashboardData(
  text: string,
  source: string,
  availableDays: string[] = [],
  currentDay: string | null = null,
): DashboardData {
  const rows = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.length >= 8);
  const activities = rows.slice(1).map(buildActivity);

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

    const records = children.filter(isRecordActivity);
    const errorCount = records.filter((c) => c.status !== "Succeeded").length;
    return {
      id: `run${i}`,
      name: m.activityName,
      childPipeline,
      status: m.status,
      startMs: m.startMs,
      endMs: m.endMs,
      records: records.length,
      successCount: records.length - errorCount,
      errorCount,
      groups: groupByActivityName(children),
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
    const records = list.filter(isRecordActivity);
    const errorCount = records.filter((c) => c.status !== "Succeeded").length;
    runs.push({
      id: `orphan-${pipe}`,
      name: `${pipe} (standalone)`,
      childPipeline: pipe,
      status: errorCount > 0 ? "Failed" : "Succeeded",
      startMs: Math.min(...list.map((a) => a.startMs)),
      endMs: Math.max(...list.map((a) => a.endMs)),
      records: records.length,
      successCount: records.length - errorCount,
      errorCount,
      groups: groupByActivityName(list),
    });
  }

  runs.sort((a, b) => a.startMs - b.startMs);

  const allRecords = activities.filter(
    (a) => a.pipelineName !== "MASTER" && isRecordActivity(a),
  );
  return {
    generatedFrom: source,
    totalActivities: allRecords.length,
    totalErrors: allRecords.filter((a) => a.status !== "Succeeded").length,
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
