/**
 * GET /api/health: non-secret runtime status for the UI badge ("Demo data"
 * vs "Live Qloo"). Never includes keys.
 */
import { publicConfigSummary } from "@/lib/config";
import { newTraceId } from "@/lib/logger";

export async function GET(request: Request): Promise<Response> {
  // Reading the request makes this handler run at request time instead of being
  // prerendered at build (cacheComponents), so it reports the runtime config.
  void request.headers.get("accept");
  return Response.json(
    { status: "ok", ...publicConfigSummary() },
    { headers: { "x-trace-id": newTraceId(), "cache-control": "no-store" } },
  );
}
