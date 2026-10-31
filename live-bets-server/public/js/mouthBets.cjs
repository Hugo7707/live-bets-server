/* ==========================================================
   RESUMO DAS APOSTAS
========================================================== */

const BETS_STORAGE_KEY =
  "footballMultiples";


let selectedSummaryMonth =
  "all";


/* ==========================================================
   LER APOSTAS
========================================================== */

function getSavedBetsForSummary() {

  try {

    const stored =
      localStorage.getItem(
        BETS_STORAGE_KEY
      );


    if (!stored) {
      return [];
    }


    const parsed =
      JSON.parse(
        stored
      );


    return Array.isArray(parsed)
      ? parsed
      : [];


  } catch (error) {

    console.error(
      "Erro ao ler as apostas:",
      error
    );


    return [];

  }

}


/* ==========================================================
   DATA DA APOSTA
========================================================== */

function getBetMonth(
  bet
) {

  if (
    !bet ||
    !bet.createdAt
  ) {

    return null;

  }


  const date =
    new Date(
      bet.createdAt
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return null;

  }


  const year =
    date.getFullYear();


  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );


  return `${year}-${month}`;

}


/* ==========================================================
   FORMATAR MÊS
========================================================== */

function formatSummaryMonth(
  monthValue
) {

  if (!monthValue) {
    return "";
  }


  const [
    year,
    month
  ] =
    monthValue.split("-");


  const date =
    new Date(
      Number(year),
      Number(month) - 1,
      1
    );


  return date.toLocaleDateString(
    "pt-PT",
    {
      month: "long",
      year: "numeric"
    }
  );


}


/* ==========================================================
   CRIAR FILTRO DE MESES
========================================================== */

function updateSummaryMonthOptions(
  savedBets
) {

  const select =
    document.getElementById(
      "summaryMonthFilter"
    );


  if (!select) {
    return;
  }


  const months =
    new Set();


  savedBets.forEach(
    bet => {

      const month =
        getBetMonth(
          bet
        );


      if (month) {

        months.add(
          month
        );

      }

    }
  );


  const sortedMonths =
    [...months].sort(
      (
        a,
        b
      ) => {

        return b.localeCompare(
          a
        );

      }
    );


  select.innerHTML = "";


  const allOption =
    document.createElement(
      "option"
    );


  allOption.value =
    "all";


  allOption.textContent =
    "Todos os meses";


  select.appendChild(
    allOption
  );


  sortedMonths.forEach(
    month => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        month;


      option.textContent =
        formatSummaryMonth(
          month
        );


      select.appendChild(
        option
      );

    }
  );


  /*
   * Se o mês anteriormente selecionado
   * já não existir, volta para todos.
   */

  const stillExists =
    selectedSummaryMonth ===
      "all" ||

    months.has(
      selectedSummaryMonth
    );


  if (!stillExists) {

    selectedSummaryMonth =
      "all";

  }


  select.value =
    selectedSummaryMonth;

}


/* ==========================================================
   ATUALIZAR RESUMO
========================================================== */

function updateIndexBetSummary() {

  const savedBets =
    getSavedBetsForSummary();


  /*
   * Atualizar meses disponíveis.
   */

  updateSummaryMonthOptions(
    savedBets
  );


  /*
   * Aplicar filtro.
   */

  const filteredBets =
    selectedSummaryMonth ===
      "all"

      ? savedBets

      : savedBets.filter(
          bet =>
            getBetMonth(
              bet
            ) ===
            selectedSummaryMonth
        );


  /* ========================================================
     APOSTAS GANHAS / PERDIDAS
  ======================================================== */

  const wonBets =
    filteredBets.filter(
      bet =>
        bet.status === "finished" &&
        bet.outcome === "won"
    );


  const lostBets =
    filteredBets.filter(
      bet =>
        bet.status === "finished" &&
        bet.outcome === "lost"
    );


  const pendingBets =
    filteredBets.filter(
      bet =>
        bet.status === "pending"
    );


  /* ========================================================
     PROFIT
  ======================================================== */

  const totalWon =
    wonBets.reduce(
      (
        total,
        bet
      ) => {

        return (
          total +
          Number(
            bet.potentialReturn || 0
          )
        );

      },
      0
    );


  const completedStake =
    [
      ...wonBets,
      ...lostBets
    ].reduce(
      (
        total,
        bet
      ) => {

        return (
          total +
          Number(
            bet.stake || 0
          )
        );

      },
      0
    );


  const profit =
    totalWon -
    completedStake;


  /* ========================================================
     WIN RATE
  ======================================================== */

  const finishedBets =
    wonBets.length +
    lostBets.length;


  const winRate =
    finishedBets > 0

      ? (
          wonBets.length /
          finishedBets
        ) * 100

      : 0;


  /* ========================================================
     DOM
  ======================================================== */

  const profitElement =
    document.getElementById(
      "summaryProfit"
    );


  const winRateElement =
    document.getElementById(
      "summaryWinRate"
    );


  const totalBetsElement =
    document.getElementById(
      "summaryTotalBets"
    );


  const pendingBetsElement =
    document.getElementById(
      "summaryPendingBets"
    );


  /* ========================================================
     PROFIT
  ======================================================== */

  if (profitElement) {

    profitElement.textContent =
      Number(
        profit || 0
      ).toLocaleString(
        "pt-PT",
        {
          style: "currency",
          currency: "EUR"
        }
      );


    profitElement.classList.remove(
      "profit-positive",
      "profit-negative"
    );


    profitElement.classList.add(
      profit >= 0
        ? "profit-positive"
        : "profit-negative"
    );

  }


  /* ========================================================
     WIN RATE
  ======================================================== */

  if (winRateElement) {

    winRateElement.textContent =
      `${winRate.toFixed(1)}%`;

  }


  /* ========================================================
     TOTAL
  ======================================================== */

  if (totalBetsElement) {

    totalBetsElement.textContent =
      filteredBets.length;

  }


  /* ========================================================
     PENDENTES
  ======================================================== */

  if (pendingBetsElement) {

    pendingBetsElement.textContent =
      pendingBets.length;

  }

}


/* ==========================================================
   ALTERAR MÊS
========================================================== */

function initSummaryMonthFilter() {

  const select =
    document.getElementById(
      "summaryMonthFilter"
    );


  if (!select) {
    return;
  }


  select.addEventListener(
    "change",
    () => {

      selectedSummaryMonth =
        select.value;


      updateIndexBetSummary();

    }
  );

}


/* ==========================================================
   INICIALIZAÇÃO
========================================================== */

initSummaryMonthFilter();

updateIndexBetSummary();


/* ==========================================================
   APOSTA ATUALIZADA
========================================================== */

window.addEventListener(
  "betsUpdated",
  () => {

    updateIndexBetSummary();

  }
);


/* ==========================================================
   OUTRA ABA / JANELA
========================================================== */

window.addEventListener(
  "storage",
  event => {

    if (
      event.key ===
      BETS_STORAGE_KEY
    ) {

      updateIndexBetSummary();

    }

  }
);