/**
 * POST /api/session/replan: adapts the rest of a running session to a
 * reaction and streams AgentEvents as NDJSON (docs/api.md). Stateless: the
 * client sends the plan, anchors and history. The note is never logged.
 */
import { jsonError, ndjsonResponse, parseJsonBody, rateLimited, rateLimiters } from "@/app/api/_lib/http";
import { runReplan } from "@/lib/agent";
import { getAgentDepsAsync } from "@/lib/composition";
import { ReplanRequest } from "@/lib/domain/types";
import { createRequestLogger, newTraceId } from "@/lib/logger";

// Node.js runtime is the default (and the only option with cacheComponents).
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const traceId = newTraceId();
  const logger = createRequestLogger(traceId, { route: "replan" });
  const limited = rateLimited(rateLimiters.replan, request, traceId);
  if (limited) {
    logger.warn({ status: 429 }, "replan request rate limited");
    return limited;
  }
  const parsed = await parseJsonBody(request, ReplanRequest, traceId);
  if (!parsed.ok) {
    logger.info({ status: parsed.response.status }, "replan request rejected");
    return parsed.response;
  }
  if (!parsed.data.plan.steps.some((s) => s.id === parsed.data.stepId)) {
    return jsonError(400, "invalid_input", "Request body is invalid.", traceId, [{ path: "stepId", message: "Not a step of this plan" }]);
  }
  let deps;
  try {
    deps = await getAgentDepsAsync();
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.name : typeof error }, "agent dependencies unavailable");
    return jsonError(500, "internal", "The planner is not configured correctly.", traceId);
  }
  logger.info({ reaction: parsed.data.reaction, revision: parsed.data.plan.meta.revision, historyLength: parsed.data.history.length }, "replan started");
  return ndjsonResponse(runReplan(deps, parsed.data, { traceId, logger, signal: request.signal }), traceId);
}
