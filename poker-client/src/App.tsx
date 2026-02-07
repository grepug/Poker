import { useEffect } from "react";
import {
  BrowserRouter as Router,
  useLocation,
  Routes,
  Route,
  useNavigate,
} from "react-router-dom";
import { SocketProvider } from "./contexts/SocketContext";
import { GameProvider, useGame } from "./contexts/GameContext";
import { Home } from "./pages/Home";
import { GameRoom } from "./components/GameRoom";

const UrlStateSync: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { room, player, isRecoveringSession } = useGame();

  useEffect(() => {
    const activeRoomId = room?.id?.toUpperCase();
    const hasActiveSession = Boolean(activeRoomId && player?.id);

    if (hasActiveSession) {
      const targetRoomPath = `/room/${activeRoomId}`;
      if (location.pathname !== targetRoomPath) {
        navigate(targetRoomPath, { replace: true });
      }
      return;
    }

    if (isRecoveringSession) {
      return;
    }

    const roomPathMatch = location.pathname.match(/^\/room\/([^/]+)$/i);
    const isRoomPath = location.pathname === "/room" || Boolean(roomPathMatch);
    if (!isRoomPath) {
      return;
    }

    const roomIdFromPath = roomPathMatch?.[1]?.toUpperCase();
    const targetPath = roomIdFromPath
      ? `/?roomId=${encodeURIComponent(roomIdFromPath)}`
      : "/";
    const currentPathAndSearch = `${location.pathname}${location.search}`;
    if (currentPathAndSearch !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [
    isRecoveringSession,
    location.pathname,
    location.search,
    navigate,
    player?.id,
    room?.id,
  ]);

  return null;
};

const RoomRoute: React.FC = () => {
  const { room, player } = useGame();

  if (!room || !player) {
    return <Home />;
  }

  return <GameRoom />;
};

function App() {
  return (
    <Router>
      <SocketProvider>
        <GameProvider>
          <UrlStateSync />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room" element={<RoomRoute />} />
            <Route path="/room/:roomId" element={<RoomRoute />} />
          </Routes>
        </GameProvider>
      </SocketProvider>
    </Router>
  );
}

export default App;
