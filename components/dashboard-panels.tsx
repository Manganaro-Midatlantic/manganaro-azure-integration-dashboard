import { useEffect, useRef } from "react";
import type { IntegrationRun } from "@/lib/types";
import { fmtDuration, fmtTime } from "@/lib/format";
import { StatusDot } from "./ui";
import { fmtDay, SavedRunsMenu } from "./saved-runs";

/** "2026-09-01" → "November 2026" (month-group header for the older-days menu). */
function monthLabel(d: string): string {
	return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
	});
}

/** Buckets consecutive same-month days together, preserving input order. */
function groupByMonth(days: string[]): [string, string[]][] {
	const groups: [string, string[]][] = [];
	for (const d of days) {
		const label = monthLabel(d);
		const last = groups[groups.length - 1];
		if (last && last[0] === label) last[1].push(d);
		else groups.push([label, [d]]);
	}
	return groups;
}

/** "Older logs…" trigger (native <details>) opening a panel of month groups,
 *  each a collapsible <details> — replaces a single flat <select> list with
 *  one that groups by month. */
function OlderDaysMenu({
	olderDays,
	currentDay,
	onSwitchDay,
}: {
	olderDays: string[];
	currentDay: string | null;
	onSwitchDay: (day: string) => void;
}) {
	const ref = useRef<HTMLDetailsElement>(null);

	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (ref.current?.open && !ref.current.contains(e.target as Node)) {
				ref.current.open = false;
			}
		};
		document.addEventListener("click", onDocClick);
		return () => document.removeEventListener("click", onDocClick);
	}, []);

	const pick = (d: string) => {
		onSwitchDay(d);
		if (ref.current) ref.current.open = false;
	};

	return (
		<details ref={ref} className="relative">
			<summary className="list-none rounded-md border border-slate-600/60 bg-slate-800 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer [&::-webkit-details-marker]:hidden">
				{currentDay ? fmtDay(currentDay) : "Older logs…"}
			</summary>
			<div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-56 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 py-1 shadow-xl">
				{groupByMonth(olderDays).map(([label, days]) => (
					<details
						key={label}
						open={days.includes(currentDay ?? "")}
						className="group px-1"
					>
						<summary className="flex list-none items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold text-slate-400 hover:bg-slate-800 cursor-pointer [&::-webkit-details-marker]:hidden">
							<span className="text-[10px] transition-transform group-open:rotate-90">
								▸
							</span>
							{label}
						</summary>
						<div className="pb-1 pl-3">
							{days.map((d) => (
								<button
									key={d}
									onClick={() => pick(d)}
									className={`block w-full rounded px-2 py-1 text-left text-xs ${
										d === currentDay
											? "bg-slate-800 text-sky-300"
											: "text-slate-300 hover:bg-slate-800"
									}`}
								>
									{fmtDay(d)}
								</button>
							))}
						</div>
					</details>
				))}
			</div>
		</details>
	);
}

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
		<nav className="flex items-center gap-1 border-b border-slate-700/40 px-4 py-1.5 shrink-0 bg-slate-900/40">
			<div className="flex items-center gap-1 overflow-x-auto min-w-0">
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
			</div>
			{availableDays.length > 7 && (
				<>
					<div className="w-px h-4 bg-slate-700 mx-1 shrink-0" />
					<OlderDaysMenu
						olderDays={olderDays}
						currentDay={currentIsOlder ? currentDay : null}
						onSwitchDay={onSwitchDay}
					/>
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
