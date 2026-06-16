export type ActivityStatus = "Succeeded" | "Failed" | string;

export interface ActivityRun {
  id: string;
  pipelineName: string;
  activityName: string;
  activityType: string;
  status: ActivityStatus;
  /** HTTP method + URL for WebActivity requests */
  method?: string;
  url?: string;
  /** Request body (WebActivity) or the full input for other activity types. Secrets stripped. */
  body: unknown;
  /** Pretty-printed body — for SQL activities this is the SQL text itself */
  bodyRaw: string;
  /** Set when the activity's payload is a SQL script (Script text / Lookup reader query) */
  sql: string | null;
  /** HTTP status code from the response, e.g. "200" / "422" */
  httpStatus?: string;
  /** Small numeric facts worth showing as chips, e.g. [["processed","1"],["creates","0"]] */
  metrics: [string, string][];
  /** Human-readable error messages extracted from the response */
  errorMessages: string[];
  /** Curated record-identifying fields pulled from the request body (WebActivity),
   *  shown in place of the raw API response. e.g. [["Equipment ID","25-2500641.-0025"]] */
  recordMeta: [string, string][];
  /** Shared identity (equipment_id / material name / company_supplied_id …) used to
   *  group an integration's related steps under one record. undefined when not groupable. */
  recordKey?: string;
  /** Response payload with ADF billing/header noise removed */
  output: unknown;
  outputRaw: string;
  startMs: number;
  endMs: number;
}

/** Activities grouped within a run — either by activity name (e.g. 84 "Upload materials"
 *  calls) or, for multi-step integrations, by record identity (the create/assign/price
 *  operations for one equipment_id collapsed under that id). */
export interface ActivityGroup {
  name: string;
  activityType: string;
  activities: ActivityRun[];
  errorCount: number;
  /** True when `name` is a record identity and `activities` are that record's steps. */
  isRecordGroup?: boolean;
}

/** One top-level integration: a MASTER ExecutePipeline call and the child pipeline's activities */
export interface IntegrationRun {
  id: string;
  /** e.g. "Materials" */
  name: string;
  /** e.g. "TESTING - Materials Pipeline" */
  childPipeline: string;
  status: ActivityStatus;
  startMs: number;
  endMs: number;
  records: number;
  successCount: number;
  errorCount: number;
  groups: ActivityGroup[];
}

export interface DashboardData {
  generatedFrom: string;
  totalActivities: number;
  totalErrors: number;
  runs: IntegrationRun[];
  /** Blob days available for the picker, e.g. ["2026-06-12", "2026-06-11"] — empty when using local CSV */
  availableDays: string[];
  /** The day currently being viewed, null when showing local file */
  currentDay: string | null;
}
