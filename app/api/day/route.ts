import { isBlobConfigured, listAvailableDays, loadDayCsv } from "@/lib/blob";
import { parseDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isBlobConfigured()) {
    return Response.json({ error: "Blob storage not configured" }, { status: 400 });
  }

  const day = new URL(request.url).searchParams.get("day");
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: "Invalid day" }, { status: 400 });
  }

  const availableDays = await listAvailableDays();
  if (!availableDays.includes(day)) {
    return Response.json({ error: "Day not found" }, { status: 404 });
  }

  const csvText = await loadDayCsv(day);
  const data = parseDashboardData(csvText, `${day}.csv`, availableDays, day);

  // Each day's blob is written once by the Logic App and never changes, so the
  // content can be cached by the browser/CDN indefinitely.
  return Response.json(data, {
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
