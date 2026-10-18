import { getPendingPerson } from "@/components/session/pending-request";
import { getPersona } from "@/lib/personas";
import { SessionMode, type SessionRequestDraft } from "@/lib/domain/types";

/** The persona that has a recorded sample stream (src/lib/domain/sample-events.ts). */
export const RECORDED_PERSONA = "maria";

export type ResolvedRequest =
  | { ok: true; request: SessionRequestDraft; persona: string; name?: string; hasRecording: boolean }
  | { ok: false; reason: "unknown-persona" | "missing-custom" };

/** Build the session request from `?persona=` and `?mode=`. Custom input comes from memory only. */
export function resolveRequest(personaParam: string | null, modeParam: string | null): ResolvedRequest {
  const mode = SessionMode.safeParse(modeParam).data ?? "grounded";
  const slug = personaParam ?? RECORDED_PERSONA;
  if (slug === "custom") {
    const person = getPendingPerson();
    if (!person) return { ok: false, reason: "missing-custom" };
    return { ok: true, request: { mode, person }, persona: "custom", name: person.displayName, hasRecording: false };
  }
  const persona = getPersona(slug);
  if (!persona) return { ok: false, reason: "unknown-persona" };
  return {
    ok: true,
    request: { mode, person: persona.input },
    persona: persona.slug,
    name: persona.card.name.split(",")[0],
    hasRecording: persona.slug === RECORDED_PERSONA,
  };
}
