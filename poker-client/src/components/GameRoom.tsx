import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toPng } from "html-to-image";
import { useLocalization } from "../contexts/LocalizationContext";
import { useGame, type PlayerActionFlashEvent } from "../contexts/GameContext";
import { Card } from "./Card";
import type { HandEvaluation, HandResult, Player, PlayerAction } from "poker-types";
import type { Locale, MessageKey } from "../i18n/messages";

const DRAG_SNAP_RADIUS_PX = 32;
const ACTION_ALERT_VISIBLE_MS = 1300;
const ACTION_ALERT_TOTAL_MS = 1600;
const TURN_ALERT_VISIBLE_MS = 1650;
const POT_ANIMATION_MS = 360;

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

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;
type ActionCenterAlertTone = "neutral" | "aggressive" | "fold" | "allin";

type ActionCenterAlert = {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  tone: ActionCenterAlertTone;
  exiting: boolean;
};

type ActionPointerVector = {
  x: number;
  y: number;
  angle: number;
  length: number;
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

const HAND_RANK_LABELS: Record<Locale, Record<HandEvaluation["rank"], string>> = {
  en: {
    ROYAL_FLUSH: "Royal Flush",
    STRAIGHT_FLUSH: "Straight Flush",
    FOUR_OF_A_KIND: "Four Of A Kind",
    FULL_HOUSE: "Full House",
    FLUSH: "Flush",
    STRAIGHT: "Straight",
    THREE_OF_A_KIND: "Three Of A Kind",
    TWO_PAIR: "Two Pair",
    ONE_PAIR: "One Pair",
    HIGH_CARD: "High Card",
  },
  zh_hans: {
    ROYAL_FLUSH: "皇家同花顺",
    STRAIGHT_FLUSH: "同花顺",
    FOUR_OF_A_KIND: "四条",
    FULL_HOUSE: "葫芦",
    FLUSH: "同花",
    STRAIGHT: "顺子",
    THREE_OF_A_KIND: "三条",
    TWO_PAIR: "两对",
    ONE_PAIR: "一对",
    HIGH_CARD: "高牌",
  },
};

const normalizeRankToken = (raw: string): string => {
  const value = raw.trim().toUpperCase();
  if (value === "14") return "A";
  if (value === "13") return "K";
  if (value === "12") return "Q";
  if (value === "11") return "J";
  return value;
};

const formatHandRank = (rank: HandEvaluation["rank"], locale: Locale): string =>
  HAND_RANK_LABELS[locale][rank] ?? HAND_RANK_LABELS.en[rank];

const formatHandDescription = (
  hand: HandEvaluation,
  locale: Locale,
): string => {
  if (locale !== "zh_hans") {
    return hand.description;
  }

  const text = hand.description;

  if (text === "Royal Flush") return "皇家同花顺";
  if (text === "Flush") return "同花";

  const straightFlush = text.match(/^Straight Flush,\s*(\d+)\s*high$/i);
  if (straightFlush) return `同花顺，${normalizeRankToken(straightFlush[1])}高`;

  const fourOfAKind = text.match(/^Four\s+([2-9]|10|[JQKA])s$/i);
  if (fourOfAKind) return `四条${normalizeRankToken(fourOfAKind[1])}`;

  const fullHouse = text.match(/^Full House,\s*([2-9]|10|[JQKA])s\s+over\s+([2-9]|10|[JQKA])s$/i);
  if (fullHouse) {
    return `葫芦，${normalizeRankToken(fullHouse[1])}带${normalizeRankToken(fullHouse[2])}`;
  }

  const straight = text.match(/^Straight,\s*(\d+)\s*high$/i);
  if (straight) return `顺子，${normalizeRankToken(straight[1])}高`;

  const threeOfAKind = text.match(/^Three\s+([2-9]|10|[JQKA])s$/i);
  if (threeOfAKind) return `三条${normalizeRankToken(threeOfAKind[1])}`;

  const twoPair = text.match(/^Two Pair,\s*([2-9]|10|[JQKA])s\s+and\s+([2-9]|10|[JQKA])s$/i);
  if (twoPair) return `两对，${normalizeRankToken(twoPair[1])}和${normalizeRankToken(twoPair[2])}`;

  const onePair = text.match(/^Pair of\s+([2-9]|10|[JQKA])s$/i);
  if (onePair) return `一对${normalizeRankToken(onePair[1])}`;

  const highCard = text.match(/^High Card\s+([2-9]|10|[JQKA]|\d+)$/i);
  if (highCard) return `高牌${normalizeRankToken(highCard[1])}`;

  return text;
};

const resolveDropIntent = ({
  trayAmount,
  callAmount,
  minRaise,
  stack,
  t,
}: {
  trayAmount: number;
  callAmount: number;
  minRaise: number;
  stack: number;
  t: Translate;
}): DropResolution => {
  if (stack <= 0) {
    return { intent: null, reason: t("game.drag.noChips") };
  }

  if (trayAmount <= 0) {
    return { intent: null, reason: t("game.drag.addChips") };
  }

  if (trayAmount > stack) {
    return { intent: null, reason: t("game.drag.trayExceeds", { stack }) };
  }

  if (trayAmount === stack) {
    return {
      intent: { action: "all-in", label: t("game.drag.label.allIn", { amount: stack }) },
      reason: null,
    };
  }

  if (callAmount > 0) {
    if (trayAmount < callAmount) {
      return {
        intent: null,
        reason: t("game.drag.needCall", { callAmount }),
      };
    }

    if (trayAmount === callAmount) {
      return {
        intent: { action: "call", label: t("game.drag.label.call", { amount: callAmount }) },
        reason: null,
      };
    }

    const raiseAmount = trayAmount - callAmount;
    if (raiseAmount < minRaise) {
      return {
        intent: null,
        reason: t("game.drag.minimumRaise", { minRaise }),
      };
    }

    return {
      intent: {
        action: "raise",
        amount: raiseAmount,
        label: t("game.drag.label.raiseByTotal", { raiseAmount, trayAmount }),
      },
      reason: null,
    };
  }

  if (trayAmount < minRaise) {
    return {
      intent: null,
      reason: t("game.drag.minimumOpenRaise", { minRaise }),
    };
  }

  return {
    intent: {
      action: "raise",
      amount: trayAmount,
      label: t("game.drag.label.betRaiseBy", { amount: trayAmount }),
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
  if (occupiedSeats <= 2) return "min(14.8vw, 4.2rem)";
  if (occupiedSeats <= 4) return "min(13.8vw, 4rem)";
  if (occupiedSeats <= 6) return "min(12.8vw, 3.8rem)";
  return "min(11.8vw, 3.6rem)";
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

const toActionCenterAlert = (
  event: PlayerActionFlashEvent,
  t: Translate,
): ActionCenterAlert => {
  const withAmount = (base: string, amount?: number) =>
    typeof amount === "number" && amount > 0 ? `${base} $${amount}` : base;

  switch (event.action) {
    case "fold":
      return {
        id: event.id,
        playerId: event.playerId,
        playerName: event.playerName,
        text: t("game.actionBubble.fold"),
        tone: "fold",
        exiting: false,
      };
    case "check":
      return {
        id: event.id,
        playerId: event.playerId,
        playerName: event.playerName,
        text: t("game.actionBubble.check"),
        tone: "neutral",
        exiting: false,
      };
    case "call":
      return {
        id: event.id,
        playerId: event.playerId,
        text: withAmount(t("game.actionBubble.call"), event.amount),
        playerName: event.playerName,
        tone: "neutral",
        exiting: false,
      };
    case "all-in":
      return {
        id: event.id,
        playerId: event.playerId,
        text: withAmount(t("game.actionBubble.allIn"), event.amount),
        playerName: event.playerName,
        tone: "allin",
        exiting: false,
      };
    case "raise":
      return {
        id: event.id,
        playerId: event.playerId,
        text: withAmount(
          event.isOpeningBet ? t("game.actionBubble.bet") : t("game.actionBubble.raise"),
          event.amount,
        ),
        playerName: event.playerName,
        tone: "aggressive",
        exiting: false,
      };
  }
};

export const GameRoom: React.FC = () => {
  const navigate = useNavigate();
  const {
    room,
    player,
    yourCards,
    lastHandResult,
    lastPlayerActionEvent,
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
  const { locale, setLocale, t } = useLocalization();

  const [inviteCopyStatus, setInviteCopyStatus] = useState<string | null>(null);
  const [inviteCopyStatusTone, setInviteCopyStatusTone] = useState<"success" | "error" | null>(
    null,
  );
  const [trayAmount, setTrayAmount] = useState(0);
  const [trayInputValue, setTrayInputValue] = useState("0");
  const [showRankingsModal, setShowRankingsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [quickConfirmAction, setQuickConfirmAction] = useState<QuickConfirmAction | null>(null);
  const [legacyRaiseAmount, setLegacyRaiseAmount] = useState(0);
  const [dragState, setDragState] = useState<DragState>(EMPTY_DRAG_STATE);
  const [actionCenterAlert, setActionCenterAlert] = useState<ActionCenterAlert | null>(null);
  const [actionPointerVector, setActionPointerVector] = useState<ActionPointerVector | null>(null);
  const [turnAlertToken, setTurnAlertToken] = useState<number | null>(null);
  const [isCardsFlyoutOpen, setIsCardsFlyoutOpen] = useState(true);
  const [turnOverlayHeight, setTurnOverlayHeight] = useState(0);

  const potDropZoneRef = useRef<HTMLDivElement | null>(null);
  const handResultsPanelRef = useRef<HTMLElement | null>(null);
  const lastAutoScrolledResultRef = useRef<HandResult | null>(null);
  const turnOverlayRef = useRef<HTMLElement | null>(null);
  const actionCenterAlertRef = useRef<HTMLDivElement | null>(null);
  const seatNodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const actionAlertHideTimeoutRef = useRef<number | null>(null);
  const actionAlertClearTimeoutRef = useRef<number | null>(null);
  const turnAlertTimeoutRef = useRef<number | null>(null);
  const previousIsYourTurnRef = useRef<boolean | null>(null);

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
  const [animatedPotValue, setAnimatedPotValue] = useState(displayPot);
  const [potAnimationTick, setPotAnimationTick] = useState(0);
  const animatedPotRef = useRef(displayPot);
  const potAnimationFrameRef = useRef<number | null>(null);
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

  const isHandPausedForNext =
    Boolean(currentHand) && currentHand?.currentPlayerTurn === null;
  const canHostStartNextHand =
    isHost && isGameStarted && isHandPausedForNext && (room?.players.length ?? 0) >= 2;
  const isWaitingForHostToStartNextHand =
    !isHost && isGameStarted && isHandPausedForNext && Boolean(lastHandResult);

  const isShowdownComplete =
    Boolean(lastHandResult) &&
    isHandPausedForNext &&
    currentHand?.bettingRound === "SHOWDOWN";

  const myCompletedHand =
    lastHandResult?.playerHands.find((entry) => entry.playerId === player?.id) ?? null;
  const canRevealMyCompletedHand =
    Boolean(lastHandResult) && Boolean(myCompletedHand) && !isShowdownComplete;
  const displayHoleCards =
    isHandPausedForNext && myCompletedHand?.cards?.length
      ? myCompletedHand.cards
      : yourCards;
  const hasHoleCards = Boolean(displayHoleCards && displayHoleCards.length > 0);
  const isWaitingForNextHand =
    Boolean(isGameStarted) && currentPlayer?.status === "waiting" && !hasHoleCards;

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

  const payoutBreakdownRows = useMemo(() => {
    if (!lastHandResult) return [];

    const playerNameById = new Map<string, string>();
    for (const seatPlayer of room?.players ?? []) {
      playerNameById.set(seatPlayer.id, seatPlayer.name);
    }
    for (const handPlayer of lastHandResult.playerHands) {
      playerNameById.set(handPlayer.playerId, handPlayer.playerName);
    }

    const normalizedPayouts = (lastHandResult.payouts ?? [])
      .filter((segment) => segment.amount > 0 && segment.winnerShares.length > 0)
      .sort((a, b) => a.segmentIndex - b.segmentIndex);

    const payoutSegments =
      normalizedPayouts.length > 0
        ? normalizedPayouts
        : [
            {
              segmentIndex: 0,
              potType: "MAIN" as const,
              amount: lastHandResult.totalPot,
              eligiblePlayerIds: lastHandResult.winners.map((winner) => winner.playerId),
              winnerShares: lastHandResult.winners.map((winner) => ({
                playerId: winner.playerId,
                amountWon: winner.amountWon,
              })),
              uncontested: lastHandResult.winners.length === 1,
            },
          ];

    return payoutSegments.map((segment) => ({
      segmentIndex: segment.segmentIndex,
      label:
        segment.potType === "MAIN"
          ? t("game.payout.mainPot")
          : t("game.payout.sidePot", { index: segment.segmentIndex }),
      amount: segment.amount,
      uncontested: segment.uncontested,
      winnerShares: segment.winnerShares.map((share) => ({
        ...share,
        playerName: playerNameById.get(share.playerId) ?? share.playerId,
      })),
    }));
  }, [lastHandResult, room?.players, t]);

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
          return a.name.localeCompare(b.name, locale === "zh_hans" ? "zh-Hans" : "en");
        });
    },
    [locale, room],
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
        t,
      }),
    [callAmount, maxStack, minRaise, t, trayAmount],
  );
  const canStartDrag = isYourTurn && trayAmount > 0 && Boolean(dropResolution.intent);

  const trayPresetButtons = useMemo<TrayPresetButton[]>(() => {
    const clampToStack = (value: number) => clampTrayAmount(value);
    const commitToTargetTotalBet = (targetTotalBet: number) =>
      clampToStack(Math.max(0, targetTotalBet - myCommittedBet));
    const continueCommit = clampToStack(callAmount > 0 ? callAmount : minRaise);
    const continueLabel = callAmount > 0 ? t("game.preset.call") : t("game.preset.minBet");
    const frequentRaiseCommit = (() => {
      const baseline =
        callAmount > 0 ? commitToTargetTotalBet(currentTableBet * 3) : clampToStack(minRaise * 3);
      if (baseline > continueCommit && baseline < maxStack) return baseline;

      const steppedUp = clampToStack(continueCommit + Math.max(minRaise, 1));
      if (steppedUp > continueCommit && steppedUp < maxStack) return steppedUp;

      return maxStack;
    })();

    const presets: TrayPresetButton[] = [
      {
        key: "continue",
        label: continueLabel,
        amount: continueCommit,
        testId: "chip-load-continue",
        tone: callAmount > 0 ? "call" : "raise",
        enabled: false,
      },
      {
        key: "frequent-raise",
        label: t("game.preset.threeBet"),
        amount: frequentRaiseCommit,
        testId: "chip-load-3bet",
        tone: "raise",
        enabled: false,
      },
      {
        key: "all-in",
        label: t("game.preset.allIn"),
        amount: maxStack,
        testId: "chip-load-all-in",
        tone: "allin",
        enabled: false,
      },
    ];

    return presets.map((preset) => {
      const resolution = resolveDropIntent({
        trayAmount: preset.amount,
        callAmount,
        minRaise,
        stack: maxStack,
        t,
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
    isYourTurn,
    maxStack,
    minRaise,
    myCommittedBet,
    t,
  ]);

  const isAutomationMode =
    typeof window !== "undefined" && Boolean(window.navigator.webdriver);

  const clearActionAlertTimers = useCallback(() => {
    if (actionAlertHideTimeoutRef.current !== null) {
      window.clearTimeout(actionAlertHideTimeoutRef.current);
      actionAlertHideTimeoutRef.current = null;
    }
    if (actionAlertClearTimeoutRef.current !== null) {
      window.clearTimeout(actionAlertClearTimeoutRef.current);
      actionAlertClearTimeoutRef.current = null;
    }
  }, []);

  const updateActionPointerVector = useCallback(() => {
    if (!actionCenterAlert) {
      setActionPointerVector(null);
      return;
    }

    const seatNode = seatNodeRefs.current[actionCenterAlert.playerId];
    const alertNode = actionCenterAlertRef.current;
    if (!seatNode || !alertNode) {
      setActionPointerVector(null);
      return;
    }

    const seatRect = seatNode.getBoundingClientRect();
    const alertRect = alertNode.getBoundingClientRect();

    const centerX = alertRect.left + alertRect.width / 2;
    const centerY = alertRect.top + alertRect.height / 2;
    const targetX = seatRect.left + seatRect.width / 2;
    const targetY = seatRect.top + seatRect.height / 2;

    const deltaX = targetX - centerX;
    const deltaY = targetY - centerY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 1) {
      setActionPointerVector(null);
      return;
    }

    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const alertRadius = Math.max(alertRect.width, alertRect.height) / 2;
    const seatPadding = Math.min(seatRect.width, seatRect.height) * 0.35;
    const lineLength = Math.max(20, distance - alertRadius - seatPadding);

    const startX = centerX + unitX * (alertRadius - 8);
    const startY = centerY + unitY * (alertRadius - 8);
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    setActionPointerVector({
      x: startX,
      y: startY,
      angle,
      length: lineLength,
    });
  }, [actionCenterAlert]);

  const triggerTurnAlert = useCallback(() => {
    if (turnAlertTimeoutRef.current) {
      window.clearTimeout(turnAlertTimeoutRef.current);
    }

    setTurnAlertToken(Date.now());
    turnAlertTimeoutRef.current = window.setTimeout(() => {
      setTurnAlertToken(null);
      turnAlertTimeoutRef.current = null;
    }, TURN_ALERT_VISIBLE_MS);
  }, []);

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
    const timeoutId = window.setTimeout(() => {
      setInviteCopyStatus(null);
      setInviteCopyStatusTone(null);
    }, 2200);
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
    if (!isYourTurn) {
      setTurnOverlayHeight(0);
      return;
    }

    const overlayNode = turnOverlayRef.current;
    if (!overlayNode) {
      return;
    }

    const updateOverlayHeight = () => {
      const nextHeight = Math.ceil(overlayNode.getBoundingClientRect().height);
      setTurnOverlayHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    };

    updateOverlayHeight();
    window.addEventListener("resize", updateOverlayHeight);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", updateOverlayHeight);
    }

    const resizeObserver = new ResizeObserver(updateOverlayHeight);
    resizeObserver.observe(overlayNode);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateOverlayHeight);
    };
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
    animatedPotRef.current = animatedPotValue;
  }, [animatedPotValue]);

  useEffect(() => {
    if (displayPot === animatedPotRef.current) {
      return;
    }

    if (potAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(potAnimationFrameRef.current);
    }

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setAnimatedPotValue(displayPot);
      animatedPotRef.current = displayPot;
      setPotAnimationTick((prev) => prev + 1);
      return;
    }

    const startValue = animatedPotRef.current;
    const delta = displayPot - startValue;
    const startAt = performance.now();
    setPotAnimationTick((prev) => prev + 1);

    const step = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startAt) / POT_ANIMATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(startValue + delta * eased);
      animatedPotRef.current = nextValue;
      setAnimatedPotValue(nextValue);

      if (progress < 1) {
        potAnimationFrameRef.current = window.requestAnimationFrame(step);
      } else {
        potAnimationFrameRef.current = null;
      }
    };

    potAnimationFrameRef.current = window.requestAnimationFrame(step);
  }, [displayPot]);

  useEffect(() => {
    if (turnAlertTimeoutRef.current) {
      window.clearTimeout(turnAlertTimeoutRef.current);
      turnAlertTimeoutRef.current = null;
    }

    previousIsYourTurnRef.current = null;
    setTurnAlertToken(null);
  }, [room?.id, currentHandNumber]);

  useEffect(() => {
    // Reset hand-level UI state for each new hand.
    setShowRankingsModal(false);
    setIsCardsFlyoutOpen(true);
  }, [room?.id, currentHandNumber]);

  useEffect(() => {
    const previousIsYourTurn = previousIsYourTurnRef.current;
    if (previousIsYourTurn === null) {
      if (isYourTurn) {
        triggerTurnAlert();
      }
      previousIsYourTurnRef.current = isYourTurn;
      return;
    }

    if (!previousIsYourTurn && isYourTurn) {
      triggerTurnAlert();
    }
    previousIsYourTurnRef.current = isYourTurn;
  }, [isYourTurn, triggerTurnAlert]);

  useEffect(() => {
    if (!lastPlayerActionEvent) return;

    const alert = toActionCenterAlert(lastPlayerActionEvent, t);
    clearActionAlertTimers();
    setActionCenterAlert(alert);

    actionAlertHideTimeoutRef.current = window.setTimeout(() => {
      setActionCenterAlert((prev) => {
        if (!prev || prev.id !== alert.id) return prev;
        return {
          ...prev,
          exiting: true,
        };
      });
    }, ACTION_ALERT_VISIBLE_MS);

    actionAlertClearTimeoutRef.current = window.setTimeout(() => {
      setActionCenterAlert((prev) => (prev && prev.id === alert.id ? null : prev));
      setActionPointerVector(null);
      clearActionAlertTimers();
    }, ACTION_ALERT_TOTAL_MS);
  }, [clearActionAlertTimers, lastPlayerActionEvent, t]);

  useEffect(() => {
    if (!actionCenterAlert) {
      setActionPointerVector(null);
      return;
    }

    const firstFrame = window.requestAnimationFrame(() => {
      updateActionPointerVector();
    });
    const handleViewportChange = () => updateActionPointerVector();

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [actionCenterAlert, updateActionPointerVector, seatSlots]);

  useEffect(() => {
    setActionCenterAlert(null);
    setActionPointerVector(null);
    clearActionAlertTimers();
  }, [clearActionAlertTimers, room?.id]);

  useEffect(
    () => () => {
      if (potAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(potAnimationFrameRef.current);
      }
      if (turnAlertTimeoutRef.current) {
        window.clearTimeout(turnAlertTimeoutRef.current);
      }
      clearActionAlertTimers();
    },
    [clearActionAlertTimers],
  );

  useEffect(() => {
    if (!lastError && !showRankingsModal && !showSettingsModal && !quickConfirmAction) return;

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (lastError) clearError();
      if (showRankingsModal) setShowRankingsModal(false);
      if (showSettingsModal) setShowSettingsModal(false);
      if (quickConfirmAction) setQuickConfirmAction(null);
    };

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [clearError, lastError, quickConfirmAction, showRankingsModal, showSettingsModal]);

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

      setInviteCopyStatus(t("game.copiedInvite"));
      setInviteCopyStatusTone("success");
    } catch (error) {
      console.error("Failed to copy invite link:", error);
      setInviteCopyStatus(t("game.copyFailed"));
      setInviteCopyStatusTone("error");
    }
  };

  const handleSaveResultScreenshot = async () => {
    if (!lastHandResult || !room || !handResultsPanelRef.current) return;

    try {
      const screenshotDataUrl = await toPng(handResultsPanelRef.current, {
        cacheBust: true,
        pixelRatio: Math.max(2, Math.min(3, window.devicePixelRatio || 2)),
        backgroundColor: "#032b26",
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          return node.dataset.testid !== "save-result-screenshot-button";
        },
      });

      const screenshotImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = (error) => reject(error);
        image.src = screenshotDataUrl;
      });

      const padding = 44;
      const canvasWidth = screenshotImage.width + padding * 2;
      const minimumPortraitHeight = Math.round(canvasWidth * 1.35);
      const canvasHeight = Math.max(screenshotImage.height + padding * 2, minimumPortraitHeight);
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Canvas unavailable");
      }

      const background = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
      background.addColorStop(0, "#052e2b");
      background.addColorStop(1, "#021b18");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      const imageX = Math.round((canvasWidth - screenshotImage.width) / 2);
      const imageY = Math.round((canvasHeight - screenshotImage.height) / 2);
      ctx.drawImage(screenshotImage, imageX, imageY);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png");
      });
      if (!blob) {
        throw new Error("Failed to create image blob");
      }

      const link = document.createElement("a");
      const imageUrl = URL.createObjectURL(blob);
      link.href = imageUrl;
      link.download = `${room.id}-hand-${currentHandNumber ?? "result"}-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(imageUrl);

      setInviteCopyStatus(t("game.resultScreenshotSaved"));
      setInviteCopyStatusTone("success");
    } catch (error) {
      console.error("Failed to save result screenshot:", error);
      setInviteCopyStatus(t("game.resultScreenshotFailed"));
      setInviteCopyStatusTone("error");
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
      title: t("game.error.actionRejected"),
      reason: lastError,
      suggestions: [t("game.error.tryAgain")],
      technicalDetail: lastError,
    };

    if (normalized.includes("not your turn")) {
      insight.title = t("game.error.notYourTurn");
      insight.reason = t("game.error.notYourTurnReason");
      insight.suggestions = [
        t("game.error.waitTurn", { name: currentTurnPlayer?.name ?? t("common.player") }),
        t("game.error.reviewPot"),
      ];
    } else if (normalized.includes("cannot check")) {
      insight.title = t("game.error.checkNotAllowed");
      insight.reason = t("game.error.checkNotAllowedReason");
      insight.suggestions = [
        t("game.error.callRaiseFold", { callAmount, minRaise }),
        t("game.error.useToCall"),
      ];
    } else if (normalized.includes("minimum")) {
      insight.title = t("game.error.raiseTooSmall");
      insight.reason = t("game.error.raiseTooSmallReason");
      insight.suggestions = [
        t("game.error.raiseAtLeast", { minRaise }),
        t("game.error.useCallCheck"),
      ];
    } else if (normalized.includes("insufficient chips")) {
      insight.title = t("game.error.insufficientChips");
      insight.reason = t("game.error.insufficientChipsReason");
      insight.suggestions = [
        t("game.error.currentStack", { stack: maxStack }),
        t("game.error.useAllInOrLower"),
      ];
    }

    return insight;
  }, [callAmount, currentTurnPlayer?.name, lastError, maxStack, minRaise, t]);

  if (!room || !player) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-lg rounded-2xl border border-emerald-700/70 bg-emerald-950/60 p-6 text-emerald-50 shadow-lg">
          <h1 className="text-lg font-semibold">{t("game.restoringRoom")}</h1>
          <p className="mt-2 text-sm text-emerald-100/80">
            {t("game.restoringRoomHint")}
          </p>
          <button
            onClick={() => navigate("/", { replace: true })}
            className="mt-4 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/35"
          >
            {t("game.goToLobbyNow")}
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
            {t("game.room", { roomId: room.id })}
          </h1>
          <p className="text-[11px] text-emerald-100/70" data-testid="room-player-count">
            {t("game.playersCount", {
              count: room.players.length,
              max: room.config.maxPlayers,
            })}
          </p>
        </div>

        <div className="hidden" aria-live="polite">
          <span className="hud-chip" data-testid="pot-value">
            {t("game.pot", { amount: displayPot })}
          </span>
          <span className="hud-chip" data-testid="your-chips">
            {t("game.yourChips", { amount: currentPlayer?.chips ?? 0 })}
          </span>
          {currentTurnPlayer && (
            <span
              className="hud-chip border-amber-400/70 bg-amber-500/20 text-amber-100"
              data-testid="turn-player"
            >
              {t("game.turn", { name: currentTurnPlayer.name })}
            </span>
          )}
        </div>

        <section className="table-controls-strip">
          {currentHand && (
            <span className="hud-chip" data-testid="round-value">
              {t("game.round", { round: currentHand.bettingRound })}
            </span>
          )}
          <button
            onClick={handleCopyInviteLink}
            data-testid="copy-room-url-button"
            className="rounded-full border border-cyan-300/55 bg-cyan-900/30 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/40"
          >
            {t("game.copyInvite")}
          </button>
          {inviteCopyStatus && (
            <span
              data-testid="copy-room-url-status"
              className={`text-xs font-semibold ${
                inviteCopyStatusTone === "error" ? "text-amber-200" : "text-emerald-200"
              }`}
            >
              {inviteCopyStatus}
            </span>
          )}
          <button
            onClick={() => setShowSettingsModal(true)}
            data-testid="open-settings-button"
            className="rounded-full border border-cyan-400/65 bg-cyan-950/40 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-900/45"
          >
            {t("common.settings")}
          </button>
          <button
            onClick={() => setShowRankingsModal(true)}
            data-testid="open-rankings-button"
            className="rounded-full border border-emerald-400/65 bg-emerald-900/40 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
          >
            {t("game.rankings")}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {isHost && !isGameStarted && room.players.length >= 2 && (
              <button
                onClick={startGame}
                data-testid="start-game-button"
                className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-black uppercase tracking-wide text-emerald-950 transition hover:bg-emerald-400"
              >
                {t("common.start")}
              </button>
            )}
            <button
              onClick={handleLeave}
              data-testid="leave-room-button"
              className="rounded-full border border-rose-400/70 bg-rose-900/30 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-rose-100 transition hover:bg-rose-800/40"
            >
              {t("common.leave")}
            </button>
          </div>
        </section>
      </header>

      {isWaitingForNextHand && (
        <section className="mx-3 mt-2 rounded-xl border border-cyan-400/45 bg-cyan-900/25 px-3 py-2 text-xs font-semibold text-cyan-100">
          {t("game.cardsAppearWhenHandStarts")}
        </section>
      )}

      {turnAlertToken !== null && (
        <div
          className="turn-center-alert-layer"
          aria-live="assertive"
          data-testid="turn-center-alert"
        >
          <div key={`turn-alert-${turnAlertToken}`} className="turn-center-alert">
            <span className="turn-center-alert__eyebrow">{t("game.turnAlert.eyebrow")}</span>
            <span className="turn-center-alert__title">{t("game.turnAlert.title")}</span>
          </div>
        </div>
      )}

      {hasHoleCards && (
        <section
          className={`your-cards-flyout ${
            isCardsFlyoutOpen ? "your-cards-flyout--open" : "your-cards-flyout--closed"
          } ${isYourTurn ? "your-cards-flyout--anchored" : "your-cards-flyout--bottom"}`}
          style={
            isYourTurn
              ? {
                  bottom: `calc(0.55rem + env(safe-area-inset-bottom, 0px) + ${turnOverlayHeight}px + 16px)`,
                }
              : undefined
          }
          data-testid="your-cards-flyout"
        >
          <div className="your-cards-flyout__panel" data-testid="your-cards-section">
            <div className="your-cards-flyout__header">
              <h3 className="your-cards-flyout__title">{t("game.yourCards")}</h3>
            </div>

            {isCardsFlyoutOpen ? (
              <div className="your-cards-flyout__cards">
                {(displayHoleCards ?? []).map((card, idx) => (
                  <Card key={idx} card={card} size="small" dataTestId={`your-card-${idx}`} />
                ))}
              </div>
            ) : (
              <div className="your-cards-flyout__empty-state" data-testid="hole-cards-hidden-state">
                {t("game.hide")} {t("game.yourCards")}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsCardsFlyoutOpen((prev) => !prev)}
            className="your-cards-flyout__toggle"
            data-testid="toggle-hole-cards"
            aria-label={`${isCardsFlyoutOpen ? t("game.hide") : t("game.show")} ${t("game.yourCards")}`}
          >
            {isCardsFlyoutOpen ? "<" : ">"}
          </button>
        </section>
      )}

      {actionCenterAlert !== null && (
        <div
          className="action-center-alert-layer"
          aria-live="polite"
          data-testid="action-center-alert"
        >
          {actionPointerVector && (
            <div
              className="action-center-alert__arrow"
              style={{
                left: `${actionPointerVector.x}px`,
                top: `${actionPointerVector.y}px`,
                width: `${actionPointerVector.length}px`,
                transform: `translateY(-50%) rotate(${actionPointerVector.angle}deg)`,
              }}
            >
              <span className="action-center-alert__arrow-head" />
            </div>
          )}
          <div
            ref={actionCenterAlertRef}
            key={`action-alert-${actionCenterAlert.id}`}
            className={`action-center-alert action-center-alert--${actionCenterAlert.tone} ${
              actionCenterAlert.exiting ? "action-center-alert--exit" : ""
            }`}
          >
            <span className="action-center-alert__eyebrow">User Action</span>
            <span className="action-center-alert__actor">{actionCenterAlert.playerName}</span>
            <span className="action-center-alert__title">{actionCenterAlert.text}</span>
          </div>
        </div>
      )}

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
              <span className="pot-drop-zone__label">{t("game.potCenter")}</span>
              <span
                key={`pot-animation-${potAnimationTick}`}
                className="pot-drop-zone__value pot-drop-zone__value--pulse"
              >
                ${animatedPotValue}
              </span>
              {isYourTurn && (
                <span className="pot-drop-zone__hint">{t("game.dragHint")}</span>
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
              const isWaiting = seatPlayer?.status === "waiting";

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
                    ref={(node) => {
                      seatNodeRefs.current[seatPlayer.id] = node;
                    }}
                    data-testid={`player-seat-${seatPlayer.id}`}
                    className={`seat-pod ${isCurrentTurnSeat ? "seat-pod--turn" : ""} ${
                      isDisconnected ? "seat-pod--disconnected" : ""
                    } ${
                      isFolded ? "seat-pod--folded" : ""
                    }`}
                  >
                    {isSelfSeat && (
                      <span
                        className="seat-pod__you-indicator"
                        aria-label={t("common.you")}
                        title={t("common.you")}
                      >
                        🫵
                      </span>
                    )}
                    <div className="seat-pod__row">
                      {seatPlayer.emoji && (
                        <span className="text-sm" aria-hidden="true">
                          {seatPlayer.emoji}
                        </span>
                      )}
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
                        {t("game.bet", { amount: seatPlayer.currentBet })}
                      </div>
                      {isAllIn && (
                        <span className="seat-pod__state seat-pod__state--allin">
                          {t("game.status.allIn")}
                        </span>
                      )}
                      {isDisconnected && (
                        <span className="seat-pod__state seat-pod__state--disconnected">
                          {t("game.status.disconnected")}
                        </span>
                      )}
                      {isWaiting && (
                        <span className="seat-pod__state seat-pod__state--disconnected">
                          {t("game.status.waiting")}
                        </span>
                      )}
                      {isFolded && (
                        <span className="seat-pod__state seat-pod__state--folded">
                          {t("game.status.folded")}
                        </span>
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
                {t("game.handResults", { handNumber: currentHandNumber ?? "?" })}
              </h3>
              <p className="mt-1 text-xs text-emerald-100/75" data-testid="hand-results-mode">
                {isShowdownComplete
                  ? t("game.showdownComplete")
                  : t("game.showdownManual")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="hud-chip" data-testid="hand-results-pot">
                {t("game.pot", { amount: lastHandResult.totalPot })}
              </span>
              <span className="hud-chip" data-testid="hand-results-winner-count">
                {t("game.winnersCount", { count: lastHandResult.winners.length })}
              </span>
              <button
                onClick={handleSaveResultScreenshot}
                data-testid="save-result-screenshot-button"
                className="rounded-full border border-cyan-300/55 bg-cyan-900/30 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/40"
              >
                {t("game.saveResultScreenshot")}
              </button>
            </div>
          </div>

          {canRevealMyCompletedHand && !isMyCompletedHandRevealed && (
            <button
              onClick={showMyHand}
              data-testid="show-my-hand-button"
              className="mt-3 rounded-lg border border-cyan-400/60 bg-cyan-900/30 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-800/45"
            >
              {t("game.showMyHand")}
            </button>
          )}

          {isMyCompletedHandRevealed && !isShowdownComplete && (
            <p
              className="mt-3 text-xs font-semibold uppercase tracking-wide text-cyan-100/90"
              data-testid="my-hand-revealed-indicator"
            >
              {t("game.yourHandRevealed")}
            </p>
          )}

          <div
            className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3"
            data-testid="hand-results-community"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
              {t("game.communityCards")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-emerald-50">
              {Array.from({ length: 5 }, (_, idx) => currentHand?.communityCards[idx] ?? null).map(
                (card, idx) => (
                  <Card
                    key={`hand-results-community-card-${idx}-${card ? `${card.suit}-${card.rank}` : "back"}`}
                    card={card}
                    size="small"
                    faceDown={!card}
                    dataTestId={card ? `hand-results-community-card-${idx}` : `hand-results-community-back-${idx}`}
                  />
                ),
              )}
            </div>
          </div>

          {payoutBreakdownRows.length > 0 && (
            <div
              className="mt-3 rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3"
              data-testid="hand-results-payouts"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
                {t("game.payoutBreakdown")}
              </p>
              <div className="mt-2 space-y-2">
                {payoutBreakdownRows.map((segment) => (
                  <div
                    key={`payout-segment-${segment.segmentIndex}`}
                    className="rounded-lg border border-emerald-700/60 bg-emerald-900/30 px-3 py-2"
                    data-testid={`payout-segment-${segment.segmentIndex}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-emerald-50">
                          {segment.label}
                        </span>
                        {segment.uncontested && (
                          <span className="rounded-full border border-amber-300/70 bg-amber-300/20 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                            {t("game.payout.uncontested")}
                          </span>
                        )}
                      </div>
                      <span className="rounded-full border border-emerald-500/60 bg-emerald-700/30 px-2 py-1 text-xs font-semibold text-emerald-50">
                        ${segment.amount}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {segment.winnerShares.map((share) => (
                        <span
                          key={`payout-share-${segment.segmentIndex}-${share.playerId}`}
                          className="rounded-full border border-cyan-400/60 bg-cyan-900/35 px-2 py-1 text-xs font-semibold text-cyan-100"
                          data-testid={`payout-share-${segment.segmentIndex}-${share.playerId}`}
                        >
                          {share.playerName}
                          {share.playerId === player.id ? ` (${t("common.you")})` : ""} +$
                          {share.amountWon}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                          {isSelf ? ` (${t("common.you")})` : ""}
                        </p>
                        <p className="text-xs text-emerald-100/70">
                          {entry.isWinner
                            ? t("game.wonAmount", { amount: entry.amountWon })
                            : t("game.noPayout")}
                        </p>
                      </div>
                      {entry.isWinner && (
                        <span className="rounded-full border border-amber-300/70 bg-amber-300/20 px-2 py-1 text-xs font-semibold text-amber-100">
                          {t("game.winner")}
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
                          ? `${formatHandRank(evaluatedHand.rank, locale)} - ${formatHandDescription(evaluatedHand, locale)}`
                          : t("game.cardsShownNoEvaluated")
                        : t("game.handHidden")}
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
              <h3 className="text-sm font-semibold text-emerald-100">{t("game.handComplete")}</h3>
              <p className="text-xs text-emerald-100/70">
                {t("game.handCompleteHint")}
              </p>
            </div>
            <button
              onClick={startNextHand}
              data-testid="start-next-hand-button"
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
            >
              {t("game.startNextHand")}
            </button>
          </div>
        </section>
      )}
      {isWaitingForHostToStartNextHand && (
        <section className="surface-panel mx-3 mt-3 p-4" data-testid="waiting-host-start-next-hand">
          <div>
            <h3 className="text-sm font-semibold text-emerald-100">{t("game.handComplete")}</h3>
            <p className="text-xs text-emerald-100/70">
              {t("game.waitingHostStartNextHand")}
            </p>
          </div>
        </section>
      )}

      {isYourTurn && (
        <section ref={turnOverlayRef} className="chip-composer-dock" data-testid="turn-overlay">
          <div data-testid="action-dock" className="chip-composer-dock__action-area">
            <div className="chip-composer-dock__header">
              <span className="chip-composer-dock__title">{t("game.yourTurn")}</span>
              <span className="chip-composer-dock__meta">{t("game.toCall", { amount: callAmount })}</span>
              <span className="chip-composer-dock__meta">{t("game.minRaise", { amount: minRaise })}</span>
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
                  <span className="chip-stack__label">{t("game.tray")}</span>
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
                    aria-label={t("game.trayAmountAria")}
                    className="chip-input"
                  />
                  <button
                    onClick={clearTray}
                    className="chip-clear"
                    disabled={!isYourTurn || trayAmount <= 0}
                    data-testid="chip-clear"
                  >
                    {t("common.clear")}
                  </button>
                </div>

                <div className="chip-composer-dock__footer">
                  <button
                    onClick={() => handleQuickDecisionAction("check")}
                    disabled={!canCheck}
                    data-testid={canCheck ? "action-check" : "action-check-disabled"}
                    className="chip-action chip-action--check"
                  >
                    {t("common.check")}
                  </button>
                  <button
                    onClick={() => handleQuickDecisionAction("fold")}
                    data-testid="action-fold"
                    className="chip-action chip-action--fold"
                  >
                    {t("common.fold")}
                  </button>
                </div>
              </div>
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
                      {t("common.check")}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleLegacyAction("call")}
                      data-testid="action-call"
                      className="chip-action chip-action--call"
                    >
                      {t("game.callWithAmount", { amount: callAmount })}
                    </button>
                  )}
                  <button
                    onClick={() => handleLegacyAction("all-in")}
                    data-testid="action-all-in"
                    className="chip-action chip-action--allin"
                  >
                    {t("game.allInWithAmount", { amount: maxStack })}
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
                    {t("game.raise")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

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

      {showSettingsModal && (
        <div
          className="fixed inset-0 z-[76] flex items-center justify-center bg-emerald-950/85 p-4 backdrop-blur-sm"
          data-testid="settings-modal"
        >
          <div className="surface-panel w-full max-w-xl p-4 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-black text-white">{t("game.settings.title")}</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                data-testid="close-settings-button"
                className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
              >
                {t("common.close")}
              </button>
            </div>
            <p className="mt-1 text-sm text-emerald-100/80">{t("game.settings.onlyLanguage")}</p>

            <div className="mt-4 rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-4">
              <label
                htmlFor="language-select"
                className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70"
              >
                {t("common.language")}
              </label>
              <p className="mt-1 text-xs text-emerald-100/70">{t("game.settings.languageHelp")}</p>
              <select
                id="language-select"
                value={locale}
                onChange={(event) =>
                  setLocale(event.target.value === "zh_hans" ? "zh_hans" : "en")
                }
                data-testid="language-select"
                className="mt-3 w-full rounded-xl border border-emerald-700/60 bg-emerald-950/80 px-3 py-2 text-sm text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
              >
                <option value="en">{t("game.settings.english")}</option>
                <option value="zh_hans">{t("game.settings.chineseSimplified")}</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {showRankingsModal && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-emerald-950/85 p-4 backdrop-blur-sm"
          data-testid="rankings-modal"
        >
          <div className="surface-panel w-full max-w-2xl p-4 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-black text-white">{t("game.rankings.title")}</h3>
              <button
                onClick={() => setShowRankingsModal(false)}
                data-testid="close-rankings-button"
                className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
              >
                {t("common.close")}
              </button>
            </div>
            <p className="mt-1 text-sm text-emerald-100/80">
              {t("game.rankings.sortedBy")}
            </p>

            <div className="mt-4 overflow-hidden rounded-xl border border-emerald-700/60">
              <table className="min-w-full text-sm">
                <thead className="bg-emerald-950/70 text-emerald-100/70">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">{t("game.rankings.rank")}</th>
                    <th className="px-3 py-2 text-left font-semibold">{t("game.rankings.player")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.stack")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.buyIn")}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.net")}</th>
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
                        {rankedPlayer.id === player.id ? ` (${t("common.you")})` : ""}
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
              {t("game.quickConfirm.prompt", {
                action:
                  quickConfirmAction === "check"
                    ? t("common.check")
                    : t("common.fold"),
              })}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setQuickConfirmAction(null)}
                data-testid="action-quick-confirm-cancel"
                className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
              >
                {t("common.cancel")}
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
                {t("common.confirm")}
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
                <p className="text-xs text-emerald-100/70">{t("game.potCenter")}</p>
                <p className="mt-1 font-semibold text-white">${displayPot}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">{t("game.toCallLabel")}</p>
                <p className="mt-1 font-semibold text-white">${callAmount}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">{t("game.confirmAction.yourStack")}</p>
                <p className="mt-1 font-semibold text-white">${maxStack}</p>
              </div>
              <div className="rounded-lg border border-emerald-700/70 bg-emerald-950/60 p-3">
                <p className="text-xs text-emerald-100/70">{t("game.minRaiseLabel")}</p>
                <p className="mt-1 font-semibold text-white">${minRaise}</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-emerald-700/70 bg-emerald-950/55 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/70">
                {t("game.error.whatYouCanDo")}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-100/90">
                {feedbackInsight.suggestions.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>

            {feedbackInsight.technicalDetail && (
              <details className="mt-4 rounded-lg border border-emerald-700/70 bg-emerald-950/55 p-3 text-xs text-emerald-100/75">
                <summary className="cursor-pointer font-semibold">{t("game.error.technicalDetail")}</summary>
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
                {t("game.error.gotIt")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
