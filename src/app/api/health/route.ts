/**
 * GET /api/health: non-secret runtime status for the UI badge
 * ("Demo data" vs "Live Qloo"). Never includes keys.
 *
 * If composition cannot build (no GEMINI_API_KEY), we return a 200 with
 * llm.mode === "unavailable" so the UI can show a soft "Set up Gemini"
 * state rather than the whole /api/health route 500-ing.
 */
import { effectiveConfigSummary, getAgentDepsAsync, LlmNotConfiguredError } from "@/lib/composition";
import { getConfig } from "@/lib/config";
import { newTraceId } from "@/lib/logger";

export async function GET(request: Request): Promise<Response> {
  // Reading the request makes this handler run at request time instead of
  // being prerendered at build (cacheComponents), so it reports the runtime
  // config.
  void request.headers.get("accept");
  const traceId = newTraceId();
  try {
    const deps = await getAgentDepsAsync();
    return Response.json(
      { status: "ok", ...effectiveConfigSummary(deps) },
      { headers: { "x-trace-id": traceId, "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) {
      const config = getConfig();
      return Response.json(
        {
          status: "ok",
          qloo: { mode: config.qloo.mode, mockReason: config.qloo.mockReason, baseUrl: config.qloo.baseUrl },
          llm: { mode: "unavailable" as const, reason: "missing_key" as const },
          cache: { driver: config.cache.driver },
        },
        { headers: { "x-trace-id": traceId, "cache-control": "no-store" } },
      );
    }
    throw error;
  }
}
