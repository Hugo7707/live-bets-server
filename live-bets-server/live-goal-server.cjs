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

const LIFECYCLE_UPDATE_INTERVAL =
  60_000;

const CACHE_TIME =
  30_000;

const LIVE_CACHE_TIME =
  15_000;

/*
|--------------------------------------------------------------------------
| CORREÇÃO DO MINUTO LIVE
|--------------------------------------------------------------------------
*/

const LIVE_MINUTE_TOLERANCE =
  2;

const HALFTIME_DURATION_MINUTES =
  15;

/*
|--------------------------------------------------------------------------
| EVENTOS
|--------------------------------------------------------------------------
*/

const GOAL_EVENT_LIMIT =
  2000;

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
app.use(express.json());

/*
|--------------------------------------------------------------------------
| CACHE
|--------------------------------------------------------------------------
*/

const cache = new Map();
const pendingRequests = new Map();

/*
|--------------------------------------------------------------------------
| ESTADO DOS JOGOS
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
let lifecycleUpdateRunning = false;

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
| ESTADO DOS GOLOS
|--------------------------------------------------------------------------
*/

const previousLiveMatches = new Map();

/*
|--------------------------------------------------------------------------
| ESTADO DO CICLO DE VIDA
|--------------------------------------------------------------------------
*/

const matchLifecycleStates = new Map();

/*
|--------------------------------------------------------------------------
| EVENTOS DE GOLOS
|--------------------------------------------------------------------------
*/

const goalEvents = new Map();

/*
|--------------------------------------------------------------------------
| EVENTOS DE JOGOS
|--------------------------------------------------------------------------
*/

const matchEvents = new Map();

/*
|--------------------------------------------------------------------------
| EVENTOS JÁ ENVIADOS
|--------------------------------------------------------------------------
*/

const announcedEvents = new Map();

/*
|--------------------------------------------------------------------------
| SSE CLIENTS
|--------------------------------------------------------------------------
*/

const liveEventClients = new Set();

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
| PARSE MINUTO
|--------------------------------------------------------------------------
*/

function parseFootballMinute(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value === "number"
  ) {
    return Number.isFinite(value) &&
      value >= 0
      ? Math.floor(value)
      : null;
  }

  const text =
    String(value).trim();

  const match =
    text.match(/^(\d{1,3})/);

  if (!match) {
    return null;
  }

  const minute =
    Number(match[1]);

  return Number.isFinite(minute) &&
    minute >= 0
    ? minute
    : null;
}

/*
|--------------------------------------------------------------------------
| MINUTO SEGURO
|--------------------------------------------------------------------------
*/

function getSafeLiveMinute(
  providerMinute,
  utcDate
) {
  if (
    !Number.isFinite(
      providerMinute
    )
  ) {
    return null;
  }

  if (!utcDate) {
    return providerMinute;
  }

  const kickoff =
    new Date(utcDate).getTime();

  if (
    !Number.isFinite(kickoff)
  ) {
    return providerMinute;
  }

  const elapsedMinutes =
    Math.floor(
      (
        Date.now() -
        kickoff
      ) / 60000
    );

  if (
    !Number.isFinite(elapsedMinutes) ||
    elapsedMinutes < 0
  ) {
    return providerMinute;
  }

  let estimatedMatchMinute;

  if (
    providerMinute <= 45
  ) {
    estimatedMatchMinute =
      Math.min(
        45,
        elapsedMinutes
      );
  } else {
    estimatedMatchMinute =
      Math.min(
        90,
        Math.max(
          45,
          elapsedMinutes -
            HALFTIME_DURATION_MINUTES
        )
      );
  }

  const maximumAllowedMinute =
    estimatedMatchMinute +
    LIVE_MINUTE_TOLERANCE;

  return Math.min(
    providerMinute,
    maximumAllowedMinute
  );
}

/*
|--------------------------------------------------------------------------
| DATA
|--------------------------------------------------------------------------
*/

function getApiDate() {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: APP_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    );

  return formatter.format(
    new Date()
  );
}

function getApiDateOffset(days = 0) {
  const currentDate =
    getApiDate();

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
        timeZone: APP_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    );

  return formatter.format(date);
}

function formatLocalDateTime(
  utcDate
) {
  if (!utcDate) {
    return null;
  }

  const date =
    new Date(utcDate);

  if (
    Number.isNaN(date.getTime())
  ) {
    return null;
  }

  return new Intl.DateTimeFormat(
    "pt-PT",
    {
      timeZone: APP_TIMEZONE,
      dateStyle: "short",
      timeStyle: "medium",
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
      timestamp: now(),
      cacheTime,
    }
  );
}

/*
|--------------------------------------------------------------------------
| SPORTSSCORE
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
    pendingRequests.has(endpoint)
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
              method: "GET",
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

        lastApiError = null;

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

  if (Array.isArray(data)) {
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
    if (Array.isArray(value)) {
      return value;
    }
  }

  if (
    data.data &&
    typeof data.data === "object"
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
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return [];
}

/*
|--------------------------------------------------------------------------
| STATUS RAW
|--------------------------------------------------------------------------
*/

function getRawStatusValues(match) {
  const rawStatus =
    match?.status;

  const values = [];

  if (
    typeof rawStatus === "string"
  ) {
    values.push(
      rawStatus
    );
  }

  if (
    rawStatus &&
    typeof rawStatus === "object"
  ) {
    values.push(
      rawStatus.type,
      rawStatus.state,
      rawStatus.status,
      rawStatus.short,
      rawStatus.code,
      rawStatus.name,
      rawStatus.text,
      rawStatus.description
    );
  }

  values.push(
    match?.status_type,
    match?.statusType,
    match?.status_state,
    match?.statusState,
    match?.status_code,
    match?.statusCode,
    match?.status_short,
    match?.statusShort,
    match?.status_name,
    match?.statusName,
    match?.status_text,
    match?.statusText,
    match?.state,
    match?.state_type,
    match?.stateType
  );

  return values
    .filter(
      value =>
        value !== null &&
        value !== undefined &&
        String(value).trim()
    )
    .map(
      value =>
        String(value)
          .toLowerCase()
          .trim()
          .replace(/[\s-]+/g, "_")
    );
}

/*
|--------------------------------------------------------------------------
| STATUS
|--------------------------------------------------------------------------
*/

function normalizeStatus(match) {
  const statuses =
    getRawStatusValues(
      match
    );

  const statusText =
    statuses.join(" ");

  /*
  |--------------------------------------------------------------------------
  | INTERVALO
  |--------------------------------------------------------------------------
  */

  if (
    statuses.some(
      value =>
        [
          "halftime",
          "half_time",
          "ht",
          "paused",
          "pause",
          "break",
          "interval",
          "half",
        ].includes(value)
    ) ||
    /(^|_)(ht|halftime|half_time)(_|$)/.test(
      statusText
    )
  ) {
    return "HALFTIME";
  }

  /*
  |--------------------------------------------------------------------------
  | TERMINADO
  |--------------------------------------------------------------------------
  */

  if (
    statuses.some(
      value =>
        [
          "finished",
          "finished_aet",
          "ft",
          "ended",
          "end",
          "complete",
          "completed",
          "after_extra_time",
          "after_penalties",
          "full_time",
          "fulltime",
          "final",
          "closed",
          "cancelled",
          "canceled",
          "postponed",
        ].includes(value)
    )
  ) {
    return "FINISHED";
  }

  /*
  |--------------------------------------------------------------------------
  | LIVE
  |--------------------------------------------------------------------------
  */

  if (
    statuses.some(
      value =>
        [
          "live",
          "in_play",
          "inplay",
          "playing",
          "started",
          "start",
          "in_progress",
          "inprogress",
          "ongoing",
          "on_going",
          "1h",
          "2h",
          "first_half",
          "second_half",
          "1st_half",
          "2nd_half",
          "extra_time",
          "extra_time_1",
          "extra_time_2",
          "et",
          "playing_now",
        ].includes(value)
    )
  ) {
    return "LIVE";
  }

  /*
  |--------------------------------------------------------------------------
  | SCHEDULED
  |--------------------------------------------------------------------------
  */

  if (
    statuses.some(
      value =>
        [
          "scheduled",
          "not_started",
          "notstarted",
          "ns",
          "upcoming",
          "fixture",
          "pending",
          "not_start",
          "pre_match",
          "prematch",
          "waiting",
        ].includes(value)
    )
  ) {
    return "SCHEDULED";
  }

  /*
  |--------------------------------------------------------------------------
  | FALLBACK POR MINUTO
  |--------------------------------------------------------------------------
  |
  | Algumas respostas podem não trazer um status textual
  | útil, mas trazem o minuto do jogo.
  |
  |--------------------------------------------------------------------------
  */

  const providerMinute =
    parseFootballMinute(
      match?.minute ??
      match?.minutes ??
      match?.elapsed ??
      match?.clock?.minute
    );

  if (
    Number.isFinite(
      providerMinute
    ) &&
    providerMinute > 0 &&
    providerMinute <= 120
  ) {
    return "LIVE";
  }

  return "UNKNOWN";
}

/*
|--------------------------------------------------------------------------
| RAW MATCH PARECE LIVE
|--------------------------------------------------------------------------
|
| Usado ANTES da normalização completa para decidir
| se vale a pena tentar outro slug.
|--------------------------------------------------------------------------
*/

function rawMatchLooksLive(
  match
) {
  const status =
    normalizeStatus(
      match
    );

  if (
    status === "LIVE" ||
    status === "HALFTIME"
  ) {
    return true;
  }

  return false;
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

  return Number.isFinite(number)
    ? number
    : 0;
}

/*
|--------------------------------------------------------------------------
| TEAM IMAGE
|--------------------------------------------------------------------------
*/

function extractTeamImageUrl(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const url = value.trim();
    return url || null;
  }

  if (typeof value === "object") {
    const direct =
      value.url ||
      value.src ||
      value.href ||
      value.uri ||
      value.imageUrl ||
      value.logoUrl ||
      null;

    if (
      typeof direct === "string" &&
      direct.trim()
    ) {
      return direct.trim();
    }

    return (
      extractTeamImageUrl(
        value.image
      ) ||
      extractTeamImageUrl(
        value.logo
      ) ||
      extractTeamImageUrl(
        value.badge
      ) ||
      extractTeamImageUrl(
        value.crest
      ) ||
      extractTeamImageUrl(
        value.icon
      ) ||
      null
    );
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| TEAM
|--------------------------------------------------------------------------
*/

function normalizeTeam(
  raw,
  fallbackName,
  fallbackLogo = null
) {
  if (
    raw &&
    typeof raw === "object"
  ) {
    const name =
      raw.name ||
      raw.title ||
      raw.short_name ||
      raw.shortName ||
      raw.team?.name ||
      raw.team?.title ||
      fallbackName;

    const shortName =
      raw.short_name ||
      raw.shortName ||
      raw.name ||
      raw.team?.short_name ||
      raw.team?.shortName ||
      raw.team?.name ||
      fallbackName;

    const logo =
      extractTeamImageUrl(
        raw.logo
      ) ||
      extractTeamImageUrl(
        raw.logo_url
      ) ||
      extractTeamImageUrl(
        raw.logoUrl
      ) ||
      extractTeamImageUrl(
        raw.image
      ) ||
      extractTeamImageUrl(
        raw.image_url
      ) ||
      extractTeamImageUrl(
        raw.imageUrl
      ) ||
      extractTeamImageUrl(
        raw.badge
      ) ||
      extractTeamImageUrl(
        raw.badge_url
      ) ||
      extractTeamImageUrl(
        raw.badgeUrl
      ) ||
      extractTeamImageUrl(
        raw.crest
      ) ||
      extractTeamImageUrl(
        raw.teamLogo
      ) ||
      extractTeamImageUrl(
        raw.teamCrest
      ) ||
      extractTeamImageUrl(
        raw.team?.logo
      ) ||
      extractTeamImageUrl(
        raw.team?.image
      ) ||
      extractTeamImageUrl(
        raw.team?.badge
      ) ||
      extractTeamImageUrl(
        raw.team?.crest
      ) ||
      extractTeamImageUrl(
        fallbackLogo
      ) ||
      null;

    return {
      id:
        raw.id ||
        raw.team_id ||
        raw.teamId ||
        raw.team?.id ||
        null,

      name,

      shortName,

      logo,
    };
  }

  return {
    id: null,

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
      extractTeamImageUrl(
        fallbackLogo
      ),
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
    rawMatch.home ||
    rawMatch.teams?.home;

  const awayRaw =
    rawMatch.away_team ||
    rawMatch.awayTeam ||
    rawMatch.away ||
    rawMatch.teams?.away;

  const homeLogo =
    rawMatch.home_logo ||
    rawMatch.homeLogo ||
    rawMatch.home_logo_url ||
    rawMatch.homeLogoUrl ||
    rawMatch.home_team_logo ||
    rawMatch.homeTeamLogo ||
    null;

  const awayLogo =
    rawMatch.away_logo ||
    rawMatch.awayLogo ||
    rawMatch.away_logo_url ||
    rawMatch.awayLogoUrl ||
    rawMatch.away_team_logo ||
    rawMatch.awayTeamLogo ||
    null;

  const homeTeam =
    normalizeTeam(
      homeRaw,
      "Casa",
      homeLogo
    );

  const awayTeam =
    normalizeTeam(
      awayRaw,
      "Fora",
      awayLogo
    );

  const homeScore =
    parseScore(
      rawMatch.home_score ??
      rawMatch.homeScore ??
      rawMatch.score?.home ??
      rawMatch.scores?.home ??
      rawMatch.goals?.home ??
      rawMatch.result?.home
    );

  const awayScore =
    parseScore(
      rawMatch.away_score ??
      rawMatch.awayScore ??
      rawMatch.score?.away ??
      rawMatch.scores?.away ??
      rawMatch.goals?.away ??
      rawMatch.result?.away
    );

  const normalizedStatus =
    normalizeStatus(
      rawMatch
    );

  const isLive =
    normalizedStatus === "LIVE" ||
    normalizedStatus === "HALFTIME";

  const isFinished =
    normalizedStatus === "FINISHED";

  const isScheduled =
    normalizedStatus === "SCHEDULED" ||
    normalizedStatus === "UNKNOWN";

  const utcDate =
    rawMatch.utc_date ||
    rawMatch.utcDate ||
    rawMatch.kickoff ||
    rawMatch.kickoff_time ||
    rawMatch.kickoffTime ||
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
    rawMatch.timer?.minute ??
    rawMatch.period?.minute ??
    null;

  const providerMinute =
    parseFootballMinute(
      minuteRaw
    );

  const minute =
    getSafeLiveMinute(
      providerMinute,
      utcDate
    );

  const id =
    rawMatch.id ||
    rawMatch.fixture_id ||
    rawMatch.fixtureId ||
    rawMatch.match_id ||
    rawMatch.matchId ||
    rawMatch.event_id ||
    rawMatch.eventId ||
    rawMatch.url ||
    [
      competition.key,
      homeTeam.name,
      awayTeam.name,
      utcDate,
    ].join(":");

  const rawStatus =
    rawMatch.status;

  const status =
    typeof rawStatus === "object"
      ? (
          rawStatus.type ||
          rawStatus.state ||
          rawStatus.short ||
          rawStatus.name ||
          rawStatus.code ||
          ""
        )
      : (
          rawStatus || ""
        );

  const statusText =
    rawMatch.status_text ||
    rawMatch.statusText ||
    (
      typeof rawStatus === "object"
        ? (
            rawStatus.text ||
            rawStatus.description ||
            rawStatus.name ||
            ""
          )
        : ""
    );

  return {
    id: String(id),

    provider:
      "SportScore",

    competition: {
      key:
        competition.key,

      name:
        competition.name,

      slug:
        resolvedSlug ||
        rawMatch.competition_slug ||
        rawMatch.competitionSlug ||
        rawMatch.competition?.slug ||
        null,

      logo:
        rawMatch.competition_logo ||
        rawMatch.competitionLogo ||
        rawMatch.competition?.logo ||
        null,
    },

    homeTeam,
    awayTeam,

    score: {
      home: homeScore,
      away: awayScore,
    },

    homeScore,
    awayScore,

    scoreText:
      `${homeScore}-${awayScore}`,

    status,

    statusText,

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

function getLiveDisplay(match) {
  if (!match) {
    return {
      phase: "UNKNOWN",
      label: "Desconhecido",
      minute: null,
      matchMinuteLabel: null,
    };
  }

  if (
    match.normalizedStatus ===
    "HALFTIME"
  ) {
    return {
      phase: "HALFTIME",
      label: "Intervalo",
      minute: 45,
      matchMinuteLabel: "HT",
    };
  }

  if (
    match.normalizedStatus ===
    "FINISHED"
  ) {
    return {
      phase: "FINISHED",
      label: "Terminado",
      minute: null,
      matchMinuteLabel: "FT",
    };
  }

  if (match.isLive) {
    return {
      phase: "LIVE",
      label:
        match.minute
          ? `${match.minute}'`
          : "LIVE",

      minute:
        match.minute,

      matchMinuteLabel:
        match.minute
          ? `${match.minute}'`
          : null,
    };
  }

  if (match.isScheduled) {
    return {
      phase: "SCHEDULED",
      label:
        match.localDateTime ||
        "Agendado",

      minute: null,
      matchMinuteLabel: null,
    };
  }

  return {
    phase: "UNKNOWN",

    label:
      match.statusText ||
      match.status ||
      "Desconhecido",

    minute: null,

    matchMinuteLabel: null,
  };
}

/*
|--------------------------------------------------------------------------
| FIXTURES
|--------------------------------------------------------------------------
|
| CORREÇÃO PRINCIPAL:
|
| 1. NÃO usamos "status=live" no provider.
| 2. Tentamos todos os slugs.
| 3. Se um slug devolver 200 + [] continuamos.
| 4. Se LIVE estiver ativo, só paramos quando encontramos
|    pelo menos um jogo que parece LIVE.
|
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

  if (!slugs.length) {
    return {
      endpoint: null,
      data: null,
      slug: null,
      matches: [],
      errors: [],
      attempts: [],
      success: false,
    };
  }

  const errors = [];
  const attempts = [];

  let lastSuccessfulResponse =
    null;

  for (
    const slug of slugs
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

    /*
    |--------------------------------------------------------------------------
    | NÃO adicionar:
    |
    | params.set("status", "live")
    |
    | porque a SportScore pode devolver vazio
    | mesmo existindo jogos LIVE.
    |--------------------------------------------------------------------------
    */

    const endpoint =
      `/fixtures/?${params.toString()}`;

    try {
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
        extractMatches(data);

      const liveCount =
        matches.filter(
          rawMatch =>
            rawMatchLooksLive(
              rawMatch
            )
        ).length;

      attempts.push({
        slug,
        endpoint,
        success: true,
        count:
          matches.length,
        liveCount,
      });

      lastSuccessfulResponse = {
        endpoint,
        data,
        slug,
        matches,
      };

      /*
      |--------------------------------------------------------------------------
      | LIVE:
      |
      | Se este slug devolveu jogos mas nenhum é LIVE,
      | continuamos para o próximo slug.
      |--------------------------------------------------------------------------
      */

      if (
        liveOnly &&
        liveCount > 0
      ) {
        return {
          ...lastSuccessfulResponse,

          errors,

          attempts,

          success: true,
        };
      }

      /*
      |--------------------------------------------------------------------------
      | NORMAL:
      |
      | Qualquer slug com jogos é suficiente.
      |--------------------------------------------------------------------------
      */

      if (
        !liveOnly &&
        matches.length > 0
      ) {
        return {
          ...lastSuccessfulResponse,

          errors,

          attempts,

          success: true,
        };
      }

      /*
      |--------------------------------------------------------------------------
      | Se veio 200 + []:
      |
      | NÃO fazemos return.
      | Continuamos para o próximo slug.
      |--------------------------------------------------------------------------
      */

    } catch (error) {
      const errorInfo = {
        slug,

        status:
          error?.status ||
          null,

        message:
          error?.message ||
          String(error),
      };

      errors.push(
        errorInfo
      );

      attempts.push({
        slug,
        endpoint,
        success: false,
        count: 0,
        liveCount: 0,
        error:
          errorInfo.message,
        status:
          errorInfo.status,
      });
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Nenhum slug encontrou LIVE.
  |
  | Se tivemos pelo menos uma resposta válida,
  | devolvemos essa resposta como sucesso.
  |--------------------------------------------------------------------------
  */

  if (
    lastSuccessfulResponse
  ) {
    return {
      ...lastSuccessfulResponse,

      matches:
        lastSuccessfulResponse.matches ||
        [],

      errors,

      attempts,

      success: true,
    };
  }

  return {
    endpoint: null,
    data: null,
    slug: null,
    matches: [],
    errors,
    attempts,
    success: false,
  };
}

/*
|--------------------------------------------------------------------------
| COMPETIÇÃO
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
  const result =
    await requestFixtures({
      competitionSlugs:
        competition.slugs,

      date,
      liveOnly,
      forceRefresh,
    });

  let matches =
    result.matches
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
          match.isLive
      );
  }

  return {
    matches,

    success:
      result.success,

    failed:
      !result.success,

    slug:
      result.slug,

    errors:
      result.errors,

    attempts:
      result.attempts,
  };
}

/*
|--------------------------------------------------------------------------
| DEDUP
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
| LIVE POR DATA
|--------------------------------------------------------------------------
*/

async function getLiveMatchesForDate(
  date,
  {
    forceRefresh = false,
  } = {}
) {
  const allMatches = [];

  let successfulRequests = 0;
  let failedRequests = 0;

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

            /*
            |--------------------------------------------------------------------------
            | IMPORTANTE:
            |
            | getCompetitionMatches usa liveOnly para
            | filtrar localmente, não no provider.
            |--------------------------------------------------------------------------
            */

            liveOnly: true,

            forceRefresh,
          }
        );

      if (result.success) {
        successfulRequests++;
      } else {
        failedRequests++;
      }

      allMatches.push(
        ...result.matches
      );

    } catch (error) {
      failedRequests++;

      console.log(
        `   ⚠ ${date} - ${competition.name}: ${error.message}`
      );
    }
  }

  return {
    matches:
      deduplicateMatches(
        allMatches
      ),

    successfulRequests,

    failedRequests,

    complete:
      failedRequests === 0,
  };
}

async function getLiveMatchesFromAPI({
  forceRefresh = false,
} = {}) {
  const today =
    getApiDate();

  const yesterday =
    getApiDateOffset(-1);

  const todayResult =
    await getLiveMatchesForDate(
      today,
      {
        forceRefresh,
      }
    );

  const yesterdayResult =
    await getLiveMatchesForDate(
      yesterday,
      {
        forceRefresh,
      }
    );

  const complete =
    todayResult.complete &&
    yesterdayResult.complete;

  return {
    matches:
      deduplicateMatches([
        ...todayResult.matches,
        ...yesterdayResult.matches,
      ]),

    complete,

    todayComplete:
      todayResult.complete,

    yesterdayComplete:
      yesterdayResult.complete,

    failedRequests:
      todayResult.failedRequests +
      yesterdayResult.failedRequests,
  };
}

/*
|--------------------------------------------------------------------------
| TODAY
|--------------------------------------------------------------------------
*/

async function getTodayMatches({
  forceRefresh = false,
  date = getApiDate(),
} = {}) {
  const allMatches = [];

  let successfulRequests = 0;
  let failedRequests = 0;

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
            liveOnly: false,
            forceRefresh,
          }
        );

      if (result.success) {
        successfulRequests++;
      } else {
        failedRequests++;
      }

      allMatches.push(
        ...result.matches
      );

    } catch (error) {
      failedRequests++;

      console.log(
        `   ⚠ ${competition.name}: ${error.message}`
      );
    }
  }

  return {
    matches:
      deduplicateMatches(
        allMatches
      ),

    complete:
      failedRequests === 0,

    successfulRequests,

    failedRequests,
  };
}

/*
|--------------------------------------------------------------------------
| MERGE LIVE + TODAY
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
    const match of
      currentLive || []
  ) {
    const id =
      String(match.id);

    const previous =
      merged.get(id);

    merged.set(
      id,
      previous
        ? {
            ...previous,
            ...match,
          }
        : match
    );
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
| EVENTOS ANUNCIADOS
|--------------------------------------------------------------------------
*/

function rememberAnnouncedEvent(
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

  while (
    announcedEvents.size >
    GOAL_EVENT_LIMIT
  ) {
    const first =
      announcedEvents
        .keys()
        .next()
        .value;

    if (!first) {
      break;
    }

    announcedEvents.delete(
      first
    );
  }
}

/*
|--------------------------------------------------------------------------
| GOAL EVENT
|--------------------------------------------------------------------------
*/

function createGoalEvent(
  match,
  side
) {
  const id =
    String(match.id);

  const score =
    side === "home"
      ? match.homeScore
      : match.awayScore;

  const eventId =
    `${id}:goal:${side}:${score}`;

  if (
    goalEvents.has(eventId)
  ) {
    return null;
  }

  const timestamp =
    new Date().toISOString();

  const scoringTeam =
    side === "home"
      ? match.homeTeam
      : match.awayTeam;

  const event = {
    id: eventId,

    type: "goal",

    timestamp,

    createdAt:
      timestamp,

    matchId: id,

    competition:
      match.competition,

    competitionKey:
      match.competition?.key ||
      null,

    competitionLogo:
      match.competition?.logo ||
      null,

    homeTeam:
      match.homeTeam,

    awayTeam:
      match.awayTeam,

    home:
      match.homeTeam?.name ||
      "Casa",

    away:
      match.awayTeam?.name ||
      "Fora",

    homeName:
      match.homeTeam?.name ||
      "Casa",

    awayName:
      match.awayTeam?.name ||
      "Fora",

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

    scoreText:
      `${match.homeScore}-${match.awayScore}`,

    teamName:
      scoringTeam?.name ||
      "Equipa",

    teamScored:
      scoringTeam?.name ||
      "Equipa",

    scoringTeam:
      scoringTeam?.name ||
      "Equipa",

    team:
      side.toUpperCase(),

    side,

    minute:
      match.minute,

    matchUrl:
      match.url ||
      null,

    homeLogo:
      match.homeTeam?.logo ||
      null,

    awayLogo:
      match.awayTeam?.logo ||
      null,

    message:
      `⚽ GOLO! ${match.homeTeam?.name || "Casa"} ` +
      `${match.homeScore}-${match.awayScore} ` +
      `${match.awayTeam?.name || "Fora"}`,
  };

  goalEvents.set(
    eventId,
    event
  );

  rememberAnnouncedEvent(
    event
  );

  console.log(
    event.message
  );

  sendLiveEvent(
    "goal",
    event
  );

  return event;
}

/*
|--------------------------------------------------------------------------
| MATCH LIFECYCLE EVENT
|--------------------------------------------------------------------------
*/

function createMatchEvent(
  match,
  type
) {
  if (!match?.id) {
    return null;
  }

  const id =
    `${String(match.id)}:${type}`;

  if (
    matchEvents.has(id)
  ) {
    return matchEvents.get(id);
  }

  const timestamp =
    new Date().toISOString();

  const isStarted =
    type === "match_started";

  const homeName =
    match.homeTeam?.name ||
    "Casa";

  const awayName =
    match.awayTeam?.name ||
    "Fora";

  const homeScore =
    Number.isFinite(
      Number(match.homeScore)
    )
      ? Number(match.homeScore)
      : 0;

  const awayScore =
    Number.isFinite(
      Number(match.awayScore)
    )
      ? Number(match.awayScore)
      : 0;

  const scoreText =
    `${homeScore}-${awayScore}`;

  const event = {
    id,

    type,

    timestamp,

    createdAt:
      timestamp,

    matchId:
      String(match.id),

    competition:
      match.competition,

    competitionKey:
      match.competition?.key ||
      null,

    competitionLogo:
      match.competition?.logo ||
      null,

    homeTeam:
      match.homeTeam,

    awayTeam:
      match.awayTeam,

    home:
      homeName,

    away:
      awayName,

    homeName,

    awayName,

    homeScore,

    awayScore,

    score:
      scoreText,

    scoreText,

    scoreObject: {
      home:
        homeScore,

      away:
        awayScore,
    },

    matchUrl:
      match.url ||
      null,

    homeLogo:
      match.homeTeam?.logo ||
      null,

    awayLogo:
      match.awayTeam?.logo ||
      null,

    minute:
      match.minute,

    status:
      match.normalizedStatus ||
      null,

    utcDate:
      match.utcDate ||
      null,

    localDateTime:
      match.localDateTime ||
      null,

    message:
      isStarted
        ? `🟢 JOGO COMEÇOU: ${homeName} vs ${awayName}`
        : `🔴 JOGO ACABOU: ${homeName} ${homeScore}-${awayScore} ${awayName}`,
  };

  matchEvents.set(
    id,
    event
  );

  rememberAnnouncedEvent(
    event
  );

  console.log(
    `[EVENT] ${event.message}`
  );

  sendLiveEvent(
    type,
    event
  );

  return event;
}

/*
|--------------------------------------------------------------------------
| PROCESSAR GOLOS
|--------------------------------------------------------------------------
*/

function processGoalEvents(
  currentLiveMatches
) {
  const currentIds =
    new Set();

  for (
    const match of
      currentLiveMatches || []
  ) {
    const id =
      String(match.id);

    currentIds.add(id);

    const previous =
      previousLiveMatches.get(
        id
      );

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
        createGoalEvent(
          {
            ...match,

            homeScore:
              score,
          },
          "home"
        );
      }
    }

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
        createGoalEvent(
          {
            ...match,

            awayScore:
              score,
          },
          "away"
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
        previous.seenAt || 0
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
| PROCESSAR CICLO DE VIDA
|--------------------------------------------------------------------------
*/

function processMatchLifecycle(
  currentMatches,
  {
    detectDisappeared = false,
  } = {}
) {
  const currentIds =
    new Set();

  for (
    const match of
      currentMatches || []
  ) {
    if (!match?.id) {
      continue;
    }

    const id =
      String(match.id);

    currentIds.add(id);

    const previous =
      matchLifecycleStates.get(
        id
      );

    const currentStatus =
      match.normalizedStatus ||
      "UNKNOWN";

    /*
    |--------------------------------------------------------------------------
    | PRIMEIRA VEZ
    |--------------------------------------------------------------------------
    */

    if (!previous) {
      if (
        currentStatus === "LIVE" ||
        currentStatus === "HALFTIME"
      ) {
        createMatchEvent(
          match,
          "match_started"
        );
      }

      matchLifecycleStates.set(
        id,
        {
          status:
            currentStatus,

          homeScore:
            match.homeScore,

          awayScore:
            match.awayScore,

          seenAt:
            new Date().toISOString(),

          lastSeenAt:
            new Date().toISOString(),

          match,
        }
      );

      continue;
    }

    const previousStatus =
      previous.status ||
      "UNKNOWN";

    const wasNotStarted =
      previousStatus ===
        "SCHEDULED" ||
      previousStatus ===
        "UNKNOWN";

    const isNowLive =
      currentStatus === "LIVE" ||
      currentStatus === "HALFTIME";

    if (
      wasNotStarted &&
      isNowLive
    ) {
      createMatchEvent(
        match,
        "match_started"
      );
    }

    const wasLive =
      previousStatus === "LIVE" ||
      previousStatus === "HALFTIME";

    if (
      wasLive &&
      currentStatus === "FINISHED"
    ) {
      createMatchEvent(
        match,
        "match_finished"
      );
    }

    matchLifecycleStates.set(
      id,
      {
        status:
          currentStatus,

        homeScore:
          match.homeScore,

        awayScore:
          match.awayScore,

        seenAt:
          previous.seenAt ||
          new Date().toISOString(),

        lastSeenAt:
          new Date().toISOString(),

        match,
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | LIVE -> desapareceu
  |--------------------------------------------------------------------------
  */

  if (detectDisappeared) {
    for (
      const [
        id,
        state,
      ] of matchLifecycleStates
    ) {
      if (
        currentIds.has(id)
      ) {
        continue;
      }

      const previousStatus =
        state.status ||
        "UNKNOWN";

      const wasLive =
        previousStatus === "LIVE" ||
        previousStatus === "HALFTIME";

      if (!wasLive) {
        continue;
      }

      const previousMatch =
        state.match;

      if (
        previousMatch
      ) {
        createMatchEvent(
          previousMatch,
          "match_finished"
        );
      }

      matchLifecycleStates.set(
        id,
        {
          ...state,

          status:
            "FINISHED",

          finishedAt:
            new Date().toISOString(),

          lastSeenAt:
            new Date().toISOString(),
        }
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | LIMPEZA
  |--------------------------------------------------------------------------
  */

  for (
    const [
      id,
      state,
    ] of matchLifecycleStates
  ) {
    const seenAt =
      new Date(
        state.lastSeenAt ||
        state.seenAt ||
        0
      ).getTime();

    if (
      Date.now() -
        seenAt >
      24 * 60 * 60 * 1000
    ) {
      matchLifecycleStates.delete(
        id
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| TODOS OS EVENTOS
|--------------------------------------------------------------------------
*/

function getAllGoalEvents() {
  const events = [
    ...goalEvents.values(),
    ...matchEvents.values(),
  ];

  events.sort(
    (a, b) =>
      new Date(
        a.timestamp
      ).getTime() -
      new Date(
        b.timestamp
      ).getTime()
  );

  return {
    ok: true,

    count:
      events.length,

    goalCount:
      goalEvents.size,

    matchEventCount:
      matchEvents.size,

    events,

    goals:
      [...goalEvents.values()],

    matchEvents:
      [...matchEvents.values()],
  };
}

/*
|--------------------------------------------------------------------------
| EVENTS SINCE
|--------------------------------------------------------------------------
*/

function getGoalEventsSince(
  since
) {
  const sinceTime =
    new Date(
      since
    ).getTime();

  const events =
    [
      ...goalEvents.values(),
      ...matchEvents.values(),
    ]
      .filter(event => {
        return (
          new Date(
            event.timestamp
          ).getTime() >
          sinceTime
        );
      })
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

  const matchLifecycleEvents =
    events.filter(
      event =>
        event.type ===
          "match_started" ||
        event.type ===
          "match_finished"
    );

  return {
    ok: true,

    count:
      events.length,

    goalCount:
      goals.length,

    matchEventCount:
      matchLifecycleEvents.length,

    events,

    goals,

    matchEvents:
      matchLifecycleEvents,

    serverTime:
      new Date().toISOString(),
  };
}

/*
|--------------------------------------------------------------------------
| CLEAR EVENTS
|--------------------------------------------------------------------------
*/

function clearGoalEvents() {
  goalEvents.clear();
  matchEvents.clear();
  announcedEvents.clear();

  console.log(
    "🧹 Eventos de GOLOS e JOGOS limpos."
  );
}

/*
|--------------------------------------------------------------------------
| TODAY UPDATE
|--------------------------------------------------------------------------
*/

function mergeAndStoreToday(
  matches
) {
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
}

async function updateTodayMatches({
  forceRefresh = false,
  date = getApiDate(),
} = {}) {
  if (todayUpdateRunning) {
    return;
  }

  todayUpdateRunning =
    true;

  try {
    const result =
      await getTodayMatches({
        forceRefresh,
        date,
      });

    if (result.complete) {
      processMatchLifecycle(
        result.matches
      );
    }

    mergeAndStoreToday(
      result.matches
    );

    lastTodayLoad =
      new Date().toISOString();

    lastTodayApiDate =
      date;

    lastTodayUpdate =
      lastTodayLoad;

    lastTodayError =
      result.complete
        ? null
        : {
            message:
              `Falha em ${result.failedRequests} pedido(s) da API.`,
            at:
              new Date().toISOString(),
          };

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
| LIFECYCLE UPDATE
|--------------------------------------------------------------------------
*/

async function updateMatchLifecycle() {
  if (lifecycleUpdateRunning) {
    return;
  }

  lifecycleUpdateRunning =
    true;

  try {
    const currentApiDate =
      getApiDate();

    if (
      lastTodayApiDate &&
      lastTodayApiDate !==
        currentApiDate
    ) {
      console.log(
        `🌙 Mudança de dia: ${lastTodayApiDate} → ${currentApiDate}`
      );

      matchLifecycleStates.clear();

      await updateTodayMatches({
        forceRefresh: true,
        date:
          currentApiDate,
      });

      return;
    }

    const result =
      await getTodayMatches({
        forceRefresh: true,
        date:
          currentApiDate,
      });

    if (result.complete) {
      processMatchLifecycle(
        result.matches
      );
    }

    todayMatches =
      mergeLiveIntoToday(
        result.matches,
        liveMatches
      );

    scheduledMatches =
      todayMatches.filter(
        match =>
          match.isScheduled
      );

    lastTodayLoad =
      new Date().toISOString();

    lastTodayUpdate =
      lastTodayLoad;

    lastTodayApiDate =
      currentApiDate;

    lastTodayError =
      result.complete
        ? null
        : {
            message:
              `Falha em ${result.failedRequests} pedido(s) da API.`,

            at:
              new Date().toISOString(),
          };

  } catch (error) {
    lastTodayError = {
      message:
        error.message,

      at:
        new Date().toISOString(),
    };

    console.error(
      `❌ LIFECYCLE: ${error.message}`
    );

  } finally {
    lifecycleUpdateRunning =
      false;
  }
}

/*
|--------------------------------------------------------------------------
| MUDANÇA DE DIA
|--------------------------------------------------------------------------
*/

async function refreshTodayIfDateChanged() {
  const currentApiDate =
    getApiDate();

  if (!lastTodayApiDate) {
    return;
  }

  if (
    currentApiDate ===
    lastTodayApiDate
  ) {
    return;
  }

  console.log(
    `🌙 MUDANÇA DE DIA: ${lastTodayApiDate} → ${currentApiDate}`
  );

  matchLifecycleStates.clear();

  await updateTodayMatches({
    forceRefresh: true,
    date:
      currentApiDate,
  });
}

/*
|--------------------------------------------------------------------------
| LIVE UPDATE
|--------------------------------------------------------------------------
*/

async function updateLiveMatches({
  forceRefresh = false,
} = {}) {
  if (liveUpdateRunning) {
    return;
  }

  liveUpdateRunning =
    true;

  try {
    await refreshTodayIfDateChanged();

    const liveResult =
      await getLiveMatchesFromAPI({
        forceRefresh,
      });

    /*
    |--------------------------------------------------------------------------
    | Se a consulta estiver incompleta,
    | não destruímos o estado LIVE anterior.
    |--------------------------------------------------------------------------
    */

    if (!liveResult.complete) {
      lastLiveError = {
        message:
          `Falha em ${liveResult.failedRequests} pedido(s) da API LIVE.`,

        at:
          new Date().toISOString(),
      };

      console.error(
        `❌ LIVE: consulta incompleta. ` +
        `${liveResult.failedRequests} pedidos falharam. ` +
        `Estado LIVE anterior mantido.`
      );

      return;
    }

    liveMatches =
      deduplicateMatches(
        liveResult.matches
      );

    /*
    |--------------------------------------------------------------------------
    | GOLOS
    |--------------------------------------------------------------------------
    */

    processGoalEvents(
      liveMatches
    );

    /*
    |--------------------------------------------------------------------------
    | LIFECYCLE
    |--------------------------------------------------------------------------
    */

    processMatchLifecycle(
      liveMatches,
      {
        detectDisappeared:
          true,
      }
    );

    /*
    |--------------------------------------------------------------------------
    | MERGE
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

    lastLiveUpdate =
      new Date().toISOString();

    lastLiveError =
      null;

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
          lastLiveUpdate,
      }
    );

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
        connected: true,

        server:
          "football-server",

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
| LIVE HEALTH
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live/health",
  (req, res) => {
    res.json({
      ok: true,

      server:
        "football-server",

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

      lifecycleUpdateInterval:
        LIFECYCLE_UPDATE_INTERVAL,

      lifecycleUpdateSeconds:
        LIFECYCLE_UPDATE_INTERVAL /
        1000,

      liveMinuteTolerance:
        LIVE_MINUTE_TOLERANCE,

      halftimeDurationMinutes:
        HALFTIME_DURATION_MINUTES,

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

      goalEvents:
        goalEvents.size,

      matchEvents:
        matchEvents.size,

      lifecycleStates:
        matchLifecycleStates.size,

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
| GOALS HEALTH
|--------------------------------------------------------------------------
*/

app.get(
  "/api/goals/health",
  (req, res) => {
    res.json({
      ok: true,

      server:
        "football-server",

      provider:
        "SportScore",

      port:
        PORT,

      sport:
        SPORT,

      apiBase:
        API_URL,

      apiKey:
        Boolean(
          SPORTSSCORE_API_KEY
        ),

      timezone:
        APP_TIMEZONE,

      date:
        getApiDate(),

      competitions:
        COMPETITIONS.length,

      liveMatches:
        liveMatches.length,

      todayMatches:
        todayMatches.length,

      goalEvents:
        goalEvents.size,

      matchEvents:
        matchEvents.size,

      eventCount:
        goalEvents.size +
        matchEvents.size,

      lifecycleStates:
        matchLifecycleStates.size,

      liveUpdateInterval:
        LIVE_UPDATE_INTERVAL,

      lifecycleUpdateInterval:
        LIFECYCLE_UPDATE_INTERVAL,

      lastPoll:
        lastLiveUpdate,

      lastSuccessfulPoll:
        lastLiveError
          ? null
          : lastLiveUpdate,

      lastError:
        lastLiveError,
    });
  }
);

/*
|--------------------------------------------------------------------------
| LIVE
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live",
  (req, res) => {
    res.json({
      success: true,

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
| TODAY
|--------------------------------------------------------------------------
*/

app.get(
  "/api/live/today",
  (req, res) => {
    res.json({
      success: true,

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
| UPCOMING
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
          (a, b) =>
            new Date(
              a.utcDate || 0
            ).getTime() -
            new Date(
              b.utcDate || 0
            ).getTime()
        );

    res.json({
      success: true,

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
      success: true,

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
| LIVE DETECTED EVENTS
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
      success: true,

      count:
        events.length,

      events,
    });
  }
);

/*
|--------------------------------------------------------------------------
| FORCE LIVE CHECK
|--------------------------------------------------------------------------
*/

app.post(
  "/api/live/check",
  async (req, res) => {
    if (liveUpdateRunning) {
      return res
        .status(409)
        .json({
          success: false,

          error:
            "Já existe uma atualização LIVE em curso.",
        });
    }

    cache.clear();

    await updateLiveMatches({
      forceRefresh: true,
    });

    res.json({
      success: true,

      provider:
        "SportScore",

      updatedAt:
        lastLiveUpdate,

      count:
        liveMatches.length,

      matches:
        liveMatches,

      lastError:
        lastLiveError,
    });
  }
);

/*
|--------------------------------------------------------------------------
| FORCE LIFECYCLE CHECK
|--------------------------------------------------------------------------
*/

app.post(
  "/api/live/lifecycle/check",
  async (req, res) => {
    if (
      lifecycleUpdateRunning
    ) {
      return res
        .status(409)
        .json({
          success: false,

          error:
            "Já existe uma atualização de lifecycle em curso.",
        });
    }

    cache.clear();

    await updateMatchLifecycle();

    res.json({
      success: true,

      updatedAt:
        lastTodayUpdate,

      todayMatches:
        todayMatches.length,

      lifecycleStates:
        matchLifecycleStates.size,

      matchEvents:
        [
          ...matchEvents.values(),
        ],
    });
  }
);

/*
|--------------------------------------------------------------------------
| CLEAR CACHE
|--------------------------------------------------------------------------
*/

app.post(
  "/api/live/cache/clear",
  (req, res) => {
    cache.clear();

    res.json({
      success: true,

      message:
        "Cache SportScore limpo.",
    });
  }
);

/*
|--------------------------------------------------------------------------
| MATCH ESPECÍFICO
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
          String(item.id) ===
          matchId
      );

    if (!match) {
      match =
        liveMatches.find(
          item =>
            String(item.id) ===
            matchId
        );
    }

    if (!match) {
      return res
        .status(404)
        .json({
          success: false,

          error:
            "Jogo não encontrado no cache.",
        });
    }

    const display =
      getLiveDisplay(match);

    res.json({
      success: true,

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
| GOALS - TODOS OS EVENTOS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/goals",
  (req, res) => {
    res.json(
      getAllGoalEvents()
    );
  }
);

/*
|--------------------------------------------------------------------------
| GOALS - APENAS GOLOS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/goals/goals",
  (req, res) => {
    const goals =
      [
        ...goalEvents.values(),
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
      ok: true,

      count:
        goals.length,

      goals,
    });
  }
);

/*
|--------------------------------------------------------------------------
| GOALS - EVENTOS DE JOGOS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/goals/matches/events",
  (req, res) => {
    const events =
      [
        ...matchEvents.values(),
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
      ok: true,

      count:
        events.length,

      events,
    });
  }
);

/*
|--------------------------------------------------------------------------
| GOALS SINCE
|--------------------------------------------------------------------------
*/

app.get(
  "/api/goals/since",
  (req, res) => {
    const since =
      req.query.since;

    if (!since) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            'Parâmetro "since" é obrigatório.',
        });
    }

    const date =
      new Date(since);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return res
        .status(400)
        .json({
          ok: false,

          error:
            'Parâmetro "since" inválido.',
        });
    }

    res.json(
      getGoalEventsSince(
        date.toISOString()
      )
    );
  }
);

/*
|--------------------------------------------------------------------------
| GOALS TODAY
|--------------------------------------------------------------------------
*/

app.get(
  "/api/goals/today",
  (req, res) => {
    res.json({
      ok: true,

      date:
        getApiDate(),

      count:
        todayMatches.length,

      matches:
        todayMatches,
    });
  }
);

/*
|--------------------------------------------------------------------------
| GOALS LIVE
|--------------------------------------------------------------------------
*/

app.get(
  "/api/goals/live",
  (req, res) => {
    res.json({
      ok: true,

      count:
        liveMatches.length,

      matches:
        liveMatches,
    });
  }
);

/*
|--------------------------------------------------------------------------
| GOALS COMPETITIONS
|--------------------------------------------------------------------------
*/

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
| GOALS DEBUG
|--------------------------------------------------------------------------
*/

app.get(
  "/api/goals/debug",
  (req, res) => {
    res.json({
      ok: true,

      live: {
        liveMatches:
          liveMatches.length,

        todayMatches:
          todayMatches.length,

        previousMatches:
          Object.fromEntries(
            previousLiveMatches
          ),
      },

      lifecycle: {
        states:
          Object.fromEntries(
            matchLifecycleStates
          ),
      },

      goals: {
        goalEvents:
          [
            ...goalEvents.values(),
          ],

        matchEvents:
          [
            ...matchEvents.values(),
          ],
      },

      server: {
        lastLiveUpdate,

        lastTodayUpdate,

        lastTodayLoad,

        lastTodayApiDate,

        liveUpdateInterval:
          LIVE_UPDATE_INTERVAL,

        lifecycleUpdateInterval:
          LIFECYCLE_UPDATE_INTERVAL,

        liveMinuteTolerance:
          LIVE_MINUTE_TOLERANCE,

        halftimeDurationMinutes:
          HALFTIME_DURATION_MINUTES,

        apiRequestsThisProcess,
      },
    });
  }
);

/*
|--------------------------------------------------------------------------
| DELETE GOALS
|--------------------------------------------------------------------------
*/

app.delete(
  "/api/goals",
  (req, res) => {
    clearGoalEvents();

    res.json({
      ok: true,

      message:
        "Eventos de golos e jogos apagados.",
    });
  }
);

/*
|--------------------------------------------------------------------------
| DELETE CACHE
|--------------------------------------------------------------------------
*/

app.delete(
  "/api/goals/cache",
  (req, res) => {
    cache.clear();

    res.json({
      ok: true,

      message:
        "Cache SportScore limpo.",
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
        "Football Server",

      provider:
        "SportScore",

      status:
        "online",

      port:
        PORT,

      timezone:
        APP_TIMEZONE,

      updateIntervals: {
        live:
          LIVE_UPDATE_INTERVAL,

        lifecycle:
          LIFECYCLE_UPDATE_INTERVAL,
      },

      minuteProtection: {
        enabled:
          true,

        tolerance:
          LIVE_MINUTE_TOLERANCE,

        halftimeDuration:
          HALFTIME_DURATION_MINUTES,
      },

      events: {
        goals:
          goalEvents.size,

        matchEvents:
          matchEvents.size,

        total:
          goalEvents.size +
          matchEvents.size,
      },

      endpoints: {
        health:
          "/api/live/health",

        live:
          "/api/live",

        today:
          "/api/live/today",

        upcoming:
          "/api/live/upcoming",

        liveEvents:
          "/api/live/events",

        liveDetectedEvents:
          "/api/live/detected-events",

        competitions:
          "/api/live/competitions",

        liveCheck:
          "/api/live/check",

        lifecycleCheck:
          "/api/live/lifecycle/check",

        liveCache:
          "/api/live/cache/clear",

        goals:
          "/api/goals",

        goalsHealth:
          "/api/goals/health",

        goalsSince:
          "/api/goals/since",

        goalsOnly:
          "/api/goals/goals",

        matchEvents:
          "/api/goals/matches/events",

        goalsToday:
          "/api/goals/today",

        goalsLive:
          "/api/goals/live",

        goalsCompetitions:
          "/api/goals/competitions",

        goalsDebug:
          "/api/goals/debug",
      },
    });
  }
);

/*
|--------------------------------------------------------------------------
| EXPRESS ERROR
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
      return next(error);
    }

    res
      .status(500)
      .json({
        success: false,

        error:
          error.message ||
          "Erro interno.",
      });
  }
);

/*
|--------------------------------------------------------------------------
| SSE KEEP ALIVE
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
| SERVER
|--------------------------------------------------------------------------
*/

async function startServer() {
  console.log("");

  console.log(
    "=========================================="
  );

  console.log(
    "⚽ FOOTBALL BET ANALYZER SERVER"
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
      LIVE_UPDATE_INTERVAL / 1000
    }s`
  );

  console.log(
    `🔄 LIFECYCLE: cada ${
      LIFECYCLE_UPDATE_INTERVAL / 1000
    }s`
  );

  console.log(
    `⏱️ MINUTO LIVE: tolerância ${
      LIVE_MINUTE_TOLERANCE
    } min`
  );

  console.log(
    "🔴 LIVE: hoje + ontem"
  );

  console.log(
    "📅 TODAY: arranque + lifecycle"
  );

  console.log(
    "⚽ GOALS: integrado no LIVE"
  );

  console.log(
    "🟢 START: integrado no LIVE + LIFECYCLE"
  );

  console.log(
    "🔴 FINISH: integrado no LIVE + LIFECYCLE"
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

  /*
  |--------------------------------------------------------------------------
  | PRIMEIRA CARGA
  |--------------------------------------------------------------------------
  */

  await updateTodayMatches({
    forceRefresh: true,

    date:
      getApiDate(),
  });

  await updateLiveMatches({
    forceRefresh: true,
  });

  /*
  |--------------------------------------------------------------------------
  | POLLING
  |--------------------------------------------------------------------------
  */

  setInterval(
    () => {
      updateLiveMatches().catch(
        error => {
          console.error(
            "❌ LIVE interval:",
            error
          );
        }
      );
    },
    LIVE_UPDATE_INTERVAL
  );

  setInterval(
    () => {
      updateMatchLifecycle().catch(
        error => {
          console.error(
            "❌ Lifecycle interval:",
            error
          );
        }
      );
    },
    LIFECYCLE_UPDATE_INTERVAL
  );

  /*
  |--------------------------------------------------------------------------
  | LISTEN
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
        "LIVE:"
      );

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
        "   /api/live/detected-events"
      );

      console.log(
        "   /api/live/competitions"
      );

      console.log(
        "   /api/live/check"
      );

      console.log(
        "   /api/live/lifecycle/check"
      );

      console.log("");

      console.log(
        "GOALS:"
      );

      console.log(
        "   /api/goals"
      );

      console.log(
        "   /api/goals/health"
      );

      console.log(
        "   /api/goals/since"
      );

      console.log(
        "   /api/goals/goals"
      );

      console.log(
        "   /api/goals/matches/events"
      );

      console.log(
        "   /api/goals/today"
      );

      console.log(
        "   /api/goals/live"
      );

      console.log(
        "   /api/goals/debug"
      );

      console.log("");

      console.log(
        "📌 EVENTOS:"
      );

      console.log(
        "   ⚽ goal"
      );

      console.log(
        "   🟢 match_started"
      );

      console.log(
        "   🔴 match_finished"
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
| NODE ERRORS
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

    console.error(error);

    process.exit(1);
  }
);