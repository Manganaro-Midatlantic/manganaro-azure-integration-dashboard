"use client";

import { useEffect, useState } from "react";
import MicroModal from "micromodal";
import type { ActivityGroup, ActivityRun, DashboardData } from "@/lib/types";
import { fmtDuration } from "@/lib/format";
import type { SavedLog } from "@/app/actions";
import {
	getRunStatus,
	listSavedLogs,
	loadRunLog,
	triggerPipeline,
	viewRunLog,
} from "@/app/actions";
import { StatusDot } from "./ui";

const TERMINAL = new Set(["Succeeded", "Failed", "Cancelled"]);
const RESUME_TTL_MS = 30 * 60 * 1000; // 30 min — long enough to survive a refresh mid-run

export function RunNowButton({
	pipeline,
	onShowLog,
}: {
	pipeline: string;
	onShowLog: (data: DashboardData, path: string) => void;
}) {
	// null = idle; "Starting…" while triggering; then the live ADF run status.
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [runId, setRunId] = useState<string | null>(null);
	const [logState, setLogState] = useState<"idle" | "loading" | "empty">(
		"idle",
	);
	const busy =
		status !== null && status !== "Failed" && !TERMINAL.has(status);
	const terminal = status !== null && TERMINAL.has(status);

	const viewLogs = async () => {
		if (!runId || logState === "loading") return;
		setLogState("loading");
		try {
			const res = await viewRunLog(pipeline, runId);
			if ("error" in res) throw new Error(res.error);
			if ("empty" in res) {
				setLogState("empty");
				return;
			}
			setLogState("idle");
			onShowLog(res.data, res.path);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to load logs");
			setLogState("idle");
		}
	};

	// Poll ADF run status until the run reaches a terminal state.
	useEffect(() => {
		if (!runId) return;
		let alive = true;
		const tick = async () => {
			try {
				const data = await getRunStatus(runId);
				if (data.error) throw new Error(data.error);
				if (!alive) return;
				setStatus(data.status ?? null);
				if (data.status && TERMINAL.has(data.status)) clearInterval(id);
			} catch (e) {
				if (alive)
					setError(
						e instanceof Error ? e.message : "Status check failed",
					);
			}
		};
		const id = setInterval(tick, 3000);
		tick();
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, [runId]);

	// On mount/refresh, resume the pipeline's last run from storage: fetch its
	// status and show it, resuming live polling if it's still running. Uses
	// sessionStorage (not localStorage) so a "✓ Succeeded" from an old tab can't
	// resurface in a new browser session/day, plus a TTL so it doesn't linger
	// indefinitely even within one very long-lived session.
	useEffect(() => {
		const key = `runId:${pipeline}`;
		const raw = sessionStorage.getItem(key);
		if (!raw) return;
		let stored: { runId: string; ts: number };
		try {
			stored = JSON.parse(raw);
		} catch {
			sessionStorage.removeItem(key);
			return;
		}
		if (Date.now() - stored.ts > RESUME_TTL_MS) {
			sessionStorage.removeItem(key); // stale — don't resurrect an old result
			return;
		}
		let alive = true;
		getRunStatus(stored.runId).then((res) => {
			if (!alive) return;
			if (res.error || !res.status) {
				sessionStorage.removeItem(key); // stale/unknown run
				setStatus(null);
				return;
			}
			setStatus(res.status);
			setRunId(stored.runId); // resumes polling if running; enables View logs if done
		});
		return () => {
			alive = false;
		};
	}, [pipeline]);

	const run = async () => {
		if (busy) return;
		let secret = sessionStorage.getItem("runSecret") ?? "";
		if (!secret) {
			secret = window.prompt("Run password") ?? "";
			if (!secret) return; // cancelled
			sessionStorage.setItem("runSecret", secret);
		}
		setStatus("Starting…");
		setError("");
		setRunId(null);
		try {
			const data = await triggerPipeline(pipeline, secret);
			if (data.error === "Unauthorized")
				sessionStorage.removeItem("runSecret");
			if (data.error || !data.runId)
				throw new Error(data.error ?? "Trigger failed");
			setStatus("Queued");
			setRunId(data.runId); // kicks off the polling effect
			sessionStorage.setItem(
				`runId:${pipeline}`,
				JSON.stringify({ runId: data.runId, ts: Date.now() }),
			); // survive refresh, within this session only
		} catch (e) {
			setStatus("Failed");
			setError(e instanceof Error ? e.message : "Trigger failed");
		}
	};

	const failed = status === "Failed" || error !== "";
	const succeeded = status === "Succeeded";
	const label =
		status === null
			? "Run now"
			: status === "Starting…"
				? "Starting…"
				: succeeded
					? "✓ Succeeded"
					: failed
						? error
							? "Retry run"
							: "✗ Failed"
						: `${status}…`; // Queued, InProgress, Cancelling, …

	return (
		<div className="shrink-0 flex items-center gap-2">
			<button
				onClick={run}
				disabled={busy}
				title={error || `Trigger ${pipeline} now`}
				className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition disabled:opacity-70 ${
					failed
						? "bg-red-500/15 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/25"
						: succeeded
							? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25"
							: "bg-slate-700 text-sky-300 ring-1 ring-sky-500/40 hover:bg-slate-600 hover:text-sky-200"
				}`}
			>
				{status === null && (
					<span className="text-base leading-none">▶</span>
				)}
				{label}
			</button>
			{terminal && (
				<button
					onClick={viewLogs}
					disabled={logState === "loading"}
					title={
						logState === "empty"
							? "No matching activities logged for this run"
							: "Load this run's activity logs"
					}
					className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition disabled:opacity-70 bg-slate-700 text-slate-200 ring-1 ring-slate-500/40 hover:bg-slate-600"
				>
					{logState === "loading"
						? "Loading…"
						: logState === "empty"
							? "No logs"
							: "View logs"}
				</button>
			)}
		</div>
	);
}

/** "2026-06-30" → "Tue, Jun 30" (shared by the day picker and saved runs). */
export function fmtDay(d: string): string {
	return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

/** "HH:MM" (24h) → 12-hour with AM/PM, e.g. "13:24" → "1:24 PM". */
function fmt12h(hhmm: string): string {
	const [h, m] = hhmm.split(":");
	const hour = Number(h);
	const ampm = hour < 12 ? "AM" : "PM";
	const h12 = hour % 12 === 0 ? 12 : hour % 12;
	return `${h12}:${m} ${ampm}`;
}

/** One activity row in the compact modal preview. */
function RunLogRow({ activity: a }: { activity: ActivityRun }) {
	const label =
		a.recordMeta.length > 0
			? a.recordMeta.map(([k, v]) => `${k}${v}`).join(" ")
			: a.activityName;
	return (
		<div className="border-t border-slate-800/50 py-1.5 pr-3 pl-7">
			<div className="flex items-center gap-2">
				<StatusDot ok={a.status === "Succeeded"} />
				<span className="min-w-0 flex-1 truncate text-xs text-slate-200">
					{label}
				</span>
				<span className="shrink-0 text-xs text-slate-500">
					{fmtDuration(a.startMs, a.endMs)}
				</span>
			</div>
			{a.errorMessages.length > 0 && (
				<div className="pl-4 text-xs text-red-400">
					{a.errorMessages.join("; ")}
				</div>
			)}
		</div>
	);
}

/** One group in the compact modal preview. Flat groups (single-step records) show
 *  rows directly; record/name groups collapse — same behavior as the main UI. */
function RunLogGroup({ group }: { group: ActivityGroup }) {
	const flat =
		!group.isRecordGroup &&
		group.activities.some((a) => a.recordMeta.length > 0);
	const [open, setOpen] = useState(false);

	if (flat) {
		return (
			<div>
				{group.activities.map((a) => (
					<RunLogRow key={a.id} activity={a} />
				))}
			</div>
		);
	}

	return (
		<div>
			<button
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-2 px-3 py-1.5 bg-slate-800/60 text-sm font-medium text-slate-300 hover:bg-slate-800"
			>
				<span className="w-2.5 text-[10px] leading-none text-slate-500">
					{open ? "▼" : "▶"}
				</span>
				{group.isRecordGroup && (
					<StatusDot ok={group.errorCount === 0} />
				)}
				<span className="truncate">{group.name}</span>
				<span className="ml-auto flex items-center gap-2 text-slate-500">
					{group.errorCount > 0 && (
						<span className="text-red-400">
							{group.errorCount} err
						</span>
					)}
					<span>
						{group.activities.length}{" "}
						{group.activities.length === 1 ? "step" : "steps"}
					</span>
				</span>
			</button>
			{open &&
				group.activities.map((a) => (
					<RunLogRow key={a.id} activity={a} />
				))}
		</div>
	);
}

/** Compact read-only render of a saved run's parsed data — the "smaller log screen". */
function RunLogPreview({ data }: { data: DashboardData }) {
	if (data.runs.length === 0) {
		return (
			<p className="text-sm text-slate-400">No activities in this run.</p>
		);
	}
	return (
		<div className="space-y-4">
			{data.runs.map((run) => (
				<div
					key={run.id}
					className="rounded-lg border border-slate-700/50 bg-slate-800/40 overflow-hidden"
				>
					<div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/40">
						<StatusDot ok={run.errorCount === 0} />
						<span className="font-semibold text-slate-200 truncate">
							{run.name}
						</span>
						<span className="ml-auto shrink-0 text-xs text-slate-400">
							{run.records} records · {run.errorCount} errors ·{" "}
							{fmtDuration(run.startMs, run.endMs)}
						</span>
					</div>
					<div>
						{run.groups
							.filter((g) => g.activityType !== "ForEach")
							.map((g) => (
								<RunLogGroup key={g.name} group={g} />
							))}
					</div>
				</div>
			))}
		</div>
	);
}

const SAVED_RUNS_MODAL = "saved-runs-modal";

/** "View saved runs" button + MicroModal. Lists all captured runs (filterable by
 *  pipeline or date); clicking one splits into a 25% run rail + 75% log preview. */
export function SavedRunsMenu() {
	const [logs, setLogs] = useState<SavedLog[] | null>(null);
	const [filterPipe, setFilterPipe] = useState("");
	const [filterDate, setFilterDate] = useState("");
	const [selected, setSelected] = useState<{
		path: string;
		data: DashboardData;
	} | null>(null);
	const [loadingSel, setLoadingSel] = useState(false);
	// React owns visibility (via the is-open class) so it can't fight MicroModal's
	// imperative toggling; MicroModal is kept only for focus trap + scroll lock + ESC.
	const [isOpen, setIsOpen] = useState(false);

	const closeModal = () => {
		setIsOpen(false);
		setSelected(null);
		try {
			MicroModal.close(SAVED_RUNS_MODAL);
		} catch {
			/* wasn't opened through MicroModal */
		}
	};

	const openModal = () => {
		setLogs(null);
		setSelected(null);
		setFilterPipe("");
		setFilterDate("");
		setIsOpen(true);
		listSavedLogs()
			.then(setLogs)
			.catch(() => setLogs([]));
	};

	// Hand off to MicroModal for focus trap + scroll lock + ESC once React has
	// rendered the (now visible) modal element. React still owns display via `hidden`.
	useEffect(() => {
		if (!isOpen) return;
		try {
			MicroModal.show(SAVED_RUNS_MODAL, {
				disableScroll: true,
				onClose: () => {
					setIsOpen(false);
					setSelected(null);
				},
			});
		} catch {
			/* a11y niceties unavailable; modal still works via React */
		}
	}, [isOpen]);

	const pick = async (path: string) => {
		setLoadingSel(true);
		setSelected({ path, data: { runs: [] } as unknown as DashboardData });
		try {
			const res = await loadRunLog(path);
			if ("data" in res) setSelected({ path, data: res.data });
			else setSelected(null);
		} finally {
			setLoadingSel(false);
		}
	};

	const all = logs ?? [];
	const pipelines = [...new Set(all.map((l) => l.pipeline))].sort();
	const filtered = all.filter(
		(l) =>
			(!filterPipe || l.pipeline === filterPipe) &&
			(!filterDate || l.date === filterDate),
	);

	// Group filtered runs by pipeline, preserving newest-first order.
	const groups: [string, SavedLog[]][] = [];
	const byPipe = new Map<string, SavedLog[]>();
	for (const l of filtered) {
		let g = byPipe.get(l.pipeline);
		if (!g) {
			g = [];
			byPipe.set(l.pipeline, g);
			groups.push([l.pipeline, g]);
		}
		g.push(l);
	}

	const runList = (
		<div className="h-full overflow-y-auto">
			{logs === null ? (
				<p className="px-4 py-3 text-sm text-slate-400">Loading…</p>
			) : groups.length === 0 ? (
				<p className="px-4 py-3 text-sm text-slate-400">
					No saved runs.
				</p>
			) : (
				groups.map(([pipe, items]) => (
					<div
						key={pipe}
						className="border-b border-slate-800 last:border-0"
					>
						<div className="sticky top-0 bg-slate-900/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
							{pipe}
						</div>
						{items.map((l) => (
							<button
								key={l.path}
								onClick={() => pick(l.path)}
								className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-800 ${
									selected?.path === l.path
										? "bg-slate-800 text-sky-300"
										: "text-slate-200"
								}`}
							>
								{fmtDay(l.date)} · {fmt12h(l.time)}
							</button>
						))}
					</div>
				))
			)}
		</div>
	);

	return (
		<>
			<button
				onClick={openModal}
				className="ml-1 rounded-md border border-slate-600/60 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
			>
				View saved runs
			</button>

			<div
				className={`modal ${isOpen ? "" : "hidden"}`}
				id={SAVED_RUNS_MODAL}
				aria-hidden={!isOpen}
			>
				<div
					className="modal__overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
					tabIndex={-1}
					onClick={(e) => {
						if (e.target === e.currentTarget) closeModal();
					}}
				>
					<div
						className="modal__container flex h-[82vh] w-[92vw] max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
						role="dialog"
						aria-modal="true"
						aria-labelledby="saved-runs-title"
					>
						<div className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
							<h2
								id="saved-runs-title"
								className="text-base font-semibold text-slate-100"
							>
								Saved runs
							</h2>
							<div className="ml-auto flex items-center gap-2">
								<select
									value={filterPipe}
									onChange={(e) =>
										setFilterPipe(e.target.value)
									}
									className="rounded-md border border-slate-600/60 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/40 cursor-pointer"
								>
									<option value="">All pipelines</option>
									{pipelines.map((p) => (
										<option key={p} value={p}>
											{p}
										</option>
									))}
								</select>
								<input
									type="date"
									value={filterDate}
									onChange={(e) =>
										setFilterDate(e.target.value)
									}
									aria-label="Filter by date"
									className="rounded-md border border-slate-600/60 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500/40 [color-scheme:dark]"
								/>
								{filterDate && (
									<button
										onClick={() => setFilterDate("")}
										aria-label="Clear date filter"
										className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
									>
										Clear
									</button>
								)}
								<button
									onClick={closeModal}
									aria-label="Close"
									className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
								>
									✕
								</button>
							</div>
						</div>

						<div className="flex min-h-0 flex-1">
							{selected ? (
								<>
									<div className="w-1/4 min-w-45 border-r border-slate-700">
										{runList}
									</div>
									<div className="w-3/4 overflow-y-auto p-4">
										{loadingSel ? (
											<p className="text-sm text-slate-400">
												Loading…
											</p>
										) : (
											<RunLogPreview
												data={selected.data}
											/>
										)}
									</div>
								</>
							) : (
								<div className="flex-1">{runList}</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</>
	);
}
