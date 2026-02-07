import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../contexts/GameContext";
import { useSocket } from "../contexts/SocketContext";

interface HomeProps {
  prefilledRoomId?: string;
  forceJoinMode?: boolean;
}

export const Home: React.FC<HomeProps> = ({
  prefilledRoomId,
  forceJoinMode = false,
}) => {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const {
    createRoom,
    joinRoom,
    isRecoveringSession,
    lastError,
    clearError,
  } = useGame();

  const [playerName, setPlayerName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const normalizedRoomId = prefilledRoomId?.trim().toUpperCase();
    if (normalizedRoomId) {
      setIsJoining(true);
      setRoomId(normalizedRoomId);
      return;
    }

    if (forceJoinMode) {
      setIsJoining(true);
    }
  }, [prefilledRoomId, forceJoinMode]);

  const clearFeedback = () => {
    if (feedback) {
      setFeedback(null);
    }
    if (lastError) {
      clearError();
    }
  };

  const handleCreateRoom = () => {
    if (isRecoveringSession) return;

    const trimmedName = playerName.trim();
    if (!trimmedName) {
      setFeedback("Please enter your name");
      return;
    }

    clearFeedback();
    createRoom(trimmedName);
    navigate("/room");
  };

  const handleJoinRoom = () => {
    if (isRecoveringSession) return;

    const trimmedName = playerName.trim();
    const trimmedRoomId = roomId.trim();
    const normalizedRoomId = trimmedRoomId.toUpperCase();

    if (!trimmedName || !normalizedRoomId) {
      setFeedback("Please enter your name and room code");
      return;
    }

    clearFeedback();
    joinRoom(normalizedRoomId, trimmedName);
    navigate(`/room/${normalizedRoomId}`);
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
              Personal Table
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-white">
              Poker Game
            </h1>
            <p className="mt-2 text-sm text-emerald-100/70">
              Texas Hold&apos;em Online
            </p>
            <div className="mt-5">
              {connected ? (
                <span className="hud-chip text-emerald-200" data-testid="connection-status">
                  ● Connected
                </span>
              ) : (
                <span className="hud-chip border-red-500/40 bg-red-950/60 text-red-200" data-testid="connection-status">
                  ● Disconnected
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
                Reconnecting to your previous table...
              </div>
            )}

            <div>
              <label
                htmlFor="player-name"
                className="mb-2 block text-sm font-semibold text-emerald-100"
              >
                Your Name
              </label>
              <input
                id="player-name"
                type="text"
                value={playerName}
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  clearFeedback();
                }}
                placeholder="Enter your name"
                data-testid="name-input"
                className="w-full rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-3 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
              />
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
                  Create New Room
                </button>

                <button
                  onClick={() => {
                    if (isRecoveringSession) return;
                    setIsJoining(true);
                    clearFeedback();
                  }}
                  disabled={isRecoveringSession}
                  data-testid="join-toggle-button"
                  className="w-full rounded-xl border border-emerald-500/70 bg-transparent px-4 py-3 font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
                >
                  Join Existing Room
                </button>
              </>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="room-code"
                    className="mb-2 block text-sm font-semibold text-emerald-100"
                  >
                    Room Code
                  </label>
                  <input
                    id="room-code"
                    type="text"
                    value={roomId}
                    onChange={(e) => {
                      setRoomId(e.target.value.toUpperCase());
                      clearFeedback();
                    }}
                    placeholder="Enter room code"
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
                  Join Room
                </button>

                <button
                  onClick={() => {
                    setIsJoining(false);
                    setRoomId("");
                    clearFeedback();
                  }}
                  data-testid="back-button"
                  className="w-full rounded-xl border border-slate-500/70 bg-slate-700/20 px-4 py-3 font-semibold text-slate-200 transition hover:bg-slate-700/40"
                >
                  Back
                </button>
              </>
            )}
          </div>

          <div className="mt-8 border-t border-emerald-900/80 pt-4 text-center text-xs text-emerald-200/70">
            2-10 players • Texas Hold&apos;em rules
          </div>
        </section>
      </div>
    </main>
  );
};
