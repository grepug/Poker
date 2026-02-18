import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HomePanel } from "@/components/poker/home-panel";
import { PLAYER_EMOJI_OPTIONS, getRandomPlayerEmoji } from "@/constants/player-emojis";
import { useGame } from "@/contexts/GameContext";
import { useLocalization } from "@/contexts/LocalizationContext";
import { useSocket } from "@/contexts/SocketContext";
import {
  readLastPlayerName,
  writeLastPlayerEmoji,
  writeLastPlayerName,
} from "@/utils/player-name-storage";

interface HomeProps {
  prefilledRoomId?: string;
  forceJoinMode?: boolean;
}

export const Home: React.FC<HomeProps> = ({
  prefilledRoomId,
  forceJoinMode = false,
}) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  const [playerName, setPlayerName] = useState(() => readLastPlayerName());
  const [playerEmoji, setPlayerEmoji] = useState(() => getRandomPlayerEmoji());
  const [useShortDeckRules, setUseShortDeckRules] = useState(false);
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

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
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

  const handleCreateRoom = () => {
    if (isRecoveringSession) {
      return;
    }

    const trimmedName = playerName.trim();
    if (!trimmedName) {
      setFeedback(t("home.nameRequired"));
      return;
    }

    clearFeedback();
    writeLastPlayerName(trimmedName);
    writeLastPlayerEmoji(playerEmoji);
    createRoom(trimmedName, playerEmoji, { useShortDeckRules });
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

    clearFeedback();
    writeLastPlayerName(trimmedName);
    writeLastPlayerEmoji(playerEmoji);
    joinRoom(normalizedRoomId, trimmedName, playerEmoji);
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 md:px-6 md:py-12">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-16 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute -right-24 bottom-8 h-64 w-64 rounded-full bg-yellow-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[85vh] max-w-5xl items-center justify-center">
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
    </main>
  );
};
