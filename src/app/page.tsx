"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  Notebook,
  Upload,
  FileText,
  FileAudio,
  Mic,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
} from "lucide-react";

/**
 * Minutes Studio — AI議事録生成ツール
 * Theme: "studio" ambience (dark, modern), but brand for minutes (no music logos)
 * 新しい仕様:
 *  - 文字起こしテキストファイル（.txt）をアップロード
 *  - 過去の議事録から学習したAIが議事録を生成
 *  - Word / HTML 出力対応
 *  - PC/スマホ両対応
 */

// ---------------------------
// UI Primitives (Tailwind)
// ---------------------------
function Card({ className = "", children }: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

function Pill({ tone = "info", children }: React.PropsWithChildren<{ tone?: "info" | "ok" | "warn" }>) {
  const styles = {
    info: "bg-cyan-500/10 text-cyan-200 ring-1 ring-cyan-400/20",
    ok: "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-400/20",
    warn: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-400/20",
  } as const;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${styles[tone]}`}>{children}</span>;
}

function Button({
  children,
  onClick,
  icon: Icon,
  variant = "primary",
  disabled,
}: React.PropsWithChildren<{ onClick?: () => void; icon?: any; variant?: "primary" | "ghost"; disabled?: boolean }>) {
  const base = "group inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition-all duration-200";
  const styles =
    variant === "primary"
      ? "bg-gradient-to-br from-cyan-500 to-indigo-600 text-white hover:brightness-110 disabled:opacity-50"
      : "bg-white/5 text-white/80 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50";
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {Icon ? <Icon className="h-4 w-4 opacity-80 group-hover:opacity-100" /> : null}
      <span>{children}</span>
    </button>
  );
}

// ---------------------------
// Header (brand switched to minutes)
// ---------------------------
function Header() {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="absolute -inset-2 rounded-2xl bg-gradient-to-br from-cyan-500/30 to-indigo-500/30 blur-xl" />
          <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-black/40 ring-1 ring-white/10">
            <Notebook className="h-6 w-6 text-white/90" />
          </div>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Minutes Studio</h1>
          <p className="text-xs text-white/60">AI議事録生成ツール</p>
        </div>
      </div>
      <div className="hidden md:flex items-center gap-2 text-xs text-white/60">
        <Pill tone="info"><Mic className="h-3.5 w-3.5" /> 音声から自動要約</Pill>
        <Pill tone="ok"><CheckCircle2 className="h-3.5 w-3.5" /> TXT / HTML</Pill>
      </div>
    </div>
  );
}

// ---------------------------
// Upload Area (文字起こしテキストファイル)
// ---------------------------
function UploadArea({ onTextContent, onStyleFiles }: { onTextContent: (content: string) => void; onStyleFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [textContent, setTextContent] = useState<string>("");

  async function handleFileUpload(files: File[]) {
    for (const file of files) {
      if (file.type === "text/plain" || file.name.endsWith('.txt')) {
        try {
          const content = await file.text();
          setTextContent(content);
          onTextContent(content);
        } catch (error) {
          console.error('ファイル読み込みエラー:', error);
        }
      }
    }
  }

  return (
    <Card>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          const files = Array.from(e.dataTransfer.files || []);
          if (files.length) handleFileUpload(files);
        }}
        className={`relative grid place-items-center rounded-2xl px-6 py-14 transition ${over ? "ring-2 ring-cyan-400/50 bg-white/10" : "ring-1 ring-white/10 bg-white/5"}`}
      >
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.12),transparent_50%),radial-gradient(ellipse_at_bottom,rgba(79,70,229,0.12),transparent_50%)]" />
        <div className="relative z-10 flex flex-col items-center gap-4 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-black/40 ring-1 ring-white/10">
            <FileText className="h-6 w-6 text-white/80" />
          </div>
          <div className="space-y-1">
            <p className="text-white/90">
              ここに文字起こしテキストファイルをドラッグ＆ドロップ
              <span className="mx-2 text-white/50">または</span>
              <button
                onClick={() => inputRef.current?.click()}
                className="underline decoration-cyan-400/60 underline-offset-4 hover:decoration-cyan-300"
              >ファイルを選択</button>
            </p>
            <p className="text-xs text-white/60">
              対応形式：.txt ファイル（UTF-8エンコーディング推奨）
            </p>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) handleFileUpload(files);
            e.currentTarget.value = "";
          }}
        />
        {textContent && (
          <div className="absolute top-3 right-3 text-[10px] text-white/60">
            テキスト読み込み済み: {textContent.length}文字
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------
// Main component
// ---------------------------
export default function MinutesStudioMock() {
  const [transcript, setTranscript] = useState<string>("");
  const [styleFiles, setStyleFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [summary, setSummary] = useState<string>("");
  const [generatedMinutes, setGeneratedMinutes] = useState<string>("");

  async function processWithAI() {
    if (!transcript.trim()) return;
    setStatus("processing");
    setSummary("");
    setGeneratedMinutes("");
    
    try {
      const formData = new FormData();
      formData.append("transcript", transcript);
      for (const styleFile of styleFiles) {
        formData.append("style", styleFile);
      }
      
      const res = await fetch("/api/minutes", { 
        method: "POST", 
        body: formData 
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSummary(data.summary || "");
      setGeneratedMinutes(data.minutes || "");
      setStatus("done");
    } catch (e) {
      setSummary("処理中にエラーが発生しました。");
      setStatus("done");
    }
  }

  function exportText() {
    const content = `${summary ? `要約\n${summary}\n\n` : ""}議事録本文\n${generatedMinutes || ""}`;
    downloadFile(
      new Blob([content], { type: "text/plain;charset=utf-8" }), 
      `minutes_${Date.now()}.txt`
    );
  }

  function exportHTML() {
    const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Minutes Studio — 議事録</title><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,\"Noto Sans JP\",\"Hiragino Kaku Gothic ProN\",Meiryo,sans-serif;line-height:1.7;padding:40px;max-width:900px;margin:auto">`+
      `<h1>議事録（AI生成）</h1>`+
      `<h3>要約</h3><p>${escapeHtml(summary || "（未作成）")}</p>`+
      `<h3>議事録本文</h3><pre style="white-space:pre-wrap">${escapeHtml(generatedMinutes || "（未作成）")}</pre>`+
      `</body></html>`;
    downloadFile(new Blob([html], { type: "text/html;charset=utf-8" }), `minutes_${Date.now()}.html`);
  }

  return (
    <div className="min-h-[100dvh] bg-black text-white">
      <div className="relative mx-auto w-full max-w-6xl px-6 py-8">
        <Header />

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <UploadArea onTextContent={(content) => setTranscript(content)} onStyleFiles={(files) => setStyleFiles(files)} />

            {/* Style samples (optional) */}
            <Card>
              <div className="p-5">
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <FileText className="h-4 w-4" />
                  <span>過去の議事録ファイル（任意・.docx / .txt / .md / .html）</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input
                    type="file"
                    multiple
                    accept=".docx,.txt,.md,.html,.htm"
                    className="text-xs"
                    onChange={(e) => setStyleFiles(Array.from(e.target.files || []))}
                  />
                  {styleFiles.length > 0 && (
                    <span className="text-xs text-white/60">{styleFiles.length} 件を使用して文体を合わせます</span>
                  )}
                </div>
              </div>
            </Card>

            {/* Text content preview */}
            {transcript && (
              <Card className="p-5">
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <FileText className="h-4 w-4" />
                  <span>読み込み済みテキスト</span>
                </div>
                <div className="mt-3 p-3 bg-white/5 rounded-lg">
                  <p className="text-xs text-white/60 mb-2">プレビュー（最初の200文字）:</p>
                  <p className="text-sm text-white/80 whitespace-pre-wrap">
                    {transcript.length > 200 ? transcript.slice(0, 200) + "..." : transcript}
                  </p>
                  <p className="text-xs text-white/50 mt-2">総文字数: {transcript.length}文字</p>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button 
                    icon={FileText} 
                    variant="ghost" 
                    onClick={() => {
                      navigator.clipboard.writeText(generatedMinutes).then(() => {
                        // コピー成功のフィードバック（オプション）
                        console.log('議事録本文をクリップボードにコピーしました');
                      }).catch(err => {
                        console.error('コピーに失敗しました:', err);
                      });
                    }}
                    disabled={!generatedMinutes}
                  >
                    コピー
                  </Button>
                  <Button icon={FileText} variant="ghost" onClick={exportHTML} disabled={status === "processing"}>
                    HTMLとして保存
                  </Button>
                  <Button icon={FileText} variant="ghost" onClick={exportText} disabled={status === "processing"}>
                    TXTとして保存
                  </Button>
                  <Button icon={Notebook} onClick={processWithAI} disabled={!transcript.trim() || status === "processing"}>
                    {status === "processing" ? (
                      <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> 生成中…</span>
                    ) : (
                      <span>AIで議事録を作成</span>
                    )}
                  </Button>
                </div>
              </Card>
            )}

            {/* Results */}
            {status !== "idle" && (
              <div className="space-y-6">
                <Card className="p-5">
                  <div className="mb-2 flex items-center gap-2 text-sm text-white/70">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>要約</span>
                  </div>
                  <p className="text-white/90">{summary || "（生成を待機中）"}</p>
                </Card>
                <Card className="p-5">
                  <div className="mb-2 flex items-center gap-2 text-sm text-white/70">
                    <FileText className="h-4 w-4" />
                    <span>議事録本文</span>
                  </div>
                  <pre className="whitespace-pre-wrap text-white/90">{generatedMinutes || "（生成を待機中）"}</pre>
                </Card>
              </div>
            )}
          </div>

          {/* Right rail: guidance */}
          <div className="space-y-6">
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2 text-white/80">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">利用ガイド</span>
              </div>
              <ul className="list-disc space-y-2 pl-5 text-sm text-white/70">
                <li>文字起こしテキストファイル（.txt）をアップロードしてください。</li>
                <li>過去の議事録ファイルを追加すると、AIが文体を学習します。</li>
                <li>「AIで議事録を作成」を押すと要約と本文が生成されます。</li>
                <li>生成後は テキスト(.txt) または HTML で保存できます。</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------
// Helpers
// ---------------------------
function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(str: string) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
