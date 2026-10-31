"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

const PORT = Number(
  process.env.PORT || 3000
);

const API_URL =
  "https://api.football-data.org/v4";

const API_TOKEN =
  String(
    process.env.FOOTBALL_DATA_TOKEN || ""
  ).trim();

const HISTORY_COUNT =
  clampInt(
    process.env.HISTORY_COUNT || 10,
    5,
    20
  );

const MAX_REQUESTS_PER_MINUTE = 8;
const RATE_WINDOW = 60_000;

const DAILY_ANALYSIS_LIMIT = 20;


// -----------------------------------------------------------------------------
// CONFIGURAÇÃO DO MODELO
// -----------------------------------------------------------------------------

const MAX_POISSON_GOALS = 15;

const DIXON_COLES_RHO = -0.10;

const SMALL_SAMPLE_PRIOR = 5;

const COMPETITION_PRIOR = 8;

const MIN_EXPECTED_GOALS = 0.05;
const MAX_EXPECTED_GOALS = 5;


// -----------------------------------------------------------------------------
// ÉPOCA ATUAL
// -----------------------------------------------------------------------------

function getCurrentSeason() {

  if (
    process.env.FOOTBALL_DATA_SEASON
  ) {

    return clampInt(
      process.env.FOOTBALL_DATA_SEASON,
      2000,
      2100
    );

  }

  const now =
    new Date();

  const year =
    now.getUTCFullYear();

  const month =
    now.getUTCMonth();

  if (
    month < 6
  ) {

    return year - 1;

  }

  return year;

}


const CURRENT_SEASON =
  getCurrentSeason();


// -----------------------------------------------------------------------------
// COMPETIÇÕES
// -----------------------------------------------------------------------------

const COMPETITIONS = {

  PL: {
    code: "PL",
    id: 2021,
    name: "Premier League",
    country: "England"
  },

  PPL: {
    code: "PPL",
    id: 2017,
    name: "Primeira Liga",
    country: "Portugal"
  },

  BL1: {
    code: "BL1",
    id: 2002,
    name: "Bundesliga",
    country: "Germany"
  },

  SA: {
    code: "SA",
    id: 2019,
    name: "Serie A",
    country: "Italy"
  },

  PD: {
    code: "PD",
    id: 2014,
    name: "La Liga",
    country: "Spain"
  },

  FL1: {
    code: "FL1",
    id: 2015,
    name: "Ligue 1",
    country: "France"
  },

  DED: {
    code: "DED",
    id: 2003,
    name: "Eredivisie",
    country: "Netherlands"
  },

  CL: {
    code: "CL",
    id: 2001,
    name: "Champions League",
    country: "Europe"
  },

  BSA: {
    code: "BSA",
    id: 2013,
    name: "Brasileirão Série A",
    country: "Brazil"
  }

};


const ALLOWED_COMPETITIONS =
  new Set(
    Object.keys(
      COMPETITIONS
    )
  );


// -----------------------------------------------------------------------------
// EXPRESS
// -----------------------------------------------------------------------------

app.use(
  cors()
);

app.use(
  express.json()
);

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);


// -----------------------------------------------------------------------------
// CACHE
// -----------------------------------------------------------------------------

const cache =
  new Map();

const pendingRequests =
  new Map();


// -----------------------------------------------------------------------------
// BETCLIC PT
// -----------------------------------------------------------------------------
//
// Odds reais da Betclic Portugal através da PropLine.
// A chave da API fica apenas no servidor.
//
// .env:
// BETCLIC_ODDS_API_KEY=...
// BETCLIC_ODDS_API_URL=https://api.prop-line.com/v1
// -----------------------------------------------------------------------------

const BETCLIC_ODDS_API_URL =
  String(
    process.env.BETCLIC_ODDS_API_URL ||
    "https://api.prop-line.com/v1"
  ).replace(/\/+$/, "");

const BETCLIC_ODDS_API_KEY =
  String(
    process.env.BETCLIC_ODDS_API_KEY || ""
  ).trim();

const BETCLIC_BOOKMAKER =
  "betclic_pt";

const BETCLIC_SPORT_KEYS = {
  PL: "soccer_epl",
  PPL: "soccer_primeira_liga",
  BL1: "soccer_bundesliga",
  SA: "soccer_italy_serie_a",
  PD: "soccer_spain_la_liga",
  FL1: "soccer_france_ligue_one",
  DED: "soccer_eredivisie",
  CL: "soccer_uefa_champs_league",
  BSA: "soccer_brazil_campeonato"
};

const BETCLIC_CACHE_TTL =
  60_000;

const betclicOddsCache =
  new Map();

function normalizeBetclicTeamName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|sc|ac|cd|afc|club|football|futebol)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamsMatch(a, b) {
  const aa =
    normalizeBetclicTeamName(a);

  const bb =
    normalizeBetclicTeamName(b);

  if (!aa || !bb) {
    return false;
  }

  if (aa === bb) {
    return true;
  }

  return (
    aa.includes(bb) ||
    bb.includes(aa)
  );
}

function americanToDecimal(price) {
  const numeric =
    Number(price);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  // Betclic/European books normalmente devolvem
  // odds decimais. Valores fora do intervalo normal
  // são tratados como American odds.
  if (
    numeric > 1 &&
    numeric < 20
  ) {
    return numeric;
  }

  if (numeric > 0) {
    return (
      1 +
      numeric / 100
    );
  }

  if (numeric < 0) {
    return (
      1 +
      100 / Math.abs(numeric)
    );
  }

  return null;
}

function getBetclicSportKey(
  competitionCode
) {
  return (
    BETCLIC_SPORT_KEYS[
      String(
        competitionCode || ""
      ).toUpperCase()
    ] ||
    null
  );
}

async function fetchBetclicCompetitionOdds(
  competitionCode
) {
  if (!BETCLIC_ODDS_API_KEY) {
    return [];
  }

  const sportKey =
    getBetclicSportKey(
      competitionCode
    );

  if (!sportKey) {
    return [];
  }

  const cacheKey =
    sportKey;

  const cached =
    betclicOddsCache.get(
      cacheKey
    );

  if (
    cached &&
    Date.now() -
      cached.timestamp <
      BETCLIC_CACHE_TTL
  ) {
    return cached.events;
  }

  const params =
    new URLSearchParams({
      apiKey:
        BETCLIC_ODDS_API_KEY,

      bookmakers:
        BETCLIC_BOOKMAKER,

      markets:
        [
          "h2h",
          "totals",
          "both_teams_to_score",
          "double_chance"
        ].join(","),

      includeLinks:
        "true"
    });

  const url =
    `${BETCLIC_ODDS_API_URL}/sports/${sportKey}/odds?${params.toString()}`;

  try {
    const response =
      await fetch(url);

    if (!response.ok) {
      const body =
        await response.text();

      console.error(
        `[BETCLIC] HTTP ${response.status}: ${body.slice(0, 500)}`
      );

      return [];
    }

    const data =
      await response.json();

    const events =
      Array.isArray(data)
        ? data
        : Array.isArray(data?.events)
          ? data.events
          : [];

    betclicOddsCache.set(
      cacheKey,
      {
        timestamp:
          Date.now(),
        events
      }
    );

    console.log(
      `[BETCLIC] ${competitionCode}: ${events.length} eventos recebidos`
    );

    return events;

  } catch (error) {
    console.error(
      "[BETCLIC] Erro:",
      error.message
    );

    return [];
  }
}

function findBetclicEvent(
  events,
  match
) {
  if (
    !Array.isArray(events) ||
    !match
  ) {
    return null;
  }

  const homeTeam =
    match.homeTeam?.name ||
    match.homeTeam ||
    "";

  const awayTeam =
    match.awayTeam?.name ||
    match.awayTeam ||
    "";

  if (
    !homeTeam ||
    !awayTeam
  ) {
    return null;
  }

  const exact =
    events.find(
      (event) =>
        teamsMatch(
          event.home_team,
          homeTeam
        ) &&
        teamsMatch(
          event.away_team,
          awayTeam
        )
    );

  if (exact) {
    return exact;
  }

  // Fallback: procura as duas equipas independentemente
  // de pequenas diferenças no nome.
  return (
    events.find(
      (event) =>
        teamsMatch(
          event.home_team,
          homeTeam
        ) &&
        teamsMatch(
          event.away_team,
          awayTeam
        )
    ) ||
    null
  );
}

function getBetclicBookmaker(
  event
) {
  if (
    !Array.isArray(
      event?.bookmakers
    )
  ) {
    return null;
  }

  return (
    event.bookmakers.find(
      (bookmaker) =>
        bookmaker.key ===
        BETCLIC_BOOKMAKER
    ) ||
    event.bookmakers.find(
      (bookmaker) =>
        String(
          bookmaker.title || ""
        )
          .toLowerCase()
          .includes("betclic")
    ) ||
    null
  );
}

function getBetclicMarket(
  bookmaker,
  keys
) {
  if (
    !Array.isArray(
      bookmaker?.markets
    )
  ) {
    return null;
  }

  const wanted =
    Array.isArray(keys)
      ? keys
      : [keys];

  return (
    bookmaker.markets.find(
      (market) =>
        wanted.includes(
          String(
            market.key || ""
          ).toLowerCase()
        )
    ) ||
    null
  );
}

function findBetclicOutcome(
  outcomes,
  callback
) {
  if (
    !Array.isArray(outcomes)
  ) {
    return null;
  }

  return (
    outcomes.find(
      callback
    ) ||
    null
  );
}

function makeBetclicSelection(
  outcome,
  marketKey
) {
  if (!outcome) {
    return null;
  }

  const odd =
    americanToDecimal(
      outcome.price
    );

  if (
    odd === null ||
    odd <= 1
  ) {
    return null;
  }

  return {
    odd:
      Number(
        odd.toFixed(2)
      ),

    selection:
      outcome.name ||
      null,

    point:
      outcome.point ??
      null,

    market:
      marketKey ||
      null
  };
}

function getH2HBetclicOdd(
  bookmaker,
  match,
  type
) {
  const market =
    getBetclicMarket(
      bookmaker,
      ["h2h"]
    );

  if (!market) {
    return null;
  }

  const homeTeam =
    match.homeTeam?.name ||
    match.homeTeam ||
    "";

  const awayTeam =
    match.awayTeam?.name ||
    match.awayTeam ||
    "";

  let outcome =
    null;

  if (type === "home") {
    outcome =
      findBetclicOutcome(
        market.outcomes,
        (item) =>
          teamsMatch(
            item.name,
            homeTeam
          )
      );
  }

  if (type === "away") {
    outcome =
      findBetclicOutcome(
        market.outcomes,
        (item) =>
          teamsMatch(
            item.name,
            awayTeam
          )
      );
  }

  if (type === "draw") {
    outcome =
      findBetclicOutcome(
        market.outcomes,
        (item) => {
          const name =
            String(
              item.name || ""
            )
              .toLowerCase()
              .trim();

          return (
            name === "draw" ||
            name === "empate" ||
            name === "x"
          );
        }
      );
  }

  return makeBetclicSelection(
    outcome,
    "h2h"
  );
}

function getTotalsBetclicOdd(
  bookmaker,
  side,
  point
) {
  const market =
    getBetclicMarket(
      bookmaker,
      ["totals"]
    );

  if (!market) {
    return null;
  }

  const wantedSide =
    String(
      side || ""
    ).toLowerCase();

  const wantedPoint =
    Number(point);

  const outcome =
    findBetclicOutcome(
      market.outcomes,
      (item) => {
        const name =
          String(
            item.name || ""
          )
            .toLowerCase()
            .trim();

        const itemPoint =
          Number(item.point);

        return (
          name === wantedSide &&
          itemPoint === wantedPoint
        );
      }
    );

  return makeBetclicSelection(
    outcome,
    "totals"
  );
}

function getBttsBetclicOdd(
  bookmaker
) {
  const market =
    getBetclicMarket(
      bookmaker,
      [
        "both_teams_to_score",
        "btts"
      ]
    );

  if (!market) {
    return null;
  }

  const outcome =
    findBetclicOutcome(
      market.outcomes,
      (item) => {
        const name =
          String(
            item.name || ""
          )
            .toLowerCase()
            .trim();

        return (
          name === "yes" ||
          name === "sim" ||
          name.includes("yes") ||
          name.includes("sim")
        );
      }
    );

  return makeBetclicSelection(
    outcome,
    market.key
  );
}

function getDoubleChanceBetclicOdd(
  bookmaker,
  match,
  type
) {
  const market =
    getBetclicMarket(
      bookmaker,
      ["double_chance"]
    );

  if (!market) {
    return null;
  }

  const homeTeam =
    match.homeTeam?.name ||
    match.homeTeam ||
    "";

  const awayTeam =
    match.awayTeam?.name ||
    match.awayTeam ||
    "";

  const normalizedHome =
    normalizeBetclicTeamName(
      homeTeam
    );

  const normalizedAway =
    normalizeBetclicTeamName(
      awayTeam
    );

  const outcome =
    findBetclicOutcome(
      market.outcomes,
      (item) => {
        const name =
          normalizeBetclicTeamName(
            item.name
          );

        const hasHome =
          name.includes(
            normalizedHome
          );

        const hasAway =
          name.includes(
            normalizedAway
          );

        const hasDraw =
          name.includes("draw") ||
          name.includes("empate");

        if (
          type === "home"
        ) {
          return (
            hasHome &&
            hasDraw
          );
        }

        if (
          type === "away"
        ) {
          return (
            hasAway &&
            hasDraw
          );
        }

        return false;
      }
    );

  return makeBetclicSelection(
    outcome,
    "double_chance"
  );
}

function getCandidateMarketName(
  candidate
) {
  return String(
    candidate?.market ||
    candidate?.name ||
    candidate?.label ||
    candidate?.title ||
    candidate?.selection ||
    ""
  )
    .toUpperCase()
    .trim();
}

function getBetclicOddForCandidate(
  candidate,
  match,
  event
) {
  const bookmaker =
    getBetclicBookmaker(
      event
    );

  if (!bookmaker) {
    return null;
  }

  const market =
    getCandidateMarketName(
      candidate
    );

  if (
    market.includes(
      "OVER 1.5"
    )
  ) {
    return getTotalsBetclicOdd(
      bookmaker,
      "Over",
      1.5
    );
  }

  if (
    market.includes(
      "UNDER 3.5"
    )
  ) {
    return getTotalsBetclicOdd(
      bookmaker,
      "Under",
      3.5
    );
  }

  if (
    market.includes(
      "OVER 2.5"
    )
  ) {
    return getTotalsBetclicOdd(
      bookmaker,
      "Over",
      2.5
    );
  }

  if (
    market.includes("BTTS") ||
    market.includes("AMBAS") ||
    market.includes("BOTH TEAMS")
  ) {
    return getBttsBetclicOdd(
      bookmaker
    );
  }

  if (
    market.includes(
      "CASA OU EMPATE"
    ) ||
    market === "1X"
  ) {
    return getDoubleChanceBetclicOdd(
      bookmaker,
      match,
      "home"
    );
  }

  if (
    market.includes(
      "FORA OU EMPATE"
    ) ||
    market === "X2"
  ) {
    return getDoubleChanceBetclicOdd(
      bookmaker,
      match,
      "away"
    );
  }

  if (
    market.includes(
      "VITÓRIA CASA"
    ) ||
    market.includes(
      "VITORIA CASA"
    ) ||
    market === "CASA" ||
    market === "1"
  ) {
    return getH2HBetclicOdd(
      bookmaker,
      match,
      "home"
    );
  }

  if (
    market === "EMPATE" ||
    market === "DRAW" ||
    market === "X"
  ) {
    return getH2HBetclicOdd(
      bookmaker,
      match,
      "draw"
    );
  }

  if (
    market.includes(
      "VITÓRIA FORA"
    ) ||
    market.includes(
      "VITORIA FORA"
    ) ||
    market === "FORA" ||
    market === "2"
  ) {
    return getH2HBetclicOdd(
      bookmaker,
      match,
      "away"
    );
  }

  return null;
}

function attachBetclicOdds(
  candidates,
  match,
  event
) {
  if (
    !Array.isArray(candidates)
  ) {
    return [];
  }

  return candidates.map(
    (candidate) => {
      const betclic =
        getBetclicOddForCandidate(
          candidate,
          match,
          event
        );

      const probability =
        Number(
          candidate.probability ||
          0
        );

      const fairOdd =
        probability > 0
          ? 1 / probability
          : null;

      if (
        !betclic ||
        !Number.isFinite(
          betclic.odd
        ) ||
        betclic.odd <= 1
      ) {
        return {
          ...candidate,

          betclic:
            null,

          fairOdd:
            fairOdd !== null
              ? Number(
                  fairOdd.toFixed(2)
                )
              : null,

          value:
            null
        };
      }

      const value =
        probability > 0
          ? (
              probability *
              betclic.odd
            ) - 1
          : null;

      return {
        ...candidate,

        betclic: {
          bookmaker:
            BETCLIC_BOOKMAKER,

          odd:
            Number(
              betclic.odd.toFixed(2)
            ),

          selection:
            betclic.selection,

          point:
            betclic.point,

          market:
            betclic.market
        },

        fairOdd:
          fairOdd !== null
            ? Number(
                fairOdd.toFixed(2)
              )
            : null,

        value:
          value !== null
            ? Number(
                (
                  value * 100
                ).toFixed(2)
              )
            : null
      };
    }
  );
}

function getBetclicEventInfo(
  event
) {
  if (!event) {
    return {
      available:
        false,

      bookmaker:
        "Betclic PT",

      eventId:
        null,

      commenceTime:
        null,

      link:
        null,

      appLink:
        null
    };
  }

  const bookmaker =
    getBetclicBookmaker(
      event
    );

  return {
    available:
      Boolean(bookmaker),

    bookmaker:
      bookmaker?.title ||
      "Betclic PT",

    eventId:
      event.id ||
      null,

    commenceTime:
      event.commence_time ||
      null,

    link:
      bookmaker?.link ||
      null,

    appLink:
      bookmaker?.app_link ||
      null
  };
}



function cacheGet(
  key
) {

  const item =
    cache.get(
      key
    );

  if (!item) {
    return null;
  }

  if (
    Date.now() >=
    item.expiresAt
  ) {

    cache.delete(
      key
    );

    return null;

  }

  return item.value;

}


function cacheSet(
  key,
  value,
  ttl = 60_000
) {

  cache.set(
    key,
    {
      value,
      expiresAt:
        Date.now() + ttl
    }
  );

  return value;

}


// -----------------------------------------------------------------------------
// RATE LIMIT
// -----------------------------------------------------------------------------

const requestTimes =
  [];


function sleep(
  ms
) {

  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );

}


async function waitForRateLimit() {

  while (true) {

    const now =
      Date.now();

    while (
      requestTimes.length &&
      now -
        requestTimes[0] >=
        RATE_WINDOW
    ) {

      requestTimes.shift();

    }

    if (
      requestTimes.length <
      MAX_REQUESTS_PER_MINUTE
    ) {

      requestTimes.push(
        Date.now()
      );

      return;

    }

    const wait =
      RATE_WINDOW -
      (
        now -
        requestTimes[0]
      ) +
      300;

    console.log(
      `Limite local atingido. Aguardando ${Math.ceil(
        wait / 1000
      )}s...`
    );

    await sleep(
      wait
    );

  }

}


// -----------------------------------------------------------------------------
// UTILITÁRIOS
// -----------------------------------------------------------------------------

function clampInt(
  value,
  min,
  max
) {

  const n =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isFinite(n)
  ) {

    return min;

  }

  return Math.max(
    min,
    Math.min(
      max,
      n
    )
  );

}


function clampProbability(
  value
) {

  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {

    return 0;

  }

  return Math.max(
    0,
    Math.min(
      1,
      n
    )
  );

}


function round(
  value,
  decimals = 1
) {

  const factor =
    10 ** decimals;

  return (
    Math.round(
      value * factor
    ) /
    factor
  );

}


function percentage(
  value
) {

  return round(
    clampProbability(value) * 100,
    1
  );

}


function average(
  values
) {

  const valid =
    values.filter(
      (value) =>
        Number.isFinite(
          value
        )
    );

  if (!valid.length) {
    return 0;
  }

  return (
    valid.reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    ) /
    valid.length
  );

}


function safeNumber(
  value,
  fallback = 0
) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;

}


// -----------------------------------------------------------------------------
// MÉDIA PONDERADA GENÉRICA
// -----------------------------------------------------------------------------

function sampleWeightedAverage(
  observed,
  prior,
  sampleSize,
  priorWeight
) {

  const value =
    safeNumber(
      observed,
      NaN
    );

  const priorValue =
    safeNumber(
      prior,
      NaN
    );

  const n =
    Math.max(
      0,
      safeNumber(
        sampleSize,
        0
      )
    );

  const pw =
    Math.max(
      0,
      safeNumber(
        priorWeight,
        0
      )
    );


  if (
    !Number.isFinite(value) &&
    !Number.isFinite(priorValue)
  ) {

    return 0;

  }


  if (
    !Number.isFinite(value)
  ) {

    return priorValue;

  }


  if (
    !Number.isFinite(priorValue) ||
    n <= 0
  ) {

    return value;

  }


  return (
    value * n +
    priorValue * pw
  ) /
  (
    n + pw
  );

}


// -----------------------------------------------------------------------------
// CORREÇÃO DE AMOSTRA PEQUENA
// -----------------------------------------------------------------------------

function shrinkToCompetition(
  observed,
  competitionAverage,
  sampleSize
) {

  return sampleWeightedAverage(
    observed,
    competitionAverage,
    sampleSize,
    COMPETITION_PRIOR
  );

}


// -----------------------------------------------------------------------------
// FORÇA RELATIVA
// -----------------------------------------------------------------------------

function relativeStrength(
  value,
  competitionAverage
) {

  const observed =
    safeNumber(
      value,
      0
    );

  const averageValue =
    safeNumber(
      competitionAverage,
      0
    );

  if (
    averageValue <= 0
  ) {

    return 1;

  }

  return (
    observed /
    averageValue
  );

}


// -----------------------------------------------------------------------------
// LIMITAR FORÇA EXTREMA
// -----------------------------------------------------------------------------

function clampStrength(
  value
) {

  return Math.max(
    0.35,
    Math.min(
      2.50,
      safeNumber(
        value,
        1
      )
    )
  );

}


// -----------------------------------------------------------------------------
// DATAS
// -----------------------------------------------------------------------------

function formatDate(
  date
) {

  const year =
    date.getUTCFullYear();

  const month =
    String(
      date.getUTCMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getUTCDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;

}


function addDays(
  dateString,
  amount
) {

  const date =
    new Date(
      `${dateString}T00:00:00Z`
    );

  date.setUTCDate(
    date.getUTCDate() +
    amount
  );

  return formatDate(
    date
  );

}


function today() {

  return formatDate(
    new Date()
  );

}


function normalizeDate(
  value
) {

  if (!value) {
    return today();
  }

  const text =
    String(value);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  ) {

    throw new Error(
      "Data inválida. Use YYYY-MM-DD."
    );

  }

  return text;

}


// -----------------------------------------------------------------------------
// FOOTBALL-DATA.ORG
// -----------------------------------------------------------------------------

async function footballData(
  endpoint,
  options = {}
) {

  if (!API_TOKEN) {

    throw new Error(
      "FOOTBALL_DATA_TOKEN não está configurado no .env."
    );

  }

  const ttl =
    options.ttl ??
    60_000;

  const key =
    endpoint;


  if (
    !options.skipCache
  ) {

    const cached =
      cacheGet(
        key
      );

    if (
      cached !== null
    ) {

      return cached;

    }

  }


  if (
    pendingRequests.has(
      key
    )
  ) {

    return pendingRequests.get(
      key
    );

  }


  const request =
    (async () => {

      await waitForRateLimit();

      const url =
        `${API_URL}${endpoint}`;

      console.log(
        `football-data.org -> ${endpoint}`
      );


      const response =
        await fetch(
          url,
          {
            headers: {

              "X-Auth-Token":
                API_TOKEN,

              Accept:
                "application/json"

            }
          }
        );


      const text =
        await response.text();


      let data =
        null;


      try {

        data =
          text
            ? JSON.parse(
                text
              )
            : null;

      } catch {

        data = {
          raw: text
        };

      }


      if (
        !response.ok
      ) {

        const detail =
          data?.message ||
          data?.error ||
          data?.detail ||
          data?.raw ||
          "Sem detalhes.";


        if (
          response.status ===
          401
        ) {

          throw new Error(
            "HTTP 401: token do football-data.org inválido ou não autorizado."
          );

        }


        if (
          response.status ===
          403
        ) {

          throw new Error(
            `HTTP 403: acesso recusado pelo football-data.org. ${detail}`
          );

        }


        if (
          response.status ===
          429
        ) {

          throw new Error(
            "HTTP 429: limite de chamadas do football-data.org atingido."
          );

        }


        throw new Error(
          `football-data.org HTTP ${response.status}: ${detail}`
        );

      }


      if (
        !options.skipCache
      ) {

        cacheSet(
          key,
          data,
          ttl
        );

      }


      return data;

    })();


  pendingRequests.set(
    key,
    request
  );


  try {

    return await request;

  } finally {

    pendingRequests.delete(
      key
    );

  }

}


// -----------------------------------------------------------------------------
// CLASSIFICAÇÃO DA COMPETIÇÃO
// -----------------------------------------------------------------------------
//
// Obtém a tabela TOTAL da competição.
//
// A resposta fica em cache durante 5 minutos.
// Isto é importante porque /api/bets/daily pode analisar vários jogos
// da mesma competição.
// -----------------------------------------------------------------------------

async function getCompetitionStandings(
  competitionCode
) {

  if (
    !ALLOWED_COMPETITIONS.has(
      competitionCode
    )
  ) {

    throw new Error(
      `Competição não suportada: ${competitionCode}`
    );

  }


  const params =
    new URLSearchParams({

      season:
        String(
          CURRENT_SEASON
        )

    });


  const data =
    await footballData(
      `/competitions/${competitionCode}/standings?${params.toString()}`,
      {
        ttl:
          5 * 60_000
      }
    );


  const standings =
    Array.isArray(
      data?.standings
    )
      ? data.standings
      : [];


  // Preferimos explicitamente a tabela TOTAL.
  // Isto evita apanhar uma tabela de casa/fora quando a API devolve
  // várias classificações.
  const totalTable =
    standings.find(
      (table) =>
        String(
          table?.type || ""
        ).toUpperCase() ===
        "TOTAL"
    ) ||
    standings.find(
      (table) =>
        Array.isArray(
          table?.table
        )
    );


  if (
    !totalTable ||
    !Array.isArray(
      totalTable.table
    )
  ) {

    console.warn(
      `⚠️ Não foi encontrada classificação TOTAL para ${competitionCode}.`
    );

    return [];

  }


  return totalTable.table
    .map(
      (entry) => {

        const team =
          entry?.team || {};

        const goalsFor =
          safeNumber(
            entry.goalsFor,
            0
          );

        const goalsAgainst =
          safeNumber(
            entry.goalsAgainst,
            0
          );

        const goalDifference =
          safeNumber(
            entry.goalDifference,
            goalsFor -
              goalsAgainst
          );


        return {

          position:
            safeNumber(
              entry.position,
              null
            ),

          teamId:
            safeNumber(
              team.id,
              null
            ),

          teamName:
            team.name ||
            null,

          shortName:
            team.shortName ||
            team.tla ||
            team.name ||
            null,

          crest:
            team.crest ||
            null,

          playedGames:
            safeNumber(
              entry.playedGames,
              0
            ),

          form:
            entry.form ||
            null,

          won:
            safeNumber(
              entry.won,
              0
            ),

          draw:
            safeNumber(
              entry.draw,
              0
            ),

          lost:
            safeNumber(
              entry.lost,
              0
            ),

          points:
            safeNumber(
              entry.points,
              0
            ),

          goalsFor,

          goalsAgainst,

          goalDifference

        };

      }
    )
    .filter(
      (entry) =>
        Number.isFinite(
          entry.teamId
        )
    );

}


// -----------------------------------------------------------------------------
// MAPA DA CLASSIFICAÇÃO
// -----------------------------------------------------------------------------

function buildStandingsMap(
  standings
) {

  const map =
    new Map();


  for (
    const standing
    of standings || []
  ) {

    if (
      standing?.teamId == null
    ) {

      continue;

    }


    map.set(
      Number(
        standing.teamId
      ),
      standing
    );

  }


  return map;

}


// -----------------------------------------------------------------------------
// OBTÉM CLASSIFICAÇÃO DAS DUAS EQUIPAS
// -----------------------------------------------------------------------------

async function getFixtureStandings(
  competitionCode,
  homeTeamId,
  awayTeamId
) {

  try {

    const standings =
      await getCompetitionStandings(
        competitionCode
      );


    const standingsMap =
      buildStandingsMap(
        standings
      );


    const homeStanding =
      standingsMap.get(
        Number(
          homeTeamId
        )
      ) ||
      null;


    const awayStanding =
      standingsMap.get(
        Number(
          awayTeamId
        )
      ) ||
      null;


    return {

      home:
        homeStanding,

      away:
        awayStanding,

      table:
        standings

    };

  } catch (error) {

    console.error(
      `⚠️ Erro ao obter classificação ${competitionCode}:`,
      error.message
    );


    return {

      home:
        null,

      away:
        null,

      table:
        []

    };

  }

}


// -----------------------------------------------------------------------------
// ADICIONAR CLASSIFICAÇÃO À EQUIPA
// -----------------------------------------------------------------------------

function addStandingToTeam(
  team,
  standing
) {

  const safeTeam =
    team || {};


  if (!standing) {

    return {

      ...safeTeam,

      leaguePosition:
        null,

      leaguePoints:
        null,

      leaguePlayed:
        null,

      leagueWins:
        null,

      leagueDraws:
        null,

      leagueLosses:
        null,

      leagueGoalsFor:
        null,

      leagueGoalsAgainst:
        null,

      leagueGoalDifference:
        null

    };

  }


  return {

    ...safeTeam,

    leaguePosition:
      standing.position,

    leaguePoints:
      standing.points,

    leaguePlayed:
      standing.playedGames,

    leagueWins:
      standing.won,

    leagueDraws:
      standing.draw,

    leagueLosses:
      standing.lost,

    leagueGoalsFor:
      standing.goalsFor,

    leagueGoalsAgainst:
      standing.goalsAgainst,

    leagueGoalDifference:
      standing.goalDifference

  };

}


// -----------------------------------------------------------------------------
// NORMALIZAR JOGO
// -----------------------------------------------------------------------------

function normalizeMatch(
  match
) {

  const code =
    match
      ?.competition
      ?.code ||
    null;

  const competition =
    COMPETITIONS[
      code
    ];


  return {

    id:
      match.id,

    utcDate:
      match.utcDate ||
      null,

    date:
      match.utcDate
        ? match.utcDate.slice(
            0,
            10
          )
        : null,

    time:
      match.utcDate
        ? match.utcDate.slice(
            11,
            16
          )
        : null,

    status:
      match.status ||
      null,

    competition: {

      id:
        match
          .competition
          ?.id ??
        null,

      code,

      name:
        competition?.name ||
        match
          .competition
          ?.name ||
        "Competição",

      country:
        competition?.country ||
        match.area?.name ||
        ""

    },

    homeTeam: {

      id:
        match
          .homeTeam
          ?.id ??
        null,

      name:
        match
          .homeTeam
          ?.name ||
        "Casa",

      shortName:
        match
          .homeTeam
          ?.shortName ||
        match
          .homeTeam
          ?.name ||
        "Casa",

      crest:
        match
          .homeTeam
          ?.crest ||
        null

    },

    awayTeam: {

      id:
        match
          .awayTeam
          ?.id ??
        null,

      name:
        match
          .awayTeam
          ?.name ||
        "Fora",

      shortName:
        match
          .awayTeam
          ?.shortName ||
        match
          .awayTeam
          ?.name ||
        "Fora",

      crest:
        match
          .awayTeam
          ?.crest ||
        null

    },

    score: {

      home:
        match
          .score
          ?.fullTime
          ?.home ??
        null,

      away:
        match
          .score
          ?.fullTime
          ?.away ??
        null

    },

    venue:
      match.venue ||
      null

  };

}


// -----------------------------------------------------------------------------
// JOGOS DA DATA
// -----------------------------------------------------------------------------

async function getMatchesForDate(
  date
) {

  const cleanDate =
    normalizeDate(
      date
    );


  const competitions = [
    "PL",
    "PPL",
    "BL1",
    "SA",
    "PD",
    "FL1",
    "DED",
    "CL",
    "BSA"
  ];


  const allMatches =
    [];


  for (
    const competition
    of competitions
  ) {

    try {

      const params =
        new URLSearchParams({

          dateFrom:
            cleanDate,

          dateTo:
            cleanDate

        });


      const data =
        await footballData(
          `/competitions/${competition}/matches?${params.toString()}`,
          {
            ttl: 0,
            skipCache: true
          }
        );


      const matches =
        Array.isArray(
          data?.matches
        )
          ? data.matches
          : [];


      console.log(
        `${cleanDate} | ${competition} | ${matches.length} jogos`
      );


      for (
        const match
        of matches
      ) {

        allMatches.push(
          {

            ...match,

            competition: {

              ...match.competition,

              code:
                match
                  .competition
                  ?.code ||
                competition,

              name:
                match
                  .competition
                  ?.name ||
                COMPETITIONS[
                  competition
                ]?.name ||
                competition

            }

          }
        );

      }

    } catch (error) {

      console.error(
        `${cleanDate} | ${competition} | ERRO: ${error.message}`
      );

    }

  }


  const unique =
    new Map();


  for (
    const match
    of allMatches
  ) {

    if (
      match.id != null
    ) {

      unique.set(
        match.id,
        match
      );

    }

  }


  return [
    ...unique.values()
  ].sort(
    (a, b) => {

      const competitionA =
        COMPETITIONS[
          a.competition?.code
        ];

      const competitionB =
        COMPETITIONS[
          b.competition?.code
        ];


      const leagueA =
        competitionA?.name ||
        a.competition?.name ||
        "";


      const leagueB =
        competitionB?.name ||
        b.competition?.name ||
        "";


      const leagueCompare =
        leagueA.localeCompare(
          leagueB,
          "pt-PT",
          {
            sensitivity:
              "base"
          }
        );


      if (
        leagueCompare !== 0
      ) {

        return leagueCompare;

      }


      const timeA =
        a.utcDate
          ? new Date(
              a.utcDate
            ).getTime()
          : Number.MAX_SAFE_INTEGER;


      const timeB =
        b.utcDate
          ? new Date(
              b.utcDate
            ).getTime()
          : Number.MAX_SAFE_INTEGER;


      return (
        timeA -
        timeB
      );

    }
  );

}


// -----------------------------------------------------------------------------
// HISTÓRICO COMPLETO DA ÉPOCA
// -----------------------------------------------------------------------------

async function getCompetitionHistory(
  competitionCode,
  dateTo
) {

  if (
    !ALLOWED_COMPETITIONS.has(
      competitionCode
    )
  ) {

    throw new Error(
      `Competição não suportada: ${competitionCode}`
    );

  }


  const endDate =
    normalizeDate(
      dateTo ||
      today()
    );


  const params =
    new URLSearchParams({

      season:
        String(
          CURRENT_SEASON
        ),

      status:
        "FINISHED"

    });


  const data =
    await footballData(
      `/competitions/${competitionCode}/matches?${params.toString()}`,
      {
        ttl:
          5 * 60_000
      }
    );


  const matches =
    Array.isArray(
      data?.matches
    )
      ? data.matches
      : [];


  return matches

    .filter(
      (match) =>
        match.status ===
          "FINISHED" &&

        match.homeTeam?.id &&

        match.awayTeam?.id
    )

    .filter(
      (match) => {

        if (
          !match.utcDate
        ) {

          return false;

        }


        const matchDate =
          normalizeDate(
            match.utcDate.slice(
              0,
              10
            )
          );


        return (
          matchDate <=
          endDate
        );

      }
    )

    .map(
      normalizeMatch
    )

    .sort(
      (
        a,
        b
      ) =>
        new Date(
          b.utcDate
        ).getTime() -
        new Date(
          a.utcDate
        ).getTime()
    );

}


// -----------------------------------------------------------------------------
// TODOS OS JOGOS DA EQUIPA NA ÉPOCA
// -----------------------------------------------------------------------------

async function getSeasonFixtures(
  teamId,
  competitionCode,
  dateTo
) {

  const history =
    await getCompetitionHistory(
      competitionCode,
      dateTo
    );


  const targetId =
    Number(
      teamId
    );


  return history.filter(
    (match) => {

      const homeId =
        Number(
          match.homeTeam?.id
        );

      const awayId =
        Number(
          match.awayTeam?.id
        );


      return (
        homeId === targetId ||
        awayId === targetId
      );

    }
  );

}


// -----------------------------------------------------------------------------
// RESULTADO DA EQUIPA
// -----------------------------------------------------------------------------

function teamResult(
  match,
  teamId
) {

  const home =
    safeNumber(
      match.score?.home,
      NaN
    );

  const away =
    safeNumber(
      match.score?.away,
      NaN
    );


  if (
    !Number.isFinite(home) ||
    !Number.isFinite(away)
  ) {

    return null;

  }


  const targetId =
    Number(
      teamId
    );


  const isHome =
    Number(
      match.homeTeam?.id
    ) === targetId;


  const isAway =
    Number(
      match.awayTeam?.id
    ) === targetId;


  if (
    !isHome &&
    !isAway
  ) {

    return null;

  }


  const goalsFor =
    isHome
      ? home
      : away;


  const goalsAgainst =
    isHome
      ? away
      : home;


  let result =
    "D";


  if (
    goalsFor >
    goalsAgainst
  ) {

    result =
      "W";

  } else if (
    goalsFor <
    goalsAgainst
  ) {

    result =
      "L";

  }


  return {

    result,

    goalsFor,

    goalsAgainst,

    isHome

  };

}


// -----------------------------------------------------------------------------
// ANALISAR EQUIPA
// -----------------------------------------------------------------------------

function analyzeTeam(
  matches,
  teamId
) {

  const stats = {

    games: 0,

    wins: 0,

    draws: 0,

    losses: 0,

    goalsFor: 0,

    goalsAgainst: 0,

    over15: 0,

    over25: 0,

    over35: 0,

    under35: 0,

    bttsYes: 0,

    bttsNo: 0,

    cleanSheets: 0,

    failedToScore: 0,

    homeGames: 0,

    awayGames: 0,

    homeWins: 0,

    awayWins: 0,

    form: []

  };


  for (
    const match
    of matches || []
  ) {

    const result =
      teamResult(
        match,
        teamId
      );


    if (!result) {
      continue;
    }


    stats.games++;


    const {
      result: outcome,
      goalsFor,
      goalsAgainst,
      isHome
    } = result;


    stats.goalsFor +=
      goalsFor;


    stats.goalsAgainst +=
      goalsAgainst;


    if (
      outcome === "W"
    ) {

      stats.wins++;

    } else if (
      outcome === "D"
    ) {

      stats.draws++;

    } else {

      stats.losses++;

    }


    const total =
      goalsFor +
      goalsAgainst;


    if (
      total >= 2
    ) {

      stats.over15++;

    }


    if (
      total >= 3
    ) {

      stats.over25++;

    }


    if (
      total >= 4
    ) {

      stats.over35++;

    }


    if (
      total <= 3
    ) {

      stats.under35++;

    }


    if (
      goalsFor > 0 &&
      goalsAgainst > 0
    ) {

      stats.bttsYes++;

    } else {

      stats.bttsNo++;

    }


    if (
      goalsAgainst === 0
    ) {

      stats.cleanSheets++;

    }


    if (
      goalsFor === 0
    ) {

      stats.failedToScore++;

    }


    if (
      isHome
    ) {

      stats.homeGames++;

      if (
        outcome === "W"
      ) {

        stats.homeWins++;

      }

    } else {

      stats.awayGames++;

      if (
        outcome === "W"
      ) {

        stats.awayWins++;

      }

    }


    stats.form.push({

      date:
        match.date,

      opponent:
        isHome
          ? match.awayTeam.name
          : match.homeTeam.name,

      venue:
        isHome
          ? "Casa"
          : "Fora",

      result:
        outcome,

      score:
        `${goalsFor}-${goalsAgainst}`

    });

  }


  const games =
    stats.games ||
    1;


  return {

    games:
      stats.games,

    wins:
      stats.wins,

    draws:
      stats.draws,

    losses:
      stats.losses,

    goalsFor:
      stats.goalsFor,

    goalsAgainst:
      stats.goalsAgainst,

    avgGoalsFor:
      round(
        stats.goalsFor /
          games,
        2
      ),

    avgGoalsAgainst:
      round(
        stats.goalsAgainst /
          games,
        2
      ),

    avgTotalGoals:
      round(
        (
          stats.goalsFor +
          stats.goalsAgainst
        ) /
          games,
        2
      ),

    winRate:
      stats.wins /
      games,

    drawRate:
      stats.draws /
      games,

    lossRate:
      stats.losses /
      games,

    over15Rate:
      stats.over15 /
      games,

    over25Rate:
      stats.over25 /
      games,

    over35Rate:
      stats.over35 /
      games,

    under35Rate:
      stats.under35 /
      games,

    bttsYesRate:
      stats.bttsYes /
      games,

    bttsNoRate:
      stats.bttsNo /
      games,

    cleanSheetRate:
      stats.cleanSheets /
      games,

    failedToScoreRate:
      stats.failedToScore /
      games,

    homeWinRate:
      stats.homeGames
        ? stats.homeWins /
          stats.homeGames
        : 0,

    awayWinRate:
      stats.awayGames
        ? stats.awayWins /
          stats.awayGames
        : 0,

    form:
      stats.form

  };

}


// -----------------------------------------------------------------------------
// ANÁLISE DA COMPETIÇÃO
// -----------------------------------------------------------------------------

function analyzeCompetition(
  matches
) {

  const stats = {

    games: 0,

    homeGoals: 0,

    awayGoals: 0,

    totalGoals: 0

  };


  for (
    const match
    of matches || []
  ) {

    const homeGoals =
      safeNumber(
        match.score?.home,
        NaN
      );


    const awayGoals =
      safeNumber(
        match.score?.away,
        NaN
      );


    if (
      !Number.isFinite(homeGoals) ||
      !Number.isFinite(awayGoals)
    ) {

      continue;

    }


    stats.games++;

    stats.homeGoals +=
      homeGoals;

    stats.awayGoals +=
      awayGoals;

    stats.totalGoals +=
      homeGoals +
      awayGoals;

  }


  if (
    stats.games === 0
  ) {

    return {

      games:
        0,

      homeGoalsAvg:
        1.35,

      awayGoalsAvg:
        1.15,

      goalsPerTeamAvg:
        1.25,

      totalGoalsAvg:
        2.50,

      homeAdvantage:
        1.17,

      homeAdvantagePercent:
        17

    };

  }


  const homeGoalsAvg =
    stats.homeGoals /
    stats.games;


  const awayGoalsAvg =
    stats.awayGoals /
    stats.games;


  const totalGoalsAvg =
    stats.totalGoals /
    stats.games;


  const goalsPerTeamAvg =
    totalGoalsAvg /
    2;


  const homeAdvantage =
    awayGoalsAvg > 0
      ? Math.sqrt(
          homeGoalsAvg /
          awayGoalsAvg
        )
      : 1;


  const safeHomeAdvantage =
    Math.max(
      1,
      Math.min(
        1.50,
        homeAdvantage
      )
    );


  return {

    games:
      stats.games,

    homeGoalsAvg:
      round(
        homeGoalsAvg,
        3
      ),

    awayGoalsAvg:
      round(
        awayGoalsAvg,
        3
      ),

    goalsPerTeamAvg:
      round(
        goalsPerTeamAvg,
        3
      ),

    totalGoalsAvg:
      round(
        totalGoalsAvg,
        3
      ),

    homeAdvantage:
      round(
        safeHomeAdvantage,
        3
      ),

    homeAdvantagePercent:
      round(
        (
          safeHomeAdvantage - 1
        ) * 100,
        1
      )

  };

}


// -----------------------------------------------------------------------------
// POISSON
// -----------------------------------------------------------------------------

function poissonProbability(
  goals,
  lambda
) {

  if (
    !Number.isFinite(lambda) ||
    lambda < 0 ||
    goals < 0
  ) {

    return 0;

  }


  if (
    lambda === 0
  ) {

    return goals === 0
      ? 1
      : 0;

  }


  let probability =
    Math.exp(
      -lambda
    );


  for (
    let i = 1;
    i <= goals;
    i++
  ) {

    probability *=
      lambda / i;

  }


  return probability;

}


// -----------------------------------------------------------------------------
// DIXON-COLES
// -----------------------------------------------------------------------------

function dixonColesTau(
  homeGoals,
  awayGoals,
  homeLambda,
  awayLambda,
  rho = DIXON_COLES_RHO
) {

  if (
    homeGoals === 0 &&
    awayGoals === 0
  ) {

    return (
      1 -
      (
        homeLambda *
        awayLambda *
        rho
      )
    );

  }


  if (
    homeGoals === 0 &&
    awayGoals === 1
  ) {

    return (
      1 +
      (
        homeLambda *
        rho
      )
    );

  }


  if (
    homeGoals === 1 &&
    awayGoals === 0
  ) {

    return (
      1 +
      (
        awayLambda *
        rho
      )
    );

  }


  if (
    homeGoals === 1 &&
    awayGoals === 1
  ) {

    return (
      1 -
      rho
    );

  }


  return 1;

}


// -----------------------------------------------------------------------------
// MATRIZ POISSON + DIXON-COLES
// -----------------------------------------------------------------------------

function buildScoreMatrix(
  homeLambda,
  awayLambda,
  maxGoals = MAX_POISSON_GOALS,
  rho = DIXON_COLES_RHO
) {

  const matrix = [];

  let totalProbability =
    0;


  for (
    let homeGoals = 0;
    homeGoals <= maxGoals;
    homeGoals++
  ) {

    const row = [];


    const homeProbability =
      poissonProbability(
        homeGoals,
        homeLambda
      );


    for (
      let awayGoals = 0;
      awayGoals <= maxGoals;
      awayGoals++
    ) {

      const awayProbability =
        poissonProbability(
          awayGoals,
          awayLambda
        );


      const independentProbability =
        homeProbability *
        awayProbability;


      const correction =
        dixonColesTau(
          homeGoals,
          awayGoals,
          homeLambda,
          awayLambda,
          rho
        );


      const probability =
        Math.max(
          0,
          independentProbability *
          correction
        );


      row.push(
        probability
      );


      totalProbability +=
        probability;

    }


    matrix.push(
      row
    );

  }


  if (
    totalProbability > 0
  ) {

    for (
      let homeGoals = 0;
      homeGoals < matrix.length;
      homeGoals++
    ) {

      for (
        let awayGoals = 0;
        awayGoals <
        matrix[homeGoals].length;
        awayGoals++
      ) {

        matrix[homeGoals][awayGoals] /=
          totalProbability;

      }

    }

  }


  return matrix;

}


// -----------------------------------------------------------------------------
// CALCULAR PROBABILIDADES
// -----------------------------------------------------------------------------

function calculateProbabilities(
  homeVenue,
  awayVenue,
  homeGeneral = {},
  awayGeneral = {},
  competition = {}
) {

  const safeHomeVenue =
    homeVenue || {};

  const safeAwayVenue =
    awayVenue || {};

  const safeHomeGeneral =
    homeGeneral || {};

  const safeAwayGeneral =
    awayGeneral || {};

  const safeCompetition =
    competition || {};


  const overallCompetitionAverage =
    safeNumber(
      safeCompetition.goalsPerTeamAvg,
      1.25
    );


  const competitionHomeAverage =
    safeNumber(
      safeCompetition.homeGoalsAvg,
      overallCompetitionAverage
    );


  const competitionAwayAverage =
    safeNumber(
      safeCompetition.awayGoalsAvg,
      overallCompetitionAverage
    );


  const homeAdvantage =
    safeNumber(
      safeCompetition.homeAdvantage,
      1
    );


  const homeVenueGames =
    safeNumber(
      safeHomeVenue.games,
      0
    );


  const awayVenueGames =
    safeNumber(
      safeAwayVenue.games,
      0
    );


  const homeGeneralGames =
    safeNumber(
      safeHomeGeneral.games,
      0
    );


  const awayGeneralGames =
    safeNumber(
      safeAwayGeneral.games,
      0
    );


  const homeAttackObserved =
    sampleWeightedAverage(
      safeHomeVenue.avgGoalsFor,
      safeHomeGeneral.avgGoalsFor,
      homeVenueGames,
      SMALL_SAMPLE_PRIOR
    );


  const homeAttackAdjusted =
    shrinkToCompetition(
      homeAttackObserved,
      competitionHomeAverage,
      homeGeneralGames
    );


  const awayAttackObserved =
    sampleWeightedAverage(
      safeAwayVenue.avgGoalsFor,
      safeAwayGeneral.avgGoalsFor,
      awayVenueGames,
      SMALL_SAMPLE_PRIOR
    );


  const awayAttackAdjusted =
    shrinkToCompetition(
      awayAttackObserved,
      competitionAwayAverage,
      awayGeneralGames
    );


  const homeDefenseObserved =
    sampleWeightedAverage(
      safeHomeVenue.avgGoalsAgainst,
      safeHomeGeneral.avgGoalsAgainst,
      homeVenueGames,
      SMALL_SAMPLE_PRIOR
    );


  const homeDefenseAdjusted =
    shrinkToCompetition(
      homeDefenseObserved,
      competitionAwayAverage,
      homeGeneralGames
    );


  const awayDefenseObserved =
    sampleWeightedAverage(
      safeAwayVenue.avgGoalsAgainst,
      safeAwayGeneral.avgGoalsAgainst,
      awayVenueGames,
      SMALL_SAMPLE_PRIOR
    );


  const awayDefenseAdjusted =
    shrinkToCompetition(
      awayDefenseObserved,
      competitionHomeAverage,
      awayGeneralGames
    );


  const homeAttackStrength =
    clampStrength(
      relativeStrength(
        homeAttackAdjusted,
        competitionHomeAverage
      )
    );


  const awayAttackStrength =
    clampStrength(
      relativeStrength(
        awayAttackAdjusted,
        competitionAwayAverage
      )
    );


  const homeDefenseStrength =
    clampStrength(
      relativeStrength(
        homeDefenseAdjusted,
        competitionAwayAverage
      )
    );


  const awayDefenseStrength =
    clampStrength(
      relativeStrength(
        awayDefenseAdjusted,
        competitionHomeAverage
      )
    );


  const neutralCompetitionAverage =
    overallCompetitionAverage;


  const homeAdvantageFactor =
    Math.sqrt(
      Math.max(
        0.01,
        homeAdvantage
      )
    );


  const awayAdvantageFactor =
    1 /
    homeAdvantageFactor;


  let expectedHomeGoals =
    neutralCompetitionAverage *
    homeAttackStrength *
    awayDefenseStrength *
    homeAdvantageFactor;


  let expectedAwayGoals =
    neutralCompetitionAverage *
    awayAttackStrength *
    homeDefenseStrength *
    awayAdvantageFactor;


  expectedHomeGoals =
    Math.max(
      MIN_EXPECTED_GOALS,
      Math.min(
        MAX_EXPECTED_GOALS,
        expectedHomeGoals
      )
    );


  expectedAwayGoals =
    Math.max(
      MIN_EXPECTED_GOALS,
      Math.min(
        MAX_EXPECTED_GOALS,
        expectedAwayGoals
      )
    );


  const matrix =
    buildScoreMatrix(
      expectedHomeGoals,
      expectedAwayGoals,
      MAX_POISSON_GOALS,
      DIXON_COLES_RHO
    );


  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let under35 = 0;

  let bttsYes = 0;


  for (
    let homeGoals = 0;
    homeGoals < matrix.length;
    homeGoals++
  ) {

    for (
      let awayGoals = 0;
      awayGoals <
      matrix[homeGoals].length;
      awayGoals++
    ) {

      const probability =
        matrix[homeGoals][awayGoals];


      if (
        homeGoals >
        awayGoals
      ) {

        homeWin +=
          probability;

      } else if (
        homeGoals ===
        awayGoals
      ) {

        draw +=
          probability;

      } else {

        awayWin +=
          probability;

      }


      const totalGoals =
        homeGoals +
        awayGoals;


      if (
        totalGoals >= 2
      ) {

        over15 +=
          probability;

      }


      if (
        totalGoals >= 3
      ) {

        over25 +=
          probability;

      }


      if (
        totalGoals >= 4
      ) {

        over35 +=
          probability;

      }


      if (
        totalGoals <= 3
      ) {

        under35 +=
          probability;

      }


      if (
        homeGoals > 0 &&
        awayGoals > 0
      ) {

        bttsYes +=
          probability;

      }

    }

  }


  const doubleChanceHome =
    homeWin +
    draw;


  const doubleChanceAway =
    awayWin +
    draw;


  const bttsNo =
    1 -
    bttsYes;


  const modelDetails = {

    competitionGames:
      safeNumber(
        safeCompetition.games,
        0
      ),

    competitionHomeGoalsAvg:
      round(
        competitionHomeAverage,
        3
      ),

    competitionAwayGoalsAvg:
      round(
        competitionAwayAverage,
        3
      ),

    competitionGoalsPerTeamAvg:
      round(
        overallCompetitionAverage,
        3
      ),

    competitionTotalGoalsAvg:
      round(
        safeNumber(
          safeCompetition.totalGoalsAvg,
          overallCompetitionAverage * 2
        ),
        3
      ),

    homeAdvantage:
      round(
        homeAdvantage,
        3
      ),

    homeAdvantagePercent:
      safeNumber(
        safeCompetition.homeAdvantagePercent,
        0
      ),

    samples: {

      homeVenue:
        homeVenueGames,

      awayVenue:
        awayVenueGames,

      homeGeneral:
        homeGeneralGames,

      awayGeneral:
        awayGeneralGames

    },

    strengths: {

      homeAttack:
        round(
          homeAttackStrength,
          3
        ),

      homeDefense:
        round(
          homeDefenseStrength,
          3
        ),

      awayAttack:
        round(
          awayAttackStrength,
          3
        ),

      awayDefense:
        round(
          awayDefenseStrength,
          3
        )

    },

    adjustedValues: {

      homeAttack:
        round(
          homeAttackAdjusted,
          3
        ),

      homeDefense:
        round(
          homeDefenseAdjusted,
          3
        ),

      awayAttack:
        round(
          awayAttackAdjusted,
          3
        ),

      awayDefense:
        round(
          awayDefenseAdjusted,
          3
        )

    },

    correction: {

      smallSamplePrior:
        SMALL_SAMPLE_PRIOR,

      competitionPrior:
        COMPETITION_PRIOR,

      dixonColesRho:
        DIXON_COLES_RHO

    },

    poisson: {

      maxGoals:
        MAX_POISSON_GOALS,

      homeLambda:
        round(
          expectedHomeGoals,
          3
        ),

      awayLambda:
        round(
          expectedAwayGoals,
          3
        )

    }

  };


  return {

    over15:
      clampProbability(
        over15
      ),

    over25:
      clampProbability(
        over25
      ),

    over35:
      clampProbability(
        over35
      ),

    under35:
      clampProbability(
        under35
      ),

    bttsYes:
      clampProbability(
        bttsYes
      ),

    bttsNo:
      clampProbability(
        bttsNo
      ),

    homeWin:
      clampProbability(
        homeWin
      ),

    draw:
      clampProbability(
        draw
      ),

    awayWin:
      clampProbability(
        awayWin
      ),

    doubleChanceHome:
      clampProbability(
        doubleChanceHome
      ),

    doubleChanceAway:
      clampProbability(
        doubleChanceAway
      ),

    expectedGoals: {

      home:
        round(
          expectedHomeGoals,
          2
        ),

      away:
        round(
          expectedAwayGoals,
          2
        ),

      total:
        round(
          expectedHomeGoals +
          expectedAwayGoals,
          2
        )

    },

    modelDetails

  };

}


// -----------------------------------------------------------------------------
// AVALIAR MERCADO
// -----------------------------------------------------------------------------

function evaluateMarket(
  market,
  homeGoals,
  awayGoals
) {

  const totalGoals =
    homeGoals +
    awayGoals;


  switch (
    market
  ) {

    case "OVER 1.5":

      return (
        totalGoals >= 2
      );


    case "UNDER 3.5":

      return (
        totalGoals <= 3
      );


    case "CASA OU EMPATE":

      return (
        homeGoals >= awayGoals
      );


    case "FORA OU EMPATE":

      return (
        awayGoals >= homeGoals
      );


    case "OVER 2.5":

      return (
        totalGoals >= 3
      );


    case "BTTS — SIM":

      return (
        homeGoals > 0 &&
        awayGoals > 0
      );


    case "VITÓRIA CASA":

      return (
        homeGoals >
        awayGoals
      );


    case "EMPATE":

      return (
        homeGoals ===
        awayGoals
      );


    case "VITÓRIA FORA":

      return (
        awayGoals >
        homeGoals
      );


    default:

      return null;

  }

}


// -----------------------------------------------------------------------------
// MERCADOS
// -----------------------------------------------------------------------------

function buildCandidates(
  p,
  match = null
) {

  const candidates = [

    {
      market:
        "OVER 1.5",

      probability:
        p.over15,

      risk:
        "Baixo"
    },

    {
      market:
        "UNDER 3.5",

      probability:
        p.under35,

      risk:
        "Baixo"
    },

    {
      market:
        "FORA OU EMPATE",

      probability:
        p.doubleChanceAway,

      risk:
        "Baixo"
    },

    {
      market:
        "CASA OU EMPATE",

      probability:
        p.doubleChanceHome,

      risk:
        "Baixo"
    },

    {
      market:
        "OVER 2.5",

      probability:
        p.over25,

      risk:
        "Médio"
    },

    {
      market:
        "BTTS — SIM",

      probability:
        p.bttsYes,

      risk:
        "Médio"
    },

    {
      market:
        "VITÓRIA CASA",

      probability:
        p.homeWin,

      risk:
        "Alto"
    },

    {
      market:
        "EMPATE",

      probability:
        p.draw,

      risk:
        "Alto"
    },

    {
      market:
        "VITÓRIA FORA",

      probability:
        p.awayWin,

      risk:
        "Alto"
    }

  ];


  const isFinished =
    match?.status ===
    "FINISHED";


  const homeGoals =
    Number(
      match?.score?.home
    );


  const awayGoals =
    Number(
      match?.score?.away
    );


  const hasValidScore =
    Number.isFinite(
      homeGoals
    ) &&
    Number.isFinite(
      awayGoals
    );


  if (
    isFinished &&
    hasValidScore
  ) {

    for (
      const candidate
      of candidates
    ) {

      const won =
        evaluateMarket(
          candidate.market,
          homeGoals,
          awayGoals
        );


      if (
        won === null
      ) {

        candidate.result =
          "UNKNOWN";

        candidate.color =
          "gray";

        candidate.label =
          "SEM AVALIAÇÃO";

        candidate.won =
          null;

      } else {

        candidate.result =
          won
            ? "WON"
            : "LOST";

        candidate.color =
          won
            ? "green"
            : "red";

        candidate.label =
          won
            ? "BATEU"
            : "NÃO BATEU";

        candidate.won =
          won;

      }

    }

  } else {

    for (
      const candidate
      of candidates
    ) {

      candidate.result =
        "PENDING";

      candidate.color =
        "gray";

      candidate.won =
        null;

      candidate.score =
        null;

    }

  }


  return candidates.sort(
    (
      a,
      b
    ) =>
      b.probability -
      a.probability
  );

}


// -----------------------------------------------------------------------------
// RECOMENDAÇÃO
// -----------------------------------------------------------------------------

function makeRecommendation(
  candidates
) {

  if (
    !candidates.length
  ) {

    return {

      market:
        "Sem recomendação",

      probability:
        0,

      confidence:
        "Insuficiente",

      reason:
        "Não existem dados suficientes.",

      result:
        "PENDING",

      color:
        "gray",

      won:
        null,

      score:
        null

    };

  }


  const preferredMarkets =
    new Set([

      "OVER 1.5",

      "UNDER 3.5",

      "CASA OU EMPATE",

      "FORA OU EMPATE",

      "OVER 2.5",

      "BTTS — SIM"

    ]);


  const preferred =
    candidates.filter(
      (candidate) =>
        preferredMarkets.has(
          candidate.market
        )
    );


  const pool =
    preferred.length
      ? preferred
      : candidates;


  const sorted =
    pool
      .slice()
      .sort(
        (a, b) =>
          b.probability -
          a.probability
      );


  const best =
    sorted[0];


  let confidence =
    "Baixa";


  if (
    best.probability >=
    0.82
  ) {

    confidence =
      "Alta";

  } else if (
    best.probability >=
    0.72
  ) {

    confidence =
      "Média";

  }


  let reason =
    `Estimativa de ${percentage(
      best.probability
    )}% calculada através de um modelo Poisson + Dixon-Coles. ` +
    `O xG combina força ofensiva, força defensiva adversária, ` +
    `média da competição, contexto casa/fora e correção de amostra pequena.`;


  if (
    best.market ===
    "OVER 1.5"
  ) {

    reason +=
      " A probabilidade é obtida diretamente da distribuição conjunta dos golos esperados.";

  }


  if (
    best.market ===
    "OVER 2.5"
  ) {

    reason +=
      " O Over 2.5 é derivado da mesma matriz que calcula 1X2 e BTTS.";

  }


  if (
    best.market ===
    "UNDER 3.5"
  ) {

    reason +=
      " O Under 3.5 é calculado pela mesma distribuição de resultados.";

  }


  if (
    best.market ===
    "FORA OU EMPATE"
  ) {

    reason +=
      " A dupla chance corresponde exatamente a vitória fora + empate.";

  }


  if (
    best.market ===
    "CASA OU EMPATE"
  ) {

    reason +=
      " A dupla chance corresponde exatamente a vitória casa + empate.";

  }


  if (
    best.betclic &&
    Number.isFinite(best.value)
  ) {

    reason +=
      ` A Betclic PT apresenta odd ${best.betclic.odd.toFixed(2)}; ` +
      `a odd justa do modelo é ${best.fairOdd?.toFixed(2) ?? "N/D"} ` +
      `e o valor estimado é ${best.value >= 0 ? "+" : ""}${best.value.toFixed(2)}%.`;

  } else {

    reason +=
      " Não foi encontrada uma odd Betclic PT disponível para este mercado.";

  }


  return {

    market:
      best.market,

    probability:
      percentage(
        best.probability
      ),

    confidence,

    reason,

    result:
      best.result,

    color:
      best.color,

    label:
      best.label,

    won:
      best.won,

    score:
      best.score,

    betclic:
      best.betclic || null,

    fairOdd:
      best.fairOdd ?? null,

    value:
      best.value ?? null

  };

}


// -----------------------------------------------------------------------------
// ANALISAR JOGO
// -----------------------------------------------------------------------------

async function analyzeFixture(
  match
) {

  const competitionCode =
    match.competition.code;


  const historyDate =
    match.date
      ? addDays(
          match.date,
          -1
        )
      : addDays(
          today(),
          -1
        );


  const homeTeamId =
    Number(
      match.homeTeam.id
    );


  const awayTeamId =
    Number(
      match.awayTeam.id
    );


  // ---------------------------------------------------------------------------
  // HISTÓRICO
  // ---------------------------------------------------------------------------

  const competitionHistory =
    await getCompetitionHistory(
      competitionCode,
      historyDate
    );


  // ---------------------------------------------------------------------------
  // CLASSIFICAÇÃO
  //
  // IMPORTANTE:
  //
  // Esta classificação é apenas informação de contexto.
  // Não entra no cálculo do Poisson.
  // ---------------------------------------------------------------------------

  const fixtureStandings =
    await getFixtureStandings(
      competitionCode,
      homeTeamId,
      awayTeamId
    );


  const homeTeamWithStanding =
    addStandingToTeam(
      match.homeTeam,
      fixtureStandings.home
    );


  const awayTeamWithStanding =
    addStandingToTeam(
      match.awayTeam,
      fixtureStandings.away
    );


  console.log(
    `🏆 Classificação ${match.competition.name}: ` +
    `${match.homeTeam.name} = ${
      fixtureStandings.home?.position ??
      "N/D"
    }º | ` +
    `${match.awayTeam.name} = ${
      fixtureStandings.away?.position ??
      "N/D"
    }º`
  );


  // ---------------------------------------------------------------------------
  // HISTÓRICO DAS EQUIPAS
  // ---------------------------------------------------------------------------

  const homeSeasonHistory =
    competitionHistory.filter(
      (fixture) => {

        return (
          Number(
            fixture.homeTeam?.id
          ) === homeTeamId ||

          Number(
            fixture.awayTeam?.id
          ) === homeTeamId
        );

      }
    );


  const awaySeasonHistory =
    competitionHistory.filter(
      (fixture) => {

        return (
          Number(
            fixture.homeTeam?.id
          ) === awayTeamId ||

          Number(
            fixture.awayTeam?.id
          ) === awayTeamId
        );

      }
    );


  // ---------------------------------------------------------------------------
  // ESTATÍSTICAS DA COMPETIÇÃO
  // ---------------------------------------------------------------------------

  const competitionStats =
    analyzeCompetition(
      competitionHistory
    );


  console.log(
    `🏆 ${match.competition.name}: ` +
    `${competitionStats.games} jogos | ` +
    `Média casa: ${competitionStats.homeGoalsAvg} | ` +
    `Média fora: ${competitionStats.awayGoalsAvg} | ` +
    `Média total: ${competitionStats.totalGoalsAvg} | ` +
    `Vantagem casa: ${competitionStats.homeAdvantagePercent}%`
  );


  // ---------------------------------------------------------------------------
  // JOGOS CASA
  // ---------------------------------------------------------------------------

  const homeSeasonHomeHistory =
    homeSeasonHistory.filter(
      (fixture) =>
        isTeamHome(
          fixture,
          homeTeamId
        )
    );


  // ---------------------------------------------------------------------------
  // JOGOS FORA
  // ---------------------------------------------------------------------------

  const awaySeasonAwayHistory =
    awaySeasonHistory.filter(
      (fixture) =>
        isTeamAway(
          fixture,
          awayTeamId
        )
    );


  // ---------------------------------------------------------------------------
  // ÚLTIMOS JOGOS
  // ---------------------------------------------------------------------------

  const homeRecentHistory =
    homeSeasonHistory
      .slice()
      .sort(
        (a, b) =>
          new Date(
            b.utcDate
          ).getTime() -
          new Date(
            a.utcDate
          ).getTime()
      )
      .slice(
        0,
        HISTORY_COUNT
      );


  const awayRecentHistory =
    awaySeasonHistory
      .slice()
      .sort(
        (a, b) =>
          new Date(
            b.utcDate
          ).getTime() -
          new Date(
            a.utcDate
          ).getTime()
      )
      .slice(
        0,
        HISTORY_COUNT
      );


  const homeRecentHomeHistory =
    homeSeasonHomeHistory
      .slice()
      .sort(
        (a, b) =>
          new Date(
            b.utcDate
          ).getTime() -
          new Date(
            a.utcDate
          ).getTime()
      )
      .slice(
        0,
        HISTORY_COUNT
      );


  const awayRecentAwayHistory =
    awaySeasonAwayHistory
      .slice()
      .sort(
        (a, b) =>
          new Date(
            b.utcDate
          ).getTime() -
          new Date(
            a.utcDate
          ).getTime()
      )
      .slice(
        0,
        HISTORY_COUNT
      );


  console.log(
    `📊 ${match.homeTeam.name}: ` +
    `${homeSeasonHistory.length} jogos na época | ` +
    `${homeSeasonHomeHistory.length} em casa | ` +
    `${homeRecentHistory.length} últimos`
  );


  console.log(
    `📊 ${match.awayTeam.name}: ` +
    `${awaySeasonHistory.length} jogos na época | ` +
    `${awaySeasonAwayHistory.length} fora | ` +
    `${awayRecentHistory.length} últimos`
  );


  // ---------------------------------------------------------------------------
  // ESTATÍSTICAS GERAIS
  // ---------------------------------------------------------------------------

  const homeGeneralStats =
    analyzeTeam(
      homeSeasonHistory,
      homeTeamId
    );


  const awayGeneralStats =
    analyzeTeam(
      awaySeasonHistory,
      awayTeamId
    );


  // ---------------------------------------------------------------------------
  // ESTATÍSTICAS CASA
  // ---------------------------------------------------------------------------

  const homeVenueStats =
    analyzeTeam(
      homeSeasonHomeHistory,
      homeTeamId
    );


  // ---------------------------------------------------------------------------
  // ESTATÍSTICAS FORA
  // ---------------------------------------------------------------------------

  const awayVenueStats =
    analyzeTeam(
      awaySeasonAwayHistory,
      awayTeamId
    );


  // ---------------------------------------------------------------------------
  // PROBABILIDADES
  // ---------------------------------------------------------------------------

  const probabilities =
    calculateProbabilities(
      homeVenueStats,
      awayVenueStats,
      homeGeneralStats,
      awayGeneralStats,
      competitionStats
    );


  // ---------------------------------------------------------------------------
  // CANDIDATOS
  // ---------------------------------------------------------------------------

  let candidates =
    buildCandidates(
      probabilities,
      match
    );


  // ---------------------------------------------------------------------------
  // ODDS BETCLIC PT
  // ---------------------------------------------------------------------------

  const betclicEvents =
    await fetchBetclicCompetitionOdds(
      competitionCode
    );

  const betclicEvent =
    findBetclicEvent(
      betclicEvents,
      match
    );

  candidates =
    attachBetclicOdds(
      candidates,
      match,
      betclicEvent
    );


  // ---------------------------------------------------------------------------
  // RECOMENDAÇÃO
  // ---------------------------------------------------------------------------

  const recommendation =
    makeRecommendation(
      candidates
    );


  // ---------------------------------------------------------------------------
  // RETORNO
  // ---------------------------------------------------------------------------

  return {

    fixture:
      match,

    season:
      CURRENT_SEASON,

    seasonLabel:
      `${CURRENT_SEASON}/${String(
        CURRENT_SEASON + 1
      ).slice(-2)}`,


    // -------------------------------------------------------------------------
    // COMPETIÇÃO
    // -------------------------------------------------------------------------

    competition: {

      ...competitionStats,

      code:
        competitionCode,

      name:
        match.competition.name,

      standings: {

        home:
          fixtureStandings.home,

        away:
          fixtureStandings.away

      }

    },


    // -------------------------------------------------------------------------
    // JOGOS UTILIZADOS
    // -------------------------------------------------------------------------

    seasonGames: {

      home:
        homeSeasonHistory.length,

      away:
        awaySeasonHistory.length,

      homeAtHome:
        homeSeasonHomeHistory.length,

      awayAway:
        awaySeasonAwayHistory.length,

      competition:
        competitionHistory.length,

      totalBothTeams:
        homeSeasonHistory.length +
        awaySeasonHistory.length,

      dateTo:
        historyDate,

      season:
        CURRENT_SEASON

    },


    // -------------------------------------------------------------------------
    // HISTÓRICO RECENTE
    // -------------------------------------------------------------------------

    history: {

      requested:
        HISTORY_COUNT,

      home:
        homeRecentHistory.length,

      away:
        awayRecentHistory.length,

      homeAtHome:
        homeRecentHomeHistory.length,

      awayAway:
        awayRecentAwayHistory.length,

      dateTo:
        historyDate,

      season:
        CURRENT_SEASON

    },


    // -------------------------------------------------------------------------
    // MANDANTE
    // -------------------------------------------------------------------------

    home: {

      team:
        homeTeamWithStanding,

      stats:
        homeGeneralStats,

      homeStats:
        homeVenueStats,

      recentStats:
        analyzeTeam(
          homeRecentHistory,
          homeTeamId
        ),

      recentHomeStats:
        analyzeTeam(
          homeRecentHomeHistory,
          homeTeamId
        )

    },


    // -------------------------------------------------------------------------
    // VISITANTE
    // -------------------------------------------------------------------------

    away: {

      team:
        awayTeamWithStanding,

      stats:
        awayGeneralStats,

      awayStats:
        awayVenueStats,

      recentStats:
        analyzeTeam(
          awayRecentHistory,
          awayTeamId
        ),

      recentAwayStats:
        analyzeTeam(
          awayRecentAwayHistory,
          awayTeamId
        )

    },


    // -------------------------------------------------------------------------
    // MODELO
    // -------------------------------------------------------------------------

    model: {

      name:
        "Poisson + Dixon-Coles",

      version:
        "3.0",

      statisticsMode:
        "FULL_SEASON",

      probabilitySource:
        "DIXON_COLES_POISSON",

      maxPoissonGoals:
        MAX_POISSON_GOALS,

      smallSamplePrior:
        SMALL_SAMPLE_PRIOR,

      competitionPrior:
        COMPETITION_PRIOR,

      dixonColesRho:
        DIXON_COLES_RHO,

      description:
        "Modelo baseado em forças relativas à média da competição. Combina força ofensiva, força defensiva adversária, contexto casa/fora, média da competição e correção de amostras pequenas antes de aplicar Poisson com correção Dixon-Coles. A classificação da liga é apresentada como contexto e não entra diretamente no cálculo das probabilidades."

    },


    // -------------------------------------------------------------------------
    // DETALHES INTERNOS
    // -------------------------------------------------------------------------

    modelDetails:
      probabilities.modelDetails,


    // -------------------------------------------------------------------------
    // GOLOS ESPERADOS
    // -------------------------------------------------------------------------

    expectedGoals:
      probabilities.expectedGoals,


    // -------------------------------------------------------------------------
    // PROBABILIDADES
    // -------------------------------------------------------------------------

    probabilities: {

      over15:
        percentage(
          probabilities.over15
        ),

      over25:
        percentage(
          probabilities.over25
        ),

      over35:
        percentage(
          probabilities.over35
        ),

      under35:
        percentage(
          probabilities.under35
        ),

      bttsYes:
        percentage(
          probabilities.bttsYes
        ),

      bttsNo:
        percentage(
          probabilities.bttsNo
        ),

      homeWin:
        percentage(
          probabilities.homeWin
        ),

      draw:
        percentage(
          probabilities.draw
        ),

      awayWin:
        percentage(
          probabilities.awayWin
        ),

      doubleChanceHome:
        percentage(
          probabilities.doubleChanceHome
        ),

      doubleChanceAway:
        percentage(
          probabilities.doubleChanceAway
        )

    },


    // -------------------------------------------------------------------------
    // RECOMENDAÇÃO
    // -------------------------------------------------------------------------

    recommendation,


    // -------------------------------------------------------------------------
    // BETCLIC PT
    // -------------------------------------------------------------------------

    betclic:
      getBetclicEventInfo(
        betclicEvent
      ),


    // -------------------------------------------------------------------------
    // MERCADOS ALTERNATIVOS
    // -------------------------------------------------------------------------

    alternatives:
      candidates
        .slice(
          0,
          9
        )
        .map(
          (item) => ({

            ...item,

            probability:
              percentage(
                item.probability
              )

          })
        ),


    // -------------------------------------------------------------------------
    // VALIDAÇÕES
    // -------------------------------------------------------------------------

    probabilityChecks: {

      oneXTwoTotal:
        percentage(
          probabilities.homeWin +
          probabilities.draw +
          probabilities.awayWin
        ),

      homeOrDraw:
        percentage(
          probabilities.homeWin +
          probabilities.draw
        ),

      awayOrDraw:
        percentage(
          probabilities.awayWin +
          probabilities.draw
        ),

      over35PlusUnder35:
        percentage(
          probabilities.over35 +
          probabilities.under35
        ),

      bttsYesPlusNo:
        percentage(
          probabilities.bttsYes +
          probabilities.bttsNo
        )

    },


    disclaimer:
      "Estimativas estatísticas baseadas nos jogos disponíveis da época atual. O modelo utiliza força ofensiva, força defensiva adversária, média da competição, contexto casa/fora e correção de amostras pequenas. Os golos esperados alimentam uma distribuição Poisson com correção Dixon-Coles, da qual são derivados 1X2, dupla chance, mercados de golos e BTTS. A classificação da liga é obtida separadamente do endpoint de standings e serve como informação de contexto; não é utilizada diretamente no cálculo das probabilidades. Os últimos jogos são apresentados separadamente e não entram diretamente no cálculo principal. Probabilidades são estimativas estatísticas e não garantem resultados."

  };

}


// -----------------------------------------------------------------------------
// IDENTIFICAR SE A EQUIPA JOGOU EM CASA
// -----------------------------------------------------------------------------

function isTeamHome(
  fixture,
  teamId
) {

  if (
    !fixture ||
    !teamId
  ) {

    return false;

  }

  return Number(
    fixture?.homeTeam?.id
  ) ===
    Number(
      teamId
    );

}


// -----------------------------------------------------------------------------
// IDENTIFICAR SE A EQUIPA JOGOU FORA
// -----------------------------------------------------------------------------

function isTeamAway(
  fixture,
  teamId
) {

  if (
    !fixture ||
    !teamId
  ) {

    return false;

  }

  return Number(
    fixture?.awayTeam?.id
  ) ===
    Number(
      teamId
    );

}


// -----------------------------------------------------------------------------
// ENCONTRAR JOGO
// -----------------------------------------------------------------------------

async function findMatch(
  id
) {

  const numericId =
    Number.parseInt(
      id,
      10
    );


  if (
    !Number.isInteger(
      numericId
    )
  ) {

    return null;

  }


  try {

    const data =
      await footballData(
        `/matches/${numericId}`,
        {
          ttl:
            60_000
        }
      );


    if (
      data?.id
    ) {

      return normalizeMatch(
        data
      );

    }

  } catch (error) {

    console.log(
      `Não foi possível obter o jogo ${numericId}: ${error.message}`
    );

  }


  return null;

}


// -----------------------------------------------------------------------------
// HEALTH
// -----------------------------------------------------------------------------

app.get(
  "/api/health",
  (
    req,
    res
  ) => {

    res.json({

      ok:
        true,

      provider:
        "football-data.org",

      apiConfigured:
        Boolean(
          API_TOKEN
        ),

      betclic: {
        configured:
          Boolean(
            BETCLIC_ODDS_API_KEY
          ),

        bookmaker:
          BETCLIC_BOOKMAKER,

        provider:
          "PropLine",

        apiUrl:
          BETCLIC_ODDS_API_URL,

        cacheTtlMs:
          BETCLIC_CACHE_TTL
      },

      apiUrl:
        API_URL,

      currentSeason:
        CURRENT_SEASON,

      currentSeasonLabel:
        `${CURRENT_SEASON}/${String(
          CURRENT_SEASON + 1
        ).slice(-2)}`,

      historyCount:
        HISTORY_COUNT,

      statisticsMode:
        "FULL_SEASON",

      standings:
        true,

      standingsCache:
        "5_MINUTES",

      model:
        "POISSON_DIXON_COLES",

      modelVersion:
        "3.0",

      maxPoissonGoals:
        MAX_POISSON_GOALS,

      smallSamplePrior:
        SMALL_SAMPLE_PRIOR,

      competitionPrior:
        COMPETITION_PRIOR,

      dixonColesRho:
        DIXON_COLES_RHO,

      competitions:
        Object.values(
          COMPETITIONS
        ),

      cacheEntries:
        cache.size,

      requestsLastMinute:
        requestTimes.length,

      limitPerMinute:
        MAX_REQUESTS_PER_MINUTE

    });

  }
);


// -----------------------------------------------------------------------------
// JOGOS
// -----------------------------------------------------------------------------

app.get(
  "/api/matches",
  async (
    req,
    res
  ) => {

    try {

      const date =
        normalizeDate(
          req.query.date
        );


      const matches =
        await getMatchesForDate(
          date
        );


      res.json({

        ok:
          true,

        provider:
          "football-data.org",

        date,

        season:
          CURRENT_SEASON,

        seasonLabel:
          `${CURRENT_SEASON}/${String(
            CURRENT_SEASON + 1
          ).slice(-2)}`,

        count:
          matches.length,

        matches,

        message:
          matches.length
            ? `${matches.length} jogos encontrados.`
            : "Nenhum jogo das competições configuradas foi disponibilizado pela API para esta data."

      });

    } catch (error) {

      console.error(
        "GET /api/matches:",
        error
      );


      res.status(
        500
      ).json({

        ok:
          false,

        error:
          error.message

      });

    }

  }
);


// -----------------------------------------------------------------------------
// COMPETIÇÕES
// -----------------------------------------------------------------------------

app.get(
  "/api/competitions",
  (
    req,
    res
  ) => {

    res.json({

      ok:
        true,

      season:
        CURRENT_SEASON,

      seasonLabel:
        `${CURRENT_SEASON}/${String(
          CURRENT_SEASON + 1
        ).slice(-2)}`,

      standings:
        true,

      competitions:
        Object.values(
          COMPETITIONS
        )

    });

  }
);


// -----------------------------------------------------------------------------
// CLASSIFICAÇÃO
// -----------------------------------------------------------------------------
//
// Endpoint adicional:
//
// GET /api/competitions/PL/standings
// GET /api/competitions/PPL/standings
// GET /api/competitions/BL1/standings
//
// etc.
// -----------------------------------------------------------------------------

app.get(
  "/api/competitions/:competitionCode/standings",
  async (
    req,
    res
  ) => {

    try {

      const competitionCode =
        String(
          req.params.competitionCode || ""
        ).toUpperCase();


      if (
        !ALLOWED_COMPETITIONS.has(
          competitionCode
        )
      ) {

        return res
          .status(400)
          .json({

            ok:
              false,

            error:
              `Competição "${competitionCode}" não está configurada.`

          });

      }


      const standings =
        await getCompetitionStandings(
          competitionCode
        );


      const competition =
        COMPETITIONS[
          competitionCode
        ];


      return res.json({

        ok:
          true,

        provider:
          "football-data.org",

        competition: {

          code:
            competitionCode,

          id:
            competition.id,

          name:
            competition.name,

          country:
            competition.country

        },

        season:
          CURRENT_SEASON,

        seasonLabel:
          `${CURRENT_SEASON}/${String(
            CURRENT_SEASON + 1
          ).slice(-2)}`,

        count:
          standings.length,

        standings

      });

    } catch (error) {

      console.error(
        "GET standings:",
        error
      );


      return res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


// -----------------------------------------------------------------------------
// ANÁLISE INDIVIDUAL
// -----------------------------------------------------------------------------

app.get(
  "/api/bets/analyze/:fixtureId",
  async (
    req,
    res
  ) => {

    try {

      const fixtureId =
        req.params.fixtureId;


      console.log(
        `\n🔎 Análise individual solicitada: ${fixtureId}`
      );


      const match =
        await findMatch(
          fixtureId
        );


      if (!match) {

        return res
          .status(404)
          .json({

            ok:
              false,

            error:
              "Jogo não encontrado no football-data.org."

          });

      }


      if (
        !match.homeTeam.id ||
        !match.awayTeam.id
      ) {

        return res
          .status(400)
          .json({

            ok:
              false,

            error:
              "O jogo não contém IDs válidos das duas equipas."

          });

      }


      if (
        !ALLOWED_COMPETITIONS.has(
          match.competition.code
        )
      ) {

        return res
          .status(400)
          .json({

            ok:
              false,

            error:
              `A competição "${match.competition.name}" não está configurada para análise.`

          });

      }


      const analysis =
        await analyzeFixture(
          match
        );


      console.log(
        `✅ Análise concluída: ${match.homeTeam.name} vs ${match.awayTeam.name} | ` +
        `Época ${analysis.seasonLabel} | ` +
        `${match.homeTeam.name}: ${
          analysis.home.team.leaguePosition ??
          "N/D"
        }º | ` +
        `${match.awayTeam.name}: ${
          analysis.away.team.leaguePosition ??
          "N/D"
        }º | ` +
        `xG: ${analysis.expectedGoals.home}-${analysis.expectedGoals.away}`
      );


      return res.json({

        ok:
          true,

        source:
          "football-data.org",

        ...analysis

      });

    } catch (error) {

      console.error(
        "❌ ANÁLISE INDIVIDUAL:",
        error
      );


      return res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


// -----------------------------------------------------------------------------
// MELHORES DO DIA
// -----------------------------------------------------------------------------

app.get(
  "/api/bets/daily",
  async (
    req,
    res
  ) => {

    try {

      const date =
        normalizeDate(
          req.query.date
        );


      const limit =
        clampInt(
          req.query.limit ??
          DAILY_ANALYSIS_LIMIT,

          0,

          DAILY_ANALYSIS_LIMIT
        );


      // -----------------------------------------------------------------------
      // ZERO ANÁLISES
      // -----------------------------------------------------------------------

      if (
        limit === 0
      ) {

        console.log(
          `📊 Melhores do dia: ${date} | 0 análises solicitadas | nenhum pedido à API`
        );


        return res.json({

          ok:
            true,

          provider:
            "football-data.org",

          date,

          season:
            CURRENT_SEASON,

          seasonLabel:
            `${CURRENT_SEASON}/${String(
              CURRENT_SEASON + 1
            ).slice(-2)}`,

          gamesFound:
            0,

          analyzed:
            0,

          analyses:
            [],

          message:
            "Nenhuma análise solicitada."

        });

      }


      // -----------------------------------------------------------------------
      // OBTER JOGOS
      // -----------------------------------------------------------------------

      const matches =
        await getMatchesForDate(
          date
        );


      const eligible =
        matches.filter(
          (match) =>
            match.homeTeam.id &&
            match.awayTeam.id
        );


      const selected =
        eligible.slice(
          0,
          limit
        );


      // -----------------------------------------------------------------------
      // ANALISAR
      // -----------------------------------------------------------------------

      const analyses =
        [];


      for (
        const match
        of selected
      ) {

        try {

          const analysis =
            await analyzeFixture(
              match
            );


          analyses.push(
            analysis
          );

        } catch (error) {

          console.error(
            `Erro a analisar ${match.id}:`,
            error.message
          );


          analyses.push({

            ok:
              false,

            fixture:
              match,

            error:
              error.message

          });

        }

      }


      // -----------------------------------------------------------------------
      // MELHOR VALOR BETCLIC PRIMEIRO
      // -----------------------------------------------------------------------
      // Quando existe odd Betclic + value, ordenamos pelo value.
      // Sem odds disponíveis, mantemos o ranking por probabilidade.
      // -----------------------------------------------------------------------

      analyses.sort(
        (
          a,
          b
        ) => {

          const av =
            Number(
              a?.recommendation?.value
            );

          const bv =
            Number(
              b?.recommendation?.value
            );

          const aHasValue =
            Number.isFinite(av);

          const bHasValue =
            Number.isFinite(bv);

          if (
            aHasValue &&
            bHasValue
          ) {
            return bv - av;
          }

          if (
            bHasValue &&
            !aHasValue
          ) {
            return 1;
          }

          if (
            aHasValue &&
            !bHasValue
          ) {
            return -1;
          }

          return (
            Number(
              b?.recommendation?.probability ||
              0
            ) -
            Number(
              a?.recommendation?.probability ||
              0
            )
          );

        }
      );


      res.json({

        ok:
          true,

        provider:
          "football-data.org",

        date,

        season:
          CURRENT_SEASON,

        seasonLabel:
          `${CURRENT_SEASON}/${String(
            CURRENT_SEASON + 1
          ).slice(-2)}`,

        statisticsMode:
          "FULL_SEASON",

        standings:
          true,

        model:
          "POISSON_DIXON_COLES",

        modelVersion:
          "3.0",

        modelConfiguration: {

          maxPoissonGoals:
            MAX_POISSON_GOALS,

          smallSamplePrior:
            SMALL_SAMPLE_PRIOR,

          competitionPrior:
            COMPETITION_PRIOR,

          dixonColesRho:
            DIXON_COLES_RHO

        },

        gamesFound:
          matches.length,

        analyzed:
          analyses.length,

        analyses,

        message:
          matches.length
            ? "Análise concluída usando os jogos disponíveis da época atual, classificação da competição e modelo Poisson + Dixon-Coles."
            : "Não foram encontrados jogos para esta data."

      });

    } catch (error) {

      console.error(
        "DAILY:",
        error
      );


      res
        .status(500)
        .json({

          ok:
            false,

          error:
            error.message

        });

    }

  }
);


// -----------------------------------------------------------------------------
// ERROS
// -----------------------------------------------------------------------------

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "Erro interno:",
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

        ok:
          false,

        error:
          "Erro interno do servidor."

      });

  }
);


// -----------------------------------------------------------------------------
// START
// -----------------------------------------------------------------------------

app.listen(
  PORT,
  () => {

    console.log("");

    console.log(
      "=========================================="
    );

    console.log(
      "       FOOTBALL BET ANALYZER"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `Servidor: http://localhost:${PORT}`
    );

    console.log(
      `API: ${API_URL}`
    );

    console.log(
      `Token configurado: ${
        API_TOKEN
          ? "SIM"
          : "NÃO"
      }`
    );

    console.log(
      `Betclic PT configurada: ${
        BETCLIC_ODDS_API_KEY
          ? "SIM"
          : "NÃO"
      }`
    );

    console.log(
      `Bookmaker odds: ${BETCLIC_BOOKMAKER}`
    );

    console.log(
      `Época atual: ${CURRENT_SEASON}/${String(
        CURRENT_SEASON + 1
      ).slice(-2)}`
    );

    console.log(
      "Estatísticas: ÉPOCA COMPLETA"
    );

    console.log(
      "Classificação: ATIVADA"
    );

    console.log(
      "Cache classificação: 5 minutos"
    );

    console.log(
      "Modelo: POISSON + DIXON-COLES"
    );

    console.log(
      `Prior amostra pequena: ${SMALL_SAMPLE_PRIOR} jogos`
    );

    console.log(
      `Prior competição: ${COMPETITION_PRIOR} jogos`
    );

    console.log(
      `Dixon-Coles rho: ${DIXON_COLES_RHO}`
    );

    console.log(
      `Máximo de golos na matriz: ${MAX_POISSON_GOALS}`
    );

    console.log(
      `Últimos jogos disponíveis: ${HISTORY_COUNT}`
    );

    console.log(
      `Limite local: ${MAX_REQUESTS_PER_MINUTE}/min`
    );

    console.log(
      `Máximo de análises do dia: ${DAILY_ANALYSIS_LIMIT}`
    );

    console.log(
      "Fonte: football-data.org"
    );

    console.log(
      "=========================================="
    );

    console.log("");

  }
);