/* ==========================================================
   FOOTBALL NOTIFICATIONS
   notifications.js

   Notificações globais:
   - ⚽ Golo
   - 🟢 Início de jogo
   - 🏁 Fim de jogo

   Compatível com:
   football-server
   Porta: 3001

   MÉTODOS:
   - 📡 SSE em tempo real
   - 🔄 Polling como fallback

   TIPOS ACEITES:

   GOLO:
   - goal
   - goal_scored
   - scored

   INÍCIO:
   - match_started
   - started
   - kickoff
   - kick_off
   - game_started
   - match_start
   - start

   FIM:
   - match_finished
   - finished
   - fulltime
   - full_time
   - game_finished
   - match_finish
   - finish
========================================================== */

(() => {

  "use strict";


  /* ========================================================
     CONFIGURAÇÃO
  ======================================================== */

  const GOAL_API_URL =
    "http://localhost:3001";


  const GOAL_REFRESH_INTERVAL =
    5_000;


  const NOTIFICATION_DURATION =
    8_000;


  const MAX_SEEN_EVENTS =
    500;


  /*
   * Endpoint SSE.
   *
   * O servidor deve ter:
   *
   * GET /api/live/events
   */

  const GOAL_SSE_URL =
    `${GOAL_API_URL}/api/live/events`;


  /* ========================================================
     ESTADO
  ======================================================== */

  let goalRefreshTimer =
    null;


  let goalRequestInProgress =
    false;


  let goalSystemReady =
    false;


  let lastGoalCheck =
    null;


  let goalNotificationTimer =
    null;


  let goalNotificationQueue =
    [];


  let goalNotificationShowing =
    false;


  let goalAudioContext =
    null;


  /*
   * SSE
   */

  let goalEventSource =
    null;


  let goalSseConnected =
    false;


  /*
   * Eventos já apresentados.
   */

  const seenEventIds =
    new Set();


  /* ========================================================
     TIPOS DE EVENTO
  ======================================================== */

  const GOAL_EVENT_TYPES =
    new Set([
      "goal",
      "goal_scored",
      "scored"
    ]);


  const MATCH_STARTED_TYPES =
    new Set([
      "match_started",
      "started",
      "kickoff",
      "kick_off",
      "game_started",
      "match_start",
      "start",
      "live_started",
      "match_began"
    ]);


  const MATCH_FINISHED_TYPES =
    new Set([
      "match_finished",
      "finished",
      "fulltime",
      "full_time",
      "game_finished",
      "match_finish",
      "finish",
      "ended",
      "game_ended",
      "match_ended",
      "full-time",
      "full-time-ended"
    ]);


  /* ========================================================
     NORMALIZAR TIPO
  ======================================================== */

  function normalizeEventType(
    event
  ) {

    const rawType =
      event?.type ??
      event?.eventType ??
      event?.event_type ??
      event?.event ??
      "";


    let type =
      String(
        rawType
      )
        .trim()
        .toLowerCase();


    /*
     * Normalizar espaços.
     */

    type =
      type.replace(
        /\s+/g,
        "_"
      );


    /*
     * Normalizar hífens.
     */

    type =
      type.replace(
        /-/g,
        "_"
      );


    /*
     * Remover duplicação de underscores.
     */

    type =
      type.replace(
        /_+/g,
        "_"
      );


    return type;

  }


  /* ========================================================
     IDENTIFICAR TIPO
  ======================================================== */

  function getNotificationType(
    event
  ) {

    const type =
      normalizeEventType(
        event
      );


    if (
      GOAL_EVENT_TYPES.has(
        type
      )
    ) {

      return "goal";

    }


    if (
      MATCH_STARTED_TYPES.has(
        type
      )
    ) {

      return "match_started";

    }


    if (
      MATCH_FINISHED_TYPES.has(
        type
      )
    ) {

      return "match_finished";

    }


    /*
     * Alguns servidores enviam o estado
     * em vez de "type".
     */

    const rawStatus =
      event?.status ??
      event?.matchStatus ??
      event?.match_status ??
      event?.normalizedStatus ??
      "";


    let status = "";


    if (
      rawStatus &&
      typeof rawStatus === "object"
    ) {

      status =
        String(
          rawStatus.type ||
          rawStatus.short ||
          rawStatus.name ||
          rawStatus.code ||
          ""
        );

    }

    else {

      status =
        String(
          rawStatus
        );

    }


    status =
      status
        .trim()
        .toLowerCase()
        .replace(
          /[\s-]+/g,
          "_"
        );


    if (
      status === "started" ||
      status === "live" ||
      status === "in_progress" ||
      status === "inplay" ||
      status === "in_play"
    ) {

      return "match_started";

    }


    if (
      status === "finished" ||
      status === "full_time" ||
      status === "fulltime" ||
      status === "ended" ||
      status === "complete" ||
      status === "completed"
    ) {

      return "match_finished";

    }


    return null;

  }


  /* ========================================================
     CRIAR CSS
  ======================================================== */

  function createNotificationStyles() {

    if (
      document.getElementById(
        "footballNotificationStyles"
      )
    ) {

      return;

    }


    const style =
      document.createElement(
        "style"
      );


    style.id =
      "footballNotificationStyles";


    style.textContent = `

      .goal-notification {

        position: fixed;

        top: 20px;
        right: 20px;

        width: min(
          420px,
          calc(100vw - 40px)
        );

        display: flex;

        align-items: center;

        gap: 16px;

        padding: 18px 20px;

        border-radius: 16px;

        background: #111827;

        color: #ffffff;

        box-shadow:
          0 15px 40px
          rgba(0, 0, 0, 0.35);

        z-index: 999999;

        opacity: 0;

        visibility: hidden;

        transform:
          translateX(120%);

        transition:
          opacity 0.3s ease,
          transform 0.35s ease,
          visibility 0.35s ease;

        pointer-events: none;

        box-sizing: border-box;

        font-family:
          Arial,
          Helvetica,
          sans-serif;

      }


      .goal-notification.show {

        opacity: 1;

        visibility: visible;

        transform:
          translateX(0);

        pointer-events: auto;

      }


      .goal-notification-icon {

        width: 54px;

        height: 54px;

        min-width: 54px;

        display: flex;

        align-items: center;

        justify-content: center;

        border-radius: 50%;

        background:
          rgba(
            255,
            255,
            255,
            0.10
          );

        font-size: 29px;

      }


      .goal-notification-content {

        flex: 1;

        min-width: 0;

      }


      .goal-notification-title {

        font-size: 20px;

        font-weight: 900;

        line-height: 1.1;

        margin-bottom: 5px;

      }


      .goal-notification-match {

        font-size: 14px;

        font-weight: 600;

        opacity: 0.85;

        margin-bottom: 6px;

        white-space: nowrap;

        overflow: hidden;

        text-overflow: ellipsis;

      }


      .goal-notification-scorer {

        font-size: 13px;

        font-weight: 700;

        margin-bottom: 6px;

      }


      .goal-notification-score {

        font-size: 25px;

        font-weight: 900;

        letter-spacing: 1px;

      }


      .goal-notification-minute {

        font-size: 13px;

        font-weight: 700;

        opacity: 0.7;

        margin-top: 3px;

      }


      .goal-notification-close {

        width: 32px;

        height: 32px;

        min-width: 32px;

        border: 0;

        border-radius: 50%;

        background:
          rgba(
            255,
            255,
            255,
            0.10
          );

        color: #ffffff;

        font-size: 24px;

        line-height: 1;

        cursor: pointer;

        display: flex;

        align-items: center;

        justify-content: center;

        transition:
          background 0.2s ease,
          transform 0.2s ease;

      }


      .goal-notification-close:hover {

        background:
          rgba(
            255,
            255,
            255,
            0.20
          );

        transform:
          scale(1.08);

      }


      .goal-notification.notification-goal {

        border-left:
          5px solid #facc15;

      }


      .goal-notification.notification-goal
      .goal-notification-title {

        color: #facc15;

      }


      .goal-notification.notification-goal
      .goal-notification-icon {

        background:
          rgba(
            250,
            204,
            21,
            0.15
          );

      }


      .goal-score-highlight {

        color: #facc15;

      }


      .goal-score-separator {

        opacity: 0.6;

        padding:
          0 5px;

      }


      .goal-notification.notification-start {

        border-left:
          5px solid #22c55e;

      }


      .goal-notification.notification-start
      .goal-notification-title {

        color: #22c55e;

      }


      .goal-notification.notification-start
      .goal-notification-icon {

        background:
          rgba(
            34,
            197,
            94,
            0.15
          );

      }


      .goal-notification.notification-finish {

        border-left:
          5px solid #f97316;

      }


      .goal-notification.notification-finish
      .goal-notification-title {

        color: #f97316;

      }


      .goal-notification.notification-finish
      .goal-notification-icon {

        background:
          rgba(
            249,
            115,
            22,
            0.15
          );

      }


      @media (
        max-width: 600px
      ) {

        .goal-notification {

          top: 12px;

          right: 12px;

          width:
            calc(
              100vw - 24px
            );

          padding:
            15px 16px;

          gap: 12px;

        }


        .goal-notification-icon {

          width: 44px;

          height: 44px;

          min-width: 44px;

          font-size: 24px;

        }


        .goal-notification-title {

          font-size: 17px;

        }


        .goal-notification-score {

          font-size: 22px;

        }

      }

    `;


    document.head.appendChild(
      style
    );

  }


  /* ========================================================
     CRIAR HTML AUTOMATICAMENTE
  ======================================================== */

  function createNotificationElement() {

    if (
      document.getElementById(
        "goalNotification"
      )
    ) {

      return;

    }


    const notification =
      document.createElement(
        "div"
      );


    notification.id =
      "goalNotification";


    notification.className =
      "goal-notification";


    notification.setAttribute(
      "role",
      "alert"
    );


    notification.setAttribute(
      "aria-live",
      "assertive"
    );


    notification.setAttribute(
      "aria-atomic",
      "true"
    );


    notification.innerHTML = `

      <div
        id="goalNotificationIcon"
        class="goal-notification-icon"
      >
        ⚽
      </div>


      <div class="goal-notification-content">

        <div
          id="goalNotificationTitle"
          class="goal-notification-title"
        >
          GOLO!
        </div>


        <div
          id="goalNotificationMatch"
          class="goal-notification-match"
        >
          -
        </div>


        <div
          id="goalNotificationScorer"
          class="goal-notification-scorer"
        >
          -
        </div>


        <div
          id="goalNotificationScore"
          class="goal-notification-score"
        >
          -
        </div>


        <div
          id="goalNotificationMinute"
          class="goal-notification-minute"
        >
        </div>

      </div>


      <button
        id="goalNotificationClose"
        class="goal-notification-close"
        type="button"
        aria-label="Fechar notificação"
      >
        ×
      </button>

    `;


    document.body.appendChild(
      notification
    );


    const closeButton =
      document.getElementById(
        "goalNotificationClose"
      );


    if (
      closeButton
    ) {

      closeButton.addEventListener(
        "click",
        hideGoalNotification
      );

    }

  }


  /* ========================================================
     ELEMENTOS
  ======================================================== */

  function getElements() {

    return {

      notification:
        document.getElementById(
          "goalNotification"
        ),

      title:
        document.getElementById(
          "goalNotificationTitle"
        ),

      icon:
        document.getElementById(
          "goalNotificationIcon"
        ),

      match:
        document.getElementById(
          "goalNotificationMatch"
        ),

      scorer:
        document.getElementById(
          "goalNotificationScorer"
        ),

      score:
        document.getElementById(
          "goalNotificationScore"
        ),

      minute:
        document.getElementById(
          "goalNotificationMinute"
        )

    };

  }


  /* ========================================================
     API
  ======================================================== */

  async function goalApi(
    url
  ) {

    const response =
      await fetch(
        `${GOAL_API_URL}${url}`,
        {
          cache:
            "no-store",

          headers: {
            "Accept":
              "application/json"
          }
        }
      );


    const text =
      await response.text();


    let data;


    try {

      data =
        text
          ? JSON.parse(
              text
            )
          : {};

    }

    catch {

      throw new Error(
        "O servidor de notificações devolveu uma resposta inválida."
      );

    }


    if (
      !response.ok
    ) {

      throw new Error(
        data?.error ||
        data?.message ||
        `GOAL HTTP ${response.status}`
      );

    }


    return data;

  }


  /* ========================================================
     EXTRAIR EVENTOS DA RESPOSTA
  ======================================================== */

  function extractEvents(
    data
  ) {

    if (
      Array.isArray(
        data?.goals
      )
    ) {

      return [
        ...data.goals
      ];

    }


    if (
      Array.isArray(
        data?.events
      )
    ) {

      return [
        ...data.events
      ];

    }


    if (
      Array.isArray(
        data?.notifications
      )
    ) {

      return [
        ...data.notifications
      ];

    }


    if (
      Array.isArray(
        data
      )
    ) {

      return [
        ...data
      ];

    }


    return [];

  }


  /* ========================================================
     INICIALIZAR
  ======================================================== */

  async function initializeGoalNotifications() {

    createNotificationStyles();

    createNotificationElement();


    if (
      goalSystemReady
    ) {

      return;

    }


    try {

      const health =
        await goalApi(
          "/api/goals/health"
        );


      if (
        health &&
        health.ok === false
      ) {

        throw new Error(
          "O servidor de notificações respondeu com estado inválido."
        );

      }


      /*
       * Cursor inicial.
       */

      lastGoalCheck =
        new Date().toISOString();


      goalSystemReady =
        true;


      console.log(
        "⚽ Sistema global de notificações ligado."
      );


      console.log(
        "🔔 A ouvir: golos, início e fim de jogos."
      );


      console.log(
        "📡 API:",
        GOAL_API_URL
      );


      /*
       * ======================================================
       * SSE
       * ======================================================
       *
       * O SSE recebe imediatamente:
       *
       * goal
       * match_started
       * match_finished
       *
       * Se o SSE falhar, o polling continua.
       */

      connectGoalSSE();


      /*
       * Primeira verificação.
       */

      setTimeout(
        checkNewGoals,
        1_000
      );


      /*
       * Polling de segurança.
       */

      goalRefreshTimer =
        setInterval(
          checkNewGoals,
          GOAL_REFRESH_INTERVAL
        );


    }

    catch (
      error
    ) {

      goalSystemReady =
        false;


      console.error(
        "❌ Servidor de notificações indisponível:",
        error
      );

    }

  }


  /* ========================================================
     SSE
  ======================================================== */

  function connectGoalSSE() {

    if (
      typeof EventSource ===
      "undefined"
    ) {

      console.warn(
        "⚠️ Este navegador não suporta SSE."
      );


      console.warn(
        "🔄 O sistema continuará através de polling."
      );


      return;

    }


    /*
     * Fechar ligação anterior.
     */

    if (
      goalEventSource
    ) {

      try {

        goalEventSource.close();

      }

      catch {
        // Ignorar.
      }


      goalEventSource =
        null;

    }


    console.log(
      "📡 A ligar ao SSE:",
      GOAL_SSE_URL
    );


    try {

      const source =
        new EventSource(
          GOAL_SSE_URL
        );


      goalEventSource =
        source;


      /*
       * ======================================================
       * CONNECTED
       * ======================================================
       */

      source.addEventListener(
        "connected",
        event => {

          goalSseConnected =
            true;


          console.log(
            "📡 SSE conectado."
          );


          try {

            const data =
              JSON.parse(
                event.data ||
                "{}"
              );


            console.log(
              "📡 SSE informação:",
              data
            );

          }

          catch {
            // O evento connected pode não ter JSON.
          }

        }
      );


      /*
       * ======================================================
       * GOAL
       * ======================================================
       */

      source.addEventListener(
        "goal",
        event => {

          handleSSENotification(
            event,
            "goal"
          );

        }
      );


      /*
       * ======================================================
       * MATCH STARTED
       * ======================================================
       */

      source.addEventListener(
        "match_started",
        event => {

          handleSSENotification(
            event,
            "match_started"
          );

        }
      );


      /*
       * ======================================================
       * MATCH FINISHED
       * ======================================================
       */

      source.addEventListener(
        "match_finished",
        event => {

          handleSSENotification(
            event,
            "match_finished"
          );

        }
      );


      /*
       * ======================================================
       * LIVE_STATE
       * ======================================================
       *
       * Não gera notificação.
       *
       * É apenas informação do estado live.
       */

      source.addEventListener(
        "LIVE_STATE",
        event => {

          try {

            const data =
              JSON.parse(
                event.data ||
                "{}"
              );


            console.log(
              "📡 LIVE_STATE:",
              data
            );

          }

          catch {
            // Ignorar estado inválido.
          }

        }
      );


      /*
       * ======================================================
       * ERRO SSE
       * ======================================================
       *
       * NÃO fechamos manualmente o EventSource.
       *
       * O browser tenta automaticamente
       * reconectar.
       */

      source.onerror =
        () => {

          if (
            goalSseConnected
          ) {

            console.warn(
              "⚠️ Ligação SSE perdida."
            );

          }


          goalSseConnected =
            false;


          console.warn(
            "🔄 SSE indisponível. Polling continua ativo."
          );

        };

    }

    catch (
      error
    ) {

      goalSseConnected =
        false;


      console.error(
        "❌ Erro ao criar SSE:",
        error
      );

    }

  }


  /* ========================================================
     PROCESSAR EVENTO SSE
  ======================================================== */

  function handleSSENotification(
    sseEvent,
    fallbackType
  ) {

    try {

      const rawData =
        JSON.parse(
          sseEvent.data ||
          "{}"
        );


      /*
       * O backend normalmente já envia:
       *
       * {
       *   type: "goal",
       *   ...
       * }
       *
       * Mas usamos fallbackType caso não venha type.
       */

      const event = {

        ...rawData,

        type:
          rawData?.type ||
          fallbackType

      };


      /*
       * Identificar tipo.
       */

      const notificationType =
        getNotificationType(
          event
        );


      if (
        !notificationType
      ) {

        console.warn(
          "⚠️ Evento SSE desconhecido:",
          event
        );


        return;

      }


      /*
       * Criar ID.
       */

      const eventId =
        getEventId(
          event,
          notificationType
        );


      /*
       * O mesmo evento pode chegar:
       *
       * 1. SSE
       * 2. polling
       *
       * Por isso é importante verificar
       * seenEventIds.
       */

      if (
        seenEventIds.has(
          eventId
        )
      ) {

        return;

      }


      seenEventIds.add(
        eventId
      );


      trimSeenEvents();


      console.log(
        `📡 SSE → ${notificationType}`,
        event
      );


      /*
       * Colocar na fila.
       */

      enqueueGoalNotification(
        event
      );

    }

    catch (
      error
    ) {

      console.error(
        `❌ Erro a processar SSE (${fallbackType}):`,
        error
      );

    }

  }


  /* ========================================================
     PROCURAR NOVOS EVENTOS
  ======================================================== */

  async function checkNewGoals() {

    if (
      !goalSystemReady ||
      goalRequestInProgress ||
      !lastGoalCheck
    ) {

      return;

    }


    goalRequestInProgress =
      true;


    const checkStartedAt =
      new Date().toISOString();


    try {

      const url =
        `/api/goals/since?since=${encodeURIComponent(
          lastGoalCheck
        )}`;


      const data =
        await goalApi(
          url
        );


      const events =
        extractEvents(
          data
        );


      /*
       * Ordenar cronologicamente.
       */

      events.sort(
        (
          a,
          b
        ) => {

          const timeA =
            new Date(
              a?.createdAt ||
              a?.created_at ||
              a?.timestamp ||
              a?.time ||
              0
            ).getTime();


          const timeB =
            new Date(
              b?.createdAt ||
              b?.created_at ||
              b?.timestamp ||
              b?.time ||
              0
            ).getTime();


          return (
            timeA -
            timeB
          );

        }
      );


      /*
       * Processar eventos.
       */

      for (
        const event of events
      ) {

        if (
          !event
        ) {

          continue;

        }


        const notificationType =
          getNotificationType(
            event
          );


        if (
          !notificationType
        ) {

          console.warn(
            "⚠️ Tipo de evento desconhecido:",
            event
          );


          continue;

        }


        const eventId =
          getEventId(
            event,
            notificationType
          );


        /*
         * Pode já ter chegado através do SSE.
         */

        if (
          seenEventIds.has(
            eventId
          )
        ) {

          continue;

        }


        seenEventIds.add(
          eventId
        );


        trimSeenEvents();


        enqueueGoalNotification(
          event
        );

      }


      /*
       * Avançar cursor.
       */

      lastGoalCheck =
        data?.serverTime ||
        data?.server_time ||
        checkStartedAt;

    }

    catch (
      error
    ) {

      console.error(
        "❌ Erro ao procurar novas notificações:",
        error
      );

    }

    finally {

      goalRequestInProgress =
        false;

    }

  }


  /* ========================================================
     ID DO EVENTO
  ======================================================== */

  function getEventId(
    event,
    type
  ) {

    /*
     * IMPORTANTE:
     *
     * Se o backend envia id:
     *
     * id = "123:match_started"
     *
     * usamos diretamente.
     */

    if (
      event?.id !== undefined &&
      event?.id !== null
    ) {

      return String(
        event.id
      );

    }


    if (
      event?.eventId !== undefined &&
      event?.eventId !== null
    ) {

      return String(
        event.eventId
      );

    }


    if (
      event?.event_id !== undefined &&
      event?.event_id !== null
    ) {

      return String(
        event.event_id
      );

    }


    /*
     * Alguns eventos de jogo podem ter matchId.
     */

    const matchId =
      event?.matchId ??
      event?.match_id ??
      event?.fixtureId ??
      event?.fixture_id ??
      event?.match?.id ??
      event?.fixture?.id ??
      "";


    const timestamp =
      event?.createdAt ||
      event?.created_at ||
      event?.timestamp ||
      event?.time ||
      "";


    const minute =
      event?.minute ??
      event?.matchMinute ??
      event?.match_minute ??
      "";


    /*
     * Para golos tentamos também incluir
     * jogador/equipa/resultado.
     */

    const scorer =
      event?.scorer ||
      event?.player ||
      event?.playerName ||
      event?.player_name ||
      event?.goal?.player?.name ||
      "";


    const score =
      getScore(
        event
      );


    return [
      type,
      matchId,
      timestamp,
      minute,
      scorer,
      score.home,
      score.away
    ]
      .join("|");

  }


  /* ========================================================
     LIMITAR EVENTOS VISTOS
  ======================================================== */

  function trimSeenEvents() {

    while (
      seenEventIds.size >
      MAX_SEEN_EVENTS
    ) {

      const oldest =
        seenEventIds
          .values()
          .next()
          .value;


      if (
        oldest === undefined
      ) {

        break;

      }


      seenEventIds.delete(
        oldest
      );

    }

  }


  /* ========================================================
     FILA DE NOTIFICAÇÕES
  ======================================================== */

  function enqueueGoalNotification(
    event
  ) {

    if (
      !event
    ) {

      return;

    }


    const type =
      getNotificationType(
        event
      );


    if (
      !type
    ) {

      return;

    }


    const normalizedEvent = {

      ...event,

      notificationType:
        type

    };


    goalNotificationQueue.push(
      normalizedEvent
    );


    showNextGoalNotification();

  }


  /* ========================================================
     PRÓXIMA NOTIFICAÇÃO
  ======================================================== */

  function showNextGoalNotification() {

    if (
      goalNotificationShowing
    ) {

      return;

    }


    const event =
      goalNotificationQueue.shift();


    if (
      !event
    ) {

      return;

    }


    goalNotificationShowing =
      true;


    const type =
      event.notificationType ||
      getNotificationType(
        event
      );


    switch (
      type
    ) {

      case "match_started":

        showMatchNotification(
          event
        );

        break;


      case "match_finished":

        showMatchNotification(
          event
        );

        break;


      case "goal":

        showGoalNotification(
          event
        );

        break;


      default:

        goalNotificationShowing =
          false;


        showNextGoalNotification();

        break;

    }

  }


  /* ========================================================
     NOME DA EQUIPA
  ======================================================== */

  function getTeamName(
    team,
    fallback = ""
  ) {

    if (
      typeof team === "string" &&
      team.trim()
    ) {

      return team.trim();

    }


    if (
      team?.name
    ) {

      return String(
        team.name
      ).trim();

    }


    if (
      team?.shortName
    ) {

      return String(
        team.shortName
      ).trim();

    }


    if (
      team?.short_name
    ) {

      return String(
        team.short_name
      ).trim();

    }


    if (
      team?.teamName
    ) {

      return String(
        team.teamName
      ).trim();

    }


    if (
      team?.team_name
    ) {

      return String(
        team.team_name
      ).trim();

    }


    return fallback;

  }


  /* ========================================================
     EQUIPA CASA
  ======================================================== */

  function getHomeTeam(
    event
  ) {

    return (

      getTeamName(
        event?.homeTeam,
        ""
      ) ||

      getTeamName(
        event?.home,
        ""
      ) ||

      getTeamName(
        event?.home_team,
        ""
      ) ||

      event?.homeName ||

      event?.home_name ||

      event?.home_team_name ||

      event?.teams?.home?.name ||

      event?.match?.homeTeam?.name ||

      event?.match?.home?.name ||

      "Casa"

    );

  }


  /* ========================================================
     EQUIPA FORA
  ======================================================== */

  function getAwayTeam(
    event
  ) {

    return (

      getTeamName(
        event?.awayTeam,
        ""
      ) ||

      getTeamName(
        event?.away,
        ""
      ) ||

      getTeamName(
        event?.away_team,
        ""
      ) ||

      event?.awayName ||

      event?.away_name ||

      event?.away_team_name ||

      event?.teams?.away?.name ||

      event?.match?.awayTeam?.name ||

      event?.match?.away?.name ||

      "Fora"

    );

  }


  /* ========================================================
     RESULTADO
  ======================================================== */

  function getScore(
    event
  ) {

    let homeScore =
      event?.homeScore ??
      event?.home_score ??
      event?.score?.home ??
      event?.score?.homeScore ??
      event?.result?.home ??
      event?.result?.homeScore ??
      event?.homeGoals ??
      event?.home_goals;


    let awayScore =
      event?.awayScore ??
      event?.away_score ??
      event?.score?.away ??
      event?.score?.awayScore ??
      event?.result?.away ??
      event?.result?.awayScore ??
      event?.awayGoals ??
      event?.away_goals;


    /*
     * score: "2-1"
     */

    if (
      (
        homeScore === undefined ||
        homeScore === null
      ) &&
      typeof event?.score === "string"
    ) {

      const parts =
        event.score
          .split("-")
          .map(
            value =>
              Number(
                value.trim()
              )
          );


      if (
        parts.length >= 2
      ) {

        homeScore =
          parts[0];

        awayScore =
          parts[1];

      }

    }


    const home =
      Number(
        homeScore ?? 0
      );


    const away =
      Number(
        awayScore ?? 0
      );


    return {

      home:
        Number.isFinite(
          home
        )
          ? home
          : 0,

      away:
        Number.isFinite(
          away
        )
          ? away
          : 0

    };

  }


  /* ========================================================
     MINUTO
  ======================================================== */

  function getMinute(
    event
  ) {

    return (
      event?.minute ??
      event?.matchMinute ??
      event?.match_minute ??
      event?.elapsed ??
      event?.elapsedMinutes ??
      event?.elapsed_minutes ??
      null
    );

  }


  /* ========================================================
     GOLO
  ======================================================== */

  function showGoalNotification(
    goal
  ) {

    const elements =
      getElements();


    if (
      !elements.notification
    ) {

      goalNotificationShowing =
        false;

      return;

    }


    const home =
      getHomeTeam(
        goal
      );


    const away =
      getAwayTeam(
        goal
      );


    const score =
      getScore(
        goal
      );


    const side =
      String(
        goal?.side ||
        goal?.teamSide ||
        goal?.team_side ||
        ""
      )
        .trim()
        .toLowerCase();


    let scoringTeam =
      goal?.teamName ||
      goal?.team_name ||
      goal?.teamScored ||
      goal?.team_scored ||
      goal?.scoringTeam ||
      goal?.scoringTeamName ||
      goal?.scoring_team ||
      "";


    if (
      side === "home" ||
      side === "casa"
    ) {

      scoringTeam =
        home;

    }


    if (
      side === "away" ||
      side === "fora"
    ) {

      scoringTeam =
        away;

    }


    elements.title.textContent =
      "GOLO!";


    elements.icon.textContent =
      "⚽";


    elements.match.textContent =
      `${home} vs ${away}`;


    elements.scorer.textContent =
      scoringTeam
        ? `GOLO DO ${String(
            scoringTeam
          ).toUpperCase()}`
        : "GOLO!";


    if (
      side === "home" ||
      side === "casa"
    ) {

      elements.score.innerHTML = `

        <span class="goal-score-highlight">
          ${score.home}
        </span>

        <span class="goal-score-separator">
          -
        </span>

        <span>
          ${score.away}
        </span>

      `;

    }

    else if (
      side === "away" ||
      side === "fora"
    ) {

      elements.score.innerHTML = `

        <span>
          ${score.home}
        </span>

        <span class="goal-score-separator">
          -
        </span>

        <span class="goal-score-highlight">
          ${score.away}
        </span>

      `;

    }

    else {

      elements.score.textContent =
        `${score.home} - ${score.away}`;

    }


    const minute =
      getMinute(
        goal
      );


    if (
      minute !== null &&
      minute !== undefined &&
      minute !== ""
    ) {

      elements.minute.textContent =
        `${minute}'`;

    }

    else {

      elements.minute.textContent =
        "";

    }


    displayNotification(
      "goal"
    );

  }


  /* ========================================================
     INÍCIO / FIM
  ======================================================== */

  function showMatchNotification(
    event
  ) {

    const elements =
      getElements();


    if (
      !elements.notification
    ) {

      goalNotificationShowing =
        false;

      return;

    }


    const type =
      event.notificationType ||
      getNotificationType(
        event
      );


    const home =
      getHomeTeam(
        event
      );


    const away =
      getAwayTeam(
        event
      );


    const score =
      getScore(
        event
      );


    elements.match.textContent =
      `${home} vs ${away}`;


    elements.score.textContent =
      `${score.home} - ${score.away}`;


    elements.minute.textContent =
      "";


    /*
     * INÍCIO
     */

    if (
      type === "match_started"
    ) {

      elements.title.textContent =
        "JOGO COMEÇOU";


      elements.icon.textContent =
        "🟢";


      elements.scorer.textContent =
        "🟢 O jogo começou";


      displayNotification(
        "match_started"
      );


      return;

    }


    /*
     * FIM
     */

    if (
      type === "match_finished"
    ) {

      elements.title.textContent =
        "FIM DO JOGO";


      elements.icon.textContent =
        "🏁";


      elements.scorer.textContent =
        "🏁 O jogo terminou";


      displayNotification(
        "match_finished"
      );


      return;

    }


    goalNotificationShowing =
      false;


    showNextGoalNotification();

  }


  /* ========================================================
     MOSTRAR NOTIFICAÇÃO
  ======================================================== */

  function displayNotification(
    notificationType = "goal"
  ) {

    const elements =
      getElements();


    if (
      !elements.notification
    ) {

      goalNotificationShowing =
        false;

      return;

    }


    elements.notification.classList.remove(
      "notification-goal",
      "notification-start",
      "notification-finish"
    );


    switch (
      notificationType
    ) {

      case "match_started":

        elements.notification.classList.add(
          "notification-start"
        );

        break;


      case "match_finished":

        elements.notification.classList.add(
          "notification-finish"
        );

        break;


      case "goal":

      default:

        elements.notification.classList.add(
          "notification-goal"
        );

        break;

    }


    elements.notification.classList.remove(
      "show"
    );


    requestAnimationFrame(
      () => {

        requestAnimationFrame(
          () => {

            elements.notification.classList.add(
              "show"
            );

          }
        );

      }
    );


    playNotificationSound(
      notificationType
    );


    if (
      navigator.vibrate
    ) {

      try {

        if (
          notificationType ===
          "match_started"
        ) {

          navigator.vibrate([
            100
          ]);

        }

        else if (
          notificationType ===
          "match_finished"
        ) {

          navigator.vibrate([
            150,
            100,
            150
          ]);

        }

        else {

          navigator.vibrate([
            200,
            100,
            200
          ]);

        }

      }

      catch {
        // Ignorar.
      }

    }


    clearTimeout(
      goalNotificationTimer
    );


    goalNotificationTimer =
      setTimeout(
        hideGoalNotification,
        NOTIFICATION_DURATION
      );

  }


  /* ========================================================
     ESCONDER
  ======================================================== */

  function hideGoalNotification() {

    const elements =
      getElements();


    clearTimeout(
      goalNotificationTimer
    );


    goalNotificationTimer =
      null;


    if (
      elements.notification
    ) {

      elements.notification.classList.remove(
        "show"
      );

    }


    setTimeout(
      () => {

        goalNotificationShowing =
          false;


        showNextGoalNotification();

      },
      350
    );

  }


  /* ========================================================
     DESBLOQUEAR ÁUDIO
  ======================================================== */

  function unlockGoalAudio() {

    try {

      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;


      if (
        !AudioContext
      ) {

        return;

      }


      if (
        !goalAudioContext
      ) {

        goalAudioContext =
          new AudioContext();

      }


      if (
        goalAudioContext.state ===
        "suspended"
      ) {

        goalAudioContext
          .resume()
          .catch(
            () => {}
          );

      }

    }

    catch (
      error
    ) {

      console.warn(
        "Não foi possível ativar o áudio:",
        error
      );

    }

  }


  /* ========================================================
     SOM
  ======================================================== */

  function playNotificationSound(
    type
  ) {

    try {

      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;


      if (
        !AudioContext
      ) {

        return;

      }


      if (
        !goalAudioContext
      ) {

        goalAudioContext =
          new AudioContext();

      }


      if (
        goalAudioContext.state ===
        "suspended"
      ) {

        goalAudioContext
          .resume()
          .catch(
            () => {}
          );

      }


      const ctx =
        goalAudioContext;


      if (
        type === "goal"
      ) {

        playGoalSound(
          ctx
        );

        return;

      }


      if (
        type === "match_started"
      ) {

        playStartSound(
          ctx
        );

        return;

      }


      if (
        type === "match_finished"
      ) {

        playFinishSound(
          ctx
        );

        return;

      }

    }

    catch (
      error
    ) {

      console.warn(
        "Não foi possível reproduzir o som:",
        error
      );

    }

  }


  /* ========================================================
     SOM DO GOLO
  ======================================================== */

  function playGoalSound(
    ctx
  ) {

    const start =
      ctx.currentTime;


    playTone(
      ctx,
      523.25,
      start,
      0.15,
      0.20
    );


    playTone(
      ctx,
      659.25,
      start + 0.16,
      0.15,
      0.20
    );


    playTone(
      ctx,
      783.99,
      start + 0.32,
      0.18,
      0.20
    );


    playTone(
      ctx,
      1046.50,
      start + 0.52,
      0.40,
      0.20
    );

  }


  /* ========================================================
     SOM DE INÍCIO
  ======================================================== */

  function playStartSound(
    ctx
  ) {

    const start =
      ctx.currentTime;


    playTone(
      ctx,
      659.25,
      start,
      0.15,
      0.16
    );


    playTone(
      ctx,
      783.99,
      start + 0.18,
      0.20,
      0.16
    );


    playTone(
      ctx,
      987.77,
      start + 0.40,
      0.30,
      0.18
    );

  }


  /* ========================================================
     SOM DE FIM
  ======================================================== */

  function playFinishSound(
    ctx
  ) {

    const start =
      ctx.currentTime;


    playTone(
      ctx,
      783.99,
      start,
      0.20,
      0.16
    );


    playTone(
      ctx,
      659.25,
      start + 0.22,
      0.20,
      0.16
    );


    playTone(
      ctx,
      523.25,
      start + 0.44,
      0.40,
      0.18
    );

  }


  /* ========================================================
     TOCAR TOM
  ======================================================== */

  function playTone(
    ctx,
    frequency,
    start,
    duration,
    volume
  ) {

    const oscillator =
      ctx.createOscillator();


    const gain =
      ctx.createGain();


    oscillator.type =
      "sine";


    oscillator.frequency.setValueAtTime(
      frequency,
      start
    );


    gain.gain.setValueAtTime(
      0.0001,
      start
    );


    gain.gain.exponentialRampToValueAtTime(
      volume,
      start + 0.02
    );


    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + duration
    );


    oscillator.connect(
      gain
    );


    gain.connect(
      ctx.destination
    );


    oscillator.start(
      start
    );


    oscillator.stop(
      start +
      duration +
      0.05
    );

  }


  /* ========================================================
     SOM PÚBLICO
  ======================================================== */

  function playGoalSoundPublic() {

    try {

      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;


      if (
        !AudioContext
      ) {

        return;

      }


      if (
        !goalAudioContext
      ) {

        goalAudioContext =
          new AudioContext();

      }


      if (
        goalAudioContext.state ===
        "suspended"
      ) {

        goalAudioContext
          .resume()
          .catch(
            () => {}
          );

      }


      playGoalSound(
        goalAudioContext
      );

    }

    catch (
      error
    ) {

      console.warn(
        "Não foi possível reproduzir o som:",
        error
      );

    }

  }


  /* ========================================================
     TESTES MANUAIS
  ======================================================== */

  function testGoal() {

    enqueueGoalNotification({

      id:
        `test-goal-${Date.now()}`,

      type:
        "goal",

      homeTeam:
        "Benfica",

      awayTeam:
        "Porto",

      side:
        "home",

      teamName:
        "Benfica",

      homeScore:
        1,

      awayScore:
        0,

      minute:
        32

    });

  }


  function testMatchStarted() {

    enqueueGoalNotification({

      id:
        `test-start-${Date.now()}`,

      type:
        "match_started",

      homeTeam:
        "Benfica",

      awayTeam:
        "Porto",

      homeScore:
        0,

      awayScore:
        0

    });

  }


  function testMatchFinished() {

    enqueueGoalNotification({

      id:
        `test-finish-${Date.now()}`,

      type:
        "match_finished",

      homeTeam:
        "Benfica",

      awayTeam:
        "Porto",

      homeScore:
        2,

      awayScore:
        1

    });

  }


  /* ========================================================
     TESTAR SSE
  ======================================================== */

  function testSSE() {

    console.log(
      "📡 SSE URL:",
      GOAL_SSE_URL
    );


    console.log(
      "📡 SSE ligado:",
      goalSseConnected
    );


    console.log(
      "📡 EventSource:",
      goalEventSource
    );

  }


  /* ========================================================
     VISIBILIDADE
  ======================================================== */

  function handleVisibilityChange() {

    if (
      document.visibilityState ===
      "visible"
    ) {

      checkNewGoals();

    }

  }


  /* ========================================================
     LIMPEZA
  ======================================================== */

  function destroy() {

    if (
      goalRefreshTimer
    ) {

      clearInterval(
        goalRefreshTimer
      );

    }


    if (
      goalNotificationTimer
    ) {

      clearTimeout(
        goalNotificationTimer
      );

    }


    /*
     * Fechar SSE.
     */

    if (
      goalEventSource
    ) {

      try {

        goalEventSource.close();

      }

      catch {
        // Ignorar.
      }


      goalEventSource =
        null;

    }


    goalSseConnected =
      false;


    goalRefreshTimer =
      null;


    goalNotificationTimer =
      null;


    goalNotificationQueue =
      [];


    goalNotificationShowing =
      false;


    goalSystemReady =
      false;


    goalRequestInProgress =
      false;

  }


  /* ========================================================
     API PÚBLICA
  ======================================================== */

  window.FootballNotifications = {

    enqueue:
      enqueueGoalNotification,

    check:
      checkNewGoals,

    hide:
      hideGoalNotification,

    playSound:
      playGoalSoundPublic,

    start:
      initializeGoalNotifications,

    destroy,

    connectSSE:
      connectGoalSSE,

    testGoal,

    testMatchStarted,

    testMatchFinished,

    testSSE

  };


  /* ========================================================
     EVENTOS
  ======================================================== */

  document.addEventListener(
    "pointerdown",
    unlockGoalAudio,
    {
      passive: true,
      once: true
    }
  );


  document.addEventListener(
    "visibilitychange",
    handleVisibilityChange
  );


  window.addEventListener(
    "beforeunload",
    destroy
  );


  /* ========================================================
     START AUTOMÁTICO
  ======================================================== */

  function start() {

    createNotificationStyles();

    createNotificationElement();


    initializeGoalNotifications()
      .catch(
        error => {

          console.error(
            "❌ Erro ao iniciar notificações:",
            error
          );

        }
      );

  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once: true
      }
    );

  }

  else {

    start();

  }


})();