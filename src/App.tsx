import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext.tsx'
import { Home } from './pages/Home.tsx'
import { Login } from './pages/Login.tsx'
import { Register } from './pages/Register.tsx'
import { Game } from './pages/Game.tsx'
import { AdminAnalytics } from './pages/AdminAnalytics.tsx'

/**
 * Fresh key on every navigation to `/game/:id` so local board/shop state cannot survive a new queue pop
 * when the match id in the URL is unchanged (e.g. reused match row id 6).
 */
function GameRoute() {
  const { matchId } = useParams<{ matchId: string }>()
  const location = useLocation()
  const assignedAt =
    typeof location.state === 'object' &&
    location.state !== null &&
    'matchAssignedAt' in location.state &&
    typeof (location.state as { matchAssignedAt?: unknown }).matchAssignedAt === 'number'
      ? (location.state as { matchAssignedAt: number }).matchAssignedAt
      : null
  const remountKey = `${matchId ?? ''}-${assignedAt ?? location.key}`
  return <Game key={remountKey} />
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/lobby" element={<Navigate to="/" replace />} />
          <Route path="/game/tutorial" element={<Game mode="tutorial" />} />
          <Route path="/game/:matchId" element={<GameRoute />} />
          <Route path="/admin/analytics" element={<AdminAnalytics />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
