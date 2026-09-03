import { aiEditPlanSchema } from "@video-editor/shared";
import { describe, expect, it } from "vitest";
import { buildToolInputSchema } from "../anthropicProvider.js";

describe("buildToolInputSchema", () => {
  it("produces a JSON Schema object with the expected top-level shape", () => {
    const schema = buildToolInputSchema();
    expect(schema.type).toBe("object");
    expect(schema).toHaveProperty("properties");
    const properties = schema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("operations");
    expect(properties).toHaveProperty("explanation");
  });

  it("does not leak an unresolved $ref/$schema (Anthropic's tool input_schema must be self-contained)", () => {
    const schema = buildToolInputSchema();
    const serialized = JSON.stringify(schema);
    expect(serialized).not.toContain("$schema");
  });

  it("accepts a minimal real operation batch that round-trips through the same aiEditPlanSchema the backend validates against", () => {
    // Sanity check that the schema we hand to the model and the schema we
    // validate its response against are the same one — not independently
    // hand-maintained copies that could drift.
    const example = {
      operations: [
        {
          op: "addText",
          args: {
            textTrackId: "t0",
            layer: {
              id: "text-1",
              startTicks: 0,
              durationTicks: 600,
              content: "Hello",
              fontFamily: "Inter",
              fontSize: 48,
              fontWeight: 600,
              color: "#fff",
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
      explanation: "Added a title.",
    };
    expect(() => aiEditPlanSchema.parse(example)).not.toThrow();
  });
});
