"use client";

import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { useEditorStore } from "@/store/editor";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ExportPanel } from "./ExportPanel";

export function TopBar({ projectId }: { projectId: string }) {
  const { data } = useQuery({ queryKey: ["project", projectId], queryFn: () => api.getProject(projectId) });
  const saving = useEditorStore((s) => s.saving);
  const error = useEditorStore((s) => s.error);
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-panel px-4">
      <div className="flex items-center gap-3">
        <Link href="/projects" className="text-sm text-textMuted hover:text-textPrimary">
          ← Projects
        </Link>
        <span className="text-border">|</span>
        <span className="text-sm font-medium">{data?.project.name ?? "Loading…"}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-textMuted">
          {error ? <span className="text-red-400">{error}</span> : saving ? "Saving…" : "All changes saved"}
        </span>
        <Button onClick={() => setExportOpen(true)}>Export</Button>
      </div>
      {exportOpen && <ExportPanel projectId={projectId} onClose={() => setExportOpen(false)} />}
    </header>
  );
}
