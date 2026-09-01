import type { IntegrationRun } from "@/lib/types";
import { fmtDuration, fmtTime } from "@/lib/format";
import { StatusDot } from "./ui";
import { fmtDay, SavedRunsMenu } from "./saved-runs";

/** Day tabs + "older logs" dropdown + saved-runs menu. Renders nothing with no days. */
export function DayPicker({
	availableDays,
	currentDay,
	loadingDay,
	onSwitchDay,
}: {
	availableDays: string[];
	currentDay: string | null;
	loadingDay: string | null;
	onSwitchDay: (day: string) => void;
}) {
	if (availableDays.length === 0) return null;
	const recentDays = availableDays.slice(0, 7);
	const olderDays = availableDays.slice(7);
	const currentIsOlder =
		currentDay !== null && !recentDays.includes(currentDay);

	return (
		<nav className="flex items-center gap-1 border-b border-slate-700/40 px-4 py-1.5 overflow-x-auto shrink-0 bg-slate-900/40">
			{currentIsOlder && (
				<>
					<button
						onClick={() => onSwitchDay(currentDay!)}
						className="rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap bg-linear-to-r from-blue-500/20 to-indigo-500/10 text-blue-300 ring-1 ring-inset ring-blue-400/30"
					>
						{fmtDay(currentDay!)}
					</button>
					<div className="w-px h-4 bg-slate-700 mx-1 shrink-0" />
				</>
			)}
			{recentDays.map((d) => (
				<button
					key={d}
					onClick={() => onSwitchDay(d)}
					disabled={loadingDay !== null}
					className={`rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
						d === currentDay
							? "bg-linear-to-r from-blue-500/20 to-indigo-500/10 text-blue-300 ring-1 ring-inset ring-blue-400/30"
							: "text-slate-400 hover:text-slate-200 hover:bg-slate-700/40"
					} ${loadingDay === d ? "opacity-60" : ""}`}
				>
					{fmtDay(d)}
				</button>
			))}
			{availableDays.length > 7 && (
				<>
					<div className="w-px h-4 bg-slate-700 mx-1 shrink-0" />
					<select
						value={currentIsOlder ? (currentDay ?? "") : ""}
						onChange={(e) =>
							e.target.value && onSwitchDay(e.target.value)
						}
						className="ml-1 rounded-md border border-slate-600/60 bg-slate-800 px-2.5 py-1 text-xs text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
					>
						<option value="">Older logs…</option>
						{olderDays.map((d) => (
							<option key={d} value={d}>
								{fmtDay(d)}
							</option>
						))}
					</select>
				</>
			)}
			<div className="w-px h-4 bg-slate-700 mx-1 shrink-0" />
			<SavedRunsMenu />
		</nav>
	);
}

/** The integrations list body (the <ul> inside the sidebar aside). */
export function IntegrationList({
	runs,
	selectedRunId,
	onSelect,
}: {
	runs: IntegrationRun[];
	selectedRunId: string | undefined;
	onSelect: (run: IntegrationRun) => void;
}) {
	return (
		<ul className="flex-1 overflow-y-auto p-1.5 space-y-1">
			{runs.map((run) => {
				const selected = run.id === selectedRunId;
				const ok = run.errorCount === 0 && run.status === "Succeeded";
				return (
					<li key={run.id}>
						<button
							onClick={() => onSelect(run)}
							className={`w-full text-left rounded-xl border-l-4 px-3 py-2.5 transition-colors ${
								selected
									? "border-blue-400 bg-linear-to-r from-blue-500/20 to-indigo-500/10 shadow-lg shadow-blue-500/10"
									: "border-transparent hover:bg-slate-700/30"
							}`}
						>
							<div className="flex items-center gap-2">
								<StatusDot ok={ok} />
								<span className="font-medium truncate text-slate-200">
									{run.name}
								</span>
								{run.errorCount > 0 && (
									<span className="ml-auto shrink-0 rounded-full bg-red-500/10 text-red-400 px-2 py-0.5 text-xs font-semibold">
										{run.errorCount}
									</span>
								)}
							</div>
							<div className="mt-1 text-xs text-slate-400">
								{fmtTime(run.startMs)} – {fmtTime(run.endMs)}
							</div>
							<div className="text-xs text-slate-400">
								<span className="font-bold">{run.records}</span>{" "}
								records · {fmtDuration(run.startMs, run.endMs)}
							</div>
						</button>
					</li>
				);
			})}
			{runs.length === 0 && (
				<li className="px-3 py-4 text-slate-400">
					No integrations match.
				</li>
			)}
		</ul>
	);
}
