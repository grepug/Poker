import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HomePanel } from "@/components/poker/home-panel";
import { PLAYER_EMOJI_OPTIONS, getRandomPlayerEmoji } from "@/constants/player-emojis";
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
  const { user, updateProfile, logout } = useAuth();
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
  const [playerName, setPlayerName] = useState(() => user?.displayName ?? "");
  const [playerEmoji, setPlayerEmoji] = useState(() => user?.avatarEmoji ?? getRandomPlayerEmoji());
  const [useShortDeckRules, setUseShortDeckRules] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [isEmojiPopoverOpen, setIsEmojiPopoverOpen] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [joinModeOverride, setJoinModeOverride] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!user) {
      return;
    }
    setPlayerName(user.displayName);
    setPlayerEmoji(user.avatarEmoji);
  }, [user]);

  useEffect(() => {
    if (!isEmojiPopoverOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!emojiPickerRef.current) {
        return;
      }
      if (!(event.target instanceof Node)) {
        return;
      }
      if (!emojiPickerRef.current.contains(event.target)) {
        setIsEmojiPopoverOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsEmojiPopoverOpen(false);
      }
    };

    const passiveTouchOptions: AddEventListenerOptions = { passive: true };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick, passiveTouchOptions);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick, passiveTouchOptions);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isEmojiPopoverOpen]);

  const handleEmojiPick = (emoji: string) => {
    setPlayerEmoji(emoji);
    setIsEmojiPopoverOpen(false);
    clearFeedback();
  };

  const handleRandomEmoji = () => {
    setPlayerEmoji((currentEmoji) => getRandomPlayerEmoji(currentEmoji));
    clearFeedback();
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

    const trimmedName = playerName.trim();
    if (!trimmedName) {
      setFeedback(t("home.nameRequired"));
      return;
    }

    void (async () => {
      try {
        clearFeedback();
        if (user && (trimmedName !== user.displayName || playerEmoji !== user.avatarEmoji)) {
          await updateProfile(trimmedName, playerEmoji);
        }
        createRoom(undefined, undefined, { useShortDeckRules, maxPlayers });
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : t("home.nameRequired"));
      }
    })();
  };

  const handleJoinRoom = () => {
    if (isRecoveringSession) {
      return;
    }

    const trimmedName = playerName.trim();
    const trimmedRoomId = effectiveRoomId.trim();
    const normalizedRoomId = trimmedRoomId.toUpperCase();

    if (!trimmedName || !normalizedRoomId) {
      setFeedback(t("home.nameAndRoomRequired"));
      return;
    }

    void (async () => {
      try {
        clearFeedback();
        if (user && (trimmedName !== user.displayName || playerEmoji !== user.avatarEmoji)) {
          await updateProfile(trimmedName, playerEmoji);
        }
        joinRoom(normalizedRoomId);
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : t("home.nameAndRoomRequired"));
      }
    })();
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
            playerName={playerName}
            playerEmoji={playerEmoji}
            isEmojiPopoverOpen={isEmojiPopoverOpen}
            feedback={feedback}
            lastError={lastError}
            useShortDeckRules={useShortDeckRules}
            maxPlayers={maxPlayers}
            emojiOptions={PLAYER_EMOJI_OPTIONS}
            emojiPickerRef={emojiPickerRef}
            t={t}
            onPlayerNameChange={(value) => {
              setPlayerName(value);
              clearFeedback();
            }}
            onToggleEmojiPopover={() => setIsEmojiPopoverOpen((open) => !open)}
            onRandomEmoji={handleRandomEmoji}
            onEmojiPick={handleEmojiPick}
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
