/* ==========================================================
   RESUMO DAS APOSTAS
========================================================== */

function updateIndexBetSummary() {

  let savedBets = [];

  try {

    const stored =
      localStorage.getItem("footballMultiples");

    if (stored) {

      const parsed =
        JSON.parse(stored);

      if (Array.isArray(parsed)) {
        savedBets = parsed;
      }

    }

  } catch (error) {

    console.error(
      "Erro ao ler as apostas:",
      error
    );

    return;

  }


  /* ========================================================
     APOSTAS GANHAS / PERDIDAS
  ======================================================== */

  const wonBets =
    savedBets.filter(
      bet =>
        bet.status === "finished" &&
        bet.outcome === "won"
    );


  const lostBets =
    savedBets.filter(
      bet =>
        bet.status === "finished" &&
        bet.outcome === "lost"
    );


  const pendingBets =
    savedBets.filter(
      bet =>
        bet.status === "pending"
    );


  /* ========================================================
     PROFIT

     Mesma lógica usada em apostas.html
  ======================================================== */

  const totalWon =
    wonBets.reduce(
      (total, bet) =>
        total +
        Number(
          bet.potentialReturn || 0
        ),
      0
    );


  const completedStake =
    [
      ...wonBets,
      ...lostBets
    ].reduce(
      (total, bet) =>
        total +
        Number(
          bet.stake || 0
        ),
      0
    );


  const profit =
    totalWon -
    completedStake;


  /* ========================================================
     WIN RATE

     Apenas apostas finalizadas contam.
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
     FORMATAÇÃO
  ======================================================== */

  const money =
    Number(profit || 0).toLocaleString(
      "pt-PT",
      {
        style: "currency",
        currency: "EUR"
      }
    );


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


  if (profitElement) {

    profitElement.textContent =
      money;

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


  if (winRateElement) {

    winRateElement.textContent =
      `${winRate.toFixed(1)}%`;

  }


  if (totalBetsElement) {

    totalBetsElement.textContent =
      savedBets.length;

  }


  if (pendingBetsElement) {

    pendingBetsElement.textContent =
      pendingBets.length;

  }

}


/* ==========================================================
   INICIALIZAÇÃO
========================================================== */

updateIndexBetSummary();


/* Atualização imediata */

window.addEventListener(
  "betsUpdated",
  updateIndexBetSummary
);


/* Atualização entre abas/janelas */

window.addEventListener(
  "storage",
  function(event) {

    if (
      event.key === "footballMultiples"
    ) {

      updateIndexBetSummary();

    }

  }
);