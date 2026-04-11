import { useEffect } from "react";
import {
  BrowserRouter as Router,
  Navigate,
  useLocation,
  Routes,
  Route,
  useNavigate,
} from "react-router-dom";
import { SocketProvider } from "./contexts/SocketContext";
import { GameProvider, useGame } from "./contexts/GameContext";
import { LocalizationProvider } from "./contexts/LocalizationContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LiveAudioProvider } from "./contexts/LiveAudioContext";
import { Home } from "./pages/Home";
import { AuthPage } from "./pages/Auth";
import { SettingsPage } from "./pages/Settings";
import { SavedGamesPage } from "./pages/SavedGames";
import { SavedGameDetailPage } from "./pages/SavedGameDetail";
import { GameRoom } from "./components/GameRoom";
import { IosInstallPrompt } from "./components/IosInstallPrompt";
import { WeChatBrowserGate } from "./components/WeChatBrowserGate";
import {
  getCurrentBrowserUrl,
  isWeChatInAppBrowser,
} from "./utils/browser-detection";

const JUST_LEFT_ROOM_STORAGE_KEY = "poker.justLeftRoom";

const UrlStateSync: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { room, player, isRecoveringSession } = useGame();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }
    if (location.pathname !== "/auth") {
      navigate("/auth", { replace: true });
    }
  }, [isAuthenticated, location.pathname, navigate]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    const activeRoomId = room?.id?.toUpperCase();
    const hasActiveSession = Boolean(activeRoomId && player?.id);
    const roomPathMatch = location.pathname.match(/^\/room\/([^/]+)$/i);
    const isRoomPath = location.pathname === "/room" || Boolean(roomPathMatch);
    const shouldSyncToActiveRoom =
      location.pathname === "/" || location.pathname === "/auth" || isRoomPath;

    if (hasActiveSession) {
      const targetRoomPath = `/room/${activeRoomId}`;
      if (shouldSyncToActiveRoom && location.pathname !== targetRoomPath) {
        navigate(targetRoomPath, { replace: true });
      }
      return;
    }

    if (isRecoveringSession) {
      return;
    }

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
    isAuthenticated,
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
  const { isAuthenticated } = useAuth();
  const { room, player } = useGame();

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  if (!room || !player) {
    return <Home />;
  }

  return <GameRoom />;
};

const AppRoutes: React.FC = () => {
  const { isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-emerald-950 text-emerald-100">
        Loading...
      </main>
    );
  }

  return (
    <SocketProvider isAuthenticated={isAuthenticated}>
      <GameProvider>
        <LiveAudioProvider>
          <UrlStateSync />
          <IosInstallPrompt />
          <Routes>
            <Route
              path="/auth"
              element={
                isAuthenticated ? <Navigate to="/" replace /> : <AuthPage />
              }
            />
            <Route
              path="/"
              element={
                isAuthenticated ? <Home /> : <Navigate to="/auth" replace />
              }
            />
            <Route
              path="/settings"
              element={
                isAuthenticated ? (
                  <SettingsPage />
                ) : (
                  <Navigate to="/auth" replace />
                )
              }
            />
            <Route
              path="/history"
              element={
                isAuthenticated ? (
                  <SavedGamesPage />
                ) : (
                  <Navigate to="/auth" replace />
                )
              }
            />
            <Route
              path="/history/:archiveId"
              element={
                isAuthenticated ? (
                  <SavedGameDetailPage />
                ) : (
                  <Navigate to="/auth" replace />
                )
              }
            />
            <Route path="/room" element={<RoomRoute />} />
            <Route path="/room/:roomId" element={<RoomRoute />} />
          </Routes>
        </LiveAudioProvider>
      </GameProvider>
    </SocketProvider>
  );
};

export const AppShell: React.FC<{
  blockWeChatBrowser?: boolean;
  currentUrl?: string;
}> = ({
  blockWeChatBrowser = isWeChatInAppBrowser(),
  currentUrl = getCurrentBrowserUrl(),
}) => {
  if (blockWeChatBrowser) {
    return <WeChatBrowserGate currentUrl={currentUrl} />;
  }

  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
};

function App() {
  return (
    <LocalizationProvider>
      <Router>
        <AppShell />
      </Router>
    </LocalizationProvider>
  );
}

export default App;
