require("dotenv").config();

const express = require("express");

const app = express();

// ============================================================
// CORS
// ============================================================

app.use((req, res, next) => {
  const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];

  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      origin
    );
  }

  res.setHeader("Vary", "Origin");

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, DELETE, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const PORT = 3002;

const API_BASE = (
  process.env.SPORTSCORE_BASE_URL ||
  "https://sportscore.com/api/v1"
).replace(/\/+$/, "");

const API_KEY =
  process.env.SPORTSCORE_API_KEY ||
  process.env.SPORT_SCORE_API_KEY ||
  process.env.SPORTSCORE_API_TOKEN ||
  "";

const POLL_INTERVAL =
  Number(process.env.POLL_INTERVAL) || 30_000;

const REQUEST_TIMEOUT =
  Number(process.env.REQUEST_TIMEOUT) || 15_000;

// ============================================================
// CACHE
// ============================================================

const liveCache = new Map();
const todayCache = new Map();
const searchCache = new Map();

const LIVE_CACHE_TTL = 10_000;
const TODAY_CACHE_TTL = 25_000;
const SEARCH_CACHE_TTL = 10 * 60_000;

const pendingRequests = new Map();

// ============================================================
// 8 COMPETIÇÕES
// ============================================================

const COMPETITIONS = [
  {
    key: "premierLeague",
    name: "Premier League",

    slugs: [
      "premier-league",
      "england-premier-league",
      "english-premier-league",
    ],

    searchTerms: [
      "Premier League",
      "English Premier League",
    ],

    aliases: [
      "Premier League",
      "English Premier League",
    ],

    preferredNames: [
      "English Premier League",
      "Premier League",
    ],
  },

  {
    key: "primeiraLiga",
    name: "Portuguese Primera Liga",

    slugs: [
      "portuguese-primera-liga",
      "primeira-liga",
      "liga-portugal",
      "portugal-primeira-liga",
    ],

    searchTerms: [
      "Portuguese Primera Liga",
      "Primeira Liga",
      "Liga Portugal",
    ],

    aliases: [
      "Portuguese Primera Liga",
      "Primeira Liga",
      "Liga Portugal",
      "Portugal Primeira Liga",
    ],

    preferredNames: [
      "Portuguese Primera Liga",
      "Primeira Liga",
      "Liga Portugal",
    ],
  },

  {
    key: "bundesliga",
    name: "Bundesliga",

    slugs: [
      "bundesliga",
      "german-bundesliga",
    ],

    searchTerms: [
      "Bundesliga",
      "German Bundesliga",
    ],

    aliases: [
      "Bundesliga",
      "German Bundesliga",
    ],

    preferredNames: [
      "Bundesliga",
      "German Bundesliga",
    ],
  },

  {
    key: "serieA",
    name: "Serie A",

    slugs: [
      "italian-serie-a",
      "serie-a",
    ],

    searchTerms: [
      "Serie A",
      "Italian Serie A",
    ],

    aliases: [
      "Serie A",
      "Italian Serie A",
      "Serie A Italy",
    ],

    preferredNames: [
      "Italian Serie A",
      "Serie A Italy",
      "Serie A",
    ],
  },

  {
    key: "laLiga",
    name: "La Liga",

    slugs: [
      "spanish-la-liga",
      "la-liga",
      "primera-division",
    ],

    searchTerms: [
      "La Liga",
      "Spanish La Liga",
      "Primera Division",
    ],

    aliases: [
      "La Liga",
      "Spanish La Liga",
      "Spanish Primera Division",
      "Primera Division",
    ],

    preferredNames: [
      "Spanish La Liga",
      "La Liga",
    ],
  },

  {
    key: "ligue1",
    name: "Ligue 1",

    slugs: [
      "french-ligue-1",
      "ligue-1",
    ],

    searchTerms: [
      "Ligue 1",
      "French Ligue 1",
    ],

    aliases: [
      "Ligue 1",
      "French Ligue 1",
      "Ligue 1 France",
    ],

    preferredNames: [
      "French Ligue 1",
      "Ligue 1 France",
      "Ligue 1",
    ],
  },

  {
    key: "eredivisie",
    name: "Eredivisie",

    slugs: [
      "netherlands-eredivisie",
      "eredivisie",
      "dutch-eredivisie",
    ],

    searchTerms: [
      "Eredivisie",
      "Dutch Eredivisie",
      "Netherlands Eredivisie",
    ],

    aliases: [
      "Eredivisie",
      "Netherlands Eredivisie",
      "Dutch Eredivisie",
    ],

    preferredNames: [
      "Netherlands Eredivisie",
      "Dutch Eredivisie",
      "Eredivisie",
    ],
  },

  {
    key: "championsLeague",
    name: "Champions League",

    slugs: [
      "uefa-champions-league",
      "champions-league",
    ],

    searchTerms: [
      "Champions League",
      "UEFA Champions League",
    ],

    aliases: [
      "Champions League",
      "UEFA Champions League",
    ],

    preferredNames: [
      "UEFA Champions League",
      "Champions League",
    ],
  },

  {
    key: "brasileirao",
    name: "Brasileirão Série A",

    slugs: [
      "brazilian-serie-a",
      "brazil-serie-a",
      "brasileirao-serie-a",
      "brasileirao",
      "campeonato-brasileiro-serie-a",
    ],

    searchTerms: [
      "Brasileirão Série A",
      "Brasileirao",
      "Brazilian Serie A",
      "Brazil Serie A",
      "Campeonato Brasileiro Série A",
    ],

    aliases: [
      "Brasileirão Série A",
      "Brasileirao",
      "Brazilian Serie A",
      "Brazil Serie A",
      "Campeonato Brasileiro Série A",
      "Brasileirão",
    ],

    preferredNames: [
      "Brasileirão Série A",
      "Brasileirao",
      "Brazilian Serie A",
      "Campeonato Brasileiro Série A",
    ],
  },
];

// ============================================================
// ESTADO
// ============================================================

const previousMatches = new Map();
const matchStates = new Map();
const goalEvents = new Map();
const matchEvents = new Map();

const activeCompetitionSlugs = new Map();

let lastLiveMatches = [];
let lastTodayMatches = [];

let lastPollTime = null;
let lastSuccessfulPoll = null;
let pollRunning = false;

// ============================================================
// NORMALIZAÇÃO
// ============================================================

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompetitionText(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ============================================================
// MAPA DE COMPETIÇÕES
// ============================================================

const COMPETITION_LOOKUP = new Map();

for (const competition of COMPETITIONS) {
  COMPETITION_LOOKUP.set(
    normalizeCompetitionText(
      competition.name
    ),
    competition
  );

  for (const alias of competition.aliases) {
    COMPETITION_LOOKUP.set(
      normalizeCompetitionText(
        alias
      ),
      competition
    );
  }

  for (const slug of competition.slugs) {
    COMPETITION_LOOKUP.set(
      normalizeCompetitionText(
        slug
      ),
      competition
    );
  }
}

// ============================================================
// COMPETIÇÃO
// ============================================================

function getCompetition(rawMatch) {
  const candidates = [
    rawMatch?.competition,
    rawMatch?.league,
    rawMatch?.tournament,
    rawMatch?.competition_name,
    rawMatch?.competitionName,
    rawMatch?.league_name,
    rawMatch?.leagueName,
    rawMatch?.tournament_name,
    rawMatch?.tournamentName,
  ];

  for (const value of candidates) {
    if (!value) {
      continue;
    }

    if (typeof value === "object") {
      const objectCandidates = [
        value.name,
        value.title,
        value.slug,
        value.short_name,
        value.shortName,
        value.competition_name,
        value.competitionName,
        value.league_name,
        value.leagueName,
      ];

      for (const objectValue of objectCandidates) {
        const competition =
          COMPETITION_LOOKUP.get(
            normalizeCompetitionText(
              objectValue
            )
          );

        if (competition) {
          return competition;
        }
      }

      continue;
    }

    const normalized =
      normalizeCompetitionText(value);

    const exact =
      COMPETITION_LOOKUP.get(
        normalized
      );

    if (exact) {
      return exact;
    }
  }

  const allText = candidates
    .filter(Boolean)
    .map(value => {
      if (typeof value === "object") {
        return [
          value.name,
          value.title,
          value.slug,
          value.short_name,
          value.shortName,
        ]
          .filter(Boolean)
          .join(" ");
      }

      return String(value);
    })
    .join(" ");

  const text =
    normalizeCompetitionText(
      allText
    );

  if (
    text.includes("english premier league") ||
    text.includes("england premier league")
  ) {
    return COMPETITION_LOOKUP.get(
      "premier league"
    );
  }

  if (
    text.includes("portuguese primera liga") ||
    text.includes("primeira liga") ||
    text.includes("liga portugal")
  ) {
    return COMPETITION_LOOKUP.get(
      "portuguese primera liga"
    );
  }

  if (
    text === "bundesliga" ||
    text.includes("german bundesliga")
  ) {
    return COMPETITION_LOOKUP.get(
      "bundesliga"
    );
  }

  if (
    text.includes("italian serie a") ||
    text.includes("serie a italy") ||
    text === "serie a"
  ) {
    return COMPETITION_LOOKUP.get(
      "serie a"
    );
  }

  if (
    text.includes("spanish la liga") ||
    text === "la liga"
  ) {
    return COMPETITION_LOOKUP.get(
      "la liga"
    );
  }

  if (
    text.includes("french ligue 1") ||
    text.includes("ligue 1 france") ||
    text === "ligue 1"
  ) {
    return COMPETITION_LOOKUP.get(
      "ligue 1"
    );
  }

  if (
    text.includes("netherlands eredivisie") ||
    text.includes("dutch eredivisie") ||
    text === "eredivisie"
  ) {
    return COMPETITION_LOOKUP.get(
      "eredivisie"
    );
  }

  if (
    text.includes("uefa champions league") ||
    text === "champions league"
  ) {
    return COMPETITION_LOOKUP.get(
      "champions league"
    );
  }

  return null;
}

// ============================================================
// SCORE
// ============================================================

function parseScore(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : 0;
  }

  if (typeof value === "object") {
    return parseScore(
      value.current ??
      value.value ??
      value.goals ??
      value.score ??
      value.display
    );
  }

  const text = String(value);

  const match =
    text.match(/-?\d+/);

  if (!match) {
    return 0;
  }

  const number =
    Number(match[0]);

  return Number.isFinite(number)
    ? number
    : 0;
}

// ============================================================
// DATA DA API
// ============================================================

function getApiDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).format(new Date());
}

// ============================================================
// HEADERS
// ============================================================

function getHeaders() {
  const headers = {
    Accept: "application/json",
  };

  if (API_KEY) {
    headers["X-Api-Key"] =
      API_KEY;
  }

  return headers;
}

// ============================================================
// EXTRAIR MATCHES
// ============================================================

function extractMatches(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data.matches)) {
    return data.matches;
  }

  if (Array.isArray(data.fixtures)) {
    return data.fixtures;
  }

  if (Array.isArray(data.results)) {
    return data.results;
  }

  if (Array.isArray(data.data)) {
    return data.data;
  }

  if (
    data.data &&
    Array.isArray(
      data.data.matches
    )
  ) {
    return data.data.matches;
  }

  if (
    data.data &&
    Array.isArray(
      data.data.fixtures
    )
  ) {
    return data.data.fixtures;
  }

  return [];
}

// ============================================================
// REQUEST GENÉRICO
// ============================================================

async function requestJson(
  url,
  {
    cache = null,
    cacheTtl = 0,
    forceRefresh = false,
  } = {}
) {
  if (
    cache &&
    !forceRefresh
  ) {
    const cached =
      cache.get(url);

    if (
      cached &&
      Date.now() -
        cached.time <
        cacheTtl
    ) {
      return {
        url,
        data:
          cached.data,
        cached: true,
      };
    }
  }

  if (
    pendingRequests.has(url)
  ) {
    return pendingRequests.get(
      url
    );
  }

  const promise =
    (async () => {
      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () =>
            controller.abort(),
          REQUEST_TIMEOUT
        );

      try {
        const response =
          await fetch(
            url,
            {
              method: "GET",
              headers:
                getHeaders(),
              signal:
                controller.signal,
            }
          );

        const text =
          await response.text();

        if (!response.ok) {
          throw new Error(
            `HTTP ${
              response.status
            }: ${text.slice(
              0,
              500
            )}`
          );
        }

        let data;

        try {
          data =
            JSON.parse(
              text
            );
        } catch {
          throw new Error(
            "A API devolveu uma resposta que não é JSON."
          );
        }

        if (cache) {
          cache.set(url, {
            time:
              Date.now(),
            data,
          });
        }

        return {
          url,
          data,
          cached: false,
        };
      } finally {
        clearTimeout(
          timeout
        );
      }
    })();

  pendingRequests.set(
    url,
    promise
  );

  try {
    return await promise;
  } finally {
    pendingRequests.delete(
      url
    );
  }
}

// ============================================================
// REQUEST DE FIXTURES
// ============================================================

async function requestFixtures({
  competitionSlug = null,
  liveOnly = false,
  forceRefresh = false,
} = {}) {
  const params =
    new URLSearchParams();

  params.set(
    "sport",
    "football"
  );

  params.set(
    "date",
    getApiDate()
  );

  params.set(
    "limit",
    "200"
  );

  if (competitionSlug) {
    params.set(
      "competition",
      competitionSlug
    );
  }

  if (liveOnly) {
    params.set(
      "status",
      "live"
    );
  }

  const url =
    `${API_BASE}/fixtures/?${params.toString()}`;

  return requestJson(
    url,
    {
      cache:
        liveOnly
          ? liveCache
          : todayCache,

      cacheTtl:
        liveOnly
          ? LIVE_CACHE_TTL
          : TODAY_CACHE_TTL,

      forceRefresh,
    }
  );
}

// ============================================================
// PESQUISA DE COMPETIÇÕES
// ============================================================

async function searchCompetition(
  query
) {
  const params =
    new URLSearchParams();

  params.set(
    "q",
    query
  );

  params.set(
    "sport",
    "football"
  );

  params.set(
    "limit",
    "20"
  );

  const url =
    `${API_BASE}/search/?${params.toString()}`;

  const result =
    await requestJson(
      url,
      {
        cache:
          searchCache,

        cacheTtl:
          SEARCH_CACHE_TTL,
      }
    );

  return result.data;
}

// ============================================================
// EXTRAIR RESULTADOS DE COMPETIÇÕES
// ============================================================

function extractCompetitionResults(
  data
) {
  const results = [];

  const visited =
    new Set();

  function add(value) {
    if (!value) {
      return;
    }

    if (
      typeof value !==
      "object"
    ) {
      return;
    }

    if (
      visited.has(value)
    ) {
      return;
    }

    visited.add(value);

    const slug =
      value.slug ||
      value.competition_slug ||
      value.competitionSlug ||
      value.league_slug ||
      value.leagueSlug ||
      null;

    const name =
      value.name ||
      value.title ||
      value.competition_name ||
      value.competitionName ||
      value.league_name ||
      value.leagueName ||
      null;

    if (
      slug &&
      name
    ) {
      results.push({
        ...value,
        slug:
          String(slug),
        name:
          String(name),
      });
    }

    for (
      const key of [
        "competitions",
        "competition",
        "results",
        "data",
        "items",
        "leagues",
        "tournaments",
      ]
    ) {
      const child =
        value[key];

      if (
        Array.isArray(child)
      ) {
        for (
          const item
          of child
        ) {
          add(item);
        }
      } else if (
        child &&
        typeof child ===
          "object"
      ) {
        add(child);
      }
    }
  }

  if (
    Array.isArray(data)
  ) {
    for (
      const item
      of data
    ) {
      add(item);
    }
  } else {
    add(data);
  }

  const unique =
    new Map();

  for (
    const result
    of results
  ) {
    if (
      !unique.has(
        result.slug
      )
    ) {
      unique.set(
        result.slug,
        result
      );
    }
  }

  return [
    ...unique.values(),
  ];
}

// ============================================================
// ENCONTRAR A MELHOR COMPETIÇÃO
// ============================================================

function findCompetitionFromSearch(
  competition,
  results
) {
  if (
    !Array.isArray(results) ||
    !results.length
  ) {
    return null;
  }

  // ============================================================
  // PREMIER LEAGUE — TEM DE SER A INGLESA
  // ============================================================

  if (
    competition.key ===
    "premierLeague"
  ) {
    const bySlug =
      results.find(
        item => {
          const slug =
            normalizeText(
              item?.slug || ""
            );

          return (
            slug ===
            "premier-league"
          );
        }
      );

    if (bySlug) {
      return bySlug;
    }

    const byExactName =
      results.find(
        item => {
          const name =
            normalizeText(
              item?.name ||
              item?.title ||
              item?.competition_name ||
              item?.competitionName ||
              ""
            );

          return (
            name ===
            "premier league"
          );
        }
      );

    if (byExactName) {
      return byExactName;
    }

    const byEnglishName =
      results.find(
        item => {
          const name =
            normalizeText(
              item?.name ||
              item?.title ||
              item?.competition_name ||
              item?.competitionName ||
              ""
            );

          return (
            name ===
              "english premier league" ||
            name ===
              "england premier league"
          );
        }
      );

    if (byEnglishName) {
      return byEnglishName;
    }

    return null;
  }

  // ============================================================
  // RESTANTES COMPETIÇÕES
  // ============================================================

  const aliases = [
    competition.name,
    ...(competition.aliases || []),
  ]
    .map(normalizeText)
    .filter(Boolean);

  const slugs =
    (competition.slugs || [])
      .map(normalizeText)
      .filter(Boolean);

  const bySlug =
    results.find(
      item => {
        const slug =
          normalizeText(
            item?.slug || ""
          );

        return slugs.includes(
          slug
        );
      }
    );

  if (bySlug) {
    return bySlug;
  }

  const byExactName =
    results.find(
      item => {
        const name =
          normalizeText(
            item?.name ||
            item?.title ||
            item?.competition_name ||
            item?.competitionName ||
            ""
          );

        return aliases.includes(
          name
        );
      }
    );

  if (byExactName) {
    return byExactName;
  }

  return null;
}

// ============================================================
// DESCOBRIR SLUGS DAS 8 COMPETIÇÕES
// ============================================================

async function discoverCompetitionSlugs() {
  activeCompetitionSlugs.clear();

  for (
    const competition
    of COMPETITIONS
  ) {
    let selected = null;

    for (
      const searchTerm
      of competition.searchTerms ||
      [competition.name]
    ) {
      try {
        const results =
          await searchCompetition(
            searchTerm
          );

        const extracted =
          extractCompetitionResults(
            results
          );

        selected =
          findCompetitionFromSearch(
            competition,
            extracted
          );

        if (
          selected?.slug
        ) {
          break;
        }
      } catch (error) {
        console.error(
          `❌ Erro ao procurar ${competition.name}:`,
          error.message
        );
      }
    }

    if (
      !selected?.slug
    ) {
      const fallbackSlug =
        competition.slugs?.[0];

      if (fallbackSlug) {
        selected = {
          name:
            competition.name,

          slug:
            fallbackSlug,
        };
      }
    }

    if (
      selected?.slug
    ) {
      activeCompetitionSlugs.set(
        competition.key,
        selected.slug
      );
    } else {
      console.error(
        `❌ Não foi possível encontrar ${competition.name}`
      );
    }
  }

  console.log(
    `\n⚽ Competições ativas: ${activeCompetitionSlugs.size}/${COMPETITIONS.length}`
  );

  for (
    const competition
    of COMPETITIONS
  ) {
    const slug =
      activeCompetitionSlugs.get(
        competition.key
      );

    console.log(
      slug
        ? `   ✅ ${competition.name} → ${slug}`
        : `   ❌ ${competition.name}`
    );
  }

  console.log("");
}

// ============================================================
// NORMALIZAR STATUS
// ============================================================

function normalizeStatus(
  value
) {
  if (
    value &&
    typeof value ===
      "object"
  ) {
    return normalizeText(
      value.name ||
      value.status ||
      value.type ||
      value.short ||
      value.code ||
      ""
    );
  }

  return normalizeText(
    value
  );
}

// ============================================================
// STATUS LIVE
// ============================================================

function isLiveStatus(
  status
) {
  const value =
    normalizeStatus(
      status
    );

  return [
    "live",
    "in play",
    "inplay",
    "playing",
    "1h",
    "2h",
    "first half",
    "second half",
    "halftime",
    "half time",
    "ht",
    "extra time",
    "et",
    "overtime",
    "penalties",
    "penalty",
  ].includes(value);
}

// ============================================================
// STATUS FINISHED
// ============================================================

function isFinishedStatus(
  status
) {
  const value =
    normalizeStatus(
      status
    );

  return [
    "finished",
    "finished aet",
    "ft",
    "full time",
    "ended",
    "complete",
    "completed",
    "after extra time",
    "aet",
    "after penalties",
    "ap",
  ].includes(value);
}

// ============================================================
// NORMALIZAR EQUIPA
// ============================================================

function normalizeTeam(
  team,
  fallback
) {
  if (!team) {
    return {
      name: fallback,
      logo: null,
    };
  }

  if (
    typeof team ===
    "string"
  ) {
    return {
      name: team,
      logo: null,
    };
  }

  return {
    name:
      team.name ||
      team.title ||
      team.short_name ||
      team.shortName ||
      fallback,

    logo:
      team.logo ||
      team.image ||
      team.logo_url ||
      team.logoUrl ||
      null,
  };
}

// ============================================================
// NORMALIZAR JOGO
// ============================================================

function normalizeMatch(
  rawMatch,
  competition
) {
  const home =
    normalizeTeam(
      rawMatch.home ??
        rawMatch.home_team ??
        rawMatch.homeTeam ??
        rawMatch.teams?.home,

      "Casa"
    );

  const away =
    normalizeTeam(
      rawMatch.away ??
        rawMatch.away_team ??
        rawMatch.awayTeam ??
        rawMatch.teams?.away,

      "Fora"
    );

  const homeScore =
    parseScore(
      rawMatch.home_score ??
        rawMatch.homeScore ??
        rawMatch.score?.home ??
        rawMatch.scores?.home ??
        rawMatch.home?.score
    );

  const awayScore =
    parseScore(
      rawMatch.away_score ??
        rawMatch.awayScore ??
        rawMatch.score?.away ??
        rawMatch.scores?.away ??
        rawMatch.away?.score
    );

  const status =
    normalizeStatus(
      rawMatch.status ??
        rawMatch.state ??
        rawMatch.match_status
    );

  const statusText =
    String(
      rawMatch.status_text ||
        rawMatch.statusText ||
        ""
    ).trim();

  const isLive =
    isLiveStatus(
      status
    );

  const isFinished =
    isFinishedStatus(
      status
    );

  const matchId =
    rawMatch.id ??
    rawMatch.fixture_id ??
    rawMatch.fixtureId ??
    rawMatch.match_id ??
    rawMatch.matchId ??
    rawMatch.url ??
    `${home.name}|${away.name}|${
      rawMatch.time || ""
    }`;

  return {
    id: String(
      matchId
    ),

    homeTeam:
      home.name,

    awayTeam:
      away.name,

    homeLogo:
      home.logo,

    awayLogo:
      away.logo,

    homeScore,

    awayScore,

    score:
      `${homeScore}-${awayScore}`,

    status,

    statusText,

    isLive,

    isFinished,

    time:
      rawMatch.time ||
      rawMatch.start_time ||
      rawMatch.startTime ||
      null,

    competition,

    competitionRaw:
      rawMatch.competition ||
      "",

    competitionLogo:
      rawMatch.competition_logo ||
      rawMatch.competitionLogo ||
      null,

    url:
      rawMatch.url ||
      rawMatch.match_url ||
      null,

    raw:
      rawMatch,
  };
}

// ============================================================
// CRIAR EVENTO DE JOGO
// ============================================================

function createMatchEvent(
  match,
  type
) {
  const eventKey =
    `${match.id}:${type}`;

  if (
    matchEvents.has(
      eventKey
    )
  ) {
    return;
  }

  let message = "";

  if (
    type ===
    "match_started"
  ) {
    message =
      `🟢 Jogo começou: ${match.homeTeam} vs ${match.awayTeam}`;
  }

  if (
    type ===
    "match_finished"
  ) {
    message =
      `🔴 Jogo acabou: ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`;
  }

  const event = {
    id: eventKey,

    type,

    timestamp:
      new Date().toISOString(),

    matchId:
      match.id,

    competition:
      match.competition.name,

    competitionKey:
      match.competition.key,

    homeTeam:
      match.homeTeam,

    awayTeam:
      match.awayTeam,

    homeScore:
      match.homeScore,

    awayScore:
      match.awayScore,

    score:
      match.score,

    matchUrl:
      match.url,

    homeLogo:
      match.homeLogo,

    awayLogo:
      match.awayLogo,

    competitionLogo:
      match.competitionLogo,

    message,
  };

  matchEvents.set(
    eventKey,
    event
  );

  console.log("");
  console.log(
    "📢 ========================================"
  );

  console.log(
    type ===
      "match_started"
      ? "🟢 JOGO COMEÇOU"
      : "🔴 JOGO ACABOU"
  );

  console.log(
    "📢 ========================================"
  );

  console.log(
    `🏆 ${match.competition.name}`
  );

  console.log(
    `⚽ ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`
  );

  console.log(
    "📢 ========================================"
  );

  console.log("");
}

// ============================================================
// PROCESSAR INÍCIO / FIM
// ============================================================

function processMatchLifecycle(
  currentMatches
) {
  for (
    const match
    of currentMatches
  ) {
    const previousState =
      matchStates.get(
        match.id
      );

    if (
      !previousState
    ) {
      matchStates.set(
        match.id,
        {
          status:
            match.status,

          isLive:
            match.isLive,

          isFinished:
            match.isFinished,

          homeScore:
            match.homeScore,

          awayScore:
            match.awayScore,
        }
      );

      continue;
    }

    if (
      !previousState.isLive &&
      match.isLive
    ) {
      createMatchEvent(
        match,
        "match_started"
      );
    }

    if (
      !previousState.isFinished &&
      match.isFinished
    ) {
      createMatchEvent(
        match,
        "match_finished"
      );
    }

    matchStates.set(
      match.id,
      {
        status:
          match.status,

        isLive:
          match.isLive,

        isFinished:
          match.isFinished,

        homeScore:
          match.homeScore,

        awayScore:
          match.awayScore,
      }
    );
  }
}

// ============================================================
// DETETAR GOLOS
// ============================================================

function processGoals(
  currentMatches
) {
  for (
    const match
    of currentMatches
  ) {
    const previous =
      previousMatches.get(
        match.id
      );

    if (
      !previous
    ) {
      previousMatches.set(
        match.id,
        match
      );

      continue;
    }

    if (
      match.homeScore >
      previous.homeScore
    ) {
      for (
        let score =
          previous.homeScore +
          1;

        score <=
        match.homeScore;

        score++
      ) {
        createGoalEvent(
          match,
          "home",
          score
        );
      }
    }

    if (
      match.awayScore >
      previous.awayScore
    ) {
      for (
        let score =
          previous.awayScore +
          1;

        score <=
        match.awayScore;

        score++
      ) {
        createGoalEvent(
          match,
          "away",
          score
        );
      }
    }

    previousMatches.set(
      match.id,
      match
    );
  }
}

// ============================================================
// CRIAR EVENTO DE GOLO
// ============================================================

function createGoalEvent(
  match,
  side,
  newScore
) {
  const team =
    side === "home"
      ? match.homeTeam
      : match.awayTeam;

  const eventKey =
    `${match.id}:goal:${side}:${newScore}`;

  if (
    goalEvents.has(
      eventKey
    )
  ) {
    return;
  }

  const now =
    new Date().toISOString();

  const event = {
    id: eventKey,

    type: "goal",

    timestamp: now,

    createdAt: now,

    matchId:
      match.id,

    competition:
      match.competition.name,

    competitionKey:
      match.competition.key,

    competitionLogo:
      match.competitionLogo,

    homeTeam: {
      name:
        match.homeTeam,

      shortName:
        match.homeTeam,

      logo:
        match.homeLogo ||
        null,
    },

    awayTeam: {
      name:
        match.awayTeam,

      shortName:
        match.awayTeam,

      logo:
        match.awayLogo ||
        null,
    },

    home:
      match.homeTeam,

    away:
      match.awayTeam,

    homeName:
      match.homeTeam,

    awayName:
      match.awayTeam,

    homeScore:
      match.homeScore,

    awayScore:
      match.awayScore,

    score: {
      home:
        match.homeScore,

      away:
        match.awayScore,
    },

    teamName:
      team,

    teamScored:
      team,

    scoringTeam:
      team,

    team:
      side === "home"
        ? "HOME"
        : "AWAY",

    side,

    minute: null,

    matchUrl:
      match.url,

    homeLogo:
      match.homeLogo ||
      null,

    awayLogo:
      match.awayLogo ||
      null,

    message:
      `⚽ Golo de ${team}! ` +
      `${match.homeTeam} ` +
      `${match.homeScore}-${match.awayScore} ` +
      `${match.awayTeam}`,
  };

  goalEvents.set(
    eventKey,
    event
  );

  console.log("");
  console.log(
    "⚽ ========================================"
  );
  console.log(
    "⚽ GOLO!"
  );
  console.log(
    "⚽ ========================================"
  );
  console.log(
    `🏆 ${match.competition.name}`
  );
  console.log(
    `⚽ ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`
  );
  console.log(
    `🎯 Marcou: ${team}`
  );
  console.log(
    "⚽ ========================================"
  );
  console.log("");
}

// ============================================================
// BUSCAR JOGOS LIVE
// ============================================================

async function fetchLiveMatches() {
  const allMatches = [];
  const seenMatches =
    new Set();

  for (
    const competition
    of COMPETITIONS
  ) {
    const slug =
      activeCompetitionSlugs.get(
        competition.key
      );

    if (!slug) {
      continue;
    }

    try {
      const result =
        await requestFixtures({
          competitionSlug:
            slug,

          liveOnly:
            true,
        });

      const rawMatches =
        extractMatches(
          result.data
        );

      for (
        const rawMatch
        of rawMatches
      ) {
        const detectedCompetition =
          getCompetition(
            rawMatch
          );

        const finalCompetition =
          detectedCompetition ||
          competition;

        if (
          detectedCompetition &&
          detectedCompetition.key !==
            competition.key
        ) {
          console.log(
            `⚠️ Ignorado jogo de competição diferente: ${
              detectedCompetition.name
            }`
          );

          continue;
        }

        const match =
          normalizeMatch(
            rawMatch,
            finalCompetition
          );

        if (
          !match.isLive
        ) {
          continue;
        }

        if (
          seenMatches.has(
            match.id
          )
        ) {
          continue;
        }

        seenMatches.add(
          match.id
        );

        allMatches.push(
          match
        );
      }
    } catch (error) {
      console.error(
        `❌ LIVE ${competition.name}: ${error.message}`
      );
    }
  }

  return allMatches;
}

// ============================================================
// BUSCAR TODOS OS JOGOS DO DIA
//
// IMPORTANTE:
// Esta função é chamada apenas UMA VEZ no arranque.
// Não é chamada pelo polling de 30 segundos.
// ============================================================

async function fetchTodayMatches() {
  const allMatches = [];
  const seenMatches =
    new Set();

  for (
    const competition
    of COMPETITIONS
  ) {
    const slug =
      activeCompetitionSlugs.get(
        competition.key
      );

    if (!slug) {
      continue;
    }

    try {
      const result =
        await requestFixtures({
          competitionSlug:
            slug,

          liveOnly:
            false,
        });

      const rawMatches =
        extractMatches(
          result.data
        );

      for (
        const rawMatch
        of rawMatches
      ) {
        const detectedCompetition =
          getCompetition(
            rawMatch
          );

        const finalCompetition =
          detectedCompetition ||
          competition;

        if (
          detectedCompetition &&
          detectedCompetition.key !==
            competition.key
        ) {
          continue;
        }

        const match =
          normalizeMatch(
            rawMatch,
            finalCompetition
          );

        if (
          seenMatches.has(
            match.id
          )
        ) {
          continue;
        }

        seenMatches.add(
          match.id
        );

        allMatches.push(
          match
        );
      }
    } catch (error) {
      console.error(
        `❌ TODAY ${competition.name}: ${error.message}`
      );
    }
  }

  return allMatches;
}

// ============================================================
// CARREGAR JOGOS DE HOJE UMA ÚNICA VEZ
// ============================================================

async function loadTodayMatchesOnce() {
  console.log("");
  console.log(
    "📅 ========================================"
  );
  console.log(
    "📅 JOGOS DE HOJE"
  );
  console.log(
    "📅 ========================================"
  );

  console.log(
    `📅 Data: ${getApiDate()}`
  );

  const todayMatches =
    await fetchTodayMatches();

  lastTodayMatches =
    todayMatches;

  console.log("");

  console.log(
    `📅 TOTAL JOGOS HOJE: ${todayMatches.length}`
  );

  console.log("");

  for (
    const competition
    of COMPETITIONS
  ) {
    const competitionMatches =
      todayMatches.filter(
        match =>
          match.competition.key ===
          competition.key
      );

    console.log(
      `${
        competitionMatches.length > 0
          ? "📅"
          : "⚪"
      } ${competition.name}: ${
        competitionMatches.length
      }`
    );

    for (
      const match
      of competitionMatches
    ) {
      console.log(
        `   ⚽ ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`
      );
    }
  }

  console.log("");

  console.log(
    "📅 ========================================"
  );

  console.log(
    "📅 Jogos de hoje carregados."
  );

  console.log(
    "📅 Estes jogos não serão pesquisados novamente pelo polling."
  );

  console.log(
    "📅 ========================================"
  );

  console.log("");
}

// ============================================================
// POLLING LIVE
//
// IMPORTANTE:
// O polling NÃO procura novamente os jogos de hoje.
// Apenas procura jogos LIVE.
// ============================================================

async function poll() {
  if (
    pollRunning
  ) {
    console.log(
      "⏭️ Poll anterior ainda está a correr."
    );

    return;
  }

  pollRunning =
    true;

  try {
    console.log("");
    console.log(
      "🔄 ========================================"
    );
    console.log(
      "🔴 JOGOS LIVE — 8 COMPETIÇÕES"
    );
    console.log(
      "🔄 ========================================"
    );

    lastPollTime =
      new Date().toISOString();

    // --------------------------------------------------------
    // 1. BUSCAR APENAS JOGOS LIVE
    // --------------------------------------------------------

    const liveMatches =
      await fetchLiveMatches();

    lastLiveMatches =
      liveMatches;

    for (
      const competition
      of COMPETITIONS
    ) {
      const count =
        liveMatches.filter(
          match =>
            match.competition.key ===
            competition.key
        ).length;

      console.log(
        `${
          count > 0
            ? "🔴"
            : "⚪"
        } ${
          competition.name
        }: ${count}`
      );
    }

    console.log("");

    console.log(
      `🔴 TOTAL LIVE: ${
        liveMatches.length
      }`
    );

    // --------------------------------------------------------
    // 2. PROCESSAR LIVE
    // --------------------------------------------------------

    processMatchLifecycle(
      liveMatches
    );

    processGoals(
      liveMatches
    );

    // --------------------------------------------------------
    // 3. POLL CONCLUÍDO
    // --------------------------------------------------------

    lastSuccessfulPoll =
      new Date().toISOString();

    console.log("");

    console.log(
      `📢 Eventos de jogos: ${
        matchEvents.size
      }`
    );

    console.log(
      `⚽ Eventos de golos: ${
        goalEvents.size
      }`
    );

    console.log(
      `📦 Total de eventos: ${
        matchEvents.size +
        goalEvents.size
      }`
    );

    console.log("");

    console.log(
      `🕐 Próxima verificação em ${
        POLL_INTERVAL /
        1000
      }s`
    );
  } catch (error) {
    console.error(
      "❌ Erro no poll:",
      error.message
    );
  } finally {
    pollRunning =
      false;
  }
}

// ============================================================
// TODOS OS EVENTOS
// ============================================================

function getAllEvents() {
  return [
    ...matchEvents.values(),
    ...goalEvents.values(),
  ].sort(
    (a, b) =>
      new Date(
        a.timestamp
      ) -
      new Date(
        b.timestamp
      )
  );
}

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/api/goals/health",
  (req, res) => {
    res.json({
      ok: true,

      server:
        "goal-server",

      port:
        PORT,

      sport:
        "football",

      apiBase:
        API_BASE,

      apiKey:
        Boolean(API_KEY),

      date:
        getApiDate(),

      competitions:
        COMPETITIONS.length,

      detectedCompetitions:
        activeCompetitionSlugs.size,

      liveMatches:
        lastLiveMatches.length,

      todayMatches:
        lastTodayMatches.length,

      matchEvents:
        matchEvents.size,

      goalEvents:
        goalEvents.size,

      totalEvents:
        matchEvents.size +
        goalEvents.size,

      lastPoll:
        lastPollTime,

      lastSuccessfulPoll:
        lastSuccessfulPoll,

      activeSlugs:
        Object.fromEntries(
          activeCompetitionSlugs
        ),
    });
  }
);

// ============================================================
// TODOS OS EVENTOS
// ============================================================

app.get(
  "/api/goals",
  (req, res) => {
    const events =
      getAllEvents();

    res.json({
      count:
        events.length,

      events,

      goals:
        [
          ...goalEvents.values(),
        ],

      matchEvents:
        [
          ...matchEvents.values(),
        ],
    });
  }
);

// ============================================================
// GOLOS
// ============================================================

app.get(
  "/api/goals/goals",
  (req, res) => {
    res.json({
      count:
        goalEvents.size,

      goals:
        [
          ...goalEvents.values(),
        ],
    });
  }
);

// ============================================================
// EVENTOS DE JOGOS
// ============================================================

app.get(
  "/api/goals/matches/events",
  (req, res) => {
    res.json({
      count:
        matchEvents.size,

      events:
        [
          ...matchEvents.values(),
        ],
    });
  }
);

// ============================================================
// EVENTOS DESDE
// ============================================================

app.get(
  "/api/goals/since",
  (req, res) => {
    const rawSince =
      req.query.since;

    console.log(
      "📥 /api/goals/since recebeu:",
      rawSince
    );

    if (
      rawSince === undefined ||
      rawSince === null ||
      rawSince === ""
    ) {
      return res.status(400).json({
        ok: false,

        error:
          "Falta o parâmetro since.",
      });
    }

    let since;

    if (
      /^\d+$/.test(
        String(rawSince)
      )
    ) {
      since =
        Number(rawSince);
    } else {
      since =
        new Date(
          rawSince
        ).getTime();
    }

    if (
      !Number.isFinite(
        since
      )
    ) {
      return res.status(400).json({
        ok: false,

        error:
          "O parâmetro since deve ser um timestamp ou uma data ISO válida.",

        received:
          rawSince,
      });
    }

    const events =
      getAllEvents()
        .filter(
          event => {
            const eventTime =
              new Date(
                event.timestamp
              ).getTime();

            return (
              Number.isFinite(
                eventTime
              ) &&
              eventTime >
                since
            );
          }
        )
        .sort(
          (a, b) =>
            new Date(
              a.timestamp
            ).getTime() -
            new Date(
              b.timestamp
            ).getTime()
        );

    const goals =
      events.filter(
        event =>
          event.type ===
          "goal"
      );

    res.json({
      ok: true,

      count:
        events.length,

      goalCount:
        goals.length,

      events,

      goals,

      serverTime:
        new Date().toISOString(),
    });
  }
);

// ============================================================
// JOGOS DE HOJE
// ============================================================
//
// Estes dados são carregados UMA VEZ no arranque.
// O endpoint apenas devolve o snapshot guardado.
// ============================================================

app.get(
  "/api/goals/today",
  (req, res) => {
    res.json({
      ok: true,

      date:
        getApiDate(),

      count:
        lastTodayMatches.length,

      matches:
        lastTodayMatches,

      updatedAt:
        lastPollTime,
    });
  }
);

// ============================================================
// JOGOS LIVE
// ============================================================

app.get(
  "/api/goals/live",
  (req, res) => {
    res.json({
      ok: true,

      date:
        getApiDate(),

      count:
        lastLiveMatches.length,

      matches:
        lastLiveMatches,

      updatedAt:
        lastPollTime,
    });
  }
);

// ============================================================
// COMPETIÇÕES
// ============================================================

app.get(
  "/api/goals/competitions",
  (req, res) => {
    res.json({
      ok: true,

      count:
        COMPETITIONS.length,

      competitions:
        COMPETITIONS.map(
          competition => ({
            key:
              competition.key,

            name:
              competition.name,

            activeSlug:
              activeCompetitionSlugs.get(
                competition.key
              ) || null,

            aliases:
              competition.aliases,

            slugs:
              competition.slugs,

            searchTerms:
              competition.searchTerms,

            preferredNames:
              competition.preferredNames,
          })
        ),
    });
  }
);

// ============================================================
// DEBUG
// ============================================================

app.get(
  "/api/goals/debug",
  (req, res) => {
    res.json({
      ok: true,

      date:
        getApiDate(),

      apiBase:
        API_BASE,

      apiKey:
        Boolean(API_KEY),

      activeCompetitionSlugs:
        Object.fromEntries(
          activeCompetitionSlugs
        ),

      liveMatches:
        lastLiveMatches,

      todayMatches:
        lastTodayMatches,

      matchEvents:
        [
          ...matchEvents.values(),
        ],

      goals:
        [
          ...goalEvents.values(),
        ],
    });
  }
);

// ============================================================
// LIMPAR EVENTOS
// ============================================================

app.delete(
  "/api/goals",
  (req, res) => {
    goalEvents.clear();

    matchEvents.clear();

    res.json({
      ok: true,

      message:
        "Eventos apagados.",
    });
  }
);

// ============================================================
// LIMPAR CACHE
// ============================================================

app.delete(
  "/api/goals/cache",
  (req, res) => {
    liveCache.clear();

    todayCache.clear();

    searchCache.clear();

    res.json({
      ok: true,

      message:
        "Cache limpo.",
    });
  }
);

// ============================================================
// ROOT
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,

      server:
        "Goal Server",

      port:
        PORT,

      endpoints: {
        health:
          "/api/goals/health",

        today:
          "/api/goals/today",

        live:
          "/api/goals/live",

        goals:
          "/api/goals/goals",

        events:
          "/api/goals",

        since:
          "/api/goals/since?since=TIMESTAMP",

        matches:
          "/api/goals/matches/events",

        competitions:
          "/api/goals/competitions",

        debug:
          "/api/goals/debug",
      },
    });
  }
);

// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  async () => {
    console.log("");

    console.log(
      "===================================================="
    );

    console.log(
      "⚽ GOAL SERVER — PORTA 3002"
    );

    console.log(
      "===================================================="
    );

    console.log(
      `🚀 http://localhost:${PORT}`
    );

    console.log(
      `📡 API: ${API_BASE}`
    );

    console.log(
      `🔑 API Key: ${
        API_KEY
          ? "SIM"
          : "NÃO"
      }`
    );

    console.log(
      `🌍 Data API: ${
        getApiDate()
      }`
    );

    console.log(
      `⏱️ Polling LIVE: ${
        POLL_INTERVAL /
        1000
      }s`
    );

    console.log(
      `📅 Jogos de hoje: carregados apenas uma vez`
    );

    console.log(
      `🏆 Competições: ${
        COMPETITIONS.length
      }`
    );

    console.log(
      "===================================================="
    );

    try {
      // ------------------------------------------------------
      // 1. DESCOBRIR SLUGS REAIS
      // ------------------------------------------------------

      await discoverCompetitionSlugs();

      // ------------------------------------------------------
      // 2. OBTER JOGOS DE HOJE UMA ÚNICA VEZ
      // ------------------------------------------------------

      await loadTodayMatchesOnce();

      // ------------------------------------------------------
      // 3. PRIMEIRO POLL LIVE
      // ------------------------------------------------------

      await poll();

      // ------------------------------------------------------
      // 4. POLLING LIVE CONTÍNUO
      //
      // APENAS OS JOGOS LIVE SÃO ATUALIZADOS.
      // OS JOGOS DE HOJE NÃO VOLTAM A SER OBTIDOS.
      // ------------------------------------------------------

      setInterval(
        poll,
        POLL_INTERVAL
      );
    } catch (error) {
      console.error(
        "❌ Erro ao iniciar:",
        error
      );
    }
  }
);