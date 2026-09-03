# AI-Powered Reference Video Editor — Platform

A professional, non-destructive video editor with an AI editing layer on top of it. This
repository implements **Phase 1** (a genuinely working manual editor: upload → arrange on a
multitrack timeline → trim/split/transitions/text/audio → export a real MP4) and **Phase 2**
(deterministic asset analysis + AI-assisted editing on top of that same timeline).

**Start here:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the full product/technical analysis,
system design, data models, API surface, and phased roadmap. This README is just "how to run it."

## What's actually working right now

- Auth (register/login/refresh), project creation, project dashboard.
- Media upload (video/image/audio) with automatic proxy/thumbnail/waveform generation via FFmpeg.
- A real non-destructive timeline: insert/trim/split/move clips, transitions, text/captions,
  audio clips with volume/fades, per-clip transform/speed/color-grade, Ken Burns pan/zoom on
  photos, full undo-capable version history (every edit is a new immutable `TimelineVersion`).
- A canvas-based proxy preview player (real compositing — seeks/draws actual video and image
  frames, not a mock) with play/pause/scrub.
- Server-side FFmpeg rendering: the same timeline JSON drives an independently-testable render
  graph, turned into a safe FFmpeg argv (no shell string interpolation), producing a downloadable
  MP4 with live progress.
- **Deterministic asset analysis** on every upload — quality score, sharpness/exposure, best-segment
  recommendation for video, near-duplicate detection for photos — all local CV via FFmpeg's own
  filters, no model call, surfaced in the media library as a quality badge + recommended usage.
- **AI natural-language timeline editing and a prompt-to-first-draft auto-editor**, both routed
  through one real Anthropic tool-calling pipeline (`apps/api/src/ai/`) that can only propose
  operations from the same closed set the manual editor uses — never touches state directly.
  Requires `ANTHROPIC_API_KEY` (see Environment variables below); without it, these endpoints
  return a clear `503` instead of silently doing nothing. Verified live both ways: the 503 without
  a key, and a real chat edit ("add a title") correctly turning into an `addText` operation with one.
- Everything above was verified against a live running stack (real ffmpeg processing, a real
  upload → analyze → edit → export round trip), not just unit tests — see "Verifying it works."

See `ARCHITECTURE.md` §23 for the rest of the phased roadmap (Phases 3–5).

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Redis 6+
- FFmpeg + ffprobe on `PATH`

## Repository layout

```
apps/
  web/      Next.js frontend (the editor UI)
  api/      Express backend (auth, projects, assets, timeline, render/job orchestration)
  worker/   BullMQ background workers (proxy/thumbnail/waveform generation, FFmpeg rendering)
packages/
  shared/   Timeline data model, timeline operations, Video DNA schema, API contracts (Zod)
  db/       Prisma schema + client
  storage/  Storage provider abstraction (local disk for dev, S3-compatible for production)
```

## Setup

```bash
npm install

# Copy env examples and fill in real values (secrets, DB/Redis URLs, storage config)
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env

# Point STORAGE_LOCAL_ROOT (apps/api/.env and apps/worker/.env) at an absolute path, e.g.:
#   STORAGE_LOCAL_ROOT=/absolute/path/to/video-editor/storage-data
mkdir -p storage-data

# Start Postgres + Redis (docker-compose provides both for local dev)
docker compose up -d
# — or, if you already run Postgres/Redis locally, just make sure they're up and that
#   apps/api/.env / apps/worker/.env point at them.

# Create the database and apply migrations
npm run db:migrate -w packages/db
```

## Running it

Three processes, each in its own terminal:

```bash
npm run dev:api      # http://localhost:4000
npm run dev:worker    # background job processor — no HTTP port
npm run dev:web       # http://localhost:3000
```

Open `http://localhost:3000`, register an account, create a project, and start editing.

## Testing

```bash
npm run test          # unit + integration tests across every workspace
npm run typecheck     # strict TypeScript across every workspace
```

- `packages/shared` — pure unit tests for every timeline operation (trim/split/move/speed/...).
- `apps/worker` — pure unit tests for the render graph builder (including a regression test for
  a real audio/video sync bug found and fixed during development — see `ARCHITECTURE.md` §14),
  plus an integration test that runs the actual FFmpeg proxy/thumbnail/waveform pipeline against
  real generated media.
- `apps/api` — integration tests covering the full Phase 1 request flow (register → project →
  upload URL → timeline edit → render) against a real Postgres test database.

Integration tests need a running Postgres reachable via the `DATABASE_URL` in
`apps/api/.env.test` / `apps/worker/.env.test` (defaults to a `videoeditor_test` database — create
it and run `prisma migrate deploy` against it once) and a running Redis.

## Verifying it works (not just "compiles")

Beyond the automated test suites above, the full golden path — register, create a project, upload
a video and a photo, wait for real FFmpeg processing, add both to the timeline, add a title, apply
a dissolve transition, play the canvas preview, export, and download a real MP4 — was driven
end-to-end through an actual Chromium browser against the actual running API/worker/Postgres/Redis
stack during development. That run is what caught the audio-sync bug referenced above; it wasn't
found by reading the code.

## Environment variables

See `apps/api/.env.example`, `apps/worker/.env.example`, and `apps/web/.env.example` for the full
list. Nothing is hardcoded — all secrets and connection strings are environment-driven, and no API
key or secret is ever sent to the browser.
