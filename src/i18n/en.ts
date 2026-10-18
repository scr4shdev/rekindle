/** English UI strings (caregiver language). Non-medical wording only: "activity", never "therapy". */
export const en = {
  app: {
    name: "Rekindle",
    tagline: "Reminiscence activities, rebuilt from their own era",
    skipToContent: "Skip to content",
    nav: { home: "Home", compare: "Compare" },
    theme: { toggle: "Switch light or dark theme", light: "Light", dark: "Dark" },
  },
  landing: {
    eyebrow: "A reminiscence activity planner for family and caregivers",
    title: "Bring back the songs, films and faces of their youth.",
    lead: "Write a few lines about someone you care for. Rekindle's agent rebuilds the cultural world of their teens and twenties, checks every idea against Qloo's taste graph, and hands you a gentle, timed activity in their own language.",
    leadShort: "A few lines of notes become a gentle activity from their own era, checked against Qloo.",
    promises: {
      stored: "Nothing you type is stored",
      activity: "A shared activity, not therapy",
      grounded: "Ideas checked against Qloo",
    },
    personasTitle: "Try it in one tap",
    personasLead: "Three fictional people, three places and eras. Pick one and watch the agent work.",
    openSession: (name: string) => `Plan ${name}'s session`,
    sessionIn: (language: string) => `Session in ${language}`,
    minutes: (n: number) => `${n} min`,
    era: (from: string, to: string) => (from === to ? from : `${from} to ${to}`),
    howTitle: "How it works",
    how: [
      { title: "Tell us a little", body: "Birth year, where they grew up, what they loved, and anything to avoid." },
      { title: "Watch the agent think", body: "Ideas are proposed, checked against Qloo, expanded by taste affinity, and anachronisms are removed." },
      { title: "Run it together", body: "One prompt at a time, with a timer. Tap how they reacted and the plan adapts." },
    ],
    customTitle: "Or describe someone you care for",
    customLead: "A few sentences are enough. Your words go to the planner once and are never saved.",
  },
  footer: {
    disclaimer:
      "Rekindle suggests reminiscence activities. It is not medical advice, therapy or a diagnosis tool. Follow the person's lead, stop if they seem uncomfortable, and check with their care team about anything health-related.",
    privacy: "Nothing you type is stored. No account, no database: your notes live only in this browser tab.",
    qloo: "Cultural suggestions are grounded in Qloo's taste graph, which describes what groups of people who enjoy one thing also tend to enjoy.",
    credit: "Built for the Qloo Agentic Hackathon.",
  },
} as const;
