/**
 * Three demo personas for one-tap judging. Fictional people, written to be
 * culturally authentic to their era and place. Safe for client import.
 */
import type { PersonInputDraft } from "@/lib/domain/types";

export interface DemoPersona {
  /** Stable slug, used in URLs (/session?persona=maria) and mock fixtures. */
  slug: "maria" | "seamus" | "fatima";
  /**
   * Card copy for the landing page (caregiver language: English).
   * `scenario` names the caregiver's situation in one short line (who is
   * running the session, who the elder is), so a judge perceives the Impact
   * story before the biographical tagline.
   */
  card: { name: string; tagline: string; flag: string; scenario: string };
  input: PersonInputDraft;
}

export const PERSONAS: readonly DemoPersona[] = [
  {
    slug: "fatima",
    card: {
      name: "Fatima, 76",
      tagline: "Fès, born 1950, Brussels since 1972. Oum Kalthoum, mint tea.",
      flag: "MA",
      scenario: "An English-reading care aide. A Moroccan elder from 1960s Fès. No shared culture to lean on.",
    },
    input: {
      displayName: "Mama Fatima",
      birthYear: 1950,
      birthPlace: "Fès, Morocco",
      sessionLanguage: "fr",
      caregiverLanguage: "en",
      sessionMinutes: 20,
      notes:
        "Ma mère Fatima est née à Fès en 1950 et a grandi dans la médina. Elle est arrivée à Bruxelles en 1972 avec mon père, " +
        "qui travaillait dans les mines du Limbourg puis à la STIB. Elle adore Oum Kalthoum, Abdelhalim Hafez et les films égyptiens " +
        "en noir et blanc qu'elle regardait au cinéma à Fès. Elle prépare le thé à la menthe et les msemen chaque matin. " +
        "Elle parle darija et français. She is a practising Muslim, so nothing with alcohol please. " +
        "Her first years in Brussels were very lonely, so go gently around that time.",
    },
  },
  {
    slug: "maria",
    card: {
      name: "Maria, 84",
      tagline: "Naples, born 1942. Sinatra, Napoli football, Sunday ragù.",
      flag: "IT",
      scenario: "A granddaughter who thinks she knows the music. Period slips still get through.",
    },
    input: {
      displayName: "Nonna Maria",
      birthYear: 1942,
      birthPlace: "Naples, Italy",
      sessionLanguage: "it",
      caregiverLanguage: "en",
      sessionMinutes: 20,
      notes:
        "My grandmother Maria was born in 1942 in the Spanish Quarter of Naples and grew up there. " +
        "She worked as a seamstress from age 15 and married my grandfather in 1963. She adores Frank Sinatra " +
        "and Neapolitan songs her mother sang, follows Napoli football with passion, and loves cooking Sunday ragù. " +
        "She still speaks mostly Neapolitan dialect and Italian. Please avoid talking about the war years, " +
        "her father was away and it upsets her. Her husband Gennaro passed away in 2015; she smiles when he is mentioned " +
        "but can become tearful.",
    },
  },
  {
    slug: "seamus",
    card: {
      name: "Seamus, 88",
      tagline: "Cork, born 1938. Hurling, showbands, the Ford plant.",
      flag: "IE",
      scenario: "A son who shares the culture. The language model still invents a showband that never toured.",
    },
    input: {
      displayName: "Seamus",
      birthYear: 1938,
      birthPlace: "Cork, Ireland",
      sessionLanguage: "en",
      caregiverLanguage: "en",
      sessionMinutes: 25,
      notes:
        "Dad grew up on the north side of Cork city and worked at the Ford factory on the Marina for over 30 years. " +
        "He was mad about hurling and the Glen Rovers club, and went dancing to the showbands every weekend in the late 50s and 60s, " +
        "that's where he met Mam. He loved westerns at the pictures and listening to the radio. Speaks English, a bit of Irish from school. " +
        "His brother emigrated to England in the 50s and they lost touch, so best not to bring that up.",
    },
  },
];

export function getPersona(slug: string): DemoPersona | undefined {
  return PERSONAS.find((p) => p.slug === slug);
}
