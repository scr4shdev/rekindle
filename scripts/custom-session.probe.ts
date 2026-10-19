/**
 * End-to-end probe for a CUSTOM user (not one of the three built-in personas),
 * running the full agent with real Qloo + real local Ollama. Never imported
 * by the app.
 *
 *   QLOO_API_KEY=... LLM_PROVIDER=ollama npx vitest run \
 *     --config scripts/vitest.probe.config.mts scripts/custom-session.probe.ts
 *
 * Verifies the LLM-driven planner works end to end for people who are not in
 * the mock fixtures: the opening and closing steps must include the person's
 * display name, and the plan must be non-trivial.
 */
import pino from "pino";
import { it } from "vitest";

import { runSession } from "@/lib/agent";
import { buildAgentDeps } from "@/lib/composition";
import { loadConfig, OLLAMA_DEFAULT_BASE_URL } from "@/lib/config";
import type { AgentEvent, SessionRequest } from "@/lib/domain/types";
import { isOllamaReachable } from "@/lib/adapters/llm/ollama";

const logger = pino({ level: "silent" });

it(
  "custom-session: full agent run against real Qloo + real local Ollama",
  { timeout: 300_000 },
  async () => {
    const config = loadConfig({
      ...process.env,
      LLM_PROVIDER: "ollama",
    });
    if (config.qloo.mode !== "live") {
      process.stdout.write("QLOO not live: skipping.\n");
      return;
    }
    const baseUrl = config.llm.ollamaBaseUrl ?? OLLAMA_DEFAULT_BASE_URL;
    if (!(await isOllamaReachable(baseUrl))) {
      process.stdout.write(`Ollama not reachable at ${baseUrl}: skipping.\n`);
      return;
    }
    const deps = buildAgentDeps(config);
    process.stdout.write(
      `boot: qloo=${config.qloo.mode}, llm=${config.llm.mode}/${config.llm.provider}/${config.llm.model}\n`,
    );

    const request: SessionRequest = {
      person: {
        displayName: "Teta Leila",
        birthYear: 1952,
        birthPlace: "Beirut, Lebanon",
        sessionLanguage: "ar",
        caregiverLanguage: "en",
        sessionMinutes: 20,
        notes:
          "My grandmother Leila was born in 1952 in Ras Beirut and grew up near the American University of Beirut. " +
          "She adored Fairuz and the Rahbani brothers, and used to listen to the morning show on Sawt el-Shaab radio. " +
          "She loved cooking kibbeh and tabbouleh for the whole family and spent summers in the village of Baskinta. " +
          "Please avoid the civil war years; stay with music, food, and the sea.",
      },
      mode: "grounded",
    };

    const counts = {
      anchors: 0,
      candidates: 0,
      verified: 0,
      rejected: 0,
      qlooCalls: 0,
      steps: 0,
      errors: 0,
      phases: 0,
    };
    let plan: AgentEvent | undefined;
    const errors: Array<{ code?: string; message?: string }> = [];
    const phases: string[] = [];
    const t0 = Date.now();

    const gen = runSession(deps, request, { traceId: "probe-custom", logger });
    for await (const ev of gen) {
      switch (ev.type) {
        case "anchors":
          counts.anchors = ev.anchors.loves.length + ev.anchors.places.length;
          process.stdout.write(
            `anchors: loves=${ev.anchors.loves.length} places=${ev.anchors.places.length} window=${ev.anchors.formativeWindow.startYear}-${ev.anchors.formativeWindow.endYear}\n`,
          );
          break;
        case "candidate":
          counts.candidates += 1;
          if (counts.candidates <= 6) {
            process.stdout.write(`candidate: ${ev.candidate.name} (${ev.candidate.domain})\n`);
          }
          break;
        case "verified":
          counts.verified += 1;
          break;
        case "rejected":
          counts.rejected += 1;
          break;
        case "qloo_call":
          counts.qlooCalls += 1;
          break;
        case "step":
          counts.steps += 1;
          break;
        case "phase":
          counts.phases += 1;
          phases.push(`${ev.phase}:${ev.status}`);
          break;
        case "plan":
          plan = ev;
          break;
        case "error":
          counts.errors += 1;
          errors.push({ code: ev.code, message: ev.message });
          break;
        default:
          break;
      }
    }
    const duration = Date.now() - t0;
    process.stdout.write(`\nDONE in ${duration}ms\n${JSON.stringify(counts, null, 2)}\n`);
    process.stdout.write(`phases: ${phases.join(" > ")}\n`);
    if (errors.length) process.stdout.write(`errors: ${JSON.stringify(errors, null, 2)}\n`);

    if (plan && plan.type === "plan") {
      const p = plan.plan;
      process.stdout.write(`\nPLAN: ${p.title}\n`);
      process.stdout.write(
        `qlooMode=${p.meta.qlooMode} llmProvider=${p.meta.llmProvider} llmModel=${p.meta.llmModel} totalMinutes=${p.totalMinutes} steps=${p.steps.length}\n`,
      );
      const name = request.person.displayName ?? "";
      const opening = p.steps[0];
      const closing = p.steps[p.steps.length - 1];
      const openingHasName = name.length > 0 && opening.prompt.includes(name);
      const closingHasName = name.length > 0 && closing.prompt.includes(name);
      process.stdout.write(
        `openingHasName=${openingHasName} closingHasName=${closingHasName}\n`,
      );
      for (const s of p.steps) {
        process.stdout.write(`  [${s.kind} ${s.durationMin}min ${s.provenance}] ${s.title}\n`);
        process.stdout.write(`    prompt: ${s.prompt}\n`);
        if (s.promptTranslation) {
          process.stdout.write(`    translation: ${s.promptTranslation}\n`);
        }
        if (s.entity) {
          process.stdout.write(
            `    entity: ${s.entity.name} (${s.entity.domain}, ${s.entity.qlooType})\n`,
          );
        }
        if (s.mediaHint) process.stdout.write(`    mediaHint: ${s.mediaHint}\n`);
      }
      // Fail loud if the plan is trivial.
      if (p.steps.length < 3) throw new Error(`plan too short: ${p.steps.length} steps`);
    } else {
      process.stdout.write("NO PLAN EMITTED\n");
    }
  },
);
