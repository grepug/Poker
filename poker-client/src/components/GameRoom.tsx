import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../contexts/GameContext";
import { Card } from "./Card";
import type { HandEvaluation, HandResult, Player, PlayerAction } from "poker-types";

const DRAG_SNAP_RADIUS_PX = 32;

type SeatAnchor = {
  top: string;
  left: string;
};

type DropIntent = {
  action: PlayerAction;
  amount?: number;
  label: string;
};

type DropResolution = {
  intent: DropIntent | null;
  reason: string | null;
};

type QuickConfirmAction = "check" | "fold";

type FeedbackInsight = {
  title: string;
  reason: string;
  suggestions: string[];
  technicalDetail?: string;
};

type DragState = {
  active: boolean;
  pointerId: number | null;
  clientX: number;
  clientY: number;
  overDropZone: boolean;
};

type TrayPresetTone = "call" | "raise" | "allin";

type TrayPresetButton = {
  key: string;
  label: string;
  amount: number;
  testId: string;
  tone: TrayPresetTone;
  enabled: boolean;
};

const EMPTY_DRAG_STATE: DragState = {
  active: false,
  pointerId: null,
  clientX: 0,
  clientY: 0,
  overDropZone: false,
};

const fallbackCopyText = (text: string) => {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textArea);
  }

  return copied;
};

const formatHandRank = (rank: HandEvaluation["rank"]) =>
  rank
    .split("_")
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(" ");

const resolveDropIntent = ({
  trayAmount,
  callAmount,
  minRaise,
  stack,
}: {
  trayAmount: number;
  callAmount: number;
  minRaise: number;
  stack: number;
}): DropResolution => {
  if (stack <= 0) {
    return { intent: null, reason: "No chips available." };
  }

  if (trayAmount <= 0) {
    return { intent: null, reason: "Add chips before dragging to the pot." };
  }

  if (trayAmount > stack) {
    return { intent: null, reason: `Tray cannot exceed your stack ($${stack}).` };
  }

  if (trayAmount === stack) {
    return {
      intent: { action: "all-in", label: `All-In $${stack}` },
      reason: null,
    };
  }

  if (callAmount > 0) {
    if (trayAmount < callAmount) {
      return {
        intent: null,
        reason: `Need at least $${callAmount} to call, or drag max for all-in.`,
      };
    }

    if (trayAmount === callAmount) {
      return {
        intent: { action: "call", label: `Call $${callAmount}` },
        reason: null,
      };
    }

    const raiseAmount = trayAmount - callAmount;
    if (raiseAmount < minRaise) {
      return {
        intent: null,
        reason: `Minimum raise is $${minRaise}. Add more chips.`,
      };
    }

    return {
      intent: {
        action: "raise",
        amount: raiseAmount,
        label: `Raise by $${raiseAmount} (total $${trayAmount})`,
      },
      reason: null,
    };
  }

  if (trayAmount < minRaise) {
    return {
      intent: null,
      reason: `Minimum opening raise is $${minRaise}.`,
    };
  }

  return {
    intent: {
      action: "raise",
      amount: trayAmount,
      label: `Bet/Raise by $${trayAmount}`,
    },
    reason: null,
  };
};

const getOrbitAnchor = (slotIndex: number, totalSeats: number): SeatAnchor => {
  const safeTotal = Math.max(1, totalSeats);
  const angleStep = (Math.PI * 2) / safeTotal;
  const startAngle = Math.PI / 2; // Self seat starts at bottom center
  const angle = startAngle + slotIndex * angleStep;

  const centerX = 50;
  const centerY = 45;
  const radiusX = 46;
  const radiusY = 36;

  const left = centerX + Math.cos(angle) * radiusX;
  const top = centerY + Math.sin(angle) * radiusY;

  return {
    top: `${Math.max(8, Math.min(84, top))}%`,
    left: `${Math.max(5, Math.min(95, left))}%`,
  };
};

const getSeatSlotWidth = (occupiedSeats: number) => {
  if (occupiedSeats <= 2) return "min(14vw, 3.9rem)";
  if (occupiedSeats <= 4) return "min(13vw, 3.7rem)";
  if (occupiedSeats <= 6) return "min(12vw, 3.5rem)";
  return "min(11vw, 3.3rem)";
};

const getPositionBadges = (
  playerPosition: number,
  handMeta?: {
    dealerPosition: number;
    smallBlindPosition: number;
    bigBlindPosition: number;
  },
) => {
  if (!handMeta) {
    return [] as string[];
  }

  const badges: string[] = [];
  if (handMeta.dealerPosition === playerPosition) {
    badges.push("D");
  }
  if (handMeta.smallBlindPosition === playerPosition) {
    badges.push("SB");
  }
  if (handMeta.bigBlindPosition === playerPosition) {
    badges.push("BB");
  }
  return badges;
};

export const GameRoom: React.FC = () => {
  const navigate = useNavigate();
  const {
    room,
    player,
    yourCards,
    lastHandResult,
    revealedHandPlayerIds,
    isHost,
    lastError,
    clearError,
    startGame,
    startNextHand,
    showMyHand,
    performAction,
    leaveRoom,
  } = useGame();

  const [hiddenCardsHandNumber, setHiddenCardsHandNumber] = useState<number | null>(null);
  const [inviteCopyStatus, setInviteCopyStatus] = useState<string | null>(null);
  const [trayAmount, setTrayAmount] = useState(0);
  const [trayInputValue, setTrayInputValue] = useState("0");
  const [showRankingsModal, setShowRankingsModal] = useState(false);
  const [quickConfirmAction, setQuickConfirmAction] = useState<QuickConfirmAction | null>(null);
  const [legacyRaiseAmount, setLegacyRaiseAmount] = useState(0);
  const [dragState, setDragState] = useState<DragState>(EMPTY_DRAG_STATE);

  const potDropZoneRef = useRef<HTMLDivElement | null>(null);
  const handResultsPanelRef = useRef<HTMLElement | null>(null);
  const lastAutoScrolledResultRef = useRef<HandResult | null>(null);

  const currentHand = room?.currentHand ?? null;
  const isGameStarted = room?.gameState === "IN_PROGRESS";
  const currentPlayer = room?.players.find((entry) => entry.id === player?.id) ?? null;
  const currentTurnPlayer =
    room?.players.find((entry) => entry.id === currentHand?.currentPlayerTurn) ?? null;

  const minRaise = useMemo(() => {
    if (!room) return 0;
    return currentHand?.minRaise ?? room.config.bigBlind;
  }, [currentHand?.minRaise, room]);

  const callAmount =
    currentHand && currentPlayer
      ? Math.max(0, currentHand.currentBet - currentPlayer.currentBet)
      : 0;
  const inferredPotFromBets = room
    ? room.players.reduce((sum, seatPlayer) => sum + (seatPlayer.currentBet || 0), 0)
    : 0;
  const displayPot = Math.max(currentHand?.pot ?? 0, inferredPotFromBets);
  const currentTableBet = currentHand?.currentBet ?? 0;
  const myCommittedBet = currentPlayer?.currentBet ?? 0;

  const maxStack = currentPlayer?.chips ?? 0;
  const clampTrayAmount = useCallback(
    (value: number) => Math.max(0, Math.min(maxStack, Math.round(value))),
    [maxStack],
  );
  const canCheck = callAmount === 0;
  const resolvedPlayerId = currentPlayer?.id ?? player?.id ?? null;
  const isYourTurn = Boolean(
    currentHand?.currentPlayerTurn &&
      resolvedPlayerId &&
      currentHand.currentPlayerTurn === resolvedPlayerId,
  );
  const currentHandNumber = currentHand?.handNumber ?? null;
  const showHoleCards =
    currentHandNumber === null || hiddenCardsHandNumber !== currentHandNumber;

  const isHandPausedForNext =
    Boolean(currentHand) && currentHand?.currentPlayerTurn === null;
  const canHostStartNextHand =
    isHost && isGameStarted && isHandPausedForNext && (room?.players.length ?? 0) >= 2;

  const isShowdownComplete =
    Boolean(lastHandResult) &&
    isHandPausedForNext &&
    currentHand?.bettingRound === "SHOWDOWN";
  const shouldForceShowHoleCards = isShowdownComplete;
  const isShowingHoleCards = shouldForceShowHoleCards || showHoleCards;

  const myCompletedHand =
    lastHandResult?.playerHands.find((entry) => entry.playerId === player?.id) ?? null;
  const canRevealMyCompletedHand =
    Boolean(lastHandResult) && Boolean(myCompletedHand) && !isShowdownComplete;

  const revealedHandPlayerIdSet = useMemo(
    () => new Set(revealedHandPlayerIds),
    [revealedHandPlayerIds],
  );
  const isMyCompletedHandRevealed = player?.id
    ? revealedHandPlayerIdSet.has(player.id)
    : false;
  const isPlayerHandVisible = (playerId: string) =>
    isShowdownComplete || revealedHandPlayerIdSet.has(playerId);

  const winnersByPlayerId = useMemo(
    () =>
      new Map(
        (lastHandResult?.winners ?? []).map((winner) => [winner.playerId, winner]),
      ),
    [lastHandResult],
  );

  const handResultRows = useMemo(() => {
    if (!lastHandResult) return [];
    return lastHandResult.playerHands.map((entry, idx) => ({
      ...entry,
      amountWon: winnersByPlayerId.get(entry.playerId)?.amountWon ?? 0,
      isWinner: winnersByPlayerId.has(entry.playerId),
      rankOrder: idx + 1,
    }));
  }, [lastHandResult, winnersByPlayerId]);

  const inviteUrl = useMemo(() => {
    if (!room?.id || typeof window === "undefined") return "";
    return `${window.location.origin}/room/${room.id}`;
  }, [room?.id]);

  const orbitCapacity = useMemo(() => {
    if (!room) return 6;
    return room.config.maxPlayers > 6 ? 10 : 6;
  }, [room]);

  const seatSlotWidth = useMemo(
    () => getSeatSlotWidth(room?.players.length ?? 0),
    [room?.players.length],
  );
  const playerRankings = useMemo(
    () => {
      if (!room) return [];
      return [...room.players]
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
    },
    [room],
  );

  const seatSlots = useMemo(() => {
    if (!room || !player) return [] as Array<{
      slotIndex: number;
      position: number;
      seatPlayer: Player;
      anchor: SeatAnchor;
    }>;
    const myPosition = currentPlayer?.position ?? player.position;
    const orderedPlayers = [...room.players].sort((a, b) => {
      const aOffset = (a.position - myPosition + orbitCapacity) % orbitCapacity;
      const bOffset = (b.position - myPosition + orbitCapacity) % orbitCapacity;
      return aOffset - bOffset;
    });

    return orderedPlayers.map((seatPlayer, slotIndex) => ({
      slotIndex,
      position: seatPlayer.position,
      seatPlayer,
      anchor: getOrbitAnchor(slotIndex, orderedPlayers.length),
    }));
  }, [currentPlayer?.position, orbitCapacity, player, room]);

  const communitySlots = Array.from(
    { length: 5 },
    (_, idx) => currentHand?.communityCards[idx] ?? null,
  );

  const dropResolution = useMemo(
    () =>
      resolveDropIntent({
        trayAmount,
        callAmount,
        minRaise,
        stack: maxStack,
      }),
    [callAmount, maxStack, minRaise, trayAmount],
  );
  const canStartDrag = isYourTurn && trayAmount > 0 && Boolean(dropResolution.intent);

  const trayPresetButtons = useMemo<TrayPresetButton[]>(() => {
    const clampToStack = (value: number) => clampTrayAmount(value);
    const commitToTargetTotalBet = (targetTotalBet: number) =>
      clampToStack(Math.max(0, targetTotalBet - myCommittedBet));
    const halfPotCommit = clampToStack(Math.max(callAmount, Math.round(displayPot / 2)));
    const minRaiseCommit = clampToStack(callAmount > 0 ? callAmount + minRaise : minRaise);

    const presets: TrayPresetButton[] = [
      {
        key: "min-raise",
        label: callAmount > 0 ? "Min Raise" : "Min Bet",
        amount: minRaiseCommit,
        testId: "chip-load-min-raise",
        tone: "raise",
        enabled: false,
      },
    ];

    if (callAmount > 0) {
      presets.push({
        key: "call",
        label: "Call",
        amount: Math.min(callAmount, maxStack),
        testId: "chip-load-call",
        tone: "call",
        enabled: false,
      });
    }

    presets.push(
      {
        key: "double",
        label: "2x",
        amount:
          callAmount > 0
            ? commitToTargetTotalBet(currentTableBet * 2)
            : clampToStack(minRaise * 2),
        testId: "chip-load-double",
        tone: "raise",
        enabled: false,
      },
      {
        key: "three-bet",
        label: "3-Bet",
        amount:
          callAmount > 0
            ? commitToTargetTotalBet(currentTableBet * 3)
            : clampToStack(minRaise * 3),
        testId: "chip-load-3bet",
        tone: "raise",
        enabled: false,
      },
      {
        key: "half-pot",
        label: "1/2 Pot",
        amount: halfPotCommit,
        testId: "chip-load-half-pot",
        tone: "raise",
        enabled: false,
      },
      {
        key: "all-in",
        label: "All-In",
        amount: maxStack,
        testId: "chip-load-all-in",
        tone: "allin",
        enabled: false,
      },
    );

    return presets.map((preset) => {
      const resolution = resolveDropIntent({
        trayAmount: preset.amount,
        callAmount,
        minRaise,
        stack: maxStack,
      });
      return {
        ...preset,
        enabled: isYourTurn && preset.amount > 0 && Boolean(resolution.intent),
      };
    });
  }, [
    callAmount,
    clampTrayAmount,
    currentTableBet,
    displayPot,
    isYourTurn,
    maxStack,
    minRaise,
    myCommittedBet,
  ]);

  const isAutomationMode =
    typeof window !== "undefined" && Boolean(window.navigator.webdriver);

  useEffect(() => {
    if (!room || !player) {
      const redirectTimer = window.setTimeout(() => {
        navigate("/", { replace: true });
      }, 2200);
      return () => window.clearTimeout(redirectTimer);
    }

    return undefined;
  }, [navigate, player, room]);

  useEffect(() => {
    if (!inviteCopyStatus) return;
    const timeoutId = window.setTimeout(() => setInviteCopyStatus(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [inviteCopyStatus]);

  useEffect(() => {
    if (!lastHandResult) {
      lastAutoScrolledResultRef.current = null;
      return;
    }

    if (lastAutoScrolledResultRef.current === lastHandResult) {
      return;
    }

    lastAutoScrolledResultRef.current = lastHandResult;
    window.requestAnimationFrame(() => {
      handResultsPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [lastHandResult]);

  useEffect(() => {
    setLegacyRaiseAmount((prev) => {
      if (prev <= 0) return 0;
      return Math.min(prev, maxStack);
    });
  }, [maxStack]);

  useEffect(() => {
    if (!isYourTurn) {
      setTrayAmount(0);
      setQuickConfirmAction(null);
      setDragState(EMPTY_DRAG_STATE);
    }
  }, [isYourTurn]);

  useEffect(() => {
    if (!quickConfirmAction || isAutomationMode) return;
    const timer = window.setTimeout(() => setQuickConfirmAction(null), 2200);
    return () => window.clearTimeout(timer);
  }, [isAutomationMode, quickConfirmAction]);

  useEffect(() => {
    setTrayInputValue(String(trayAmount));
  }, [trayAmount]);

  useEffect(() => {
    if (!lastError && !showRankingsModal && !quickConfirmAction) return;

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (lastError) clearError();
      if (showRankingsModal) setShowRankingsModal(false);
      if (quickConfirmAction) setQuickConfirmAction(null);
    };

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [clearError, lastError, quickConfirmAction, showRankingsModal]);

  const isPointInDropZone = useCallback((clientX: number, clientY: number) => {
    const dropZone = potDropZoneRef.current;
    if (!dropZone) return false;

    const rect = dropZone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = Math.max(rect.width, rect.height) / 2 + DRAG_SNAP_RADIUS_PX;
    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;

    return deltaX * deltaX + deltaY * deltaY <= radius * radius;
  }, []);

  const commitTrayDrop = useCallback(() => {
    if (!isYourTurn) {
      return;
    }

    if (!dropResolution.intent) {
      return;
    }

    setQuickConfirmAction(null);
    performAction(dropResolution.intent.action, dropResolution.intent.amount);
    setTrayAmount(0);
  }, [dropResolution.intent, isYourTurn, performAction]);

  const setTrayDirectly = (nextAmount: number) => {
    if (!isYourTurn) return;

    const clamped = clampTrayAmount(nextAmount);
    setTrayAmount(clamped);
  };

  const clearTray = () => {
    if (!isYourTurn) return;
    setTrayAmount(0);
  };

  const handleCustomTrayInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!isYourTurn) return;

    const numericText = event.target.value.replace(/\D/g, "");
    if (!numericText) {
      setTrayInputValue("");
      setTrayAmount(0);
      return;
    }

    const parsed = Number(numericText);
    if (Number.isNaN(parsed)) {
      return;
    }

    const clamped = clampTrayAmount(parsed);
    setTrayInputValue(String(clamped));
    setTrayAmount(clamped);
  };

  const handleCustomTrayInputBlur = () => {
    if (!isYourTurn) return;
    setTrayInputValue(String(trayAmount));
  };

  const handleDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!canStartDrag) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    setDragState({
      active: true,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      overDropZone: isPointInDropZone(event.clientX, event.clientY),
    });
  };

  const handleDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    setDragState((prev) => {
      if (!prev.active || prev.pointerId !== event.pointerId) {
        return prev;
      }

      return {
        ...prev,
        clientX: event.clientX,
        clientY: event.clientY,
        overDropZone: isPointInDropZone(event.clientX, event.clientY),
      };
    });
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    const isSamePointer = dragState.active && dragState.pointerId === event.pointerId;
    const isCancelled = event.type === "pointercancel";
    const shouldCommit =
      isSamePointer &&
      !isCancelled &&
      (dragState.overDropZone || isPointInDropZone(event.clientX, event.clientY));

    setDragState((prev) =>
      !prev.active || prev.pointerId !== event.pointerId ? prev : EMPTY_DRAG_STATE,
    );

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (shouldCommit) {
      commitTrayDrop();
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteUrl) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
      } else if (!fallbackCopyText(inviteUrl)) {
        throw new Error("Clipboard API unavailable");
      }

      setInviteCopyStatus("Copied invite link");
    } catch (error) {
      console.error("Failed to copy invite link:", error);
      setInviteCopyStatus("Copy failed");
    }
  };

  const handleLeave = () => {
    leaveRoom();
    navigate("/");
  };

  const handleLegacyAction = (action: PlayerAction) => {
    if (action === "raise") {
      if (legacyRaiseAmount < minRaise) {
        return;
      }
      if (legacyRaiseAmount > maxStack) {
        return;
      }

      setQuickConfirmAction(null);
      performAction("raise", legacyRaiseAmount);
      return;
    }

    if (action !== "check" && action !== "fold") {
      setQuickConfirmAction(null);
    }
    performAction(action);
  };

  const handleQuickDecisionAction = (action: QuickConfirmAction) => {
    if (!isYourTurn) return;
    if (action === "check" && !canCheck) return;

    if (isAutomationMode) {
      performAction(action);
      return;
    }

    setQuickConfirmAction(action);
  };

  const feedbackInsight = useMemo<FeedbackInsight | null>(() => {
    if (!lastError) {
      return null;
    }

    const normalized = lastError.toLowerCase();
    const insight: FeedbackInsight = {
      title: "Action Rejected",
      reason: lastError,
      suggestions: ["Try again after the game state updates."],
      technicalDetail: lastError,
    };

    if (normalized.includes("not your turn")) {
      insight.title = "Not Your Turn";
      insight.reason = "Another player must act first.";
      insight.suggestions = [
        `Wait until the Turn indicator shows ${currentTurnPlayer?.name ?? "the active player"}.`,
        "Review the pot and choose fold, call/check, or raise.",
      ];
    } else if (normalized.includes("cannot check")) {
      insight.title = "Check Not Allowed";
      insight.reason = "You are facing a bet, so check is not legal right now.";
      insight.suggestions = [
        `Call $${callAmount}, raise at least $${minRaise}, or fold.`,
        "Use the To Call value in the action dock to verify required chips.",
      ];
    } else if (normalized.includes("minimum")) {
      insight.title = "Raise Too Small";
      insight.reason = "Your raise is below the minimum allowed for this betting round.";
      insight.suggestions = [
        `Raise at least $${minRaise}.`,
        "Or use call/check if you do not want to raise.",
      ];
    } else if (normalized.includes("insufficient chips")) {
      insight.title = "Insufficient Chips";
      insight.reason = "Your stack is not enough for this action.";
      insight.suggestions = [`Current stack: $${maxStack}.`, "Use all-in or lower commitment."];
    }

    return insight;
  }, [callAmount, currentTurnPlayer?.name, lastError, maxStack, minRaise]);

  if (!room || !player) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-lg rounded-2xl border border-emerald-700/70 bg-emerald-950/60 p-6 text-emerald-50 shadow-lg">
          <h1 className="text-lg font-semibold">Restoring your room...</h1>
          <p className="mt-2 text-sm text-emerald-100/80">
            If this takes too long, we will return you to the lobby automatically.
          </p>
          <button
            onClick={() => navigate("/", { replace: true })}
            className="mt-4 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/35"
          >
            Go to Lobby Now
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="table-shell">
      <header className="table-micro-hud">
        <div className="min-w-0">
          <h1
            className="truncate text-base font-black tracking-tight text-white"
            data-testid="room-title"
          >
            Room: {room.id}
          </h1>
          <p className="text-[11px] text-emerald-100/70" data-testid="room-player-count">
            Players: {room.players.length}/{room.config.maxPlayers}
          </p>
        </div>

        <div className="hidden" aria-live="polite">
          <span className="hud-chip" data-testid="pot-value">
            Pot: ${displayPot}
          </span>
          <span className="hud-chip" data-testid="your-chips">
            Your Chips: ${currentPlayer?.chips ?? 0}
          </span>
          {currentTurnPlayer && (
            <span
              className="hud-chip border-amber-400/70 bg-amber-500/20 text-amber-100"
              data-testid="turn-player"
            >
              Turn: {currentTurnPlayer.name}
            </span>
          )}
        </div>

        <section className="table-controls-strip">
          {currentHand && (
            <span className="hud-chip" data-testid="round-value">
              Round: {currentHand.bettingRound}
            </span>
          )}
          <button
            onClick={handleCopyInviteLink}
            data-testid="copy-room-url-button"
            className="rounded-full border border-cyan-300/55 bg-cyan-900/30 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/40"
          >
            Copy Invite
          </button>
          {inviteCopyStatus && (
            <span
              data-testid="copy-room-url-status"
              className={`text-xs font-semibold ${
                inviteCopyStatus.includes("failed") ? "text-amber-200" : "text-emerald-200"
              }`}
            >
              {inviteCopyStatus}
            </span>
          )}
          <button
            onClick={() => setShowRankingsModal(true)}
            data-testid="open-rankings-button"
            className="rounded-full border border-emerald-400/65 bg-emerald-900/40 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
          >
            Rankings
          </button>

          <div className="ml-auto flex items-center gap-2">
            {isHost && !isGameStarted && room.players.length >= 2 && (
              <button
                onClick={startGame}
                data-testid="start-game-button"
                className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-emerald-950 transition hover:bg-emerald-400"
              >
                Start
              </button>
            )}
            <button
              onClick={handleLeave}
              data-testid="leave-room-button"
              className="rounded-full border border-rose-400/70 bg-rose-900/30 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-rose-100 transition hover:bg-rose-800/40"
            >
              Leave
            </button>
          </div>
        </section>
      </header>

      <section className="table-board-wrap" data-testid="table-board-section">
        <div className="felt-oval">
          <div className="board-center-stack">
            <div className="community-lane" data-testid="community-cards">
              {communitySlots.map((card, idx) => {
                const isRevealed = Boolean(card);
                return (
                  <div
                    key={`community-slot-${idx}-${card ? `${card.suit}-${card.rank}` : "back"}`}
                    className={isRevealed ? "community-reveal" : ""}
                    style={isRevealed ? { animationDelay: `${idx * 70}ms` } : undefined}
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

            <div
              ref={potDropZoneRef}
              data-testid="pot-drop-zone"
              className={`pot-drop-zone ${
                isYourTurn ? "pot-drop-zone--active" : ""
              } ${dragState.overDropZone ? "pot-drop-zone--hover" : ""}`}
            >
              <span className="pot-drop-zone__label">Pot</span>
              <span className="pot-drop-zone__value">${displayPot}</span>
              {isYourTurn && (
                <span className="pot-drop-zone__hint">Drag chips here</span>
              )}
            </div>
          </div>

          <div className="seat-orbit" data-testid="players-section">
            {seatSlots.map((slot) => {
              const seatPlayer = slot.seatPlayer;
              const badges = getPositionBadges(slot.position, currentHand
                ? {
                    dealerPosition: currentHand.dealerPosition,
                    smallBlindPosition: currentHand.smallBlindPosition,
                    bigBlindPosition: currentHand.bigBlindPosition,
                  }
                : undefined);

              const seatPlayerId = seatPlayer?.id ?? null;
              const isCurrentTurnSeat =
                seatPlayerId !== null && currentHand?.currentPlayerTurn === seatPlayerId;
              const isSelfSeat = seatPlayer?.id === resolvedPlayerId;
              const isFolded = seatPlayer?.status === "folded";
              const isAllIn = seatPlayer?.status === "all-in";
              const isDisconnected = seatPlayer?.status === "disconnected";

              return (
                <div
                  key={`seat-slot-${slot.slotIndex}`}
                  className="seat-orbit__slot"
                  style={{
                    top: slot.anchor.top,
                    left: slot.anchor.left,
                    width: seatSlotWidth,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <article
                    data-testid={`player-seat-${seatPlayer.id}`}
                    className={`seat-pod ${isCurrentTurnSeat ? "seat-pod--turn" : ""} ${
                      isDisconnected ? "seat-pod--disconnected" : ""
                    } ${
                      isFolded ? "seat-pod--folded" : ""
                    }`}
                  >
                    {isSelfSeat && (
                      <span className="seat-pod__you-indicator" aria-label="You" title="You">
                        🫵
                      </span>
                    )}
                    <div className="seat-pod__row">
                      <span className="seat-pod__name text-white font-semibold">
                        {seatPlayer.name}
                      </span>
                      <div className="seat-pod__badges">
                        {badges.map((badge) => (
                          <span key={`${seatPlayer.id}-${badge}`} className="seat-pod__badge">
                            {badge}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="seat-pod__row seat-pod__row--chips">
                      <div className="seat-pod__stack text-green-400 text-sm">${seatPlayer.chips}</div>
                    </div>

                    <div className="seat-pod__row seat-pod__row--bet">
                      <div
                        className={`seat-pod__bet ${
                          seatPlayer.currentBet > 0 ? "seat-pod__bet--active" : ""
                        }`}
                      >
                        Bet: ${seatPlayer.currentBet}
                      </div>
                      {isAllIn && (
                        <span className="seat-pod__state seat-pod__state--allin">ALL-IN</span>
                      )}
                      {isDisconnected && (
                        <span className="seat-pod__state seat-pod__state--disconnected">
                          DISCONNECTED
                        </span>
                      )}
                      {isFolded && (
                        <span className="seat-pod__state seat-pod__state--folded">FOLDED</span>
                      )}
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {lastHandResult && (
        <section
          ref={handResultsPanelRef}
          className="surface-panel mx-3 mt-3 p-4"
          data-testid="hand-results-panel"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3
                className="text-sm font-semibold text-emerald-100"
                data-testid="hand-results-title"
              >
                Hand #{currentHandNumber ?? "?"} Results
              </h3>
              <p className="mt-1 text-xs text-emerald-100/75" data-testid="hand-results-mode">
                {isShowdownComplete
                  ? "Showdown complete: hands are automatically revealed."
                  : "Hand ended without showdown: players may reveal manually."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="hud-chip" data-testid="hand-results-pot">
                Pot: ${lastHandResult.totalPot}
              </span>
              <span className="hud-chip" data-testid="hand-results-winner-count">
                Winners: {lastHandResult.winners.length}
              </span>
            </div>
          </div>

          {canRevealMyCompletedHand && !isMyCompletedHandRevealed && (
            <button
              onClick={showMyHand}
              data-testid="show-my-hand-button"
              className="mt-3 rounded-lg border border-cyan-400/60 bg-cyan-900/30 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/45"
            >
              Show My Hand
            </button>
          )}

          {isMyCompletedHandRevealed && !isShowdownComplete && (
            <p
              className="mt-3 text-xs font-semibold uppercase tracking-wide text-cyan-100/90"
              data-testid="my-hand-revealed-indicator"
            >
              Your hand is revealed to the table.
            </p>
          )}

          <div
            className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3"
            data-testid="hand-results-winners"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
              Winners
            </p>
            <div className="mt-2 space-y-2 text-sm text-emerald-50">
              {lastHandResult.winners.map((winner) => {
                const isSelf = winner.playerId === player.id;
                const showWinnerHand = isPlayerHandVisible(winner.playerId);
                const winnerHand = winner.hand as HandEvaluation | null;

                return (
                  <div
                    key={`winner-${winner.playerId}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-700/60 bg-emerald-900/30 px-3 py-2"
                    data-testid={`winner-row-${winner.playerId}`}
                  >
                    <span className="font-semibold">
                      {winner.playerName}
                      {isSelf ? " (You)" : ""}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full border border-emerald-500/60 bg-emerald-700/30 px-2 py-1 font-semibold">
                        +${winner.amountWon}
                      </span>
                      {showWinnerHand && winnerHand ? (
                        <span
                          className="rounded-full border border-cyan-400/60 bg-cyan-900/35 px-2 py-1 font-semibold text-cyan-100"
                          data-testid={`winner-rank-${winner.playerId}`}
                        >
                          {formatHandRank(winnerHand.rank)}
                        </span>
                      ) : showWinnerHand ? (
                        <span className="text-emerald-200/70">Cards shown</span>
                      ) : (
                        <span className="text-emerald-200/70">Hand hidden</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {handResultRows.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-3" data-testid="hand-results-rows">
              {handResultRows.map((entry) => {
                const isSelf = entry.playerId === player.id;
                const showCards = isPlayerHandVisible(entry.playerId);
                const evaluatedHand = entry.hand as HandEvaluation | null;

                return (
                  <article
                    key={`hand-result-${entry.playerId}`}
                    className={`rounded-xl border p-3 ${
                      entry.isWinner
                        ? "border-amber-400/70 bg-amber-500/10"
                        : "border-emerald-700/60 bg-emerald-950/45"
                    }`}
                    data-testid={`hand-result-row-${entry.playerId}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          #{entry.rankOrder} {entry.playerName}
                          {isSelf ? " (You)" : ""}
                        </p>
                        <p className="text-xs text-emerald-100/70">
                          {entry.isWinner ? `Won $${entry.amountWon}` : "No payout"}
                        </p>
                      </div>
                      {entry.isWinner && (
                        <span className="rounded-full border border-amber-300/70 bg-amber-300/20 px-2 py-1 text-xs font-semibold text-amber-100">
                          Winner
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {showCards
                        ? entry.cards.map((card, idx) => (
                            <Card
                              key={`${entry.playerId}-shown-${idx}`}
                              card={card}
                              size="small"
                              dataTestId={`hand-result-card-${entry.playerId}-${idx}`}
                            />
                          ))
                        : [0, 1].map((idx) => (
                            <Card
                              key={`${entry.playerId}-hidden-${idx}`}
                              card={null}
                              size="small"
                              faceDown
                              dataTestId={`hand-result-hidden-card-${entry.playerId}-${idx}`}
                            />
                          ))}
                    </div>

                    <p
                      className="mt-2 text-xs text-emerald-100/75"
                      data-testid={`hand-result-rank-${entry.playerId}`}
                    >
                      {showCards
                        ? evaluatedHand
                          ? `${formatHandRank(evaluatedHand.rank)} - ${evaluatedHand.description}`
                          : "Cards shown (no evaluated hand)."
                        : "Hand hidden"}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {canHostStartNextHand && (
        <section className="surface-panel mx-3 mt-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-emerald-100">Hand complete</h3>
              <p className="text-xs text-emerald-100/70">
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

      <section className="chip-composer-dock" data-testid="turn-overlay">
        <div className="chip-composer-dock__cards" data-testid="your-cards-section">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-100/80">
              Your Cards
            </h3>
            <button
              onClick={() =>
                setHiddenCardsHandNumber((prev) =>
                  showHoleCards ? currentHandNumber ?? prev : null,
                )
              }
              data-testid="toggle-hole-cards"
              disabled={shouldForceShowHoleCards}
              className="rounded-full border border-emerald-500/60 bg-emerald-900/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-100 transition hover:bg-emerald-800/45 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {shouldForceShowHoleCards
                ? "Cards Revealed"
                : showHoleCards
                  ? "Hide"
                  : "Show"}
            </button>
          </div>

          {isShowingHoleCards && yourCards && yourCards.length > 0 ? (
            <div className="mt-2 flex justify-center gap-2">
              {yourCards.map((card, idx) => (
                <Card key={idx} card={card} size="small" dataTestId={`your-card-${idx}`} />
              ))}
            </div>
          ) : (
            <div
              className="mt-2 rounded-lg border border-dashed border-emerald-700/70 bg-emerald-950/45 px-3 py-2 text-center text-xs text-emerald-100/70"
              data-testid="hole-cards-hidden-state"
            >
              {isShowingHoleCards ? "Cards appear when a hand starts." : "Hole cards hidden."}
            </div>
          )}
        </div>

        {isYourTurn && (
          <div data-testid="action-dock" className="chip-composer-dock__action-area">
            <div className="chip-composer-dock__header">
              <span className="chip-composer-dock__title">Your Turn</span>
              <span className="chip-composer-dock__meta">To Call: ${callAmount}</span>
              <span className="chip-composer-dock__meta">Min Raise: ${minRaise}</span>
            </div>

            <div className="chip-composer-dock__tray-row">
              <div className="chip-composer-dock__tray-panel">
                <button
                  type="button"
                  onPointerDown={handleDragStart}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                  data-testid="chip-stack-draggable"
                  disabled={!canStartDrag}
                  className={`chip-stack chip-stack--hero ${dragState.active ? "chip-stack--dragging" : ""}`}
                >
                  <span className="chip-stack__label">Tray</span>
                  <span
                    key={trayAmount}
                    className="chip-stack__value chip-stack__value--animated"
                    data-testid="tray-amount-value"
                  >
                    ${trayAmount}
                  </span>
                </button>
              </div>

              <div className="chip-composer-dock__control-panel">
                <div className="chip-composer-dock__presets">
                  {trayPresetButtons.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => setTrayDirectly(preset.amount)}
                      className={`chip-quick chip-quick--preset chip-quick--${preset.tone}`}
                      disabled={!preset.enabled}
                      data-testid={preset.testId}
                    >
                      <span>{preset.label}</span>
                      <span>${preset.amount}</span>
                    </button>
                  ))}
                </div>

                <div className="chip-composer-dock__manual">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={trayInputValue}
                    onChange={handleCustomTrayInputChange}
                    onBlur={handleCustomTrayInputBlur}
                    data-testid="chip-custom-input"
                    aria-label="Tray amount"
                    className="chip-input"
                  />
                  <button
                    onClick={clearTray}
                    className="chip-clear"
                    disabled={!isYourTurn || trayAmount <= 0}
                    data-testid="chip-clear"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <div className="chip-composer-dock__footer">
              <button
                onClick={() => handleQuickDecisionAction("check")}
                disabled={!canCheck}
                data-testid={canCheck ? "action-check" : "action-check-disabled"}
                className="chip-action chip-action--check chip-action--small"
              >
                Check
              </button>
              <button
                onClick={() => handleQuickDecisionAction("fold")}
                data-testid="action-fold"
                className="chip-action chip-action--fold chip-action--small"
              >
                Fold
              </button>
            </div>

            {isAutomationMode && (
              <div className="chip-composer-dock__legacy" data-testid="legacy-action-controls">
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {canCheck ? (
                    <button
                      onClick={() => handleLegacyAction("check")}
                      data-testid="action-check-legacy"
                      className="chip-action chip-action--check"
                    >
                      Check
                    </button>
                  ) : (
                    <button
                      onClick={() => handleLegacyAction("call")}
                      data-testid="action-call"
                      className="chip-action chip-action--call"
                    >
                      Call ${callAmount}
                    </button>
                  )}
                  <button
                    onClick={() => handleLegacyAction("all-in")}
                    data-testid="action-all-in"
                    className="chip-action chip-action--allin"
                  >
                    All-In ${maxStack}
                  </button>
                </div>

                <div className="mt-2 flex gap-2">
                  <input
                    type="number"
                    min={minRaise}
                    max={maxStack}
                    value={legacyRaiseAmount}
                    onChange={(event) => setLegacyRaiseAmount(Number(event.target.value))}
                    data-testid="raise-input"
                    className="flex-1 rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-2 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
                  />
                  <button
                    onClick={() => handleLegacyAction("raise")}
                    disabled={legacyRaiseAmount < minRaise || legacyRaiseAmount > maxStack}
                    data-testid="action-raise"
                    className="chip-action chip-action--raise"
                  >
                    Raise
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {dragState.active && (
        <div
          className="chip-drag-ghost"
          style={{
            left: `${dragState.clientX - 54}px`,
            top: `${dragState.clientY - 30}px`,
          }}
        >
          ${trayAmount}
        </div>
      )}

      {showRankingsModal && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-emerald-950/85 p-4 backdrop-blur-sm"
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

      {!isAutomationMode && quickConfirmAction && (
        <div
          className="fixed inset-0 z-[84] flex items-center justify-center bg-emerald-950/80 p-4 backdrop-blur-sm"
          data-testid="action-quick-confirm-modal"
        >
          <div className="surface-panel w-full max-w-xs p-4">
            <p className="text-sm font-semibold text-white">
              Confirm {quickConfirmAction}?
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setQuickConfirmAction(null)}
                data-testid="action-quick-confirm-cancel"
                className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const actionToApply = quickConfirmAction;
                  setQuickConfirmAction(null);
                  performAction(actionToApply);
                }}
                data-testid="action-quick-confirm-accept"
                className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-300"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {feedbackInsight && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-emerald-950/85 p-4 backdrop-blur-sm"
          data-testid="error-modal"
        >
          <div className="surface-panel w-full max-w-xl p-4 md:p-6">
            <h3 className="text-lg font-black text-white">{feedbackInsight.title}</h3>
            <p className="mt-2 text-sm text-emerald-100/90" data-testid="error-modal-reason">
              {feedbackInsight.reason}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
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
                <p className="mt-1 font-semibold text-white">${maxStack}</p>
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
                onClick={clearError}
                data-testid="dismiss-error-button"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
