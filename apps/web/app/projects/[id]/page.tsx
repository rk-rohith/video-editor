"use client";

import { EditorShell } from "@/components/editor/EditorShell";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { useEditorStore } from "@/store/editor";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export default function ProjectEditorPage({ params }: { params: { id: string } }) {
  const user = useRequireAuth();
  const init = useEditorStore((s) => s.init);
  const sequence = useEditorStore((s) => s.sequence);

  const { data, isLoading, error } = useQuery({
    queryKey: ["project-sequence", params.id],
    queryFn: () => api.getProjectSequence(params.id),
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (data?.timelineVersion) {
      init(params.id, data.sequence.id, data.timelineVersion.data);
    }
  }, [data, params.id, init]);

  if (!user) return null;
  if (isLoading || !sequence) {
    return <div className="flex h-screen items-center justify-center text-textMuted">Loading project…</div>;
  }
  if (error) {
    return <div className="flex h-screen items-center justify-center text-red-400">Failed to load project.</div>;
  }

  return <EditorShell projectId={params.id} />;
}
