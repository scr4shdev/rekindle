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
      stage: "mid",
      culturalBackground:
        "Moroccan family from the Fès medina, practising Muslim; darija at home with my father, French in Brussels since 1972. " +
        "Nothing with alcohol, please.",
      keyLifeEvents:
        "Grew up in the medina of Fès in the 1950s and 60s. Arrived in Brussels in 1972 with my father, who worked in the Limburg " +
        "mines and later at the STIB. First years in Brussels were very lonely.",
      calmingCues:
        "Oum Kalthoum and Abdelhalim Hafez on the radio, mint tea in a glass, the smell of orange blossom water on msemen in the morning.",
      thingsToAvoid:
        "The lonely early-Brussels years in the 1970s. Anything with alcohol. Loud political news.",
      routines:
        "Mint tea and msemen every morning. Black-and-white Egyptian films on the small television in the afternoon.",
      notes:
        "Ma mère Fatima aime les films égyptiens en noir et blanc qu'elle regardait au cinéma à Fès. Elle parle darija et français.",
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
      stage: "early",
      culturalBackground:
        "Neapolitan family from the Spanish Quarter, Catholic. Mostly Neapolitan dialect and Italian at home.",
      keyLifeEvents:
        "Grew up in the Spanish Quarter of Naples. Worked as a seamstress from age 15. Married Gennaro in 1963. " +
        "Gennaro passed away in 2015.",
      calmingCues:
        "Frank Sinatra on the record player. The Neapolitan songs her mother sang. The smell of Sunday ragù on the stove.",
      thingsToAvoid:
        "The war years: her father was away and it upsets her. Mentioning Gennaro's death directly; she smiles when he is " +
        "mentioned warmly but can become tearful.",
      routines:
        "Sunday ragù at midday. Watching Napoli matches on television. A short walk after lunch when the weather allows.",
      notes:
        "She follows Napoli football with passion. Still prefers Neapolitan dialect to Italian with family.",
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
      stage: "early",
      culturalBackground:
        "Irish Catholic family from the north side of Cork city. English at home with a bit of Irish from school.",
      keyLifeEvents:
        "Grew up on the north side of Cork. Over 30 years at the Ford factory on the Marina. Met Mam at a showband dance " +
        "in the late 50s or 60s.",
      calmingCues:
        "Hurling commentary on the radio. Old showband records. The sound of rain on a tin roof.",
      thingsToAvoid:
        "His brother who emigrated to England in the 50s; they lost touch and it still stings.",
      routines:
        "The six o'clock news on the radio. A pint of stout at the weekend. Mass on Sunday morning when he feels up to it.",
      notes:
        "Mad about hurling and the Glen Rovers club. Loved westerns at the pictures.",
    },
  },
];

export function getPersona(slug: string): DemoPersona | undefined {
  return PERSONAS.find((p) => p.slug === slug);
}
