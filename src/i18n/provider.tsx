"use client";

/**
 * React tree plumbing for caregiver-language messages. Lives in its own
 * `"use client"` module so the pure `getMessages` lookup in `@/i18n` stays
 * server-safe. Only the session view wraps a subtree today; everything else
 * resolves to English through the default context value.
 */
import { createContext, useContext, type ReactNode } from "react";
import { getMessages, type Messages } from "@/i18n";

const MessagesContext = createContext<Messages>(getMessages("en"));

/** Scope a subtree to a specific caregiver language (BCP 47 tag). */
export function MessagesProvider({ language, children }: { language?: string; children: ReactNode }) {
  return <MessagesContext.Provider value={getMessages(language)}>{children}</MessagesContext.Provider>;
}

/** Caregiver-language messages for the current subtree. English outside a provider. */
export function useMessages(): Messages {
  return useContext(MessagesContext);
}
