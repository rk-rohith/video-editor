"use client";

import { useState } from "react";
import { AIToolsPanel } from "./sidebar/AIToolsPanel";
import { AudioPanel } from "./sidebar/AudioPanel";
import { ComingSoonPanel } from "./sidebar/ComingSoonPanel";
import { MediaLibrary } from "./sidebar/MediaLibrary";
import { TextPanel } from "./sidebar/TextPanel";
import { TransitionsPanel } from "./sidebar/TransitionsPanel";
import { Inspector } from "./Inspector";
import { PreviewCanvas } from "./PreviewCanvas";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";

const TABS = [
  { id: "media", label: "Media" },
  { id: "text", label: "Text" },
  { id: "audio", label: "Audio" },
  { id: "transitions", label: "Transitions" },
  { id: "effects", label: "Effects" },
  { id: "brand", label: "Brand" },
  { id: "ai", label: "AI Tools" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function EditorShell({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<TabId>("media");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <TopBar projectId={projectId} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-panel">
          <nav className="flex flex-wrap gap-1 border-b border-border p-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  tab === t.id ? "bg-accent text-white" : "text-textMuted hover:bg-panelAlt hover:text-textPrimary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "media" && <MediaLibrary projectId={projectId} />}
            {tab === "text" && <TextPanel />}
            {tab === "audio" && <AudioPanel projectId={projectId} />}
            {tab === "transitions" && <TransitionsPanel />}
            {tab === "effects" && <ComingSoonPanel name="Effects" phase="Phase 4" />}
            {tab === "brand" && <ComingSoonPanel name="Brand Kit" phase="Phase 4" />}
            {tab === "ai" && <AIToolsPanel projectId={projectId} />}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="flex flex-1 items-center justify-center bg-[#08080a] p-6">
              <PreviewCanvas />
            </div>
            <div className="w-72 shrink-0 border-l border-border bg-panel">
              <Inspector />
            </div>
          </div>
          <div className="h-64 shrink-0 border-t border-border bg-panel">
            <Timeline />
          </div>
        </main>
      </div>
    </div>
  );
}
