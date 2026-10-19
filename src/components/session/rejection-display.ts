/**
 * Shared helper for rendering a RejectedItem on the compare and trace screens.
 *
 * The cultural-mismatch gate (critique phase, non-Western origin) emits
 * rejections with the frozen `wrong_locale` RejectionKind, because adding a
 * new kind would change the domain contract. The reason text carries a
 * `cultural_mismatch:` prefix as a sentinel so the UI can:
 *
 *   1. Override the badge label to something honest (not "Wrong place" for a
 *      cross-cultural extrapolation like Fatima -> Donald Trump).
 *   2. Strip the sentinel from the user-visible reason paragraph.
 *
 * The prefix stays in the stored reason so logs and traces still carry the
 * subtype information for operators.
 */
import type { RejectedItem } from "@/lib/domain/types";
import { getMessages } from "@/i18n";

export const CULTURAL_MISMATCH_PREFIX = "cultural_mismatch:";

export interface RejectionDisplay {
  label: string;
  reason: string;
}

/** Decide the badge label and the user-visible reason for a rejection. */
export function rejectionDisplay(item: RejectedItem, messages = getMessages()): RejectionDisplay {
  const kinds = messages.trace.rejectedKinds;
  if (item.kind === "wrong_locale") {
    const raw = item.reason.trimStart();
    if (raw.toLowerCase().startsWith(CULTURAL_MISMATCH_PREFIX)) {
      return {
        label: kinds.wrong_locale_cultural,
        reason: raw.slice(CULTURAL_MISMATCH_PREFIX.length).trimStart(),
      };
    }
  }
  return { label: kinds[item.kind], reason: item.reason };
}
