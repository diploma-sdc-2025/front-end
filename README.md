# Auto-Chess - Web Front-End

Starter web app for the [Auto-Chess](https://github.com/diploma-sdc-2025/front-end) diploma project. Built with **Vite**, **React 19**, and **TypeScript**.

## Features

- **Auth**: Calls auth-service `POST /api/auth/login` (and register/refresh/logout). Tokens in `localStorage`.
- **Matchmaking**: `POST /api/matchmaking/join`, polls `GET /api/matchmaking/status`, `POST /api/matchmaking/leave`. Redirects to `/game/:matchId` when the server returns `matchId` (or `match_id`) on join or status.
- **Game**: Loads `GET /api/game/matches/:id` and `GET .../state` for the match screen.
- **Analytics**: Leaderboard (`GET /api/analytics/leaderboard`), per-user stats, live Redis metrics (`GET /api/analytics/live`). Usernames via `GET /api/users/by-ids` (JWT).

## Prerequisites

- Node.js 18+
- Backend services running (auth, matchmaking, game at minimum).

## Setup

```bash
# Install dependencies
npm install

# Copy env and set backend URLs if needed
cp .env.example .env

# Start dev server (default: http://localhost:3000)
npm run dev
```

## Backend URLs & proxy

| Variable | Production default (if unset in `.env`) | Service |
|----------|----------------------------------------|---------|
| `VITE_AUTH_URL` | `http://localhost:8081` | Auth |
| `VITE_MATCHMAKING_URL` | `http://localhost:8082` | Matchmaking |
| `VITE_GAME_URL` | `http://localhost:8083` | Game (see `deployement/docker-compose.yml`) |
| `VITE_BATTLE_URL` | `http://localhost:8084` | Battle |
| `VITE_ANALYTICS_URL` | `http://localhost:8080` | Analytics |

**Development:** if `VITE_*` are **empty or omitted**, the app uses **relative** `/api/...` URLs and `vite.config.ts` forwards `/api/auth`, `/api/users`, `/api/matchmaking`, `/api/game`, `/api/battle`, `/api/analytics` to the correct localhost ports (see `.env.example`).

**Production build:** set each `VITE_*` to your deployed API bases (or a single API gateway URL if all routes share one host).

### Matchmaking contract (aligned with `matchmaking-service`)

- `GET /api/matchmaking/status` includes optional **`matchId`** after pairing: when the user is **no longer in the queue**, the service returns a recent game match id (same field names as Java: `matchId`) so the UI can open `/game/:matchId`.
- `POST /api/matchmaking/join` returns `status`, `userId`, `queueSize`, `joinedAt` (records in this repo).

Run stacks with **`deployement/docker-compose.yml`**: auth **8081**, matchmaking **8082**, game **8083**, battle **8084** (host ports).

## Scripts

- `npm run dev` - Start dev server.
- `npm run build` - Production build.
- `npm run preview` - Preview production build locally.

## Project structure

```
src/
  api/          # API clients (auth, matchmaking, game) and config
  hooks/        # useMatchmakingQueue (join + poll + redirect)
  context/      # AuthContext (real auth-service calls)
  pages/        # Home, Login, Lobby, Game
  App.tsx       # Router and routes
  main.tsx      # Entry
```

## Pushing to GitHub

This folder is intended for the [diploma-sdc-2025/front-end](https://github.com/diploma-sdc-2025/front-end) repo:

```bash
cd front-end
git init
git add .
git commit -m "Web starter: Vite + React + TypeScript"
git remote add origin https://github.com/diploma-sdc-2025/front-end.git
git branch -M main
git push -u origin main
```

## Next steps

- Add **WebSocket** or push notifications for matchmaking if you move beyond HTTP polling.
- **Game screen**: board/shop from `GET .../board`, battles via battle-service.
