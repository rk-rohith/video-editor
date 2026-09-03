import { api } from "@/lib/api";
import { applyOperations, type Operation, type Sequence } from "@video-editor/shared";
import { create } from "zustand";

interface EditorState {
  projectId: string | null;
  sequenceId: string | null;
  sequence: Sequence | null;
  selectedClipId: string | null;
  selectedTextLayerId: string | null;
  selectedAudioClipId: string | null;
  playheadTicks: number;
  isPlaying: boolean;
  pxPerSecond: number;
  saving: boolean;
  error: string | null;

  init: (projectId: string, sequenceId: string, sequence: Sequence) => void;
  /** Replaces the local sequence with a server-authoritative one — used after an AI command/auto-draft, whose operations were already applied and persisted server-side. */
  setSequence: (sequence: Sequence) => void;
  selectClip: (id: string | null) => void;
  selectText: (id: string | null) => void;
  selectAudioClip: (id: string | null) => void;
  setPlayhead: (ticks: number) => void;
  setIsPlaying: (v: boolean) => void;
  setPxPerSecond: (v: number) => void;
  applyOps: (ops: Operation[], label?: string) => Promise<void>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  sequenceId: null,
  sequence: null,
  selectedClipId: null,
  selectedTextLayerId: null,
  selectedAudioClipId: null,
  playheadTicks: 0,
  isPlaying: false,
  pxPerSecond: 60,
  saving: false,
  error: null,

  init: (projectId, sequenceId, sequence) => set({ projectId, sequenceId, sequence, error: null }),
  setSequence: (sequence) => set({ sequence, error: null }),
  selectClip: (id) => set({ selectedClipId: id, selectedTextLayerId: null, selectedAudioClipId: null }),
  selectText: (id) => set({ selectedTextLayerId: id, selectedClipId: null, selectedAudioClipId: null }),
  selectAudioClip: (id) => set({ selectedAudioClipId: id, selectedClipId: null, selectedTextLayerId: null }),
  setPlayhead: (ticks) => set({ playheadTicks: Math.max(0, ticks) }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setPxPerSecond: (v) => set({ pxPerSecond: Math.min(400, Math.max(10, v)) }),

  applyOps: async (ops, label) => {
    const { sequence, sequenceId } = get();
    if (!sequence || !sequenceId) return;
    const previous = sequence;
    // Optimistic local apply for snappy editing — reconciled with the
    // server's authoritative response below (see ARCHITECTURE.md §18/§29:
    // this is the exact same operation reducer the AI tool-calling loop
    // will use from Phase 2 onward).
    try {
      const optimistic = applyOperations(sequence, ops);
      set({ sequence: optimistic, saving: true, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Invalid edit" });
      return;
    }
    try {
      const result = await api.applyTimelineOperations(sequenceId, { operations: ops, label });
      set({ sequence: result.timelineVersion.data, saving: false });
    } catch (err) {
      set({
        sequence: previous,
        saving: false,
        error: err instanceof Error ? err.message : "Failed to save edit",
      });
    }
  },
}));
