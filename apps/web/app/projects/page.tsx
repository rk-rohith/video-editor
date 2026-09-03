"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api, type ProjectDto } from "@/lib/api";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { useAuthStore } from "@/store/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const ASPECT_RATIOS = ["9:16", "16:9", "1:1", "4:5"] as const;

function NewProjectForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number]>("9:16");
  const [open, setOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => api.createProject({ name: name || "Untitled Project", aspectRatio }),
    onSuccess: ({ project }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${project.id}`);
    },
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="h-40 w-full flex-col rounded-xl border border-dashed border-border bg-transparent text-textMuted hover:border-accent hover:text-accent" variant="ghost">
        <span className="text-3xl leading-none">+</span>
        <span>New Project</span>
      </Button>
    );
  }

  return (
    <div className="h-40 w-full rounded-xl border border-border bg-panel p-4">
      <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} autoFocus className="mb-2" />
      <div className="mb-3 flex gap-1">
        {ASPECT_RATIOS.map((ratio) => (
          <button
            key={ratio}
            onClick={() => setAspectRatio(ratio)}
            className={`rounded px-2 py-1 text-xs ${aspectRatio === ratio ? "bg-accent text-white" : "bg-panelAlt text-textMuted hover:text-textPrimary"}`}
          >
            {ratio}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating…" : "Create"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectDto }) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div className="group relative h-40 rounded-xl border border-border bg-panel p-4 transition-colors hover:border-accent/60">
      <Link href={`/projects/${project.id}`} className="block h-full">
        <div className="mb-2 flex h-20 items-center justify-center rounded-md bg-panelAlt text-xs text-textMuted">{project.aspectRatio}</div>
        <p className="truncate text-sm font-medium">{project.name}</p>
        <p className="text-xs capitalize text-textMuted">{project.status}</p>
      </Link>
      <button
        onClick={(e) => {
          e.preventDefault();
          if (confirm(`Delete "${project.name}"? This cannot be undone.`)) deleteMutation.mutate();
        }}
        className="absolute right-2 top-2 hidden rounded bg-panelAlt px-2 py-1 text-xs text-textMuted hover:text-red-400 group-hover:block"
      >
        Delete
      </button>
    </div>
  );
}

export default function ProjectsPage() {
  const user = useRequireAuth();
  const clearSession = useAuthStore((s) => s.clearSession);
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: api.listProjects, enabled: Boolean(user) });

  if (!user) return null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your Projects</h1>
          <p className="text-sm text-textMuted">Signed in as {user.email}</p>
        </div>
        <Button variant="ghost" onClick={clearSession}>
          Sign out
        </Button>
      </div>

      {isLoading ? (
        <p className="text-textMuted">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <NewProjectForm />
          {data?.projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
