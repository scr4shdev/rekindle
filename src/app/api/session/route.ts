/**
 * POST /api/session: builds a session plan and streams AgentEvents as NDJSON
 * (docs/api.md). Validation errors return JSON before streaming starts.
 */
import { jsonError, ndjsonResponse, parseJsonBody } from "@/app/api/_lib/http";
import { runSession } from "@/lib/agent";
import { getAgentDeps } from "@/lib/composition";
import { SessionRequest } from "@/lib/domain/types";
import { createRequestLogger, newTraceId } from "@/lib/logger";

// Node.js runtime is the default (and the only option with cacheComponents).
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const traceId = newTraceId();
  const logger = createRequestLogger(traceId, { route: "session" });
  const parsed = await parseJsonBody(request, SessionRequest, traceId);
  if (!parsed.ok) {
    logger.info({ status: parsed.response.status }, "session request rejected");
    return parsed.response;
  }
  let deps;
  try {
    deps = getAgentDeps();
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.name : typeof error }, "agent dependencies unavailable");
    return jsonError(500, "internal", "The planner is not configured correctly.", traceId);
  }
  logger.info({ mode: parsed.data.mode, minutes: parsed.data.person.sessionMinutes }, "session started");
  return ndjsonResponse(runSession(deps, parsed.data, { traceId, logger, signal: request.signal }), traceId);
}
