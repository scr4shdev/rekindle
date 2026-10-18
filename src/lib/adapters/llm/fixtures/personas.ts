/**
 * Hand-authored mock LLM outputs for the three demo personas
 * (src/lib/personas.ts). Maria's match src/lib/domain/sample-events.ts.
 * Persona detection in the mock is by exact equality (notes, or the anchors
 * summary), never by interpreting text.
 */
import { SAMPLE_ANCHORS } from "@/lib/domain/sample-events";
import type { CritiqueItemsOutput } from "@/lib/prompts/critique-items";
import type { ParseAnchorsOutput } from "@/lib/prompts/parse-anchors";
import type { ProposeCandidatesOutput } from "@/lib/prompts/propose-candidates";

export type PersonaSlug = "maria" | "seamus" | "fatima";

/** A hand-written step for a material (session language prompt plus caregiver-language text). */
export interface StepTemplate {
  kind: "listen" | "look" | "talk" | "taste" | "move";
  title: string;
  prompt: string;
  translation: string;
  followUps: string[];
  tip: string;
  mediaHint: string;
  minutes: number;
}

export interface PersonaFixture {
  parse: ParseAnchorsOutput;
  propose: ProposeCandidatesOutput;
  /** Critique verdicts by exact item label. Items not listed fall back to the generic year rules. */
  critique: Record<string, { kind: CritiqueItemsOutput["verdicts"][number]["kind"]; reason: string }>;
  title: string;
  opening: Omit<StepTemplate, "kind" | "minutes">;
  closing: Omit<StepTemplate, "kind" | "minutes">;
  /** Calming step used by the mock replan after an "upset" reaction. */
  calm: StepTemplate;
  /** Preferred materials, in plan order (by exact label). */
  planOrder: string[];
  steps: Record<string, StepTemplate>;
}

type C = ProposeCandidatesOutput["candidates"][number];
const c = (domain: C["domain"], name: string, qlooType: C["qlooType"], year: number, rationale: string): C => ({ domain, name, qlooType, year, rationale });

const MARIA: PersonaFixture = {
  parse: {
    birthYear: SAMPLE_ANCHORS.birthYear,
    birthYearSource: "stated",
    places: SAMPLE_ANCHORS.places.map((p) => ({ name: p.name, countryCode: p.countryCode ?? "", role: p.role, fromYear: p.fromYear ?? 0, toYear: p.toYear ?? 0 })),
    languages: SAMPLE_ANCHORS.languages,
    loves: SAMPLE_ANCHORS.loves,
    sensitivities: SAMPLE_ANCHORS.sensitivities,
    occupation: SAMPLE_ANCHORS.occupation ?? "",
    culturalBackground: SAMPLE_ANCHORS.culturalBackground ?? "",
    summary: SAMPLE_ANCHORS.summary,
    privateNames: ["Maria", "Gennaro"],
    notes: ["Two sensitivities noted: avoid the war years; mention Gennaro gently."],
  },
  propose: {
    candidates: [
      c("music", "Frank Sinatra", "urn:entity:artist", 1966, "Stated love."),
      c("music", "Renato Carosone", "urn:entity:artist", 1956, "The sound of Naples when she was 14."),
      c("music", "Domenico Modugno", "urn:entity:artist", 1958, "Volare won Sanremo when she was 16."),
      c("music", "Pino Daniele", "urn:entity:artist", 1977, "Iconic Neapolitan songwriter."),
      c("music", "Festival di Napoli 1958", "urn:entity:album", 1958, "The Neapolitan song festival she would have heard on the radio."),
      c("film", "L'oro di Napoli", "urn:entity:movie", 1954, "De Sica's love letter to Naples, with Loren."),
      c("film", "Le quattro giornate di Napoli", "urn:entity:movie", 1962, "Famous Naples film of her youth."),
      c("public_figure", "Sophia Loren", "urn:entity:person", 0, "Grew up near Naples; a star of her youth."),
      c("sport", "Omar Sívori", "urn:entity:person", 1965, "Napoli star when she was in her twenties."),
      c("sport", "Diego Maradona", "urn:entity:person", 1984, "Napoli's greatest legend."),
      c("food", "Ragù napoletano", "none", 0, "Stated love; a Sunday ritual."),
    ],
    notes: ["Starting from Sinatra, Neapolitan song, Napoli and Sunday ragù."],
  },
  critique: {
    "Pino Daniele": { kind: "anachronism", reason: "Debuted in 1977, after her formative years. Carosone and Murolo are her era." },
    "Le quattro giornate di Napoli": { kind: "emotional_risk", reason: "About the 1943 uprising during the war, which the notes ask to avoid." },
    "Diego Maradona": { kind: "anachronism", reason: "Arrived in 1984, when she was 42. Sívori (1965-69) belongs to her youth." },
    "Nino D'Angelo": { kind: "anachronism", reason: "Famous from 1982, when she was 40: after her formative years." },
  },
  title: "Un pomeriggio a Napoli",
  opening: {
    title: "Un caffè insieme",
    prompt: "Buongiorno Maria! Ho pensato di passare un po' di tempo insieme con la musica di Napoli. Le va?",
    translation: "Good morning Maria! I thought we could spend some time together with the music of Naples. Would you like that?",
    followUps: [],
    tip: "Sit at her eye level, smile, and let her settle. Offer a coffee if she likes.",
    mediaHint: "",
  },
  closing: {
    title: "Grazie, Maria",
    prompt: "Grazie Maria, è stato bellissimo cantare con lei. Lo rifacciamo presto?",
    translation: "Thank you Maria, it was lovely singing with you. Shall we do it again soon?",
    followUps: [],
    tip: "End on a warm note even if parts did not land. Note which songs made her light up.",
    mediaHint: "",
  },
  calm: {
    kind: "listen", minutes: 3, title: "Una pausa dolce",
    prompt: "Facciamo una pausa con una canzone dolce, di quelle di casa. Chiuda gli occhi, se vuole.",
    translation: "Let's take a pause with a gentle song from home. Close your eyes if you like.",
    followUps: [],
    tip: "Hold her hand if she welcomes it. No questions for a minute: just listen together.",
    mediaHint: "Search 'Roberto Murolo Era de maggio'",
  },
  planOrder: ["Frank Sinatra", "Renato Carosone", "L'oro di Napoli", "Omar Sívori", "Ragù napoletano", "Peppino di Capri"],
  steps: {
    "Frank Sinatra": {
      kind: "listen", minutes: 3, title: "Frank Sinatra, 'Strangers in the Night' (1966)",
      prompt: "Ascoltiamo Sinatra. Che voce, vero? Mi racconti cosa le fa venire in mente.",
      translation: "Let's listen to Sinatra. What a voice! Tell me what it brings to mind.",
      followUps: ["Se le va, ondeggiamo un po' a tempo.", "Che bella questa musica da ballare."],
      tip: "Play it softly. If she sings along, sing with her rather than asking questions.",
      mediaHint: "Search 'Frank Sinatra Strangers in the Night 1966'",
    },
    "Renato Carosone": {
      kind: "move", minutes: 3, title: "Clap along: Carosone, 'Tu vuò fà l'americano'",
      prompt: "Questa è proprio allegra! Battiamo le mani a tempo?",
      translation: "This one is so cheerful! Shall we clap along?",
      followUps: ["Questa musica sa proprio di Napoli."],
      tip: "Clap first yourself. Movement from the chair is plenty.",
      mediaHint: "Search 'Renato Carosone Tu vuò fà l'americano 1956'",
    },
    "L'oro di Napoli": {
      kind: "look", minutes: 3, title: "Naples on screen: 'L'oro di Napoli' (1954)",
      prompt: "Guardi questa foto: Sophia Loren nei vicoli di Napoli. Che cosa le fa pensare?",
      translation: "Look at this photo: Sophia Loren in the alleys of Naples. What does it make you think of?",
      followUps: ["Che bei vestiti in questa foto.", "Le piacciono questi tessuti?"],
      tip: "Her seamstress years are a rich, positive thread: talk about fabrics and dresses.",
      mediaHint: "Search for a still of 'L'oro di Napoli' 1954 pizzeria scene",
    },
    "Omar Sívori": {
      kind: "talk", minutes: 3, title: "Forza Napoli: the Sívori years",
      prompt: "Parliamo del Napoli! Sívori e Altafini, che squadra! Mi racconti del Napoli di quegli anni.",
      translation: "Let's talk about Napoli! Sívori and Altafini, what a team! Tell me about Napoli in those years.",
      followUps: ["Che passione, il Napoli!", "Se le va, mi racconti del Napoli: la ascolto volentieri."],
      tip: "If Gennaro comes up, follow her mood: smile with her, and move on gently if she becomes tearful.",
      mediaHint: "Search 'Sívori Napoli 1966 photo'",
    },
    "Ragù napoletano": {
      kind: "taste", minutes: 3, title: "The smell of Sunday ragù",
      prompt: "Senta che profumo di ragù! Se le va, mi racconti come si prepara.",
      translation: "Smell that ragù! If you like, tell me how it is made.",
      followUps: ["Che profumo di domenica!", "Mi piacerebbe imparare il suo ragù, se ha voglia di raccontarmelo."],
      tip: "A small jar of tomato sauce or fresh basil to smell works well. Check any swallowing guidance before offering food.",
      mediaHint: "",
    },
    "Peppino di Capri": {
      kind: "listen", minutes: 2, title: "Peppino di Capri, 'Roberta' (1963)",
      prompt: "Un'ultima canzone, dolce dolce. Chiudiamo gli occhi e ascoltiamo?",
      translation: "One last song, a gentle one. Shall we close our eyes and listen?",
      followUps: [],
      tip: "People who enjoy Sinatra and Carosone also tend to enjoy this crooner. Watch her face: a smile is the answer.",
      mediaHint: "Search 'Peppino di Capri Roberta 1963'",
    },
    "Roberto Murolo": {
      kind: "listen", minutes: 3, title: "Roberto Murolo, 'Era de maggio'",
      prompt: "Facciamo una pausa con una canzone dolce. Chiuda gli occhi, se vuole.",
      translation: "Let's take a pause with a gentle song. Close your eyes if you like.",
      followUps: [],
      tip: "Hold her hand if she welcomes it. No questions for a minute: just listen together.",
      mediaHint: "Search 'Roberto Murolo Era de maggio'",
    },
  },
};

const SEAMUS: PersonaFixture = {
  parse: {
    birthYear: 1938,
    birthYearSource: "stated",
    places: [
      { name: "Cork", countryCode: "IE", role: "birthplace", fromYear: 1938, toYear: 0 },
      { name: "Cork", countryCode: "IE", role: "adulthood", fromYear: 0, toYear: 0 },
    ],
    languages: [
      { tag: "en", name: "English" },
      { tag: "ga", name: "Irish" },
    ],
    loves: [
      { label: "Hurling", domain: "sport", source: "stated" },
      { label: "Glen Rovers", domain: "sport", source: "stated" },
      { label: "Showband dances", domain: "music", source: "stated" },
      { label: "Westerns at the pictures", domain: "film", source: "stated" },
      { label: "The radio", domain: "other", source: "stated" },
    ],
    sensitivities: [
      { topic: "His brother's emigration to England", reason: "They lost touch; best not to bring it up.", severity: "avoid" },
    ],
    occupation: "Worker at the Ford factory on the Marina, Cork",
    culturalBackground: "Irish, Cork city northside, working class",
    summary:
      "Man born 1938 on Cork's northside; worked at the Ford plant for over 30 years. Mad about hurling and Glen Rovers; " +
      "danced to the showbands in the late 50s and 60s, where he met his wife. Loved westerns and the radio. " +
      "Speaks English and some Irish. Avoid his brother's emigration.",
    privateNames: ["Seamus"],
    notes: ["One topic to avoid: his brother's emigration to England."],
  },
  propose: {
    candidates: [
      c("music", "Royal Showband", "urn:entity:artist", 1960, "The showband of the dance halls when he was courting."),
      c("music", "Brendan Bowyer", "urn:entity:artist", 1965, "'The Hucklebuck' filled every dance hall."),
      c("music", "Jim Reeves", "urn:entity:artist", 1962, "Hugely popular on Irish radio in the early 60s."),
      c("music", "Bridie Gallagher", "urn:entity:artist", 1956, "The girl from Donegal, a radio favourite."),
      c("music", "U2", "urn:entity:artist", 1980, "Ireland's biggest band."),
      c("film", "The Quiet Man", "urn:entity:movie", 1952, "John Wayne in the west of Ireland, when he was 14."),
      c("film", "Shane", "urn:entity:movie", 1953, "A classic western of his teens."),
      c("film", "High Noon", "urn:entity:movie", 1952, "Gary Cooper, the western everyone saw."),
      c("film", "The Searchers", "urn:entity:movie", 1956, "John Wayne at his best."),
      c("television", "The Riordans", "urn:entity:tv_show", 1965, "RTÉ's rural drama, watched all over Ireland."),
      c("sport", "Christy Ring", "urn:entity:person", 1955, "Glen Rovers and Cork's hurling legend."),
      c("sport", "Glen Rovers", "urn:entity:brand", 1955, "His hurling club on the northside."),
      c("public_figure", "John Wayne", "urn:entity:person", 0, "The star of his westerns."),
    ],
    notes: ["Showbands, westerns and Glen Rovers hurling, Cork 1948-1968."],
  },
  critique: {
    "Bridie Gallagher": { kind: "emotional_risk", reason: "Her best-known songs are emigrant ballads, which may bring up his brother." },
    U2: { kind: "anachronism", reason: "Formed in 1976, when he was 38: after his dance-hall years." },
  },
  title: "A night at the dance hall",
  opening: {
    title: "A cup of tea together",
    prompt: "Hello Seamus! I brought some music from the dance halls. Will we have a listen together?",
    translation: "",
    followUps: [],
    tip: "Sit beside him, not opposite. Let him settle before the music starts.",
    mediaHint: "",
  },
  closing: {
    title: "Thanks, Seamus",
    prompt: "That was a great afternoon, Seamus. Thanks for the company.",
    translation: "",
    followUps: [],
    tip: "End warmly. Note which songs or stories got him talking.",
    mediaHint: "",
  },
  calm: {
    kind: "listen", minutes: 4, title: "A quiet one",
    prompt: "Let's have a quiet one now. Sit back and listen with me.",
    translation: "", followUps: [],
    tip: "Lower the volume and sit close. No questions for a while.",
    mediaHint: "Search 'Jim Reeves I Love You Because'",
  },
  planOrder: ["The Royal Showband", "The Quiet Man", "Christy Ring", "Jim Reeves", "Dickie Rock"],
  steps: {
    "The Royal Showband": {
      kind: "move", minutes: 5, title: "The Royal Showband, 'The Hucklebuck'",
      prompt: "Here's the Royal Showband. Tap your foot along with me!",
      translation: "", followUps: ["Tell me about the dance halls, if you like."],
      tip: "Tapping or clapping from the chair is plenty. If he starts telling you about the dances, let the music play on softly.",
      mediaHint: "Search 'Royal Showband The Hucklebuck 1965'",
    },
    "The Quiet Man": {
      kind: "look", minutes: 4, title: "'The Quiet Man' (1952)",
      prompt: "Look at this: John Wayne and Maureen O'Hara in the west of Ireland. What do you make of it?",
      translation: "", followUps: ["I love these old westerns. Shall we look at another one?"],
      tip: "Show a still or the poster. If he enjoys it, a short clip of the horse race works well.",
      mediaHint: "Search 'The Quiet Man 1952 still'",
    },
    "Christy Ring": {
      kind: "talk", minutes: 5, title: "Hurling: Christy Ring and the Glen",
      prompt: "Christy Ring, what a hurler! I'd love to hear about hurling, if you feel like it.",
      translation: "", followUps: ["Here's a hurley to hold, if you'd like.", "Tell me about the Glen, if you like."],
      tip: "A hurley or a sliotar to hold can spark stories. Let him lead; there is no wrong answer.",
      mediaHint: "Search 'Christy Ring Glen Rovers photo'",
    },
    "Jim Reeves": {
      kind: "listen", minutes: 4, title: "Jim Reeves, 'He'll Have to Go'",
      prompt: "A bit of Jim Reeves now. Lovely and easy. How does it make you feel?",
      translation: "", followUps: [],
      tip: "Keep the volume low and just enjoy it together.",
      mediaHint: "Search 'Jim Reeves He'll Have to Go 1960'",
    },
    "Dickie Rock": {
      kind: "listen", minutes: 4, title: "Dickie Rock and the Miami Showband",
      prompt: "One more from the showbands: Dickie Rock. Shall we listen?",
      translation: "", followUps: [],
      tip: "People who enjoy the Royal Showband also tend to enjoy Dickie Rock. Watch his face: a smile is the answer.",
      mediaHint: "Search 'Dickie Rock Miami Showband 1960s'",
    },
  },
};

const FATIMA: PersonaFixture = {
  parse: {
    birthYear: 1950,
    birthYearSource: "stated",
    places: [
      { name: "Fès", countryCode: "MA", role: "birthplace", fromYear: 1950, toYear: 1972 },
      { name: "Brussels", countryCode: "BE", role: "adulthood", fromYear: 1972, toYear: 0 },
    ],
    languages: [
      { tag: "ary", name: "Moroccan Arabic (Darija)" },
      { tag: "fr", name: "French" },
    ],
    loves: [
      { label: "Oum Kalthoum", domain: "music", source: "stated" },
      { label: "Abdelhalim Hafez", domain: "music", source: "stated" },
      { label: "Egyptian black-and-white films", domain: "film", source: "stated" },
      { label: "Mint tea", domain: "food", source: "stated" },
      { label: "Msemen", domain: "food", source: "stated" },
    ],
    sensitivities: [
      { topic: "Alcohol", reason: "She is a practising Muslim: nothing with alcohol.", severity: "avoid" },
      { topic: "Her first years in Brussels", reason: "They were very lonely; go gently around that time.", severity: "handle_gently" },
    ],
    occupation: "",
    culturalBackground: "Moroccan, grew up in the Fès medina; practising Muslim; in Brussels since 1972",
    summary:
      "Woman born 1950 in Fès, grew up in the medina; moved to Brussels in 1972. Loves Oum Kalthoum, Abdelhalim Hafez and " +
      "Egyptian black-and-white films; makes mint tea and msemen every morning. Speaks Darija and French. " +
      "Nothing with alcohol; go gently around her lonely first years in Brussels.",
    privateNames: ["Fatima"],
    notes: ["Two sensitivities noted: no alcohol; her first lonely years in Brussels."],
  },
  propose: {
    candidates: [
      c("music", "Oum Kalthoum", "urn:entity:artist", 1964, "Stated love; 'Enta Omri' came out when she was 14."),
      c("music", "Abdel Halim Hafez", "urn:entity:artist", 1960, "Stated love; the voice of her teenage years."),
      c("music", "Farid al-Atrash", "urn:entity:artist", 1960, "Musical films she would have seen in Fès."),
      c("music", "Nass El Ghiwane", "urn:entity:artist", 1971, "The Moroccan sound of her early twenties."),
      c("music", "Cheb Khaled", "urn:entity:artist", 1992, "The king of raï."),
      c("film", "Al-Khataya", "urn:entity:movie", 1962, "Abdelhalim Hafez on screen, black and white."),
      c("film", "Abi Foq al-Shagara", "urn:entity:movie", 1969, "A huge hit in Moroccan cinemas."),
      c("film", "Doa al-Karawan", "urn:entity:movie", 1959, "Faten Hamama classic."),
      c("public_figure", "Faten Hamama", "urn:entity:person", 0, "The star of the Egyptian films she loved."),
      c("public_figure", "Omar Sharif", "urn:entity:person", 0, "Faten Hamama's screen partner."),
      c("food", "Moroccan mint tea", "none", 0, "Stated love; her morning ritual."),
      c("food", "Msemen", "none", 0, "Stated love; made every morning."),
      c("food", "Stella Artois", "urn:entity:brand", 1970, "Brussels' everyday brand."),
    ],
    notes: ["Fès 1960-1980: Egyptian song and cinema, then Brussels."],
  },
  critique: {
    "Stella Artois": { kind: "emotional_risk", reason: "A beer brand: the notes ask for nothing with alcohol." },
    Khaled: { kind: "anachronism", reason: "Became famous in the late 1980s and 90s, after her formative years." },
  },
  title: "Un après-midi à Fès",
  opening: {
    title: "Un thé ensemble",
    prompt: "Bonjour Fatima ! J'ai apporté un peu de musique d'Égypte et de Fès. On écoute ensemble ?",
    translation: "Hello Fatima! I brought some music from Egypt and Fès. Shall we listen together?",
    followUps: [],
    tip: "Greet her in Darija if you can (\"Salam, labas?\"). Let her settle before starting.",
    mediaHint: "",
  },
  closing: {
    title: "Merci, Fatima",
    prompt: "Merci Fatima, c'était un très beau moment avec vous.",
    translation: "Thank you Fatima, that was a lovely moment with you.",
    followUps: [],
    tip: "End warmly. Note which songs made her smile.",
    mediaHint: "",
  },
  calm: {
    kind: "listen", minutes: 3, title: "Une pause douce",
    prompt: "Faisons une petite pause avec une musique douce. Fermez les yeux si vous voulez.",
    translation: "Let's take a little pause with some gentle music. Close your eyes if you like.",
    followUps: [],
    tip: "Sit close and hold her hand if she welcomes it. A glass of water or mint to smell can help.",
    mediaHint: "Search 'Fairuz Ya Mersal El Merasil'",
  },
  planOrder: ["Oum Kalthoum", "Faten Hamama", "Moroccan mint tea", "Abdelhalim Hafez", "Warda Al-Jazairia"],
  steps: {
    "Oum Kalthoum": {
      kind: "listen", minutes: 4, title: "Oum Kalthoum, 'Enta Omri' (1964)",
      prompt: "Écoutons Oum Kalthoum. Quelle voix ! Qu'est-ce que cette chanson vous évoque ?",
      translation: "Let's listen to Oum Kalthoum. What a voice! What does this song bring to mind?",
      followUps: ["Fermez les yeux et laissez-vous porter, si vous voulez."],
      tip: "Her songs are long: play just the opening few minutes, softly.",
      mediaHint: "Search 'Oum Kalthoum Enta Omri 1964'",
    },
    "Faten Hamama": {
      kind: "look", minutes: 4, title: "Faten Hamama on screen",
      prompt: "Regardez cette photo de Faten Hamama. Qu'est-ce que vous remarquez ?",
      translation: "Look at this photo of Faten Hamama. What do you notice?",
      followUps: ["Si vous voulez, racontez-moi le cinéma à Fès."],
      tip: "A black-and-white still works best. Let her talk about the cinema of the medina if she wishes.",
      mediaHint: "Search 'Faten Hamama 1960s black and white photo'",
    },
    "Moroccan mint tea": {
      kind: "taste", minutes: 4, title: "Mint tea, the morning ritual",
      prompt: "Sentez cette menthe fraîche. Vous me montrez comment vous préparez le thé ?",
      translation: "Smell this fresh mint. Will you show me how you make the tea?",
      followUps: ["Vous me montrez votre façon de servir le thé ?"],
      tip: "Fresh mint to smell is enough. Check any swallowing or diet guidance before offering tea.",
      mediaHint: "",
    },
    "Abdelhalim Hafez": {
      kind: "move", minutes: 4, title: "Sway along: Abdelhalim Hafez",
      prompt: "Abdelhalim Hafez ! On se balance doucement avec la musique ?",
      translation: "Abdelhalim Hafez! Shall we sway gently with the music?",
      followUps: [],
      tip: "Gentle hand movements from the chair are plenty.",
      mediaHint: "Search 'Abdelhalim Hafez Ahwak'",
    },
    "Warda Al-Jazairia": {
      kind: "listen", minutes: 2, title: "Warda Al-Jazairia",
      prompt: "Une dernière chanson, toute douce : Warda. On l'écoute ?",
      translation: "One last gentle song: Warda. Shall we listen?",
      followUps: [],
      tip: "People who enjoy Oum Kalthoum and Abdelhalim Hafez also tend to enjoy Warda. A smile is the answer.",
      mediaHint: "Search 'Warda Al-Jazairia 1970s'",
    },
  },
};

export const PERSONA_FIXTURES: Record<PersonaSlug, PersonaFixture> = { maria: MARIA, seamus: SEAMUS, fatima: FATIMA };
