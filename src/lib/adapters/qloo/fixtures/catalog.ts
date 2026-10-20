/**
 * Hand-authored mock Qloo catalog (never recorded live data, HARD RULE 5).
 * Ids are placeholders: Maria's reuse the "SAMPLE-..." ids of
 * src/lib/domain/sample-events.ts; the rest use "MOCK-...". No image urls:
 * the UI must handle missing images.
 *
 * `group` ties entities to one persona's cultural world (or "generic" for
 * custom input); `affinity` is the aggregate audience affinity the mock
 * returns from /v2/insights for seeds in the same group.
 */
import type { QlooEntityType } from "@/lib/domain/types";

export type MockGroup = "maria" | "seamus" | "fatima" | "generic";

export interface MockEntity {
  qlooId: string;
  name: string;
  type: QlooEntityType;
  group: MockGroup;
  popularity: number;
  affinity: number;
  releaseYear?: number;
  dateOfBirth?: string;
  description?: string;
  disambiguation?: string;
  tags?: string[];
}

type Row = [id: string, name: string, type: QlooEntityType, popularity: number, affinity: number, extra?: Partial<MockEntity>];

const A = "urn:entity:artist";
const M = "urn:entity:movie";
const P = "urn:entity:person";
const T = "urn:entity:tv_show";
const B = "urn:entity:brand";

const rows = (group: MockGroup, list: Row[]): MockEntity[] =>
  list.map(([qlooId, name, type, popularity, affinity, extra]) => ({ qlooId, name, type, group, popularity, affinity, ...extra }));

const MARIA = rows("maria", [
  ["SAMPLE-ARTIST-SINATRA", "Frank Sinatra", A, 0.99, 0.8, { dateOfBirth: "1915-12-12", description: "American singer and actor, the voice of the 1950s and 60s.", tags: ["50s", "60s"] }],
  ["SAMPLE-ARTIST-CAROSONE", "Renato Carosone", A, 0.81, 0.86, { dateOfBirth: "1920-01-03", description: "Neapolitan singer and pianist, 'Tu vuò fà l'americano' (1956).", tags: ["50s"] }],
  ["SAMPLE-ARTIST-MODUGNO", "Domenico Modugno", A, 0.84, 0.85, { dateOfBirth: "1928-01-09", description: "Singer-songwriter of 'Nel blu, dipinto di blu' (Volare), Sanremo 1958.", tags: ["50s", "60s"] }],
  ["SAMPLE-ARTIST-PINO-DANIELE", "Pino Daniele", A, 0.78, 0.84, { dateOfBirth: "1955-03-19", description: "Neapolitan blues singer-songwriter, debut album 1977.", tags: ["70s", "80s"] }],
  ["SAMPLE-ARTIST-PEPPINO-DI-CAPRI", "Peppino di Capri", A, 0.7, 0.91, { dateOfBirth: "1939-07-27", description: "Neapolitan crooner, 'Roberta' and 'St. Tropez Twist' (early 1960s).", tags: ["60s"] }],
  ["SAMPLE-ARTIST-MUROLO", "Roberto Murolo", A, 0.58, 0.88, { dateOfBirth: "1912-01-19", description: "Gentle voice of classic Neapolitan song, with guitar.", tags: ["50s", "60s"] }],
  ["MOCK-ARTIST-NINO-DANGELO", "Nino D'Angelo", A, 0.52, 0.87, { dateOfBirth: "1957-06-21", description: "Neapolitan pop singer, famous from 1982.", tags: ["80s"] }],
  ["MOCK-ARTIST-MASSIMO-RANIERI", "Massimo Ranieri", A, 0.61, 0.83, { dateOfBirth: "1951-05-03", description: "Neapolitan singer, 'Rose rosse' (1969).", tags: ["60s", "70s"] }],
  ["MOCK-ARTIST-SERGIO-BRUNI", "Sergio Bruni", A, 0.45, 0.82, { dateOfBirth: "1921-09-15", description: "'The voice of Naples', classic Neapolitan song.", tags: ["50s", "60s"] }],
  ["MOCK-ARTIST-MINA", "Mina", A, 0.8, 0.79, { dateOfBirth: "1940-03-25", description: "Italian pop singer, star from 1959.", tags: ["60s", "70s"] }],
  ["MOCK-MOVIE-TOTO-GIRO", "Totò al Giro d'Italia", M, 0.5, 0.83, { releaseYear: 1948, description: "Mario Mattoli's slapstick comedy with Totò chasing the Giro.", disambiguation: "1948, Mario Mattoli" }],
  ["SAMPLE-MOVIE-ORO-DI-NAPOLI", "L'oro di Napoli", M, 0.62, 0.84, { releaseYear: 1954, description: "Vittorio De Sica's portrait of Naples in six stories, with Sophia Loren and Totò.", disambiguation: "1954, Vittorio De Sica" }],
  ["SAMPLE-MOVIE-QUATTRO-GIORNATE", "Le quattro giornate di Napoli", M, 0.41, 0.8, { releaseYear: 1962, description: "Drama of the 1943 Naples uprising against the occupation.", disambiguation: "1962, Nanni Loy" }],
  ["SAMPLE-MOVIE-MATRIMONIO-ALL-ITALIANA", "Matrimonio all'italiana", M, 0.66, 0.87, { releaseYear: 1964, description: "Sophia Loren and Marcello Mastroianni in a Naples love story.", disambiguation: "1964, Vittorio De Sica" }],
  ["MOCK-MOVIE-IERI-OGGI-DOMANI", "Ieri, oggi, domani", M, 0.6, 0.85, { releaseYear: 1963, description: "Three stories with Loren and Mastroianni; the first is set in Naples.", disambiguation: "1963, Vittorio De Sica" }],
  ["MOCK-MOVIE-PANE-AMORE", "Pane, amore e fantasia", M, 0.55, 0.82, { releaseYear: 1953, description: "Gina Lollobrigida and Vittorio De Sica in a village comedy.", disambiguation: "1953, Luigi Comencini" }],
  ["MOCK-MOVIE-NAPOLI-MILIONARIA", "Napoli milionaria", M, 0.47, 0.81, { releaseYear: 1950, description: "Eduardo De Filippo's Naples comedy-drama.", disambiguation: "1950, Eduardo De Filippo" }],
  ["SAMPLE-PERSON-LOREN", "Sophia Loren", P, 0.95, 0.83, { dateOfBirth: "1934-09-20", description: "Actress raised in Pozzuoli, just outside Naples." }],
  ["SAMPLE-PERSON-SIVORI", "Omar Sívori", P, 0.44, 0.8, { dateOfBirth: "1935-10-02", description: "Forward who played for Napoli from 1965 to 1969." }],
  ["SAMPLE-PERSON-MARADONA", "Diego Maradona", P, 0.98, 0.79, { dateOfBirth: "1960-10-30", description: "Argentine footballer, Napoli 1984-1991." }],
  ["MOCK-PERSON-TOTO", "Totò", P, 0.72, 0.86, { dateOfBirth: "1898-02-15", description: "The prince of laughter, Neapolitan comic actor." }],
  ["MOCK-PERSON-MASTROIANNI", "Marcello Mastroianni", P, 0.85, 0.84, { dateOfBirth: "1924-09-28", description: "Italian actor, Loren's screen partner." }],
  ["MOCK-PERSON-ALTAFINI", "José Altafini", P, 0.4, 0.82, { dateOfBirth: "1938-08-24", description: "Striker who played for Napoli from 1965 to 1972." }],
  ["MOCK-BRAND-SSC-NAPOLI", "SSC Napoli", B, 0.8, 0.8, { description: "Football club of Naples.", tags: ["soccer"] }],
]);

const SEAMUS = rows("seamus", [
  ["MOCK-ARTIST-JOHN-MCCORMACK", "John McCormack", A, 0.55, 0.82, { dateOfBirth: "1884-06-14", description: "Athlone tenor; 'Danny Boy' and sentimental ballads carried the pre-war wireless.", tags: ["40s"] }],
  ["MOCK-ARTIST-ROYAL-SHOWBAND", "The Royal Showband", A, 0.42, 0.86, { description: "Waterford showband, one of the biggest of the late 1950s and 60s.", tags: ["50s", "60s"] }],
  ["MOCK-ARTIST-BRENDAN-BOWYER", "Brendan Bowyer", A, 0.4, 0.85, { dateOfBirth: "1938-10-12", description: "Lead singer of the Royal Showband, 'The Hucklebuck' (1965).", tags: ["60s"] }],
  ["MOCK-ARTIST-DICKIE-ROCK", "Dickie Rock", A, 0.38, 0.89, { dateOfBirth: "1936-10-01", description: "Showband star with the Miami Showband.", tags: ["60s"] }],
  ["MOCK-ARTIST-JOE-DOLAN", "Joe Dolan", A, 0.45, 0.87, { dateOfBirth: "1939-10-16", description: "Showband singer from Mullingar, 'Make Me an Island' (1969).", tags: ["60s", "70s"] }],
  ["MOCK-ARTIST-JIM-REEVES", "Jim Reeves", A, 0.6, 0.84, { dateOfBirth: "1923-08-20", description: "Country singer hugely popular in Ireland in the early 1960s.", tags: ["50s", "60s"] }],
  ["MOCK-ARTIST-BRIDIE-GALLAGHER", "Bridie Gallagher", A, 0.3, 0.83, { dateOfBirth: "1924-09-07", description: "Donegal singer of emigrant ballads, 'The Boys from County Armagh'.", tags: ["50s"] }],
  ["MOCK-ARTIST-CLANCY-BROTHERS", "The Clancy Brothers", A, 0.5, 0.82, { description: "Irish folk group famous from 1961.", tags: ["60s"] }],
  ["MOCK-ARTIST-U2", "U2", A, 0.97, 0.8, { description: "Dublin rock band formed in 1976.", tags: ["80s"] }],
  ["MOCK-ARTIST-ELVIS", "Elvis Presley", A, 0.99, 0.81, { dateOfBirth: "1935-01-08", description: "The King of rock and roll, from 1956.", tags: ["50s", "60s"] }],
  ["MOCK-MOVIE-QUIET-MAN", "The Quiet Man", M, 0.72, 0.88, { releaseYear: 1952, description: "John Wayne and Maureen O'Hara in the west of Ireland.", disambiguation: "1952, John Ford" }],
  ["MOCK-MOVIE-SHANE", "Shane", M, 0.66, 0.85, { releaseYear: 1953, description: "Classic western with Alan Ladd.", disambiguation: "1953, George Stevens" }],
  ["MOCK-MOVIE-HIGH-NOON", "High Noon", M, 0.7, 0.86, { releaseYear: 1952, description: "Gary Cooper as a marshal facing a gang alone.", disambiguation: "1952, Fred Zinnemann" }],
  ["MOCK-MOVIE-SEARCHERS", "The Searchers", M, 0.71, 0.84, { releaseYear: 1956, description: "John Wayne western in Monument Valley.", disambiguation: "1956, John Ford" }],
  ["MOCK-MOVIE-RIO-BRAVO", "Rio Bravo", M, 0.63, 0.87, { releaseYear: 1959, description: "John Wayne and Dean Martin hold a jail.", disambiguation: "1959, Howard Hawks" }],
  ["MOCK-MOVIE-MAGNIFICENT-SEVEN", "The Magnificent Seven", M, 0.69, 0.85, { releaseYear: 1960, description: "Seven gunfighters defend a village.", disambiguation: "1960, John Sturges" }],
  ["MOCK-MOVIE-FAR-AND-AWAY", "Far and Away", M, 0.5, 0.8, { releaseYear: 1992, description: "Irish emigrants seek land in America.", disambiguation: "1992, Ron Howard" }],
  ["MOCK-PERSON-CHRISTY-RING", "Christy Ring", P, 0.35, 0.88, { dateOfBirth: "1920-10-30", description: "Glen Rovers and Cork hurling legend." }],
  ["MOCK-PERSON-JACK-LYNCH", "Jack Lynch", P, 0.4, 0.82, { dateOfBirth: "1917-08-15", description: "Glen Rovers hurler and later Taoiseach." }],
  ["MOCK-PERSON-JOHN-WAYNE", "John Wayne", P, 0.9, 0.84, { dateOfBirth: "1907-05-26", description: "Star of the classic westerns." }],
  ["MOCK-PERSON-MAUREEN-OHARA", "Maureen O'Hara", P, 0.7, 0.86, { dateOfBirth: "1920-08-17", description: "Dublin-born star of 'The Quiet Man'." }],
  ["MOCK-PERSON-GARY-COOPER", "Gary Cooper", P, 0.68, 0.83, { dateOfBirth: "1901-05-07", description: "Star of 'High Noon'." }],
  ["MOCK-TV-RIORDANS", "The Riordans", T, 0.25, 0.8, { releaseYear: 1965, description: "RTÉ rural drama, from 1965." }],
]);

const FATIMA = rows("fatima", [
  ["MOCK-ARTIST-OUM-KALTHOUM", "Oum Kalthoum", A, 0.9, 0.86, { dateOfBirth: "1898-12-31", description: "The Star of the East, Egyptian singer; 'Enta Omri' (1964).", tags: ["50s", "60s"] }],
  ["MOCK-ARTIST-ABDELHALIM-HAFEZ", "Abdelhalim Hafez", A, 0.82, 0.88, { dateOfBirth: "1929-06-21", description: "Egyptian singer and actor, 'the dark nightingale'.", tags: ["50s", "60s", "70s"] }],
  ["MOCK-ARTIST-FARID-AL-ATRASH", "Farid al-Atrash", A, 0.7, 0.87, { dateOfBirth: "1910-10-19", description: "Syrian-Egyptian composer, oud player and film star.", tags: ["50s", "60s"] }],
  ["MOCK-ARTIST-FAIRUZ", "Fairuz", A, 0.85, 0.85, { dateOfBirth: "1934-11-20", description: "Lebanese singer, star of the 1960s and 70s.", tags: ["60s", "70s"] }],
  ["MOCK-ARTIST-NASS-EL-GHIWANE", "Nass El Ghiwane", A, 0.55, 0.84, { description: "Moroccan group of the early 1970s, chaabi and gnawa rhythms.", tags: ["70s"] }],
  ["MOCK-ARTIST-DOUKKALI", "Abdelwahab Doukkali", A, 0.5, 0.86, { dateOfBirth: "1941-01-02", description: "Moroccan singer from Fès, 'Kan ya ma kan' (1960s).", tags: ["60s", "70s"] }],
  ["MOCK-ARTIST-WARDA", "Warda Al-Jazairia", A, 0.6, 0.89, { dateOfBirth: "1939-07-22", description: "Algerian-Egyptian singer, star from the 1960s.", tags: ["60s", "70s"] }],
  ["MOCK-ARTIST-JACQUES-BREL", "Jacques Brel", A, 0.8, 0.8, { dateOfBirth: "1929-04-08", description: "Brussels-born singer, 'Ne me quitte pas' (1959).", tags: ["60s"] }],
  ["MOCK-ARTIST-CHEB-KHALED", "Khaled", A, 0.75, 0.83, { dateOfBirth: "1960-02-29", description: "Algerian raï singer, 'Didi' (1992).", tags: ["90s"] }],
  ["MOCK-MOVIE-AL-KHATAYA", "Al-Khataya", M, 0.4, 0.86, { releaseYear: 1962, description: "Egyptian melodrama starring Abdelhalim Hafez.", disambiguation: "1962, Hassan El Imam" }],
  ["MOCK-MOVIE-MABOUDAT", "Ma'boudat al-Gamahir", M, 0.35, 0.84, { releaseYear: 1967, description: "Musical with Abdelhalim Hafez and Shadia.", disambiguation: "1967, Helmy Rafla" }],
  ["MOCK-MOVIE-DOA-AL-KARAWAN", "Doa al-Karawan", M, 0.42, 0.85, { releaseYear: 1959, description: "The Nightingale's Prayer, with Faten Hamama.", disambiguation: "1959, Henry Barakat" }],
  ["MOCK-MOVIE-WESSADA", "Al-Wessada al-Khalia", M, 0.38, 0.83, { releaseYear: 1957, description: "The Empty Pillow, Abdelhalim Hafez romance.", disambiguation: "1957, Salah Abu Seif" }],
  ["MOCK-MOVIE-ABI-FOQ", "Abi Foq al-Shagara", M, 0.45, 0.87, { releaseYear: 1969, description: "Abdelhalim Hafez's last musical, set in Alexandria.", disambiguation: "1969, Hussein Kamal" }],
  ["MOCK-PERSON-MOHAMMED-V", "Mohammed V", P, 0.5, 0.85, { dateOfBirth: "1909-08-10", description: "Sultan then King of Morocco; a national figure of Fatima's Fès childhood." }],
  ["MOCK-PERSON-FATEN-HAMAMA", "Faten Hamama", P, 0.6, 0.87, { dateOfBirth: "1931-05-27", description: "The lady of the Arab screen." }],
  ["MOCK-PERSON-OMAR-SHARIF", "Omar Sharif", P, 0.8, 0.84, { dateOfBirth: "1932-04-10", description: "Egyptian actor, Faten Hamama's screen partner." }],
  ["MOCK-PERSON-SOAD-HOSNY", "Soad Hosny", P, 0.55, 0.86, { dateOfBirth: "1943-01-26", description: "Cinderella of Egyptian cinema, 1960s-70s." }],
  ["MOCK-BRAND-STELLA-ARTOIS", "Stella Artois", B, 0.85, 0.8, { description: "Belgian beer brand from Leuven." }],
  // Hand-authored Western-drift entries that verify successfully in the mock
  // for Fatima's propose fixture. They exist in the catalog so the trace
  // shows the LLM proposed them and Qloo confirmed real matches; the
  // cultural-check phase is the layer that catches them as mismatches for
  // a Moroccan elder's cultural world.
  ["MOCK-ARTIST-BEATLES-FATIMA", "The Beatles", A, 0.99, 0.6, { description: "Liverpool band, worldwide from 1963.", tags: ["60s"] }],
  ["MOCK-MOVIE-CASABLANCA-FATIMA", "Casablanca", M, 0.9, 0.6, { releaseYear: 1942, description: "Bogart and Bergman in a wartime Morocco setting, Hollywood production.", disambiguation: "1942, Michael Curtiz" }],
  ["MOCK-PERSON-DONALD-TRUMP", "Donald Trump", P, 0.95, 0.5, { dateOfBirth: "1946-06-14", description: "US public figure." }],
]);

const GENERIC = rows("generic", [
  ["MOCK-ARTIST-BING-CROSBY", "Bing Crosby", A, 0.8, 0.84, { dateOfBirth: "1903-05-03", description: "Crooner of 'White Christmas' (1942).", tags: ["40s", "50s"] }],
  ["MOCK-ARTIST-EDITH-PIAF", "Édith Piaf", A, 0.85, 0.85, { dateOfBirth: "1915-12-19", description: "French singer, 'La vie en rose' (1946).", tags: ["40s", "50s"] }],
  ["MOCK-ARTIST-NAT-KING-COLE", "Nat King Cole", A, 0.82, 0.86, { dateOfBirth: "1919-03-17", description: "Singer of 'Unforgettable' (1951).", tags: ["50s"] }],
  ["MOCK-ARTIST-BEATLES", "The Beatles", A, 0.99, 0.85, { description: "Liverpool band, worldwide from 1963.", tags: ["60s"] }],
  ["MOCK-ARTIST-ROLLING-STONES", "The Rolling Stones", A, 0.95, 0.82, { description: "London rock band, from 1964.", tags: ["60s", "70s"] }],
  ["MOCK-ARTIST-ABBA", "ABBA", A, 0.96, 0.84, { description: "Swedish pop group, Eurovision 1974.", tags: ["70s"] }],
  ["MOCK-ARTIST-BOB-MARLEY", "Bob Marley", A, 0.95, 0.81, { dateOfBirth: "1945-02-06", description: "Jamaican reggae star of the 1970s.", tags: ["70s"] }],
  ["MOCK-ARTIST-MICHAEL-JACKSON", "Michael Jackson", A, 0.99, 0.83, { dateOfBirth: "1958-08-29", description: "'Thriller' (1982).", tags: ["80s"] }],
  ["MOCK-ARTIST-MADONNA", "Madonna", A, 0.97, 0.8, { dateOfBirth: "1958-08-16", description: "Pop star from 1984.", tags: ["80s"] }],
  ["MOCK-MOVIE-CASABLANCA", "Casablanca", M, 0.9, 0.86, { releaseYear: 1942, description: "Bogart and Bergman in wartime Morocco.", disambiguation: "1942, Michael Curtiz" }],
  ["MOCK-MOVIE-ROMAN-HOLIDAY", "Roman Holiday", M, 0.85, 0.87, { releaseYear: 1953, description: "Audrey Hepburn and Gregory Peck in Rome.", disambiguation: "1953, William Wyler" }],
  ["MOCK-MOVIE-BREAKFAST-AT-TIFFANYS", "Breakfast at Tiffany's", M, 0.84, 0.85, { releaseYear: 1961, description: "Audrey Hepburn in New York.", disambiguation: "1961, Blake Edwards" }],
  ["MOCK-MOVIE-SOUND-OF-MUSIC", "The Sound of Music", M, 0.88, 0.86, { releaseYear: 1965, description: "Julie Andrews sings in the Austrian Alps.", disambiguation: "1965, Robert Wise" }],
  ["MOCK-MOVIE-STAR-WARS", "Star Wars", M, 0.98, 0.82, { releaseYear: 1977, description: "Space adventure.", disambiguation: "1977, George Lucas" }],
  ["MOCK-MOVIE-ET", "E.T. the Extra-Terrestrial", M, 0.93, 0.83, { releaseYear: 1982, description: "A boy befriends an alien.", disambiguation: "1982, Steven Spielberg" }],
  ["MOCK-MOVIE-TITANIC", "Titanic", M, 0.97, 0.8, { releaseYear: 1997, description: "Romance aboard the doomed liner.", disambiguation: "1997, James Cameron" }],
  ["MOCK-PERSON-CHAPLIN", "Charlie Chaplin", P, 0.9, 0.84, { dateOfBirth: "1889-04-16", description: "The Tramp of silent comedy." }],
  ["MOCK-PERSON-MARILYN", "Marilyn Monroe", P, 0.95, 0.85, { dateOfBirth: "1926-06-01", description: "Film star of the 1950s." }],
  ["MOCK-PERSON-AUDREY", "Audrey Hepburn", P, 0.93, 0.87, { dateOfBirth: "1929-05-04", description: "Star of 'Roman Holiday' and 'Breakfast at Tiffany's'." }],
  ["MOCK-PERSON-PELE", "Pelé", P, 0.92, 0.83, { dateOfBirth: "1940-10-23", description: "Brazilian footballer, World Cup winner 1958, 1962, 1970." }],
  ["MOCK-PERSON-ALI", "Muhammad Ali", P, 0.94, 0.82, { dateOfBirth: "1942-01-17", description: "Heavyweight boxing champion of the 1960s and 70s." }],
  ["MOCK-TV-I-LOVE-LUCY", "I Love Lucy", T, 0.8, 0.85, { releaseYear: 1951, description: "Lucille Ball sitcom." }],
  ["MOCK-TV-BONANZA", "Bonanza", T, 0.75, 0.84, { releaseYear: 1959, description: "Western family series." }],
  ["MOCK-TV-DALLAS", "Dallas", T, 0.78, 0.81, { releaseYear: 1978, description: "Texas oil family drama." }],
]);

export const MOCK_CATALOG: readonly MockEntity[] = [...MARIA, ...SEAMUS, ...FATIMA, ...GENERIC];

/** Decade and genre tags the mock /v2/tags knows. */
export const MOCK_TAGS = [
  { id: "urn:tag:genre:music:40s", name: "40s", type: "urn:tag:genre:music" },
  { id: "urn:tag:genre:music:50s", name: "50s", type: "urn:tag:genre:music" },
  { id: "urn:tag:genre:music:60s", name: "60s", type: "urn:tag:genre:music" },
  { id: "urn:tag:genre:music:70s", name: "70s", type: "urn:tag:genre:music" },
  { id: "urn:tag:genre:music:80s", name: "80s", type: "urn:tag:genre:music" },
  { id: "urn:tag:genre:music:90s", name: "90s", type: "urn:tag:genre:music" },
  { id: "urn:tag:genre:brand:sports_organization:soccer", name: "soccer", type: "urn:tag:genre:brand" },
  // Cuisine tags used by the F3 food-domain gate (resolveCuisineTag).
  { id: "urn:tag:cuisine:neapolitan", name: "Neapolitan", type: "urn:tag:cuisine" },
  { id: "urn:tag:cuisine:italian", name: "Italian", type: "urn:tag:cuisine" },
  { id: "urn:tag:cuisine:moroccan", name: "Moroccan", type: "urn:tag:cuisine" },
  { id: "urn:tag:cuisine:irish", name: "Irish", type: "urn:tag:cuisine" },
] as const;
