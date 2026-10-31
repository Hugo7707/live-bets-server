/* ==========================================================
   EQUIPAS — NBA / NHL
========================================================== */

const SPORTS_TEAMS = {

  basketball: [
    "Atlanta Hawks",
    "Boston Celtics",
    "Brooklyn Nets",
    "Charlotte Hornets",
    "Chicago Bulls",
    "Cleveland Cavaliers",
    "Dallas Mavericks",
    "Denver Nuggets",
    "Detroit Pistons",
    "Golden State Warriors",
    "Houston Rockets",
    "Indiana Pacers",
    "Los Angeles Clippers",
    "Los Angeles Lakers",
    "Memphis Grizzlies",
    "Miami Heat",
    "Milwaukee Bucks",
    "Minnesota Timberwolves",
    "New Orleans Pelicans",
    "New York Knicks",
    "Oklahoma City Thunder",
    "Orlando Magic",
    "Philadelphia 76ers",
    "Phoenix Suns",
    "Portland Trail Blazers",
    "Sacramento Kings",
    "San Antonio Spurs",
    "Toronto Raptors",
    "Utah Jazz",
    "Washington Wizards"
  ],

  hockey: [
    "Anaheim Ducks",
    "Boston Bruins",
    "Buffalo Sabres",
    "Calgary Flames",
    "Carolina Hurricanes",
    "Chicago Blackhawks",
    "Colorado Avalanche",
    "Columbus Blue Jackets",
    "Dallas Stars",
    "Detroit Red Wings",
    "Edmonton Oilers",
    "Florida Panthers",
    "Los Angeles Kings",
    "Minnesota Wild",
    "Montreal Canadiens",
    "Nashville Predators",
    "New Jersey Devils",
    "New York Islanders",
    "New York Rangers",
    "Ottawa Senators",
    "Philadelphia Flyers",
    "Pittsburgh Penguins",
    "San Jose Sharks",
    "Seattle Kraken",
    "St. Louis Blues",
    "Tampa Bay Lightning",
    "Toronto Maple Leafs",
    "Utah Mammoth",
    "Vancouver Canucks",
    "Vegas Golden Knights",
    "Washington Capitals",
    "Winnipeg Jets"
  ]

};


/* ==========================================================
   OBTER EQUIPAS
========================================================== */

function getTeamsForSport(sport) {

  return SPORTS_TEAMS[sport] || [];

}


/* ==========================================================
   CRIAR OPTIONS
========================================================== */

function createTeamOptions(
  sport,
  selectedValue = ""
) {

  const teams =
    getTeamsForSport(sport);


  let html = `
    <option value="">
      -- Escolhe uma equipa --
    </option>
  `;


  teams.forEach(team => {

    const selected =
      team === selectedValue
        ? "selected"
        : "";


    html += `
      <option
        value="${team}"
        ${selected}
      >
        ${team}
      </option>
    `;

  });


  return html;

}