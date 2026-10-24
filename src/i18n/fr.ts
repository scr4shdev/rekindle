/** French UI strings (caregiver register). Non-medical wording: "personne aimée", never "patient". */
// TODO(i18n): /for-operators page is English-only on purpose; translate for FR care operator audiences when a localized partner conversation starts.
import type { PartialMessages } from "@/i18n";

export const fr: PartialMessages = {
  app: {
    name: "Rekindle",
    tagline: "Des activités de réminiscence, rebâties à partir de leur époque",
    skipToContent: "Aller au contenu",
    nav: { label: "Principal", home: "Accueil", compare: "Comparer" },
    pageTitles: { session: "Séance", compare: "Comparaison" },
    theme: { toggle: "Choisir le thème clair ou sombre", light: "Clair", dark: "Sombre" },
  },
  landing: {
    title: "Une séance de réminiscence de 20 minutes qu'un proche aidant peut mener, dans toutes les cultures.",
    leadShort:
      "Pour les auxiliaires de vie et les familles. L'agent de Rekindle confronte chaque chanson, film et visage au graphe des goûts de Qloo, en faisant remonter les absences dans la trace plutôt que de les masquer, pour qu'une enfance à Fès dans les années 1960 ne soit pas accueillie par un classique hollywoodien des années 1960.",
    agentFlowLabel: "La promesse de l'agent",
    agentFlow:
      "L'agent prépare vingt minutes dans leur langue, et chaque idée qu'il propose est vérifiée d'abord.",
    promises: {
      stored: "Rien de ce que vous écrivez n'est conservé",
      activity: "Une activité partagée, pas une thérapie",
      grounded: "Des idées vérifiées auprès de Qloo",
    },
    mockGateTitle: "La saisie libre en direct est désactivée dans cette démo",
    mockGateBody:
      "C'est une vue de démo, le planificateur en direct est donc en pause. Touchez Maria, Fatima ou Seamus ci-dessous pour voir l'agent tourner en entier.",
    personasTitle: "À essayer en un geste",
    personasLead:
      "Trois personnes inventées, trois situations de proche aidant. Fatima vient en premier : une aînée marocaine et une auxiliaire qui lit en anglais, le cas le plus difficile pour un modèle penché vers l'Ouest, et celui où Qloo aide le plus clairement.",
    openSession: (name: string) => `Préparer la séance de ${name}`,
    sessionIn: (language: string) => `Séance en ${language}`,
    minutes: (n: number) => `${n} min`,
    era: (from: string, to: string) => (from === to ? from : `${from}–${to}`),
    howTitle: "Comment ça marche",
    how: [
      {
        title: "Dites-nous un peu",
        body: "L'année de naissance, l'endroit où la personne a grandi, ce qu'elle aimait, et ce qu'il vaut mieux éviter.",
      },
      {
        title: "Regardez l'agent réfléchir",
        body:
          "Les idées sont proposées, confrontées à Qloo, élargies par affinité de goût, et les anachronismes sont écartés.",
      },
      {
        title: "Vivez-la ensemble",
        body: "Une proposition à la fois, avec un minuteur. Indiquez comment la personne a réagi et le plan s'adapte.",
      },
    ],
    recordedTraceLink: "Voir une trace enregistrée d'une séance Rekindle.",
    customTitle: "Ou décrivez une personne qui vous est chère",
    customLead:
      "Quelques phrases suffisent. Vos mots partent au planificateur une seule fois et ne sont jamais conservés.",
  },
  dataFlows: {
    heading: "Comment circulent vos notes",
    openLabel: "Ouvrir",
    qlooSeesTitle: "Ce que voit Qloo",
    qlooSeesBody:
      "Uniquement des repères culturels : noms publics d'entités, identifiants de tags Qloo, un nom de lieu public (au niveau de la ville) et une tranche d'âge agrégée. Jamais vos notes libres, jamais le nom d'une personne.",
    llmSeesTitle: "Ce que voit le modèle de langage",
    llmSeesBody:
      "Vos notes libres, lues une seule fois par le planificateur sur notre serveur. Les notes ne sont stockées nulle part, et ne sont pas écrites dans nos journaux.",
    deviceOnlyTitle: "Ce qui reste sur cet appareil",
    deviceOnlyBody:
      "Les réactions de séance et une courte note, indexées par un nom haché, ainsi que la fiche de séance imprimable. Conservées uniquement dans ce navigateur.",
  },
  form: {
    thisIsMeTitle: "Une courte fiche 'This is Me'",
    thisIsMeIntro:
      "Le document 'This is Me' de l'Alzheimer's Society est le standard britannique pour les soins centrés sur la personne. Chaque champ est facultatif. Tout ce que vous ajoutez aide le planificateur à choisir musique, images et propositions qui lui correspondent vraiment.",
    displayName: "Comment l'appelez-vous ?",
    displayNameHint: "Facultatif. Utilisé uniquement dans les phrases à dire, jamais envoyé à Qloo.",
    notes: "Autre chose à savoir",
    notesHint:
      "Notes libres : tout ce qui n'est pas entré dans les champs ci-dessus. Où et quand la personne a grandi, le travail, les mots de famille, ce qu'il vaut mieux éviter.",
    notesPlaceholder:
      "Par exemple : Papa est né en 1946 à Lyon et travaillait aux chemins de fer. Il adorait Johnny Hallyday, le Tour de France à la radio et le gratin de sa mère. Merci d'éviter de parler de son frère.",
    notesCount: (n: number, max: number) => `${n} sur ${max} caractères`,
    notesCapped: (budget: number) =>
      `Les notes sont limitées à ${budget} caractères lorsqu'une ligne "la dernière fois" est incluse. Le texte le plus ancien a été raccourci pour tenir.`,
    birthYear: "Année de naissance",
    birthPlace: "Où la personne a grandi",
    birthPlacePlaceholder: "ex. Lyon, France",
    culturalBackground: "Origines culturelles et familiales",
    culturalBackgroundHint: "D'où vient la famille, la religion si elle compte, la langue de la maison.",
    culturalBackgroundPlaceholder: "ex. Famille napolitaine, catholique, italien à la maison avec le dialecte napolitain.",
    keyLifeEvents: "Grands événements de vie",
    keyLifeEventsHint: "Quelques tournants : mariage, enfants, émigration, un métier aimé.",
    keyLifeEventsPlaceholder: "ex. Mariée avec Gennaro en 1963, deux enfants, couturière pendant trente ans.",
    calmingCues: "Ce qui l'apaise",
    calmingCuesHint: "Une chanson, un parfum, un toucher, une vue qui l'aide à se poser.",
    calmingCuesPlaceholder: "ex. Fredonner des chansons napolitaines, l'odeur du basilic, tenir une couverture douce.",
    thingsToAvoid: "Ce qu'il vaut mieux éviter",
    thingsToAvoidHint: "Sujets, sons ou situations qui bouleversent la personne.",
    thingsToAvoidPlaceholder: "ex. Les années de guerre, les bruits forts soudains, parler de son défunt mari avant qu'elle ne l'évoque.",
    routines: "Routines ou rituels auxquels la personne tient",
    routinesHint: "Facultatif. Le petit rituel qui marque un moment de la journée.",
    routinesPlaceholder: "ex. Café du matin avec la radio, chapelet avant de dormir, déjeuner du dimanche à midi.",
    stage: "Stade approximatif de la démence",
    stageHint: "Facultatif. Nous aide à choisir le bon rythme. Si vous avez un doute, laissez vide.",
    stageOptions: {
      none: "Je préfère ne pas le dire",
      early: "Début",
      mid: "Milieu",
      late: "Avancé",
    },
    stageTooltips: {
      early: "Début : encore largement autonome ; les habitudes du quotidien tiennent.",
      mid: "Milieu : a besoin de plus de soutien pour les gestes du quotidien.",
      late: "Avancé : dépend d'une aide quotidienne ; la parole peut être limitée.",
    },
    sessionLanguage: "La langue que la personne parle le mieux",
    caregiverLanguage: "Votre langue",
    minutes: "Durée de la séance",
    minutesOption: (n: number) => `${n} min`,
    grounded: "Vérifier chaque idée auprès de Qloo",
    groundedHint:
      "Recommandé. Désactivez-le pour voir ce qu'un modèle de langage proposerait seul, ou essayez les deux côte à côte avec Comparer.",
    submit: "Préparer la séance",
    submitPending: "Ouverture du planificateur…",
    compare: "Comparer avec et sans Qloo",
    errorsTitle: "Vérifiez les champs indiqués.",
    errors: {
      notes: "Écrivez au moins une phrase (de 10 à 2000 caractères).",
      birthYear: (max: number) => `Entrez une année entre 1880 et ${max}, ou laissez vide.`,
      birthPlace: "Le lieu doit tenir en 120 caractères.",
      displayName: "Le nom doit tenir en 60 caractères.",
      sessionMinutes: "Choisissez une durée entre 5 et 60 minutes.",
      culturalBackground: "Gardez ce champ sous 400 caractères.",
      keyLifeEvents: "Gardez ce champ sous 400 caractères.",
      calmingCues: "Gardez ce champ sous 400 caractères.",
      thingsToAvoid: "Gardez ce champ sous 400 caractères.",
      routines: "Gardez ce champ sous 400 caractères.",
      generic: "Cette valeur n'est pas valide.",
    },
    privacy:
      "Gardé uniquement dans la mémoire de cet onglet. Recharger la page efface tout. Seul cet onglet garde votre brouillon.",
  },
  session: {
    eraBandLabel: "Lieu et époque",
    lifespan: (from: number, to: number) => `De ${from} à ${to}, de l'enfance à l'âge mûr.`,
    phaseTimelineLabel: "Phases de vie couvertes par cette séance",
    phaseBands: {
      childhood: "Enfance",
      youth: "Jeunesse",
      early_adulthood: "Début d'âge adulte",
      mid_life: "Âge mûr",
      later_life: "Années récentes",
    },
    phaseYears: (from: number, to: number) => `de ${from} à ${to}`,
    phaseStep: (title: string, year: number) => `${title}, ${year}`,
    phaseStepNoYear: (title: string) => title,
    planningFor: (name: string) => `Je prépare une séance pour ${name}`,
    planningGeneric: "Je prépare votre séance",
    waitHint: "Cela prend d'habitude 15 à 30 secondes. L'agent raconte au fil de son travail.",
    callbacksHeading: "Ce que nous avons retenu",
    callbacksLabel: "Détails précis de votre saisie et ce que nous en avons fait",
    someone: "une personne aimée",
    back: "Toutes les personnes",
    era: (from: number, to: number) => `${from}–${to}`,
    modeGrounded: "Vérifié avec Qloo",
    modeLlmOnly: "Modèle de langage seul",
    sourceSample: "Démo enregistrée",
    sourceSampleHint: "Un enregistrement de l'agent pour Maria, rejoué à son rythme d'origine.",
    sourceLive: "Planificateur en direct",
    sourceLiveHint: "En direct depuis le planificateur, à l'instant.",
    qlooLive: "Qloo : en direct",
    qlooMock: "Qloo : données démo",
    qlooMockHint: "Les réponses de Qloo venaient de données démo faites main, pas de l'API Qloo en direct.",
    qlooLiveHint: "Les réponses de Qloo venaient de l'API Qloo en direct.",
    start: "Commencer la séance",
    print: "Imprimer",
    compare: "Comparer avec et sans Qloo",
    cancel: "Arrêter",
    retry: "Réessayer",
    runLive: "Lancer en direct",
    runLiveHint: "Lancer l'agent contre le modèle en direct, plus lent mais réel",
    liveTimeoutToast: "Le modèle en direct est lent aujourd'hui. Nous affichons la version enregistrée.",
    tryMaria: "Ouvrir la démo enregistrée de Maria",
    missingCustom:
      "Vos notes ne sont conservées nulle part, donc recharger la page les a effacées. Réécrivez-les, s'il vous plaît.",
    missingCustomAction: "Écrire les notes",
    unknownPersona:
      "Nous ne trouvons pas cette personne. Choisissez une des personnes de démo ou écrivez vos propres notes.",
    planTitle: "La séance",
    planWaiting: "Votre séance apparaîtra ici dès que l'agent commencera à la composer.",
    planNone: "Pas de plan cette fois. Réessayez, ou ouvrez la démo enregistrée.",
    planStopped: "Arrêté avant d'avoir composé un plan. Rien n'a été gardé.",
    planDraft: "Composition…",
    totalMinutes: (n: number) => `${n} minutes`,
    stepsCount: (n: number) => `${n} étapes`,
    revision: (n: number) => `Adapté ${n === 1 ? "une fois" : `${n} fois`}`,
    stopped: "Arrêté. Rien n'a été gardé.",
    degraded:
      "Certaines vérifications n'ont pas pu aboutir, une partie de ce plan vient donc du modèle de langage seul.",
    feedbackHeading: "Comment chaque étape s'est-elle passée ?",
    feedbackButtonSparked: "A fait réagir",
    feedbackButtonDidNotLand: "Est tombée à plat",
    feedbackButtonWalkedAway: "A fait partir",
    feedbackInputPlaceholder: "Qu'est-ce qui a marqué ?",
    feedbackSaveButton: "Enregistrer les notes",
    feedbackSavedConfirmation: "Notes enregistrées sur cet appareil.",
    feedbackLastTimeHeading: (name: string) => `La dernière fois avec ${name}`,
    feedbackLastTimeIntro: "L'agent lira ceci avant le prochain plan.",
  },
  trace: {
    title: "Comment l'agent réfléchit",
    live: "En direct",
    liveCount: (calls: number, found: number) =>
      `${calls} ${calls === 1 ? "requête" : "requêtes"} à Qloo · ${found} trouvés`,
    finished: (seconds: string) => `Terminé en ${seconds} s`,
    stats: {
      ideas: "idées",
      verified: "trouvés dans Qloo",
      rejected: "mises de côté",
      calls: "requêtes à Qloo",
    },
    phases: {
      parse: "Je lis vos notes",
      propose: "J'imagine son monde",
      verify: "Je vérifie avec Qloo",
      expand: "Je découvre par le goût",
      critique: "Je revérifie",
      compose: "Je compose la séance",
      replan: "J'adapte le plan",
    },
    status: { pending: "En attente", started: "En cours", completed: "Terminé", skipped: "Ignoré" },
    seconds: (ms: number) => `${(ms / 1000).toFixed(1)} s`,
    verified: "Trouvé dans Qloo",
    discovery: "Découverte Qloo",
    affinity: (pct: number) => `${pct}% d'affinité`,
    affinityLine: (seeds: string, name: string) =>
      `Les personnes qui aiment ${seeds} ont aussi tendance à aimer ${name}.`,
    and: "et",
    qlooRequest: "Requête Qloo",
    narrationSearch: (query: string) => `Je cherche ${query}`,
    narrationInsights: (seeds: string, startYear: string | number, endYear: string | number) =>
      `Je regarde ce qu'aiment aussi les personnes qui aiment ${seeds}, entre ${startYear} et ${endYear}`,
    narrationInsightsOpenEnd: (seeds: string) =>
      `Je regarde ce qu'aiment aussi les personnes qui aiment ${seeds}, jusqu'à aujourd'hui`,
    narrationInsightsNoYears: (seeds: string) =>
      `Je regarde ce qu'aiment aussi les personnes qui aiment ${seeds}`,
    narrationTags: (query: string) => `Je cherche ${query} dans le graphe des goûts de Qloo`,
    replanStarted: {
      lit_up: "Je m'appuie sur ce fil…",
      neutral: "J'essaie autre chose…",
      upset: "La personne a l'air bouleversée. Je ralentis avec quelque chose de calme et familier…",
    },
    results: (n: number) => (n === 0 ? "rien de correspondant" : n === 1 ? "1 trouvé" : `${n} trouvés`),
    cached: "en cache",
    mock: "données démo",
    live_: "en direct",
    coverage: {
      summary: "Notes de couverture",
      line: (domain: string, actual: number, required: number, reason: string) => `couverture : ${domain} ${actual}/${required} (raison : ${reason})`,
      reasons: {
        primary_not_verified: "ancrage principal non vérifié",
        no_viable_alternative: "aucune alternative viable",
        composer_omitted: "non utilisé dans le plan",
      },
    },
    params: "Paramètres envoyés (ancres culturelles uniquement, jamais de données personnelles)",
    rejectedKinds: {
      not_found: "Introuvable dans Qloo",
      anachronism: "Mauvaise époque",
      wrong_locale: "Mauvais lieu",
      wrong_locale_cultural: "Ne colle pas culturellement",
      emotional_risk: "Risque d'émotion",
      duplicate: "Doublon",
      low_relevance: "Peu pertinent",
    },
    recoverable: "Récupéré",
    fatal: "Arrêté",
  },
  step: {
    kinds: {
      opening: "Accueil",
      listen: "Écoute",
      look: "Regardons ensemble",
      talk: "Parole",
      taste: "Goûter et sentir",
      move: "Bouger",
      closing: "Clôture",
    },
    number: (n: number) => `Étape ${n}`,
    minutes: (n: number) => `${n} min`,
    say: "Dites",
    translation: "Sens",
    followUps: "Si elle s'ouvre",
    tip: "Astuce",
    media: "Trouvez-le",
    searchMedia: "Chercher en ligne",
    opensInNewTab: "(s'ouvre dans un nouvel onglet)",
    verified: "Vérifié dans Qloo",
    verifiedHint:
      "Le modèle de langage l'a proposé et Qloo a confirmé qu'il existe, avec son année et ses métadonnées.",
    discovery: (pct?: number) =>
      pct === undefined ? "Découverte Qloo" : `Découverte Qloo · ${pct}%`,
    discoveryHint:
      "Trouvé grâce au graphe des goûts de Qloo : ce qu'aiment aussi les groupes de personnes qui apprécient les points de départ. Une piste à essayer, pas une prédiction sur cette personne.",
    llmOnly: "Idée du modèle de langage",
    llmOnlyHint: "Non vérifié avec Qloo. Faites confiance à votre jugement.",
    changed: "Adapté",
    removed: (label: string) => `Mis de côté pour l'instant : ${label}`,
    lifePhase: {
      childhood: "De l'enfance",
      youth: "De la jeunesse",
      early_adulthood: "Du début de l'âge adulte",
      mid_life: "De l'âge mûr",
      later_life: "Des années récentes",
    },
    lifePhaseHint: (ageRange: string) => `Un souvenir autour de ${ageRange} ans.`,
    listen: "Écouter",
    listenHint: (language: string) => `Écouter la phrase en ${language}`,
    listenError: "Voix indisponible pour le moment.",
    listenErrors: {
      unavailable: "Voix indisponible pour le moment.",
      rate_limited: "Elle prend un petit répit ; réessayez dans une minute.",
      network: "Voix hors ligne ; réessayez quand la connexion revient.",
    },
  },
  enforcement: {
    music: {
      listen: {
        prompt: (label: string) => `Écoutons ${label} ensemble.`,
        tip: (label: string) => `${label} fait partie de leur monde musical ; restez bref et laissez-les guider.`,
        mediaHint: (label: string) => `Chercher '${label}' sur YouTube`,
      },
      move: {
        prompt: (label: string) => `Bougeons doucement sur ${label}.`,
        tip: (label: string) => `${label} fait partie de leur monde musical ; restez bref et laissez-les guider.`,
        mediaHint: (label: string) => `Chercher '${label}' sur YouTube`,
      },
    },
  },
  live: {
    title: "Mode séance",
    close: "Fermer le mode séance",
    progress: (n: number, total: number) => `Étape ${n} sur ${total}`,
    prev: "Précédent",
    next: "Suivant",
    finish: "Terminer",
    showTranslation: "Afficher le sens",
    hideTranslation: "Masquer le sens",
    timer: "Minuteur de l'étape",
    start: "Démarrer le minuteur",
    pause: "Mettre le minuteur en pause",
    reset: "Remettre le minuteur à zéro",
    timeUp: "Le temps est écoulé. Passez quand ça vous semble juste.",
    remaining: (time: string) => `${time} restantes`,
    howDidItGo: "Quelle a été la réaction ?",
    reactions: { lit_up: "A rayonné", neutral: "Tranquille", upset: "Troublé·e" },
    reactionHints: {
      lit_up: "Appuyez-vous sur ce fil",
      neutral: "Essayez autre chose",
      upset: "Apaisez le moment",
    },
    recorded: (label: string) => `Noté : ${label}`,
    hearingYou: "Je vous écoute",
    adapting: "J'ajuste ce qui vient après…",
    adapted: (title: string) => `Plan adapté. Vient ensuite : ${title}`,
    unchanged: "Plan vérifié. Rien n'avait besoin de changer.",
    adaptFailed: "Impossible d'adapter le plan pour l'instant. Continuez comme prévu.",
    upNext: "Vient ensuite",
    keyboard:
      "Touches : flèches gauche et droite pour se déplacer, espace pour démarrer ou mettre le minuteur en pause.",
    done: "C'était la dernière étape. Merci d'avoir partagé ce moment ensemble.",
    doneAction: "Terminer",
    planAnother: "Préparer une autre séance",
  },
  compare: {
    eyebrow: "Comparaison",
    title: (name: string) => `Mêmes notes sur ${name}, deux planificateurs`,
    lead:
      "À gauche : un plan du modèle de langage seul. À droite : le même modèle, avec le graphe de goûts de Qloo qui fait entrer les chansons, films et visages précis que les notes du proche aidant ne pouvaient nommer, et qui rattrape ceux qui n'auraient pas convenu.",
    llmOnly: "Modèle de langage seul",
    grounded: "Ancré dans Qloo",
    scoreTitle: "Ce que l'ancrage apporte",
    headline: (brought: number, caught: number, verified: number, name: string) => {
      if (brought > 0) {
        const clauses: string[] = [
          `Qloo a fait émerger ${brought} ${brought === 1 ? "ancre culturelle" : "ancres culturelles"} que les notes sur ${name} n'évoquaient pas`,
        ];
        if (caught > 0) clauses.push(`a rattrapé ${caught} erreur${caught === 1 ? "" : "s"} d'époque`);
        if (verified > 0) clauses.push(`confirmé ${verified} correspondance${verified === 1 ? "" : "s"} réelle${verified === 1 ? "" : "s"}`);
        if (clauses.length === 1) return `${clauses[0]}.`;
        if (clauses.length === 2) return `${clauses[0]} et ${clauses[1]}.`;
        return `${clauses[0]}, ${clauses[1]} et ${clauses[2]}.`;
      }
      if (caught === 0) {
        return "Voici où le modèle aurait avancé à l'aveugle, et voici où Qloo a pris le relais.";
      }
      return `L'agent a rattrapé ${caught} erreur${caught === 1 ? "" : "s"} et confirmé ${verified} correspondance${verified === 1 ? "" : "s"} réelle${verified === 1 ? "" : "s"}.`;
    },
    headlineQlooQuiet: "Qloo n'a rien ramené de nouveau cette fois ; regardez les rattrapages.",
    headlineNone: "Aucune erreur rattrapée pour cette exécution.",
    headlineBreakdown: (qloo: number, cultural: number, critique: number) => {
      const parts: string[] = [];
      if (qloo > 0) parts.push(`Qloo en a refusé ${qloo}`);
      if (cultural > 0) parts.push(`L'ancrage culturel en a rattrapé ${cultural}`);
      if (critique > 0) parts.push(`La critique en a rattrapé ${critique}`);
      return parts.length ? `${parts.join(". ")}.` : "";
    },
    headlineWorking: "Je vérifie chaque idée avec Qloo…",
    viaQloo: "via Qloo",
    viaCultural: "via l'ancrage culturel",
    viaCritique: "via la critique",
    metrics: {
      verified: "Chansons, films et visages confirmés réels",
      discoveries: "Découvertes de goût venues de Qloo",
      caught: "Erreurs d'époque, de lieu ou de risque évitées",
      anchored: "Étapes ancrées dans du réel",
      images: "Étapes avec une vraie image à regarder",
      calls: "Requêtes envoyées à Qloo",
    },
    callsCaption: (calls: number) =>
      `Ancré dans ${calls} requête${calls === 1 ? "" : "s"} à Qloo entre vérifier, élargir et critiquer.`,
    unchecked: "non vérifié",
    of: (n: number, total: number) => `${n} sur ${total}`,
    caughtTitle: "Rattrapé avant d'arriver au plan",
    caughtNone: "Rien n'a été mis de côté.",
    llmCaughtNone: "Rien n'est vérifié, donc rien n'est rattrapé.",
    llmBlind:
      "Ici rien n'est croisé. Les risques d'époque, de lieu et d'émotion ne sont pas repérés.",
    llmOnlyBanner:
      "Ce qu'un modèle de langage proposerait seul. Rekindle les a signalés comme hors époque ou culturellement décalés avant de les afficher.",
    wouldSlip: "Serait passé",
    glanceTitle: "D'un coup d'œil : ce que Qloo a rattrapé",
    openGrounded: "Ouvrir la séance ancrée",
    working: "Je travaille…",
  },
  print: {
    sheet: "Feuille de séance",
    reactions: "Quelle a été la réaction ?",
    notes: "Notes",
    footer: "Imprimé depuis Rekindle. Rien de ce que vous avez écrit n'a été conservé.",
    printButton: "Imprimer",
    printTitle: "Fiche de séance",
    printWhatWeHeard: "Ce que nous avons entendu",
    printIfTheySayNo: "Si la personne refuse",
    printFooter: "Plan de séance Rekindle. Ce n'est pas un avis médical.",
    printSessionDate: (date: string) => `Imprimé le ${date}.`,
    printNotFound: "Séance introuvable. Ouvrez le planificateur et réessayez.",
    printNotFoundCustom:
      "Aucune séance à imprimer pour l'instant. Composez la séance dans l'onglet où vous avez écrit les notes, puis rouvrez l'impression depuis cet onglet.",
    printError: "Le planificateur n'a pas pu terminer cette fiche. Réessayez.",
    printRetry: "Réessayer",
    printPersonMeta: (year: number, language: string) => `Né·e en ${year} · séance en ${language}`,
    printFallbacks: {
      opening: "Rester encore un moment, sans questions.",
      listen: "Offrir un moment de calme, sans musique.",
      look: "Ranger la photo et rester ensemble.",
      talk: "Laisser la question, garder le silence.",
      taste: "Proposer plutôt une odeur familière.",
      move: "Un geste plus lent, ou simplement poser les mains.",
      closing: "Un au revoir court et chaleureux.",
    },
  },
  notFound: {
    title: "Cette page n'est pas là",
    body:
      "Rien n'est conservé dans Rekindle, les anciens liens de séance ne survivent donc pas. Repartez d'une personne de démo ou de vos propres notes.",
    home: "Retour au début",
  },
  domains: {
    music: "Musique",
    film: "Cinéma",
    television: "Télévision",
    food: "Cuisine",
    fashion: "Mode",
    sport: "Sport",
    public_figure: "Visage célèbre",
    book: "Livre",
    place: "Lieu",
  },
  errors: {
    cancelled: "Arrêté.",
    invalid: "Le planificateur n'a pas pu accepter ces notes. Vérifiez-les et réessayez.",
    busy: "Le planificateur est occupé en ce moment. Réessayez dans une minute.",
    unreachable: "Le planificateur n'est pas joignable en ce moment. Réessayez.",
    network: "La connexion a été perdue. Vérifiez votre réseau et réessayez.",
    unknown: "Quelque chose s'est mal passé pendant la lecture du plan. Réessayez.",
  },
  sample: {
    replanStarted: {
      lit_up: "C'est bien passé. Je m'appuie sur ce fil…",
      neutral: "Pas de réaction cette fois. J'essaie un autre moment ensuite…",
      upset: "La personne a l'air bouleversée. Je ralentis avec quelque chose de calme et familier…",
    },
    replanNote:
      "Démo enregistrée : le plan reste tel quel. Branchez le planificateur en direct pour l'adapter pour de vrai.",
    replanCompleted: "Plan vérifié. Reprenez quand vous voulez.",
  },
  qloo: {
    chipLinked: (context: string) => `Qloo : liens avec ${context}`,
    chipConfirmed: (context: string) => `Qloo : ${context} confirmé`,
    chipEra: (year: number) => `époque ${year}`,
  },
  footer: {
    disclaimer:
      "Rekindle propose des activités de réminiscence. Ce n'est ni un conseil médical, ni une thérapie, ni un outil de diagnostic. Suivez le rythme de la personne, arrêtez-vous si elle semble mal à l'aise, et parlez de toute question de santé avec son équipe de soin.",
    privacy:
      "Rien de ce que vous écrivez n'est conservé. Pas de compte, pas de base de données : vos notes ne vivent que dans cet onglet.",
    qloo:
      "Les suggestions culturelles sont ancrées dans le graphe des goûts de Qloo, qui décrit ce qu'aiment aussi les groupes de personnes qui apprécient une chose donnée.",
    credit: "Construit pour le Qloo Agentic Hackathon.",
  },
  tour: {
    badge: ({ name, current, total }: { name: string; current: number; total: number }) =>
      `Visite : ${name}, ${current} sur ${total}`,
    pause: "Pause",
    play: "Lecture",
    next: "Suivant",
    returnHome: "Retour à l'accueil",
  },
};
