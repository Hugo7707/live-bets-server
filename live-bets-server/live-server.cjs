require("dotenv").config();

const express = require("express");
const cors = require("cors");

/*
|--------------------------------------------------------------------------
| APP
|--------------------------------------------------------------------------
*/

const app = express();

const PORT =
  Number(process.env.LIVE_PORT || 3001);

const API_URL =
  process.env.SPORTSCORE_BASE_URL ||
  "https://sportscore.com/api/v1";

const SPORT = "football";

const APP_TIMEZONE =
  "Europe/Lisbon";

/*
|--------------------------------------------------------------------------
| INTERVALOS
|--------------------------------------------------------------------------
*/

const LIVE_UPDATE_INTERVAL =
  15_000;

const TODAY_UPDATE_INTERVAL =
  0;

const CACHE_TIME =
  30_000;

const LIVE_CACHE_TIME =
  15_000;

/*
|--------------------------------------------------------------------------
| API KEY
|--------------------------------------------------------------------------
*/

const SPORTSSCORE_API_KEY =
  process.env.SPORTSCORE_API_KEY ||
  process.env.SPORTSCORE_API_TOKEN ||
  "";

/*
|--------------------------------------------------------------------------
| COMPETIÇÕES
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| EXPRESS
|--------------------------------------------------------------------------
*/

app.use(cors());

app.use(
  express.json()
);

/*
|--------------------------------------------------------------------------
| CACHE
|--------------------------------------------------------------------------
*/

const cache = new Map();

const pendingRequests =
  new Map();

/*
|--------------------------------------------------------------------------
| ESTADO
|--------------------------------------------------------------------------
*/

let todayMatches = [];

let liveMatches = [];

let scheduledMatches = [];

let lastLiveUpdate = null;

let lastTodayUpdate = null;

let lastTodayLoad = null;

let lastTodayApiDate = null;

let lastLiveError = null;

let lastTodayError = null;

let todayUpdateRunning = false;

let liveUpdateRunning = false;

/*
|--------------------------------------------------------------------------
| ESTATÍSTICAS API
|--------------------------------------------------------------------------
*/

let apiRequestsThisProcess = 0;

let lastApiRequestAt = null;

let lastApiResponseAt = null;

let lastApiError = null;

/*
|--------------------------------------------------------------------------
| EVENTOS
|--------------------------------------------------------------------------
*/

const previousLiveMatches =
  new Map();

const announcedEvents =
  new Map();

/*
|--------------------------------------------------------------------------
| SSE
|--------------------------------------------------------------------------
*/

const liveEventClients =
  new Set();

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function now() {
  return Date.now();
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/*
|--------------------------------------------------------------------------
| DATA ATUAL
|--------------------------------------------------------------------------
*/

function getApiDate() {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          APP_TIMEZONE,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    );

  return formatter.format(
    new Date()
  );
}

/*
|--------------------------------------------------------------------------
| DATA COM OFFSET
|--------------------------------------------------------------------------
|
| getApiDateOffset(0)
| = hoje
|
| getApiDateOffset(-1)
| = ontem
|
| getApiDateOffset(1)
| = amanhã
|
| É usada principalmente para
| continuar a procurar jogos de
| ontem depois da meia-noite.
|
|--------------------------------------------------------------------------
*/

function getApiDateOffset(
  days = 0
) {
  const currentDate =
    getApiDate();

  /*
  | Usamos meio-dia UTC para evitar
  | problemas de mudança de hora/DST.
  */

  const date =
    new Date(
      `${currentDate}T12:00:00Z`
    );

  date.setUTCDate(
    date.getUTCDate() +
      Number(days || 0)
  );

  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          APP_TIMEZONE,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    );

  return formatter.format(
    date
  );
}

/*
|--------------------------------------------------------------------------
| FORMATAR DATA LOCAL
|--------------------------------------------------------------------------
*/

function formatLocalDateTime(
  utcDate
) {
  if (!utcDate) {
    return null;
  }

  const date =
    new Date(utcDate);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return new Intl.DateTimeFormat(
    "pt-PT",
    {
      timeZone:
        APP_TIMEZONE,

      dateStyle:
        "short",

      timeStyle:
        "medium",
    }
  ).format(date);
}

/*
|--------------------------------------------------------------------------
| CACHE
|--------------------------------------------------------------------------
*/

function getCached(endpoint) {
  const item =
    cache.get(endpoint);

  if (!item) {
    return null;
  }

  if (
    now() -
      item.timestamp >
    item.cacheTime
  ) {
    cache.delete(endpoint);

    return null;
  }

  return item.data;
}

function setCached(
  endpoint,
  data,
  cacheTime
) {
  if (
    !cacheTime ||
    cacheTime <= 0
  ) {
    return;
  }

  cache.set(
    endpoint,
    {
      data,

      timestamp:
        now(),

      cacheTime,
    }
  );
}

/*
|--------------------------------------------------------------------------
| SPORTSSCORE REQUEST
|--------------------------------------------------------------------------
*/

async function sportScore(
  endpoint,
  {
    cacheTime = CACHE_TIME,
    forceRefresh = false,
  } = {}
) {
  if (!forceRefresh) {
    const cached =
      getCached(endpoint);

    if (cached !== null) {
      return cached;
    }
  }

  if (
    pendingRequests.has(
      endpoint
    )
  ) {
    return pendingRequests.get(
      endpoint
    );
  }

  const requestPromise =
    (async () => {
      try {
        const url =
          `${API_URL}${endpoint}`;

        apiRequestsThisProcess++;

        lastApiRequestAt =
          new Date().toISOString();

        const headers = {
          Accept:
            "application/json",
        };

        if (
          SPORTSSCORE_API_KEY
        ) {
          headers["X-Api-Key"] =
            SPORTSSCORE_API_KEY;
        }

        const response =
          await fetch(
            url,
            {
              method:
                "GET",

              headers,
            }
          );

        lastApiResponseAt =
          new Date().toISOString();

        const text =
          await response.text();

        if (!response.ok) {
          const error =
            new Error(
              `HTTP ${response.status}: ${text.slice(
                0,
                500
              )}`
            );

          error.status =
            response.status;

          error.endpoint =
            endpoint;

          lastApiError = {
            message:
              error.message,

            status:
              response.status,

            endpoint,

            at:
              new Date().toISOString(),
          };

          throw error;
        }

        let data;

        try {
          data =
            JSON.parse(text);
        } catch {
          throw new Error(
            "SportScore devolveu uma resposta que não é JSON."
          );
        }

        setCached(
          endpoint,
          data,
          cacheTime
        );

        lastApiError =
          null;

        return data;

      } finally {
        pendingRequests.delete(
          endpoint
        );
      }
    })();

  pendingRequests.set(
    endpoint,
    requestPromise
  );

  return requestPromise;
}

/*
|--------------------------------------------------------------------------
| EXTRAIR JOGOS
|--------------------------------------------------------------------------
*/

function extractMatches(data) {
  if (!data) {
    return [];
  }

  if (
    Array.isArray(data)
  ) {
    return data;
  }

  const possibilities = [
    data.matches,
    data.fixtures,
    data.results,
    data.events,
    data.data,
  ];

  for (
    const value of
      possibilities
  ) {
    if (
      Array.isArray(value)
    ) {
      return value;
    }
  }

  if (
    data.data &&
    typeof data.data ===
      "object"
  ) {
    const nested = [
      data.data.matches,
      data.data.fixtures,
      data.data.results,
      data.data.events,
    ];

    for (
      const value of nested
    ) {
      if (
        Array.isArray(value)
      ) {
        return value;
      }
    }
  }

  return [];
}

/*
|--------------------------------------------------------------------------
| STATUS
|--------------------------------------------------------------------------
*/

function normalizeStatus(
  match
) {
  const status =
    String(
      match?.status || ""
    )
      .toLowerCase()
      .trim();

  const statusText =
    String(
      match?.status_text ||
      match?.statusText ||
      ""
    )
      .toLowerCase()
      .trim();

  /*
  | INTERVALO
  */

  if (
    [
      "halftime",
      "half_time",
      "half-time",
      "ht",
      "paused",
      "break",
    ].includes(status) ||
    [
      "ht",
      "half time",
      "half-time",
      "interval",
    ].includes(statusText)
  ) {
    return "HALFTIME";
  }

  /*
  | TERMINADO
  */

  if (
    [
      "finished",
      "finished_aet",
      "ft",
      "ended",
      "complete",
      "completed",
      "after_extra_time",
      "after_penalties",
    ].includes(status) ||
    [
      "ft",
      "finished",
      "ended",
    ].includes(statusText)
  ) {
    return "FINISHED";
  }

  /*
  | LIVE
  */

  if (
    [
      "live",
      "in_play",
      "inplay",
      "playing",
      "in_progress",
      "1h",
      "2h",
      "first_half",
      "second_half",
      "1st_half",
      "2nd_half",
      "extra_time",
    ].includes(status)
  ) {
    return "LIVE";
  }

  /*
  | AGENDADO
  */

  if (
    [
      "scheduled",
      "not_started",
      "notstarted",
      "ns",
      "upcoming",
      "fixture",
      "pending",
    ].includes(status)
  ) {
    return "SCHEDULED";
  }

  return "UNKNOWN";
}

/*
|--------------------------------------------------------------------------
| SCORE
|--------------------------------------------------------------------------
*/

function parseScore(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : 0;
}

/*
|--------------------------------------------------------------------------
| EQUIPA
|--------------------------------------------------------------------------
*/

function normalizeTeam(
  raw,
  fallbackName
) {
  if (
    raw &&
    typeof raw ===
      "object"
  ) {
    return {
      id:
        raw.id ||
        raw.team_id ||
        raw.teamId ||
        null,

      name:
        raw.name ||
        raw.title ||
        raw.short_name ||
        raw.shortName ||
        fallbackName,

      shortName:
        raw.short_name ||
        raw.shortName ||
        raw.name ||
        fallbackName,

      logo:
        raw.logo ||
        raw.image ||
        raw.badge ||
        raw.crest ||
        null,
    };
  }

  return {
    id:
      null,

    name:
      String(
        raw ||
        fallbackName
      ),

    shortName:
      String(
        raw ||
        fallbackName
      ),

    logo:
      null,
  };
}

/*
|--------------------------------------------------------------------------
| NORMALIZAR JOGO
|--------------------------------------------------------------------------
*/

function normalizeMatch(
  rawMatch,
  competition,
  resolvedSlug = null
) {
  if (!rawMatch) {
    return null;
  }

  const homeRaw =
    rawMatch.home_team ||
    rawMatch.homeTeam ||
    rawMatch.home;

  const awayRaw =
    rawMatch.away_team ||
    rawMatch.awayTeam ||
    rawMatch.away;

  const homeTeam =
    normalizeTeam(
      homeRaw,
      "Casa"
    );

  const awayTeam =
    normalizeTeam(
      awayRaw,
      "Fora"
    );

  if (!homeTeam.name) {
    homeTeam.name = "Casa";
  }

  if (!awayTeam.name) {
    awayTeam.name = "Fora";
  }

  if (!homeTeam.logo) {
    homeTeam.logo =
      rawMatch.home_logo ||
      rawMatch.homeLogo ||
      null;
  }

  if (!awayTeam.logo) {
    awayTeam.logo =
      rawMatch.away_logo ||
      rawMatch.awayLogo ||
      null;
  }

  const homeScore =
    parseScore(
      rawMatch.home_score ??
      rawMatch.homeScore ??
      rawMatch.score?.home ??
      rawMatch.scores?.home
    );

  const awayScore =
    parseScore(
      rawMatch.away_score ??
      rawMatch.awayScore ??
      rawMatch.score?.away ??
      rawMatch.scores?.away
    );

  const normalizedStatus =
    normalizeStatus(
      rawMatch
    );

  const isLive =
    normalizedStatus ===
      "LIVE" ||
    normalizedStatus ===
      "HALFTIME";

  const isFinished =
    normalizedStatus ===
    "FINISHED";

  const isScheduled =
    normalizedStatus ===
      "SCHEDULED" ||
    normalizedStatus ===
      "UNKNOWN";

  const utcDate =
    rawMatch.utc_date ||
    rawMatch.utcDate ||
    rawMatch.datetime ||
    rawMatch.date_time ||
    rawMatch.start_time ||
    rawMatch.startTime ||
    rawMatch.time ||
    rawMatch.date ||
    null;

  const minuteRaw =
    rawMatch.minute ??
    rawMatch.minutes ??
    rawMatch.elapsed ??
    rawMatch.clock?.minute ??
    null;

  const minuteNumber =
    Number(
      String(
        minuteRaw ?? ""
      ).replace(
        /[^0-9]/g,
        ""
      )
    );

  const minute =
    Number.isFinite(
      minuteNumber
    ) &&
    minuteNumber > 0
      ? minuteNumber
      : null;

  const id =
    rawMatch.id ||
    rawMatch.fixture_id ||
    rawMatch.fixtureId ||
    rawMatch.match_id ||
    rawMatch.matchId ||
    rawMatch.url ||
    [
      competition.key,
      homeTeam.name,
      awayTeam.name,
      utcDate,
    ].join(":");

  const competitionObject = {
    key:
      competition.key,

    name:
      competition.name,

    slug:
      resolvedSlug ||
      rawMatch.competition_slug ||
      rawMatch.competitionSlug ||
      null,

    logo:
      rawMatch.competition_logo ||
      rawMatch.competitionLogo ||
      rawMatch.competition?.logo ||
      null,
  };

  return {
    id:
      String(id),

    provider:
      "SportScore",

    competition:
      competitionObject,

    homeTeam,

    awayTeam,

    score: {
      home:
        homeScore,

      away:
        awayScore,
    },

    homeScore,

    awayScore,

    scoreText:
      `${homeScore}-${awayScore}`,

    status:
      rawMatch.status ||
      "",

    statusText:
      rawMatch.status_text ||
      rawMatch.statusText ||
      "",

    normalizedStatus,

    isLive,

    isFinished,

    isScheduled,

    minute,

    utcDate,

    localDateTime:
      formatLocalDateTime(
        utcDate
      ),

    url:
      rawMatch.url ||
      rawMatch.link ||
      null,

    raw:
      rawMatch,
  };
}

/*
|--------------------------------------------------------------------------
| DISPLAY LIVE
|--------------------------------------------------------------------------
*/

function getLiveDisplay(
  match
) {
  if (!match) {
    return {
      phase:
        "UNKNOWN",

      label:
        "Desconhecido",

      minute:
        null,

      matchMinuteLabel:
        null,
    };
  }

  if (
    match.normalizedStatus ===
    "HALFTIME"
  ) {
    return {
      phase:
        "HALFTIME",

      label:
        "Intervalo",

      minute:
        45,

      matchMinuteLabel:
        "HT",
    };
  }

  if (
    match.normalizedStatus ===
    "FINISHED"
  ) {
    return {
      phase:
        "FINISHED",

      label:
        "Terminado",

      minute:
        null,

      matchMinuteLabel:
        "FT",
    };
  }

  if (match.isLive) {
    const minute =
      match.minute;

    return {
      phase:
        "LIVE",

      label:
        minute
          ? `${minute}'`
          : "LIVE",

      minute,

      matchMinuteLabel:
        minute
          ? `${minute}'`
          : null,
    };
  }

  if (match.isScheduled) {
    return {
      phase:
        "SCHEDULED",

      label:
        match.localDateTime ||
        "Agendado",

      minute:
        null,

      matchMinuteLabel:
        null,
    };
  }

  return {
    phase:
      "UNKNOWN",

    label:
      match.statusText ||
      match.status ||
      "Desconhecido",

    minute:
      null,

    matchMinuteLabel:
      null,
  };
}

/*
|--------------------------------------------------------------------------
| REQUEST FIXTURES
|--------------------------------------------------------------------------
*/

async function requestFixtures({
  competitionSlugs = [],
  date = getApiDate(),
  liveOnly = false,
  forceRefresh = false,
} = {}) {
  const slugs =
    Array.isArray(
      competitionSlugs
    )
      ? [
          ...new Set(
            competitionSlugs
              .map(normalizeSlug)
              .filter(Boolean)
          ),
        ]
      : [];

  if (
    slugs.length === 0
  ) {
    return {
      endpoint:
        null,

      data:
        null,

      slug:
        null,

      matches:
        [],

      errors:
        [],
    };
  }

  const errors = [];

  for (
    const slug of slugs
  ) {
    try {
      const params =
        new URLSearchParams();

      params.set(
        "sport",
        SPORT
      );

      params.set(
        "date",
        date
      );

      params.set(
        "limit",
        "200"
      );

      params.set(
        "competition",
        slug
      );

      if (liveOnly) {
        params.set(
          "status",
          "live"
        );
      }

      const endpoint =
        `/fixtures/?${params.toString()}`;

      const data =
        await sportScore(
          endpoint,
          {
            cacheTime:
              liveOnly
                ? LIVE_CACHE_TIME
                : CACHE_TIME,

            forceRefresh,
          }
        );

      const matches =
        extractMatches(
          data
        );

      if (
        matches.length > 0
      ) {
        return {
          endpoint,

          data,

          slug,

          matches,

          errors,
        };
      }

    } catch (error) {
      errors.push({
        slug,

        status:
          error?.status ||
          null,

        message:
          error?.message ||
          String(error),
      });
    }
  }

  return {
    endpoint:
      null,

    data:
      null,

    slug:
      null,

    matches:
      [],

    errors,
  };
}

/*
|--------------------------------------------------------------------------
| JOGOS DE UMA COMPETIÇÃO
|--------------------------------------------------------------------------
*/

async function getCompetitionMatches(
  competition,
  {
    date = getApiDate(),
    liveOnly = false,
    forceRefresh = false,
  } = {}
) {
  if (!competition) {
    return {
      matches: [],

      failed:
        false,
    };
  }

  const result =
    await requestFixtures({
      competitionSlugs:
        competition.slugs,

      date,

      liveOnly,

      forceRefresh,
    });

  const rawMatches =
    result.matches ||
    [];

  let matches =
    rawMatches
      .map(match =>
        normalizeMatch(
          match,
          competition,
          result.slug
        )
      )
      .filter(Boolean);

  if (liveOnly) {
    matches =
      matches.filter(
        match =>
          match.isLive ===
          true
      );
  }

  const allSlugs =
    Array.isArray(
      competition.slugs
    )
      ? competition.slugs.length
      : 0;

  const failed =
    matches.length === 0 &&
    allSlugs > 0 &&
    result.errors.length ===
      allSlugs;

  return {
    matches,

    failed,

    slug:
      result.slug,

    errors:
      result.errors,
  };
}

/*
|--------------------------------------------------------------------------
| DEDUPLICAR
|--------------------------------------------------------------------------
*/

function deduplicateMatches(
  matches
) {
  const unique =
    new Map();

  for (
    const match of
      matches || []
  ) {
    if (!match?.id) {
      continue;
    }

    unique.set(
      String(match.id),
      match
    );
  }

  return [
    ...unique.values(),
  ];
}

/*
|--------------------------------------------------------------------------
| JOGOS LIVE DE UMA DATA
|--------------------------------------------------------------------------
*/

async function getLiveMatchesForDate(
  date,
  {
    forceRefresh = false,
  } = {}
) {
  const allMatches = [];

  for (
    const competition of
      COMPETITIONS
  ) {
    try {
      const result =
        await getCompetitionMatches(
          competition,
          {
            date,

            liveOnly:
              true,

            forceRefresh,
          }
        );

      allMatches.push(
        ...result.matches
      );

    } catch (error) {
      console.log(
        `   ⚠ ${date} - ${competition.name}: ${error.message}`
      );
    }
  }

  return deduplicateMatches(
    allMatches
  );
}

/*
|--------------------------------------------------------------------------
| JOGOS LIVE
|--------------------------------------------------------------------------
|
| IMPORTANTE:
|
| Procuramos:
|
| 1. hoje
| 2. ontem
|
| Isto resolve jogos como:
|
| 27/10 23:00
|        ↓
| 28/10 00:30
|
|--------------------------------------------------------------------------
*/

async function getLiveMatchesFromAPI({
  forceRefresh = false,
} = {}) {
  console.log("");

  console.log(
    "🔴 LIVE"
  );

  const today =
    getApiDate();

  const yesterday =
    getApiDateOffset(-1);

  console.log(
    `   📅 A procurar LIVE em ${today} e ${yesterday}`
  );

  const todayMatchesFromAPI =
    await getLiveMatchesForDate(
      today,
      {
        forceRefresh,
      }
    );

  const yesterdayMatchesFromAPI =
    await getLiveMatchesForDate(
      yesterday,
      {
        forceRefresh,
      }
    );

  const matches =
    deduplicateMatches([
      ...todayMatchesFromAPI,
      ...yesterdayMatchesFromAPI,
    ]);

  console.log("");

  console.log(
    `🔴 SportScore: ${matches.length} ${
      matches.length === 1
        ? "jogo LIVE"
        : "jogos LIVE"
    }`
  );

  return matches;
}

/*
|--------------------------------------------------------------------------
| JOGOS DO DIA
|--------------------------------------------------------------------------
*/

async function getTodayMatches({
  forceRefresh = false,
  date = getApiDate(),
} = {}) {
  console.log("");

  console.log(
    `📅 JOGOS DO DIA — ${date}`
  );

  const allMatches = [];

  for (
    const competition of
      COMPETITIONS
  ) {
    try {
      const result =
        await getCompetitionMatches(
          competition,
          {
            date,

            liveOnly:
              false,

            forceRefresh,
          }
        );

      const matches =
        result.matches;

      if (result.failed) {
        console.log(
          `   ⚠ ${competition.name}: API indisponível`
        );
      } else {
        const count =
          matches.length;

        const label =
          count === 1
            ? "1 jogo"
            : `${count} jogos`;

        console.log(
          `   ${count > 0 ? "✓" : "·"} ${competition.name}: ${label}`
        );
      }

      allMatches.push(
        ...matches
      );

    } catch (error) {
      console.log(
        `   ⚠ ${competition.name}: ${error.message}`
      );
    }
  }

  const matches =
    deduplicateMatches(
      allMatches
    );

  console.log("");

  console.log(
    `📅 Total: ${matches.length} ${
      matches.length === 1
        ? "jogo"
        : "jogos"
    }`
  );

  return matches;
}

/*
|--------------------------------------------------------------------------
| MERGE LIVE -> TODAY
|--------------------------------------------------------------------------
*/

function mergeLiveIntoToday(
  currentToday,
  currentLive
) {
  const merged =
    new Map();

  for (
    const match of
      currentToday || []
  ) {
    merged.set(
      String(match.id),
      match
    );
  }

  for (
    const liveMatch of
      currentLive || []
  ) {
    const id =
      String(
        liveMatch.id
      );

    const previous =
      merged.get(id);

    if (previous) {
      merged.set(
        id,
        {
          ...previous,

          ...liveMatch,
        }
      );
    } else {
      /*
      | Este caso é importante:
      |
      | Um jogo que começou ontem
      | pode aparecer aqui depois
      | da meia-noite.
      */

      merged.set(
        id,
        liveMatch
      );
    }
  }

  return [
    ...merged.values(),
  ];
}

/*
|--------------------------------------------------------------------------
| SSE
|--------------------------------------------------------------------------
*/

function sendLiveEvent(
  type,
  data
) {
  const payload =
    `event: ${type}\n` +
    `data: ${JSON.stringify(
      data
    )}\n\n`;

  for (
    const client of
      liveEventClients
  ) {
    try {
      client.write(
        payload
      );
    } catch {
      liveEventClients.delete(
        client
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| EVENTO ÚNICO
|--------------------------------------------------------------------------
*/

function announceEvent(
  event
) {
  if (!event?.id) {
    return;
  }

  if (
    announcedEvents.has(
      event.id
    )
  ) {
    return;
  }

  announcedEvents.set(
    event.id,
    event
  );

  if (
    announcedEvents.size >
    2000
  ) {
    const firstKey =
      announcedEvents
        .keys()
        .next()
        .value;

    if (firstKey) {
      announcedEvents.delete(
        firstKey
      );
    }
  }

  sendLiveEvent(
    event.type,
    event
  );
}

/*
|--------------------------------------------------------------------------
| PROCESSAR EVENTOS LIVE
|--------------------------------------------------------------------------
*/

function processLiveEvents(
  currentLiveMatches
) {
  const currentIds =
    new Set();

  for (
    const match of
      currentLiveMatches || []
  ) {
    const id =
      String(
        match.id
      );

    currentIds.add(id);

    const previous =
      previousLiveMatches.get(
        id
      );

    /*
    | PRIMEIRA OBSERVAÇÃO
    |
    | Não gera golos antigos.
    */

    if (!previous) {
      previousLiveMatches.set(
        id,
        {
          ...match,

          seenAt:
            new Date().toISOString(),
        }
      );

      continue;
    }

    /*
    | GOLO CASA
    */

    if (
      match.homeScore >
      previous.homeScore
    ) {
      for (
        let score =
          previous.homeScore + 1;

        score <=
        match.homeScore;

        score++
      ) {
        const event = {
          id:
            `${id}:goal:home:${score}`,

          type:
            "goal",

          timestamp:
            new Date().toISOString(),

          matchId:
            id,

          competition:
            match.competition,

          homeTeam:
            match.homeTeam,

          awayTeam:
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

          team:
            "HOME",

          side:
            "home",

          teamName:
            match.homeTeam.name,

          scoringTeam:
            match.homeTeam.name,

          minute:
            match.minute,

          message:
            `⚽ GOLO! ${match.homeTeam.name} ` +
            `${match.homeScore}-${match.awayScore} ` +
            `${match.awayTeam.name}`,
        };

        console.log(
          `⚽ ${event.message}`
        );

        announceEvent(
          event
        );
      }
    }

    /*
    | GOLO FORA
    */

    if (
      match.awayScore >
      previous.awayScore
    ) {
      for (
        let score =
          previous.awayScore + 1;

        score <=
        match.awayScore;

        score++
      ) {
        const event = {
          id:
            `${id}:goal:away:${score}`,

          type:
            "goal",

          timestamp:
            new Date().toISOString(),

          matchId:
            id,

          competition:
            match.competition,

          homeTeam:
            match.homeTeam,

          awayTeam:
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

          team:
            "AWAY",

          side:
            "away",

          teamName:
            match.awayTeam.name,

          scoringTeam:
            match.awayTeam.name,

          minute:
            match.minute,

          message:
            `⚽ GOLO! ${match.homeTeam.name} ` +
            `${match.homeScore}-${match.awayScore} ` +
            `${match.awayTeam.name}`,
        };

        console.log(
          `⚽ ${event.message}`
        );

        announceEvent(
          event
        );
      }
    }

    previousLiveMatches.set(
      id,
      {
        ...match,

        seenAt:
          previous.seenAt ||
          new Date().toISOString(),
      }
    );
  }

  /*
  | LIMPAR JOGOS ANTIGOS
  */

  for (
    const [
      id,
      previous,
    ] of previousLiveMatches
  ) {
    if (
      currentIds.has(id)
    ) {
      continue;
    }

    const seenAt =
      new Date(
        previous.seenAt ||
        0
      ).getTime();

    if (
      Date.now() -
        seenAt >
      6 * 60 * 60 * 1000
    ) {
      previousLiveMatches.delete(
        id
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| MOSTRAR EQUIPAS
|--------------------------------------------------------------------------
*/

function printScheduledTeams(
  matches
) {
  console.log("");

  console.log(
    "⚽ EQUIPAS QUE VÃO JOGAR HOJE"
  );

  console.log(
    "=========================================="
  );

  if (
    !matches ||
    matches.length === 0
  ) {
    console.log(
      "   Nenhum jogo agendado encontrado."
    );

    console.log(
      "=========================================="
    );

    console.log("");

    return;
  }

  for (
    const competition of
      COMPETITIONS
  ) {
    const competitionMatches =
      matches
        .filter(
          match =>
            match.competition?.key ===
            competition.key
        )
        .sort(
          (a, b) => {
            const dateA =
              new Date(
                a.utcDate ||
                0
              ).getTime();

            const dateB =
              new Date(
                b.utcDate ||
                0
              ).getTime();

            return (
              dateA -
              dateB
            );
          }
        );

    if (
      competitionMatches.length ===
      0
    ) {
      continue;
    }

    console.log("");

    console.log(
      `🏆 ${competition.name}`
    );

    for (
      const match of
        competitionMatches
    ) {
      const home =
        match.homeTeam?.name ||
        "Casa";

      const away =
        match.awayTeam?.name ||
        "Fora";

      const time =
        match.localDateTime ||
        "Hora desconhecida";

      console.log(
        `   ⚽ ${home} vs ${away}`
      );

      console.log(
        `      🕐 ${time}`
      );
    }
  }

  console.log("");

  console.log(
    `📅 Total de jogos agendados: ${matches.length}`
  );

  console.log(
    "=========================================="
  );

  console.log("");
}

/*
|--------------------------------------------------------------------------
| ATUALIZAR TODAY
|--------------------------------------------------------------------------
*/

async function updateTodayMatches({
  forceRefresh = false,
  date = getApiDate(),
} = {}) {
  if (
    todayUpdateRunning
  ) {
    return;
  }

  todayUpdateRunning =
    true;

  try {
    const matches =
      await getTodayMatches({
        forceRefresh,

        date,
      });

    /*
    | Mantemos jogos LIVE que já estavam
    | em memória.
    */

    todayMatches =
      mergeLiveIntoToday(
        matches,
        liveMatches
      );

    scheduledMatches =
      todayMatches.filter(
        match =>
          match.isScheduled
      );

    lastTodayLoad =
      new Date().toISOString();

    lastTodayApiDate =
      date;

    lastTodayUpdate =
      lastTodayLoad;

    lastTodayError =
      null;

    printScheduledTeams(
      scheduledMatches
    );

  } catch (error) {
    lastTodayError = {
      message:
        error.message,

      at:
        new Date().toISOString(),
    };

    console.error(
      `❌ TODAY: ${error.message}`
    );

  } finally {
    todayUpdateRunning =
      false;
  }
}

/*
|--------------------------------------------------------------------------
| DETETAR MUDANÇA DE DIA
|--------------------------------------------------------------------------
|
| Quando chega 00:00:
|
| 27/10 -> 28/10
|
| carregamos automaticamente
| os novos jogos do dia.
|
|--------------------------------------------------------------------------
*/

async function refreshTodayIfDateChanged() {
  const currentApiDate =
    getApiDate();

  if (
    !lastTodayApiDate
  ) {
    return;
  }

  if (
    currentApiDate ===
    lastTodayApiDate
  ) {
    return;
  }

  console.log("");

  console.log(
    `🌙 MUDANÇA DE DIA: ${lastTodayApiDate} → ${currentApiDate}`
  );

  console.log(
    "📅 A carregar os jogos do novo dia..."
  );

  /*
  | Importante:
  | não apagamos liveMatches.
  |
  | Um jogo de ontem pode continuar LIVE.
  */

  await updateTodayMatches({
    forceRefresh:
      true,

    date:
      currentApiDate,
  });
}

/*
|--------------------------------------------------------------------------
| ATUALIZAR LIVE
|--------------------------------------------------------------------------
*/

async function updateLiveMatches() {
  if (
    liveUpdateRunning
  ) {
    return;
  }

  liveUpdateRunning =
    true;

  try {
    /*
    |--------------------------------------------------------------------------
    | PRIMEIRO:
    | verificar se passou para um novo dia.
    |--------------------------------------------------------------------------
    */

    await refreshTodayIfDateChanged();

    /*
    |--------------------------------------------------------------------------
    | SEGUNDO:
    | procurar LIVE em hoje + ontem.
    |--------------------------------------------------------------------------
    */

    const liveFromAPI =
      await getLiveMatchesFromAPI({
        forceRefresh:
          false,
      });

    /*
    |--------------------------------------------------------------------------
    | SUBSTITUIR O ESTADO LIVE
    |--------------------------------------------------------------------------
    |
    | Aqui estão apenas os jogos que a API
    | confirmou como LIVE.
    |
    | Como procurámos ontem + hoje,
    | um jogo das 23:00 não desaparece
    | simplesmente às 00:00.
    |
    |--------------------------------------------------------------------------
    */

    liveMatches =
      deduplicateMatches(
        liveFromAPI
      );

    /*
    |--------------------------------------------------------------------------
    | MERGE NO ESTADO DO DIA
    |--------------------------------------------------------------------------
    */

    todayMatches =
      mergeLiveIntoToday(
        todayMatches,
        liveMatches
      );

    scheduledMatches =
      todayMatches.filter(
        match =>
          match.isScheduled
      );

    /*
    |--------------------------------------------------------------------------
    | PROCESSAR GOLOS
    |--------------------------------------------------------------------------
    */

    processLiveEvents(
      liveMatches
    );

    /*
    |--------------------------------------------------------------------------
    | SSE
    |--------------------------------------------------------------------------
    */

    sendLiveEvent(
      "LIVE_STATE",
      {
        type:
          "LIVE_STATE",

        count:
          liveMatches.length,

        matches:
          liveMatches,

        updatedAt:
          new Date().toISOString(),
      }
    );

    lastLiveUpdate =
      new Date().toISOString();

    lastLiveError =
      null;

  } catch (error) {
    lastLiveError = {
      message:
        error.message,

      at:
        new Date().toISOString(),
    };

    console.error(
      `❌ LIVE: ${error.message}`
    );

  } finally {
    liveUpdateRunning =
      false;
  }
}

/*
|--------------------------------------------------------------------------
| SSE
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live/events",
  (req, res) => {
    res.writeHead(
      200,
      {
        "Content-Type":
          "text/event-stream",

        "Cache-Control":
          "no-cache, no-transform",

        Connection:
          "keep-alive",

        "Access-Control-Allow-Origin":
          "*",

        "X-Accel-Buffering":
          "no",
      }
    );

    liveEventClients.add(
      res
    );

    res.write(
      `event: connected\n` +
      `data: ${JSON.stringify({
        connected:
          true,

        server:
          "live-server",

        provider:
          "SportScore",

        time:
          new Date().toISOString(),
      })}\n\n`
    );

    res.write(
      `event: LIVE_STATE\n` +
      `data: ${JSON.stringify({
        type:
          "LIVE_STATE",

        count:
          liveMatches.length,

        matches:
          liveMatches,

        updatedAt:
          lastLiveUpdate,
      })}\n\n`
    );

    console.log(
      `📡 SSE ligado: ${liveEventClients.size}`
    );

    req.on(
      "close",
      () => {
        liveEventClients.delete(
          res
        );

        console.log(
          `📡 SSE desligado: ${liveEventClients.size}`
        );
      }
    );
  }
);

/*
|--------------------------------------------------------------------------
| HEALTH
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live/health",
  (req, res) => {
    res.json({
      ok:
        true,

      server:
        "live-server",

      provider:
        "SportScore",

      api:
        API_URL,

      apiKeyConfigured:
        Boolean(
          SPORTSSCORE_API_KEY
        ),

      timezone:
        APP_TIMEZONE,

      sport:
        SPORT,

      currentApiDate:
        getApiDate(),

      yesterdayApiDate:
        getApiDateOffset(-1),

      competitions:
        COMPETITIONS.map(
          competition => ({
            key:
              competition.key,

            name:
              competition.name,

            slugs:
              competition.slugs,

            aliases:
              competition.aliases,
          })
        ),

      liveUpdateInterval:
        LIVE_UPDATE_INTERVAL,

      liveUpdateSeconds:
        LIVE_UPDATE_INTERVAL /
        1000,

      todayUpdateInterval:
        TODAY_UPDATE_INTERVAL,

      todayUpdateSeconds:
        TODAY_UPDATE_INTERVAL /
        1000,

      todayLoadMode:
        "startup-and-midnight-rollover",

      liveSearchDates: [
        getApiDate(),

        getApiDateOffset(-1),
      ],

      sseEnabled:
        true,

      sseClients:
        liveEventClients.size,

      liveMatches:
        liveMatches.length,

      todayMatches:
        todayMatches.length,

      scheduledMatches:
        scheduledMatches.length,

      lastLiveUpdate,

      lastTodayUpdate,

      lastTodayLoad,

      lastTodayApiDate,

      lastLiveError,

      lastTodayError,

      apiRequestsThisProcess,

      lastApiRequestAt,

      lastApiResponseAt,

      lastApiError,
    });
  }
);

/*
|--------------------------------------------------------------------------
| TODOS OS JOGOS LIVE
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live",
  (req, res) => {
    res.json({
      success:
        true,

      provider:
        "SportScore",

      updatedAt:
        lastLiveUpdate,

      count:
        liveMatches.length,

      matches:
        liveMatches.map(
          match => {
            const display =
              getLiveDisplay(
                match
              );

            return {
              ...match,

              phase:
                display.phase,

              phaseLabel:
                display.label,

              liveMinute:
                display.minute,

              liveMinuteLabel:
                display.matchMinuteLabel ||
                null,

              liveLabel:
                display.label,
            };
          }
        ),
    });
  }
);

/*
|--------------------------------------------------------------------------
| JOGOS DO DIA
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live/today",
  (req, res) => {
    res.json({
      success:
        true,

      provider:
        "SportScore",

      date:
        getApiDate(),

      updatedAt:
        lastTodayLoad,

      count:
        todayMatches.length,

      matches:
        todayMatches.map(
          match => {
            const display =
              getLiveDisplay(
                match
              );

            return {
              ...match,

              phase:
                display.phase,

              phaseLabel:
                display.label,

              liveMinute:
                display.minute,

              liveMinuteLabel:
                display.matchMinuteLabel ||
                null,

              liveLabel:
                display.label,
            };
          }
        ),
    });
  }
);

/*
|--------------------------------------------------------------------------
| PRÓXIMOS JOGOS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live/upcoming",
  (req, res) => {
    const upcoming =
      todayMatches
        .filter(
          match =>
            match.isScheduled
        )
        .sort(
          (a, b) => {
            const dateA =
              new Date(
                a.utcDate ||
                0
              ).getTime();

            const dateB =
              new Date(
                b.utcDate ||
                0
              ).getTime();

            return (
              dateA -
              dateB
            );
          }
        );

    res.json({
      success:
        true,

      provider:
        "SportScore",

      date:
        getApiDate(),

      updatedAt:
        lastTodayLoad,

      count:
        upcoming.length,

      matches:
        upcoming.map(
          match => ({
            ...match,

            homeTeamName:
              match.homeTeam?.name ||
              "Casa",

            awayTeamName:
              match.awayTeam?.name ||
              "Fora",

            homeTeamLogo:
              match.homeTeam?.logo ||
              null,

            awayTeamLogo:
              match.awayTeam?.logo ||
              null,

            matchTitle:
              `${match.homeTeam?.name || "Casa"} vs ${
                match.awayTeam?.name || "Fora"
              }`,

            scheduledTime:
              match.localDateTime ||
              null,
          })
        ),
    });
  }
);

/*
|--------------------------------------------------------------------------
| COMPETIÇÕES
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live/competitions",
  (req, res) => {
    res.json({
      success:
        true,

      provider:
        "SportScore",

      sport:
        SPORT,

      count:
        COMPETITIONS.length,

      competitions:
        COMPETITIONS.map(
          competition => ({
            key:
              competition.key,

            name:
              competition.name,

            slugs:
              competition.slugs,

            aliases:
              competition.aliases,
          })
        ),
    });
  }
);

/*
|--------------------------------------------------------------------------
| EVENTOS DETETADOS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live/detected-events",
  (req, res) => {
    const events =
      [
        ...announcedEvents.values(),
      ].sort(
        (a, b) =>
          new Date(
            b.timestamp
          ).getTime() -
          new Date(
            a.timestamp
          ).getTime()
      );

    res.json({
      success:
        true,

      count:
        events.length,

      events,
    });
  }
);

/*
|--------------------------------------------------------------------------
| FORÇAR LIVE
|--------------------------------------------------------------------------
*/

app.post(
  "/api/live/check",
  async (req, res) => {
    if (
      liveUpdateRunning
    ) {
      return res
        .status(409)
        .json({
          success:
            false,

          error:
            "Já existe uma atualização LIVE em curso.",
        });
    }

    /*
    | Limpar cache LIVE de hoje e ontem.
    */

    const dates = [
      getApiDate(),
      getApiDateOffset(-1),
    ];

    for (
      const date of dates
    ) {
      for (
        const competition of
          COMPETITIONS
      ) {
        for (
          const slug of
            competition.slugs
        ) {
          const params =
            new URLSearchParams();

          params.set(
            "sport",
            SPORT
          );

          params.set(
            "date",
            date
          );

          params.set(
            "limit",
            "200"
          );

          params.set(
            "competition",
            slug
          );

          params.set(
            "status",
            "live"
          );

          cache.delete(
            `/fixtures/?${params.toString()}`
          );
        }
      }
    }

    await updateLiveMatches();

    res.json({
      success:
        true,

      provider:
        "SportScore",

      updatedAt:
        lastLiveUpdate,

      count:
        liveMatches.length,

      matches:
        liveMatches,
    });
  }
);

/*
|--------------------------------------------------------------------------
| LIMPAR CACHE
|--------------------------------------------------------------------------
*/

app.post(
  "/api/live/cache/clear",
  (req, res) => {
    cache.clear();

    res.json({
      success:
        true,

      message:
        "Cache SportScore limpo.",
    });
  }
);

/*
|--------------------------------------------------------------------------
| JOGO ESPECÍFICO
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live/:matchId",
  (req, res) => {
    const matchId =
      String(
        req.params.matchId
      );

    let match =
      todayMatches.find(
        item =>
          String(
            item.id
          ) === matchId
      );

    if (!match) {
      match =
        liveMatches.find(
          item =>
            String(
              item.id
            ) === matchId
        );
    }

    if (!match) {
      return res
        .status(404)
        .json({
          success:
            false,

          error:
            "Jogo não encontrado no cache.",
        });
    }

    const display =
      getLiveDisplay(
        match
      );

    res.json({
      success:
        true,

      provider:
        "SportScore",

      match: {
        ...match,

        phase:
          display.phase,

        phaseLabel:
          display.label,

        liveMinute:
          display.minute,

        liveMinuteLabel:
          display.matchMinuteLabel ||
          null,

        liveLabel:
          display.label,
      },
    });
  }
);

/*
|--------------------------------------------------------------------------
| ROOT
|--------------------------------------------------------------------------
*/

app.get(
  "/",
  (req, res) => {
    res.json({
      name:
        "Football Live Server",

      provider:
        "SportScore",

      status:
        "online",

      timezone:
        APP_TIMEZONE,

      endpoints: {
        live:
          "/api/live",

        today:
          "/api/live/today",

        upcoming:
          "/api/live/upcoming",

        health:
          "/api/live/health",

        events:
          "/api/live/events",

        detectedEvents:
          "/api/live/detected-events",

        competitions:
          "/api/live/competitions",

        check:
          "/api/live/check",

        clearCache:
          "/api/live/cache/clear",
      },
    });
  }
);

/*
|--------------------------------------------------------------------------
| ERROS EXPRESS
|--------------------------------------------------------------------------
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "❌ Express:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    res
      .status(500)
      .json({
        success:
          false,

        error:
          error.message ||
          "Erro interno.",
      });
  }
);

/*
|--------------------------------------------------------------------------
| KEEP ALIVE SSE
|--------------------------------------------------------------------------
*/

setInterval(
  () => {
    for (
      const client of
        liveEventClients
    ) {
      try {
        client.write(
          `: keep-alive ${Date.now()}\n\n`
        );
      } catch {
        liveEventClients.delete(
          client
        );
      }
    }
  },
  15_000
);

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

async function startServer() {
  console.log("");

  console.log(
    "=========================================="
  );

  console.log(
    "⚽ FOOTBALL BET ANALYZER - LIVE SERVER"
  );

  console.log(
    "=========================================="
  );

  console.log("");

  console.log(
    `🌐 Porta: ${PORT}`
  );

  console.log(
    `🌍 Timezone: ${APP_TIMEZONE}`
  );

  console.log(
    "🌐 Provider: SportScore"
  );

  console.log(
    `🔑 API Key: ${
      SPORTSSCORE_API_KEY
        ? "configurada"
        : "não configurada"
    }`
  );

  console.log("");

  console.log(
    `🔴 LIVE: cada ${
      LIVE_UPDATE_INTERVAL /
      1000
    }s`
  );

  console.log(
    "🔴 LIVE: procura HOJE + ONTEM"
  );

  console.log(
    "📅 JOGOS DO DIA: arranque + mudança de dia"
  );

  console.log(
    "📡 SSE: ativado"
  );

  console.log("");

  console.log(
    "🏆 Competições:"
  );

  for (
    const competition of
      COMPETITIONS
  ) {
    console.log(
      `   • ${competition.name}`
    );
  }

  console.log("");

  console.log(
    "ℹ Pesquisa dinâmica: DESATIVADA"
  );

  console.log(
    "ℹ /search/: NÃO UTILIZADO"
  );

  console.log(
    "ℹ Fallback global: DESATIVADO"
  );

  console.log("");

  /*
  |--------------------------------------------------------------------------
  | PRIMEIRA ATUALIZAÇÃO
  |--------------------------------------------------------------------------
  */

  await updateTodayMatches({
    forceRefresh:
      true,

    date:
      getApiDate(),
  });

  await updateLiveMatches();

  /*
  |--------------------------------------------------------------------------
  | INTERVALO LIVE
  |--------------------------------------------------------------------------
  */

  setInterval(
    updateLiveMatches,
    LIVE_UPDATE_INTERVAL
  );

  /*
  |--------------------------------------------------------------------------
  | HTTP
  |--------------------------------------------------------------------------
  */

  app.listen(
    PORT,
    () => {
      console.log("");

      console.log(
        `🚀 Server ativo: http://localhost:${PORT}`
      );

      console.log("");

      console.log(
        "   /api/live"
      );

      console.log(
        "   /api/live/today"
      );

      console.log(
        "   /api/live/upcoming"
      );

      console.log(
        "   /api/live/health"
      );

      console.log(
        "   /api/live/events"
      );

      console.log(
        "   /api/live/competitions"
      );

      console.log("");

      console.log(
        "Powered by SportScore"
      );

      console.log("");
    }
  );
}

/*
|--------------------------------------------------------------------------
| ERROS NODE
|--------------------------------------------------------------------------
*/

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught exception:",
      error
    );
  }
);

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

startServer().catch(
  error => {
    console.error("");

    console.error(
      "❌ Erro fatal ao iniciar:"
    );

    console.error(
      error
    );

    process.exit(1);
  }
);