import { parseDashboardData, loadDashboardData } from "@/lib/data";
import { isBlobConfigured, listAvailableDays, loadDayCsv } from "@/lib/blob";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  if (!isBlobConfigured()) {
    return <Dashboard data={loadDashboardData()} />;
  }

  const { day } = await searchParams;
  const availableDays = await listAvailableDays();
  const currentDay = day && availableDays.includes(day) ? day : (availableDays[0] ?? null);

  if (!currentDay) {
    return <Dashboard data={parseDashboardData("", "No data", availableDays, null)} />;
  }

  const csvText = await loadDayCsv(currentDay);
  const data = parseDashboardData(csvText, `${currentDay}.csv`, availableDays, currentDay);
  return <Dashboard data={data} />;
}
