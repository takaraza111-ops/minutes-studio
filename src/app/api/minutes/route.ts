import { NextRequest } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import mammoth from "mammoth";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MinutesResult = {
  transcript: string;
  summary: string;
};

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

async function readStyleFiles(styleFiles: File[]): Promise<string> {
  const chunks: string[] = [];
  for (const f of styleFiles) {
    const name = f.name.toLowerCase();
    const buf = Buffer.from(await f.arrayBuffer());
    if (name.endsWith(".docx")) {
      try {
        const { value } = await mammoth.extractRawText({ buffer: buf });
        if (value) chunks.push(value);
      } catch {}
    } else if (name.endsWith(".txt") || name.endsWith(".md")) {
      chunks.push(buf.toString("utf8"));
    } else if (name.endsWith(".html") || name.endsWith(".htm")) {
      const text = buf
        .toString("utf8")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      chunks.push(text);
    }
  }
  return chunks.join("\n\n");
}

async function readFromS3Key(key: string): Promise<Buffer | null> {
  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !bucket || !accessKeyId || !secretAccessKey) return null;
  const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stream = obj.Body as any as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function buildStyleGuidelines(openai: OpenAI | null, corpus: string): Promise<string> {
  if (!corpus || corpus.length < 200) return "";
  if (!openai) {
    return ""; // fallback: no special style when no API key
  }
  const prompt = `以下は過去の議事録の一部です。文体・言い回し・構成上の特徴を抽出し、今後の生成に使える日本語ガイドラインを箇条書きで10項目前後に要約してください。\n\n---\n${corpus.slice(0, 15000)}\n---`;
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: "あなたはプロのテクニカルライターです。文章スタイルを抽出し、具体的で再現可能な指針にまとめます。" },
      { role: "user", content: prompt },
    ],
  });
  return resp.choices[0]?.message?.content ?? "";
}

async function transcribeAll(openai: OpenAI | null, audioFiles: File[]): Promise<string> {
  if (!audioFiles.length) return "";
  if (!openai) {
    // No API key -> return mock transcript
    return "【モック転記】AIキー未設定のためダミーの議事録本文です。";
  }
  const pieces: string[] = [];
  for (const f of audioFiles) {
    const ofile = await toFile(Buffer.from(await f.arrayBuffer()), f.name, { type: f.type || "audio/mpeg" });
    try {
      const resp = await openai.audio.transcriptions.create({
        file: ofile as any,
        model: "gpt-4o-transcribe",
        // fallback handled by API
      });
      pieces.push(resp.text || "");
    } catch (e) {
      // try whisper-1 as fallback
      try {
        const resp2 = await openai.audio.transcriptions.create({
          file: ofile as any,
          model: "whisper-1",
        });
        pieces.push(resp2.text || "");
      } catch {
        pieces.push("");
      }
    }
  }
  return pieces.filter(Boolean).join("\n\n");
}

async function summarize(openai: OpenAI | null, transcript: string, styleGuidelines: string): Promise<MinutesResult> {
  if (!openai) {
    // fallback mock
    return {
      transcript: transcript || "【モック転記】AIキー未設定のためダミー本文。",
      summary: "【モック要約】主要論点と次回アクションを整理しました。",
    };
  }

  const system = [
    "あなたは日本語の議事録作成アシスタントです。",
    "正確・簡潔・箇条書きを基本とし、見出しと段落を適切に整形します。",
    styleGuidelines ? `以下のスタイル指針に合わせて記述してください:\n${styleGuidelines}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "MinutesSchema",
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            minutes: { type: "string" },
          },
          required: ["summary", "minutes"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          "次の書き起こしから議事録を作成してください。要約は段落1つ、本文は見出し・箇条書き中心で。\n\n" +
          transcript.slice(0, 120000),
      },
    ],
  });

  const content = resp.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content);
    return { transcript, summary: parsed.summary ?? "", } as MinutesResult & { summary: string } & { transcript: string } & { minutes: string };
  } catch {
    return { transcript, summary: "要約の解析に失敗しました。", } as MinutesResult;
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let audioFiles: File[] = [];
    let styleFiles: File[] = [];
    let s3AudioKeys: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      audioFiles = form.getAll("audio").filter((v): v is File => v instanceof File);
      styleFiles = form.getAll("style").filter((v): v is File => v instanceof File);
      s3AudioKeys = form.getAll("s3Key").filter((v): v is string => typeof v === "string") as string[];
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      s3AudioKeys = (body?.s3Keys || []) as string[];
    }

    const openai = getOpenAI();

    let transcriptFromUploads = await transcribeAll(openai, audioFiles);

    if (s3AudioKeys.length) {
      for (const key of s3AudioKeys) {
        const buf = await readFromS3Key(key);
        if (!buf) continue;
        const fakeFile = new File([buf], key.split("/").pop() || "audio.mp3", { type: "audio/mpeg" });
        transcriptFromUploads += "\n\n" + (await transcribeAll(openai, [fakeFile]));
      }
    }

    const styleCorpus = await readStyleFiles(styleFiles);

    const styleGuidelines = await buildStyleGuidelines(openai, styleCorpus);
    const result = await summarize(openai, transcript, styleGuidelines);

    return new Response(
      JSON.stringify({
        transcript: result.transcript || transcriptFromUploads,
        summary: result.summary,
        styleGuidelines,
        usedAI: Boolean(openai),
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "Unknown error" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}


