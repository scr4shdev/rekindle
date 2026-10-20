/**
 * Live Ollama + Qloo smoke for the life-phase span feature. Runs the agent
 * against the Fatima and Maria personas (controlled by PERSONAS env, default
 * both), captures every emitted event to an NDJSON file, and prints a
 * phase-coverage summary: which lifePhase each composed step is anchored in
 * and sample titles per phase. Not part of `npm run check`.
 *
 *   PERSONAS=fatima,maria npx vitest run --config scripts/vitest.probe.config.mts scripts/life-phases.probe.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import pino from "pino";
import { it } from "vitest";

import { runSession } from "@/lib/agent";
import { buildAgentDeps } from "@/lib/composition";
import { loadConfig } from "@/lib/config";
import type { AgentEvent, LifePhaseLabel, SessionRequest } from "@/lib/domain/types";
import { PERSONAS } from "@/lib/personas";

const SCRATCH = "/tmp/claude-1000/-home-zka/a670e3c8-bce6-4733-8506-b12ac4fce885/scratchpad";

function pickPersonas(): string[] {
  const raw = (process.env.PERSONAS ?? "fatima,maria").toLowerCase();
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function run(slug: string): Promise<void> {
  const persona = PERSONAS.find((p) => p.slug === slug);
  if (!persona) {
    process.stdout.write(`skip unknown persona ${slug}\n`);
    return;
  }
  const config = loadConfig(process.env);
  const deps = buildAgentDeps(config);
  const logger = pino({ level: "silent" });

  const request: SessionRequest = {
    person: {
      displayName: persona.input.displayName,
      birthYear: persona.input.birthYear,
      birthPlace: persona.input.birthPlace,
      sessionLanguage: persona.input.sessionLanguage ?? "en",
      caregiverLanguage: persona.input.caregiverLanguage ?? "en",
      sessionMinutes: persona.input.sessionMinutes ?? 20,
      notes: persona.input.notes,
    },
    mode: "grounded",
  };

  const outPath = path.join(SCRATCH, `${slug}-phases.ndjson`);
  const events: AgentEvent[] = [];
  const lines: string[] = [];
  const t0 = Date.now();
  for await (const ev of runSession(deps, request, { traceId: `phases-${slug}`, logger })) {
    events.push(ev);
    lines.push(JSON.stringify(ev));
  }
  writeFileSync(outPath, lines.join("\n") + "\n");
  const ms = Date.now() - t0;

  const anchors = events.find((e) => e.type === "anchors");
  const plan = events.find((e) => e.type === "plan");
  process.stdout.write(`\n=== ${slug} (qloo=${config.qloo.mode}, llm=${config.llm.provider}/${config.llm.model}) ===\n`);
  process.stdout.write(`run time: ${ms}ms, events: ${events.length}, out: ${outPath}\n`);
  if (anchors && anchors.type === "anchors") {
    const phases = anchors.anchors.lifePhases ?? [];
    process.stdout.write(
      `lifePhases: ${phases
        .map((p) => `${p.label}=${p.startYear}-${p.endYear} (ages ${p.ageRange})`)
        .join(" | ")}\n`,
    );
  }
  if (plan && plan.type === "plan") {
    const coverage = new Map<LifePhaseLabel | "none", string[]>();
    for (const s of plan.plan.steps) {
      const key = (s.lifePhase ?? "none") as LifePhaseLabel | "none";
      const list = coverage.get(key) ?? [];
      list.push(`${s.order}. [${s.kind}] ${s.title}`);
      coverage.set(key, list);
    }
    process.stdout.write(`\nphase coverage:\n`);
    for (const [label, titles] of coverage) {
      process.stdout.write(`  ${label} (${titles.length}):\n`);
      for (const t of titles) process.stdout.write(`    - ${t}\n`);
    }
  } else {
    process.stdout.write("NO PLAN\n");
  }
}

it("life-phase smoke", { timeout: 300_000 }, async () => {
  for (const slug of pickPersonas()) {
    await run(slug);
  }
});
