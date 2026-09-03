"use client";

import { useEditorStore } from "@/store/editor";
import { secondsToTicks, type TransitionKind } from "@video-editor/shared";

const TRANSITIONS: { kind: TransitionKind; label: string; description: string }[] = [
  { kind: "cut", label: "Cut", description: "No transition — hard cut" },
  { kind: "dissolve", label: "Dissolve", description: "Cross-fade between clips" },
  { kind: "fade", label: "Fade to black", description: "Fade through black" },
  { kind: "wipe", label: "Wipe", description: "Directional wipe" },
  { kind: "push", label: "Push / Slide", description: "New clip slides in" },
  { kind: "zoomBlur", label: "Zoom", description: "Zoom-blend transition" },
];

export function TransitionsPanel() {
  const sequence = useEditorStore((s) => s.sequence);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const applyOps = useEditorStore((s) => s.applyOps);

  const selectedClip = sequence?.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId);

  function apply(kind: TransitionKind) {
    if (!selectedClipId) return;
    if (kind === "cut") {
      void applyOps([{ op: "removeTransition", args: { clipId: selectedClipId, edge: "out" } }], "Removed transition");
      return;
    }
    void applyOps(
      [{ op: "addTransition", args: { clipId: selectedClipId, edge: "out", transition: { kind, durationTicks: secondsToTicks(0.5), params: {} } } }],
      `Applied ${kind} transition`
    );
  }

  return (
    <div className="space-y-2">
      {!selectedClip && <p className="text-xs text-textMuted">Select a clip on the timeline, then click a transition to apply it to the clip's outgoing edge.</p>}
      {selectedClip && (
        <p className="text-xs text-textMuted">
          Applying to the transition after: <span className="text-textPrimary">clip at {(selectedClip.startTicks / 600).toFixed(1)}s</span>
        </p>
      )}
      <div className="space-y-1.5">
        {TRANSITIONS.map((t) => (
          <button
            key={t.kind}
            disabled={!selectedClip}
            onClick={() => apply(t.kind)}
            className="w-full rounded-md border border-border bg-panelAlt p-2 text-left text-xs hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <p className="font-medium text-textPrimary">{t.label}</p>
            <p className="text-textMuted">{t.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
