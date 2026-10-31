(() => {
  const STORAGE_KEY = "footballMultiples";
  const BETS_PAGE = "apostas.html";

  let badge = null;

  function loadBets() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return [];
      }

      const parsed = JSON.parse(stored);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error(
        "Erro ao carregar apostas para o floating badge:",
        error
      );

      return [];
    }
  }

  function getActiveBets() {
    return loadBets().filter((bet) => {
      return (
        bet &&
        (bet.status === "pending" || bet.status === "live")
      );
    });
  }

  function getStake(bet) {
    const value = Number(
      bet.stake ??
      bet.valor ??
      bet.amount ??
      0
    );

    return Number.isFinite(value) ? value : 0;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  function createBadge() {
    if (badge) {
      return badge;
    }

    badge = document.createElement("a");

    badge.id = "floatingBetsBadge";
    badge.className = "floating-bets-badge";
    badge.href = BETS_PAGE;
    badge.setAttribute(
      "aria-label",
      "Ver minhas apostas"
    );

    badge.innerHTML = `
      <span class="floating-bets-icon">🎟️</span>

      <span class="floating-bets-text">
        <span class="floating-bets-title">
          Minhas apostas
        </span>

        <span class="floating-bets-count">
          0 apostas
        </span>

        <span class="floating-bets-meta">
          0,00 €
        </span>
      </span>

      <span class="floating-bets-number">
        0
      </span>
    `;

    document.body.appendChild(badge);

    return badge;
  }

  function updateBadge() {
    const currentBadge = createBadge();

    const activeBets = getActiveBets();

    const total = activeBets.length;

    const liveCount = activeBets.filter(
      (bet) => bet.status === "live"
    ).length;

    const pendingCount = activeBets.filter(
      (bet) => bet.status === "pending"
    ).length;

    const totalStake = activeBets.reduce(
      (sum, bet) => sum + getStake(bet),
      0
    );

    if (total === 0) {
      currentBadge.style.display = "none";
      return;
    }

    currentBadge.style.display = "flex";

    const countElement =
      currentBadge.querySelector(
        ".floating-bets-count"
      );

    const metaElement =
      currentBadge.querySelector(
        ".floating-bets-meta"
      );

    const numberElement =
      currentBadge.querySelector(
        ".floating-bets-number"
      );

    if (liveCount > 0) {
      countElement.innerHTML = `
        <span class="floating-bets-live">
          🔴 ${liveCount} em curso
        </span>
      `;

      if (pendingCount > 0) {
        metaElement.textContent =
          `${pendingCount} pendente${
            pendingCount !== 1 ? "s" : ""
          } · ${formatMoney(totalStake)}`;
      } else {
        metaElement.textContent =
          formatMoney(totalStake);
      }
    } else {
      countElement.textContent =
        total === 1
          ? "1 aposta pendente"
          : `${total} apostas pendentes`;

      metaElement.textContent =
        formatMoney(totalStake);
    }

    numberElement.textContent = total;

    currentBadge.classList.toggle(
      "has-live",
      liveCount > 0
    );

    currentBadge.setAttribute(
      "aria-label",
      `${total} apostas ativas${
        liveCount > 0
          ? `, ${liveCount} em direto`
          : ""
      }. Total apostado: ${formatMoney(totalStake)}`
    );
  }

  function init() {
    updateBadge();

    /*
     * Quando outra página/tab altera o localStorage.
     */
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) {
        updateBadge();
      }
    });

    /*
     * Evento interno da própria aplicação.
     */
    window.addEventListener("betsUpdated", () => {
      updateBadge();
    });

    /*
     * Backup para alterações que não disparem
     * nenhum dos eventos anteriores.
     */
    setInterval(updateBadge, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }
})();