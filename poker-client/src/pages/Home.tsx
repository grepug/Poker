import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HomePanel } from "@/components/poker/home-panel";
import { useAuth } from "@/contexts/AuthContext";
import { useGame } from "@/contexts/GameContext";
import { useLocalization } from "@/contexts/LocalizationContext";
import { useSocket } from "@/contexts/SocketContext";

interface HomeProps {
  prefilledRoomId?: string;
  forceJoinMode?: boolean;
}

const useHomeElement = ({
  prefilledRoomId,
  forceJoinMode = false,
}: HomeProps) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { logout } = useAuth();
  const { connected } = useSocket();
  const { createRoom, joinRoom, isRecoveringSession, lastError, clearError } = useGame();
  const { t } = useLocalization();

  const normalizedPrefilledRoomId = useMemo(
    () => prefilledRoomId?.trim().toUpperCase() ?? "",
    [prefilledRoomId],
  );
  const queryRoomId = useMemo(
    () => searchParams.get("roomId")?.trim().toUpperCase() ?? "",
    [searchParams],
  );
  const inferredRoomId = normalizedPrefilledRoomId || queryRoomId;
  const defaultJoinMode = forceJoinMode || Boolean(inferredRoomId);
  const [useShortDeckRules, setUseShortDeckRules] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [roomId, setRoomId] = useState("");
  const [joinModeOverride, setJoinModeOverride] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const effectiveRoomId = inferredRoomId || roomId;
  const isJoining = inferredRoomId ? true : joinModeOverride ?? defaultJoinMode;

  const clearFeedback = () => {
    if (feedback) {
      setFeedback(null);
    }
    if (lastError) {
      clearError();
    }
  };

  const handleLogout = () => {
    void logout()
      .catch(() => undefined)
      .finally(() => {
        navigate("/auth", { replace: true });
      });
  };

  const handleCreateRoom = () => {
    if (isRecoveringSession) {
      return;
    }

    clearFeedback();
    createRoom(undefined, undefined, { useShortDeckRules, maxPlayers });
  };

  const handleJoinRoom = () => {
    if (isRecoveringSession) {
      return;
    }

    const trimmedRoomId = effectiveRoomId.trim();
    const normalizedRoomId = trimmedRoomId.toUpperCase();

    if (!normalizedRoomId) {
      setFeedback(t("home.roomCodeRequired"));
      return;
    }

    clearFeedback();
    joinRoom(normalizedRoomId);
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 md:px-6 md:py-12">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-16 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute -right-24 bottom-8 h-64 w-64 rounded-full bg-yellow-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[85vh] max-w-5xl items-center justify-center">
        <div className="w-full max-w-md space-y-3">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => navigate("/history")}
              className="rounded-lg border border-violet-500/60 bg-violet-900/35 px-3 py-1.5 text-xs font-semibold text-violet-100 transition hover:bg-violet-800/45"
            >
              {t("home.history")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
            >
              {t("home.accountSettings")}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-rose-500/60 bg-rose-900/35 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-800/45"
            >
              {t("home.logout")}
            </button>
          </div>
          <HomePanel
            connected={connected}
            isRecoveringSession={isRecoveringSession}
            isJoining={isJoining}
            inferredRoomId={inferredRoomId}
            effectiveRoomId={effectiveRoomId}
            feedback={feedback}
            lastError={lastError}
            useShortDeckRules={useShortDeckRules}
            maxPlayers={maxPlayers}
            t={t}
            onUseShortDeckRulesChange={(enabled) => {
              setUseShortDeckRules(enabled);
              clearFeedback();
            }}
            onMaxPlayersChange={(value) => {
              setMaxPlayers(value);
              clearFeedback();
            }}
            onCreateRoom={handleCreateRoom}
            onEnableJoinMode={() => {
              if (isRecoveringSession) {
                return;
              }
              setJoinModeOverride(true);
              clearFeedback();
            }}
            onRoomIdChange={(value) => {
              setRoomId(value);
              clearFeedback();
            }}
            onJoinRoom={handleJoinRoom}
            onBack={() => {
              setJoinModeOverride(false);
              setRoomId("");
              clearFeedback();
              navigate("/", { replace: true });
            }}
          />
        </div>
      </div>
    </main>
  );
};

export const Home: React.FC<HomeProps> = (props) => useHomeElement(props);
