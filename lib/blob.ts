import { BlobServiceClient } from "@azure/storage-blob";

const account = process.env.STORAGE_ACCOUNT_NAME!;
const sas = process.env.STORAGE_ACCOUNT_SAS_URL!;

function getServiceClient(): BlobServiceClient {
  return new BlobServiceClient(`https://${account}.blob.core.windows.net/?${sas}`);
}

export function isBlobConfigured(): boolean {
  return account.length > 0 && sas.length > 0;
}

/** Returns available day strings sorted newest-first, e.g. ["2026-06-12", "2026-06-11"] */
export async function listAvailableDays(): Promise<string[]> {
  const container = getServiceClient().getContainerClient("adf-logs");
  const days: string[] = [];
  for await (const blob of container.listBlobsFlat()) {
    const m = blob.name.match(/^(\d{4}-\d{2}-\d{2})\.csv$/);
    if (m) days.push(m[1]);
  }
  return days.sort((a, b) => b.localeCompare(a));
}

/** Downloads the CSV text for a given day from blob storage */
export async function loadDayCsv(day: string): Promise<string> {
  const container = getServiceClient().getContainerClient("adf-logs");
  const blob = container.getBlobClient(`${day}.csv`);
  const download = await blob.download();
  const stream = download.readableStreamBody;
  if (!stream) throw new Error(`Empty blob for day ${day}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
