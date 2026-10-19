/**
 * Phase 3 end-to-end session probe. Runs a Seamus session with the real Qloo
 * adapter and the mock LLM (no LLM keys needed), consumes the event stream,
 * and prints a summary.
 *
 *   QLOO_API_KEY=... npx vitest run --config scripts/vitest.probe.config.mts \
 *     scripts/qloo-session.probe.ts
 */
import pino from "pino";
import { it } from "vitest";

import { buildAgentDeps } from "@/lib/composition";
import { loadConfig } from "@/lib/config";
import type { AgentEvent, SessionRequest } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";
import { runSession } from "@/lib/agent";

const logger = pino({ level: "silent" });

it("qloo full session for seamus", { timeout: 300_000 }, async () => {
  const config = loadConfig(process.env);
  if (config.qloo.mode !== "live") {
    process.stdout.write("QLOO not live: skipping.\n");
    return;
  }
  const deps = buildAgentDeps(config);
  process.stdout.write(
    `boot: qloo=${config.qloo.mode}, llm=${config.llm.mode}/${config.llm.provider}/${config.llm.model}\n`,
  );
  const seamus = PERSONAS.find((p) => p.slug === "seamus")!;
  const request: SessionRequest = {
    person: {
      displayName: seamus.input.displayName,
      birthYear: seamus.input.birthYear,
      birthPlace: seamus.input.birthPlace,
      sessionLanguage: seamus.input.sessionLanguage ?? "en",
      caregiverLanguage: seamus.input.caregiverLanguage ?? "en",
      sessionMinutes: seamus.input.sessionMinutes ?? 25,
      notes: seamus.input.notes,
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

  const gen = runSession(deps, request, { traceId: "probe-seamus", logger });
  for await (const ev of gen) {
    switch (ev.type) {
      case "anchors":
        counts.anchors = ev.anchors.loves.length + ev.anchors.places.length;
        process.stdout.write(`anchors: loves=${ev.anchors.loves.length} places=${ev.anchors.places.length} window=${ev.anchors.formativeWindow.startYear}-${ev.anchors.formativeWindow.endYear}\n`);
        break;
      case "candidate":
        counts.candidates += 1;
        if (counts.candidates <= 4) process.stdout.write(`candidate: ${ev.candidate.name} (${ev.candidate.domain})\n`);
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
    process.stdout.write(`qlooMode=${p.meta.qlooMode} totalMinutes=${p.totalMinutes} steps=${p.steps.length}\n`);
    for (const s of p.steps) {
      process.stdout.write(`  [${s.kind} ${s.durationMin}min ${s.provenance}] ${s.title}\n`);
      process.stdout.write(`    prompt: ${s.prompt}\n`);
      if (s.entity) process.stdout.write(`    entity: ${s.entity.name} (${s.entity.domain}, ${s.entity.qlooType})\n`);
      if (s.mediaHint) process.stdout.write(`    mediaHint: ${s.mediaHint}\n`);
    }
  } else {
    process.stdout.write("NO PLAN EMITTED\n");
  }
});
