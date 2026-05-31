import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { gzipSync, gunzipSync } from "node:zlib";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

export async function uploadToR2(
  key: string,
  body: string | Buffer,
  contentType: string,
  options?: { compress?: boolean },
): Promise<void> {
  let finalBody: string | Buffer = body;
  let contentEncoding: string | undefined;
  // gzip only text (HTML) — never PNG/PDF which are already compressed.
  if (options?.compress) {
    finalBody = gzipSync(typeof body === "string" ? Buffer.from(body, "utf-8") : body);
    contentEncoding = "gzip";
  }
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: finalBody,
      ContentType: contentType,
      ContentEncoding: contentEncoding,
    }),
  );
}

export async function getFromR2(key: string): Promise<string> {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 object not found: ${key}`);
  const buf = Buffer.from(await res.Body.transformToByteArray());
  // Snapshots stored before the gzip patch have no ContentEncoding → read as-is.
  if (res.ContentEncoding === "gzip") return gunzipSync(buf).toString("utf-8");
  return buf.toString("utf-8");
}

export async function getBytesFromR2(key: string): Promise<Uint8Array> {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 object not found: ${key}`);
  return await res.Body.transformToByteArray();
}
