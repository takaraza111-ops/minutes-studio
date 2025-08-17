import { NextRequest } from "next/server";
import OpenAI from "openai";
import mammoth from "mammoth";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MinutesResult = {
  transcript: string;
  summary: string;
  minutes: string;
};

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function loadPrompt(): string {
  try {
    const promptPath = join(process.cwd(), "prompts", "meeting-minutes.txt");
    const prompt = readFileSync(promptPath, "utf-8");
    return prompt;
  } catch (error) {
    console.error("プロンプトファイルの読み込みエラー:", error);
    // フォールバック用のデフォルトプロンプト
    return "あなたは日本語の議事録作成アシスタントです。入力された文字起こしテキストから、要約と議事録本文を作成してください。";
  }
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

async function summarize(openai: OpenAI | null, transcript: string, styleGuidelines: string): Promise<MinutesResult> {
  if (!openai) {
    // fallback mock
    return {
      transcript: transcript || "【モック転記】AIキー未設定のためダミー本文。",
      summary: "【モック要約】主要論点と次回アクションを整理しました。",
      minutes: "【モック議事録】AIキー未設定のためダミー本文。",
    };
  }

  // 外部プロンプトファイルを読み込み
  const externalPrompt = loadPrompt();
  
  const system = [
    externalPrompt,
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
    return { 
      transcript: transcript, 
      summary: parsed.summary ?? "",
      minutes: parsed.minutes ?? ""  // 議事録本文を追加
    };
  } catch {
    return { 
      transcript: transcript, 
      summary: "要約の解析に失敗しました。",
      minutes: "議事録本文の解析に失敗しました。"
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    console.log("=== /api/minutes 開始 ===");
    
    const form = await req.formData();
    const transcript = form.get("transcript") as string;
    const styleFiles = form.getAll("style").filter((v): v is File => v instanceof File);

    console.log("transcript length:", transcript?.length);
    console.log("styleFiles count:", styleFiles.length);

    if (!transcript || !transcript.trim()) {
      console.log("エラー: 文字起こしテキストが不足");
      return new Response(
        JSON.stringify({ error: "文字起こしテキストが必要です" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    console.log("OpenAI 初期化開始");
    const openai = getOpenAI();
    console.log("OpenAI 初期化完了:", !!openai);

    console.log("スタイルファイル読み込み開始");
    const styleCorpus = await readStyleFiles(styleFiles);
    console.log("スタイルファイル読み込み完了, 長さ:", styleCorpus.length);

    console.log("スタイルガイドライン生成開始");
    const styleGuidelines = await buildStyleGuidelines(openai, styleCorpus);
    console.log("スタイルガイドライン生成完了, 長さ:", styleGuidelines.length);

    console.log("議事録生成開始");
    const result = await summarize(openai, transcript, styleGuidelines);
    console.log("議事録生成完了");
    console.log("要約長さ:", result.summary.length);
    console.log("議事録本文長さ:", result.minutes.length);

    console.log("=== /api/minutes 成功 ===");
    return new Response(
      JSON.stringify({
        transcript: result.transcript,
        summary: result.summary,
        minutes: result.minutes, // 議事録本文を正しく返す
        styleGuidelines,
        usedAI: Boolean(openai),
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    console.error("=== /api/minutes エラー ===");
    console.error("エラータイプ:", e.constructor.name);
    console.error("エラーメッセージ:", e.message);
    console.error("エラースタック:", e.stack);
    console.error("エラー詳細:", e);
    
    return new Response(
      JSON.stringify({ 
        error: e?.message || "Unknown error",
        details: e?.stack || "No stack trace"
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}


