import { describe, expect, it } from "vitest";
import { parseMetadataPrintLog, parseShowinfoTimestamps } from "../metadataParser.js";

// Captured verbatim from a real `ffmpeg -vf fps=1,signalstats,metadata=print -loglevel info` run
// against a generated fixture, to make sure the parser matches real output, not an assumed shape.
const SAMPLE_METADATA_LOG = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'combo.mp4':
  Metadata:
    major_brand     : isom
Stream mapping:
  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))
Press [q] to stop, [?] for help
[Parsed_metadata_2 @ 0x1] frame:0    pts:0       pts_time:0
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YMIN=24
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YAVG=121.668
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YMAX=217
[Parsed_metadata_2 @ 0x1] frame:1    pts:10      pts_time:1
[Parsed_metadata_2 @ 0x1] lavfi.signalstats.YAVG=88.204
frame=    5 fps=0.0 q=-0.0 Lsize=N/A time=00:00:05.00 bitrate=N/A speed=N/A
`;

const SAMPLE_SHOWINFO_LOG = `
[Parsed_showinfo_1 @ 0x2] n:   0 pts:      0 pts_time:0        duration:      1 duration_time:0.1
[Parsed_showinfo_1 @ 0x2] n:   1 pts:     30 pts_time:3        duration:      1 duration_time:0.1
`;

describe("parseMetadataPrintLog", () => {
  it("groups lavfi key=value lines under the frame they belong to", () => {
    const frames = parseMetadataPrintLog(SAMPLE_METADATA_LOG);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.ptsTime).toBe(0);
    expect(frames[0]!.values["signalstats.YMIN"]).toBe(24);
    expect(frames[0]!.values["signalstats.YAVG"]).toBe(121.668);
    expect(frames[0]!.values["signalstats.YMAX"]).toBe(217);
    expect(frames[1]!.ptsTime).toBe(1);
    expect(frames[1]!.values["signalstats.YAVG"]).toBe(88.204);
  });

  it("ignores unrelated log lines (banner, stream mapping, progress)", () => {
    const frames = parseMetadataPrintLog(SAMPLE_METADATA_LOG);
    // exactly 2 frames, not polluted by the "frame=... fps=..." progress line
    expect(frames).toHaveLength(2);
  });

  it("returns an empty array for logs with no metadata frames", () => {
    expect(parseMetadataPrintLog("some unrelated log text\nwith no frames")).toEqual([]);
  });
});

describe("parseShowinfoTimestamps", () => {
  it("extracts pts_time from showinfo lines only", () => {
    const timestamps = parseShowinfoTimestamps(SAMPLE_SHOWINFO_LOG);
    expect(timestamps).toEqual([0, 3]);
  });

  it("ignores metadata=print lines even if mixed in the same log", () => {
    const combined = SAMPLE_METADATA_LOG + SAMPLE_SHOWINFO_LOG;
    expect(parseShowinfoTimestamps(combined)).toEqual([0, 3]);
  });
});
