"use server";

import { factoryUrl, getToken, isAdfConfigured } from "@/lib/adf";
import { isBlobConfigured, listRunLogs, loadBlobText } from "@/lib/blob";
import { captureRunLog, RUN_ID } from "@/lib/capture";
import { parseDashboardData } from "@/lib/data";
import type { DashboardData } from "@/lib/types";

export type RunResult = { runId?: string; error?: string };
export type StatusResult = { status?: string; error?: string };
export type LogResult =
  | { data: DashboardData; path: string }
  | { empty: true }
  | { error: string };
export type SavedLog = { pipeline: string; date: string; time: string; path: string };

// ponytail: gate is active only when RUN_SECRET is set; unset = open (local dev).
// Set RUN_SECRET in production to require the password. Plain compare — fine for a
// shared secret over HTTPS; a network timing attack on a high-entropy secret isn't practical.
function authorized(secret: string): boolean {
  const expected = process.env.RUN_SECRET;
  return !expected || secret === expected;
}

/** Trigger an ADF pipeline run. Returns the new runId or an error message. */
export async function triggerPipeline(pipeline: string, secret: string): Promise<RunResult> {
  if (!authorized(secret)) return { error: "Unauthorized" };
  if (!isAdfConfigured()) return { error: "Pipeline trigger not configured" };
  if (!pipeline) return { error: "Missing pipeline" };

  console.log(`[run] triggering pipeline "${pipeline}"`);
  const token = await getToken();
  const res = await fetch(
    factoryUrl(`/pipelines/${encodeURIComponent(pipeline)}/createRun?api-version=2018-06-01`),
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[run] createRun failed (${res.status})`, payload?.error?.message ?? payload);
    return { error: payload?.error?.message ?? `ADF createRun failed (${res.status})` };
  }
  console.log(`[run] started runId=${payload.runId}`);
  return { runId: payload.runId };
}

/** Current status of a pipeline run: Queued | In Progress | Succeeded | Failed | Cancelling | Cancelled */
export async function getRunStatus(runId: string): Promise<StatusResult> {
  if (!isAdfConfigured()) return { error: "Not configured" };
  if (!runId) return { error: "Missing runId" };

  const token = await getToken();
  const res = await fetch(
    factoryUrl(`/pipelineruns/${encodeURIComponent(runId)}?api-version=2018-06-01`),
    { headers: { authorization: `Bearer ${token}` } },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: payload?.error?.message ?? `status failed (${res.status})` };
  }
  return { status: payload.status === "InProgress" ? "In Progress" : payload.status };
}

/**
 * Capture a run's logs to blob and return the parsed data for the viewer. Shares
 * captureRunLog() with the ADF-triggered /api/capture route, so a manual "View
 * logs" click and ADF's own end-of-pipeline call write the identical file.
 */
export async function viewRunLog(pipeline: string, runId: string): Promise<LogResult> {
  if (!isAdfConfigured()) return { error: "ADF not configured" };
  if (!RUN_ID.test(runId)) return { error: "Invalid runId" };

  try {
    const r = await captureRunLog(pipeline, runId);
    if ("empty" in r) return { empty: true };
    return { data: parseDashboardData(r.csv, r.path, [], null), path: r.path };
  } catch (e) {
    console.error("[viewRunLog] capture failed:", e);
    return { error: e instanceof Error ? e.message : "Capture failed" };
  }
}

const LOG_PATH = /^[^/]+\/(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\.csv$/;

/** All previously-captured run logs (from blob), newest first. */
export async function listSavedLogs(): Promise<SavedLog[]> {
  if (!isBlobConfigured()) return [];
  const logs: SavedLog[] = [];
  for (const path of await listRunLogs()) {
    const m = path.match(LOG_PATH);
    if (m) logs.push({ pipeline: path.split("/")[0], date: m[1], time: `${m[2]}:${m[3]}`, path });
  }
  return logs;
}

/** Load a saved run log from blob and parse it for the viewer. */
export async function loadRunLog(path: string): Promise<LogResult> {
  if (!isBlobConfigured()) return { error: "Blob storage not configured" };
  if (!LOG_PATH.test(path)) return { error: "Invalid log path" };
  try {
    const csv = await loadBlobText(path);
    return { data: parseDashboardData(csv, path, [], null), path };
  } catch {
    return { error: "Log not found" };
  }
}
