"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createDefaultTextLayer } from "@/lib/timelineDefaults";
import { useEditorStore } from "@/store/editor";
import { secondsToTicks } from "@video-editor/shared";
import { useState } from "react";

export function TextPanel() {
  const sequence = useEditorStore((s) => s.sequence);
  const playheadTicks = useEditorStore((s) => s.playheadTicks);
  const applyOps = useEditorStore((s) => s.applyOps);
  const selectText = useEditorStore((s) => s.selectText);
  const [content, setContent] = useState("Your text here");

  function addText(isCaption: boolean) {
    if (!sequence) return;
    const track = sequence.textTracks[0]!;
    const layer = createDefaultTextLayer({
      startTicks: playheadTicks,
      durationTicks: secondsToTicks(3),
      content,
      isCaption,
      y: isCaption ? 0.85 : 0.15,
      fontSize: isCaption ? 40 : 64,
    });
    void applyOps([{ op: "addText", args: { textTrackId: track.id, layer } }], `Added text "${content.slice(0, 24)}"`);
    selectText(layer.id);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs text-textMuted">Text content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-border bg-panelAlt px-3 py-2 text-sm text-textPrimary focus:border-accent focus:outline-none"
        />
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => addText(false)} disabled={!sequence}>
          Add Title
        </Button>
        <Button className="flex-1" variant="secondary" onClick={() => addText(true)} disabled={!sequence}>
          Add Caption
        </Button>
      </div>
      <p className="text-xs text-textMuted">
        Text is added at the current playhead position. Select it on the timeline to adjust timing, size, color and animation in the Inspector.
      </p>
    </div>
  );
}
