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
import { LocalizationProvider } from "./contexts/LocalizationContext";
import { Home } from "./pages/Home";
import { GameRoom } from "./components/GameRoom";
import { IosInstallPrompt } from "./components/IosInstallPrompt";

const JUST_LEFT_ROOM_STORAGE_KEY = "poker.justLeftRoom";

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

    const justLeftRoom =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(JUST_LEFT_ROOM_STORAGE_KEY) === "1";
    if (justLeftRoom && typeof window !== "undefined") {
      window.sessionStorage.removeItem(JUST_LEFT_ROOM_STORAGE_KEY);
    }

    const roomIdFromPath = roomPathMatch?.[1]?.toUpperCase();
    const targetPath = justLeftRoom
      ? "/"
      : roomIdFromPath
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
    <LocalizationProvider>
      <Router>
        <SocketProvider>
          <GameProvider>
            <UrlStateSync />
            <IosInstallPrompt />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/room" element={<RoomRoute />} />
              <Route path="/room/:roomId" element={<RoomRoute />} />
            </Routes>
          </GameProvider>
        </SocketProvider>
      </Router>
    </LocalizationProvider>
  );
}

export default App;
