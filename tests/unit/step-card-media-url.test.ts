/**
 * The step card builds the "search media" outbound URL from the structured
 * `mediaHost` enum emitted by the compose model, never by matching keywords
 * in the freeform `mediaHint` string (AGENTS.md: no regex or keyword lists
 * for semantics over LLM-authored text). These cases pin that routing and
 * the per-kind fallback for legacy steps that pre-date the enum.
 */
import { describe, expect, it } from "vitest";

import { mediaUrl } from "@/components/session/step-card";
import type { SessionStep } from "@/lib/domain/types";

const baseStep: SessionStep = {
  id: "s_1",
  order: 1,
  kind: "listen",
  title: "Oum Kalthoum",
  prompt: "Let us listen together.",
  followUps: [],
  durationMin: 3,
  provenance: "qloo-grounded",
};

const withHost = (overrides: Partial<SessionStep>): SessionStep => ({ ...baseStep, ...overrides });

describe("step-card mediaUrl routes by mediaHost, not by mediaHint keywords", () => {
  it("youtube enum builds the YouTube search URL even when the hint names a different host", () => {
    const url = mediaUrl(withHost({ mediaHost: "youtube", mediaHint: "Open on Spotify or Google Images later" }));
    expect(url).toContain("youtube.com/results");
    expect(url).toContain("Oum%20Kalthoum");
  });

  it("spotify enum builds the Spotify search URL", () => {
    const url = mediaUrl(withHost({ mediaHost: "spotify" }));
    expect(url).toContain("open.spotify.com/search");
  });

  it("google_images enum builds the Google Images search URL", () => {
    const url = mediaUrl(withHost({ kind: "look", mediaHost: "google_images" }));
    expect(url).toContain("google.com/search");
    expect(url).toContain("tbm=isch");
  });

  it("wikimedia enum builds the Wikimedia Commons search URL", () => {
    const url = mediaUrl(withHost({ kind: "look", mediaHost: "wikimedia" }));
    expect(url).toContain("commons.wikimedia.org");
  });

  it("imdb enum builds the IMDb search URL", () => {
    const url = mediaUrl(withHost({ kind: "look", mediaHost: "imdb" }));
    expect(url).toContain("imdb.com/find");
  });

  it("none and other return undefined so the UI hides the link", () => {
    expect(mediaUrl(withHost({ mediaHost: "none" }))).toBeUndefined();
    expect(mediaUrl(withHost({ mediaHost: "other" }))).toBeUndefined();
  });

  it("legacy step (no mediaHost) falls back to per-kind default: listen and move go to YouTube", () => {
    expect(mediaUrl(withHost({ kind: "listen" }))).toContain("youtube.com");
    expect(mediaUrl(withHost({ kind: "move" }))).toContain("youtube.com");
  });

  it("legacy step (no mediaHost) falls back to per-kind default: look goes to Google Images", () => {
    expect(mediaUrl(withHost({ kind: "look" }))).toContain("google.com/search");
  });

  it("talk, opening and closing never produce a URL even with a mediaHost set", () => {
    expect(mediaUrl(withHost({ kind: "talk", mediaHost: "youtube" }))).toBeUndefined();
    expect(mediaUrl(withHost({ kind: "opening", mediaHost: "youtube" }))).toBeUndefined();
    expect(mediaUrl(withHost({ kind: "closing", mediaHost: "youtube" }))).toBeUndefined();
  });

  it("ignores mediaHint keywords: a hint mentioning YouTube does NOT override an explicit google_images host", () => {
    const url = mediaUrl(withHost({ kind: "look", mediaHost: "google_images", mediaHint: "This mentions YouTube but is a photo" }));
    expect(url).toContain("google.com/search");
    expect(url).not.toContain("youtube.com");
  });
});
