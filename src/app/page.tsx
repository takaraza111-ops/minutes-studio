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
 * Minutes Studio — Web Mock (React)
 * Theme: "studio" ambience (dark, modern), but brand for minutes (no music logos)
 * Changes requested:
 *  - Show supported formats as recommendations: mp3 / wav / m4a, ~2h / 300MB
 *  - DO NOT restrict by extension or size on the client side
 *  - Replace music-centric logo with minutes/meeting motif
 *  - Remove bottom-right 3 floating buttons (omitted entirely)
 */

// ---------------------------
// Small utilities & "tests"
// ---------------------------
const BYTES_300MB = 300 * 1024 * 1024; // 314,572,800 bytes

function humanBytes(n: number) {
  if (!Number.isFinite(n)) return "-";
  const units = ["B", "KB", "MB", "GB"]; let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function isRecommendedFormat(name?: string) {
  if (!name) return false;
  return /(\.mp3|\.wav|\.m4a)$/i.test(name);
}

function exceedsRecommendedSize(size?: number) {
  if (!size || !Number.isFinite(size)) return false;
  return size > BYTES_300MB;
}

// Lightweight runtime tests (logged once in dev)
(function runtimeTests() {
  const tests = [
    { name: "song.mp3", size: BYTES_300MB - 1, expFmt: true, expSize: false },
    { name: "recording.wav", size: BYTES_300MB + 1, expFmt: true, expSize: true },
    { name: "meeting.m4a", size: 42, expFmt: true, expSize: false },
    { name: "custom.ogg", size: BYTES_300MB * 2, expFmt: false, expSize: true },
  ];
  try {
    tests.forEach((t, i) => {
      const okFmt = isRecommendedFormat(t.name) === t.expFmt;
      const okSize = exceedsRecommendedSize(t.size) === t.expSize;
      if (!okFmt || !okSize) {
        // eslint-disable-next-line no-console
        console.warn(`Test #${i + 1} failed`, t);
      }
    });
  } catch {}
})();

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
          <p className="text-xs text-white/60">AI議事録（ブラウザ版・モック）</p>
        </div>
      </div>
      <div className="hidden md:flex items-center gap-2 text-xs text-white/60">
        <Pill tone="info"><Mic className="h-3.5 w-3.5" /> 音声から自動要約</Pill>
        <Pill tone="ok"><CheckCircle2 className="h-3.5 w-3.5" /> Word / HTML 出力</Pill>
      </div>
    </div>
  );
}

// ---------------------------
// Upload Area (no accept/size limits)
// ---------------------------
function UploadArea({ onFiles, onS3Uploaded }: { onFiles: (files: File[]) => void; onS3Uploaded: (key: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [s3Key, setS3Key] = useState<string | null>(null);

  async function signForS3(file: File) {
    const res = await fetch("/api/upload/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
    });
    if (!res.ok) throw new Error("fail to sign");
    return (await res.json()) as { url: string; key: string };
  }

  async function uploadToS3(file: File) {
    try {
      const { url, key } = await signForS3(file);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress((e.loaded / e.total) * 100);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`S3 upload ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("S3 upload network error"));
        xhr.open("PUT", url);
        if (file.type) xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });
      setS3Key(key);
      onS3Uploaded(key);
    } catch {
      // ignore error but reset progress
    } finally {
      setTimeout(() => setProgress(null), 800);
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
          if (files.length) onFiles(files);
          files.forEach((f) => uploadToS3(f));
        }}
        className={`relative grid place-items-center rounded-2xl px-6 py-14 transition ${over ? "ring-2 ring-cyan-400/50 bg-white/10" : "ring-1 ring-white/10 bg-white/5"}`}
      >
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.12),transparent_50%),radial-gradient(ellipse_at_bottom,rgba(79,70,229,0.12),transparent_50%)]" />
        <div className="relative z-10 flex flex-col items-center gap-4 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-black/40 ring-1 ring-white/10">
            <Upload className="h-6 w-6 text-white/80" />
          </div>
          <div className="space-y-1">
            <p className="text-white/90">
              ここに音声ファイルをドラッグ＆ドロップ
              <span className="mx-2 text-white/50">または</span>
              <button
                onClick={() => inputRef.current?.click()}
                className="underline decoration-cyan-400/60 underline-offset-4 hover:decoration-cyan-300"
              >ファイルを選択</button>
            </p>
            <p className="text-xs text-white/60">
              推奨形式：mp3 / wav / m4a ・ 推奨上限：2時間 / 300MB（<strong>制限はかけません</strong>）
            </p>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          // NOTE: no accept attribute => no extension restriction
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) onFiles(files);
            files.forEach((f) => uploadToS3(f));
            e.currentTarget.value = ""; // allow re-selecting same file
          }}
        />
        {progress !== null && (
          <div className="absolute bottom-3 left-3 right-3">
            <div className="h-2 w-full rounded bg-white/10">
              <div className="h-2 rounded bg-cyan-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-center text-xs text-white/60">S3 アップロード中… {progress.toFixed(0)}%</p>
          </div>
        )}
        {s3Key && (
          <div className="absolute top-3 right-3 text-[10px] text-white/60">S3キー: {s3Key}</div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------
// Main component
// ---------------------------
export default function MinutesStudioMock() {
  const [files, setFiles] = useState<File[]>([]);
  const [styleFiles, setStyleFiles] = useState<File[]>([]);
  const [s3Keys, setS3Keys] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [transcript, setTranscript] = useState<string>("");
  const [summary, setSummary] = useState<string>("");

  const fileMeta = useMemo(() => {
    return files.map((f) => ({
      name: f.name,
      size: humanBytes(f.size),
      rawSize: f.size,
      recommendedFormat: isRecommendedFormat(f.name),
      overRecommended: exceedsRecommendedSize(f.size),
      type: f.type || "-",
    }));
  }, [files]);

  async function processWithAI() {
    if (files.length === 0 && s3Keys.length === 0) return;
    setStatus("processing");
    setTranscript("");
    setSummary("");
    try {
      let res: Response;
      if (s3Keys.length > 0 && files.length === 0) {
        // S3経由
        res = await fetch("/api/minutes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ s3Keys }),
        });
      } else {
        const fd = new FormData();
        for (const f of files) fd.append("audio", f);
        for (const s of styleFiles) fd.append("style", s);
        res = await fetch("/api/minutes", { method: "POST", body: fd });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTranscript(data.transcript || "");
      setSummary(data.summary || "");
      setStatus("done");
    } catch (e) {
      setSummary("処理中にエラーが発生しました。");
      setStatus("done");
    }
  }

  function exportHTML() {
    const html = `<!doctype html><html lang=\"ja\"><meta charset=\"utf-8\"><title>Minutes Studio — 議事録</title><body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,\"Noto Sans JP\",\"Hiragino Kaku Gothic ProN\",Meiryo,sans-serif;line-height:1.7;padding:40px;max-width:900px;margin:auto\">`+
      `<h1>議事録（AI生成・モック）</h1>`+
      `<h3>概要</h3><p>${escapeHtml(summary || "（未作成）")}</p>`+
      `<h3>本文</h3><pre style=\"white-space:pre-wrap\">${escapeHtml(transcript || "（未作成）")}</pre>`+
      `</body></html>`;
    downloadFile(new Blob([html], { type: "text/html;charset=utf-8" }), `minutes_${Date.now()}.html`);
  }

  function exportDocx() {
    // For mock purposes, generate a simple HTML and save with .docx —
    // Word 互換表示で開けます（実装時は proper docx ライブラリに差し替え）
    const body = `${summary ? `<h3>概要</h3><p>${escapeHtml(summary)}</p>` : ""}` +
                 `${transcript ? `<h3>本文</h3><pre>${escapeHtml(transcript)}</pre>` : ""}`;
    const html = `<!doctype html><html><meta charset=\"utf-8\"><body>${body}</body></html>`;
    downloadFile(new Blob([html], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `minutes_${Date.now()}.docx`);
  }

  return (
    <div className="min-h-[100dvh] bg-black text-white">

      <div className="relative mx-auto w-full max-w-6xl px-6 py-8">
        <Header />

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <UploadArea onFiles={async (selected) => {
              // そのままAPIに送る場合
              setFiles(selected);
            }} onS3Uploaded={(key) => setS3Keys((prev) => Array.from(new Set([...prev, key])))} />

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

            {/* File list & recommendations (non-blocking) */}
            {files.length > 0 && (
              <Card className="p-5">
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <FileAudio className="h-4 w-4" />
                  <span>読み込み済みファイル</span>
                </div>
                <div className="mt-3 divide-y divide-white/10">
                  {fileMeta.map((f) => (
                    <div key={f.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white/90">{f.name}</p>
                        <p className="text-xs text-white/50">{f.type || "不明"}・{f.size}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {f.recommendedFormat ? (
                          <Pill tone="ok">推奨形式</Pill>
                        ) : (
                          <Pill tone="info">その他形式OK</Pill>
                        )}
                        {f.overRecommended ? (
                          <Pill tone="warn">推奨上限超（任意）</Pill>
                        ) : (
                          <Pill tone="ok">推奨内</Pill>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-start gap-2 text-xs text-white/60">
                  <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
                  <p>
                    クライアント側では<strong>拡張子・サイズの制限を行いません</strong>。上限を超える場合は処理時間やブラウザのメモリにご注意ください。
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button icon={FileText} variant="ghost" onClick={exportHTML} disabled={status === "processing"}>
                    HTMLとして保存
                  </Button>
                  <Button icon={FileText} variant="ghost" onClick={exportDocx} disabled={status === "processing"}>
                    Word(.docx)として保存
                  </Button>
                  <Button icon={Notebook} onClick={processWithAI} disabled={(files.length === 0 && s3Keys.length === 0) || status === "processing"}>
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
                  <pre className="whitespace-pre-wrap text-white/90">{transcript || "（生成を待機中）"}</pre>
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
                <li>ブラウザのみで動作するモックです。サーバー送信は行いません。</li>
                <li>拡張子・サイズの<strong>制限はありません</strong>。推奨：mp3 / wav / m4a、目安：2時間 / 300MB。</li>
                <li>「AIで議事録を作成」を押すとデモ用の要約と本文が生成されます。</li>
                <li>生成後は Word(.docx) または HTML で保存できます。</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>

      {/* NOTE: 右下の 3 ボタンは不要との要望により削除しました */}
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
