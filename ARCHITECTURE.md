# AI-Powered Reference Video Editor — Product & Technical Architecture

This document is the analysis and design pass requested before implementation. It covers:
critical product analysis, MVP scope, system architecture, data models, APIs, pipelines,
security, repo layout, phased roadmap, and cost/build tradeoffs. Implementation (Phase 1)
follows this document in the repository.

---

## 1. Critical Analysis

### 1.1 What's realistic today vs. what needs approximation

| Capability | Reality |
|---|---|
| Shot/scene/cut detection | **Realistic.** Deterministic CV (histogram diff, PySceneDetect-style algorithms) is cheap, fast, accurate. |
| Camera motion classification (pan/tilt/zoom/static) | **Realistic, approximate.** Optical flow (Farneback/Lucas-Kanade) gives good static/pan/zoom/handheld classification. Exact "push-in vs. pull-out" needs heuristics, not ground truth. |
| Beat/BPM/downbeat detection | **Realistic.** Librosa (Python) or equivalent is mature and cheap. |
| Transition-type classification (cut/dissolve/wipe/whip/glitch) | **Approximate.** Hard cuts and dissolves are reliably detectable via frame-diff curves. Whip pans, light leaks, masking, glitch effects require a classifier trained on examples, or heuristic proxies (motion blur + high optical flow spike = "whip-like"). We will implement hard-cut/dissolve/fade detection deterministically in Phase 3 and treat exotic transition types as a labeled enum the AI *chooses from our own transition library* rather than something we forensically extract pixel-for-pixel.
| Color grade extraction ("LUT") | **Approximate by design, and this is correct, not a limitation.** We never claim to extract someone's proprietary LUT. We compute aggregate statistics (mean/std of L\*a\*b, histogram shape, shadow/highlight balance, saturation, temperature) and map them onto **our own** parametric grade (exposure/contrast/saturation/temp/tint/vignette/grain) applied via FFmpeg's `curves`/`eq`/`colorbalance`. This is both the technically achievable approach and the legally safer one. |
| Font identification | **Approximate.** Exact font ID from pixels is unreliable without a paid API (WhatTheFont-style). We classify into style buckets (serif/sans/condensed/weight/case) via a vision model and map to a curated **licensed/open-source** font per bucket (Inter, Anton, Playfair Display, etc.). We never attempt to reproduce a proprietary brand font pixel-for-pixel. |
| "Storytelling pattern" (hook/climax/CTA) | **Approximate, LLM-assisted.** A vision-language model looking at keyframes + the shot timeline + audio energy curve can label narrative beats with reasonable accuracy for short-form ads (which follow strong conventions). This is inherently a judgment call, so we present it as a suggestion with confidence, editable by the user. |
| Subject-aware auto-reframe (face/product tracking for aspect-ratio conversion) | **Realistic** using a face/object detector (e.g. an open detector) + a smoothed crop-window controller. This is standard technique used by real products (Descript, Opus Clip, etc.). |
| Full semantic asset-to-shot matching ("find the shot with the same emotional tone") | **Partially realistic.** Embedding-based similarity (CLIP-style image/video embeddings) handles subject/composition/color similarity well. "Emotional tone" and "narrative relevance" are softer — we combine embeddings + heuristic features (shot type, motion, duration, quality score) + an LLM re-ranking pass over the top-K candidates, rather than pretending a single model nails it end to end. |
| Browser-side full-resolution rendering | **Not realistic for the final export.** WebCodecs can do fast *proxy* preview compositing (what we build in Phase 1's canvas player). Final broadcast-quality render must happen server-side with FFmpeg on original media — browsers cannot reliably decode/encode arbitrary codecs, handle GPU memory limits for long 4K timelines, or guarantee frame-accurate output. |
| Automatic music generation matched to edit | **Approximate / deferred.** Generative music APIs exist but licensing, quality-consistency, and cost make this a Phase 4+ integration behind a provider interface, not a core Phase 1/2 dependency. |
| Voice isolation / stem separation | **Realistic as an architecture slot** (e.g. Demucs-style separation), but compute-heavy — deferred to Phase 4, designed for now as an interface only. |

### 1.2 Core technical challenges

1. **Non-destructive, deterministic timeline model that both a human editor and an LLM tool-caller can manipulate safely.** This is the single most important piece of architecture — get it wrong and every downstream feature (undo, AI edits, reflow, rendering) becomes fragile.
2. **Two render paths that must stay visually consistent**: a fast browser proxy preview (canvas + HTML5 video, low-res) and a slow, authoritative server FFmpeg render (original-resolution). Drift between them is a real risk; we address it by having both paths consume the *same* render-graph representation (§30), just at different resolutions/codecs.
3. **Cost control for AI analysis.** A naive design sends every frame to a multimodal model. At $/frame this is unworkable at scale. The analysis pipeline (§20, §32) is deliberately layered: cheap deterministic CV/audio first, multimodal model only on a small set of selected keyframes for semantic labeling.
4. **Safe FFmpeg invocation.** Timeline → filter graph → command must never involve string-concatenating user-controlled values into a shell string. We build filter graphs as structured objects and invoke FFmpeg via `execFile` with an argv array — never `exec`/shell string interpolation.
5. **Copyright safety as a first-class design constraint, not an afterthought.** The reference-analysis pipeline is architected so that reference video **pixels/audio never appear in output** — only derived numeric/structural features do. This is enforced at the data-model level (see §35 and the `ReferenceAnalysis` schema in §10 — it stores no reference media, only analysis JSON, and reference video is deleted or restricted to on-demand playback for the analysis screen only, never composited into the output render).
6. **Asset-to-shot matching quality directly determines whether users trust the product.** A bad first match (irrelevant clip in the "hero shot" slot) breaks trust immediately. We treat "missing asset" detection (§39) as equally important as matching itself — telling the user what's missing beats silently picking a bad substitute.

### 1.3 Features that need approximation (stated plainly, not hidden)
Color grade, font matching, transition-style classification, "storytelling pattern," and "emotional tone" matching are all **approximations**, surfaced to the user as such (e.g., "font: sans-serif, bold, similar to Montserrat" rather than "font: detected as Helvetica Neue"). The product should never claim forensic-level extraction of a proprietary source.

### 1.4 Missing high-value features worth adding
- **Missing-asset detection UI** (spec already calls for this in §39 — elevated here to MUST HAVE, it's cheap and high-trust-impact).
- **Render cost/credit estimator before triggering an expensive AI or render job** (prevents surprise cost, both to us and the user in a metered future).
- **Project-level activity log** ("AI generated 40 clip suggestions, you accepted 32") — cheap, builds trust, doubles as an audit trail for undo.
- **Shareable read-only preview link** (lighter version of full collaboration, §36) — very cheap, high value for client approval workflows, doesn't require the full commenting system.
- **Asset consent/rights checkbox on upload** ("I own or am licensed to use this media") — legally prudent, near-zero engineering cost.

### 1.5 Features to cut or defer aggressively
- Full real-time collaborative multi-cursor editing (§36) — explicitly deferred per spec; overbuilding this pre-PMF wastes months.
- 4K/ProRes/HEVC/alpha export — architecture supports it (§25, §30) but Phase 1 ships H.264 1080p/720p only; adding new codecs later is a render-worker config change, not a rearchitecture.
- AI-generated music (§13/§Additional) — interface only until a licensing-clean provider is selected.
- Semantic asset search across a huge library (§38) — valuable but needs an embedding index (pgvector or a vector DB) that isn't worth standing up before there's a real asset library size problem. Phase 4.
- Multiple full-resolution AI version renders (§19) — spec itself says use lightweight proxies first; we follow that and never triple-render at full res automatically.

---

## 2. MVP Definition

**MVP = Phase 1 + a thin, honest slice of Phase 2.** A working nonlinear editor is the product's foundation — without it, nothing else (AI or otherwise) has anywhere to land. Per the spec's own principle #45 ("AI is never the only way to use the editor"), Phase 1 ships **zero AI** and must be a genuinely usable manual editor: upload, arrange clips on a multi-track timeline, trim/split, add text, add music, export a real MP4. Phase 2's AI Auto-Editor (asset scoring + a prompt-to-timeline draft) is the first AI slice, built once Phase 1's timeline model is proven solid, because every AI feature is just "an automated caller of the same timeline operations a human uses."

This repository's initial implementation targets **Phase 1, fully working**, plus the **data-model and interface scaffolding** for Phases 2–3 (empty-but-typed `AssetAnalysis`, `ReferenceAnalysis`, `VideoDNA` tables and an `AIProvider` interface) so later phases are additive, not a rewrite.

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/web  — Next.js (React/TS/Tailwind/Zustand)                     │
│  - Project dashboard, editor UI, canvas preview compositor           │
│  - Talks to apps/api over REST (+ polling for job status in Phase 1; │
│    SSE/WebSocket upgrade path noted for Phase 2+)                    │
└───────────────┬────────────────────────────────────────────────────┬─┘
                │ REST (JSON, JWT)                       signed PUT   │
┌───────────────▼────────────────────────────────┐   ┌───────────────▼─┐
│  apps/api — Node/TS modular monolith (Express)  │   │  Object storage  │
│  - auth, projects, assets, sequences, renders,  │◄──┤  (S3-compatible; │
│    jobs — thin controllers, validated inputs,   │   │  local-disk impl │
│    Prisma for persistence                       │   │  in dev)         │
│  - enqueues jobs, never runs FFmpeg itself       │   └───────────────┬─┘
└───────────────┬──────────────────────────────────┘                  │
                │ BullMQ (Redis)                                      │
┌───────────────▼────────────────────────────────┐                    │
│  apps/worker — Node/TS background workers        │                    │
│  - proxy/thumbnail/waveform generation (FFmpeg)  │◄───────────────────┘
│  - render pipeline (timeline → render graph →    │
│    FFmpeg filter graph → MP4)                    │
│  - (Phase 2+) analysis jobs call out to a Python  │
│    AI service behind an internal HTTP interface   │
└───────────────┬──────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────┐
│  PostgreSQL (via Prisma) — projects, timelines,   │
│  assets metadata, jobs, renders, DNA/analysis JSON│
└────────────────────────────────────────────────────┘

  (Phase 2+, not built in this pass)
  ┌─────────────────────────────────────────┐
  │ apps/ai-service — Python (FastAPI)       │
  │ shot detection, CV, audio analysis,      │
  │ embeddings, transcription; called by     │
  │ apps/worker over internal HTTP           │
  └─────────────────────────────────────────┘
```

**Why a modular monolith + workers, not microservices**: the spec explicitly asks for this (§46/§48). One deploy unit for the API keeps Phase 1 velocity high; the worker is already a separate process/queue boundary, which is where the real scaling need is (CPU-bound FFmpeg work), so splitting it out now costs nothing later. A Python AI service is kept as a *separate* app from day one (even though empty in Phase 1) because Node and Python have fundamentally different AI/CV library ecosystems — bolting Python bindings into the Node process would be the actual premature-complexity mistake.

---

## 4. Frontend Architecture (`apps/web`)

- **Next.js 14 App Router**, TypeScript strict, Tailwind CSS, **Zustand** for editor state (timeline, playhead, selection) — chosen over Redux for less boilerplate and because the editor state is essentially one big normalized document (fits Zustand's model well) plus a query layer (TanStack Query) for server data (projects, assets, job status).
- **Editor state split in two, deliberately:**
  - *Document state* (the timeline JSON) — the single source of truth, mirrors the backend `TimelineVersion` schema exactly, is what undo/redo snapshots, and is what gets PATCHed to the server.
  - *UI state* (selected clip, zoom level, playhead position, panel visibility) — ephemeral, never persisted server-side.
- **Preview compositor**: a `<canvas>`-driven player. Off-screen `<video>` elements per active track are seeked/played, drawn into the canvas per animation frame with transform (position/scale/rotation/opacity), simple crossfade compositing for dissolve transitions, and canvas `fillText`/rect for text/caption overlays. This is real proxy-resolution compositing — not a fake preview — but is explicitly *not* the renderer of record; final pixels come from the server FFmpeg render.
- **Component structure**: `MediaLibrary`, `Timeline` (tracks, clips, playhead, zoom), `Inspector` (per-selection properties), `PreviewCanvas`, `ExportPanel`, `AIAssistantPanel` (stubbed interface in Phase 1, wired in Phase 2).
- Large lists (media library, timeline clips) are virtualized/windowed once item counts justify it; kept simple in Phase 1 given expected MVP scale, called out as a perf follow-up (§41).

## 5. Backend Architecture (`apps/api`)

- **Express + TypeScript**, layered as `routes → controllers → services → prisma`. Every route validates its body/query with a **Zod** schema shared from `packages/shared` — the same schema the frontend uses to type its API calls, so client/server can't drift.
- **AuthN**: email+password, bcrypt hashing, short-lived JWT access token + refresh token (httpOnly cookie). Every project-scoped route checks resource ownership (`project.userId === req.user.id`) before any read/write — enforced in a single `requireProjectOwnership` middleware, not repeated ad hoc per route.
- **Storage abstraction**: `StorageProvider` interface (`getUploadUrl`, `getObjectUrl`, `putObject`, `deleteObject`) with a `LocalDiskStorageProvider` implementation for dev and an `S3StorageProvider` stub for production (AWS S3 / R2 / MinIO — all speak the S3 API). The API never streams large file bytes through itself; it issues a signed URL (or, for local dev, a scoped upload token) and the browser uploads directly.
- **AI provider abstraction** (interface only in this pass): `AIProvider` with methods like `analyzeReferenceVideo()`, `analyzeAsset()`, `planEdit(prompt, assets)`, `interpretEditCommand(text, timeline)`. A `MockAIProvider` will back Phase 2 development before a real model is wired in, per the "mock what can't be real yet" rule.
- **Job orchestration**: the API never runs FFmpeg. It writes a `Job` row and enqueues a BullMQ job; the worker updates job/render status, which the frontend polls (`GET /jobs/:id`).

## 6. Video-Processing Architecture (`apps/worker`)

- **BullMQ** (Redis-backed) queues: `media-processing` (proxy/thumbnail/waveform/metadata on upload) and `render` (timeline → MP4). Kept as two queues so a long render never starves fast proxy-generation jobs users are actively waiting on.
- **FFmpeg invocation**: always via Node's `child_process.execFile('ffmpeg', argsArray)` — never a shell string. All numeric parameters (times, positions, scale) are validated (finite numbers, bounded ranges) before being placed into the args array. Filter-graph strings are built by a small internal DSL (see §30) that only ever emits filter names/params we generate, never raw user text.
- **Proxy workflow** (§27): on upload, the worker transcodes to a capped-resolution/bitrate H.264 proxy + extracts a thumbnail (first usable frame, blur/black-frame skipped) + generates a waveform peaks JSON (for audio/video-with-audio assets) + reads `ffprobe` metadata (duration, codec, resolution, fps, rotation). The editor and preview compositor use the proxy; final render uses the **original** asset via the same in/out points and transforms.
- **Render pipeline**: pure function `timelineToRenderGraph(sequence) → RenderGraph`, then `renderGraphToFFmpegArgs(graph) → string[]`, then execute. Deterministic and unit-testable without invoking FFmpeg at all (§30).

## 7. AI Architecture (interfaces defined now, implemented from Phase 2 onward)

- All AI/CV calls go through `AIProvider` (backend) so the concrete vendor (Anthropic/OpenAI/open-source local model) is swappable and mockable.
- **Cost-aware analysis pipeline** (detailed in §20/§32): deterministic CV/audio first (free/cheap, runs on our own compute), multimodal model only on a handful of selected keyframes, results cached in `AssetAnalysis`/`ReferenceAnalysis` keyed by content hash so the same file is never re-analyzed twice.
- **Natural-language editing** goes through a constrained tool-calling loop (§18/§29): the model is given a fixed set of typed operations and the current timeline JSON; it returns a list of operation calls; the backend validates each one against the schema and current state before applying it. The model never edits the timeline object directly.

---

## 8. Timeline Data Model

This is the system's source of truth: preview, undo/redo, AI operations, persistence, and rendering all read/write this shape. Defined once in `packages/shared/src/timeline.ts` as Zod schemas (giving both runtime validation and inferred TS types) and mirrored into `TimelineVersion.data` (JSONB) in Postgres.

```ts
// Simplified — see packages/shared/src/timeline.ts for the full Zod source.

interface Sequence {
  id: string;
  projectId: string;
  fps: number;                 // e.g. 30
  width: number; height: number; // render resolution, e.g. 1080x1920
  durationTicks: number;       // duration expressed in ticks (see note below)
  tracks: Track[];
  audioTracks: AudioTrack[];
  textTracks: TextTrack[];
}

interface Track {              // video/image track
  id: string;
  kind: 'video';
  index: number;                // stacking order, higher = on top
  clips: Clip[];
}

interface Clip {
  id: string;
  sourceAssetId: string;         // -> Asset
  trackId: string;
  startTicks: number;            // position on the timeline
  durationTicks: number;         // on-timeline duration
  sourceInTicks: number;         // in-point within the source asset
  sourceOutTicks: number;        // out-point within the source asset
  transform: Transform;          // position/scale/rotation/opacity + keyframes
  speed: number;                 // 1.0 = normal; supports ramping via keyframes
  reversed: boolean;
  effects: Effect[];             // ordered list: colorGrade, blur, vignette, ...
  transitionIn?: Transition;
  transitionOut?: Transition;
  animation?: KenBurnsAnimation; // for image clips: pan/zoom path
}

interface Transform {
  x: number; y: number;          // normalized -1..1, center-relative
  scale: number; rotation: number; opacity: number;
  keyframes?: Keyframe<Partial<Transform>>[];
}

interface Keyframe<T> { ticks: number; value: T; easing: Easing; }

interface Transition {
  kind: 'cut' | 'dissolve' | 'fade' | 'wipe' | 'push' | 'zoomBlur';
  durationTicks: number;
  params?: Record<string, number>;
}

interface Effect { kind: 'colorGrade' | 'blur' | 'vignette' | 'grain'; params: Record<string, number>; }

interface AudioTrack { id: string; clips: AudioClip[]; }
interface AudioClip {
  id: string; sourceAssetId: string; trackId: string;
  startTicks: number; durationTicks: number;
  sourceInTicks: number; sourceOutTicks: number;
  gainDb: number; fadeInTicks: number; fadeOutTicks: number;
  keyframes?: Keyframe<{ gainDb: number }>[];
}

interface TextTrack { id: string; layers: TextLayer[]; }
interface TextLayer {
  id: string; startTicks: number; durationTicks: number;
  content: string; fontFamily: string; fontSize: number; fontWeight: number;
  color: string; align: 'left'|'center'|'right'; x: number; y: number;
  animation?: 'fadeIn' | 'slideUp' | 'typeOn' | 'none';
  isCaption?: boolean; wordTimings?: { word: string; startTicks: number; endTicks: number }[];
}
```

**Ticks, not seconds or frames, as the base unit.** We use an integer "tick" (`TICKS_PER_SECOND = 600`, chosen for clean divisibility by common frame rates 24/25/30/50/60) rather than floating-point seconds. This avoids floating-point drift accumulating across thousands of trims/splits over a long editing session, and avoids baking in a single frame rate — the sequence stores its own `fps` for playback/export snapping while all internal math stays exact-integer. All timeline operations (§29) take and return tick values.

**Non-destructive by construction**: `Clip` never stores media bytes, only `sourceAssetId` + in/out points + transform/effects. The same `Asset` can appear in many clips across many projects without duplication.

---

## 9. Video DNA Schema

Output of reference-video analysis (Phase 3). Stored as JSONB on `ReferenceAnalysis.videoDna`, versioned so the extraction algorithm can evolve without breaking stored analyses.

```ts
interface VideoDNA {
  version: 1;
  sourceDurationTicks: number;
  aspectRatio: string;                 // "9:16" | "16:9" | "1:1" | "4:5"
  genre: string;                       // LLM-labeled, editable by user
  pace: 'slow' | 'medium' | 'fast' | 'variable';

  sceneStructure: {
    id: string; startTicks: number; endTicks: number;
    role: 'hook' | 'establish' | 'body' | 'climax' | 'cta' | 'outro' | 'logo';
    shotType: 'wide' | 'medium' | 'closeup' | 'detail' | 'unknown';
    cameraMotion: 'static' | 'pan' | 'tilt' | 'zoomIn' | 'zoomOut' | 'handheld' | 'tracking';
    motionDirection?: 'left' | 'right' | 'up' | 'down' | 'inOut';
    dominantColors: string[];          // hex, extracted deterministically
    confidence: number;                // 0..1, always shown to user
  }[];

  shotPattern: { durationTicks: number; count: number }[]; // histogram of shot lengths

  transitions: {
    afterSceneId: string;
    kind: VideoDNA['sceneStructure'][number] extends never ? never :
      'cut' | 'dissolve' | 'fade' | 'wipe' | 'whipPan' | 'zoomBlur' | 'flash' | 'unknown';
    durationTicks: number;
    confidence: number;
  }[];

  colorProfile: {                      // aggregate stats -> mapped to OUR parametric grade
    exposure: number; contrast: number; saturation: number;
    temperature: number; tint: number;
    shadowsRGB: [number, number, number]; highlightsRGB: [number, number, number];
    vignetteStrength: number; grainAmount: number;
  };

  typography: {
    events: { startTicks: number; endTicks: number; role: 'title'|'subtitle'|'lowerThird'|'cta'|'caption';
      fontCategory: 'serif'|'sans'|'condensed'|'display'|'mono';
      weightBucket: 'light'|'regular'|'bold'|'black';
      caseStyle: 'upper'|'title'|'sentence';
      position: 'top'|'center'|'bottom'|'lowerThird';
      animationStyle: 'fadeIn'|'slideUp'|'typeOn'|'none';
    }[];
    suggestedFontFamily: string;       // mapped to a licensed/OSS font, never the original
  };

  beatMap: { ticks: number; strength: number }[];       // from OUR generated/licensed music, not reference audio
  audioEnergyCurve: { ticks: number; energy: number }[];

  textEvents: VideoDNA['typography']['events'];         // convenience alias for matching engine
  effects: { kind: string; startTicks: number; endTicks: number; params: Record<string, number> }[];

  storyArc: {
    hookStrategy?: 'curiosity'|'visualImpact'|'question'|'surprisingFact'|'resultFirst'|'problemSolution'|'beforeAfter';
    ctaStyle?: 'textOverlay'|'voiceover'|'endCard';
  };

  analysisMeta: { modelVersions: Record<string,string>; analyzedAt: string; keyframesSampled: number };
}
```

Explicitly **excluded from Video DNA**: any pixel data, audio waveform samples, or extracted sub-clips of the reference. Only numeric/structural/labeled features are retained — this is what makes "reusable Video DNA as a template" (spec §3/§37) safe to store and reuse indefinitely.

---

## 10. Database Schema

PostgreSQL via Prisma. Binary media never touches the DB — only object-storage keys/URLs.

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String
  name          String?
  createdAt     DateTime @default(now())
  projects      Project[]
  brandKits     BrandKit[]
}

model Project {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  name        String
  status      String   @default("draft") // draft | processing | ready | archived
  aspectRatio String   @default("9:16")
  targetDurationTicks Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  assets      Asset[]
  sequences   Sequence[]
  renders     Render[]
  referenceAnalyses ReferenceAnalysis[]
}

model Asset {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id])
  kind          String   // image | video | audio
  role          String   @default("raw") // raw | reference | logo | music | voiceover
  originalKey   String   // object storage key, original file
  proxyKey      String?
  thumbnailKey  String?
  waveformKey   String?
  durationTicks Int?
  width         Int?
  height        Int?
  fps           Float?
  fileSizeBytes Int?
  contentHash   String?  // for analysis-cache dedup
  status        String   @default("uploaded") // uploaded | processing | ready | failed
  createdAt     DateTime @default(now())
  analysis      AssetAnalysis?
}

model AssetAnalysis {
  id         String   @id @default(cuid())
  assetId    String   @unique
  asset      Asset    @relation(fields: [assetId], references: [id])
  data       Json     // detected subjects, quality score, best segments, embeddings ref, etc. (Phase 2)
  modelVersion String?
  createdAt  DateTime @default(now())
}

model ReferenceAnalysis {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  assetId     String   // the reference video Asset
  videoDna    Json     // VideoDNA shape (see §9)
  status      String   @default("pending") // pending | processing | ready | failed
  createdAt   DateTime @default(now())
}

model VideoDnaTemplate {   // user-saved reusable Video DNA (spec §3/§37)
  id        String   @id @default(cuid())
  userId    String
  name      String
  videoDna  Json
  createdAt DateTime @default(now())
}

model Sequence {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id])
  name          String   @default("Main Sequence")
  currentVersionId String?
  createdAt     DateTime @default(now())
  versions      TimelineVersion[]
}

model TimelineVersion {
  id          String   @id @default(cuid())
  sequenceId  String
  sequence    Sequence @relation(fields: [sequenceId], references: [id])
  label       String?  // "Original AI Edit" | "Client Revision 1" | ... (spec §22)
  data        Json     // full Sequence timeline JSON (see §8)
  createdBy   String   // "user" | "ai"
  parentVersionId String?
  createdAt   DateTime @default(now())
}

model Render {
  id           String   @id @default(cuid())
  projectId    String
  project      Project  @relation(fields: [projectId], references: [id])
  timelineVersionId String
  jobId        String?  @unique
  outputKey    String?
  format       String   @default("mp4")
  resolution   String   @default("1080p")
  fps          Int      @default(30)
  status       String   @default("queued") // queued|processing|completed|failed|cancelled
  progress     Float    @default(0)
  errorMessage String?
  createdAt    DateTime @default(now())
  completedAt  DateTime?
}

model Job {
  id          String   @id @default(cuid())
  type        String   // proxy | thumbnail | waveform | analysis | render | transcription
  refId       String   // id of the entity this job is for (assetId, renderId, ...)
  status      String   @default("queued") // queued|processing|completed|failed|cancelled
  progress    Float    @default(0)
  attempts    Int      @default(0)
  errorMessage String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model BrandKit {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  name      String
  logoKey   String?
  colors    Json?     // { primary, secondary, accent }
  fontFamily String?
  introAssetId String?
  outroAssetId String?
  watermarkKey String?
  createdAt DateTime @default(now())
}

model Template {
  id         String   @id @default(cuid())
  userId     String?
  name       String
  category   String?
  data       Json      // template schema (see spec §37): placeholders, durations, style rules
  isPublic   Boolean  @default(false)
  createdAt  DateTime @default(now())
}
```

Migrations are managed by `prisma migrate`; see `packages/db`.

---

## 11. API Endpoints (Phase 1 slice; Phase 2+ additions noted)

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout

GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id

POST   /api/projects/:id/assets/upload-url      # returns signed/scoped upload target
POST   /api/projects/:id/assets                 # register asset after upload, enqueues processing job
GET    /api/projects/:id/assets
DELETE /api/assets/:id

GET    /api/projects/:id/sequence               # current sequence + latest timeline version
PATCH  /api/sequences/:id/timeline               # apply validated operations (see §29) -> new TimelineVersion
GET    /api/sequences/:id/versions
POST   /api/sequences/:id/versions/:versionId/restore

POST   /api/projects/:id/renders                # { timelineVersionId, format, resolution, fps }
GET    /api/renders/:id
GET    /api/jobs/:id                             # generic job status poll

# --- Phase 2+ (interfaces reserved, not implemented in this pass) ---
POST   /api/projects/:id/reference               # upload + analyze reference video
GET    /api/projects/:id/reference/:id/dna
POST   /api/projects/:id/auto-edit                # prompt-to-plan
POST   /api/sequences/:id/ai-command              # natural-language edit -> operations
GET    /api/assets/:id/analysis
POST   /api/brand-kits
POST   /api/templates
```

Every mutating route validates its body against the matching Zod schema from `packages/shared`; ownership middleware guards every `:id` that resolves to a project-scoped resource.

---

## 12. Background Jobs

| Job type | Queue | Trigger | Output |
|---|---|---|---|
| `proxy` | media-processing | asset registered | proxy MP4/JPEG in storage, `Asset.proxyKey` |
| `thumbnail` | media-processing | asset registered | JPEG thumbnail |
| `waveform` | media-processing | asset registered (has audio) | peaks JSON |
| `metadata` | media-processing | asset registered | duration/dimensions/fps written to `Asset` |
| `render` | render | user clicks Export | MP4 in storage, `Render.outputKey` |
| `reference-analysis` (Phase 3) | analysis | reference uploaded | `ReferenceAnalysis.videoDna` |
| `asset-analysis` (Phase 2) | analysis | asset registered | `AssetAnalysis.data` |
| `transcription` (Phase 4) | analysis | captions requested | word-level transcript |

All jobs: `queued → processing → completed|failed|cancelled`, progress 0–100 written incrementally where FFmpeg exposes progress (parsed from its `-progress` pipe output), BullMQ retry with exponential backoff (3 attempts) on `failed`, and a `Job` row mirrors queue state into Postgres so the frontend polls one simple REST resource instead of talking to Redis directly.

---

## 13. Storage Architecture

```
{bucket}/
  users/{userId}/
    projects/{projectId}/
      assets/{assetId}/original.{ext}
      assets/{assetId}/proxy.mp4
      assets/{assetId}/thumb.jpg
      assets/{assetId}/waveform.json
      renders/{renderId}/output.mp4
```

`StorageProvider` interface (see §5) abstracts local disk (dev) vs. S3-compatible (prod). Uploads go **browser → storage directly** via a signed URL (S3 `PutObject` presigned URL in prod; a short-lived scoped token + local endpoint in the dev `LocalDiskStorageProvider`) — the API server is never a bytes-in-the-middle proxy for large files.

---

## 14. Rendering Pipeline

```
TimelineVersion.data (Sequence JSON)
        │  timelineToRenderGraph()
        ▼
RenderGraph  { inputs: ResolvedInput[], filterNodes: FilterNode[], outputMap: ... }
        │  renderGraphToFFmpegArgs()
        ▼
string[] argv   (e.g. ['-y','-i', file1, '-i', file2, '-filter_complex', '<generated>', '-map','[vout]', ...])
        │  execFile('ffmpeg', argv)   ← no shell, no string interpolation of user data
        ▼
worker parses -progress output → updates Render.progress
        ▼
output MP4 → storage → Render.status = completed
```

`RenderGraph` is a plain data structure (not a string) so it's independently unit-testable: given a `Sequence`, assert the exact filter node list/edges without ever invoking FFmpeg. The final `renderGraphToFFmpegArgs` step is the *only* place that turns validated numbers into an argv array; every value placed into a filter param has already passed through the Zod timeline schema (bounded, typed), so there is no path for arbitrary user strings to reach the FFmpeg command line.

**Known limitation, found and fixed during implementation, documented rather than hidden:** a transition eats into both adjacent clips' durations in the final composite (standard NLE behavior — the clip after a 0.5s dissolve visually starts 0.5s earlier than its raw `startTicks`). The render graph builder tracks each clip's *rendered* start time and uses it to place that clip's own embedded audio (verified with a real FFmpeg run: a 3s+3s two-clip timeline with a 0.5s dissolve now renders to exactly 5.5s of audio+video, not 6s with audio drifting past the end — see the regression test in `apps/worker/src/render/__tests__/graph.test.ts`). Two related gaps remain open, deliberately scoped out of this pass: (1) dedicated audio-track (music/voiceover) clips are still placed at their *raw* authored position, matching what the timeline UI currently shows the user (see next point) rather than the rendered one; (2) the client-side `PreviewCanvas` compositor does not yet simulate transition time-eating when scrubbing/playing, so a transitioned clip appears to start at its raw position in the live preview but at its earlier rendered position in the exported file. Closing both requires the preview to run the same compositing model as the server render — a reasonable Phase 2 follow-up, not attempted here.

---

## 15. Reference-Analysis Pipeline (Phase 3 — designed now, not implemented in this pass)

```
reference video → ffprobe metadata
                → shot/scene boundary detection (frame-diff / histogram) [deterministic, cheap]
                → per-shot optical-flow motion classification [deterministic, cheap]
                → per-shot color statistics [deterministic, cheap]
                → audio: BPM/beat grid, energy curve, silence/speech regions [librosa-class, cheap]
                → keyframe selection (1-3 representative frames per shot, skip near-duplicates)
                → selected keyframes + shot metadata → multimodal model
                    (batched, one call covering many shots' keyframes at once, not per-frame)
                → semantic labels: scene role, shot type, genre, typography category, hook strategy
                → assemble VideoDNA JSON (§9), cache by contentHash
```

Reference **pixels and audio are read only to compute the above and are never written into `VideoDNA` or copied into any output render.** The reference file itself is retained only long enough for the analysis job (and optional on-screen playback during the analysis review step) and is subject to the same retention/delete controls as any asset (§34).

## 16. User-Asset-Analysis Pipeline (Phase 2 — designed now)

```
asset (image or video) → proxy/thumbnail/metadata (Phase 1, already built)
                        → deterministic CV: face/object detection, blur score, exposure histogram,
                          dominant colors, orientation, duplicate hash (perceptual hash)
                        → (video only) shot-stability classifier (optical-flow variance),
                          candidate "best segment" windows via a motion+face+exposure composite score
                        → embedding vector (image/video-frame embedding model) for similarity search
                        → optional multimodal-model captioning on the single best-scoring frame/segment
                          (not every frame) for a human-readable label ("automobile, exterior, dusk")
                        → AssetAnalysis.data { qualityScore, tags, bestSegment, embeddingRef, ... }
```

## 17. AI Asset-Matching Strategy (Phase 3 — designed now)

For each `VideoDNA.sceneStructure[i]`, candidate assets are ranked by a weighted composite:

```
score = w1 * embeddingSimilarity(shot.representativeFrame, asset.embedding)
      + w2 * shotTypeMatch(shot.shotType, asset.detectedFraming)
      + w3 * motionDirectionCompatibility(shot.motionDirection, asset.motionDirection)
      + w4 * durationFit(shot.durationTicks, asset.availableDurationTicks)
      + w5 * asset.qualityScore
      - penalty(alreadyUsedRecently(asset))   // discourage overusing one clip
```
Weights are tunable per style preset (§17 of spec — e.g. "Luxury" weights composition/color higher, "Energetic Reel" weights motion/duration-fit higher). Top-K candidates go through an optional LLM re-rank pass that considers narrative relevance in natural language ("this is the opening hook, prefer the more dramatic option"). If the best candidate's score is below a confidence floor, the scene is flagged by **Missing-Asset Detection** (§39 of spec) instead of forcing a bad match.

## 18. Natural-Language Editing Architecture (Phase 2 — designed now)

```
user message + current Sequence JSON + a fixed operation-schema list
        → LLM tool-calling turn → ordered list of { op: OperationName, args: {...} }
        → validate each op's args against its Zod schema
        → validate each op against current sequence state (referenced clip exists, indices valid, etc.)
        → apply ops sequentially to produce a new TimelineVersion (never mutate in place)
        → return diff summary to the chat UI + the new version becomes current
```
This mirrors spec §29 exactly: the model never touches application state directly, only proposes calls from a closed set (`insertClip`, `removeClip`, `replaceClip`, `trimClip`, `splitClip`, `moveClip`, `setDuration`, `setTransform`, `addTransition`, `removeTransition`, `addText`, `updateText`, `addCaption`, `setSpeed`, `setColorGrade`, `addAudio`, `adjustVolume`, `addKeyframe`), each independently unit-testable and independently undoable (every applied op-batch is one `TimelineVersion`, so "undo" is just "restore previous version").

---

## 19. Security Architecture

- **AuthN/Z**: bcrypt + JWT (short-lived access token, rotating refresh token in httpOnly+secure cookie); every project-scoped resource checked for ownership server-side (never trust a client-supplied `projectId` without an ownership query).
- **Uploads**: signed URLs scoped to one object key with a short TTL; MIME-type allowlist (`video/mp4`, `video/quicktime`, `image/jpeg`, `image/png`, `image/webp`, `audio/mpeg`, `audio/wav`) validated both client-side (fast feedback) and server-side (`Asset` registration rejects mismatched `ffprobe`-detected type vs. declared type); file-size caps per plan tier; virus/malware scanning hook reserved as a pipeline step (stubbed interface, real scanner wired at production deploy time).
- **FFmpeg safety**: see §14 — argv-array `execFile`, never shell string building; all numeric filter params pre-validated by the Zod timeline schema (finite, bounded, correct type) before they can reach a filter string.
- **Rate limiting**: per-user token-bucket on auth endpoints and on job-creation endpoints (render/analysis) to prevent both abuse and runaway cost.
- **Secrets**: all API keys/DB credentials via environment variables only, never committed, never sent to the browser; `.env.example` documents every variable without real values.
- **Storage isolation**: object keys are namespaced per user/project (see §13) and the storage provider never issues a URL outside a caller's own namespace.

## 20. Privacy & Data Retention

- Per-project "Delete Project" cascades: deletes DB rows + all associated storage objects (originals, proxies, thumbnails, waveforms, renders).
- Per-asset delete supported independently.
- Account deletion cascades through all owned projects.
- Render/job temp files (worker scratch space) are cleaned up on job completion or failure, not left to accumulate.
- A configurable retention window (e.g., auto-delete raw originals N days after a completed export, keeping only the render) is designed as a per-project setting field, off by default in Phase 1, so it's additive later.

## 21. Copyright / Reference Safety (see also §1.1, §9, §15)

Enforced at the schema level, not just policy: `ReferenceAnalysis` has no field capable of holding reference media bytes or sub-clips — only `videoDna` (numeric/structural JSON). Reference audio is never attached to an output `Sequence`; the render pipeline has no operation that reads from a `role: 'reference'` asset. Logos/watermarks detected in a reference are recorded only as *layout metadata* (e.g., "end-card logo, bottom-center, 2s") never as extracted image data.

---

## 22. Repository Structure

```
video-editor/
  ARCHITECTURE.md
  README.md
  .env.example
  package.json                 # npm workspaces root
  tsconfig.base.json
  docker-compose.yml            # postgres, redis (local dev infra)
  apps/
    web/                        # Next.js frontend
    api/                        # Express backend
    worker/                     # BullMQ workers (media processing + render)
  packages/
    shared/                     # Zod schemas + TS types: timeline, video-dna, API contracts, operations
    db/                         # Prisma schema + generated client + seed script
  scripts/                      # dev bootstrap helpers
```

---

## 23. Phased Development Plan

- **Phase 1 (built)**: auth, projects, uploads, proxy/thumbnail/waveform generation, timeline data model, manual timeline editor (trim/split/reorder/text/basic audio/transitions), canvas preview player, FFmpeg export. Zero AI.
- **Phase 2 (built)**: deterministic asset analysis (quality score, best-segment detection, near-duplicate flagging — §16, all local CV via FFmpeg's own filters, no model call), an `AIProvider` abstraction with a real Anthropic tool-calling implementation, natural-language chat editing, and a prompt-to-first-draft auto-editor built on the same tool-calling path (§18/§29). See §26 for what this requires to actually run (an API key) versus what's real regardless.
- **Phase 3**: reference upload + analysis pipeline, Video DNA, asset-to-shot matching, reference-driven timeline generation, missing-asset detection.
- **Phase 4**: beat sync, captions/transcription, auto-reframe, brand kit, quality analyzer, style presets, multi-version lightweight previews, semantic asset search.
- **Phase 5**: distributed rendering, collaboration, subscriptions/quotas, GPU workloads where genuinely needed.

## 24. External Services / Libraries

**Free / open-source (used starting Phase 1):** FFmpeg, PostgreSQL, Redis, BullMQ, Prisma, Express, Next.js, Zustand, Tailwind, Zod, Vitest, bcrypt, jsonwebtoken.

**Free/open-source (reserved for Phase 2+):** PySceneDetect-style shot detection, OpenCV, librosa (BPM/beat), an open face/object detector, an open image/video embedding model, an open speech-to-text model (e.g. Whisper) for transcription/captions.

**Paid, provider-abstracted (Phase 2+):** a multimodal LLM API for semantic labeling/tool-calling (kept behind `AIProvider`, swappable), optionally a hosted vector DB once semantic search (§38) justifies it (pgvector on the existing Postgres is the default, cheaper path).

## 25. Major Cost Drivers (for later phases)

1. Multimodal model calls during reference/asset analysis — mitigated by the keyframe-sampling + caching pipeline (§15/§20).
2. FFmpeg render compute (CPU-bound; GPU encode is a later optimization once volume justifies it) — mitigated by proxy-based editing so only the final export touches full-res media.
3. Object storage + egress at scale — mitigated by proxy resolution caps and a retention policy.
4. LLM tool-calling for natural-language edits — cheap per call relative to analysis since it operates on JSON, not media.

## 26. What Is Mocked / Stubbed in This Pass, and Why

- **AI provider**: `AIProvider` (`apps/api/src/ai/`) has a real `AnthropicAIProvider` — genuine tool-calling against the Anthropic Messages API, with the tool's JSON Schema generated directly from the same Zod schema (`aiEditPlanSchema`) the backend validates the response against, so the two can't drift apart. Nothing about it is a stub. What IS environment-dependent: no `ANTHROPIC_API_KEY` existed in the environment this was built and tested in, so the live model round-trip itself was never exercised end-to-end here — everything up to and after that boundary was (request validation, asset-context building, operation application, the "not configured" error path). Without a key, `createAIProvider()` returns `NotConfiguredAIProvider`, which fails loudly with a clear message rather than silently no-opping; this was verified for real against the live dev stack (a 503 with `"...ANTHROPIC_API_KEY..."`), not assumed.
- **Deterministic asset analysis** (quality score, sharpness, exposure, scene cuts, best-segment, near-duplicate detection — `apps/worker/src/analysis/`): fully real, no model call, verified against real generated fixture media (sharp vs. blurred footage, a real scene cut, near-duplicate photos) both in the automated test suite and live through the running API.
- **Malware/virus scanning on upload**: interface point identified (§19) but no scanner wired in — real deployment should plug in a scanning service; not simulated here since a fake scanner would be actively misleading.
- **S3 storage provider**: implemented against the S3 API shape but Phase 1 runs against `LocalDiskStorageProvider` in dev, since no real cloud credentials exist in this environment; switching providers is a config change, not a code change, by design.
- **Email delivery** (password reset, notifications): not implemented; out of scope for Phase 1 functional-editor MVP.

---

## 27. Additional Features — Classification (spec §50)

| Feature | Class | Why |
|---|---|---|
| Missing-asset detection (§39) | **MUST HAVE** | Directly prevents silent bad output; cheap once matching engine exists (Phase 3). |
| Non-destructive timeline + version history (§8/§22) | **MUST HAVE** | Everything else depends on it; built in Phase 1. |
| Manual professional timeline editor (§8 of spec) | **MUST HAVE** | Product principle #45 requires it; built in Phase 1. |
| Proxy workflow (§27) | **MUST HAVE** | Required for acceptable performance on any real footage; built in Phase 1. |
| Asset-to-shot matching (§5) | **MUST HAVE** | The core differentiator; Phase 3. |
| Prompt-to-video editing plan (§6) | **MUST HAVE** | Second core differentiator; Phase 2. |
| Natural-language chat editing (§7) | **SHOULD HAVE** | High value, but the manual editor must work first; Phase 2. |
| Captions/transcription (§15) | **SHOULD HAVE** | Very high user-perceived value for short-form video; Phase 4 (needs an STT pipeline). |
| Beat sync (§13) | **SHOULD HAVE** | Strong differentiator for music-driven edits; Phase 4. |
| Auto-reframe (§11) | **SHOULD HAVE** | Needed for real multi-platform export; Phase 4. |
| Brand kit (§16) | **SHOULD HAVE** | Repeat-usage/retention driver for business users; Phase 4. |
| Quality analyzer (§20) | **NICE TO HAVE** | Useful polish, not core to the workflow; Phase 4. |
| Multiple AI versions (§19) | **NICE TO HAVE** | Real value but expensive if built carelessly; Phase 4, proxy-preview only. |
| Semantic asset search (§38) | **NICE TO HAVE** | Only matters once libraries are large; Phase 4. |
| Shareable read-only preview link | **SHOULD HAVE** (added, §1.4) | Cheap, high trust/approval-workflow value; good Phase 2/3 add. |
| Project activity log | **NICE TO HAVE** (added, §1.4) | Cheap trust-builder; Phase 3/4. |
| Full real-time collaboration (§36) | **FUTURE** | Explicitly deferred by spec; expensive; Phase 5+. |
| AI-generated music | **FUTURE** | Licensing/quality risk; needs a vetted provider first. |
| Voice isolation/stem separation | **FUTURE** | Compute-heavy; interface only for now. |
| GPU-accelerated rendering | **FUTURE** | Only justified at real render volume; Phase 5. |

---

## 28. Testing Strategy

- **Unit** (`packages/shared`, `apps/worker`): timeline operation reducers (trim/split/move/duration math), render-graph generation from a `Sequence` fixture, Zod schema validation edge cases — all pure functions, no FFmpeg process required.
- **Integration** (`apps/api`): upload → asset registration → job enqueued; sequence PATCH → new `TimelineVersion` persisted; render request → `Render` row created with correct initial state.
- **E2E** (deferred past this pass, noted for Phase 1 completion follow-up): register → create project → upload → build timeline → export, using Playwright against the running dev stack.

This pass ships the unit-test layer for the timeline/render-graph core, since that's the highest-leverage correctness surface (everything else is built on it).
