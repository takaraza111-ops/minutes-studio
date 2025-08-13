import { NextRequest } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getS3() {
  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !bucket || !accessKeyId || !secretAccessKey) return null;
  const client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  return { client, bucket } as const;
}

export async function POST(req: NextRequest) {
  const s3 = getS3();
  if (!s3) {
    return new Response(JSON.stringify({ error: "S3 is not configured" }), { status: 400 });
  }
  const body = await req.json();
  const { filename, contentType } = body as { filename: string; contentType?: string };
  if (!filename) return new Response(JSON.stringify({ error: "filename required" }), { status: 400 });

  const ext = filename.split(".").pop() || "bin";
  const key = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const cmd = new PutObjectCommand({ Bucket: s3.bucket, Key: key, ContentType: contentType || "application/octet-stream" });
  const url = await getSignedUrl(s3.client, cmd, { expiresIn: 60 * 10 });
  return new Response(JSON.stringify({ url, key }), { status: 200, headers: { "content-type": "application/json" } });
}


