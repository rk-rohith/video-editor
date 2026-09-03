"use client";

import { useEditorStore } from "@/store/editor";
import { ticksToSeconds, type Transform } from "@video-editor/shared";
import { useEffect, useState } from "react";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-textMuted">{label}</label>
      {children}
    </div>
  );
}

function Slider({ value, min, max, step, onCommit }: { value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => onCommit(local)}
        className="h-1 flex-1 accent-accent"
      />
      <span className="w-10 text-right text-xs text-textMuted">{local.toFixed(2)}</span>
    </div>
  );
}

function ClipInspector({ clipId }: { clipId: string }) {
  const sequence = useEditorStore((s) => s.sequence)!;
  const applyOps = useEditorStore((s) => s.applyOps);
  const clip = sequence.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip) return null;

  function setTransform(patch: Partial<Transform>) {
    void applyOps([{ op: "setTransform", args: { clipId, transform: patch } }], "Adjusted transform");
  }
  function setSpeed(speed: number) {
    void applyOps([{ op: "setSpeed", args: { clipId, speed } }], "Adjusted speed");
  }
  function setGrade(params: Record<string, number>) {
    void applyOps([{ op: "setColorGrade", args: { clipId, effectId: `${clipId}-grade`, params } }], "Adjusted color");
  }

  const gradeEffect = clip.effects.find((e) => e.kind === "colorGrade");

  return (
    <div className="space-y-4">
      <p className="text-xs text-textMuted">Clip · {ticksToSeconds(clip.durationTicks).toFixed(2)}s</p>

      <Field label="Zoom (scale)">
        <Slider value={clip.transform.scale} min={1} max={3} step={0.01} onCommit={(v) => setTransform({ scale: v })} />
      </Field>
      <Field label="Position X">
        <Slider value={clip.transform.x} min={-1} max={1} step={0.01} onCommit={(v) => setTransform({ x: v })} />
      </Field>
      <Field label="Position Y">
        <Slider value={clip.transform.y} min={-1} max={1} step={0.01} onCommit={(v) => setTransform({ y: v })} />
      </Field>
      <Field label="Opacity">
        <Slider value={clip.transform.opacity} min={0} max={1} step={0.01} onCommit={(v) => setTransform({ opacity: v })} />
      </Field>
      <Field label="Rotation (°)">
        <Slider value={clip.transform.rotation} min={-45} max={45} step={1} onCommit={(v) => setTransform({ rotation: v })} />
      </Field>
      <Field label="Speed">
        <Slider value={clip.speed} min={0.25} max={4} step={0.05} onCommit={setSpeed} />
      </Field>

      <div className="border-t border-border pt-3">
        <p className="mb-2 text-xs font-medium text-textPrimary">Color grade</p>
        <Field label="Brightness">
          <Slider value={(gradeEffect?.params.brightness as number) ?? 0} min={-0.3} max={0.3} step={0.01} onCommit={(v) => setGrade({ brightness: v })} />
        </Field>
        <Field label="Contrast">
          <Slider value={(gradeEffect?.params.contrast as number) ?? 1} min={0.5} max={2} step={0.01} onCommit={(v) => setGrade({ contrast: v })} />
        </Field>
        <Field label="Saturation">
          <Slider value={(gradeEffect?.params.saturation as number) ?? 1} min={0} max={2} step={0.01} onCommit={(v) => setGrade({ saturation: v })} />
        </Field>
      </div>
    </div>
  );
}

function TextInspector({ layerId }: { layerId: string }) {
  const sequence = useEditorStore((s) => s.sequence)!;
  const applyOps = useEditorStore((s) => s.applyOps);
  const layer = sequence.textTracks.flatMap((t) => t.layers).find((l) => l.id === layerId);
  const [content, setContent] = useState(layer?.content ?? "");
  useEffect(() => setContent(layer?.content ?? ""), [layer?.content]);
  if (!layer) return null;

  function patch(p: Record<string, unknown>) {
    void applyOps([{ op: "updateText", args: { layerId, patch: p } }], "Updated text");
  }

  return (
    <div className="space-y-4">
      <Field label="Content">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={() => patch({ content })}
          rows={2}
          className="w-full rounded-md border border-border bg-panelAlt px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
      </Field>
      <Field label="Font size">
        <Slider value={layer.fontSize} min={16} max={160} step={1} onCommit={(v) => patch({ fontSize: v })} />
      </Field>
      <Field label="Vertical position">
        <Slider value={layer.y} min={-1} max={1} step={0.01} onCommit={(v) => patch({ y: v })} />
      </Field>
      <Field label="Color">
        <input type="color" defaultValue={layer.color} onChange={(e) => patch({ color: e.target.value })} className="h-8 w-full rounded" />
      </Field>
      <Field label="Alignment">
        <div className="flex gap-1">
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              onClick={() => patch({ align: a })}
              className={`flex-1 rounded px-2 py-1 text-xs ${layer.align === a ? "bg-accent text-white" : "bg-panelAlt text-textMuted"}`}
            >
              {a}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Animation">
        <select
          value={layer.animation}
          onChange={(e) => patch({ animation: e.target.value })}
          className="w-full rounded-md border border-border bg-panelAlt px-2 py-1.5 text-sm"
        >
          <option value="fadeIn">Fade in</option>
          <option value="slideUp">Slide up</option>
          <option value="typeOn">Type on</option>
          <option value="none">None</option>
        </select>
      </Field>
    </div>
  );
}

function AudioInspector({ audioClipId }: { audioClipId: string }) {
  const sequence = useEditorStore((s) => s.sequence)!;
  const applyOps = useEditorStore((s) => s.applyOps);
  const clip = sequence.audioTracks.flatMap((t) => t.clips).find((c) => c.id === audioClipId);
  if (!clip) return null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-textMuted">Audio clip · {ticksToSeconds(clip.durationTicks).toFixed(2)}s</p>
      <Field label="Volume (dB)">
        <Slider
          value={clip.gainDb}
          min={-40}
          max={12}
          step={1}
          onCommit={(v) => void applyOps([{ op: "adjustVolume", args: { audioClipId, gainDb: v } }], "Adjusted volume")}
        />
      </Field>
    </div>
  );
}

export function Inspector() {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedTextLayerId = useEditorStore((s) => s.selectedTextLayerId);
  const selectedAudioClipId = useEditorStore((s) => s.selectedAudioClipId);

  return (
    <div className="h-full overflow-y-auto p-3">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-textMuted">Inspector</h2>
      {selectedClipId && <ClipInspector clipId={selectedClipId} />}
      {selectedTextLayerId && <TextInspector layerId={selectedTextLayerId} />}
      {selectedAudioClipId && <AudioInspector audioClipId={selectedAudioClipId} />}
      {!selectedClipId && !selectedTextLayerId && !selectedAudioClipId && (
        <p className="text-xs text-textMuted">Select a clip, text layer, or audio clip on the timeline to edit its properties.</p>
      )}
    </div>
  );
}
