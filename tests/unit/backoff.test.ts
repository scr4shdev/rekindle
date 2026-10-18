import { describe, expect, it } from "vitest";

import { abortableSleep, backoffMs } from "@/lib/adapters/shared/backoff";

describe("shared backoff", () => {
  it("doubles from 300 ms, caps, and resolves early on abort", async () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n))).toEqual([300, 600, 1200, 2400, 4000, 4000]);
    const controller = new AbortController();
    const started = Date.now();
    const pending = abortableSleep(10_000, controller.signal);
    controller.abort();
    await pending;
    expect(Date.now() - started).toBeLessThan(1000);
    await abortableSleep(0);
  });
});
