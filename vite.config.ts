import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * When front-end uses same-origin URLs (empty VITE_* in dev), these forward
 * `/api/...` to the correct microservice ports on localhost.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    /** IPv4 loopback so nginx `proxy_pass http://127.0.0.1:3000` works (avoid IPv6-only listen). */
    host: '127.0.0.1',
    // nginx forwards Host: kon-autochess.francecentral.cloudapp.azure.com
    allowedHosts: ['kon-autochess.francecentral.cloudapp.azure.com'],
    proxy: {
      '/api/auth': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
      '/api/users': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
      '/api/matchmaking': {
        target: 'http://localhost:8082',
        changeOrigin: true,
      },
      '/api/game': {
        // Same host ports as deployement/docker-compose.yml (game-service 8083:8080)
        target: 'http://localhost:8083',
        changeOrigin: true,
      },
      '/api/battle': {
        target: 'http://localhost:8084',
        changeOrigin: true,
      },
      '/api/analytics': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
