/**
 * Generic mock material for custom input (no persona match). The mock LLM
 * does not interpret notes: it only uses the structured fields (birth year,
 * birth place, languages) and these internationally known, era-tagged items,
 * which exist in the mock Qloo catalog ("generic" group).
 */
import type { ProposeCandidatesOutput } from "@/lib/prompts/propose-candidates";

type C = ProposeCandidatesOutput["candidates"][number];

export const GENERIC_CANDIDATES: ReadonlyArray<Omit<C, "rationale">> = [
  { domain: "music", name: "Bing Crosby", qlooType: "urn:entity:artist", year: 1942, lifePhase: "none" },
  { domain: "music", name: "Édith Piaf", qlooType: "urn:entity:artist", year: 1946, lifePhase: "none" },
  { domain: "music", name: "Nat King Cole", qlooType: "urn:entity:artist", year: 1951, lifePhase: "none" },
  { domain: "music", name: "The Beatles", qlooType: "urn:entity:artist", year: 1963, lifePhase: "none" },
  { domain: "music", name: "The Rolling Stones", qlooType: "urn:entity:artist", year: 1965, lifePhase: "none" },
  { domain: "music", name: "ABBA", qlooType: "urn:entity:artist", year: 1974, lifePhase: "none" },
  { domain: "music", name: "Bob Marley", qlooType: "urn:entity:artist", year: 1977, lifePhase: "none" },
  { domain: "music", name: "Michael Jackson", qlooType: "urn:entity:artist", year: 1982, lifePhase: "none" },
  { domain: "music", name: "Madonna", qlooType: "urn:entity:artist", year: 1985, lifePhase: "none" },
  { domain: "film", name: "Casablanca", qlooType: "urn:entity:movie", year: 1942, lifePhase: "none" },
  { domain: "film", name: "Roman Holiday", qlooType: "urn:entity:movie", year: 1953, lifePhase: "none" },
  { domain: "film", name: "Breakfast at Tiffany's", qlooType: "urn:entity:movie", year: 1961, lifePhase: "none" },
  { domain: "film", name: "The Sound of Music", qlooType: "urn:entity:movie", year: 1965, lifePhase: "none" },
  { domain: "film", name: "Star Wars", qlooType: "urn:entity:movie", year: 1977, lifePhase: "none" },
  { domain: "film", name: "E.T. the Extra-Terrestrial", qlooType: "urn:entity:movie", year: 1982, lifePhase: "none" },
  { domain: "film", name: "Titanic", qlooType: "urn:entity:movie", year: 1997, lifePhase: "none" },
  { domain: "television", name: "I Love Lucy", qlooType: "urn:entity:tv_show", year: 1952, lifePhase: "none" },
  { domain: "television", name: "Bonanza", qlooType: "urn:entity:tv_show", year: 1962, lifePhase: "none" },
  { domain: "television", name: "Dallas", qlooType: "urn:entity:tv_show", year: 1980, lifePhase: "none" },
  { domain: "public_figure", name: "Charlie Chaplin", qlooType: "urn:entity:person", year: 1936, lifePhase: "none" },
  { domain: "public_figure", name: "Marilyn Monroe", qlooType: "urn:entity:person", year: 1955, lifePhase: "none" },
  { domain: "public_figure", name: "Audrey Hepburn", qlooType: "urn:entity:person", year: 1958, lifePhase: "none" },
  { domain: "sport", name: "Pelé", qlooType: "urn:entity:person", year: 1962, lifePhase: "none" },
  { domain: "sport", name: "Muhammad Ali", qlooType: "urn:entity:person", year: 1974, lifePhase: "none" },
];

/** How far outside the formative window a generic item may be and still be proposed. */
export const GENERIC_YEAR_TOLERANCE = 3;

type Lang = "en" | "it" | "fr";
type Kind = "opening" | "listen" | "look" | "talk" | "taste" | "closing" | "calm";

/** Generic sentence templates per language. `{name}` is the label, `{who}` the person's name (may be empty). */
export const GENERIC_TEXT: Record<Lang, Record<Kind, { title: string; prompt: string; tip: string }>> = {
  en: {
    opening: { title: "Settling in", prompt: "Hello{who}! I thought we could spend a little time together with music and pictures from the old days.", tip: "Sit at eye level, smile, and let them settle." },
    listen: { title: "Listen: {name}", prompt: "Let's listen to {name} together. How does this music make you feel?", tip: "Play it softly. If they sing along, sing with them." },
    look: { title: "Look: {name}", prompt: "Here is a picture of {name}. What do you notice?", tip: "Show a large, clear picture. Let them take their time." },
    talk: { title: "Talk: {name}", prompt: "Let's talk about {name}. Tell me about it, if you like.", tip: "Follow their lead; there is no wrong answer." },
    taste: { title: "Taste: {name}", prompt: "Smell this. What does it bring to mind?", tip: "Check any swallowing or diet guidance before offering food or drink." },
    closing: { title: "Thank you", prompt: "Thank you{who}, I really enjoyed this time with you.", tip: "End on a warm note. Note what made them light up." },
    calm: { title: "A gentle pause", prompt: "Let's take a little pause with some gentle music you know well. Close your eyes if you like.", tip: "Sit close and lower the volume. No questions for a while." },
  },
  it: {
    opening: { title: "Un momento insieme", prompt: "Buongiorno{who}! Ho pensato di passare un po' di tempo insieme con musica e immagini di una volta.", tip: "Sedetevi alla stessa altezza e sorridete." },
    listen: { title: "Ascolto: {name}", prompt: "Ascoltiamo insieme {name}. Che cosa le fa venire in mente questa musica?", tip: "Volume basso. Se canta, cantate con lei o lui." },
    look: { title: "Guardiamo: {name}", prompt: "Ecco un'immagine di {name}. Che cosa nota?", tip: "Un'immagine grande e chiara. Senza fretta." },
    talk: { title: "Parliamo: {name}", prompt: "Parliamo di {name}. Me ne racconti, se le va.", tip: "Seguite il suo ritmo; non ci sono risposte sbagliate." },
    taste: { title: "Profumi: {name}", prompt: "Senta questo profumo. Che cosa le ricorda?", tip: "Verificate eventuali indicazioni su deglutizione e dieta." },
    closing: { title: "Grazie", prompt: "Grazie{who}, è stato un bel momento insieme.", tip: "Chiudete con calore." },
    calm: { title: "Una pausa dolce", prompt: "Facciamo una piccola pausa con una musica dolce. Chiuda gli occhi, se vuole.", tip: "Sedetevi vicino, volume basso. Niente domande per un po'." },
  },
  fr: {
    opening: { title: "Un moment ensemble", prompt: "Bonjour{who} ! J'ai pensé qu'on pourrait passer un moment ensemble avec de la musique et des images d'autrefois.", tip: "Asseyez-vous à sa hauteur et souriez." },
    listen: { title: "Écoute : {name}", prompt: "Écoutons ensemble {name}. Qu'est-ce que cette musique vous évoque ?", tip: "Volume doux. S'il ou elle chante, chantez aussi." },
    look: { title: "Regardons : {name}", prompt: "Voici une image de {name}. Qu'est-ce que vous remarquez ?", tip: "Une grande image nette. Prenez votre temps." },
    talk: { title: "Parlons : {name}", prompt: "Parlons de {name}. Racontez-moi, si vous voulez.", tip: "Suivez son rythme ; il n'y a pas de mauvaise réponse." },
    taste: { title: "Saveurs : {name}", prompt: "Sentez ceci. Qu'est-ce que cela vous rappelle ?", tip: "Vérifiez les consignes de déglutition et de régime." },
    closing: { title: "Merci", prompt: "Merci{who}, c'était un beau moment ensemble.", tip: "Terminez chaleureusement." },
    calm: { title: "Une pause douce", prompt: "Faisons une petite pause avec une musique douce. Fermez les yeux si vous voulez.", tip: "Asseyez-vous près, volume bas. Pas de questions pendant un moment." },
  },
};

export function genericLang(tag: string): Lang {
  const base = tag.toLowerCase().split("-")[0];
  return base === "it" || base === "fr" ? base : "en";
}
