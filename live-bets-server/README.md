# Live Bets Server — JavaScript/Node.js

Servidor Express para alimentar a página com todos os jogos de futebol em direto usando API-Football.

## Instalar

```bash
npm install
cp .env.example .env
```

Edita `.env` e coloca a tua chave em `API_FOOTBALL_KEY`.

## Executar

```bash
npm start
```

Abre `http://localhost:3000`.

## API local

- `GET /api/health`
- `GET /api/live-matches` — todos os jogos em direto
- `GET /api/live-matches/:id` — detalhe de um jogo
- `GET /api/live-matches/:id/events` — eventos do jogo

A chave da API fica apenas no servidor. O backend faz cache curto de 12 segundos e o frontend atualiza a cada 15 segundos.
