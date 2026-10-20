/**
 * FROZEN CONTRACT (Phase 0). Recorded AgentEvent streams for persona "maria",
 * so the UI can build the live trace, timeline, comparison and replan views
 * before the backend exists. Every event validates against AgentEvent (see
 * tests/contract). Qloo ids are placeholders ("SAMPLE-..."), not real ids.
 * imageUrl is intentionally absent: the UI must handle missing images.
 *
 * Replay: iterate in order and wait `event.t - prev.t` ms between events.
 */
import type {
  AgentEvent,
  AgentEventPayload,
  Anchors,
  SessionPlan,
  SessionStep,
  VerifiedEntity,
} from "@/lib/domain/types";

/** Stamp payloads with seq and a cumulative t from per-event delays (ms). */
function recorded(items: Array<[delayMs: number, payload: AgentEventPayload]>): AgentEvent[] {
  let t = 0;
  return items.map(([delay, payload], seq) => {
    t += delay;
    return { ...payload, seq, t } as AgentEvent;
  });
}

const GENERATED_AT = "2026-10-18T19:00:00.000Z";

export const SAMPLE_ANCHORS: Anchors = {
  birthYear: 1942,
  birthYearSource: "stated",
  formativeWindow: { startYear: 1952, endYear: 1972 },
  places: [
    { name: "Naples (Quartieri Spagnoli)", countryCode: "IT", role: "birthplace", fromYear: 1942 },
    { name: "Naples", countryCode: "IT", role: "adulthood", fromYear: 1963 },
  ],
  languages: [
    { tag: "nap", name: "Neapolitan" },
    { tag: "it", name: "Italian" },
  ],
  loves: [
    { label: "Frank Sinatra", domain: "music", source: "stated" },
    { label: "Neapolitan song", domain: "music", source: "stated" },
    { label: "SSC Napoli", domain: "sport", source: "stated" },
    { label: "Sunday ragù", domain: "food", source: "stated" },
    { label: "Sewing and fabrics", domain: "fashion", source: "inferred" },
  ],
  sensitivities: [
    { topic: "The war years", reason: "Her father was away during the war and it upsets her.", severity: "avoid" },
    {
      topic: "Her late husband Gennaro",
      reason: "Died in 2015. Brings smiles but can bring tears.",
      severity: "handle_gently",
    },
  ],
  occupation: "Seamstress",
  culturalBackground: "Neapolitan, Catholic, working-class Spanish Quarter",
  summary:
    "Woman born 1942 in Naples' Spanish Quarter; seamstress from 15; married 1963. Loves Sinatra, Neapolitan song, " +
    "Napoli football and cooking ragù. Speaks Neapolitan and Italian. Avoid the war; mention her late husband gently.",
};

const E = {
  sinatra: {
    id: "ve_sinatra",
    qlooId: "SAMPLE-ARTIST-SINATRA",
    name: "Frank Sinatra",
    domain: "music",
    qlooType: "urn:entity:artist",
    popularity: 0.99,
    description: "American singer and actor, the voice of the 1950s and 60s.",
    provenance: "llm-proposed-qloo-verified",
    candidateId: "c_sinatra",
  },
  carosone: {
    id: "ve_carosone",
    qlooId: "SAMPLE-ARTIST-CAROSONE",
    name: "Renato Carosone",
    domain: "music",
    qlooType: "urn:entity:artist",
    popularity: 0.81,
    description: "Neapolitan singer and pianist, 'Tu vuò fà l'americano' (1956).",
    provenance: "llm-proposed-qloo-verified",
    candidateId: "c_carosone",
  },
  modugno: {
    id: "ve_modugno",
    qlooId: "SAMPLE-ARTIST-MODUGNO",
    name: "Domenico Modugno",
    domain: "music",
    qlooType: "urn:entity:artist",
    popularity: 0.84,
    description: "Singer-songwriter of 'Nel blu, dipinto di blu' (Volare), Sanremo 1958.",
    provenance: "llm-proposed-qloo-verified",
    candidateId: "c_modugno",
  },
  oroDiNapoli: {
    id: "ve_oro",
    qlooId: "SAMPLE-MOVIE-ORO-DI-NAPOLI",
    name: "L'oro di Napoli",
    domain: "film",
    qlooType: "urn:entity:movie",
    releaseYear: 1954,
    popularity: 0.62,
    description: "Vittorio De Sica's portrait of Naples in six stories, with Sophia Loren and Totò.",
    provenance: "llm-proposed-qloo-verified",
    candidateId: "c_oro",
  },
  loren: {
    id: "ve_loren",
    qlooId: "SAMPLE-PERSON-LOREN",
    name: "Sophia Loren",
    domain: "public_figure",
    qlooType: "urn:entity:person",
    popularity: 0.95,
    description: "Actress raised in Pozzuoli, just outside Naples.",
    provenance: "llm-proposed-qloo-verified",
    candidateId: "c_loren",
  },
  sivori: {
    id: "ve_sivori",
    qlooId: "SAMPLE-PERSON-SIVORI",
    name: "Omar Sívori",
    domain: "sport",
    qlooType: "urn:entity:person",
    popularity: 0.44,
    description: "Forward who played for Napoli from 1965 to 1969.",
    provenance: "llm-proposed-qloo-verified",
    candidateId: "c_sivori",
  },
  peppino: {
    id: "ve_peppino",
    qlooId: "SAMPLE-ARTIST-PEPPINO-DI-CAPRI",
    name: "Peppino di Capri",
    domain: "music",
    qlooType: "urn:entity:artist",
    affinity: 0.91,
    popularity: 0.7,
    description: "Neapolitan crooner, 'Roberta' and 'St. Tropez Twist' (early 1960s).",
    provenance: "qloo-affinity",
    seedQlooIds: ["SAMPLE-ARTIST-SINATRA", "SAMPLE-ARTIST-CAROSONE"],
  },
  matrimonio: {
    id: "ve_matrimonio",
    qlooId: "SAMPLE-MOVIE-MATRIMONIO-ALL-ITALIANA",
    name: "Matrimonio all'italiana",
    domain: "film",
    qlooType: "urn:entity:movie",
    affinity: 0.87,
    releaseYear: 1964,
    popularity: 0.66,
    description: "Sophia Loren and Marcello Mastroianni in a Naples love story.",
    provenance: "qloo-affinity",
    seedQlooIds: ["SAMPLE-MOVIE-ORO-DI-NAPOLI", "SAMPLE-PERSON-LOREN"],
  },
  murolo: {
    id: "ve_murolo",
    qlooId: "SAMPLE-ARTIST-MUROLO",
    name: "Roberto Murolo",
    domain: "music",
    qlooType: "urn:entity:artist",
    affinity: 0.88,
    popularity: 0.58,
    description: "Gentle voice of classic Neapolitan song, with guitar.",
    provenance: "qloo-affinity",
    seedQlooIds: ["SAMPLE-ARTIST-CAROSONE"],
  },
} satisfies Record<string, VerifiedEntity>;

const DISCLAIMER_EN =
  "Rekindle suggests reminiscence activities. It is not medical advice or therapy. Follow the person's lead, " +
  "stop if they seem uncomfortable, and check with their care team about anything health-related.";

const STEPS: SessionStep[] = [
  {
    id: "s_open",
    order: 0,
    kind: "opening",
    title: "A coffee together",
    prompt: "Buongiorno Maria! Ho pensato di passare un po' di tempo insieme con la musica di Napoli. Le va?",
    promptTranslation: "Good morning Maria! I thought we could spend some time together with the music of Naples. Would you like that?",
    followUps: [],
    caregiverTip: "Sit at her eye level, smile, and let her settle. Offer a coffee if she likes.",
    durationMin: 2,
    provenance: "llm-only",
  },
  {
    id: "s_sinatra",
    order: 1,
    kind: "listen",
    title: "Frank Sinatra, 'Strangers in the Night' (1966)",
    entity: E.sinatra,
    prompt: "Ascoltiamo Sinatra insieme. Che voce, vero? Mi racconti cosa le fa venire in mente.",
    promptTranslation: "Let's listen to Sinatra together. What a voice! Tell me what it brings to mind.",
    followUps: ["Che bella da ballare, questa.", "Se le va, la cantiamo insieme."],
    caregiverTip: "Play it softly. If she sings along, sing with her rather than asking questions.",
    durationMin: 3,
    mediaHint: "Search 'Frank Sinatra Strangers in the Night 1966'",
    provenance: "qloo-grounded",
  },
  {
    id: "s_carosone",
    order: 2,
    kind: "move",
    title: "Clap along: Carosone, 'Tu vuò fà l'americano'",
    entity: E.carosone,
    prompt: "Questa è proprio allegra! Battiamo le mani a tempo?",
    promptTranslation: "This one is so cheerful! Shall we clap along?",
    followUps: ["Mi piacerebbe sentire com'era Napoli con questa musica per strada."],
    caregiverTip: "Clap first yourself. Movement from the chair is plenty.",
    durationMin: 3,
    mediaHint: "Search 'Renato Carosone Tu vuò fà l'americano 1956'",
    provenance: "qloo-grounded",
  },
  {
    id: "s_oro",
    order: 3,
    kind: "look",
    title: "Naples on screen: 'L'oro di Napoli' (1954)",
    entity: E.oroDiNapoli,
    prompt: "Guardi questa foto: Sophia Loren nei vicoli di Napoli. Che cosa le fa pensare?",
    promptTranslation: "Look at this photo: Sophia Loren in the alleys of Naples. What does it make you think of?",
    followUps: ["Che bel vestito! Mi racconti di questi tessuti.", "Lei che è sarta, che ne pensa di questo abito?"],
    caregiverTip: "Her seamstress years are a rich, positive thread: talk about fabrics and dresses.",
    durationMin: 3,
    mediaHint: "Search for a still of 'L'oro di Napoli' 1954 pizzeria scene",
    provenance: "qloo-grounded",
  },
  {
    id: "s_napoli",
    order: 4,
    kind: "talk",
    title: "Forza Napoli: the Sívori years",
    entity: E.sivori,
    prompt: "Parliamo del Napoli! Sívori e Altafini, che squadra! Mi racconti del Napoli di quegli anni.",
    promptTranslation: "Let's talk about Napoli! Sívori and Altafini, what a team! Tell me about Napoli in those years.",
    followUps: ["Dicono che lo stadio, la domenica, fosse una festa.", "Forza Napoli, sempre!"],
    caregiverTip: "If Gennaro comes up, follow her mood: smile with her, and move on gently if she becomes tearful.",
    durationMin: 3,
    provenance: "qloo-grounded",
  },
  {
    id: "s_ragu",
    order: 5,
    kind: "taste",
    title: "The smell of Sunday ragù",
    prompt: "Senta che profumo di ragù! Mi racconti il suo ragù della domenica.",
    promptTranslation: "Smell that ragù! Tell me about your Sunday ragù.",
    followUps: ["Il ragù vuole pazienza, dicono.", "Che profumo di casa."],
    caregiverTip: "A small jar of tomato sauce or fresh basil to smell works well. Check any swallowing guidance before offering food.",
    durationMin: 3,
    provenance: "llm-only",
  },
  {
    id: "s_peppino",
    order: 6,
    kind: "listen",
    title: "Peppino di Capri, 'Roberta' (1963)",
    entity: E.peppino,
    prompt: "Un'ultima canzone, dolce dolce. Chiudiamo gli occhi e ascoltiamo?",
    promptTranslation: "One last song, a gentle one. Shall we close our eyes and listen?",
    followUps: [],
    caregiverTip: "People who enjoy Sinatra and Carosone also tend to enjoy this crooner. Watch her face: a smile is the answer.",
    durationMin: 2,
    mediaHint: "Search 'Peppino di Capri Roberta 1963'",
    provenance: "qloo-grounded",
  },
  {
    id: "s_close",
    order: 7,
    kind: "closing",
    title: "Thank you, Maria",
    prompt: "Grazie Maria, è stato bellissimo cantare con lei. Lo rifacciamo presto?",
    promptTranslation: "Thank you Maria, it was lovely singing with you. Shall we do it again soon?",
    followUps: [],
    caregiverTip: "End on a warm note even if parts did not land. Note which songs made her light up.",
    durationMin: 1,
    provenance: "llm-only",
  },
];

export const SAMPLE_PLAN: SessionPlan = {
  id: "plan_sample_maria",
  title: "An afternoon in Naples",
  language: "it",
  caregiverLanguage: "en",
  steps: STEPS,
  totalMinutes: 20,
  mode: "grounded",
  disclaimer: DISCLAIMER_EN,
  generatedAt: GENERATED_AT,
  meta: {
    llmProvider: "mock",
    llmModel: "mock-llm",
    qlooMode: "mock",
    promptVersions: {
      "parse-anchors": "1.0.0",
      "propose-candidates": "1.0.0",
      "critique-items": "1.0.0",
      "compose-session": "1.0.0",
    },
    revision: 0,
  },
};

/** Full grounded run for Maria: parse -> propose -> verify -> expand -> critique -> compose. */
export const SAMPLE_GROUNDED_EVENTS: AgentEvent[] = recorded([
  [0, { type: "phase", phase: "parse", status: "started", message: "Reading your notes about Maria…" }],
  [900, { type: "anchors", anchors: SAMPLE_ANCHORS }],
  [50, { type: "note", phase: "parse", text: "Born 1942, so her formative years are roughly 1952-1972, in Naples." }],
  [50, { type: "note", phase: "parse", text: "Two sensitivities noted: avoid the war years; mention Gennaro gently." }],
  [50, { type: "phase", phase: "parse", status: "completed", message: "Understood: Naples, 1952-1972, Neapolitan and Italian.", durationMs: 1050, counts: { loves: 5, sensitivities: 2 } }],
  [100, { type: "phase", phase: "propose", status: "started", message: "Imagining the songs, films and faces of 1950s-60s Naples…" }],
  [700, { type: "candidate", candidate: { id: "c_sinatra", domain: "music", name: "Frank Sinatra", qlooType: "urn:entity:artist", year: 1966, rationale: "Stated love." } }],
  [120, { type: "candidate", candidate: { id: "c_carosone", domain: "music", name: "Renato Carosone", qlooType: "urn:entity:artist", year: 1956, rationale: "The sound of Naples when she was 14." } }],
  [120, { type: "candidate", candidate: { id: "c_modugno", domain: "music", name: "Domenico Modugno", qlooType: "urn:entity:artist", year: 1958, rationale: "Volare won Sanremo when she was 16." } }],
  [120, { type: "candidate", candidate: { id: "c_pino", domain: "music", name: "Pino Daniele", qlooType: "urn:entity:artist", year: 1977, rationale: "Iconic Neapolitan songwriter." } }],
  [120, { type: "candidate", candidate: { id: "c_festival", domain: "music", name: "Festival di Napoli 1958", qlooType: "urn:entity:album", year: 1958, rationale: "The Neapolitan song festival she would have heard on the radio." } }],
  [120, { type: "candidate", candidate: { id: "c_oro", domain: "film", name: "L'oro di Napoli", qlooType: "urn:entity:movie", year: 1954, rationale: "De Sica's love letter to Naples, with Loren." } }],
  [120, { type: "candidate", candidate: { id: "c_quattro", domain: "film", name: "Le quattro giornate di Napoli", qlooType: "urn:entity:movie", year: 1962, rationale: "Famous Naples film of her youth." } }],
  [120, { type: "candidate", candidate: { id: "c_loren", domain: "public_figure", name: "Sophia Loren", qlooType: "urn:entity:person", rationale: "Grew up near Naples; a star of her youth." } }],
  [120, { type: "candidate", candidate: { id: "c_sivori", domain: "sport", name: "Omar Sívori", qlooType: "urn:entity:person", year: 1965, rationale: "Napoli star when she was in her twenties." } }],
  [120, { type: "candidate", candidate: { id: "c_maradona", domain: "sport", name: "Diego Maradona", qlooType: "urn:entity:person", year: 1984, rationale: "Napoli's greatest legend." } }],
  [120, { type: "candidate", candidate: { id: "c_ragu", domain: "food", name: "Ragù napoletano", rationale: "Stated love; a Sunday ritual." } }],
  [50, { type: "phase", phase: "propose", status: "completed", message: "11 ideas across music, film, sport, food and famous faces.", durationMs: 1950, counts: { proposed: 11 } }],
  [100, { type: "phase", phase: "verify", status: "started", message: "Checking each idea against Qloo…" }],
  [300, { type: "qloo_call", phase: "verify", call: { endpoint: "/search", params: { query: "Frank Sinatra", types: ["urn:entity:artist"], take: 5 }, resultCount: 5, durationMs: 210, cached: false, source: "mock" } }],
  [100, { type: "verified", entity: E.sinatra }],
  [200, { type: "verified", entity: E.carosone }],
  [200, { type: "verified", entity: E.modugno }],
  [200, { type: "verified", entity: { id: "ve_pino", qlooId: "SAMPLE-ARTIST-PINO-DANIELE", name: "Pino Daniele", domain: "music", qlooType: "urn:entity:artist", popularity: 0.78, provenance: "llm-proposed-qloo-verified", candidateId: "c_pino" } }],
  [150, { type: "qloo_call", phase: "verify", call: { endpoint: "/search", params: { query: "Festival di Napoli 1958", types: ["urn:entity:album"], take: 5 }, resultCount: 0, durationMs: 180, cached: false, source: "mock" } }],
  [50, { type: "rejected", item: { label: "Festival di Napoli 1958", reason: "No confident match in Qloo; not used.", kind: "not_found", phase: "verify", domain: "music", refId: "c_festival" } }],
  [200, { type: "verified", entity: E.oroDiNapoli }],
  [200, { type: "verified", entity: { id: "ve_quattro", qlooId: "SAMPLE-MOVIE-QUATTRO-GIORNATE", name: "Le quattro giornate di Napoli", domain: "film", qlooType: "urn:entity:movie", releaseYear: 1962, popularity: 0.41, provenance: "llm-proposed-qloo-verified", candidateId: "c_quattro" } }],
  [200, { type: "verified", entity: E.loren }],
  [200, { type: "verified", entity: E.sivori }],
  [200, { type: "verified", entity: { id: "ve_maradona", qlooId: "SAMPLE-PERSON-MARADONA", name: "Diego Maradona", domain: "sport", qlooType: "urn:entity:person", popularity: 0.98, provenance: "llm-proposed-qloo-verified", candidateId: "c_maradona" } }],
  [50, { type: "note", phase: "verify", text: "Ragù is a dish, not a Qloo entity: it stays as a caregiver-led sensory step." }],
  [50, { type: "phase", phase: "verify", status: "completed", message: "9 confirmed, 1 set aside (no match for 'Festival di Napoli 1958').", durationMs: 2300, counts: { verified: 9, notFound: 1 } }],
  [100, { type: "phase", phase: "expand", status: "started", message: "Asking Qloo what else people with these tastes love, limited to 1952-1972…" }],
  [500, { type: "qloo_call", phase: "expand", call: { endpoint: "/v2/insights", params: { "filter.type": "urn:entity:artist", "signal.interests.entities": ["SAMPLE-ARTIST-SINATRA", "SAMPLE-ARTIST-CAROSONE", "SAMPLE-ARTIST-MODUGNO"], "signal.location.query": "Naples", "signal.demographics.age": "55_and_older", "filter.tags": ["urn:tag:genre:music:60s"], "bias.trends": "off", take: 10 }, resultCount: 10, durationMs: 340, cached: false, source: "mock" } }],
  [200, { type: "verified", entity: E.peppino }],
  [250, { type: "verified", entity: E.murolo }],
  [150, { type: "qloo_call", phase: "expand", call: { endpoint: "/v2/insights", params: { "filter.type": "urn:entity:movie", "signal.interests.entities": ["SAMPLE-MOVIE-ORO-DI-NAPOLI", "SAMPLE-PERSON-LOREN"], "filter.release_year.min": 1952, "filter.release_year.max": 1972, "signal.location.query": "Naples", "bias.trends": "off", take: 10 }, resultCount: 10, durationMs: 290, cached: false, source: "mock" } }],
  [100, { type: "verified", entity: E.matrimonio }],
  [50, { type: "phase", phase: "expand", status: "completed", message: "3 new era-matched discoveries from Qloo affinity.", durationMs: 1250, counts: { expanded: 3 } }],
  [100, { type: "phase", phase: "critique", status: "started", message: "Double-checking dates and anything that could upset her…" }],
  [900, { type: "rejected", item: { label: "Pino Daniele", reason: "Debuted in 1977, after her formative years. Carosone and Murolo are her era.", kind: "anachronism", phase: "critique", domain: "music", refId: "ve_pino" } }],
  [150, { type: "rejected", item: { label: "Le quattro giornate di Napoli", reason: "About the 1943 uprising during the war, which the notes ask to avoid.", kind: "emotional_risk", phase: "critique", domain: "film", refId: "ve_quattro" } }],
  [150, { type: "rejected", item: { label: "Diego Maradona", reason: "Arrived in 1984, when she was 42. Sívori (1965-69) belongs to her youth.", kind: "anachronism", phase: "critique", domain: "sport", refId: "ve_maradona" } }],
  [50, { type: "phase", phase: "critique", status: "completed", message: "Removed 2 anachronisms and 1 risky film.", durationMs: 1250, counts: { kept: 9, rejected: 3 } }],
  [100, { type: "phase", phase: "compose", status: "started", message: "Arranging a gentle 20-minute afternoon in Naples, in Italian…" }],
  ...STEPS.map((step): [number, AgentEventPayload] => [350, { type: "step", step }]),
  [100, { type: "plan", plan: SAMPLE_PLAN }],
  [0, { type: "phase", phase: "compose", status: "completed", message: "Your session is ready: 8 steps, 20 minutes.", durationMs: 2900, counts: { steps: 8 } }],
  [0, { type: "done", traceId: "sample-trace-maria", durationMs: 12800, stats: { candidates: 11, verified: 12, rejected: 4, steps: 8, llmCalls: 4, qlooCalls: 13, cacheHits: 0 } }],
]);

// ---------------------------------------------------------------------------
// LLM-only comparison run (same persona, no Qloo): no ids, images, affinity or
// release-year checks; one plausible-sounding but unverifiable title slips in.
// ---------------------------------------------------------------------------

const LLM_ONLY_STEPS: SessionStep[] = [
  { ...STEPS[0], id: "l_open" },
  {
    id: "l_sinatra",
    order: 1,
    kind: "listen",
    title: "Frank Sinatra, 'My Way' (1969)",
    prompt: "Ascoltiamo Sinatra. Le piaceva questa canzone?",
    promptTranslation: "Let's listen to Sinatra. Did you like this song?",
    followUps: [],
    durationMin: 4,
    provenance: "llm-only",
  },
  {
    id: "l_carosone",
    order: 2,
    kind: "listen",
    title: "Renato Carosone, 'Napoli Mia Bella' (1957)",
    prompt: "Questa canzone di Carosone parla di Napoli. Cosa le fa pensare?",
    promptTranslation: "This Carosone song is about Naples. What does it make you think of?",
    followUps: [],
    durationMin: 4,
    provenance: "llm-only",
  },
  {
    id: "l_football",
    order: 3,
    kind: "talk",
    title: "Maradona and the 1987 scudetto",
    prompt: "Si ricorda quando il Napoli vinse lo scudetto con Maradona?",
    promptTranslation: "Do you remember when Napoli won the league with Maradona?",
    followUps: [],
    durationMin: 4,
    provenance: "llm-only",
  },
  { ...STEPS[5], id: "l_ragu", order: 4, durationMin: 4 },
  { ...STEPS[7], id: "l_close", order: 5, durationMin: 2 },
];

export const SAMPLE_LLM_ONLY_PLAN: SessionPlan = {
  ...SAMPLE_PLAN,
  id: "plan_sample_maria_llm_only",
  steps: LLM_ONLY_STEPS,
  mode: "llm-only",
  meta: { ...SAMPLE_PLAN.meta, qlooMode: "unused" },
};

export const SAMPLE_LLM_ONLY_EVENTS: AgentEvent[] = recorded([
  [0, { type: "phase", phase: "parse", status: "started", message: "Reading your notes about Maria…" }],
  [900, { type: "anchors", anchors: SAMPLE_ANCHORS }],
  [50, { type: "phase", phase: "parse", status: "completed", message: "Understood: Naples, 1952-1972, Neapolitan and Italian.", durationMs: 950 }],
  [100, { type: "phase", phase: "propose", status: "started", message: "Brainstorming from the language model alone…" }],
  [1200, { type: "phase", phase: "propose", status: "completed", message: "8 ideas proposed (unverified).", durationMs: 1200, counts: { proposed: 8 } }],
  [0, { type: "phase", phase: "verify", status: "skipped", message: "LLM-only mode: nothing is checked against Qloo." }],
  [0, { type: "phase", phase: "expand", status: "skipped", message: "LLM-only mode: no cross-domain discoveries." }],
  [100, { type: "phase", phase: "critique", status: "started", message: "Self-checking for risky topics…" }],
  [800, { type: "phase", phase: "critique", status: "completed", message: "No issues found.", durationMs: 800, counts: { kept: 8, rejected: 0 } }],
  [100, { type: "phase", phase: "compose", status: "started", message: "Arranging the session…" }],
  ...LLM_ONLY_STEPS.map((step): [number, AgentEventPayload] => [300, { type: "step", step }]),
  [100, { type: "plan", plan: SAMPLE_LLM_ONLY_PLAN }],
  [0, { type: "phase", phase: "compose", status: "completed", message: "Session ready: 6 steps, 22 minutes.", durationMs: 1900 }],
  [0, { type: "done", traceId: "sample-trace-maria-llm", durationMs: 5900, stats: { candidates: 8, verified: 0, rejected: 0, steps: 6, llmCalls: 4, qlooCalls: 0, cacheHits: 0 } }],
]);

// ---------------------------------------------------------------------------
// Replan: caregiver taps "upset" on step s_oro (the film still).
// ---------------------------------------------------------------------------

const MUROLO_STEP: SessionStep = {
  id: "s_murolo",
  order: 4,
  kind: "listen",
  title: "Roberto Murolo, 'Era de maggio'",
  entity: E.murolo,
  prompt: "Facciamo una pausa con una canzone dolce. Chiuda gli occhi, se vuole.",
  promptTranslation: "Let's take a pause with a gentle song. Close your eyes if you like.",
  followUps: [],
  caregiverTip: "Hold her hand if she welcomes it. No questions for a minute: just listen together.",
  durationMin: 3,
  mediaHint: "Search 'Roberto Murolo Era de maggio'",
  provenance: "qloo-grounded",
};

export const SAMPLE_REPLANNED_PLAN: SessionPlan = {
  ...SAMPLE_PLAN,
  steps: [
    ...STEPS.slice(0, 4),
    MUROLO_STEP,
    ...STEPS.slice(5).map((s, i) => ({ ...s, order: 5 + i })),
  ],
  meta: { ...SAMPLE_PLAN.meta, revision: 1 },
};

export const SAMPLE_REPLAN_REQUEST_STEP_ID = "s_oro";

export const SAMPLE_REPLAN_EVENTS: AgentEvent[] = recorded([
  [0, { type: "phase", phase: "replan", status: "started", message: "She seemed upset. Adjusting what comes next…" }],
  [700, { type: "note", phase: "replan", text: "The film scene may have brought back Gennaro. Slowing down with something soothing and familiar." }],
  [100, { type: "rejected", item: { label: "Forza Napoli: the Sívori years", reason: "Football talk often leads to Gennaro; skipped for now.", kind: "emotional_risk", phase: "replan", domain: "sport", refId: "s_napoli" } }],
  [400, { type: "step", step: MUROLO_STEP }],
  [100, { type: "plan", plan: SAMPLE_REPLANNED_PLAN }],
  [0, { type: "phase", phase: "replan", status: "completed", message: "Next up: a gentle song by Roberto Murolo.", durationMs: 1300 }],
  [0, { type: "done", traceId: "sample-trace-maria-replan", durationMs: 1300, stats: { candidates: 0, verified: 0, rejected: 1, steps: 1, llmCalls: 1, qlooCalls: 0, cacheHits: 0 } }],
]);
