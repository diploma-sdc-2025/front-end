import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext.tsx'
import { Home } from './pages/Home.tsx'
import { Login } from './pages/Login.tsx'
import { Register } from './pages/Register.tsx'
import { Lobby } from './pages/Lobby.tsx'
import { Game } from './pages/Game.tsx'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/game/:matchId" element={<Game />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
