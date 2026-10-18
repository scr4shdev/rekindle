import pino from "pino";
import { describe, expect, it } from "vitest";

import { REDACT_PATHS } from "@/lib/logger";

describe("logger redaction", () => {
  it("redacts caregiver content at top level and nested, keeps ids and counts", () => {
    const lines: string[] = [];
    const log = pino(
      { redact: { paths: REDACT_PATHS, censor: "[redacted]" } },
      { write: (line: string) => void lines.push(line) },
    );
    log.info(
      {
        traceId: "t1",
        notes: "born 1942 in Naples",
        request: { person: { displayName: "Maria" }, notes: "secret" },
        phase: { anchors: { birthYear: 1942 }, count: 3 },
        headers: { "x-api-key": "k" },
      },
      "session started",
    );
    const out = lines.join("");
    expect(out).not.toContain("Naples");
    expect(out).not.toContain("Maria");
    expect(out).not.toContain("secret");
    expect(out).not.toContain('"k"');
    expect(out).toContain('"traceId":"t1"');
    expect(out).toContain('"count":3');
  });
});
