# Auto-Chess — Web Front-End

Starter web app for the [Auto-Chess](https://github.com/diploma-sdc-2025/front-end) diploma project. Built with **Vite**, **React 19**, and **TypeScript**.

## Features

- **Auth**: Login and register (JWT stored in `localStorage`; refresh token for session).
- **Lobby**: Join/leave matchmaking queue; queue status (position, size).
- **Game**: Placeholder page for match view — ready to wire to game-service and battle-service.

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

## Backend URLs

Configure in `.env` (all optional; defaults shown):

| Variable | Default | Service |
|----------|---------|---------|
| `VITE_AUTH_URL` | `http://localhost:8081` | Auth |
| `VITE_MATCHMAKING_URL` | `http://localhost:8082` | Matchmaking |
| `VITE_GAME_URL` | `http://localhost:8080` | Game |
| `VITE_BATTLE_URL` | `http://localhost:8083` | Battle |
| `VITE_ANALYTICS_URL` | `http://localhost:8084` | Analytics |

For same-origin API access you can use Vite proxy in `vite.config.ts` (e.g. `/api` → game service).

## Scripts

- `npm run dev` — Start dev server.
- `npm run build` — Production build.
- `npm run preview` — Preview production build locally.

## Project structure

```
src/
  api/          # API clients (auth, matchmaking, game) and config
  context/      # AuthContext (token, login, logout)
  pages/        # Home, Login, Register, Lobby, Game (placeholder)
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
