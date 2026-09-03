"use client";

import { Button } from "@/components/ui/Button";
import { useEditorStore } from "@/store/editor";
import { ticksToSeconds } from "@video-editor/shared";

export function AudioPanel({ projectId: _projectId }: { projectId: string }) {
  const sequence = useEditorStore((s) => s.sequence);
  const applyOps = useEditorStore((s) => s.applyOps);
  const selectAudioClip = useEditorStore((s) => s.selectAudioClip);
  const selectedAudioClipId = useEditorStore((s) => s.selectedAudioClipId);

  const clips = sequence?.audioTracks.flatMap((t) => t.clips) ?? [];

  if (clips.length === 0) {
    return <p className="text-xs text-textMuted">No audio on the timeline yet. Upload a music or voiceover track from the Media tab, then click Add.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-textMuted">Tracks on the timeline. Select one to fine-tune volume in the Inspector.</p>
      {clips.map((clip) => (
        <div
          key={clip.id}
          onClick={() => selectAudioClip(clip.id)}
          className={`cursor-pointer rounded-md border p-2 text-xs ${
            selectedAudioClipId === clip.id ? "border-accent bg-accentSoft/40" : "border-border bg-panelAlt hover:border-accent/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{ticksToSeconds(clip.startTicks).toFixed(1)}s → {ticksToSeconds(clip.startTicks + clip.durationTicks).toFixed(1)}s</span>
            <span className="text-textMuted">{clip.gainDb.toFixed(0)}dB</span>
          </div>
          <Button
            variant="ghost"
            className="mt-1 w-full px-1 py-0.5 text-xs text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              void applyOps([{ op: "removeClip", args: { clipId: clip.id } }], "Removed audio clip");
            }}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}
