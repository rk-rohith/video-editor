"use client";

import { Button } from "@/components/ui/Button";
import { api, ApiError } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { useState } from "react";

interface ChatEntry {
  role: "user" | "ai" | "error";
  text: string;
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong";
}

/**
 * Natural-language timeline editing (ARCHITECTURE.md §7/§18/§29) and the
 * prompt-to-first-draft auto-editor (§6), both routed through the same
 * server-side tool-calling pipeline — see apps/api/src/services/ai.service.ts.
 * Requires ANTHROPIC_API_KEY on the server; without it every request here
 * comes back with a clear "AI not configured" message rather than silently
 * doing nothing, which this panel surfaces directly instead of hiding it.
 */
export function AIToolsPanel({ projectId }: { projectId: string }) {
  const sequenceId = useEditorStore((s) => s.sequenceId);
  const setSequence = useEditorStore((s) => s.setSequence);

  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftDuration, setDraftDuration] = useState("");
  const [drafting, setDrafting] = useState(false);

  async function sendMessage() {
    if (!sequenceId || !message.trim()) return;
    const text = message.trim();
    setMessage("");
    setChat((c) => [...c, { role: "user", text }]);
    setSending(true);
    try {
      const result = await api.aiCommand(sequenceId, text);
      if (result.timelineVersion) setSequence(result.timelineVersion.data);
      setChat((c) => [...c, { role: "ai", text: result.explanation }]);
    } catch (err) {
      setChat((c) => [...c, { role: "error", text: errorMessage(err) }]);
    } finally {
      setSending(false);
    }
  }

  async function generateDraft() {
    if (!draftPrompt.trim()) return;
    setDrafting(true);
    try {
      const targetDurationSeconds = draftDuration ? Number(draftDuration) : undefined;
      const result = await api.autoDraft(projectId, { prompt: draftPrompt.trim(), targetDurationSeconds });
      setSequence(result.timelineVersion.data);
      setChat((c) => [...c, { role: "ai", text: result.explanation }]);
    } catch (err) {
      setChat((c) => [...c, { role: "error", text: errorMessage(err) }]);
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-lg border border-border bg-panelAlt p-3">
        <p className="mb-2 text-xs font-semibold text-textPrimary">Generate first draft</p>
        <textarea
          value={draftPrompt}
          onChange={(e) => setDraftPrompt(e.target.value)}
          placeholder='e.g. "Turn these into a professional 30-second luxury real-estate reel"'
          rows={3}
          className="mb-2 w-full rounded-md border border-border bg-panel px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <div className="mb-2 flex items-center gap-2">
          <input
            type="number"
            min={3}
            max={600}
            value={draftDuration}
            onChange={(e) => setDraftDuration(e.target.value)}
            placeholder="Target seconds (optional)"
            className="w-full rounded-md border border-border bg-panel px-2 py-1 text-xs focus:border-accent focus:outline-none"
          />
        </div>
        <Button className="w-full" onClick={generateDraft} disabled={drafting || !draftPrompt.trim()}>
          {drafting ? "Generating…" : "Generate first draft"}
        </Button>
        <p className="mt-1 text-[10px] text-textMuted">Builds a complete edit from your uploaded, ready assets — replaces the current timeline.</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-panelAlt p-3">
        <p className="mb-2 text-xs font-semibold text-textPrimary">Chat edits</p>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {chat.length === 0 && (
            <p className="text-xs text-textMuted">
              Try: &ldquo;make the intro faster&rdquo;, &ldquo;add subtitles&rdquo;, &ldquo;make this more cinematic&rdquo;, &ldquo;make it 15 seconds&rdquo;.
            </p>
          )}
          {chat.map((entry, i) => (
            <div
              key={i}
              className={`rounded-md px-2 py-1.5 text-xs ${
                entry.role === "user"
                  ? "ml-6 bg-accent/20 text-textPrimary"
                  : entry.role === "error"
                    ? "bg-red-500/10 text-red-400"
                    : "mr-6 bg-panel text-textMuted"
              }`}
            >
              {entry.text}
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !sending && sendMessage()}
            placeholder="Describe an edit…"
            className="flex-1 rounded-md border border-border bg-panel px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
          <Button onClick={sendMessage} disabled={sending || !message.trim()}>
            {sending ? "…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
