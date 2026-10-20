/**
 * No-op TTS adapter used when no hosted TTS key is wired. Every call throws
 * `TtsError("unavailable")` so the API route returns 503 and the client falls
 * through to the browser's own Web Speech API (default voice).
 */
import type { CallContext } from "@/lib/ports/common";
import type { TtsPort, TtsRequest, TtsResult } from "@/lib/ports/tts";
import { TtsError } from "@/lib/ports/tts";

export class MockTts implements TtsPort {
  readonly mode = "mock" as const;
  readonly provider = "mock";
  readonly model = "mock-tts";

  async synthesize(request: TtsRequest, ctx: CallContext): Promise<TtsResult> {
    void request;
    void ctx;
    throw new TtsError("unavailable", "No cloud TTS is wired in this environment", false);
  }
}
