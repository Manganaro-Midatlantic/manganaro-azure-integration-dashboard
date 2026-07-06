import type React from "react";

export const card =
	"bg-slate-800/40 rounded-2xl border border-slate-700/40 shadow-xl shadow-black/20 backdrop-blur-sm";

export function StatusDot({ ok }: { ok: boolean }) {
	return (
		<span
			className={`inline-block w-2 h-2 rounded-full shrink-0 ${
				ok ? "bg-emerald-500" : "bg-red-500"
			}`}
		/>
	);
}

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
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

export function HttpStatusPill({ code }: { code: string }) {
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
export function DragHandle({
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
export function SqlView({ sql }: { sql: string }) {
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

/** Pull SELECT result rows out of an ADF Script/Lookup activity output.
 *  Script: output.resultSets[].rows[]. Lookup: output.value[] or [output.firstRow]. */
export function resultRows(output: unknown): Record<string, unknown>[] | null {
	if (output === null || typeof output !== "object") return null;
	const o = output as Record<string, unknown>;
	const rows: Record<string, unknown>[] = [];
	if (Array.isArray(o.resultSets)) {
		for (const rs of o.resultSets) {
			const r = (rs as Record<string, unknown>)?.rows;
			if (Array.isArray(r))
				rows.push(...(r as Record<string, unknown>[]));
		}
	} else if (Array.isArray(o.value)) {
		rows.push(...(o.value as Record<string, unknown>[]));
	} else if (o.firstRow && typeof o.firstRow === "object") {
		rows.push(o.firstRow as Record<string, unknown>);
	}
	// Only meaningful when rows are flat column→value objects.
	return rows.length > 0 &&
		typeof rows[0] === "object" &&
		!Array.isArray(rows[0])
		? rows
		: null;
}

/** Renders SELECT result rows as a table (columns from the first row). */
export function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
	const cols = Object.keys(rows[0]);
	const cell = (v: unknown) =>
		v === null || v === undefined ? (
			<span className="text-slate-600 italic">null</span>
		) : typeof v === "object" ? (
			JSON.stringify(v)
		) : (
			String(v)
		);
	return (
		<div className="overflow-auto rounded-lg border border-slate-700/50">
			<table className="w-full text-xs">
				<thead>
					<tr className="bg-slate-800/60">
						{cols.map((c) => (
							<th
								key={c}
								className="px-3 py-1.5 text-left font-semibold text-slate-300 whitespace-nowrap"
							>
								{c}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						<tr key={i} className="border-t border-slate-700/40">
							{cols.map((c) => (
								<td
									key={c}
									className="px-3 py-1.5 font-mono text-slate-200 align-top"
								>
									{cell(row[c])}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** Centered placeholder shown in a panel before a record is selected */
export function EmptyHint({ label }: { label: string }) {
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
export function CollapsedRail({
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

export function PanelTitle({
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
