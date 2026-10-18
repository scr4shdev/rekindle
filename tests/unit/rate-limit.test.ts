import { beforeEach, describe, expect, it } from "vitest";

import { clientKey, RATE_LIMITS, RateLimiter, rateLimiters } from "@/app/api/_lib/http";
import { POST as session } from "@/app/api/session/route";

describe("RateLimiter", () => {
  it("allows a burst, then refills over time, per client", () => {
    let now = 0;
    const limiter = new RateLimiter({ capacity: 2, refillPerMinute: 6 }, () => now);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(10);
    expect(limiter.take("b")).toBe(0);
    now += 10_000;
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBeGreaterThan(0);
    limiter.reset();
    expect(limiter.take("a")).toBe(0);
  });

  it("keys clients by the first forwarded IP", () => {
    const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientKey(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientKey(req({}))).toBe("unknown");
  });
});

describe("POST /api/session rate limit", () => {
  beforeEach(() => rateLimiters.session.reset());

  it("returns the documented 429 JSON before streaming once the burst is used up", async () => {
    const post = () =>
      session(new Request("http://localhost/api/session", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: "{}" }));
    for (let i = 0; i < RATE_LIMITS.session.capacity; i++) expect((await post()).status).toBe(400);
    const res = await post();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res.headers.get("x-trace-id")).toBeTruthy();
    expect((await res.json()).error.code).toBe("rate_limited");
  });
});
