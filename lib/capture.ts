import { queryActivityRuns } from "./adf";
import { uploadCsv } from "./blob";
import { toCsv } from "./data";

/** Matches an ADF pipeline run id. */
export const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CSV_HEADER = [
  "PipelineName",
  "ActivityName",
  "ActivityType",
  "Input",
  "Output",
  "Status",
  "Start_EST",
  "End_EST",
];

/** UTC ISO → "YYYY-MM-DDTHH:MM:SS" in America/New_York wall-clock, matching the
 *  daily CSV's datetime_utc_to_local output (DST-aware via Intl). */
function toNyWallClock(utc: string): string {
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return "";
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d)) {
    p[part.type] = part.value;
  }
  const hour = p.hour === "24" ? "00" : p.hour; // some runtimes emit 24 at midnight
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`;
}

/**
 * Pull a single run's activity logs live from ADF monitoring (no Log Analytics
 * lag), build the CSV, and write it to adf-logs/{pipeline}/{date}_{HHMM}.csv.
 * Returns the path + csv, or { empty } if the run logged no matching activities.
 * Filters mirror the daily KQL: only Succeeded/Failed, excluding Copy/lookup/AzureFunction.
 * Server-only — callable from a server action (browser) or an API route (ADF).
 */
export async function captureRunLog(
  pipeline: string,
  runId: string,
): Promise<{ path: string; csv: string } | { empty: true }> {
  const activities = (await queryActivityRuns(runId))
    .filter(
      (a) =>
        (a.status === "Succeeded" || a.status === "Failed") &&
        !a.activityName.toLowerCase().includes("copy") &&
        !a.activityName.toLowerCase().includes("lookup") &&
        a.activityType !== "AzureFunctionActivity",
    )
    .sort((a, b) => a.activityRunStart.localeCompare(b.activityRunStart));

  if (activities.length === 0) {
    console.log(`[capture] ${pipeline} ${runId}: no matching activities, nothing written`);
    return { empty: true };
  }

  const rows = activities.map((a) => [
    a.pipelineName,
    a.activityName,
    a.activityType,
    a.input,
    a.output,
    a.status,
    toNyWallClock(a.activityRunStart),
    toNyWallClock(a.activityRunEnd),
  ]);
  const csv = toCsv(CSV_HEADER, rows);

  // Name the file from the run's first activity start (NY wall-clock).
  const startStr = String(rows[0][6] ?? "");
  const date = startStr.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const hhmm = startStr.slice(11, 16).replace(":", "") || "0000";
  const path = `${pipeline}/${date}_${hhmm}.csv`;

  await uploadCsv(path, csv);
  console.log(`[capture] wrote ${path} (${rows.length} activities)`);
  return { path, csv };
}
