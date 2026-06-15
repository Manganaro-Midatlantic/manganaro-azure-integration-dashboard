"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
	ActivityGroup,
	ActivityRun,
	DashboardData,
	IntegrationRun,
} from "@/lib/types";

function fmtDate(ms: number): string {
	if (!Number.isFinite(ms)) return "—";
	return new Date(ms).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function fmtTime(ms: number): string {
	if (!Number.isFinite(ms)) return "—";
	return new Date(ms).toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		hour12: true,
	});
}

function fmtDuration(startMs: number, endMs: number): string {
	const total = Math.max(0, Math.round((endMs - startMs) / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Flatten a request body into key/value rows for the fields table */
function flatten(value: unknown, prefix = ""): [string, string][] {
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
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
				ok
					? "bg-emerald-500/10 text-emerald-400"
					: "bg-red-500/10 text-red-400"
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
			className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold font-mono ${
				ok
					? "bg-emerald-500/15 text-emerald-400"
					: "bg-red-500/15 text-red-400"
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

const card = "bg-slate-800/50 rounded-xl border border-slate-700/50";

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
			<span className="[writing-mode:vertical-rl] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
		<div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700/50">
			<span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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

export default function Dashboard({ data }: { data: DashboardData }) {
	const router = useRouter();
	// Every page load starts fresh: nothing selected, nothing expanded.
	const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
		undefined,
	);
	const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
		null,
	);
	const [errorsOnly, setErrorsOnly] = useState(false);
	const [search, setSearch] = useState("");
	const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

	// Layout: resizable + collapsible columns
	const [sidebarWidth, setSidebarWidth] = useState(320);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [inspectorHeight, setInspectorHeight] = useState(300);
	// flex-grow ratios — when a panel collapses, the others flex into its space
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

	function selectRun(run: IntegrationRun) {
		setSelectedRunId(run.id);
		setSelectedActivityId(null);
		setOpenGroups(
			new Set(
				run.groups.filter((g) => g.errorCount > 0).map((g) => g.name),
			),
		);
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
		<div className="flex flex-col h-screen bg-slate-900 text-slate-300 text-sm">
			{/* Header */}
			<header className="flex items-center gap-4 border-b border-slate-700/50 px-5 py-3">
				<div className="flex items-center gap-3">
					<div className="w-8 h-8 rounded-lg bg-blue-600 grid place-items-center text-white font-bold text-base">
						⌁
					</div>
					<div>
						<h1 className="font-semibold text-base leading-tight text-slate-100">
							Integration Dashboard
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
						className="w-72 rounded-lg border border-slate-600/60 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
					/>
					<button
						onClick={() => setErrorsOnly(!errorsOnly)}
						className={`rounded-lg px-3 py-1.5 text-sm font-medium border transition-colors ${
							errorsOnly
								? "bg-red-600 text-white border-red-600"
								: "bg-slate-800 text-slate-300 border-slate-600/60 hover:bg-slate-700"
						}`}
					>
						Errors only
					</button>
					<div className="flex items-center gap-2 pl-3 ml-1 border-l border-slate-700/50">
						<span className="rounded-full bg-slate-700/60 px-2.5 py-0.5 text-xs font-medium text-slate-300">
							{data.totalActivities} records
						</span>
						<span
							className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
								data.totalErrors > 0
									? "bg-red-500/10 text-red-400"
									: "bg-emerald-500/10 text-emerald-400"
							}`}
						>
							{data.totalErrors} errors
						</span>
					</div>
				</div>
			</header>

			{data.availableDays.length > 0 && (
				<nav className="flex items-center gap-0.5 border-b border-slate-700/50 px-4 overflow-x-auto shrink-0 bg-slate-900/80">
					{(() => {
						const recentDays = data.availableDays.slice(0, 7);
						const olderDays = data.availableDays.slice(7);
						const currentIsOlder =
							data.currentDay !== null && !recentDays.includes(data.currentDay);
						const fmtDay = (d: string) =>
							new Date(d + "T12:00:00").toLocaleDateString("en-US", {
								weekday: "short", month: "short", day: "numeric",
							});
						return (
							<>
								{currentIsOlder && (
									<>
										<button
											onClick={() => router.push(`/?day=${data.currentDay}`)}
											className="px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px border-blue-500 text-blue-400"
										>
											{fmtDay(data.currentDay!)}
										</button>
										<div className="w-px h-4 bg-slate-700 mx-1 shrink-0" />
									</>
								)}
								{recentDays.map((d) => (
									<button
										key={d}
										onClick={() => router.push(`/?day=${d}`)}
										className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
											d === data.currentDay
												? "border-blue-500 text-blue-400"
												: "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600"
										}`}
									>
										{fmtDay(d)}
									</button>
								))}
								{data.availableDays.length > 7 && (
									<>
										<div className="w-px h-4 bg-slate-700 mx-1 shrink-0" />
										<select
											value={currentIsOlder ? (data.currentDay ?? "") : ""}
											onChange={(e) =>
												e.target.value && router.push(`/?day=${e.target.value}`)
											}
											className="ml-1 rounded-md border border-slate-600/60 bg-slate-800 px-2.5 py-1 text-xs text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
										>
											<option value="">Older logs…</option>
											{olderDays.map((d) => (
												<option key={d} value={d}>{fmtDay(d)}</option>
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
												className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
													selected
														? "bg-blue-500/15 ring-1 ring-blue-400/30"
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
													{run.records} records ·{" "}
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
							className={`flex items-center gap-4 px-4 py-3 mb-3 ${card}`}
						>
							<StatusPill
								ok={selectedRun.errorCount === 0}
								label={
									selectedRun.errorCount === 0
										? "Completed"
										: "Completed with errors"
								}
							/>
							<span className="text-slate-400 truncate">
								{selectedRun.childPipeline}
							</span>
							<div className="ml-auto flex items-center gap-6">
								{[
									[
										"Records",
										selectedRun.records,
										"text-slate-100",
									],
									[
										"Success",
										selectedRun.successCount,
										"text-emerald-400",
									],
									[
										"Errors",
										selectedRun.errorCount,
										selectedRun.errorCount > 0
											? "text-red-400"
											: "text-slate-100",
									],
								].map(([label, value, color]) => (
									<div key={label} className="text-center">
										<div
											className={`text-lg font-semibold leading-tight ${color}`}
										>
											{value}
										</div>
										<div className="text-[10px] uppercase tracking-wider text-slate-400">
											{label}
										</div>
									</div>
								))}
								<div className="text-center">
									<div className="text-lg font-semibold leading-tight text-slate-100">
										{fmtDuration(
											selectedRun.startMs,
											selectedRun.endMs,
										)}
									</div>
									<div className="text-[10px] uppercase tracking-wider text-slate-400">
										Duration
									</div>
								</div>
							</div>
						</section>
					)}

					{/* Activity groups */}
					<section className={`flex-1 flex flex-col min-h-0 ${card}`}>
						<PanelTitle title="Activity Log" />
						<div className="flex-1 overflow-y-auto">
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
											<span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300">
												{group.activityType}
											</span>
											<span className="ml-auto text-xs text-slate-400">
												{list.length}
												{list.length !==
													group.activities.length &&
													` of ${group.activities.length}`}{" "}
												records
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
																onClick={() =>
																	setSelectedActivityId(
																		a.id,
																	)
																}
																className={`cursor-pointer border-t border-slate-700/40 ${
																	selected
																		? "bg-blue-500/15"
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
																<td className="px-2 py-1.5 whitespace-nowrap text-slate-400">
																	{fmtDuration(
																		a.startMs,
																		a.endMs,
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
																	className={`px-2 py-1.5 truncate max-w-md ${
																		failed
																			? "text-red-400 font-medium"
																			: "text-slate-400"
																	}`}
																>
																	{failed
																		? (a
																				.errorMessages[0] ??
																			"Failed — no error detail logged")
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
								<p className="p-4 text-slate-400">
									Select an integration within the
									integrations pane.
								</p>
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
									<p className="p-4 text-slate-400 text-xs">
										Select a record to inspect its request.
									</p>
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
								) : (
									<pre className="flex-1 overflow-auto px-4 py-3 text-xs font-mono text-slate-200 whitespace-pre-wrap">
										{selectedActivity
											? selectedActivity.bodyRaw
											: "Select a record to view its payload."}
									</pre>
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
									<p className="p-4 text-slate-400 text-xs">
										Select a record to view its response.
									</p>
								)}
							</section>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
