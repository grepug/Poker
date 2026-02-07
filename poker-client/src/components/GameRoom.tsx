import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../contexts/GameContext";
import { Card } from "./Card";
import { PlayerSeat } from "./PlayerSeat";
import type { PlayerAction } from "poker-types";

const seatPositions: Array<"top" | "right" | "bottom" | "left"> = [
  "top",
  "right",
  "bottom",
  "left",
];

export const GameRoom: React.FC = () => {
  const navigate = useNavigate();
  const {
    room,
    player,
    yourCards,
    isHost,
    lastError,
    clearError,
    startGame,
    startNextHand,
    performAction,
    leaveRoom,
  } = useGame();

  const [raiseAmount, setRaiseAmount] = useState<number>(0);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const currentHand = room?.currentHand ?? null;
  const isGameStarted = room?.gameState === "IN_PROGRESS";
  const currentPlayer = room?.players.find((p) => p.id === player?.id) ?? null;
  const currentTurnPlayer =
    room?.players.find((p) => p.id === currentHand?.currentPlayerTurn) ?? null;
  const isHandPausedForNext =
    Boolean(currentHand) && currentHand?.currentPlayerTurn === null;

  const minRaise = useMemo(() => {
    if (!room) return 0;
    return currentHand?.minRaise ?? room.config.bigBlind * 2;
  }, [currentHand?.minRaise, room]);

  const callAmount =
    currentHand && currentPlayer
      ? Math.max(0, currentHand.currentBet - currentPlayer.currentBet)
      : 0;
  const inferredPotFromBets = room
    ? room.players.reduce((sum, seatPlayer) => sum + (seatPlayer.currentBet || 0), 0)
    : 0;
  const displayPot = Math.max(currentHand?.pot ?? 0, inferredPotFromBets);

  const canCheck = callAmount === 0;
  const maxRaise = currentPlayer?.chips ?? 0;
  const isYourTurn = currentHand?.currentPlayerTurn === player?.id;
  const canHostStartNextHand =
    isHost && isGameStarted && isHandPausedForNext && room.players.length >= 2;

  if (!room || !player) {
    return <div className="p-4 text-white">Loading...</div>;
  }

  const handleAction = (action: PlayerAction) => {
    if (action === "raise") {
      if (raiseAmount < minRaise) {
        setActionHint(`Raise must be at least $${minRaise}`);
        return;
      }

      if (raiseAmount > maxRaise) {
        setActionHint(`Raise cannot exceed your stack ($${maxRaise})`);
        return;
      }

      setActionHint(null);
      performAction("raise", raiseAmount);
      return;
    }

    setActionHint(null);
    performAction(action);
  };

  const handleLeave = () => {
    leaveRoom();
    navigate("/");
  };

  const getPlayerPositionLabel = (seatPlayerPosition: number) => {
    if (!currentHand) return null;

    const labels: string[] = [];
    if (currentHand.dealerPosition === seatPlayerPosition) {
      labels.push("Dealer");
    }
    if (currentHand.smallBlindPosition === seatPlayerPosition) {
      labels.push("SB");
    }
    if (currentHand.bigBlindPosition === seatPlayerPosition) {
      labels.push("BB");
    }

    return labels.length > 0 ? labels.join(" / ") : null;
  };

  return (
    <div className="min-h-screen px-3 pb-40 pt-3 md:px-6 md:pb-8">
      <div className="mx-auto max-w-6xl space-y-3 md:space-y-4">
        <header className="surface-panel sticky top-3 z-20 p-3 md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black tracking-tight text-white" data-testid="room-title">
                Room: {room.id}
              </h1>
              <p
                className="text-sm text-emerald-100/70"
                data-testid="room-player-count"
              >
                Players: {room.players.length}/{room.config.maxPlayers}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {isHost && !isGameStarted && room.players.length >= 2 && (
                <button
                  onClick={startGame}
                  data-testid="start-game-button"
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
                >
                  Start Game
                </button>
              )}
              <button
                onClick={handleLeave}
                data-testid="leave-room-button"
                className="rounded-xl border border-red-500/70 bg-red-900/25 px-3 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-800/40"
              >
                Leave
              </button>
            </div>
          </div>
        </header>

        {lastError && (
          <section className="surface-panel p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/60 bg-red-900/25 px-3 py-2 text-sm text-red-100">
              <span>{lastError}</span>
              <button
                className="rounded-md border border-red-300/50 px-2 py-1 text-xs font-semibold text-red-100 transition hover:bg-red-500/15"
                onClick={clearError}
                data-testid="dismiss-error-button"
              >
                Dismiss
              </button>
            </div>
          </section>
        )}

        <section className="surface-panel p-4" data-testid="players-section">
          <h3 className="mb-3 text-sm font-semibold text-emerald-100">Players</h3>
          <div className="space-y-2">
            {room.players.map((seatPlayer, idx) => (
              <PlayerSeat
                key={seatPlayer.id}
                player={seatPlayer}
                position={seatPositions[idx % seatPositions.length]}
                seatNumber={idx + 1}
                isYou={seatPlayer.id === player.id}
                isCurrentPlayer={currentHand?.currentPlayerTurn === seatPlayer.id}
                isDealer={currentHand?.dealerPosition === seatPlayer.position}
                positionLabel={getPlayerPositionLabel(seatPlayer.position)}
                dataTestId={`player-seat-${seatPlayer.id}`}
              />
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {yourCards && yourCards.length > 0 && (
            <section className="surface-panel p-4" data-testid="your-cards-section">
              <h3 className="mb-2 text-sm font-semibold text-emerald-100">Your Cards</h3>
              <div className="flex justify-center gap-3">
                {yourCards.map((card, idx) => (
                  <Card
                    key={idx}
                    card={card}
                    size="large"
                    dataTestId={`your-card-${idx}`}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="surface-panel p-4" data-testid="game-info-panel">
            <h3 className="mb-2 text-sm font-semibold text-emerald-100">Game Info</h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="hud-chip" data-testid="pot-value">
                Pot: ${displayPot}
              </span>
              {currentHand && (
                <span className="hud-chip" data-testid="round-value">
                  Current Round: {currentHand.bettingRound}
                </span>
              )}
              <span className="hud-chip" data-testid="your-chips">
                Your Chips: ${currentPlayer?.chips ?? 0}
              </span>
              {currentTurnPlayer && (
                <span className="hud-chip border-amber-400/70 bg-amber-500/20 text-amber-100" data-testid="turn-player">
                  Turn: {currentTurnPlayer.name}
                </span>
              )}
            </div>

            {currentHand && currentHand.communityCards.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2" data-testid="community-cards">
                {currentHand.communityCards.map((card, idx) => (
                  <Card
                    key={idx}
                    card={card}
                    size="medium"
                    dataTestId={`community-card-${idx}`}
                  />
                ))}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="text-emerald-100/70">
                Small Blind: <span className="text-white">${room.config.smallBlind}</span>
              </div>
              <div className="text-emerald-100/70">
                Big Blind: <span className="text-white">${room.config.bigBlind}</span>
              </div>
              {currentHand && (
                <div className="text-emerald-100/70">
                  Hand #: <span className="text-white">{currentHand.handNumber}</span>
                </div>
              )}
            </div>
          </section>
        </div>

        {canHostStartNextHand && (
          <section className="surface-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-emerald-100">
                  Hand complete
                </h3>
                <p className="text-sm text-emerald-100/70">
                  Host can start the next hand when everyone is ready.
                </p>
              </div>
              <button
                onClick={startNextHand}
                data-testid="start-next-hand-button"
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
              >
                Start Next Hand
              </button>
            </div>
          </section>
        )}

      </div>

      {isYourTurn && (
        <section
          className="surface-panel fixed bottom-3 left-3 right-3 z-30 p-3 md:left-1/2 md:w-[min(720px,92vw)] md:-translate-x-1/2 md:p-4"
          data-testid="action-dock"
        >
          <h3 className="mb-3 text-sm font-semibold text-amber-200">Your Turn</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleAction("fold")}
                data-testid="action-fold"
                className="rounded-xl border border-red-500/60 bg-red-900/30 px-4 py-3 font-semibold text-red-100 transition hover:bg-red-800/40"
              >
                Fold
              </button>

              {canCheck ? (
                <button
                  onClick={() => handleAction("check")}
                  data-testid="action-check"
                  className="rounded-xl bg-sky-500 px-4 py-3 font-semibold text-sky-950 transition hover:bg-sky-400"
                >
                  Check
                </button>
              ) : (
                <button
                  onClick={() => handleAction("call")}
                  data-testid="action-call"
                  className="rounded-xl bg-amber-400 px-4 py-3 font-semibold text-amber-950 transition hover:bg-amber-300"
                >
                  Call ${callAmount}
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                min={minRaise}
                max={maxRaise}
                value={raiseAmount}
                onChange={(e) => {
                  setRaiseAmount(Number(e.target.value));
                  setActionHint(null);
                }}
                placeholder={`Min: $${minRaise}`}
                data-testid="raise-input"
                className="flex-1 rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-2 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
              />
              <button
                onClick={() => handleAction("raise")}
                disabled={raiseAmount < minRaise || raiseAmount > maxRaise}
                data-testid="action-raise"
                className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Raise
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-emerald-100/70">
                Min raise: ${minRaise} • Max: ${maxRaise}
              </div>
              <button
                onClick={() => handleAction("all-in")}
                data-testid="action-all-in"
                className="rounded-xl border border-orange-400/60 bg-orange-500/15 px-4 py-2 font-semibold text-orange-100 transition hover:bg-orange-500/25"
              >
                All-In ${maxRaise}
              </button>
            </div>

            {actionHint && (
              <div
                className="rounded-lg border border-orange-400/60 bg-orange-500/10 px-3 py-2 text-xs text-orange-200"
                data-testid="action-hint"
              >
                {actionHint}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
