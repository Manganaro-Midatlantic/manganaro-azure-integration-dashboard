/**
 * Format an epoch (ms) as an Eastern wall-clock time, e.g. "12:05:39 AM".
 * Timestamps are stored as ET wall-clock built in UTC (see lib/data.ts
 * parseTimestamp), so they're formatted back in UTC to reproduce the clock.
 */
export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

/** Format an epoch (ms) as a date, e.g. "Jun 16, 2026" — same UTC handling as fmtTime. */
export function fmtDate(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Human-readable elapsed time between two epochs, e.g. "3m 7s" / "8s". */
export function fmtDuration(startMs: number, endMs: number): string {
  const total = Math.max(0, Math.round((endMs - startMs) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Constrain a value to the [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Flatten a request body into key/value rows for the fields table. */
export function flatten(value: unknown, prefix = ""): [string, string][] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object") return [[prefix || "value", String(value)]];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) =>
      flatten(v, prefix ? `${prefix}[${i}]` : `[${i}]`),
    );
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}
