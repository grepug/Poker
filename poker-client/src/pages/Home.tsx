import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useGame } from "../contexts/GameContext";
import { useSocket } from "../contexts/SocketContext";
import { useLocalization } from "../contexts/LocalizationContext";
import {
  readLastPlayerEmoji,
  readLastPlayerName,
  writeLastPlayerEmoji,
  writeLastPlayerName,
} from "../utils/player-name-storage";
import {
  getRandomPlayerEmoji,
  PLAYER_EMOJI_OPTIONS,
} from "../constants/player-emojis";

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
  const {
    createRoom,
    joinRoom,
    isRecoveringSession,
    lastError,
    clearError,
  } = useGame();
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
  const [playerEmoji, setPlayerEmoji] = useState(() => readLastPlayerEmoji());
  const [isEmojiPopoverOpen, setIsEmojiPopoverOpen] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [joinModeOverride, setJoinModeOverride] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const effectiveRoomId = inferredRoomId || roomId;
  const isJoining = inferredRoomId
    ? true
    : joinModeOverride ?? defaultJoinMode;

  const clearFeedback = () => {
    if (feedback) {
      setFeedback(null);
    }
    if (lastError) {
      clearError();
    }
  };

  useEffect(() => {
    if (!isEmojiPopoverOpen) return;

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!emojiPickerRef.current) return;
      if (!(event.target instanceof Node)) return;
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
    if (isRecoveringSession) return;

    const trimmedName = playerName.trim();
    if (!trimmedName) {
      setFeedback(t("home.nameRequired"));
      return;
    }

    clearFeedback();
    writeLastPlayerName(trimmedName);
    writeLastPlayerEmoji(playerEmoji);
    createRoom(trimmedName, playerEmoji);
  };

  const handleJoinRoom = () => {
    if (isRecoveringSession) return;

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
        <section className="surface-panel w-full max-w-md p-6 md:p-8" data-testid="home-panel">
          <div className="mb-8 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">
              {t("home.personalTable")}
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
              {t("home.pokerGame")}
            </h1>
            <p className="mt-2 text-sm text-emerald-100/70">
              {t("home.texasHoldemOnline")}
            </p>
            <div className="mt-5">
              {connected ? (
                <span className="hud-chip text-emerald-200" data-testid="connection-status">
                  ● {t("home.connected")}
                </span>
              ) : (
                <span className="hud-chip border-red-500/40 bg-red-950/60 text-red-200" data-testid="connection-status">
                  ● {t("home.disconnected")}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-5">
            {isRecoveringSession && (
              <div
                className="rounded-xl border border-sky-400/50 bg-sky-500/10 px-3 py-2 text-sm text-sky-200"
                data-testid="session-recovery-status"
              >
                {t("home.reconnecting")}
              </div>
            )}

            <div>
              <label
                htmlFor="player-name"
                className="mb-2 block text-sm font-semibold text-emerald-100"
              >
                {t("home.yourName")}
              </label>
              <input
                id="player-name"
                type="text"
                value={playerName}
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  clearFeedback();
                }}
                placeholder={t("home.enterName")}
                data-testid="name-input"
                className="w-full rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-3 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>

            <div className="relative" ref={emojiPickerRef}>
              <label
                htmlFor="player-emoji"
                className="mb-2 block text-sm font-semibold text-emerald-100"
              >
                {t("home.avatarEmoji")}
              </label>
              <div className="flex items-center gap-2">
                <button
                  id="player-emoji"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={isEmojiPopoverOpen}
                  onClick={() => setIsEmojiPopoverOpen((open) => !open)}
                  data-testid="emoji-select"
                  className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-3 text-left text-white outline-none transition hover:border-emerald-500/80 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="text-2xl leading-none" aria-hidden="true">
                      {playerEmoji}
                    </span>
                    <span className="truncate text-sm text-emerald-100/90">
                      {t("home.avatarEmoji")}
                    </span>
                  </span>
                  <span className="ml-3 text-sm text-emerald-300/80" aria-hidden="true">
                    {isEmojiPopoverOpen ? "▴" : "▾"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleRandomEmoji}
                  data-testid="emoji-randomize-button"
                  className="rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-3 py-3 text-xl leading-none text-emerald-100 transition hover:border-emerald-500/80 hover:bg-emerald-900/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  aria-label={t("home.randomEmoji")}
                  title={t("home.randomEmoji")}
                >
                  🎲
                </button>
              </div>
              {isEmojiPopoverOpen && (
                <div
                  role="dialog"
                  aria-label={t("home.avatarEmoji")}
                  data-testid="emoji-popover"
                  className="absolute z-30 mt-2 w-full rounded-xl border border-emerald-600/80 bg-emerald-950/95 p-3 shadow-2xl shadow-emerald-900/40 backdrop-blur-sm"
                >
                  <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto pr-1 sm:grid-cols-10">
                    {PLAYER_EMOJI_OPTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleEmojiPick(emoji)}
                        data-testid="emoji-option"
                        data-emoji={emoji}
                        aria-label={`${t("home.avatarEmoji")} ${emoji}`}
                        className={`flex h-9 items-center justify-center rounded-lg text-xl leading-none transition ${
                          playerEmoji === emoji
                            ? "bg-emerald-400/25 ring-1 ring-emerald-300/80"
                            : "hover:bg-emerald-500/15"
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {(feedback || lastError) && (
              <div
                className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
                data-testid="form-feedback"
              >
                {feedback || lastError}
              </div>
            )}

            {!isJoining ? (
              <>
                <button
                  onClick={handleCreateRoom}
                  disabled={!connected || isRecoveringSession}
                  data-testid="create-room-button"
                  className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("home.createRoom")}
                </button>

                <button
                  onClick={() => {
                    if (isRecoveringSession) return;
                    setJoinModeOverride(true);
                    clearFeedback();
                  }}
                  disabled={isRecoveringSession}
                  data-testid="join-toggle-button"
                  className="w-full rounded-xl border border-emerald-500/70 bg-transparent px-4 py-3 font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
                >
                  {t("home.joinExistingRoom")}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="room-code"
                    className="mb-2 block text-sm font-semibold text-emerald-100"
                  >
                    {t("home.roomCode")}
                  </label>
                  <input
                    id="room-code"
                    type="text"
                    value={effectiveRoomId}
                    onChange={(e) => {
                      setRoomId(e.target.value.toUpperCase());
                      clearFeedback();
                    }}
                    placeholder={t("home.enterRoomCode")}
                    data-testid="room-id-input"
                    className="w-full rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-3 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>

                <button
                  onClick={handleJoinRoom}
                  disabled={!connected || isRecoveringSession}
                  data-testid="join-room-button"
                  className="w-full rounded-xl bg-sky-500 px-4 py-3 font-semibold text-sky-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("home.joinRoom")}
                </button>

                <button
                  onClick={() => {
                    setJoinModeOverride(false);
                    setRoomId("");
                    clearFeedback();
                    navigate("/", { replace: true });
                  }}
                  data-testid="back-button"
                  className="w-full rounded-xl border border-slate-500/70 bg-slate-700/20 px-4 py-3 font-semibold text-slate-200 transition hover:bg-slate-700/40"
                >
                  {t("common.back")}
                </button>
              </>
            )}
          </div>

          <div className="mt-8 border-t border-emerald-900/80 pt-4 text-center text-xs text-emerald-200/70">
            {t("home.footer")}
          </div>
        </section>
      </div>
    </main>
  );
};
