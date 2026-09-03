import { prisma } from "@video-editor/db";
import { promises as fs } from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { mediaProcessingQueue, renderQueue } from "../queues/queues.js";
import { redisConnection } from "../lib/redis.js";

const app = createApp();
const uniqueEmail = `test-${Date.now()}@example.com`;

let accessToken: string;
let projectId: string;
let sequenceId: string;
let timelineVersionId: string;

describe("API integration (Phase 1 core flow)", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: uniqueEmail } });
    await fs.rm(".test-storage", { recursive: true, force: true });
    await mediaProcessingQueue.close();
    await renderQueue.close();
    await redisConnection.quit();
    await prisma.$disconnect();
  });

  it("registers a new user and returns tokens", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: uniqueEmail, password: "hunter22222", name: "Test User" });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTypeOf("string");
    accessToken = res.body.accessToken;
  });

  it("rejects a duplicate registration", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: uniqueEmail, password: "hunter22222" });
    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: uniqueEmail, password: "hunter22222" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
  });

  it("rejects an unauthenticated project list request", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(401);
  });

  it("creates a project with an initial empty sequence", async () => {
    const res = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "My First Edit", aspectRatio: "9:16" });
    expect(res.status).toBe(201);
    expect(res.body.project.name).toBe("My First Edit");
    projectId = res.body.project.id;
  });

  it("returns the project's current sequence and timeline version", async () => {
    const res = await request(app).get(`/api/projects/${projectId}/sequence`).set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.sequence.projectId).toBe(projectId);
    expect(res.body.timelineVersion.data.tracks).toHaveLength(1);
    sequenceId = res.body.sequence.id;
    timelineVersionId = res.body.timelineVersion.id;
  });

  it("issues an upload URL for a new asset", async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/assets/upload-url`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ fileName: "clip.mp4", mimeType: "video/mp4", fileSizeBytes: 1024 });
    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toContain("/storage-upload/");
    expect(res.body.objectKey).toContain(projectId);
  });

  it("rejects a second user reading the first user's project", async () => {
    const other = await request(app).post("/api/auth/register").send({ email: `other-${Date.now()}@example.com`, password: "hunter22222" });
    const res = await request(app).get(`/api/projects/${projectId}`).set("Authorization", `Bearer ${other.body.accessToken}`);
    expect(res.status).toBe(404);
    await prisma.user.deleteMany({ where: { email: other.body.user.email } });
  });

  it("applies a timeline operation and creates a new immutable version", async () => {
    const res = await request(app)
      .patch(`/api/sequences/${sequenceId}/timeline`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        operations: [
          {
            op: "addText",
            args: {
              textTrackId: (
                await request(app).get(`/api/projects/${projectId}/sequence`).set("Authorization", `Bearer ${accessToken}`)
              ).body.timelineVersion.data.textTracks[0].id,
              layer: {
                id: "text-1",
                startTicks: 0,
                durationTicks: 600,
                content: "Hello world",
                fontFamily: "Inter",
                fontSize: 48,
                fontWeight: 600,
                color: "#ffffff",
                align: "center",
                x: 0,
                y: 0,
                animation: "fadeIn",
                isCaption: false,
                wordTimings: [],
              },
            },
          },
        ],
        label: "Added a title",
      });
    expect(res.status).toBe(200);
    expect(res.body.timelineVersion.data.textTracks[0].layers).toHaveLength(1);
    expect(res.body.timelineVersion.id).not.toBe(timelineVersionId);
  });

  it("rejects an invalid operation payload", async () => {
    const res = await request(app)
      .patch(`/api/sequences/${sequenceId}/timeline`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ operations: [{ op: "notARealOp", args: {} }] });
    expect(res.status).toBe(400);
  });

  it("creates a render job for the current timeline version", async () => {
    const seqRes = await request(app).get(`/api/projects/${projectId}/sequence`).set("Authorization", `Bearer ${accessToken}`);
    const res = await request(app)
      .post(`/api/projects/${projectId}/renders`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ timelineVersionId: seqRes.body.timelineVersion.id, resolution: "720p", fps: 30 });
    expect(res.status).toBe(201);
    expect(res.body.render.status).toBe("queued");
    expect(res.body.jobId).toBeTypeOf("string");
  });
});
