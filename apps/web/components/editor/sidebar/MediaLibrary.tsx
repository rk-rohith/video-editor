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

  return (
    <div className="group relative overflow-hidden rounded-md border border-border bg-panelAlt">
      <div className="flex h-20 items-center justify-center bg-black/40">
        {asset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumbnailUrl} alt={asset.originalName ?? ""} className="h-full w-full object-cover" />
        ) : asset.status === "failed" ? (
          <span className="px-2 text-center text-xs text-red-400">Failed: {asset.errorMessage}</span>
        ) : (
          <span className="text-xs text-textMuted">Processing…</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 p-1.5">
        <p className="truncate text-xs text-textMuted">{asset.originalName ?? asset.kind}</p>
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
    refetchInterval: (query) => (query.state.data?.assets.some((a) => a.status === "processing") ? 1500 : false),
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
