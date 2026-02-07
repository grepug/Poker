import React, { useEffect, useMemo, useState } from "react";
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

type PendingAction = {
  action: PlayerAction;
  amount?: number;
  label: string;
  chipsCommitted: number;
  projectedPot: number;
  projectedStack: number;
};

type FeedbackInsight = {
  source: "error" | "hint";
  title: string;
  reason: string;
  suggestions: string[];
  technicalDetail?: string;
};

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
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [hiddenCardsHandNumber, setHiddenCardsHandNumber] = useState<number | null>(null);
  const [showRankingsModal, setShowRankingsModal] = useState<boolean>(false);
  const [confirmActions, setConfirmActions] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("poker.confirmActions");
    if (saved === "off") return false;
    if (saved === "on") return true;
    // Keep automation flows simple while enabling confirmations for normal play.
    return !window.navigator.webdriver;
  });
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
  const currentHandNumber = currentHand?.handNumber ?? null;
  const showHoleCards =
    currentHandNumber === null || hiddenCardsHandNumber !== currentHandNumber;
  const canHostStartNextHand =
    isHost && isGameStarted && isHandPausedForNext && room.players.length >= 2;

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("poker.confirmActions", confirmActions ? "on" : "off");
  }, [confirmActions]);

  useEffect(() => {
    if (!pendingAction && !showRankingsModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPendingAction(null);
        setShowRankingsModal(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingAction, showRankingsModal]);

  useEffect(() => {
    if (!lastError && !actionHint) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (lastError) clearError();
        if (actionHint) setActionHint(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actionHint, clearError, lastError]);

  const feedbackInsight = useMemo<FeedbackInsight | null>(() => {
    if (lastError) {
      const normalized = lastError.toLowerCase();
      const insight: FeedbackInsight = {
        source: "error",
        title: "Action Rejected",
        reason: lastError,
        suggestions: ["Try again after the game state updates."],
        technicalDetail: lastError,
      };

      if (normalized.includes("not your turn")) {
        insight.title = "Not Your Turn";
        insight.reason = "Another player must act first.";
        insight.suggestions = [
          `Wait until the Turn indicator shows ${
            currentTurnPlayer?.name ?? "your name"
          }.`,
          "Review the pot and decide between fold, call/check, or raise.",
        ];
      } else if (normalized.includes("cannot check")) {
        insight.title = "Check Not Allowed";
        insight.reason = "You are facing a bet, so check is not legal right now.";
        insight.suggestions = [
          `Call $${callAmount}, raise at least $${minRaise}, or fold.`,
          "Use the To Call chip in the action dock to verify required chips.",
        ];
      } else if (normalized.includes("nothing to call")) {
        insight.title = "Call Not Needed";
        insight.reason = "There is no outstanding bet to call.";
        insight.suggestions = ["Use Check to continue without adding chips."];
      } else if (normalized.includes("raise too small") || normalized.includes("minimum")) {
        insight.title = "Raise Too Small";
        insight.reason = "Your raise is below the minimum allowed for this betting round.";
        insight.suggestions = [
          `Raise at least $${minRaise}.`,
          "Or use Call/Check if you don't want to raise.",
        ];
      } else if (normalized.includes("invalid raise amount")) {
        insight.title = "Invalid Raise Amount";
        insight.reason = "Raise amount must be a positive number.";
        insight.suggestions = [
          `Enter a value between $${minRaise} and $${maxRaise}.`,
          "You can also use Call/Check or All-In.",
        ];
      } else if (normalized.includes("insufficient chips")) {
        insight.title = "Insufficient Chips";
        insight.reason = "Your stack is not enough for this action.";
        insight.suggestions = [
          `Current stack: $${maxRaise}.`,
          "Use All-In or choose a lower commitment.",
        ];
      } else if (normalized.includes("only host")) {
        insight.title = "Host Permission Required";
        insight.reason = "This action can only be performed by the room host.";
        insight.suggestions = ["Ask the host to perform this action."];
      } else if (normalized.includes("current hand is still in progress")) {
        insight.title = "Hand Still In Progress";
        insight.reason = "A new hand cannot start until the current hand fully ends.";
        insight.suggestions = ["Finish the current hand first."];
      } else if (normalized.includes("not in active hand")) {
        insight.title = "You Are Out Of This Hand";
        insight.reason = "You cannot act because you're not active in the current hand.";
        insight.suggestions = ["Wait for the next hand to start."];
      }

      return insight;
    }

    if (actionHint) {
      const normalized = actionHint.toLowerCase();
      const insight: FeedbackInsight = {
        source: "hint",
        title: "Action Guidance",
        reason: actionHint,
        suggestions: [],
      };

      if (normalized.includes("at least")) {
        insight.title = "Raise Too Small";
        insight.suggestions = [
          `Minimum raise right now is $${minRaise}.`,
          `To continue cheaply, call/check based on To Call ($${callAmount}).`,
        ];
      } else if (normalized.includes("cannot exceed")) {
        insight.title = "Raise Too Large";
        insight.suggestions = [
          `Maximum raise is your stack: $${maxRaise}.`,
          "Use All-In to commit your full stack quickly.",
        ];
      } else {
        insight.suggestions = ["Adjust your action and try again."];
      }

      return insight;
    }

    return null;
  }, [actionHint, callAmount, currentTurnPlayer?.name, lastError, maxRaise, minRaise]);

  if (!room || !player) {
    return <div className="p-4 text-white">Loading...</div>;
  }

  const queueAction = (action: PlayerAction, amount?: number) => {
    const chipsCommitted =
      action === "call"
        ? Math.min(callAmount, maxRaise)
        : action === "raise"
          ? Math.min(maxRaise, callAmount + (amount ?? 0))
          : action === "all-in"
            ? maxRaise
            : 0;

    const label =
      action === "raise"
        ? `Raise to $${amount ?? 0}`
        : action === "call"
          ? `Call $${callAmount}`
          : action === "all-in"
            ? `All-In $${maxRaise}`
            : action[0].toUpperCase() + action.slice(1);

    const nextPending: PendingAction = {
      action,
      amount,
      label,
      chipsCommitted,
      projectedPot: displayPot + chipsCommitted,
      projectedStack: Math.max(0, maxRaise - chipsCommitted),
    };

    if (confirmActions) {
      setPendingAction(nextPending);
    } else {
      performAction(nextPending.action, nextPending.amount);
    }
  };

  const handleAction = (action: PlayerAction) => {
    setActionHint(null);
    if (action === "raise") {
      if (raiseAmount < minRaise) {
        setActionHint(`Raise must be at least $${minRaise}`);
        return;
      }

      if (raiseAmount > maxRaise) {
        setActionHint(`Raise cannot exceed your stack ($${maxRaise})`);
        return;
      }

      queueAction("raise", raiseAmount);
      return;
    }

    queueAction(action);
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

  const myPositionLabel = currentPlayer
    ? getPlayerPositionLabel(currentPlayer.position)
    : null;
  const playerRankings = [...room.players]
    .map((rankedPlayer) => {
      const tableStack = rankedPlayer.chips + (rankedPlayer.currentBet || 0);
      const net = tableStack - rankedPlayer.totalBuyIn;
      return {
        ...rankedPlayer,
        tableStack,
        net,
      };
    })
    .sort((a, b) => {
      if (b.tableStack !== a.tableStack) return b.tableStack - a.tableStack;
      if (b.net !== a.net) return b.net - a.net;
      return a.name.localeCompare(b.name);
    });
  const communitySlots = Array.from(
    { length: 5 },
    (_, idx) => currentHand?.communityCards[idx] ?? null,
  );

  return (
    <div className="min-h-screen px-3 pb-8 pt-3 md:px-6 md:pb-10">
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

        <section className="surface-panel p-4" data-testid="players-section">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-emerald-100">Players</h3>
            <button
              onClick={() => setShowRankingsModal(true)}
              data-testid="open-rankings-button"
              className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
            >
              View Rankings
            </button>
          </div>
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

        <section className="surface-panel p-4" data-testid="table-board-section">
          <h3 className="text-sm font-semibold text-emerald-100">Board</h3>
          <div className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/55 p-3" data-testid="community-cards">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
              Community Cards
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {communitySlots.map((card, idx) => {
                const isRevealed = Boolean(card);
                return (
                  <div
                    key={`community-slot-${idx}-${card ? `${card.suit}-${card.rank}` : "back"}`}
                    className={isRevealed ? "community-reveal" : ""}
                    style={isRevealed ? { animationDelay: `${idx * 65}ms` } : undefined}
                  >
                    <Card
                      card={card}
                      size="medium"
                      faceDown={!isRevealed}
                      dataTestId={isRevealed ? `community-card-${idx}` : `board-back-${idx}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-center text-xs text-emerald-100/65">
              {currentHand ? `${currentHand.communityCards.length} / 5 revealed` : "0 / 5 revealed"}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/55 p-3" data-testid="your-cards-section">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-emerald-100">Your Cards</h3>
                {myPositionLabel && (
                  <span className="rounded-full border border-cyan-300/40 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-100">
                    {myPositionLabel}
                  </span>
                )}
              </div>
              <button
                onClick={() =>
                  setHiddenCardsHandNumber((prev) =>
                    showHoleCards ? currentHandNumber ?? prev : null,
                  )
                }
                data-testid="toggle-hole-cards"
                className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
              >
                {showHoleCards ? "Hide Cards" : "Show Cards"}
              </button>
            </div>
            {showHoleCards && yourCards && yourCards.length > 0 ? (
              <div className="mt-3 flex justify-center gap-3">
                {yourCards.map((card, idx) => (
                  <Card
                    key={idx}
                    card={card}
                    size="medium"
                    dataTestId={`your-card-${idx}`}
                  />
                ))}
              </div>
            ) : (
              <div
                className="mt-3 rounded-lg border border-dashed border-emerald-700/70 bg-emerald-950/45 px-3 py-4 text-center text-sm text-emerald-100/70"
                data-testid="hole-cards-hidden-state"
              >
                {showHoleCards
                  ? "Cards will appear when a hand starts."
                  : "Hole cards are hidden. Toggle to reveal."}
              </div>
            )}
          </div>
        </section>

        <section className="surface-panel p-4" data-testid="game-info-panel">
          <h3 className="text-sm font-semibold text-emerald-100">Game Info</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/55 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
                Decision Priority
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
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
                <span className="hud-chip">To Call: ${callAmount}</span>
                {currentTurnPlayer && (
                  <span className="hud-chip border-amber-400/70 bg-amber-500/20 text-amber-100" data-testid="turn-player">
                    Turn: {currentTurnPlayer.name}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/55 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
                Table Context
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
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
                <div className="text-emerald-100/70">
                  Your Bet: <span className="text-white">${currentPlayer?.currentBet ?? 0}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

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

        {isYourTurn && (
          <section
            className="surface-panel sticky bottom-3 z-20 p-3 md:p-4"
            data-testid="action-dock"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-amber-200">Your Turn</h3>
              <div className="flex items-center gap-2">
                <span className="hud-chip border-amber-400/70 bg-amber-500/20 text-amber-100">
                  To Call: ${callAmount}
                </span>
                <label className="flex items-center gap-2 rounded-full border border-emerald-600/70 bg-emerald-950/55 px-3 py-1 text-xs text-emerald-100/90">
                  <input
                    type="checkbox"
                    checked={confirmActions}
                    onChange={(e) => setConfirmActions(e.target.checked)}
                    className="h-3.5 w-3.5 accent-emerald-400"
                  />
                  Confirm Actions
                </label>
              </div>
            </div>
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

      {feedbackInsight && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-emerald-950/85 p-4 backdrop-blur-sm"
          data-testid={feedbackInsight.source === "error" ? "error-modal" : "alert-modal"}
        >
          <div className="surface-panel w-full max-w-2xl p-4 md:p-6">
            <h3 className="text-lg font-black text-white">{feedbackInsight.title}</h3>
            <p className="mt-2 text-sm text-emerald-100/90" data-testid="error-modal-reason">
              {feedbackInsight.reason}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">Pot</p>
                <p className="mt-1 font-semibold text-white">${displayPot}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">To Call</p>
                <p className="mt-1 font-semibold text-white">${callAmount}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">Your Stack</p>
                <p className="mt-1 font-semibold text-white">${maxRaise}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">Min Raise</p>
                <p className="mt-1 font-semibold text-white">${minRaise}</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-emerald-700/70 bg-emerald-950/55 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
                What you can do
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-100/90">
                {feedbackInsight.suggestions.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>

            {feedbackInsight.technicalDetail && (
              <details className="mt-4 rounded-lg border border-emerald-700/70 bg-emerald-950/55 p-3 text-xs text-emerald-100/75">
                <summary className="cursor-pointer font-semibold">Technical detail</summary>
                <p className="mt-2 break-words font-mono text-[11px]">
                  {feedbackInsight.technicalDetail}
                </p>
              </details>
            )}

            <div className="mt-5 flex justify-end">
              <button
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
                onClick={() => {
                  if (lastError) clearError();
                  if (actionHint) setActionHint(null);
                }}
                data-testid={
                  feedbackInsight.source === "error"
                    ? "dismiss-error-button"
                    : "dismiss-alert-button"
                }
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {showRankingsModal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-emerald-950/85 p-4 backdrop-blur-sm"
          data-testid="rankings-modal"
        >
          <div className="surface-panel w-full max-w-2xl p-4 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-black text-white">Player Rankings</h3>
              <button
                onClick={() => setShowRankingsModal(false)}
                data-testid="close-rankings-button"
                className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
              >
                Close
              </button>
            </div>
            <p className="mt-1 text-sm text-emerald-100/80">
              Sorted by table stack (`chips + current bet`).
            </p>

            <div className="mt-4 overflow-hidden rounded-xl border border-emerald-700/60">
              <table className="min-w-full text-sm">
                <thead className="bg-emerald-950/70 text-emerald-100/70">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Rank</th>
                    <th className="px-3 py-2 text-left font-semibold">Player</th>
                    <th className="px-3 py-2 text-right font-semibold">Stack</th>
                    <th className="px-3 py-2 text-right font-semibold">Buy-in</th>
                    <th className="px-3 py-2 text-right font-semibold">Net</th>
                  </tr>
                </thead>
                <tbody className="bg-emerald-950/45">
                  {playerRankings.map((rankedPlayer, idx) => (
                    <tr
                      key={rankedPlayer.id}
                      className="border-t border-emerald-800/60 text-emerald-50"
                      data-testid={`ranking-row-${idx + 1}`}
                    >
                      <td className="px-3 py-2">#{idx + 1}</td>
                      <td className="px-3 py-2">
                        {rankedPlayer.name}
                        {rankedPlayer.id === player.id ? " (You)" : ""}
                      </td>
                      <td className="px-3 py-2 text-right">${rankedPlayer.tableStack}</td>
                      <td className="px-3 py-2 text-right">${rankedPlayer.totalBuyIn}</td>
                      <td
                        className={`px-3 py-2 text-right font-semibold ${
                          rankedPlayer.net >= 0 ? "text-emerald-300" : "text-red-300"
                        }`}
                      >
                        {rankedPlayer.net >= 0 ? "+" : ""}
                        ${rankedPlayer.net}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/85 p-4 backdrop-blur-sm"
          data-testid="action-confirm-modal"
        >
          <div className="surface-panel w-full max-w-2xl p-4 md:p-6">
            <h3 className="text-lg font-black text-white">Confirm Action</h3>
            <p className="mt-1 text-sm text-emerald-100/80">
              Review the hand context before committing to this move.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">Action</p>
                <p className="mt-1 font-semibold text-white">{pendingAction.label}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">Pot</p>
                <p className="mt-1 font-semibold text-white">${displayPot}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">Pot After</p>
                <p className="mt-1 font-semibold text-white">${pendingAction.projectedPot}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">Your Stack</p>
                <p className="mt-1 font-semibold text-white">${maxRaise}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">Stack After</p>
                <p className="mt-1 font-semibold text-white">${pendingAction.projectedStack}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">To Call</p>
                <p className="mt-1 font-semibold text-white">${callAmount}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3 text-emerald-100/80">
                Round: <span className="font-semibold text-white">{currentHand?.bettingRound ?? "-"}</span>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3 text-emerald-100/80">
                Turn: <span className="font-semibold text-white">{currentTurnPlayer?.name ?? "-"}</span>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setPendingAction(null)}
                data-testid="cancel-action-button"
                className="rounded-xl border border-emerald-500/60 bg-emerald-900/30 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-800/35"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  performAction(pendingAction.action, pendingAction.amount);
                  setPendingAction(null);
                }}
                data-testid="confirm-action-button"
                className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-300"
              >
                Confirm {pendingAction.label}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
