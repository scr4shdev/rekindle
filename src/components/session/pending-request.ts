/**
 * Hands the custom form's input to the session page without storing it
 * anywhere: module memory only (no URL, no localStorage, no server). It
 * survives client-side navigation and is gone on reload, by design.
 */
import type { PersonInputDraft } from "@/lib/domain/types";

let pending: PersonInputDraft | null = null;

export function setPendingPerson(person: PersonInputDraft): void {
  pending = person;
}

export function getPendingPerson(): PersonInputDraft | null {
  return pending;
}

export function clearPendingPerson(): void {
  pending = null;
}
