import type { AccessToken, TokenCredential } from "@azure/core-auth";

const {
  AZURE_TENANT_ID: tenant,
  AZURE_CLIENT_ID: clientId,
  AZURE_CLIENT_SECRET: clientSecret,
  AZURE_SUBSCRIPTION_ID: subscription,
  ADF_RESOURCE_GROUP: resourceGroup,
  ADF_FACTORY_NAME: factory,
} = process.env;

const MGMT_SCOPE = "https://management.azure.com/.default";

export function isAdfConfigured(): boolean {
  return Boolean(
    tenant && clientId && clientSecret && subscription && resourceGroup && factory,
  );
}

/** Base ARM URL for this factory; append e.g. `/pipelines/x/createRun`. */
export function factoryUrl(path: string): string {
  return (
    `https://management.azure.com/subscriptions/${subscription}` +
    `/resourceGroups/${resourceGroup}/providers/Microsoft.DataFactory` +
    `/factories/${factory}${path}`
  );
}

// ponytail: fresh token per call. Triggers/polls are low-volume; add caching only
// if AAD throttling or latency shows up.
async function getAccessToken(scope: string): Promise<AccessToken> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId!,
      client_secret: clientSecret!,
      scope,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status})`);
  const j = await res.json();
  return { token: j.access_token, expiresOnTimestamp: Date.now() + (j.expires_in ?? 3600) * 1000 };
}

export async function getToken(scope = MGMT_SCOPE): Promise<string> {
  return (await getAccessToken(scope)).token;
}

/** TokenCredential for the storage SDK, backed by the same service principal.
 *  SP needs the "Storage Blob Data Contributor" role to write blobs. */
export function storageCredential(): TokenCredential {
  return { getToken: () => getAccessToken("https://storage.azure.com/.default") };
}

export interface ActivityRunRow {
  pipelineName: string;
  activityName: string;
  activityType: string;
  input: unknown;
  output: unknown;
  status: string;
  /** ISO UTC, e.g. "2026-06-30T12:02:17.123Z" */
  activityRunStart: string;
  activityRunEnd: string;
}

/** Live activity runs for a pipeline run, straight from ADF monitoring (no Log
 *  Analytics ingestion lag). The runId path scopes the result; the time window is
 *  required by the API but ground-truth filtering is the runId. */
export async function queryActivityRuns(runId: string): Promise<ActivityRunRow[]> {
  const token = await getToken();
  const now = Date.now();
  const res = await fetch(
    factoryUrl(`/pipelineruns/${encodeURIComponent(runId)}/queryActivityruns?api-version=2018-06-01`),
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        // ponytail: 2-day lookback covers any run viewed soon after triggering.
        lastUpdatedAfter: new Date(now - 2 * 86400_000).toISOString(),
        lastUpdatedBefore: new Date(now + 3600_000).toISOString(),
      }),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message ?? `queryActivityruns failed (${res.status})`);
  }
  return payload.value ?? [];
}
