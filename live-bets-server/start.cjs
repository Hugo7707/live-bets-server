const { spawn } = require("child_process");

const servidores = [
  "server.cjs",
  /*"live-server.cjs",
  "goal-server.cjs"*/
  "live-goal-server.cjs",
];

servidores.forEach((servidor) => {
  const processo = spawn("node", [servidor], {
    stdio: "inherit"
  });

  processo.on("error", (erro) => {
    console.error(`Erro ao iniciar ${servidor}:`, erro);
  });

  processo.on("exit", (codigo) => {
    console.log(`${servidor} terminou com código ${codigo}`);
  });
});