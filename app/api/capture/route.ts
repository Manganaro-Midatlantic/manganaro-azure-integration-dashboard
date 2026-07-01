import { isAdfConfigured } from "@/lib/adf";
import { captureRunLog, RUN_ID } from "@/lib/capture";

export const dynamic = "force-dynamic";

/**
 * Server-side capture endpoint for ADF to call at the end of a pipeline (a Web
 * activity POSTing { runId, pipeline }). Writes the run's log to blob independent
 * of any browser, so refreshing/closing the dashboard mid-run no longer loses it.
 * Secured by the x-capture-secret header when CAPTURE_SECRET is set.
 */
export async function POST(request: Request) {
  const secret = process.env.CAPTURE_SECRET;
  if (secret && request.headers.get("x-capture-secret") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdfConfigured()) {
    return Response.json({ error: "ADF not configured" }, { status: 400 });
  }

  const { runId, pipeline } = await request.json().catch(() => ({}));
  if (typeof runId !== "string" || !RUN_ID.test(runId)) {
    return Response.json({ error: "Invalid runId" }, { status: 400 });
  }
  if (typeof pipeline !== "string" || !pipeline) {
    return Response.json({ error: "Missing pipeline" }, { status: 400 });
  }

  const result = await captureRunLog(pipeline, runId); // logs inside
  // 200 even when empty so the ADF Web activity doesn't mark the pipeline failed.
  return Response.json("empty" in result ? { empty: true } : { path: result.path });
}
