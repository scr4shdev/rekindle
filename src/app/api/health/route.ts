/**
 * GET /api/health: non-secret runtime status for the UI badge ("Demo data"
 * vs "Live Qloo"). Never includes keys.
 *
 * Uses the EFFECTIVE deps (post Ollama reachability probe) so the badge
 * reflects what the agent actually runs, not the static config file.
 */
import { effectiveConfigSummary, getAgentDepsAsync } from "@/lib/composition";
import { newTraceId } from "@/lib/logger";

export async function GET(request: Request): Promise<Response> {
  // Reading the request makes this handler run at request time instead of being
  // prerendered at build (cacheComponents), so it reports the runtime config.
  void request.headers.get("accept");
  const deps = await getAgentDepsAsync();
  return Response.json(
    { status: "ok", ...effectiveConfigSummary(deps) },
    { headers: { "x-trace-id": newTraceId(), "cache-control": "no-store" } },
  );
}
