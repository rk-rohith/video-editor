import type {
  ApplyTimelineOperationsRequest,
  CreateProjectRequest,
  CreateRenderRequest,
  LoginRequest,
  RegisterAssetRequest,
  RegisterRequest,
  RequestUploadUrlRequest,
  Sequence,
} from "@video-editor/shared";
import { useAuthStore } from "@/store/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const { accessToken, refreshToken, setSession, clearSession, user } = useAuthStore.getState();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && retry && refreshToken) {
    const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (refreshRes.ok) {
      const tokens = await refreshRes.json();
      if (user) setSession({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
      return request<T>(path, options, false);
    }
    clearSession();
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const message = (body as { error?: string } | undefined)?.error ?? res.statusText;
    throw new ApiError(res.status, message, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  register: (body: RegisterRequest) =>
    request<{ user: { id: string; email: string; name: string | null }; accessToken: string; refreshToken: string }>(
      "/api/auth/register",
      { method: "POST", body: JSON.stringify(body) }
    ),
  login: (body: LoginRequest) =>
    request<{ user: { id: string; email: string; name: string | null }; accessToken: string; refreshToken: string }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify(body) }
    ),

  listProjects: () => request<{ projects: ProjectDto[] }>("/api/projects"),
  createProject: (body: CreateProjectRequest) => request<{ project: ProjectDto }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  getProject: (id: string) => request<{ project: ProjectDto }>(`/api/projects/${id}`),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  getProjectSequence: (id: string) =>
    request<{ sequence: { id: string; projectId: string; currentVersionId: string | null }; timelineVersion: { id: string; data: Sequence } | null }>(
      `/api/projects/${id}/sequence`
    ),

  requestUploadUrl: (projectId: string, body: RequestUploadUrlRequest) =>
    request<{ objectKey: string; assetId: string; uploadUrl: string; method: string; headers?: Record<string, string> }>(
      `/api/projects/${projectId}/assets/upload-url`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  registerAsset: (projectId: string, body: RegisterAssetRequest) =>
    request<{ asset: AssetDto; jobId: string }>(`/api/projects/${projectId}/assets`, { method: "POST", body: JSON.stringify(body) }),
  listAssets: (projectId: string) => request<{ assets: AssetDto[] }>(`/api/projects/${projectId}/assets`),
  deleteAsset: (assetId: string) => request<void>(`/api/assets/${assetId}`, { method: "DELETE" }),

  applyTimelineOperations: (sequenceId: string, body: ApplyTimelineOperationsRequest) =>
    request<{ timelineVersion: { id: string; data: Sequence } }>(`/api/sequences/${sequenceId}/timeline`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listVersions: (sequenceId: string) => request<{ versions: { id: string; label: string | null; createdAt: string }[] }>(`/api/sequences/${sequenceId}/versions`),
  restoreVersion: (sequenceId: string, versionId: string) =>
    request<{ timelineVersion: { id: string; data: Sequence } }>(`/api/sequences/${sequenceId}/versions/${versionId}/restore`, { method: "POST" }),

  createRender: (projectId: string, body: CreateRenderRequest) =>
    request<{ render: RenderDto; jobId: string }>(`/api/projects/${projectId}/renders`, { method: "POST", body: JSON.stringify(body) }),
  getRender: (renderId: string) => request<{ render: RenderDto & { outputUrl: string | null } }>(`/api/renders/${renderId}`),
  getJob: (jobId: string) => request<{ job: JobDto }>(`/api/jobs/${jobId}`),
};

export async function uploadFileDirect(target: { uploadUrl: string; method: string; headers?: Record<string, string> }, file: File): Promise<void> {
  const res = await fetch(target.uploadUrl, { method: target.method, headers: target.headers, body: file });
  if (!res.ok) throw new ApiError(res.status, "Upload failed");
}

export interface ProjectDto {
  id: string;
  name: string;
  status: string;
  aspectRatio: string;
  targetDurationTicks: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDto {
  id: string;
  projectId: string;
  kind: "image" | "video" | "audio";
  role: string;
  originalName: string | null;
  status: "uploaded" | "processing" | "ready" | "failed";
  errorMessage: string | null;
  durationTicks: number | null;
  width: number | null;
  height: number | null;
  originalUrl: string;
  proxyUrl: string | null;
  thumbnailUrl: string | null;
  waveformUrl: string | null;
  createdAt: string;
}

export interface RenderDto {
  id: string;
  projectId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  resolution: string;
  fps: number;
  errorMessage: string | null;
  outputKey: string | null;
}

export interface JobDto {
  id: string;
  type: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  errorMessage: string | null;
}

export { ApiError };
