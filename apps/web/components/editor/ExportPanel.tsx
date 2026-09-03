"use client";

import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { PLATFORM_PRESETS } from "@video-editor/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const PRESET_OPTIONS = [
  { id: "custom", label: "Custom" },
  { id: "instagram_reel", label: "Instagram Reel" },
  { id: "instagram_post", label: "Instagram Post" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube_shorts", label: "YouTube Shorts" },
  { id: "youtube", label: "YouTube" },
  { id: "linkedin", label: "LinkedIn" },
] as const;

export function ExportPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const sequenceId = useEditorStore((s) => s.sequenceId);
  const [preset, setPreset] = useState<(typeof PRESET_OPTIONS)[number]["id"]>("custom");
  const [resolution, setResolution] = useState<"720p" | "1080p">("1080p");
  const [fps, setFps] = useState<24 | 25 | 30 | 60>(30);
  const [renderId, setRenderId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["render", renderId],
    queryFn: () => api.getRender(renderId!),
    enabled: Boolean(renderId),
    refetchInterval: (query) => (query.state.data?.render.status === "processing" || query.state.data?.render.status === "queued" ? 1000 : false),
  });

  async function startExport() {
    if (!sequenceId) return;
    setStarting(true);
    setError(null);
    try {
      const versions = await api.listVersions(sequenceId);
      const latest = versions.versions[0];
      if (!latest) throw new Error("No timeline version to export");
      const result = await api.createRender(projectId, { timelineVersionId: latest.id, format: "mp4", resolution, fps, platformPreset: preset });
      setRenderId(result.render.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start export");
    } finally {
      setStarting(false);
    }
  }

  const render = data?.render;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">Export video</h2>

        {!renderId && (
          <>
            <label className="mb-1 block text-xs text-textMuted">Platform preset</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as typeof preset)}
              className="mb-3 w-full rounded-md border border-border bg-panelAlt px-3 py-2 text-sm"
            >
              {PRESET_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.id !== "custom" ? ` (${PLATFORM_PRESETS[p.id]?.aspectRatio})` : ""}
                </option>
              ))}
            </select>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-textMuted">Resolution</label>
                <select value={resolution} onChange={(e) => setResolution(e.target.value as "720p" | "1080p")} className="w-full rounded-md border border-border bg-panelAlt px-3 py-2 text-sm">
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-textMuted">Frame rate</label>
                <select value={fps} onChange={(e) => setFps(Number(e.target.value) as typeof fps)} className="w-full rounded-md border border-border bg-panelAlt px-3 py-2 text-sm">
                  {[24, 25, 30, 60].map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={startExport} disabled={starting}>
                {starting ? "Starting…" : "Start export"}
              </Button>
            </div>
          </>
        )}

        {renderId && render && (
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex justify-between text-xs text-textMuted">
                <span className="capitalize">{render.status}</span>
                <span>{Math.round(render.progress)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-panelAlt">
                <div className="h-full bg-accent transition-all" style={{ width: `${render.progress}%` }} />
              </div>
            </div>
            {render.status === "failed" && <p className="text-sm text-red-400">{render.errorMessage}</p>}
            {render.status === "completed" && render.outputUrl && (
              <a href={render.outputUrl} download target="_blank" rel="noreferrer" className="block w-full rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-white hover:bg-accent/90">
                Download MP4
              </a>
            )}
            <Button variant="ghost" className="w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
