"use client";

import { Button } from "@/components/ui/Button";
import { api, ApiError, uploadFileDirect, type AssetDto } from "@/lib/api";
import { createDefaultAudioClip, createDefaultClip } from "@/lib/timelineDefaults";
import { useEditorStore } from "@/store/editor";
import { secondsToTicks, type RequestUploadUrlRequest } from "@video-editor/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

const ACCEPTED_MIME: Record<string, RequestUploadUrlRequest["mimeType"]> = {
  "video/mp4": "video/mp4",
  "video/quicktime": "video/quicktime",
  "video/webm": "video/webm",
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "audio/mpeg": "audio/mpeg",
  "audio/wav": "audio/wav",
  "audio/mp4": "audio/mp4",
};

function trackEndTicks(clips: { startTicks: number; durationTicks: number }[]): number {
  return clips.reduce((max, c) => Math.max(max, c.startTicks + c.durationTicks), 0);
}

function AssetRow({ asset, projectId }: { asset: AssetDto; projectId: string }) {
  const sequence = useEditorStore((s) => s.sequence);
  const applyOps = useEditorStore((s) => s.applyOps);

  function addToTimeline() {
    if (!sequence) return;
    if (asset.kind === "audio") {
      const track = sequence.audioTracks[0]!;
      const start = trackEndTicks(track.clips);
      const duration = asset.durationTicks ?? secondsToTicks(5);
      const clip = createDefaultAudioClip({
        sourceAssetId: asset.id,
        trackId: track.id,
        startTicks: start,
        durationTicks: duration,
        sourceOutTicks: duration,
      });
      void applyOps([{ op: "addAudio", args: { audioTrackId: track.id, clip } }], `Added ${asset.originalName ?? "audio"} to timeline`);
      return;
    }

    const track = sequence.tracks[0]!;
    const start = trackEndTicks(track.clips);
    const duration = asset.kind === "image" ? secondsToTicks(3) : asset.durationTicks ?? secondsToTicks(3);
    const clip = createDefaultClip({
      sourceAssetId: asset.id,
      trackId: track.id,
      startTicks: start,
      durationTicks: duration,
      sourceOutTicks: duration,
      // A gentle default Ken Burns zoom for photos — see spec §12 "Smart
      // Photo Animation". Users can edit or remove this in the Inspector.
      animation: asset.kind === "image" ? { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.15, x: 0, y: 0 } } : undefined,
    });
    void applyOps([{ op: "insertClip", args: { trackId: track.id, clip } }], `Added ${asset.originalName ?? asset.kind} to timeline`);
  }

  const analysis = asset.analysis;
  const qualityDotColor = !analysis ? null : analysis.qualityScore > 0.6 ? "bg-emerald-400" : analysis.qualityScore > 0.35 ? "bg-amber-400" : "bg-red-400";
  const recommendation = analysis?.kind === "video" ? analysis.recommendedUsage : null;
  const isDuplicate = analysis?.kind === "image" && analysis.duplicateOfAssetIds.length > 0;

  return (
    <div className="group relative overflow-hidden rounded-md border border-border bg-panelAlt" title={recommendation ? `Asset Intelligence: recommended as ${recommendation}` : undefined}>
      <div className="relative flex h-20 items-center justify-center bg-black/40">
        {asset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumbnailUrl} alt={asset.originalName ?? ""} className="h-full w-full object-cover" />
        ) : asset.status === "failed" ? (
          <span className="px-2 text-center text-xs text-red-400">Failed: {asset.errorMessage}</span>
        ) : (
          <span className="text-xs text-textMuted">Processing…</span>
        )}
        {qualityDotColor && (
          <span className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ${qualityDotColor} ring-2 ring-black/40`} />
        )}
        {isDuplicate && (
          <span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[9px] text-amber-300">possible duplicate</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 p-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs text-textMuted">{asset.originalName ?? asset.kind}</p>
          {recommendation && <p className="truncate text-[10px] text-textMuted/70">{recommendation}</p>}
        </div>
        <Button
          variant="secondary"
          className="shrink-0 px-2 py-0.5 text-xs"
          disabled={asset.status !== "ready"}
          onClick={addToTimeline}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

export function MediaLibrary({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data } = useQuery({
    queryKey: ["assets", projectId],
    queryFn: () => api.listAssets(projectId),
    refetchInterval: (query) => {
      const assets = query.state.data?.assets ?? [];
      const stillProcessing = assets.some((a) => a.status === "processing");
      // Analysis is chained after the asset itself becomes "ready" (see
      // apps/worker/src/processors/processAsset.ts), so keep polling a
      // little longer for video/image assets that don't have it yet.
      const analysisPending = assets.some((a) => a.status === "ready" && a.kind !== "audio" && a.analysis === null);
      return stillProcessing || analysisPending ? 1500 : false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const mimeType = ACCEPTED_MIME[file.type];
      if (!mimeType) throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
      const target = await api.requestUploadUrl(projectId, { fileName: file.name, mimeType, fileSizeBytes: file.size });
      await uploadFileDirect(target, file);
      await api.registerAsset(projectId, {
        objectKey: target.objectKey,
        originalName: file.name,
        mimeType,
        fileSizeBytes: file.size,
        role: "raw",
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets", projectId] }),
    onError: (err) => setUploadError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed"),
  });

  async function onFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    for (const file of Array.from(files)) {
      await uploadMutation.mutateAsync(file).catch(() => undefined);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,audio/mp4"
        className="hidden"
        onChange={(e) => onFilesSelected(e.target.files)}
      />
      <Button className="w-full" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
        {uploading ? "Uploading…" : "Upload media"}
      </Button>
      {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}

      <div className="grid grid-cols-2 gap-2">
        {data?.assets.map((asset) => (
          <AssetRow key={asset.id} asset={asset} projectId={projectId} />
        ))}
      </div>
      {data?.assets.length === 0 && <p className="text-xs text-textMuted">No media yet. Upload photos, video clips, or audio to get started.</p>}
    </div>
  );
}
