import { BlobServiceClient } from "@azure/storage-blob";
import { storageCredential } from "./adf";

const account = process.env.STORAGE_ACCOUNT_NAME!;
const sas = process.env.STORAGE_ACCOUNT_SAS_URL!;
const CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? "adf-logs";

/** Each day's CSV is written once and never changes, so day content is cached
 *  forever. Only the *list* of days changes (a new blob appears once a day), so
 *  it gets a short TTL to pick up a new day without re-listing on every request. */
const DAY_LIST_TTL_MS = 300_000;

function getServiceClient(): BlobServiceClient {
  return new BlobServiceClient(`https://${account}.blob.core.windows.net/?${sas}`);
}

export function isBlobConfigured(): boolean {
  return account.length > 0 && sas.length > 0;
}

let dayListCache: { days: string[]; ts: number } | null = null;

/** Returns available day strings sorted newest-first, e.g. ["2026-06-12", "2026-06-11"] */
export async function listAvailableDays(): Promise<string[]> {
  if (dayListCache && Date.now() - dayListCache.ts < DAY_LIST_TTL_MS) {
    return dayListCache.days;
  }
  const container = getServiceClient().getContainerClient(CONTAINER);
  const days: string[] = [];
  for await (const blob of container.listBlobsFlat()) {
    const m = blob.name.match(/^(\d{4}-\d{2}-\d{2})\.csv$/);
    if (m) days.push(m[1]);
  }
  days.sort((a, b) => b.localeCompare(a));
  dayListCache = { days, ts: Date.now() };
  return days;
}

const csvCache = new Map<string, string>();

/** Downloads the CSV text for a given day. Each day's blob is written once and
 *  never changes, so once fetched it is cached for the life of the process. */
export async function loadDayCsv(day: string): Promise<string> {
  const cached = csvCache.get(day);
  if (cached !== undefined) return cached;

  const container = getServiceClient().getContainerClient(CONTAINER);
  const blob = container.getBlobClient(`${day}.csv`);
  const download = await blob.download();
  const stream = download.readableStreamBody;
  if (!stream) throw new Error(`Empty blob for day ${day}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  csvCache.set(day, text);
  return text;
}

/** Run-log blob name shape: "{pipeline}/{date}_{HHMM}.csv" (the per-run captures). */
const RUN_LOG_NAME = /^[^/]+\/\d{4}-\d{2}-\d{2}_\d{4}\.csv$/;

/** List saved per-run log blob names, newest first. Excludes the root daily CSVs. */
export async function listRunLogs(): Promise<string[]> {
  const container = getServiceClient().getContainerClient(CONTAINER);
  const names: string[] = [];
  for await (const blob of container.listBlobsFlat()) {
    if (RUN_LOG_NAME.test(blob.name)) names.push(blob.name);
  }
  // Names embed date_HHMM, so a plain descending sort is newest-first per pipeline.
  names.sort((a, b) => b.localeCompare(a));
  return names;
}

/** Download a blob's text by its full name (e.g. a run-log path). */
export async function loadBlobText(name: string): Promise<string> {
  const blob = getServiceClient().getContainerClient(CONTAINER).getBlobClient(name);
  const download = await blob.download();
  const stream = download.readableStreamBody;
  if (!stream) throw new Error(`Empty blob ${name}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Write a CSV blob (e.g. "MyPipeline/2026-06-30_0802.csv") using the service
 *  principal — needs the "Storage Blob Data Contributor" role on the account. */
export async function uploadCsv(blobName: string, text: string): Promise<void> {
  const client = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    storageCredential(),
  );
  const blob = client.getContainerClient(CONTAINER).getBlockBlobClient(blobName);
  await blob.upload(text, Buffer.byteLength(text), {
    blobHTTPHeaders: { blobContentType: "text/csv" },
  });
}
