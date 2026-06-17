"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type {
	ActivityGroup,
	ActivityRun,
	DashboardData,
	IntegrationRun,
} from "@/lib/types";
import { clamp, flatten, fmtDuration, fmtTime } from "@/lib/format";

function StatusDot({ ok }: { ok: boolean }) {
	return (
		<span
			className={`inline-block w-2 h-2 rounded-full shrink-0 ${
				ok ? "bg-emerald-500" : "bg-red-500"
			}`}
		/>
	);
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
				ok
					? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
					: "bg-red-500/10 text-red-400 ring-red-500/20"
			}`}
		>
			<StatusDot ok={ok} />
			{label}
		</span>
	);
}

function HttpStatusPill({ code }: { code: string }) {
	const ok = code.startsWith("2");
	return (
		<span
			className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold font-mono ring-1 ring-inset ${
				ok
					? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/20"
					: "bg-red-500/15 text-red-400 ring-red-500/20"
			}`}
		>
			HTTP {code}
		</span>
	);
}

/** Draggable divider between panels; reports cumulative pointer delta while dragging */
function DragHandle({
	orientation,
	onStart,
	onDelta,
}: {
	orientation: "col" | "row";
	onStart: () => void;
	onDelta: (delta: number) => void;
}) {
	const isRow = orientation === "row";
	return (
		<div
			onPointerDown={(e) => {
				e.preventDefault();
				onStart();
				const startPos = isRow ? e.clientY : e.clientX;
				const move = (ev: PointerEvent) =>
					onDelta((isRow ? ev.clientY : ev.clientX) - startPos);
				const up = () =>
					window.removeEventListener("pointermove", move);
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up, { once: true });
			}}
			className={`group shrink-0 flex items-center justify-center ${
				isRow ? "h-3 cursor-row-resize" : "w-3 cursor-col-resize"
			}`}
		>
			<div
				className={`rounded-full bg-slate-700/60 transition-colors group-hover:bg-blue-500 ${
					isRow ? "h-0.5 w-16" : "w-0.5 h-16"
				}`}
			/>
		</div>
	);
}

const SQL_KEYWORDS = new Set(
	(
		"select from where insert into values update set delete create table drop " +
		"if exists not null and or as join inner left right outer on group by order " +
		"having union all distinct case when then else end begin declare is in like " +
		"top with primary key constraint default identity truncate alter add cast " +
		"convert isnull coalesce between go int bigint varchar nvarchar datetime " +
		"decimal float bit char text date getdate count sum min max avg row_number over partition"
	).split(" "),
);

const SQL_TOKEN_RE =
	/(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|(\[[^\]]*\]|\b[a-zA-Z_][\w$#@]*\b)|([\s\S])/g;

/** Lightweight SQL syntax highlighting — keywords, strings, numbers, comments */
function SqlView({ sql }: { sql: string }) {
	const nodes: React.ReactNode[] = [];
	let plain = "";
	let key = 0;
	const flush = () => {
		if (plain) {
			nodes.push(plain);
			plain = "";
		}
	};
	for (const m of sql.matchAll(SQL_TOKEN_RE)) {
		const [, comment, str, num, ident] = m;
		if (comment) {
			flush();
			nodes.push(
				<span key={key++} className="text-slate-500 italic">
					{comment}
				</span>,
			);
		} else if (str) {
			flush();
			nodes.push(
				<span key={key++} className="text-amber-300/90">
					{str}
				</span>,
			);
		} else if (num) {
			flush();
			nodes.push(
				<span key={key++} className="text-cyan-300">
					{num}
				</span>,
			);
		} else if (ident && SQL_KEYWORDS.has(ident.toLowerCase())) {
			flush();
			nodes.push(
				<span key={key++} className="text-blue-400 font-medium">
					{ident}
				</span>,
			);
		} else {
			plain += m[0];
		}
	}
	flush();
	return (
		<pre className="flex-1 overflow-auto px-4 py-3 text-xs font-mono text-slate-200 whitespace-pre-wrap">
			{nodes}
		</pre>
	);
}

const card =
	"bg-slate-800/40 rounded-2xl border border-slate-700/40 shadow-xl shadow-black/20 backdrop-blur-sm";

/** Centered placeholder shown in a panel before a record is selected */
function EmptyHint({ label }: { label: string }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center text-slate-500">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				className="h-7 w-7 opacity-30"
			>
				<path d="M4 6h16M4 12h10M4 18h7" />
			</svg>
			<p className="text-xs">{label}</p>
		</div>
	);
}

/** Collapsed panels shrink to a slim rail with a vertical label */
function CollapsedRail({
	title,
	onExpand,
}: {
	title: string;
	onExpand: () => void;
}) {
	return (
		<div
			className={`w-10 shrink-0 flex flex-col items-center py-2.5 gap-3 min-h-0 ${card}`}
		>
			<button
				onClick={onExpand}
				title={`Expand ${title}`}
				className="text-slate-400 hover:text-slate-200 text-xs leading-none"
			>
				⤢
			</button>
			<span className="[writing-mode:vertical-rl] text-[11px] font-semibold uppercase tracking-wider text-slate-300">
				{title}
			</span>
		</div>
	);
}

function PanelTitle({
	title,
	onCollapse,
	children,
}: {
	title: string;
	onCollapse?: () => void;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700/40">
			<span className="h-3.5 w-1 rounded-full bg-linear-to-b from-sky-400 to-indigo-500" />
			<span className="text-[11px] font-semibold uppercase tracking-wider text-slate-200">
				{title}
			</span>
			{children}
			{onCollapse && (
				<button
					onClick={onCollapse}
					title={`Collapse ${title}`}
					className="ml-auto text-slate-500 hover:text-slate-200 text-xs leading-none px-1"
				>
					—
				</button>
			)}
		</div>
	);
}

export default function Dashboard({
	data: initialData,
}: {
	data: DashboardData;
}) {
	const [data, setData] = useState<DashboardData>(initialData);
	const [loadingDay, setLoadingDay] = useState<string | null>(null);
	// Client-side cache of already-fetched days so re-visits are instant.
	// Seeded with the server-rendered initial day.
	const dayCache = useRef<Map<string, DashboardData>>(
		new Map(
			initialData.currentDay
				? [[initialData.currentDay, initialData]]
				: [],
		),
	);

	const availableDays = useRef(initialData.availableDays);

	const switchDay = useCallback(
		async (day: string, push = true) => {
			if (day === data.currentDay) return;
			if (push) window.history.pushState(null, "", `/?day=${day}`);

			const apply = (d: DashboardData) =>
				setData({ ...d, availableDays: availableDays.current });

			const cached = dayCache.current.get(day);
			if (cached) {
				apply(cached);
				return;
			}
			setLoadingDay(day);
			try {
				const res = await fetch(`/api/day?day=${day}`);
				if (!res.ok) throw new Error(`Failed to load ${day}`);
				const next: DashboardData = await res.json();
				dayCache.current.set(day, next);
				apply(next);
			} finally {
				setLoadingDay(null);
			}
		},
		[data.currentDay],
	);

	// Keep browser back/forward in sync — re-switch to the day in the URL.
	useEffect(() => {
		const onPop = () => {
			const day = new URLSearchParams(window.location.search).get("day");
			if (day) switchDay(day, false);
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, [switchDay]);

	const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
		undefined,
	);
	const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
		null,
	);
	const [errorsOnly, setErrorsOnly] = useState(false);
	const [search, setSearch] = useState("");
	const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

	// Resizable + collapsible columns
	const [sidebarWidth, setSidebarWidth] = useState(320);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [inspectorHeight, setInspectorHeight] = useState(300);
	
	const [panelPct, setPanelPct] = useState({
		request: 33,
		body: 33,
		response: 34,
	});
	const [collapsedPanels, setCollapsedPanels] = useState<Set<string>>(
		new Set(),
	);
	const dragBase = useRef(0);
	const inspectorRef = useRef<HTMLDivElement>(null);

	const selectedRun: IntegrationRun | undefined = data.runs.find(
		(r) => r.id === selectedRunId,
	);

	const visibleRuns = useMemo(
		() =>
			errorsOnly ? data.runs.filter((r) => r.errorCount > 0) : data.runs,
		[data.runs, errorsOnly],
	);

	const selectedActivity: ActivityRun | null = useMemo(() => {
		if (!selectedRun || !selectedActivityId) return null;
		for (const g of selectedRun.groups) {
			const hit = g.activities.find((a) => a.id === selectedActivityId);
			if (hit) return hit;
		}
		return null;
	}, [selectedRun, selectedActivityId]);

	const searchLower = search.trim().toLowerCase();
	const matchesSearch = (a: ActivityRun) =>
		!searchLower ||
		a.activityName.toLowerCase().includes(searchLower) ||
		(a.url ?? "").toLowerCase().includes(searchLower) ||
		a.bodyRaw.toLowerCase().includes(searchLower) ||
		a.errorMessages.some((m) => m.toLowerCase().includes(searchLower));

	function visibleActivities(g: ActivityGroup): ActivityRun[] {
		let list = g.activities;
		if (errorsOnly) list = list.filter((a) => a.status !== "Succeeded");
		if (searchLower) list = list.filter(matchesSearch);
		return list;
	}

	// Flat lists render without a dropdown; record/script groups are collapsible.
	const isFlatGroup = (g: ActivityGroup) =>
		!g.isRecordGroup && g.activities.some((a) => a.recordMeta.length > 0);

	// Ordered list of selectable record rows, in display order, for keyboard nav.
	const navActivities: ActivityRun[] = [];
	if (selectedRun) {
		for (const g of selectedRun.groups) {
			if (g.activityType === "ForEach") continue;
			navActivities.push(...visibleActivities(g));
		}
	}
	// Keep the latest list/selection reachable from the (once-registered) key handler.
	const navRef = useRef({ list: navActivities, selId: selectedActivityId });
	useEffect(() => {
		navRef.current = { list: navActivities, selId: selectedActivityId };
	});

	// Arrow up/down moves the selection through the records.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
			const tag = (e.target as HTMLElement | null)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
				return;
			const { list, selId } = navRef.current;
			if (list.length === 0) return;
			e.preventDefault();
			const idx = list.findIndex((a) => a.id === selId);
			const step = e.key === "ArrowDown" ? 1 : -1;
			const nextIdx =
				idx === -1
					? 0
					: Math.min(list.length - 1, Math.max(0, idx + step));
			const next = list[nextIdx];
			if (!next) return;
			setSelectedActivityId(next.id);
			// Auto-expand the containing collapsible group so the row is visible.
			const grp = selectedRun?.groups.find((g) =>
				g.activities.some((a) => a.id === next.id),
			);
			if (grp && grp.activityType !== "ForEach" && !isFlatGroup(grp)) {
				setOpenGroups((prev) =>
					prev.has(grp.name) ? prev : new Set(prev).add(grp.name),
				);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selectedRun]);

	// Keep the selected row scrolled into view as the selection moves.
	useEffect(() => {
		if (!selectedActivityId) return;
		document
			.querySelector(`[data-aid="${CSS.escape(selectedActivityId)}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [selectedActivityId]);

	// Reset the activity-log scroll to the top when switching integrations.
	const activityLogRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		activityLogRef.current?.scrollTo({ top: 0 });
	}, [selectedRunId]);

	function selectRun(run: IntegrationRun) {
		setSelectedRunId(run.id);
		setSelectedActivityId(null);
		// Start with every group collapsed, regardless of error state.
		setOpenGroups(new Set());
	}

	function toggleGroup(name: string) {
		setOpenGroups((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
	}

	function togglePanel(name: string) {
		setCollapsedPanels((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
	}

	function resizePanel(name: "request" | "body", deltaPx: number) {
		const containerWidth = inspectorRef.current?.offsetWidth ?? 1200;
		const deltaPct = (deltaPx / containerWidth) * 100;
		setPanelPct((prev) => ({
			...prev,
			[name]: clamp(dragBase.current + deltaPct, 12, 70),
		}));
	}

	const fieldRows = selectedActivity ? flatten(selectedActivity.body) : [];

	const requestCollapsed = collapsedPanels.has("Request");
	const bodyCollapsed = collapsedPanels.has("Body");
	const responseCollapsed = collapsedPanels.has("Response");
	const bodyTitle = selectedActivity?.sql ? "SQL" : "Body";

	return (
		<div className="flex flex-col h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-300 text-sm">
			{/* Header */}
			<header className="flex items-center gap-4 border-b border-slate-700/40 bg-linear-to-b from-slate-900/40 to-transparent px-5 py-3">
				<div className="flex items-center gap-3">
					<Image
						src="/favicon.ico"
						alt="logo"
						width={45}
						height={45}
						className="rounded-lg"
					/>
					<div>
						<h1 className="text-lg font-bold leading-tight tracking-tight text-slate-200">
							Manganaro Viewpoint to Rhumbix Integration Dashboard
						</h1>
						<p className="text-xs text-slate-400 leading-tight">
							Azure Data Factory · {data.generatedFrom}
						</p>
					</div>
				</div>

				<div className="ml-auto flex items-center gap-2">
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search activities, payloads, errors…"
						className="w-72 rounded-full border border-slate-600/50 bg-slate-800/70 px-4 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
					/>
					<button
						onClick={() => setErrorsOnly(!errorsOnly)}
						className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
							errorsOnly
								? "bg-red-600 text-white border-red-600"
								: "bg-slate-800 text-slate-300 border-slate-600/60 hover:bg-slate-700"
						}`}
					>
						Errors only
					</button>
					<div className="flex items-center gap-2 pl-3 ml-1 border-l border-slate-700/40">
						<span className="inline-flex items-center gap-1.5 rounded-full bg-slate-700/40 px-3 py-1 text-xs ring-1 ring-inset ring-slate-600/40">
							<span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
							<b className="font-semibold text-slate-100">
								{data.totalActivities}
							</b>
							<span className="text-slate-400">records</span>
						</span>
						<span
							className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ring-inset ${
								data.totalErrors > 0
									? "bg-red-500/10 text-red-300 ring-red-500/25"
									: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25"
							}`}
						>
							<span
								className={`h-1.5 w-1.5 rounded-full ${
									data.totalErrors > 0
										? "bg-red-400"
										: "bg-emerald-400"
								}`}
							/>
							<b className="font-semibold">{data.totalErrors}</b>
							<span className="opacity-75">errors</span>
						</span>
					</div>
				</div>
			</header>

			{data.availableDays.length > 0 && (
				<nav className="flex items-center gap-1 border-b border-slate-700/40 px-4 py-1.5 overflow-x-auto shrink-0 bg-slate-900/40">
					{(() => {
						const recentDays = data.availableDays.slice(0, 7);
						const olderDays = data.availableDays.slice(7);
						const currentIsOlder =
							data.currentDay !== null &&
							!recentDays.includes(data.currentDay);
						const fmtDay = (d: string) =>
							new Date(d + "T12:00:00").toLocaleDateString(
								"en-US",
								{
									weekday: "short",
									month: "short",
									day: "numeric",
								},
							);
						return (
							<>
								{currentIsOlder && (
									<>
										<button
											onClick={() =>
												switchDay(data.currentDay!)
											}
											className="rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap bg-linear-to-r from-blue-500/20 to-indigo-500/10 text-blue-300 ring-1 ring-inset ring-blue-400/30"
										>
											{fmtDay(data.currentDay!)}
										</button>
										<div className="w-px h-4 bg-slate-700 mx-1 shrink-0" />
									</>
								)}
								{recentDays.map((d) => (
									<button
										key={d}
										onClick={() => switchDay(d)}
										disabled={loadingDay !== null}
										className={`rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
											d === data.currentDay
												? "bg-linear-to-r from-blue-500/20 to-indigo-500/10 text-blue-300 ring-1 ring-inset ring-blue-400/30"
												: "text-slate-400 hover:text-slate-200 hover:bg-slate-700/40"
										} ${loadingDay === d ? "opacity-60" : ""}`}
									>
										{fmtDay(d)}
									</button>
								))}
								{data.availableDays.length > 7 && (
									<>
										<div className="w-px h-4 bg-slate-700 mx-1 shrink-0" />
										<select
											value={
												currentIsOlder
													? (data.currentDay ?? "")
													: ""
											}
											onChange={(e) =>
												e.target.value &&
												switchDay(e.target.value)
											}
											className="ml-1 rounded-md border border-slate-600/60 bg-slate-800 px-2.5 py-1 text-xs text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
										>
											<option value="">
												Older logs…
											</option>
											{olderDays.map((d) => (
												<option key={d} value={d}>
													{fmtDay(d)}
												</option>
											))}
										</select>
									</>
								)}
							</>
						);
					})()}
				</nav>
			)}

			<div className="flex flex-1 p-3 min-h-0">
				{/* Integrations list */}
				{sidebarCollapsed ? (
					<>
						<CollapsedRail
							title="Integrations"
							onExpand={() => setSidebarCollapsed(false)}
						/>
						<div className="w-3 shrink-0" />
					</>
				) : (
					<>
						<aside
							style={{ width: sidebarWidth }}
							className={`shrink-0 flex flex-col min-h-0 ${card}`}
						>
							<PanelTitle
								title="Integrations"
								onCollapse={() => setSidebarCollapsed(true)}
							/>
							<ul className="flex-1 overflow-y-auto p-1.5 space-y-1">
								{visibleRuns.map((run) => {
									const selected = run.id === selectedRunId;
									const ok =
										run.errorCount === 0 &&
										run.status === "Succeeded";
									return (
										<li key={run.id}>
											<button
												onClick={() => selectRun(run)}
												className={`w-full text-left rounded-xl px-3 py-2.5 transition-colors ${
													selected
														? "bg-linear-to-r from-blue-500/20 to-indigo-500/10 ring-1 ring-blue-400/30 shadow-lg shadow-blue-500/10"
														: "hover:bg-slate-700/30"
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
													{fmtTime(run.startMs)} –{" "}
													{fmtTime(run.endMs)}
												</div>
												<div className="text-xs text-slate-400">
													<span className="font-bold">
														{run.records}
													</span>{" "}
													records ·{" "}
													{fmtDuration(
														run.startMs,
														run.endMs,
													)}
												</div>
											</button>
										</li>
									);
								})}
								{visibleRuns.length === 0 && (
									<li className="px-3 py-4 text-slate-400">
										No integrations match.
									</li>
								)}
							</ul>
						</aside>
						<DragHandle
							orientation="col"
							onStart={() => (dragBase.current = sidebarWidth)}
							onDelta={(d) =>
								setSidebarWidth(
									clamp(dragBase.current + d, 200, 560),
								)
							}
						/>
					</>
				)}

				{/* Right side */}
				<div className="flex-1 flex flex-col min-w-0 min-h-0">
					{/* Run summary */}
					{selectedRun && (
						<section
							key={selectedRun.id}
							className={`flex items-center gap-4 px-4 py-3 mb-3 fade-in-up ${card}`}
						>
							<StatusPill
								ok={selectedRun.errorCount === 0}
								label={
									selectedRun.errorCount === 0
										? "Completed"
										: "Completed with errors"
								}
							/>
							<span className="text-slate-300 truncate">
								{selectedRun.childPipeline}
							</span>
							<div className="ml-auto flex items-center gap-2.5">
								{[
									[
										"Records",
										selectedRun.records,
										"from-sky-500/25 to-indigo-500/10 border-sky-400/20",
										"text-sky-200",
									],
									[
										"Success",
										selectedRun.successCount,
										"from-emerald-500/25 to-teal-500/10 border-emerald-400/20",
										"text-emerald-200",
									],
									[
										"Errors",
										selectedRun.errorCount,
										"from-rose-500/25 to-orange-500/10 border-rose-400/20",
										selectedRun.errorCount > 0
											? "text-rose-200"
											: "text-slate-300",
									],
									[
										"Duration",
										fmtDuration(
											selectedRun.startMs,
											selectedRun.endMs,
										),
										"from-violet-500/25 to-fuchsia-500/10 border-violet-400/20",
										"text-violet-200",
									],
								].map(([label, value, grad, text]) => (
									<div
										key={label}
										className={`min-w-[96px] rounded-2xl border px-4 py-2.5 text-center bg-linear-to-br shadow-lg shadow-black/10 ${grad}`}
									>
										<div
											className={`text-2xl font-bold leading-none ${text}`}
										>
											{value}
										</div>
										<div className="mt-1 text-[10px] uppercase tracking-wider text-slate-300/60">
											{label}
										</div>
									</div>
								))}
							</div>
						</section>
					)}

					{/* Activity groups */}
					<section className={`flex-1 flex flex-col min-h-0 ${card}`}>
						<PanelTitle title="Activity Log" />
						<div ref={activityLogRef} className="flex-1 overflow-y-auto">
							{selectedRun?.groups.map((group) => {
								const list = visibleActivities(group);
								if (
									(errorsOnly || searchLower) &&
									list.length === 0
								)
									return null;
								const open = openGroups.has(group.name);

								// ForEach loops are containers, not records — show them as a flat
								// summary line with their item count instead of a collapsible group.
								if (group.activityType === "ForEach") {
									return list.map((a) => {
										const failed = a.status !== "Succeeded";
										const items =
											a.metrics.find(
												([k]) => k === "items",
											)?.[1] ?? "0";
										return (
											<div
												key={a.id}
												className="flex items-center gap-2.5 px-4 py-2 border-b border-slate-700/40 last:border-0 bg-slate-800/40"
											>
												<span className="w-3" />
												<StatusDot ok={!failed} />
												<span className="text-slate-400">
													{a.activityName}
												</span>
												<span className="rounded-full bg-blue-500/10 text-blue-400 px-2.5 py-0.5 text-xs font-semibold">
													{items}{" "}
													{items === "1"
														? "item"
														: "items"}
												</span>
												{failed && (
													<span className="text-xs text-red-400 font-medium">
														loop failed — see
														records below
													</span>
												)}
												<span className="ml-auto text-xs text-slate-400">
													{fmtDuration(
														a.startMs,
														a.endMs,
													)}
												</span>
											</div>
										);
									});
								}

								// Single-step integrations (cost codes, budgets, projects):
								// no dropdown — just a flat, clickable list of record rows.
								const isFlatRecordList =
									!group.isRecordGroup &&
									group.activities.some(
										(a) => a.recordMeta.length > 0,
									);
								if (isFlatRecordList) {
									return (
										<table
											key={group.name}
											className="w-full text-xs"
										>
											<tbody>
												{list.map((a) => {
													const failed =
														a.status !==
														"Succeeded";
													const selected =
														a.id ===
														selectedActivityId;
													const meta = a.recordMeta
														.map(
															([k, v]) =>
																`${k.replace(/[:\s]+$/, "")}: ${v}`,
														)
														.join(" · ");
													return (
														<tr
															key={a.id}
															data-aid={a.id}
															onClick={() =>
																setSelectedActivityId(
																	a.id,
																)
															}
															className={`cursor-pointer border-b border-slate-700/40 last:border-0 transition-colors ${
																selected
																	? "bg-blue-500/15 shadow-[inset_3px_0_0_0_#60a5fa]"
																	: failed
																		? "bg-red-500/5 hover:bg-red-500/10"
																		: "hover:bg-slate-700/30"
															}`}
														>
															<td className="pl-4 pr-2 py-1.5 w-8">
																<StatusDot
																	ok={!failed}
																/>
															</td>
															<td className="px-2 py-1.5 whitespace-nowrap font-mono text-slate-400">
																{fmtTime(
																	a.startMs,
																)}
															</td>
															<td className="px-2 py-1.5 whitespace-nowrap">
																{a.httpStatus && (
																	<HttpStatusPill
																		code={
																			a.httpStatus
																		}
																	/>
																)}
															</td>
															<td
																className={`w-full px-2 py-1.5 truncate ${
																	failed
																		? "text-red-400 font-medium"
																		: "text-slate-400"
																}`}
															>
																{failed
																	? (a
																			.errorMessages[0] ??
																		"Failed — no error detail logged")
																	: meta ||
																		"Completed"}
															</td>
															<td className="px-2 py-1.5 whitespace-nowrap text-right text-slate-400">
																{fmtDuration(
																	a.startMs,
																	a.endMs,
																)}
															</td>
														</tr>
													);
												})}
											</tbody>
										</table>
									);
								}

								return (
									<div
										key={group.name}
										className="border-b border-slate-700/40 last:border-0"
									>
										<button
											onClick={() =>
												toggleGroup(group.name)
											}
											className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-slate-700/30 text-left"
										>
											<span
												className={`text-slate-400 text-xs transition-transform ${
													open ? "rotate-90" : ""
												}`}
											>
												▶
											</span>
											<StatusDot
												ok={group.errorCount === 0}
											/>
											<span className="font-medium text-slate-200">
												{group.name}
											</span>
											{group.activityType && (
												<span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
													{group.activityType}
												</span>
											)}
											<span className="ml-auto text-xs text-slate-400">
												{list.length}
												{list.length !==
													group.activities.length &&
													` of ${group.activities.length}`}{" "}
												{group.isRecordGroup
													? list.length === 1
														? "step"
														: "steps"
													: "records"}
												{group.errorCount > 0 && (
													<span className="text-red-400 font-semibold">
														{" "}
														· {
															group.errorCount
														}{" "}
														failed
													</span>
												)}
											</span>
										</button>
										{open && (
											<table className="w-full text-xs">
												<tbody>
													{list.map((a) => {
														const failed =
															a.status !==
															"Succeeded";
														const selected =
															a.id ===
															selectedActivityId;
														return (
															<tr
																key={a.id}
																data-aid={a.id}
																onClick={() =>
																	setSelectedActivityId(
																		a.id,
																	)
																}
																className={`cursor-pointer border-t border-slate-700/40 transition-colors ${
																	selected
																		? "bg-blue-500/15 shadow-[inset_3px_0_0_0_#60a5fa]"
																		: failed
																			? "bg-red-500/5 hover:bg-red-500/10"
																			: "hover:bg-slate-700/30"
																}`}
															>
																<td className="pl-11 pr-2 py-1.5 w-8">
																	<StatusDot
																		ok={
																			!failed
																		}
																	/>
																</td>
																<td className="px-2 py-1.5 whitespace-nowrap font-mono text-slate-400">
																	{fmtTime(
																		a.startMs,
																	)}
																</td>
																<td className="px-2 py-1.5 whitespace-nowrap">
																	{a.httpStatus && (
																		<HttpStatusPill
																			code={
																				a.httpStatus
																			}
																		/>
																	)}
																</td>
																<td
																	className={`w-full px-2 py-1.5 truncate ${
																		failed
																			? "text-red-400 font-medium"
																			: "text-slate-400"
																	}`}
																>
																	{group.isRecordGroup
																		? failed
																			? `${a.activityName} — ${a.errorMessages[0] ?? "Failed"}`
																			: a.activityName
																		: failed
																			? (a
																					.errorMessages[0] ??
																				"Failed — no error detail logged")
																			: a
																						.recordMeta
																						.length >
																				  0
																				? a.recordMeta
																						.map(
																							([
																								k,
																								v,
																							]) =>
																								`${k} ${v}`,
																						)
																						.join(
																							" · ",
																						)
																				: a
																							.metrics
																							.length >
																					  0
																					? a.metrics
																							.map(
																								([
																									k,
																									v,
																								]) =>
																									`${k} ${v}`,
																							)
																							.join(
																								" · ",
																							)
																					: "Completed"}
																</td>
																<td className="px-2 py-1.5 whitespace-nowrap text-right text-slate-400">
																	{fmtDuration(
																		a.startMs,
																		a.endMs,
																	)}
																</td>
															</tr>
														);
													})}
												</tbody>
											</table>
										)}
									</div>
								);
							})}
							{!selectedRun && (
								<div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-slate-500">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										className="h-10 w-10 opacity-40"
									>
										<rect
											x="3"
											y="4"
											width="18"
											height="16"
											rx="2"
										/>
										<path d="M3 9h18M8 14h8M8 17h5" />
									</svg>
									<p className="text-sm">
										Select an integration to view its
										activity.
									</p>
								</div>
							)}
							{selectedRun && navActivities.length === 0 && (
								<EmptyHint
									label={
										searchLower
											? `No results for "${search.trim()}"`
											: errorsOnly
												? "No errors in this integration."
												: "No records to show."
									}
								/>
							)}
						</div>
					</section>

					{/* Inspector height handle */}
					<DragHandle
						orientation="row"
						onStart={() => (dragBase.current = inspectorHeight)}
						onDelta={(d) =>
							setInspectorHeight(
								clamp(dragBase.current - d, 120, 640),
							)
						}
					/>

					{/* Record inspector */}
					<div
						ref={inspectorRef}
						style={{ height: inspectorHeight }}
						className="flex shrink-0 min-h-0"
					>
						{requestCollapsed ? (
							<CollapsedRail
								title="Request"
								onExpand={() => togglePanel("Request")}
							/>
						) : (
							<section
								style={{
									flexGrow: panelPct.request,
									flexBasis: 0,
								}}
								className={`flex flex-col min-w-0 min-h-0 ${card}`}
							>
								<PanelTitle
									title="Request"
									onCollapse={() => togglePanel("Request")}
								/>
								{selectedActivity ? (
									<div className="flex-1 overflow-auto">
										{selectedActivity.method && (
											<div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/50 text-xs">
												<span className="rounded-md bg-blue-500/10 text-blue-400 px-2 py-0.5 font-semibold font-mono">
													{selectedActivity.method}
												</span>
												<span
													className="truncate text-slate-400 font-mono"
													title={selectedActivity.url}
												>
													{selectedActivity.url?.replace(
														/^https?:\/\//,
														"",
													)}
												</span>
											</div>
										)}
										{fieldRows.length > 0 ? (
											<table className="w-full text-xs">
												<tbody>
													{fieldRows.map(
														([k, v], i) => (
															<tr
																key={`${k}-${i}`}
																className="border-b border-slate-700/40 last:border-0"
															>
																<td className="px-4 py-1.5 font-medium text-slate-400 whitespace-nowrap align-top">
																	{k}
																</td>
																<td className="px-3 py-1.5 break-all font-mono text-slate-200">
																	{v}
																</td>
															</tr>
														),
													)}
												</tbody>
											</table>
										) : (
											<p className="px-4 py-3 text-slate-400 text-xs">
												No request fields.
											</p>
										)}
									</div>
								) : (
									<EmptyHint label="Select a record to inspect its request." />
								)}
							</section>
						)}
						{!requestCollapsed && (
							<DragHandle
								orientation="col"
								onStart={() =>
									(dragBase.current = panelPct.request)
								}
								onDelta={(d) => resizePanel("request", d)}
							/>
						)}
						{requestCollapsed && <div className="w-3 shrink-0" />}

						{bodyCollapsed ? (
							<CollapsedRail
								title={bodyTitle}
								onExpand={() => togglePanel("Body")}
							/>
						) : (
							<section
								style={{
									flexGrow: panelPct.body,
									flexBasis: 0,
								}}
								className={`flex flex-col min-w-0 min-h-0 ${card}`}
							>
								<PanelTitle
									title={bodyTitle}
									onCollapse={() => togglePanel("Body")}
								/>
								{selectedActivity?.sql ? (
									<SqlView sql={selectedActivity.sql} />
								) : selectedActivity ? (
									<pre className="flex-1 overflow-auto px-4 py-3 text-xs font-mono text-slate-200 whitespace-pre-wrap">
										{selectedActivity.bodyRaw}
									</pre>
								) : (
									<EmptyHint label="Select a record to view its payload." />
								)}
							</section>
						)}
						{!bodyCollapsed && (
							<DragHandle
								orientation="col"
								onStart={() =>
									(dragBase.current = panelPct.body)
								}
								onDelta={(d) => resizePanel("body", d)}
							/>
						)}
						{bodyCollapsed && <div className="w-3 shrink-0" />}

						{responseCollapsed ? (
							<CollapsedRail
								title="Response"
								onExpand={() => togglePanel("Response")}
							/>
						) : (
							<section
								style={{
									flexGrow: panelPct.response,
									flexBasis: 0,
								}}
								className={`flex flex-col min-w-0 min-h-0 ${card}`}
							>
								<PanelTitle
									title="Response"
									onCollapse={() => togglePanel("Response")}
								/>
								{selectedActivity ? (
									<div className="flex-1 overflow-auto px-4 py-3 space-y-3">
										<div className="flex items-center gap-2 flex-wrap">
											<StatusPill
												ok={
													selectedActivity.status ===
													"Succeeded"
												}
												label={selectedActivity.status}
											/>
											{selectedActivity.httpStatus && (
												<HttpStatusPill
													code={
														selectedActivity.httpStatus
													}
												/>
											)}
											{selectedActivity.metrics.map(
												([k, v]) => (
													<span
														key={k}
														className="rounded-full bg-slate-700/60 px-2.5 py-0.5 text-xs text-slate-300"
													>
														{k}{" "}
														<b className="text-slate-100">
															{v}
														</b>
													</span>
												),
											)}
										</div>
										{selectedActivity.errorMessages.length >
											0 && (
											<ul className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 space-y-1">
												{selectedActivity.errorMessages.map(
													(m, i) => (
														<li
															key={i}
															className="text-xs text-red-400 font-medium"
														>
															{m}
														</li>
													),
												)}
											</ul>
										)}
										{selectedActivity.outputRaw && (
											<pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">
												{selectedActivity.outputRaw}
											</pre>
										)}
										{!selectedActivity.outputRaw &&
											selectedActivity.errorMessages
												.length === 0 && (
												<p className="text-xs text-slate-400">
													No response payload.
												</p>
											)}
									</div>
								) : (
									<EmptyHint label="Select a record to view its response." />
								)}
							</section>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
