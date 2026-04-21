import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toPng } from "html-to-image";
import { PLAYER_EMOJI_OPTIONS } from "@/constants/player-emojis";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveAudio } from "@/contexts/LiveAudioContext";
import { useLocalization } from "../contexts/LocalizationContext";
import { useGame, type PlayerActionFlashEvent } from "../contexts/GameContext";
import type {
  ChatMessage,
  CompletedGameHistoryExport,
  CompletedHandHistoryExport,
  HandEvaluation,
  HandResult,
  Player,
  PlayerAction,
} from "poker-types";
import type { Locale, MessageKey } from "../i18n/messages";
import { handHistoryService } from "../services/hand-history.service";
import {
  applyTurnNotificationTransition,
  playTurnNotification,
} from "../services/turn-notification.service";
import { playVoicePlayback } from "../services/voice-playback.service";
import { writeTextToClipboard } from "../utils/clipboard";
import { formatRelativeTime } from "../utils/relative-time";
import { resolveVoiceAudioUrl } from "../utils/voice-message";
import { Card } from "@/components/Card";
import {
  ActionCenterAlertOverlay,
  ChatPanel,
  ChipComposerDock,
  EndGameConfirmModal,
  FinalSummaryModal,
  gameRoomModalReducer,
  type GameRoomConfirmModal,
  type GameRoomPrimaryModal,
  HandResultsContent,
  HandResultsModal,
  INITIAL_GAME_ROOM_MODAL_STATE,
  LeaveRoomConfirmModal,
  LiveAudioPopover,
  NextHandActionArea,
  OperationActionBar,
  ReadyActionArea,
  RankingsModal,
  RulesModal,
  SettingsModal,
  TableBoard,
  TableShell,
  TableTopBar,
  TurnActionDock,
  TurnCenterAlert,
  YourCardsFlyout,
} from "@/components/poker";
import {
  resolveCardsFlyoutDesktopLayout,
  shouldUseReducedMobileSeatPerimeter,
  shouldRenderCardsFlyoutInBoardStage,
} from "@/components/poker/game-room-layout";
import {
  buildTurnActionPresetButtons,
  type TrayPresetButton,
} from "@/components/poker/turn-action-presets";
import {
  getBottomBarCardsOffsetPx,
  getMobileTableBottomSafeHeightPx,
} from "@/components/poker/mobile-overlay-layout";
import type { SeatBadge, SeatLiveAudioBadge } from "@/components/poker/seat-pod";
import { buildEqualArcEllipsePoints } from "@/components/poker/seat-orbit-layout";

const DRAG_SNAP_RADIUS_PX = 32;
const DRAG_DROP_ZONE_RECT_MARGIN_PX = 18;
const ACTION_ALERT_VISIBLE_MS = 1300;
const ACTION_ALERT_TOTAL_MS = 1600;
const TURN_ALERT_VISIBLE_MS = 1650;
const POT_ANIMATION_MS = 360;
const DESKTOP_SIDE_DOCK_QUERY = "(min-width: 1024px)";
const COMPACT_MOBILE_DOCK_QUERY = "(max-width: 767px)";
const CHAT_PREVIEW_TEXT_MAX_LENGTH = 80;

const hasMeaningfulRobotRankingActivity = (
  rankedPlayer: Pick<
    Player,
    | "chips"
    | "currentBet"
    | "totalBuyIn"
    | "handsPlayedCount"
    | "handsWonCount"
    | "vpipHandsCount"
  >,
) =>
  rankedPlayer.totalBuyIn > 0 ||
  rankedPlayer.handsPlayedCount > 0 ||
  rankedPlayer.handsWonCount > 0 ||
  rankedPlayer.vpipHandsCount > 0 ||
  rankedPlayer.chips + (rankedPlayer.currentBet || 0) > 0;

// Keep this client-side predicate aligned with poker-types/src/rankings.ts.
// The Vite client bundle does not cleanly consume that CommonJS runtime helper.
const shouldDisplayLiveRankingPlayer = (rankedPlayer: Player) =>
  !rankedPlayer.isRobot ||
  rankedPlayer.status !== "left" ||
  hasMeaningfulRobotRankingActivity(rankedPlayer);

const truncatePreviewText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const toChatPreviewText = (
  message: ChatMessage,
  translate: (key: MessageKey, values?: Record<string, string | number>) => string,
): string => {
  if (message.kind === "VOICE") {
    return translate("game.chat.preview.voice");
  }

  const normalized = message.text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return translate("game.chat.preview.empty");
  }

  return truncatePreviewText(normalized, CHAT_PREVIEW_TEXT_MAX_LENGTH);
};

type SeatAnchor = {
  top: string;
  left: string;
};

type RectBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type OrbitAnchorsInput = {
  totalSeats: number;
  tableWidth: number;
  tableHeight: number;
  tableCornerRadiusX: number;
  tableCornerRadiusY: number;
  seatWidth: number;
  seatHeight: number;
  obstacleRects: RectBounds[];
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

type SeatMainState = "turn" | "disconnected" | "all-in" | "folded" | "waiting" | "default";

type SeatActionLabel = {
  text: string;
  tone: "blind" | "aggressive" | "call" | "allin" | "pending";
};

const getConnectionStatus = (
  seatPlayer: Pick<Player, "status" | "connectionStatus">,
) =>
  seatPlayer.connectionStatus ??
  (seatPlayer.status === "disconnected" ? "disconnected" : "connected");

type RulesCopy = {
  buttonLabel: string;
  modalTitle: string;
  modalSubtitle: string;
  objectiveTitle: string;
  objectiveBullets: string[];
  flowTitle: string;
  flowSteps: string[];
  actionsTitle: string;
  actionsBullets: string[];
  showdownTitle: string;
  showdownBullets: string[];
  tiebreakTitle: string;
  tiebreakBullets: string[];
  rankingTitle: string;
  rankingHint: string;
};
type RuleVariant = "standard" | "shortDeck";

type HandScopedUiState = {
  key: string;
  isCardsFlyoutOpen: boolean;
};

const createDefaultHandScopedUiState = (key: string): HandScopedUiState => ({
  key,
  isCardsFlyoutOpen: true,
});

const EMPTY_DRAG_STATE: DragState = {
  active: false,
  pointerId: null,
  clientX: 0,
  clientY: 0,
  overDropZone: false,
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

const STANDARD_HAND_RANK_ORDER: HandEvaluation["rank"][] = [
  "ROYAL_FLUSH",
  "STRAIGHT_FLUSH",
  "FOUR_OF_A_KIND",
  "FULL_HOUSE",
  "FLUSH",
  "STRAIGHT",
  "THREE_OF_A_KIND",
  "TWO_PAIR",
  "ONE_PAIR",
  "HIGH_CARD",
];

const SHORT_DECK_HAND_RANK_ORDER: HandEvaluation["rank"][] = [
  "ROYAL_FLUSH",
  "STRAIGHT_FLUSH",
  "FOUR_OF_A_KIND",
  "FLUSH",
  "FULL_HOUSE",
  "STRAIGHT",
  "THREE_OF_A_KIND",
  "TWO_PAIR",
  "ONE_PAIR",
  "HIGH_CARD",
];

const HAND_RANK_ORDER_BY_VARIANT: Record<RuleVariant, HandEvaluation["rank"][]> = {
  standard: STANDARD_HAND_RANK_ORDER,
  shortDeck: SHORT_DECK_HAND_RANK_ORDER,
};

const STANDARD_HAND_RANK_DETAILS: Record<Locale, Record<HandEvaluation["rank"], string>> = {
  en: {
    ROYAL_FLUSH: "A-K-Q-J-10, all same suit.",
    STRAIGHT_FLUSH: "Five consecutive cards, all same suit.",
    FOUR_OF_A_KIND: "Four cards of the same rank plus one kicker.",
    FULL_HOUSE: "Three cards of one rank plus one pair.",
    FLUSH: "Any five cards of the same suit (not consecutive).",
    STRAIGHT: "Five consecutive ranks; A can be high or low (A-2-3-4-5).",
    THREE_OF_A_KIND: "Three cards of the same rank plus two kickers.",
    TWO_PAIR: "Two different pairs plus one kicker.",
    ONE_PAIR: "One pair plus three kickers.",
    HIGH_CARD: "No made hand; compare highest cards in order.",
  },
  zh_hans: {
    ROYAL_FLUSH: "同一花色的 A-K-Q-J-10。",
    STRAIGHT_FLUSH: "同一花色的连续五张牌。",
    FOUR_OF_A_KIND: "四张同点数牌 + 1 张踢脚牌。",
    FULL_HOUSE: "三条 + 一对。",
    FLUSH: "任意同花五张（不要求连续）。",
    STRAIGHT: "任意连续五张；A 可作最大或最小（A-2-3-4-5）。",
    THREE_OF_A_KIND: "三张同点数牌 + 2 张踢脚牌。",
    TWO_PAIR: "两组对子 + 1 张踢脚牌。",
    ONE_PAIR: "一组对子 + 3 张踢脚牌。",
    HIGH_CARD: "无成牌时，按最大单牌依次比较。",
  },
};

const SHORT_DECK_HAND_RANK_DETAILS: Record<Locale, Record<HandEvaluation["rank"], string>> = {
  en: {
    ...STANDARD_HAND_RANK_DETAILS.en,
    STRAIGHT: "Five consecutive ranks; A can be high or low (A-6-7-8-9).",
  },
  zh_hans: {
    ...STANDARD_HAND_RANK_DETAILS.zh_hans,
    STRAIGHT: "任意连续五张；A 可作最大或最小（A-6-7-8-9）。",
  },
};

const HAND_RANK_DETAILS_BY_VARIANT: Record<
  RuleVariant,
  Record<Locale, Record<HandEvaluation["rank"], string>>
> = {
  standard: STANDARD_HAND_RANK_DETAILS,
  shortDeck: SHORT_DECK_HAND_RANK_DETAILS,
};

const STANDARD_RULES_COPY: Record<Locale, RulesCopy> = {
  en: {
    buttonLabel: "Rules",
    modalTitle: "Texas Hold'em Rules",
    modalSubtitle:
      "No-Limit Texas Hold'em quick reference for this table, including hand rankings.",
    objectiveTitle: "1) Objective",
    objectiveBullets: [
      "Win chips by making the best 5-card hand from 7 cards (2 hole + 5 community), or by making everyone else fold.",
      "Each hand starts with forced blinds, then betting progresses across rounds.",
    ],
    flowTitle: "2) Hand Flow",
    flowSteps: [
      "Pre-flop: each player receives 2 hole cards; betting starts after blinds.",
      "Flop: reveal 3 community cards, then betting round.",
      "Turn: reveal 4th community card, then betting round.",
      "River: reveal 5th community card, then final betting round.",
      "Showdown: remaining players reveal and best hand wins.",
    ],
    actionsTitle: "3) Betting Actions",
    actionsBullets: [
      "Fold: give up this hand and forfeit chips already committed.",
      "Check: pass action when no bet is facing you.",
      "Call: match the current highest bet.",
      "Raise: increase the bet; raise amount must meet minimum raise requirement.",
      "All-in: push your remaining chips in. Side pots may be created.",
    ],
    showdownTitle: "4) Showdown & Pots",
    showdownBullets: [
      "At showdown, always use the best 5-card combination out of 7 cards.",
      "Showdown decisions are sequential, not simultaneous: only the current player can choose Show/Fold; other players wait.",
      "Decision order starts from the last player who made the final aggressive action on the river (bet/raise, including an all-in that increased the bet). If no river aggression occurred, order starts from the first eligible player to the left of the dealer, then proceeds clockwise.",
      "If a player shows, later players can see those revealed hole cards before making their own decision.",
      "All-in players are forced to show and cannot fold at showdown.",
      "Choosing Fold at showdown forfeits any claim to the pot.",
      "If multiple players tie exactly, the pot (or side pot) is split equally.",
      "Players can only win the pots they contributed to.",
    ],
    tiebreakTitle: "5) Tiebreak Basics",
    tiebreakBullets: [
      "Same hand type: compare key ranks first (for example, pair value, then kickers).",
      "For straights, compare highest card in the straight (A-2-3-4-5 is the lowest straight).",
      "For flush/high card, compare highest cards from top to bottom.",
    ],
    rankingTitle: "6) Hand Rankings (Strongest -> Weakest)",
    rankingHint: "Higher category always beats lower category.",
  },
  zh_hans: {
    buttonLabel: "规则",
    modalTitle: "德州扑克规则",
    modalSubtitle: "本桌为无限注德州扑克。以下为完整流程、操作说明与牌型大小排序。",
    objectiveTitle: "1）游戏目标",
    objectiveBullets: [
      "用 7 张牌（2 张手牌 + 5 张公共牌）组合出最佳 5 张牌，或通过下注让其他玩家弃牌，从而赢得底池。",
      "每一局会先下盲注，再按轮次进行下注。",
    ],
    flowTitle: "2）每局流程",
    flowSteps: [
      "Pre-flop：发 2 张手牌，从盲注后首位玩家开始行动。",
      "Flop：发出前 3 张公共牌，进行一轮下注。",
      "Turn：发第 4 张公共牌，进行一轮下注。",
      "River：发第 5 张公共牌，进行最后一轮下注。",
      "Showdown：未弃牌玩家比牌，最佳牌型获胜。",
    ],
    actionsTitle: "3）可执行操作",
    actionsBullets: [
      "弃牌（Fold）：放弃本局，已投入筹码不退回。",
      "过牌（Check）：当前无需跟注时可选择过牌。",
      "跟注（Call）：补齐到当前最高下注额。",
      "加注（Raise）：提高下注，金额需满足最小加注要求。",
      "全下（All-in）：把剩余筹码全部投入；可能产生边池。",
    ],
    showdownTitle: "4）摊牌与奖池",
    showdownBullets: [
      "摊牌时从 7 张牌中取最佳 5 张进行比较。",
      "摊牌决策按顺序进行（不是同时进行）：只有当前轮到的玩家可以选择亮牌/弃牌，其他玩家需等待。",
      "决策顺序从河牌最后一次主动进攻玩家开始（下注/加注；包括把当前下注抬高的全下）。若河牌无人主动进攻，则从庄家左手边第一位仍在争池的玩家开始，按顺时针进行。",
      "前位玩家一旦亮牌，后位玩家在自己决策前可以看到其已亮出的手牌。",
      "全下（All-in）玩家在摊牌阶段必须亮牌，不能选择弃牌。",
      "在摊牌阶段选择弃牌，等同于放弃争夺底池。",
      "完全同牌则平分对应底池（主池/边池）。",
      "玩家只能赢取自己参与过的底池。",
    ],
    tiebreakTitle: "5）同牌型比大小",
    tiebreakBullets: [
      "同一牌型先比主体牌值（如对子点数），再比踢脚牌。",
      "顺子比较最大那张（A-2-3-4-5 为最小顺子）。",
      "同花/高牌按从大到小逐张比较。",
    ],
    rankingTitle: "6）牌型大小排序（从大到小）",
    rankingHint: "高一级牌型永远大于低一级牌型。",
  },
};

const SHORT_DECK_RULES_COPY: Record<Locale, RulesCopy> = {
  en: {
    ...STANDARD_RULES_COPY.en,
    modalTitle: "Short-Deck Hold'em Rules",
    modalSubtitle:
      "No-Limit Short-Deck Hold'em quick reference for this table, including hand rankings.",
    tiebreakBullets: [
      "Same hand type: compare key ranks first (for example, pair value, then kickers).",
      "For straights, compare highest card in the straight (A-6-7-8-9 is the lowest straight).",
      "For flush/high card, compare highest cards from top to bottom.",
    ],
    rankingHint: "Short-deck note: flush beats full house.",
  },
  zh_hans: {
    ...STANDARD_RULES_COPY.zh_hans,
    modalTitle: "短牌德州扑克规则",
    modalSubtitle: "本桌为无限注短牌德州。以下为完整流程、操作说明与牌型大小排序。",
    tiebreakBullets: [
      "同一牌型先比主体牌值（如对子点数），再比踢脚牌。",
      "顺子比较最大那张（A-6-7-8-9 为最小顺子）。",
      "同花/高牌按从大到小逐张比较。",
    ],
    rankingHint: "短牌规则补充：同花大于葫芦。",
  },
};

const RULES_COPY_BY_VARIANT: Record<RuleVariant, Record<Locale, RulesCopy>> = {
  standard: STANDARD_RULES_COPY,
  shortDeck: SHORT_DECK_RULES_COPY,
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

const normalizeTrayAmountForDrop = ({
  trayAmount,
  callAmount,
  minRaise,
  stack,
}: {
  trayAmount: number;
  callAmount: number;
  minRaise: number;
  stack: number;
}): number => {
  if (stack <= 0) {
    return 0;
  }

  const clampedAmount = Math.max(0, Math.min(stack, Math.round(trayAmount)));
  if (clampedAmount <= 0) {
    return 0;
  }

  if (clampedAmount === stack) {
    return stack;
  }

  if (callAmount > 0) {
    if (clampedAmount <= callAmount) {
      return Math.min(callAmount, stack);
    }

    const minimumRaiseTotal = callAmount + Math.max(minRaise, 0);
    if (clampedAmount < minimumRaiseTotal) {
      return minimumRaiseTotal <= stack ? minimumRaiseTotal : stack;
    }

    return clampedAmount;
  }

  if (clampedAmount < minRaise) {
    return minRaise <= stack ? minRaise : stack;
  }

  return clampedAmount;
};

const SEAT_EDGE_PADDING_PX = 2;
const MOBILE_SEAT_EDGE_PADDING_PX = 0;
const FELT_BORDER_WIDTH_PX = 2;
const SEAT_OUTER_TOP_OVERHANG_PX = 6;
const SEAT_OUTER_SIDE_OVERHANG_PX = 2;
const SEAT_OUTER_BOTTOM_OVERHANG_PX = 2;
const SEAT_PERIMETER_CLEARANCE_PX = 10;
const MOBILE_SEAT_OUTER_TOP_OVERHANG_PX = 2;
const MOBILE_SEAT_OUTER_SIDE_OVERHANG_PX = 1;
const MOBILE_SEAT_OUTER_BOTTOM_OVERHANG_PX = 1;
const MOBILE_SEAT_PERIMETER_CLEARANCE_PX = 1;
const SEAT_CENTER_EXCLUSION_PADDING_PX = 8;
const SEAT_POD_WIDTH_TO_HEIGHT_RATIO = 1.26;

const getFallbackOrbitAnchor = (slotIndex: number, totalSeats: number): SeatAnchor => {
  const safeTotal = Math.max(1, totalSeats);
  const angleStep = (Math.PI * 2) / safeTotal;
  const startAngle = Math.PI / 2; // Self seat starts at bottom center
  const angle = startAngle + slotIndex * angleStep;

  const centerX = 50;
  const centerY =
    safeTotal <= 3 ? 47 : safeTotal <= 5 ? 46 : safeTotal <= 7 ? 45.5 : safeTotal <= 9 ? 45 : 44.5;
  const radiusX =
    safeTotal <= 3 ? 42 : safeTotal <= 5 ? 44 : safeTotal <= 7 ? 45.5 : safeTotal <= 9 ? 47 : 48;
  const radiusY =
    safeTotal <= 3 ? 33 : safeTotal <= 5 ? 34 : safeTotal <= 7 ? 35.5 : safeTotal <= 9 ? 36.5 : 37.2;

  const left = centerX + Math.cos(angle) * radiusX;
  const top = centerY + Math.sin(angle) * radiusY;

  return {
    top: `${Math.max(7, Math.min(86, top))}%`,
    left: `${Math.max(5, Math.min(95, left))}%`,
  };
};

const isPointInsideRoundedTable = ({
  x,
  y,
  halfTableWidth,
  halfTableHeight,
  cornerRadiusX,
  cornerRadiusY,
}: {
  x: number;
  y: number;
  halfTableWidth: number;
  halfTableHeight: number;
  cornerRadiusX: number;
  cornerRadiusY: number;
}): boolean => {
  const absX = Math.abs(x);
  const absY = Math.abs(y);

  if (absX > halfTableWidth || absY > halfTableHeight) {
    return false;
  }

  const safeCornerRadiusX = Math.max(0, Math.min(halfTableWidth, cornerRadiusX));
  const safeCornerRadiusY = Math.max(0, Math.min(halfTableHeight, cornerRadiusY));
  const innerHalfWidth = Math.max(0, halfTableWidth - safeCornerRadiusX);
  const innerHalfHeight = Math.max(0, halfTableHeight - safeCornerRadiusY);

  if (absX <= innerHalfWidth || absY <= innerHalfHeight) {
    return true;
  }

  if (safeCornerRadiusX <= 0 || safeCornerRadiusY <= 0) {
    return false;
  }

  const cornerOffsetX = absX - innerHalfWidth;
  const cornerOffsetY = absY - innerHalfHeight;

  return (
    (cornerOffsetX * cornerOffsetX) / (safeCornerRadiusX * safeCornerRadiusX) +
      (cornerOffsetY * cornerOffsetY) / (safeCornerRadiusY * safeCornerRadiusY) <=
    1
  );
};

const rectanglesOverlap = (first: RectBounds, second: RectBounds): boolean => {
  const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const overlapHeight = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return overlapWidth > 0 && overlapHeight > 0;
};

const canFitSeatAtDistance = ({
  distance,
  cosine,
  sine,
  leftExtent,
  rightExtent,
  topExtent,
  bottomExtent,
  halfTableWidth,
  halfTableHeight,
  cornerRadiusX,
  cornerRadiusY,
  obstacleRects,
}: {
  distance: number;
  cosine: number;
  sine: number;
  leftExtent: number;
  rightExtent: number;
  topExtent: number;
  bottomExtent: number;
  halfTableWidth: number;
  halfTableHeight: number;
  cornerRadiusX: number;
  cornerRadiusY: number;
  obstacleRects: RectBounds[];
}): boolean => {
  const centerX = distance * cosine;
  const centerY = distance * sine;

  const seatBounds = {
    left: centerX - leftExtent,
    right: centerX + rightExtent,
    top: centerY - topExtent,
    bottom: centerY + bottomExtent,
  };

  const corners: Array<[number, number]> = [
    [seatBounds.left, seatBounds.top],
    [seatBounds.right, seatBounds.top],
    [seatBounds.left, seatBounds.bottom],
    [seatBounds.right, seatBounds.bottom],
  ];

  const isInsideTable = corners.every(([cornerX, cornerY]) =>
    isPointInsideRoundedTable({
      x: cornerX,
      y: cornerY,
      halfTableWidth,
      halfTableHeight,
      cornerRadiusX,
      cornerRadiusY,
    }),
  );

  if (!isInsideTable) {
    return false;
  }

  return !obstacleRects.some((obstacleRect) => rectanglesOverlap(seatBounds, obstacleRect));
};

const solveSeatDistanceToEdge = ({
  cosine,
  sine,
  leftExtent,
  rightExtent,
  topExtent,
  bottomExtent,
  halfTableWidth,
  halfTableHeight,
  cornerRadiusX,
  cornerRadiusY,
  obstacleRects,
}: {
  cosine: number;
  sine: number;
  leftExtent: number;
  rightExtent: number;
  topExtent: number;
  bottomExtent: number;
  halfTableWidth: number;
  halfTableHeight: number;
  cornerRadiusX: number;
  cornerRadiusY: number;
  obstacleRects: RectBounds[];
}): number => {
  if (halfTableWidth <= 0 || halfTableHeight <= 0) {
    return 0;
  }

  const maxDistance = Math.hypot(halfTableWidth, halfTableHeight);
  const canFitDistance = (distance: number) =>
    canFitSeatAtDistance({
      distance,
      cosine,
      sine,
      leftExtent,
      rightExtent,
      topExtent,
      bottomExtent,
      halfTableWidth,
      halfTableHeight,
      cornerRadiusX,
      cornerRadiusY,
      obstacleRects,
    });

  if (obstacleRects.length > 0) {
    const obstacleSampleCount = Math.max(
      DISTANCE_SOLVER_SAMPLE_COUNT * DISTANCE_SOLVER_OBSTACLE_SAMPLE_MULTIPLIER,
      Math.ceil(maxDistance),
    );

    for (let index = 0; index <= obstacleSampleCount; index += 1) {
      const sampleDistance = Math.max(
        0,
        maxDistance - (maxDistance * index) / obstacleSampleCount,
      );
      if (!canFitDistance(sampleDistance)) {
        continue;
      }

      if (index === 0) {
        return sampleDistance;
      }

      const previousSampleDistance = Math.max(
        0,
        maxDistance - (maxDistance * (index - 1)) / obstacleSampleCount,
      );
      let low = sampleDistance;
      let high = previousSampleDistance;

      for (let refineIndex = 0; refineIndex < DISTANCE_SOLVER_REFINE_STEPS; refineIndex += 1) {
        const mid = (low + high) / 2;
        if (canFitDistance(mid)) {
          low = mid;
          continue;
        }
        high = mid;
      }

      return low;
    }

    return 0;
  }

  const sampleCount = DISTANCE_SOLVER_SAMPLE_COUNT;
  let farthestSampleFit = -1;

  for (let index = 0; index <= sampleCount; index += 1) {
    const sampleDistance = (maxDistance * index) / sampleCount;
    const canFitAtSample = canFitDistance(sampleDistance);
    if (canFitAtSample) {
      farthestSampleFit = sampleDistance;
    }
  }

  if (farthestSampleFit < 0) {
    return 0;
  }

  let bestDistance = farthestSampleFit;
  let step = maxDistance / sampleCount;

  for (let index = 0; index < DISTANCE_SOLVER_REFINE_STEPS; index += 1) {
    const candidateDistance = bestDistance + step;
    if (candidateDistance > maxDistance) {
      step /= 2;
      continue;
    }

    const canFitAtCandidate = canFitDistance(candidateDistance);

    if (canFitAtCandidate) {
      bestDistance = candidateDistance;
      continue;
    }

    step /= 2;
  }

  return bestDistance;
};

const ORBIT_BOUNDARY_SAMPLE_COUNT = 540;
const MOBILE_BALANCED_ORBIT_MAX_WIDTH_PX = 700;
const MOBILE_BALANCED_ORBIT_SAMPLE_COUNT = 960;
const DISTANCE_SOLVER_SAMPLE_COUNT = 72;
const DISTANCE_SOLVER_REFINE_STEPS = 16;
const DISTANCE_SOLVER_OBSTACLE_SAMPLE_MULTIPLIER = 4;

const getOrbitAnchors = ({
  totalSeats,
  tableWidth,
  tableHeight,
  tableCornerRadiusX,
  tableCornerRadiusY,
  seatWidth,
  seatHeight,
  obstacleRects,
}: OrbitAnchorsInput): SeatAnchor[] => {
  const safeTotal = Math.max(1, totalSeats);
  const fallbackAnchors = Array.from({ length: safeTotal }, (_, slotIndex) =>
    getFallbackOrbitAnchor(slotIndex, safeTotal),
  );

  if (tableWidth <= 0 || tableHeight <= 0 || seatWidth <= 0 || seatHeight <= 0) {
    return fallbackAnchors;
  }

  const centerX = tableWidth / 2;
  const centerY = tableHeight / 2;
  const useMobileSeatPerimeter = shouldUseReducedMobileSeatPerimeter({
    tableWidth,
    totalSeats: safeTotal,
  });
  const tableInset =
    (useMobileSeatPerimeter ? MOBILE_SEAT_EDGE_PADDING_PX : SEAT_EDGE_PADDING_PX) +
    FELT_BORDER_WIDTH_PX;
  const halfTableWidth = Math.max(tableInset + 1, centerX - tableInset);
  const halfTableHeight = Math.max(tableInset + 1, centerY - tableInset);
  const cornerRadiusX = Math.max(
    0,
    Math.min(halfTableWidth, tableCornerRadiusX - tableInset),
  );
  const cornerRadiusY = Math.max(
    0,
    Math.min(halfTableHeight, tableCornerRadiusY - tableInset),
  );
  const perimeterClearancePx = useMobileSeatPerimeter
    ? MOBILE_SEAT_PERIMETER_CLEARANCE_PX
    : SEAT_PERIMETER_CLEARANCE_PX;
  const sideOverhangPx = useMobileSeatPerimeter
    ? MOBILE_SEAT_OUTER_SIDE_OVERHANG_PX
    : SEAT_OUTER_SIDE_OVERHANG_PX;
  const topOverhangPx = useMobileSeatPerimeter
    ? MOBILE_SEAT_OUTER_TOP_OVERHANG_PX
    : SEAT_OUTER_TOP_OVERHANG_PX;
  const bottomOverhangPx = useMobileSeatPerimeter
    ? MOBILE_SEAT_OUTER_BOTTOM_OVERHANG_PX
    : SEAT_OUTER_BOTTOM_OVERHANG_PX;
  const leftExtent = seatWidth / 2 + sideOverhangPx + perimeterClearancePx;
  const rightExtent = seatWidth / 2 + sideOverhangPx + perimeterClearancePx;
  const topExtent = seatHeight / 2 + topOverhangPx + perimeterClearancePx;
  const bottomExtent = seatHeight / 2 + bottomOverhangPx + perimeterClearancePx;

  if (
    leftExtent + rightExtent >= halfTableWidth * 2 ||
    topExtent + bottomExtent >= halfTableHeight * 2
  ) {
    return fallbackAnchors;
  }

  const centeredObstacleRects = obstacleRects
    .map((obstacleRect) => ({
      left: obstacleRect.left - centerX,
      right: obstacleRect.right - centerX,
      top: obstacleRect.top - centerY,
      bottom: obstacleRect.bottom - centerY,
    }))
    .filter(
      (obstacleRect) =>
        obstacleRect.right > obstacleRect.left && obstacleRect.bottom > obstacleRect.top,
    );

  const useBalancedMobileOrbit =
    tableWidth <= MOBILE_BALANCED_ORBIT_MAX_WIDTH_PX && safeTotal >= 8 && safeTotal % 2 === 0;
  if (useBalancedMobileOrbit) {
    const horizontalBoundaryDistance = solveSeatDistanceToEdge({
      cosine: 1,
      sine: 0,
      leftExtent,
      rightExtent,
      topExtent,
      bottomExtent,
      halfTableWidth,
      halfTableHeight,
      cornerRadiusX,
      cornerRadiusY,
      obstacleRects: [],
    });
    const verticalBoundaryDistance = solveSeatDistanceToEdge({
      cosine: 0,
      sine: 1,
      leftExtent,
      rightExtent,
      topExtent,
      bottomExtent,
      halfTableWidth,
      halfTableHeight,
      cornerRadiusX,
      cornerRadiusY,
      obstacleRects: [],
    });

    const baseOrbitPoints =
      horizontalBoundaryDistance > 0 && verticalBoundaryDistance > 0
        ? buildEqualArcEllipsePoints({
            totalSeats: safeTotal,
            radiusX: horizontalBoundaryDistance,
            radiusY: verticalBoundaryDistance,
            sampleCount: MOBILE_BALANCED_ORBIT_SAMPLE_COUNT,
          })
        : null;

    if (baseOrbitPoints) {
      const isScaleFeasible = (scale: number) =>
        baseOrbitPoints.every(({ x, y }) => {
          const centerXFromOrigin = x * scale;
          const centerYFromOrigin = y * scale;
          const distance = Math.hypot(centerXFromOrigin, centerYFromOrigin);
          if (distance <= 0) {
            return false;
          }

          const angle = Math.atan2(centerYFromOrigin, centerXFromOrigin);
          return canFitSeatAtDistance({
            distance,
            cosine: Math.cos(angle),
            sine: Math.sin(angle),
            leftExtent,
            rightExtent,
            topExtent,
            bottomExtent,
            halfTableWidth,
            halfTableHeight,
            cornerRadiusX,
            cornerRadiusY,
            obstacleRects: centeredObstacleRects,
          });
        });

      let low = 0;
      let high = 1;
      for (let step = 0; step < 20; step += 1) {
        const mid = (low + high) / 2;
        if (isScaleFeasible(mid)) {
          low = mid;
          continue;
        }
        high = mid;
      }

      if (low > 0.2) {
        return baseOrbitPoints.map(({ x, y }) => ({
          left: `${centerX + x * low}px`,
          top: `${centerY + y * low}px`,
        }));
      }
    }
  }

  const startAngle = Math.PI / 2;
  const sampleCount = Math.max(ORBIT_BOUNDARY_SAMPLE_COUNT, safeTotal * 64);
  const boundarySamples: Array<{
    angle: number;
    distance: number;
    x: number;
    y: number;
    cumulativeLength: number;
  }> = [];

  let cumulativeLength = 0;
  let previousSample: { x: number; y: number } | null = null;

  for (let index = 0; index <= sampleCount; index += 1) {
    const angle = startAngle + (index / sampleCount) * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const distance = solveSeatDistanceToEdge({
      cosine,
      sine,
      leftExtent,
      rightExtent,
      topExtent,
      bottomExtent,
      halfTableWidth,
      halfTableHeight,
      cornerRadiusX,
      cornerRadiusY,
      obstacleRects: [],
    });

    if (distance <= 0) {
      return fallbackAnchors;
    }

    const x = cosine * distance;
    const y = sine * distance;

    if (previousSample) {
      cumulativeLength += Math.hypot(x - previousSample.x, y - previousSample.y);
    }

    boundarySamples.push({
      angle,
      distance,
      x,
      y,
      cumulativeLength,
    });
    previousSample = { x, y };
  }

  const totalBoundaryLength = boundarySamples[boundarySamples.length - 1]?.cumulativeLength ?? 0;
  if (totalBoundaryLength <= 0) {
    return fallbackAnchors;
  }

  return Array.from({ length: safeTotal }, (_, slotIndex) => {
    const targetLength = (totalBoundaryLength * slotIndex) / safeTotal;
    let lowerIndex = 0;

    while (
      lowerIndex < boundarySamples.length - 1 &&
      boundarySamples[lowerIndex + 1].cumulativeLength < targetLength
    ) {
      lowerIndex += 1;
    }

    const lowerSample = boundarySamples[lowerIndex];
    const upperSample =
      boundarySamples[Math.min(lowerIndex + 1, boundarySamples.length - 1)];
    const segmentLength = upperSample.cumulativeLength - lowerSample.cumulativeLength;
    const segmentRatio =
      segmentLength > 0
        ? (targetLength - lowerSample.cumulativeLength) / segmentLength
        : 0;
    const seatAngle =
      lowerSample.angle + (upperSample.angle - lowerSample.angle) * segmentRatio;
    const cosine = Math.cos(seatAngle);
    const sine = Math.sin(seatAngle);
    const solvedDistance = solveSeatDistanceToEdge({
      cosine,
      sine,
      leftExtent,
      rightExtent,
      topExtent,
      bottomExtent,
      halfTableWidth,
      halfTableHeight,
      cornerRadiusX,
      cornerRadiusY,
      obstacleRects: centeredObstacleRects,
    });
    if (solvedDistance <= 0) {
      return fallbackAnchors[slotIndex] ?? getFallbackOrbitAnchor(slotIndex, safeTotal);
    }
    const seatDistance = solvedDistance;

    return {
      left: `${centerX + cosine * seatDistance}px`,
      top: `${centerY + sine * seatDistance}px`,
    };
  });
};

const RECT_COMPARISON_TOLERANCE_PX = 0.25;

const areRectBoundSetsEqual = (
  previousRects: RectBounds[],
  nextRects: RectBounds[],
): boolean => {
  if (previousRects.length !== nextRects.length) {
    return false;
  }

  return previousRects.every((rect, index) => {
    const nextRect = nextRects[index];
    return (
      Math.abs(rect.left - nextRect.left) <= RECT_COMPARISON_TOLERANCE_PX &&
      Math.abs(rect.right - nextRect.right) <= RECT_COMPARISON_TOLERANCE_PX &&
      Math.abs(rect.top - nextRect.top) <= RECT_COMPARISON_TOLERANCE_PX &&
      Math.abs(rect.bottom - nextRect.bottom) <= RECT_COMPARISON_TOLERANCE_PX
    );
  });
};

const resolveObstacleRectsWithinTable = ({
  feltNode,
  obstacleNodes,
  paddingPx,
}: {
  feltNode: HTMLElement;
  obstacleNodes: Array<HTMLElement | null>;
  paddingPx: number;
}): RectBounds[] => {
  const feltRect = feltNode.getBoundingClientRect();
  const feltWidth = feltRect.width;
  const feltHeight = feltRect.height;
  if (feltWidth <= 0 || feltHeight <= 0) {
    return [];
  }

  return obstacleNodes
    .filter((node): node is HTMLElement => Boolean(node))
    .map((node) => {
      const nodeRect = node.getBoundingClientRect();
      const left = Math.max(0, nodeRect.left - feltRect.left - paddingPx);
      const right = Math.min(feltWidth, nodeRect.right - feltRect.left + paddingPx);
      const top = Math.max(0, nodeRect.top - feltRect.top - paddingPx);
      const bottom = Math.min(feltHeight, nodeRect.bottom - feltRect.top + paddingPx);
      return { left, right, top, bottom };
    })
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
    .sort((firstRect, secondRect) =>
      firstRect.top === secondRect.top
        ? firstRect.left - secondRect.left
        : firstRect.top - secondRect.top,
    );
};

const parseLengthToPixels = ({
  token,
  rootFontSize,
  viewportWidth,
  referenceLength,
}: {
  token: string;
  rootFontSize: number;
  viewportWidth: number;
  referenceLength?: number;
}): number => {
  const normalized = token.trim().toLowerCase();
  if (normalized.endsWith("rem")) {
    return Number.parseFloat(normalized) * rootFontSize;
  }
  if (normalized.endsWith("vw")) {
    return (Number.parseFloat(normalized) / 100) * viewportWidth;
  }
  if (normalized.endsWith("px")) {
    return Number.parseFloat(normalized);
  }
  if (normalized.endsWith("%")) {
    const percentage = Number.parseFloat(normalized);
    if (!Number.isFinite(percentage)) {
      return 0;
    }
    return ((referenceLength ?? 0) * percentage) / 100;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveCornerRadiusPixels = ({
  borderRadiusValue,
  tableWidth,
  tableHeight,
}: {
  borderRadiusValue: string;
  tableWidth: number;
  tableHeight: number;
}) => {
  const normalized = borderRadiusValue.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return {
      cornerRadiusX: 0,
      cornerRadiusY: 0,
    };
  }

  const [horizontalRaw, verticalRaw] = normalized.split("/").map((value) => value.trim());
  const horizontalToken = horizontalRaw.split(" ")[0] ?? "0px";
  const verticalToken = (verticalRaw ?? horizontalRaw).split(" ")[0] ?? horizontalToken;

  const cornerRadiusX = parseLengthToPixels({
    token: horizontalToken,
    rootFontSize: 16,
    viewportWidth: tableWidth,
    referenceLength: tableWidth,
  });
  const cornerRadiusY = parseLengthToPixels({
    token: verticalToken,
    rootFontSize: 16,
    viewportWidth: tableHeight,
    referenceLength: tableHeight,
  });

  return {
    cornerRadiusX: Math.max(0, Math.min(tableWidth / 2, cornerRadiusX)),
    cornerRadiusY: Math.max(0, Math.min(tableHeight / 2, cornerRadiusY)),
  };
};

const resolveSeatSlotWidthPixels = ({
  seatSlotWidth,
  rootFontSize,
  viewportWidth,
}: {
  seatSlotWidth: string;
  rootFontSize: number;
  viewportWidth: number;
}): number => {
  const normalized = seatSlotWidth.replace(/\s+/g, "");
  const clampMatch = normalized.match(/^clamp\(([^,]+),([^,]+),([^)]+)\)$/i);
  if (!clampMatch) {
    return parseLengthToPixels({
      token: normalized,
      rootFontSize,
      viewportWidth,
    });
  }

  const minValue = parseLengthToPixels({
    token: clampMatch[1],
    rootFontSize,
    viewportWidth,
  });
  const preferredValue = parseLengthToPixels({
    token: clampMatch[2],
    rootFontSize,
    viewportWidth,
  });
  const maxValue = parseLengthToPixels({
    token: clampMatch[3],
    rootFontSize,
    viewportWidth,
  });

  return Math.max(minValue, Math.min(maxValue, preferredValue));
};

const getSeatSlotWidth = ({
  occupiedSeats,
}: {
  occupiedSeats: number;
}) => {
  if (occupiedSeats <= 2) return "clamp(4.7rem, 18.8vw, 6.2rem)";
  if (occupiedSeats <= 4) return "clamp(4.36rem, 16.8vw, 5.7rem)";
  if (occupiedSeats <= 6) return "clamp(4.08rem, 14.8vw, 5.5rem)";
  if (occupiedSeats <= 8) return "clamp(3.72rem, 13.5vw, 5.08rem)";
  if (occupiedSeats <= 10) return "clamp(3.46rem, 12.4vw, 4.72rem)";
  if (occupiedSeats <= 12) return "clamp(3.18rem, 11.2vw, 4.3rem)";
  if (occupiedSeats <= 16) return "clamp(2.86rem, 9.8vw, 3.86rem)";
  return "clamp(2.58rem, 8.5vw, 3.38rem)";
};

const normalizeOrbitCapacity = (maxPlayers: number) => {
  const parsedMaxPlayers = Number(maxPlayers);
  if (!Number.isFinite(parsedMaxPlayers)) {
    return 6;
  }

  return Math.min(15, Math.max(6, Math.floor(parsedMaxPlayers)));
};

const getSeatDensityClass = ({
  seatSlotWidthPx,
  occupiedSeatCount,
}: {
  seatSlotWidthPx: number;
  occupiedSeatCount: number;
}) => {
  if (seatSlotWidthPx > 0) {
    if (seatSlotWidthPx <= 72) {
      return "seat-pod--dense";
    }
    if (seatSlotWidthPx <= 90) {
      return "seat-pod--compact";
    }
    return "seat-pod--spacious";
  }

  if (occupiedSeatCount >= 8) {
    return "seat-pod--dense";
  }
  if (occupiedSeatCount >= 5) {
    return "seat-pod--compact";
  }
  return "seat-pod--spacious";
};

const getSeatRoleIcon = (
  playerPosition: number,
  handMeta?: {
    dealerPosition: number;
    smallBlindPosition: number;
  },
) => {
  if (!handMeta) {
    return null;
  }

  if (handMeta.dealerPosition === playerPosition) {
    return "dealer" as const;
  }
  if (handMeta.smallBlindPosition === playerPosition) {
    return "small-blind" as const;
  }
  return null;
};

const buildSeatBadge = (
  roleIcon: ReturnType<typeof getSeatRoleIcon>,
  seatPositionLabel: string | null,
): SeatBadge | null => {
  if (roleIcon && seatPositionLabel) {
    return {
      tone: roleIcon === "dealer" ? "dealer" : "small-blind",
      text: seatPositionLabel,
    };
  }

  if (seatPositionLabel) {
    return {
      tone: "position",
      text: seatPositionLabel,
    };
  }

  if (roleIcon) {
    return {
      tone: roleIcon === "dealer" ? "dealer" : "small-blind",
      text: roleIcon === "dealer" ? "D" : "SB",
    };
  }

  return null;
};

const buildSeatLiveAudioBadge = (
  liveAudioParticipant: {
    isMuted: boolean;
    isSpeaking: boolean;
  } | null,
  labels: {
    speaking: string;
    onMic: string;
    muted: string;
  },
): SeatLiveAudioBadge | null => {
  if (!liveAudioParticipant) {
    return null;
  }

  if (liveAudioParticipant.isSpeaking) {
    return {
      kind: "speaking",
      ariaLabel: labels.speaking,
    };
  }

  if (liveAudioParticipant.isMuted) {
    return {
      kind: "muted",
      ariaLabel: labels.muted,
    };
  }

  return {
    kind: "on-mic",
    ariaLabel: labels.onMic,
  };
};

const resolveSeatMainState = ({
  isCurrentTurnSeat,
  isDisconnected,
  isAllIn,
  isFolded,
  isWaiting,
}: {
  isCurrentTurnSeat: boolean;
  isDisconnected: boolean;
  isAllIn: boolean;
  isFolded: boolean;
  isWaiting: boolean;
}): SeatMainState => {
  if (isCurrentTurnSeat) return "turn";
  if (isAllIn) return "all-in";
  if (isFolded) return "folded";
  if (isDisconnected) return "disconnected";
  if (isWaiting) return "waiting";
  return "default";
};

const resolveSeatPrimaryActionLabel = ({
  seatPlayer,
  isDisconnected,
  isForcedBlind,
  latestSeatActionEvent,
  t,
}: {
  seatPlayer: Player;
  isDisconnected: boolean;
  isForcedBlind: boolean;
  latestSeatActionEvent: PlayerActionFlashEvent | null;
  t: Translate;
}): SeatActionLabel | null => {
  if (seatPlayer.status === "folded" || isDisconnected) {
    return null;
  }

  if (latestSeatActionEvent?.displayKind === "check") {
    return {
      text: t("common.check"),
      tone: "call",
    };
  }

  if (seatPlayer.lastAction === "check") {
    return {
      text: t("common.check"),
      tone: "call",
    };
  }

  if (seatPlayer.currentBet <= 0) {
    return null;
  }

  if (seatPlayer.lastAction === "fold") {
    return null;
  }

  if (latestSeatActionEvent?.displayKind === "bet-to") {
    return {
      text: t("game.seatAction.betTo", { amount: latestSeatActionEvent.totalBetAfterAction ?? seatPlayer.currentBet }),
      tone: "aggressive",
    };
  }

  if (latestSeatActionEvent?.displayKind === "raise-to") {
    return {
      text: t("game.seatAction.raiseTo", { amount: latestSeatActionEvent.totalBetAfterAction ?? seatPlayer.currentBet }),
      tone: "aggressive",
    };
  }

  if (latestSeatActionEvent?.displayKind === "call-to") {
    return {
      text: t("game.seatAction.callTo", { amount: latestSeatActionEvent.totalBetAfterAction ?? seatPlayer.currentBet }),
      tone: "call",
    };
  }

  if (latestSeatActionEvent?.displayKind === "all-in-to") {
    return {
      text: t("game.seatAction.allInTo", { amount: latestSeatActionEvent.totalBetAfterAction ?? seatPlayer.currentBet }),
      tone: "allin",
    };
  }

  if (isForcedBlind && seatPlayer.lastAction === null) {
    return {
      text: t("game.seatAction.blind", { amount: seatPlayer.currentBet }),
      tone: "blind",
    };
  }

  if (seatPlayer.lastAction === "call") {
    return {
      text: t("game.seatAction.callTo", { amount: seatPlayer.currentBet }),
      tone: "call",
    };
  }

  if (seatPlayer.lastAction === "all-in" || seatPlayer.status === "all-in") {
    return {
      text: t("game.seatAction.allInTo", { amount: seatPlayer.currentBet }),
      tone: "allin",
    };
  }

  if (seatPlayer.lastAction === "raise") {
    return {
      text: t("game.seatAction.raiseTo", { amount: seatPlayer.currentBet }),
      tone: "aggressive",
    };
  }

  return {
    text: t("game.seatAction.betTo", { amount: seatPlayer.currentBet }),
    tone: "aggressive",
  };
};

const resolveSeatPendingActionLabel = ({
  seatPlayer,
  isDisconnected,
  isCurrentTurnSeat,
  t,
}: {
  seatPlayer: Player;
  isDisconnected: boolean;
  isCurrentTurnSeat: boolean;
  t: Translate;
}): SeatActionLabel | null => {
  if (!isCurrentTurnSeat) {
    return null;
  }

  if (
    seatPlayer.status === "folded" ||
    isDisconnected ||
    seatPlayer.status === "waiting" ||
    seatPlayer.status === "all-in"
  ) {
    return null;
  }

  if (seatPlayer.currentBet > 0) {
    return null;
  }

  return {
    text: t("game.seatAction.pending"),
    tone: "pending",
  };
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
        text: withAmount(t("game.actionBubble.callTo"), event.totalBetAfterAction ?? event.amount),
        playerName: event.playerName,
        tone: "neutral",
        exiting: false,
      };
    case "all-in":
      return {
        id: event.id,
        playerId: event.playerId,
        text: withAmount(
          t("game.actionBubble.allInTo"),
          event.totalBetAfterAction ?? event.amount,
        ),
        playerName: event.playerName,
        tone: "allin",
        exiting: false,
      };
    case "raise":
      if (event.displayKind === "bet-to") {
        return {
          id: event.id,
          playerId: event.playerId,
          text: withAmount(t("game.actionBubble.betTo"), event.totalBetAfterAction ?? event.amount),
          playerName: event.playerName,
          tone: "aggressive",
          exiting: false,
        };
      }

      return {
        id: event.id,
        playerId: event.playerId,
        text: withAmount(
          t("game.actionBubble.raiseTo"),
          event.totalBetAfterAction ?? event.amount,
        ),
        playerName: event.playerName,
        tone: "aggressive",
        exiting: false,
      };
  }
};

const useGameRoomElement = () => {
  const navigate = useNavigate();
  const {
    room,
    player,
    yourCards,
    lastHandResult,
    finalGameResult,
    lastPlayerActionEvent,
    revealedHandPlayerIds,
    showdownDecisionState,
    runCountDecisionState,
    revealedShowdownHandsByPlayerId,
    nextStreetRevealState,
    isHost,
    lastError,
    clearError,
    markReady,
    endGame,
    showMyHand,
    muckMyHand,
    revealNextStreet,
    decideRunCount,
    performAction,
    leaveRoom,
    updateRoomConfig,
    addRobotPlayer,
    removeRobotPlayer,
    chatMessages,
    chatUnreadCount,
    isChatPanelOpen,
    setChatPanelOpen,
    clearChatUnread,
  } = useGame();
  const { locale, setLocale, t } = useLocalization();
  const { user, updateProfile } = useAuth();
  const {
    available: isLiveAudioAvailable,
    isConfigLoaded: isLiveAudioConfigLoaded,
    isConnecting: isLiveAudioConnecting,
    isJoined: isLiveAudioJoined,
    isMuted: isLiveAudioMuted,
    isAudioPlaybackBlocked: isLiveAudioPlaybackBlocked,
    isReconnecting: isLiveAudioReconnecting,
    participants: liveAudioParticipants,
    error: liveAudioError,
    hasReconnectPrompt: hasLiveAudioReconnectPrompt,
    joinAudio,
    reconnectAudio,
    dismissReconnectPrompt,
    leaveAudio,
    muteAudio,
    unmuteAudio,
    enableAudio,
  } = useLiveAudio();
  const localLiveAudioParticipant = liveAudioParticipants.find((participant) => participant.isLocal);
  const isLiveAudioSpeaking = localLiveAudioParticipant?.isSpeaking ?? false;

  const [inviteCopyStatus, setInviteCopyStatus] = useState<string | null>(null);
  const [inviteCopyStatusTone, setInviteCopyStatusTone] = useState<"success" | "error" | null>(
    null,
  );
  const [trayAmount, setTrayAmount] = useState(0);
  const [trayInputValue, setTrayInputValue] = useState("0");
  const [mobileChipDraftValue, setMobileChipDraftValue] = useState("0");
  const [showMobileChipPopover, setShowMobileChipPopover] = useState(false);
  const [showLiveAudioPopover, setShowLiveAudioPopover] = useState(false);
  const [profileDisplayNameDraft, setProfileDisplayNameDraft] = useState("");
  const [profileAvatarEmojiDraft, setProfileAvatarEmojiDraft] = useState("🙂");
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [dialogState, dispatchDialogState] = useReducer(
    gameRoomModalReducer,
    INITIAL_GAME_ROOM_MODAL_STATE,
  );
  const [isExportingHandHistory, setIsExportingHandHistory] = useState(false);
  const [isOpeningHandReview, setIsOpeningHandReview] = useState(false);
  const [isExportingGameHistory, setIsExportingGameHistory] = useState(false);
  const [handReviewUnavailableSummary, setHandReviewUnavailableSummary] = useState<{
    actionCount: number;
    playerCount: number;
  } | null>(null);
  const [quickConfirmAction, setQuickConfirmAction] = useState<QuickConfirmAction | null>(null);
  const [showTrayConfirm, setShowTrayConfirm] = useState(false);
  const [legacyRaiseAmount, setLegacyRaiseAmount] = useState(0);
  const [dragState, setDragState] = useState<DragState>(EMPTY_DRAG_STATE);
  const [actionCenterAlert, setActionCenterAlert] = useState<ActionCenterAlert | null>(null);
  const [actionPointerVector, setActionPointerVector] = useState<ActionPointerVector | null>(null);
  const [turnAlertToken, setTurnAlertToken] = useState<number | null>(null);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  const [cardsFlyoutHeight, setCardsFlyoutHeight] = useState(0);
  const [feltSize, setFeltSize] = useState({ width: 0, height: 0 });
  const [tableObstacleRects, setTableObstacleRects] = useState<RectBounds[]>([]);
  const [isDesktopSideDock, setIsDesktopSideDock] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(DESKTOP_SIDE_DOCK_QUERY).matches;
  });
  const [isCompactMobileDock, setIsCompactMobileDock] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(COMPACT_MOBILE_DOCK_QUERY).matches;
  });

  const showSettingsModal = dialogState.primary === "settings";
  const showRankingsModal = dialogState.primary === "rankings";
  const showRulesModal = dialogState.primary === "rules";
  const showHandResultsModal = dialogState.primary === "handResults";
  const showFinalSummaryModal = dialogState.primary === "finalSummary";
  const showEndGameConfirmModal = dialogState.confirm === "endGameConfirm";
  const showLeaveConfirmModal = dialogState.confirm === "leaveConfirm";
  const [dismissedPreviewMessageId, setDismissedPreviewMessageId] = useState<string | null>(null);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());

  const potDropZoneRef = useRef<HTMLDivElement | null>(null);
  const handResultsPanelRef = useRef<HTMLElement | null>(null);
  const finalSummaryPanelRef = useRef<HTMLElement | null>(null);
  const lastDisplayedHandResultRef = useRef<HandResult | null>(null);
  const bottomBarOverlayRef = useRef<HTMLElement | null>(null);
  const mobileCardsFlyoutRef = useRef<HTMLElement | null>(null);
  const actionCenterAlertRef = useRef<HTMLDivElement | null>(null);
  const chatForcedByDesktopRef = useRef(false);
  const feltOvalRef = useRef<HTMLDivElement | null>(null);
  const boardCenterStackRef = useRef<HTMLDivElement | null>(null);
  const boardStageRef = useRef<HTMLDivElement | null>(null);
  const communityLaneRef = useRef<HTMLDivElement | null>(null);
  const seatNodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const liveAudioButtonRef = useRef<HTMLButtonElement | null>(null);
  const actionAlertHideTimeoutRef = useRef<number | null>(null);
  const actionAlertClearTimeoutRef = useRef<number | null>(null);
  const turnAlertTimeoutRef = useRef<number | null>(null);
  const previousIsYourTurnRef = useRef<boolean | null>(null);
  const dragStateRef = useRef<DragState>(EMPTY_DRAG_STATE);
  const dragActivatorRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    setProfileDisplayNameDraft(user.displayName);
    setProfileAvatarEmojiDraft(user.avatarEmoji);
  }, [user]);

  const currentHand = room?.currentHand ?? null;
  const tablePlayers = useMemo(
    () => room?.players.filter((entry) => entry.status !== "left") ?? [],
    [room?.players],
  );
  const robotPlayers = useMemo(
    () =>
      tablePlayers
        .filter((entry) => Boolean(entry.isRobot))
        .sort((left, right) => left.position - right.position),
    [tablePlayers],
  );
  const readyEligiblePlayers = useMemo(
    () =>
      tablePlayers.filter(
        (entry) => getConnectionStatus(entry) !== "disconnected",
      ),
    [tablePlayers],
  );
  const isPlayerStreetRevealEnabled = room?.config.allowPlayerStreetReveal ?? true;
  const isGameStarted = room?.gameState === "IN_PROGRESS";
  const isGameEnded = room?.gameState === "ENDED";
  const currentPlayer = room?.players.find((entry) => entry.id === player?.id) ?? null;
  const currentTurnPlayer =
    tablePlayers.find((entry) => entry.id === currentHand?.currentPlayerTurn) ?? null;

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
  const maxStack = currentPlayer?.chips ?? 0;
  const clampTrayAmount = useCallback(
    (value: number) => Math.max(0, Math.min(maxStack, Math.round(value))),
    [maxStack],
  );
  const normalizeTrayAmount = useCallback(
    (value: number) =>
      normalizeTrayAmountForDrop({
        trayAmount: value,
        callAmount,
        minRaise,
        stack: maxStack,
      }),
    [callAmount, maxStack, minRaise],
  );
  const canCheck = callAmount === 0;
  const resolvedPlayerId = currentPlayer?.id ?? player?.id ?? null;
  const isYourTurn = Boolean(
    currentHand?.currentPlayerTurn &&
      resolvedPlayerId &&
      currentHand.currentPlayerTurn === resolvedPlayerId,
  );
  const currentHandNumber = currentHand?.handNumber ?? null;
  const handScopedUiStateKey = `${room?.id ?? "no-room"}:${currentHandNumber ?? "no-hand"}`;
  const [handScopedUiState, setHandScopedUiState] = useState<HandScopedUiState>(() =>
    createDefaultHandScopedUiState(handScopedUiStateKey),
  );
  const resolvedHandScopedUiState =
    handScopedUiState.key === handScopedUiStateKey
      ? handScopedUiState
      : createDefaultHandScopedUiState(handScopedUiStateKey);

  useEffect(() => {
    setHandScopedUiState((previous) =>
      previous.key === handScopedUiStateKey
        ? previous
        : createDefaultHandScopedUiState(handScopedUiStateKey),
    );
  }, [handScopedUiStateKey]);

  const updateHandScopedUiState = useCallback(
    (updater: (state: HandScopedUiState) => HandScopedUiState) => {
      setHandScopedUiState((previous) => {
        const baseState =
          previous.key === handScopedUiStateKey
            ? previous
            : createDefaultHandScopedUiState(handScopedUiStateKey);
        return updater(baseState);
      });
    },
    [handScopedUiStateKey],
  );

  const isCardsFlyoutOpen = resolvedHandScopedUiState.isCardsFlyoutOpen;

  const setIsCardsFlyoutOpen = useCallback(
    (nextValue: React.SetStateAction<boolean>) => {
      updateHandScopedUiState((state) => ({
        ...state,
        isCardsFlyoutOpen:
          typeof nextValue === "function" ? nextValue(state.isCardsFlyoutOpen) : nextValue,
      }));
    },
    [updateHandScopedUiState],
  );

  const openPrimaryModal = useCallback(
    (modal: GameRoomPrimaryModal) => {
      dispatchDialogState({
        type: "openPrimary",
        modal,
      });
    },
    [],
  );

  const closePrimaryModal = useCallback(
    (modal?: GameRoomPrimaryModal) => {
      dispatchDialogState({
        type: "closePrimary",
        modal,
      });
    },
    [],
  );

  const openConfirmModal = useCallback(
    (modal: GameRoomConfirmModal) => {
      dispatchDialogState({
        type: "openConfirm",
        modal,
      });
    },
    [],
  );

  const closeConfirmModal = useCallback(
    (modal?: GameRoomConfirmModal) => {
      dispatchDialogState({
        type: "closeConfirm",
        modal,
      });
    },
    [],
  );

  const latestUnreadIncomingChatMessage = useMemo(() => {
    if (chatUnreadCount <= 0) {
      return null;
    }

    for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
      const message = chatMessages[index];
      if (message.sender.playerId !== resolvedPlayerId) {
        return message;
      }
    }

    return null;
  }, [chatMessages, chatUnreadCount, resolvedPlayerId]);

  const activePreviewMessage =
    latestUnreadIncomingChatMessage &&
    latestUnreadIncomingChatMessage.id !== dismissedPreviewMessageId
      ? latestUnreadIncomingChatMessage
      : null;

  const handleOpenChatFromPreview = useCallback(() => {
    if (!activePreviewMessage) {
      return;
    }

    if (activePreviewMessage.kind === "VOICE") {
      void playVoicePlayback(resolveVoiceAudioUrl(activePreviewMessage.voice.audioUrl));
    }

    setChatPanelOpen(true);
  }, [activePreviewMessage, setChatPanelOpen]);

  const handleDismissPreview = useCallback(() => {
    if (!activePreviewMessage) {
      return;
    }

    setDismissedPreviewMessageId(activePreviewMessage.id);
    clearChatUnread();
  }, [activePreviewMessage, clearChatUnread]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRelativeNow(Date.now());
    }, 30 * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const isHandPausedForNext =
    Boolean(currentHand) && currentHand?.currentPlayerTurn === null;
  const isHandPausedForNextHand = isHandPausedForNext && Boolean(lastHandResult);
  const canReadyNextHand =
    isGameStarted && isHandPausedForNextHand && readyEligiblePlayers.length >= 2;
  const canHostEndGame = isHost && isGameStarted && isHandPausedForNextHand;
  const currentReadyPhase =
    !isGameStarted && !isGameEnded
      ? "START_GAME"
      : isHandPausedForNextHand
        ? "NEXT_HAND"
        : null;
  const readyPlayerIdSet = useMemo(
    () =>
      room?.readyPhase === currentReadyPhase
        ? new Set(room?.readyPlayerIds ?? [])
        : new Set<string>(),
    [currentReadyPhase, room?.readyPhase, room?.readyPlayerIds],
  );
  const hasReadiedCurrentPhase = Boolean(player?.id && readyPlayerIdSet.has(player.id));
  const isPreGamePhase = !isGameStarted && !isGameEnded;
  const canReadyPreGame = isPreGamePhase && readyEligiblePlayers.length >= 2;
  const showPreGameReadyArea = isPreGamePhase;
  const shouldShowSeatReadyOverlay =
    !isGameEnded && (!isGameStarted || isHandPausedForNextHand);

  const myCompletedHand =
    lastHandResult?.playerHands.find((entry) => entry.playerId === player?.id) ?? null;
  const displayHoleCards =
    isHandPausedForNext && myCompletedHand?.cards?.length
      ? myCompletedHand.cards
      : yourCards;
  const hasHoleCards = Boolean(displayHoleCards && displayHoleCards.length > 0);
  const shouldRenderCardsFlyout = Boolean((isGameStarted || hasHoleCards) && !lastHandResult);
  const isWaitingForNextHand =
    Boolean(isGameStarted) && currentPlayer?.status === "waiting" && !hasHoleCards;

  const nextStreetReadyPlayerIdSet = useMemo(
    () => new Set(nextStreetRevealState?.readyPlayerIds ?? []),
    [nextStreetRevealState?.readyPlayerIds],
  );
  const nextStreetRequiredPlayerIdSet = useMemo(
    () => new Set(nextStreetRevealState?.requiredPlayerIds ?? []),
    [nextStreetRevealState?.requiredPlayerIds],
  );
  const isResultRevealStep = nextStreetRevealState?.nextRound === "SHOWDOWN";
  const canRevealNextStreet = Boolean(
    !lastHandResult &&
      nextStreetRevealState &&
      player?.id &&
      nextStreetRequiredPlayerIdSet.has(player.id) &&
      (isResultRevealStep || isPlayerStreetRevealEnabled),
  );
  const hasRevealedNextStreet = player?.id
    ? nextStreetReadyPlayerIdSet.has(player.id)
    : false;
  const showNextStreetActionArea = Boolean(nextStreetRevealState) && !lastHandResult;
  const runCountEligiblePlayerIdSet = useMemo(
    () => new Set(runCountDecisionState?.eligiblePlayerIds ?? []),
    [runCountDecisionState?.eligiblePlayerIds],
  );
  const runCountTwiceAgreedPlayerIdSet = useMemo(
    () => new Set(runCountDecisionState?.twiceAgreedPlayerIds ?? []),
    [runCountDecisionState?.twiceAgreedPlayerIds],
  );
  const isRunCountDecisionStep = Boolean(
    !lastHandResult &&
      runCountDecisionState &&
      runCountDecisionState.eligiblePlayerIds.length > 0,
  );
  const canChooseRunCount = Boolean(
    player?.id && runCountEligiblePlayerIdSet.has(player.id),
  );
  const hasChosenRunTwice = Boolean(
    player?.id && runCountTwiceAgreedPlayerIdSet.has(player.id),
  );
  const runCountWaitingPlayerNames = useMemo(() => {
    if (!room || !runCountDecisionState) return [];
    return runCountDecisionState.eligiblePlayerIds
      .filter((playerId) => !runCountTwiceAgreedPlayerIdSet.has(playerId))
      .map(
        (playerId) =>
          room.players.find((seatPlayer) => seatPlayer.id === playerId)?.name ?? playerId,
      );
  }, [room, runCountDecisionState, runCountTwiceAgreedPlayerIdSet]);
  const resolvedRunoutBoards = room?.currentHand?.runoutBoards ?? [];
  const showResolvedRunoutBoardsPreview = Boolean(
    !lastHandResult &&
      room?.currentHand?.bettingRound === "SHOWDOWN" &&
      resolvedRunoutBoards.length > 1,
  );
  const revealedHandPlayerIdSet = useMemo(
    () => new Set(revealedHandPlayerIds),
    [revealedHandPlayerIds],
  );
  const showdownForcedRevealPlayerIdSet = useMemo(
    () => new Set(showdownDecisionState?.forcedRevealPlayerIds ?? []),
    [showdownDecisionState?.forcedRevealPlayerIds],
  );
  const showdownOrderedPlayerIdSet = useMemo(
    () => new Set(showdownDecisionState?.orderedPlayerIds ?? []),
    [showdownDecisionState?.orderedPlayerIds],
  );
  const revealedShowdownHands = useMemo(
    () =>
      Object.values(revealedShowdownHandsByPlayerId).sort((left, right) => {
        if (left.showdownOrderIndex !== right.showdownOrderIndex) {
          return left.showdownOrderIndex - right.showdownOrderIndex;
        }
        return left.playerName.localeCompare(right.playerName);
      }),
    [revealedShowdownHandsByPlayerId],
  );
  const isShowdownDecisionStep = Boolean(
    !lastHandResult &&
      room?.currentHand?.bettingRound === "SHOWDOWN" &&
      showdownDecisionState?.currentPlayerId,
  );
  const isMyShowdownDecisionTurn = Boolean(
    player?.id &&
      showdownDecisionState?.currentPlayerId &&
      showdownDecisionState.currentPlayerId === player.id,
  );
  const showdownDecisionWaitingPlayerName = isMyShowdownDecisionTurn
    ? null
    : showdownDecisionState?.currentPlayerName ?? null;
  const isShowdownForcedRevealTurn = Boolean(
    player?.id && showdownForcedRevealPlayerIdSet.has(player.id),
  );
  const showdownActivePlayerIds = room?.currentHand?.activePlayers;
  const isShowdownContender = Boolean(
    player?.id &&
      (showdownOrderedPlayerIdSet.has(player.id) ||
        (Array.isArray(showdownActivePlayerIds) &&
          showdownActivePlayerIds.includes(player.id)) ||
        (!Array.isArray(showdownActivePlayerIds) &&
          hasHoleCards &&
          player.status !== "folded" &&
          player.status !== "left" &&
          player.status !== "waiting" &&
          getConnectionStatus(player) !== "disconnected")),
  );
  const hasShownMyHandAtShowdown = Boolean(
    player?.id && revealedHandPlayerIdSet.has(player.id),
  );
  const hasFoldedMyHandAtShowdown = Boolean(
    isShowdownDecisionStep && !hasShownMyHandAtShowdown && player?.status === "folded",
  );
  const canShowMyHandAtShowdown = Boolean(
    isShowdownDecisionStep &&
      isShowdownContender &&
      isMyShowdownDecisionTurn &&
      !hasShownMyHandAtShowdown &&
      !hasFoldedMyHandAtShowdown,
  );
  const showShowdownDecisionArea = isShowdownDecisionStep;
  const canFoldMyHandAtShowdown = canShowMyHandAtShowdown && !isShowdownForcedRevealTurn;
  const showNextHandActionArea = canReadyNextHand;
  const showReadyActionArea = showPreGameReadyArea || showNextHandActionArea;
  const readyActionPhase = showNextHandActionArea ? "NEXT_HAND" : "START_GAME";
  const canReadyInReadyActionArea =
    readyActionPhase === "START_GAME" ? canReadyPreGame : canReadyNextHand;
  const showOperationBar =
    isRunCountDecisionStep || showShowdownDecisionArea || showNextStreetActionArea;
  // Hand/final result dialogs already replace the current primary modal when they open.
  // Keep blanket preemption only for active in-hand action states that need table focus.
  const shouldPreemptInformationalModals = showOperationBar;
  const operationBarMode = isRunCountDecisionStep
    ? "runCount"
    : showShowdownDecisionArea
    ? "showdown"
    : showNextStreetActionArea
      ? "streetReveal"
      : null;
  const showTurnActionDock = isYourTurn && !showOperationBar && !showReadyActionArea;
  const shouldShowDesktopRail = isDesktopSideDock;
  const shouldShowChatPanel = isDesktopSideDock || isChatPanelOpen;
  const shouldAnchorCardsFlyoutToBottomBar =
    showOperationBar || showReadyActionArea || (showTurnActionDock && !isDesktopSideDock);
  const desktopCardsFlyoutLayout = resolveCardsFlyoutDesktopLayout({
    shouldRenderCardsFlyout,
    isDesktopSideDock,
    showTurnActionDock,
  });
  const shouldRenderCardsBesideDesktopDock =
    desktopCardsFlyoutLayout.renderInDesktopDockCluster && showTurnActionDock;
  const shouldRenderCardsInDesktopDockCluster =
    desktopCardsFlyoutLayout.renderInDesktopDockCluster;
  const shouldRenderStandaloneDesktopCardsFlyout =
    shouldRenderCardsInDesktopDockCluster &&
    !showTurnActionDock &&
    !showOperationBar &&
    !showReadyActionArea;
  const shouldRenderCardsInBoardStage = shouldRenderCardsFlyoutInBoardStage({
    shouldRenderCardsFlyout,
    isDesktopSideDock,
    showTurnActionDock,
  });
  const cardsFlyoutPlacement = isDesktopSideDock
    ? "felt-right"
    : "bottom";
  const activeBottomBarMode = showOperationBar
    ? "operation"
    : showReadyActionArea
      ? "nextHand"
      : showTurnActionDock
        ? "turn"
        : null;

  const winnersByPlayerId = useMemo(
    () =>
      new Map(
        (lastHandResult?.winners ?? []).map((winner) => [winner.playerId, winner]),
      ),
    [lastHandResult],
  );
  const netByPlayerId = useMemo(() => lastHandResult?.netByPlayerId ?? {}, [lastHandResult]);
  const hasNetByPlayerId = Object.keys(netByPlayerId).length > 0;
  const myHandNetChange = useMemo(() => {
    if (!player?.id || !lastHandResult || !hasNetByPlayerId) return null;
    if (!Object.prototype.hasOwnProperty.call(netByPlayerId, player.id)) {
      return null;
    }
    const netFromResult = netByPlayerId[player.id];
    if (typeof netFromResult === "number") {
      return netFromResult;
    }
    return null;
  }, [hasNetByPlayerId, lastHandResult, netByPlayerId, player?.id]);

  const handResultRows = useMemo(() => {
    if (!lastHandResult) return [];
    const rows = lastHandResult.playerHands.map((entry, idx) => ({
      ...entry,
      sourceOrder: idx,
      amountWon: winnersByPlayerId.get(entry.playerId)?.amountWon ?? 0,
      netChange:
        hasNetByPlayerId && Object.prototype.hasOwnProperty.call(netByPlayerId, entry.playerId)
          ? netByPlayerId[entry.playerId]
          : null,
      isWinner: winnersByPlayerId.has(entry.playerId),
    }));

    rows.sort((left, right) => {
      const leftSortBucket = left.isWinner ? 0 : left.cardsVisibility === "shown" ? 1 : 2;
      const rightSortBucket = right.isWinner ? 0 : right.cardsVisibility === "shown" ? 1 : 2;
      if (leftSortBucket !== rightSortBucket) {
        return leftSortBucket - rightSortBucket;
      }

      if (right.amountWon !== left.amountWon) {
        return right.amountWon - left.amountWon;
      }

      const leftNet = typeof left.netChange === "number" ? left.netChange : null;
      const rightNet = typeof right.netChange === "number" ? right.netChange : null;
      if (leftNet !== null && rightNet !== null && rightNet !== leftNet) {
        return rightNet - leftNet;
      }

      const leftSeatPosition =
        typeof left.seatPosition === "number" ? left.seatPosition : Number.MAX_SAFE_INTEGER;
      const rightSeatPosition =
        typeof right.seatPosition === "number" ? right.seatPosition : Number.MAX_SAFE_INTEGER;
      if (leftSeatPosition !== rightSeatPosition) {
        return leftSeatPosition - rightSeatPosition;
      }

      return left.sourceOrder - right.sourceOrder;
    });

    return rows.map((entry, idx) => {
      const { sourceOrder, ...rest } = entry;
      void sourceOrder;
      return {
        ...rest,
        rankOrder: idx + 1,
      };
    });
  }, [hasNetByPlayerId, lastHandResult, netByPlayerId, winnersByPlayerId]);

  const handleReadyFromHandResultsModal = useCallback(() => {
    if (!canReadyNextHand || hasReadiedCurrentPhase) {
      return;
    }

    markReady();
    closePrimaryModal("handResults");
  }, [canReadyNextHand, closePrimaryModal, hasReadiedCurrentPhase, markReady]);

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
    return normalizeOrbitCapacity(room.config.maxPlayers);
  }, [room]);

  const seatSlotWidth = useMemo(
    () => getSeatSlotWidth({ occupiedSeats: tablePlayers.length }),
    [tablePlayers.length],
  );
  const seatSlotWidthPx = useMemo(() => {
    if (typeof window === "undefined") {
      return 0;
    }

    const rootFontSize =
      Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const viewportWidth = Math.max(window.innerWidth, feltSize.width);
    return resolveSeatSlotWidthPixels({
      seatSlotWidth,
      rootFontSize,
      viewportWidth,
    });
  }, [seatSlotWidth, feltSize.width]);
  const seatSlotHeightPx = seatSlotWidthPx / SEAT_POD_WIDTH_TO_HEIGHT_RATIO;

  const tableCornerRadiusPx = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        cornerRadiusX: 0,
        cornerRadiusY: 0,
      };
    }

    const feltNode = feltOvalRef.current;
    if (!feltNode || feltSize.width <= 0 || feltSize.height <= 0) {
      return {
        cornerRadiusX: 0.42 * feltSize.width,
        cornerRadiusY: 0.26 * feltSize.height,
      };
    }

    const borderRadiusValue = window.getComputedStyle(feltNode).borderRadius;
    return resolveCornerRadiusPixels({
      borderRadiusValue,
      tableWidth: feltSize.width,
      tableHeight: feltSize.height,
    });
  }, [feltSize.height, feltSize.width]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const feltNode = feltOvalRef.current;
    if (!feltNode) {
      return undefined;
    }

    const updateFeltSize = () => {
      const nextWidth = Math.ceil(feltNode.getBoundingClientRect().width);
      const nextHeight = Math.ceil(feltNode.getBoundingClientRect().height);

      setFeltSize((previous) => {
        if (previous.width === nextWidth && previous.height === nextHeight) {
          return previous;
        }
        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    updateFeltSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFeltSize);
      return () => {
        window.removeEventListener("resize", updateFeltSize);
      };
    }

    const resizeObserver = new ResizeObserver(updateFeltSize);
    resizeObserver.observe(feltNode);
    window.addEventListener("resize", updateFeltSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateFeltSize);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const feltNode = feltOvalRef.current;
    const communityNode = communityLaneRef.current;
    const potNode = potDropZoneRef.current;

    if (!feltNode || !communityNode || !potNode) {
      setTableObstacleRects((previous) => (previous.length > 0 ? [] : previous));
      return undefined;
    }

    let frameHandle = 0;
    const scheduleRectRefresh = () => {
      if (frameHandle) {
        window.cancelAnimationFrame(frameHandle);
      }

      frameHandle = window.requestAnimationFrame(() => {
        const nextObstacleRects = resolveObstacleRectsWithinTable({
          feltNode,
          obstacleNodes: [communityNode, potNode],
          paddingPx: SEAT_CENTER_EXCLUSION_PADDING_PX,
        });
        setTableObstacleRects((previous) =>
          areRectBoundSetsEqual(previous, nextObstacleRects) ? previous : nextObstacleRects,
        );
      });
    };

    scheduleRectRefresh();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleRectRefresh);
      return () => {
        if (frameHandle) {
          window.cancelAnimationFrame(frameHandle);
        }
        window.removeEventListener("resize", scheduleRectRefresh);
      };
    }

    const resizeObserver = new ResizeObserver(scheduleRectRefresh);
    resizeObserver.observe(feltNode);
    resizeObserver.observe(communityNode);
    resizeObserver.observe(potNode);
    window.addEventListener("resize", scheduleRectRefresh);

    return () => {
      if (frameHandle) {
        window.cancelAnimationFrame(frameHandle);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleRectRefresh);
    };
  }, [feltSize.height, feltSize.width]);

  const playerRankings = useMemo(
    () => {
      if (!room) return [];
      return [...room.players]
        .filter((rankedPlayer) => shouldDisplayLiveRankingPlayer(rankedPlayer))
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
          if (b.net !== a.net) return b.net - a.net;
          if (b.tableStack !== a.tableStack) return b.tableStack - a.tableStack;
          return a.name.localeCompare(b.name, locale === "zh_hans" ? "zh-Hans" : "en");
        });
    },
    [locale, room],
  );

  const finalStandings = useMemo(
    () =>
      [...(finalGameResult?.standings ?? [])]
        .sort((a, b) => {
          if (b.profit !== a.profit) return b.profit - a.profit;
          if (b.finalChips !== a.finalChips) return b.finalChips - a.finalChips;
          return a.playerName.localeCompare(b.playerName, locale === "zh_hans" ? "zh-Hans" : "en");
        })
        .map((entry, idx) => ({
          ...entry,
          rankOrder: idx + 1,
        })),
    [finalGameResult, locale],
  );
  const isShortDeckRules = Boolean(room?.config.useShortDeckRules);
  const rulesVariant: RuleVariant = isShortDeckRules ? "shortDeck" : "standard";
  const rulesCopy = useMemo(
    () => RULES_COPY_BY_VARIANT[rulesVariant][locale],
    [locale, rulesVariant],
  );
  const ruleVariantLabel = useMemo(
    () =>
      isShortDeckRules
        ? t("game.ruleVariant.shortDeck")
        : t("game.ruleVariant.standard"),
    [isShortDeckRules, t],
  );

  const finalSummaryCards = useMemo(() => {
    if (!finalGameResult) return [];

    const summary = finalGameResult.summary;
    return [
      {
        key: "hands",
        label: t("game.final.summary.handsPlayed"),
        value: String(summary.handsPlayed),
      },
      {
        key: "players",
        label: t("game.final.summary.totalPlayers"),
        value: String(summary.totalPlayers),
      },
      {
        key: "profitable",
        label: t("game.final.summary.profitablePlayers"),
        value: t("game.final.summary.profitablePlayersValue", {
          profitable: summary.profitablePlayers,
          total: summary.totalPlayers,
        }),
      },
      {
        key: "avgStack",
        label: t("game.final.summary.averageStack"),
        value: `$${summary.averageFinalStack}`,
      },
      {
        key: "totalBuyIn",
        label: t("game.final.summary.totalBuyIn"),
        value: `$${summary.totalBuyIn}`,
      },
      {
        key: "chips",
        label: t("game.final.summary.totalChips"),
        value: `$${summary.totalChipsInPlay}`,
      },
    ];
  }, [finalGameResult, t]);
  const hasRoom = Boolean(room);
  const playerSeatPosition = player?.position;

  const seatSlots = useMemo(() => {
    if (!hasRoom || playerSeatPosition === undefined) return [] as Array<{
      slotIndex: number;
      position: number;
      seatPlayer: Player;
      anchor: SeatAnchor;
    }>;
    const myPosition = currentPlayer?.position ?? playerSeatPosition;
    const orderedPlayers = [...tablePlayers].sort((a, b) => {
      const aOffset = (a.position - myPosition + orbitCapacity) % orbitCapacity;
      const bOffset = (b.position - myPosition + orbitCapacity) % orbitCapacity;
      return aOffset - bOffset;
    });

    const orbitAnchors = getOrbitAnchors({
      totalSeats: orderedPlayers.length,
      tableWidth: feltSize.width,
      tableHeight: feltSize.height,
      tableCornerRadiusX: tableCornerRadiusPx.cornerRadiusX,
      tableCornerRadiusY: tableCornerRadiusPx.cornerRadiusY,
      seatWidth: seatSlotWidthPx,
      seatHeight: seatSlotHeightPx,
      obstacleRects: tableObstacleRects,
    });

    return orderedPlayers.map((seatPlayer, slotIndex) => ({
      slotIndex,
      position: seatPlayer.position,
      seatPlayer,
      anchor: orbitAnchors[slotIndex] ?? getFallbackOrbitAnchor(slotIndex, orderedPlayers.length),
    }));
  }, [
    hasRoom,
    playerSeatPosition,
    currentPlayer?.position,
    feltSize.height,
    feltSize.width,
    orbitCapacity,
    seatSlotHeightPx,
    seatSlotWidthPx,
    tableObstacleRects,
    tablePlayers,
    tableCornerRadiusPx.cornerRadiusX,
    tableCornerRadiusPx.cornerRadiusY,
  ]);

  const communitySlots = Array.from(
    { length: 5 },
    (_, idx) => currentHand?.communityCards[idx] ?? null,
  );
  const liveAudioParticipantByPlayerId = useMemo(
    () =>
      new Map(
        liveAudioParticipants
          .filter((participant) => participant.playerId)
          .map((participant) => [participant.playerId as string, participant]),
      ),
    [liveAudioParticipants],
  );
  const seatOrbitItems = useMemo(
    () =>
      seatSlots.map((slot) => {
        const seatPlayer = slot.seatPlayer;
        const roleIcon = getSeatRoleIcon(
          slot.position,
          currentHand
            ? {
                dealerPosition: currentHand.dealerPosition,
                smallBlindPosition: currentHand.smallBlindPosition,
              }
            : undefined,
        );

        const seatPlayerId = seatPlayer.id;
        const seatPositionLabel =
          currentHand?.positionLabelsByPlayerId?.[seatPlayerId] ?? null;
        const seatBadge = buildSeatBadge(roleIcon, seatPositionLabel);
        const seatLiveAudioBadge = buildSeatLiveAudioBadge(
          liveAudioParticipantByPlayerId.get(seatPlayerId) ?? null,
          {
            speaking: t("game.audio.badge.speaking"),
            onMic: t("game.audio.badge.onMic"),
            muted: t("game.audio.badge.muted"),
          },
        );
        const isCurrentTurnSeat = currentHand?.currentPlayerTurn === seatPlayerId;
        const isSelfSeat = seatPlayer.id === resolvedPlayerId;
        const isFolded = seatPlayer.status === "folded";
        const isAllIn = seatPlayer.status === "all-in";
        const isDisconnected =
          getConnectionStatus(seatPlayer) === "disconnected";
        const isWaiting = seatPlayer.status === "waiting";
        const seatMainState = resolveSeatMainState({
          isCurrentTurnSeat,
          isDisconnected,
          isAllIn,
          isFolded,
          isWaiting,
        });
        const seatInlineStatusLabel =
          seatMainState === "all-in"
              ? t("game.status.allIn")
              : seatMainState === "folded"
                ? t("game.status.folded")
                : seatMainState === "disconnected"
                  ? t("game.status.disconnected")
                : null;
        const seatExternalStatusLabel =
          isDisconnected && seatMainState !== "disconnected"
            ? t("game.status.disconnected")
            : seatMainState === "turn"
            ? t("game.status.acting")
            : seatMainState === "waiting"
              ? t("game.status.waiting")
              : null;
        const seatExternalStatusToneClass =
          isDisconnected && seatMainState !== "disconnected"
            ? "seat-pod__status-badge--disconnected"
            : seatMainState === "turn"
            ? "seat-pod__status-badge--turn"
            : seatMainState === "waiting"
              ? "seat-pod__status-badge--waiting"
              : "";
        const seatInlineStatusToneClass =
          seatMainState === "folded"
            ? "seat-pod__status-badge--folded"
            : seatMainState === "disconnected"
              ? "seat-pod__status-badge--disconnected"
              : seatMainState === "all-in"
                ? "seat-pod__status-badge--allin"
                : "";
        const isForcedBlind = Boolean(
          currentHand?.bettingRound === "PRE_FLOP" &&
            seatPlayer.currentBet > 0 &&
            seatPlayer.lastAction === null &&
            (seatPlayer.position === currentHand.smallBlindPosition ||
              seatPlayer.position === currentHand.bigBlindPosition),
        );
        const latestSeatActionEvent =
          lastPlayerActionEvent?.playerId === seatPlayer.id ? lastPlayerActionEvent : null;
        const seatPrimaryActionLabel = resolveSeatPrimaryActionLabel({
          seatPlayer,
          isDisconnected,
          isForcedBlind,
          latestSeatActionEvent,
          t,
        });
        const seatPendingActionLabel = resolveSeatPendingActionLabel({
          seatPlayer,
          isDisconnected,
          isCurrentTurnSeat,
          t,
        });
        const seatActionLabel = seatPrimaryActionLabel ?? seatPendingActionLabel;
        const seatDensityClass = getSeatDensityClass({
          seatSlotWidthPx,
          occupiedSeatCount: seatSlots.length,
        });
        const showReadyOverlay = shouldShowSeatReadyOverlay && !isDisconnected;
        const seatIsReady = showReadyOverlay && readyPlayerIdSet.has(seatPlayer.id);

        return {
          slotIndex: slot.slotIndex,
          top: slot.anchor.top,
          left: slot.anchor.left,
          width: seatSlotWidth,
          playerId: seatPlayer.id,
          playerEmoji: seatPlayer.emoji || "🎲",
          playerName: seatPlayer.name,
          isYou: isSelfSeat,
          badge: seatBadge,
          liveAudioBadge: seatLiveAudioBadge,
          externalStatusLabel: seatExternalStatusLabel,
          externalStatusToneClass: seatExternalStatusToneClass,
          internalStatusLabel: seatInlineStatusLabel,
          internalStatusToneClass: seatInlineStatusToneClass,
          actionLabel: seatActionLabel,
          remainingLabel: `$${seatPlayer.chips}`,
          seatState: seatMainState,
          densityClass: seatDensityClass,
          readyOverlayLabel: showReadyOverlay && seatIsReady ? t("game.ready.readyBadge") : null,
        };
      }),
    [
      currentHand,
      lastPlayerActionEvent,
      resolvedPlayerId,
      liveAudioParticipantByPlayerId,
      seatSlotWidth,
      seatSlotWidthPx,
      seatSlots,
      readyPlayerIdSet,
      shouldShowSeatReadyOverlay,
      t,
    ],
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
    return buildTurnActionPresetButtons({
      callAmount,
      minRaise,
      maxStack,
      displayPot,
      isYourTurn,
      t,
    });
  }, [callAmount, displayPot, isYourTurn, maxStack, minRaise, t]);

  const isAutomationMode =
    typeof window !== "undefined" && Boolean(window.navigator.webdriver);
  const desktopTraySubmitIntent =
    !isAutomationMode &&
    isDesktopSideDock &&
    dropResolution.intent &&
    dropResolution.intent.action !== "call"
      ? dropResolution.intent
      : null;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateDockMode = () => {
      const nextIsDesktop = window.matchMedia(DESKTOP_SIDE_DOCK_QUERY).matches;
      const nextIsCompactMobile = window.matchMedia(COMPACT_MOBILE_DOCK_QUERY).matches;
      setIsDesktopSideDock((prev) => (prev === nextIsDesktop ? prev : nextIsDesktop));
      setIsCompactMobileDock((prev) =>
        prev === nextIsCompactMobile ? prev : nextIsCompactMobile,
      );
    };

    updateDockMode();
    window.addEventListener("resize", updateDockMode);

    return () => window.removeEventListener("resize", updateDockMode);
  }, []);

  useEffect(() => {
    if (!isDesktopSideDock) {
      if (chatForcedByDesktopRef.current && isChatPanelOpen) {
        chatForcedByDesktopRef.current = false;
        setChatPanelOpen(false);
      }
      return;
    }

    if (!isChatPanelOpen) {
      chatForcedByDesktopRef.current = true;
      setChatPanelOpen(true);
    }
  }, [isChatPanelOpen, isDesktopSideDock, setChatPanelOpen]);

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
    const boardStageNode = boardStageRef.current;
    if (!seatNode || !alertNode || (isDesktopSideDock && !boardStageNode)) {
      setActionPointerVector(null);
      return;
    }

    const seatRect = seatNode.getBoundingClientRect();
    const alertRect = alertNode.getBoundingClientRect();
    const boardStageRect = boardStageNode?.getBoundingClientRect() ?? null;

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
      x: isDesktopSideDock && boardStageRect ? startX - boardStageRect.left : startX,
      y: isDesktopSideDock && boardStageRect ? startY - boardStageRect.top : startY,
      angle,
      length: lineLength,
    });
  }, [actionCenterAlert, isDesktopSideDock]);

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
    setHandReviewUnavailableSummary(null);
    setIsOpeningHandReview(false);
  }, [currentHandNumber, showHandResultsModal]);

  useEffect(() => {
    if (!lastHandResult) {
      lastDisplayedHandResultRef.current = null;
      closePrimaryModal("handResults");
      return;
    }

    if (lastDisplayedHandResultRef.current === lastHandResult) {
      return;
    }

    lastDisplayedHandResultRef.current = lastHandResult;
    openPrimaryModal("handResults");
  }, [closePrimaryModal, lastHandResult, openPrimaryModal]);

  useEffect(() => {
    if (!lastHandResult) {
      return;
    }

    setIsCardsFlyoutOpen(false);
  }, [lastHandResult, setIsCardsFlyoutOpen]);

  useEffect(() => {
    setLegacyRaiseAmount((prev) => {
      if (prev <= 0) return 0;
      return Math.min(prev, maxStack);
    });
  }, [maxStack]);

  const updateDragState = useCallback((nextState: DragState) => {
    dragStateRef.current = nextState;
    setDragState(nextState);
  }, []);

  const clearDragState = useCallback((pointerId?: number | null) => {
    const dragActivatorNode = dragActivatorRef.current;
    if (
      dragActivatorNode &&
      pointerId !== null &&
      pointerId !== undefined &&
      dragActivatorNode.hasPointerCapture(pointerId)
    ) {
      dragActivatorNode.releasePointerCapture(pointerId);
    }

    dragActivatorRef.current = null;
    updateDragState(EMPTY_DRAG_STATE);
  }, [updateDragState]);

  const resetTurnInteractionState = useCallback(() => {
    setTrayAmount(0);
    setTrayInputValue("0");
    setMobileChipDraftValue("0");
    setShowMobileChipPopover(false);
    setQuickConfirmAction(null);
    setShowTrayConfirm(false);
    clearDragState(dragStateRef.current.pointerId);
  }, [clearDragState]);

  useEffect(() => {
    if (!showTurnActionDock) {
      resetTurnInteractionState();
    }
  }, [resetTurnInteractionState, showTurnActionDock]);

  useEffect(() => {
    if (!shouldAnchorCardsFlyoutToBottomBar) {
      setBottomBarHeight(0);
      return;
    }

    const overlayNode = bottomBarOverlayRef.current;
    if (!overlayNode) {
      return;
    }

    const updateOverlayHeight = () => {
      const nextHeight = Math.ceil(overlayNode.getBoundingClientRect().height);
      setBottomBarHeight((prev) => (prev === nextHeight ? prev : nextHeight));
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
  }, [activeBottomBarMode, shouldAnchorCardsFlyoutToBottomBar]);

  useEffect(() => {
    if (isDesktopSideDock || !shouldRenderCardsInBoardStage) {
      setCardsFlyoutHeight(0);
      return;
    }

    const cardsFlyoutNode = mobileCardsFlyoutRef.current;
    if (!cardsFlyoutNode) {
      return;
    }

    const updateCardsFlyoutHeight = () => {
      const nextHeight = Math.ceil(cardsFlyoutNode.getBoundingClientRect().height);
      setCardsFlyoutHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    };

    updateCardsFlyoutHeight();
    window.addEventListener("resize", updateCardsFlyoutHeight);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", updateCardsFlyoutHeight);
    }

    const resizeObserver = new ResizeObserver(updateCardsFlyoutHeight);
    resizeObserver.observe(cardsFlyoutNode);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateCardsFlyoutHeight);
    };
  }, [isCardsFlyoutOpen, isDesktopSideDock, shouldRenderCardsInBoardStage]);

  useEffect(() => {
    setTrayInputValue(String(trayAmount));
  }, [trayAmount]);

  useEffect(() => {
    if (showMobileChipPopover) {
      return;
    }

    setMobileChipDraftValue(String(trayAmount));
  }, [showMobileChipPopover, trayAmount]);

  useEffect(() => {
    if (!isDesktopSideDock) {
      return;
    }

    setShowMobileChipPopover(false);
    setMobileChipDraftValue(String(trayAmount));
  }, [isDesktopSideDock, trayAmount]);

  useEffect(() => {
    if (!showTrayConfirm || desktopTraySubmitIntent) {
      return;
    }

    setShowTrayConfirm(false);
  }, [desktopTraySubmitIntent, showTrayConfirm]);

  useEffect(() => {
    animatedPotRef.current = animatedPotValue;
  }, [animatedPotValue]);

  const runPotAnimationToDisplayPot = useCallback(() => {
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
    runPotAnimationToDisplayPot();
  }, [runPotAnimationToDisplayPot]);

  useEffect(() => {
    if (turnAlertTimeoutRef.current) {
      window.clearTimeout(turnAlertTimeoutRef.current);
      turnAlertTimeoutRef.current = null;
    }

    previousIsYourTurnRef.current = null;
    setTurnAlertToken(null);
  }, [room?.id, currentHandNumber]);

  useEffect(() => {
    if (!finalGameResult) return;
    closePrimaryModal("handResults");
    closeConfirmModal();
    openPrimaryModal("finalSummary");
  }, [closeConfirmModal, closePrimaryModal, finalGameResult, openPrimaryModal]);

  useEffect(() => {
    if (!isGameEnded || !finalGameResult) return;
    closePrimaryModal("handResults");
    openPrimaryModal("finalSummary");
  }, [closePrimaryModal, finalGameResult, isGameEnded, openPrimaryModal]);

  useEffect(() => {
    if (!shouldPreemptInformationalModals) {
      return;
    }

    if (showRankingsModal) {
      closePrimaryModal("rankings");
      return;
    }

    if (showRulesModal) {
      closePrimaryModal("rules");
      return;
    }

    if (showSettingsModal) {
      closePrimaryModal("settings");
    }
  }, [
    closePrimaryModal,
    shouldPreemptInformationalModals,
    showRankingsModal,
    showRulesModal,
    showSettingsModal,
  ]);

  useEffect(() => {
    previousIsYourTurnRef.current = applyTurnNotificationTransition({
      previousIsYourTurn: previousIsYourTurnRef.current,
      isYourTurn,
      onTurnStart: () => {
        triggerTurnAlert();
        void playTurnNotification();
      },
    });
  }, [isYourTurn, triggerTurnAlert]);

  const syncActionCenterAlertWithLatestAction = useCallback(() => {
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
    syncActionCenterAlertWithLatestAction();
  }, [syncActionCenterAlertWithLatestAction]);

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

  const dismissTransientOverlays = useCallback(() => {
    if (showLeaveConfirmModal) {
      closeConfirmModal("leaveConfirm");
      return;
    }
    if (lastError) clearError();
    if (showRankingsModal) closePrimaryModal("rankings");
    if (showRulesModal) closePrimaryModal("rules");
    if (showSettingsModal) closePrimaryModal("settings");
    if (showLiveAudioPopover) setShowLiveAudioPopover(false);
    if (showEndGameConfirmModal) closeConfirmModal("endGameConfirm");
    if (showHandResultsModal) closePrimaryModal("handResults");
    if (showFinalSummaryModal && !isGameEnded) closePrimaryModal("finalSummary");
    if (showMobileChipPopover) closeMobileChipPopover();
    if (quickConfirmAction) setQuickConfirmAction(null);
    if (showTrayConfirm) setShowTrayConfirm(false);
  }, [
    clearError,
    closeConfirmModal,
    closeMobileChipPopover,
    closePrimaryModal,
    isGameEnded,
    lastError,
    quickConfirmAction,
    showMobileChipPopover,
    showTrayConfirm,
    showHandResultsModal,
    showLeaveConfirmModal,
    showEndGameConfirmModal,
    showFinalSummaryModal,
    showRankingsModal,
    showRulesModal,
    showSettingsModal,
    showLiveAudioPopover,
  ]);

  useEffect(() => {
    if (
      !lastError &&
      !showRankingsModal &&
      !showRulesModal &&
      !showSettingsModal &&
      !showLiveAudioPopover &&
      !showLeaveConfirmModal &&
      !showEndGameConfirmModal &&
      !showHandResultsModal &&
      !showFinalSummaryModal &&
      !showMobileChipPopover &&
      !quickConfirmAction &&
      !showTrayConfirm
    ) {
      return;
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissTransientOverlays();
    };

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [
    dismissTransientOverlays,
    lastError,
    showLeaveConfirmModal,
    showEndGameConfirmModal,
    showHandResultsModal,
    showFinalSummaryModal,
    showMobileChipPopover,
    showRankingsModal,
    showRulesModal,
    showSettingsModal,
    showLiveAudioPopover,
    showTrayConfirm,
  ]);

  const closeLiveAudioPopover = useCallback(() => {
    if (hasLiveAudioReconnectPrompt) {
      dismissReconnectPrompt();
    }
    setShowLiveAudioPopover(false);
  }, [dismissReconnectPrompt, hasLiveAudioReconnectPrompt]);

  useEffect(() => {
    if (!hasLiveAudioReconnectPrompt) {
      return;
    }

    setShowLiveAudioPopover(true);
  }, [hasLiveAudioReconnectPrompt]);

  const handleToggleLiveAudioPopover = useCallback(() => {
    if (showLiveAudioPopover) {
      closeLiveAudioPopover();
      return;
    }

    setShowLiveAudioPopover(true);
  }, [closeLiveAudioPopover, showLiveAudioPopover]);

  const handleJoinLiveAudio = useCallback(() => {
    void joinAudio()
      .then(() => {
        setShowLiveAudioPopover(false);
      })
      .catch(() => undefined);
  }, [joinAudio]);

  const handleReconnectLiveAudio = useCallback(() => {
    void reconnectAudio()
      .then(() => {
        setShowLiveAudioPopover(false);
      })
      .catch(() => undefined);
  }, [reconnectAudio]);

  const handleDismissLiveAudioReconnectPrompt = useCallback(() => {
    dismissReconnectPrompt();
    setShowLiveAudioPopover(false);
  }, [dismissReconnectPrompt]);

  const handleLeaveLiveAudio = useCallback(() => {
    void leaveAudio()
      .then(() => {
        setShowLiveAudioPopover(false);
      })
      .catch(() => undefined);
  }, [leaveAudio]);

  const handleMuteLiveAudio = useCallback(() => {
    void muteAudio()
      .then(() => {
        setShowLiveAudioPopover(false);
      })
      .catch(() => undefined);
  }, [muteAudio]);

  const handleUnmuteLiveAudio = useCallback(() => {
    void unmuteAudio()
      .then(() => {
        setShowLiveAudioPopover(false);
      })
      .catch(() => undefined);
  }, [unmuteAudio]);

  const isPointInDropZone = useCallback((clientX: number, clientY: number) => {
    const dropZone = potDropZoneRef.current;
    if (!dropZone) return false;

    const rect = dropZone.getBoundingClientRect();
    const hoveredNode = document.elementFromPoint(clientX, clientY);
    const isHoveringDropZone =
      hoveredNode instanceof Element &&
      Boolean(hoveredNode.closest('[data-testid="pot-drop-zone"]'));
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = Math.max(rect.width, rect.height) / 2 + DRAG_SNAP_RADIUS_PX;
    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    const isWithinExpandedRect =
      clientX >= rect.left - DRAG_DROP_ZONE_RECT_MARGIN_PX &&
      clientX <= rect.right + DRAG_DROP_ZONE_RECT_MARGIN_PX &&
      clientY >= rect.top - DRAG_DROP_ZONE_RECT_MARGIN_PX &&
      clientY <= rect.bottom + DRAG_DROP_ZONE_RECT_MARGIN_PX;

    return (
      isHoveringDropZone ||
      isWithinExpandedRect ||
      deltaX * deltaX + deltaY * deltaY <= radius * radius
    );
  }, []);

  const commitTrayDrop = useCallback(() => {
    if (!isYourTurn) {
      return;
    }

    if (!dropResolution.intent) {
      return;
    }

    setQuickConfirmAction(null);
    setShowTrayConfirm(false);
    performAction(dropResolution.intent.action, dropResolution.intent.amount);
    setTrayAmount(0);
  }, [dropResolution.intent, isYourTurn, performAction]);

  const updateDragPointer = useCallback((pointerId: number, clientX: number, clientY: number) => {
    const currentDragState = dragStateRef.current;
    if (!currentDragState.active || currentDragState.pointerId !== pointerId) {
      return;
    }

    const nextOverDropZone = isPointInDropZone(clientX, clientY);
    if (
      currentDragState.clientX === clientX &&
      currentDragState.clientY === clientY &&
      currentDragState.overDropZone === nextOverDropZone
    ) {
      return;
    }

    updateDragState({
      ...currentDragState,
      clientX,
      clientY,
      overDropZone: nextOverDropZone,
    });
  }, [isPointInDropZone, updateDragState]);

  const finishDragPointer = useCallback(({
    pointerId,
    clientX,
    clientY,
    cancelled,
  }: {
    pointerId: number;
    clientX: number;
    clientY: number;
    cancelled: boolean;
  }) => {
    const currentDragState = dragStateRef.current;
    if (!currentDragState.active || currentDragState.pointerId !== pointerId) {
      return;
    }

    const shouldCommit =
      !cancelled &&
      (currentDragState.overDropZone || isPointInDropZone(clientX, clientY));

    clearDragState(pointerId);

    if (shouldCommit) {
      commitTrayDrop();
    }
  }, [clearDragState, commitTrayDrop, isPointInDropZone]);

  useEffect(() => {
    if (!dragState.active || dragState.pointerId === null) {
      return;
    }

    const handleWindowPointerMove = (event: PointerEvent) => {
      updateDragPointer(event.pointerId, event.clientX, event.clientY);
    };
    const handleWindowPointerUp = (event: PointerEvent) => {
      finishDragPointer({
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        cancelled: false,
      });
    };
    const handleWindowPointerCancel = (event: PointerEvent) => {
      finishDragPointer({
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        cancelled: true,
      });
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp, true);
    window.addEventListener("pointercancel", handleWindowPointerCancel, true);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp, true);
      window.removeEventListener("pointercancel", handleWindowPointerCancel, true);
    };
  }, [dragState.active, dragState.pointerId, finishDragPointer, updateDragPointer]);

  const requestTraySubmit = useCallback(() => {
    if (!desktopTraySubmitIntent) {
      return;
    }

    setShowMobileChipPopover(false);
    setQuickConfirmAction(null);
    setShowTrayConfirm(true);
  }, [desktopTraySubmitIntent]);

  const acceptTraySubmit = useCallback(() => {
    if (!desktopTraySubmitIntent) {
      return;
    }

    setShowTrayConfirm(false);
    setShowMobileChipPopover(false);
    performAction(desktopTraySubmitIntent.action, desktopTraySubmitIntent.amount);
    setTrayAmount(0);
  }, [desktopTraySubmitIntent, performAction]);

  const setTrayDirectly = (nextAmount: number) => {
    if (!isYourTurn) return;

    const normalized = normalizeTrayAmount(nextAmount);
    setTrayAmount(normalized);
  };

  const clearTray = () => {
    if (!isYourTurn) return;
    setTrayAmount(0);
  };

  function normalizeMobileChipDraft(value: string) {
    const numericText = value.replace(/\D/g, "");
    const trimmed = numericText.replace(/^0+(?=\d)/, "");
    return trimmed || "0";
  }

  function commitTrayAmountText(value: string) {
    const numericText = value.replace(/\D/g, "");
    if (!numericText) {
      setTrayInputValue("0");
      setTrayAmount(0);
      return 0;
    }

    const parsed = Number(numericText);
    if (Number.isNaN(parsed)) {
      return trayAmount;
    }

    const clamped = clampTrayAmount(parsed);
    setTrayInputValue(String(clamped));
    setTrayAmount(clamped);
    return clamped;
  }

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

  function openMobileChipPopover() {
    if (!isYourTurn || isDesktopSideDock) {
      return;
    }

    setQuickConfirmAction(null);
    setShowTrayConfirm(false);
    setMobileChipDraftValue(normalizeMobileChipDraft(String(trayAmount)));
    setShowMobileChipPopover(true);
  }

  function closeMobileChipPopover() {
    setShowMobileChipPopover(false);
    setMobileChipDraftValue(String(trayAmount));
  }

  function handleMobileChipDigit(digit: string) {
    if (!showMobileChipPopover) {
      return;
    }

    setMobileChipDraftValue((prev) => {
      const nextValue = prev === "0" ? digit : `${prev}${digit}`;
      return normalizeMobileChipDraft(nextValue);
    });
  }

  function handleMobileChipBackspace() {
    if (!showMobileChipPopover) {
      return;
    }

    setMobileChipDraftValue((prev) => (prev.length <= 1 ? "0" : prev.slice(0, -1)));
  }

  function handleMobileChipClearDraft() {
    if (!showMobileChipPopover) {
      return;
    }

    setMobileChipDraftValue("0");
  }

  function handleMobileChipConfirm() {
    if (!showMobileChipPopover) {
      return;
    }

    const committedAmount = commitTrayAmountText(mobileChipDraftValue);
    setMobileChipDraftValue(String(committedAmount));
    setShowMobileChipPopover(false);
  }

  const handleDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!canStartDrag) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragActivatorRef.current = event.currentTarget;

    updateDragState({
      active: true,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      overDropZone: isPointInDropZone(event.clientX, event.clientY),
    });
  };

  const handleDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    updateDragPointer(event.pointerId, event.clientX, event.clientY);
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    finishDragPointer({
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      cancelled: event.type === "pointercancel",
    });
  };

  const handleCopyInviteLink = async () => {
    if (!inviteUrl) return;

    try {
      if (!(await writeTextToClipboard(inviteUrl))) {
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

  const saveShareablePanelScreenshot = async ({
    panel,
    hiddenControlTestIds,
    fileSuffix,
    successMessageKey,
    failureMessageKey,
  }: {
    panel: HTMLElement;
    hiddenControlTestIds: string[];
    fileSuffix: string;
    successMessageKey: MessageKey;
    failureMessageKey: MessageKey;
  }) => {
    if (!room) return;

    try {
      const hiddenControlTestIdSet = new Set(hiddenControlTestIds);
      const screenshotDataUrl = await toPng(panel, {
        cacheBust: true,
        pixelRatio: Math.max(2, Math.min(3, window.devicePixelRatio || 2)),
        backgroundColor: "#032b26",
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          return !hiddenControlTestIdSet.has(node.dataset.testid ?? "");
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
      link.download = `${room.id}-${fileSuffix}-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(imageUrl);

      setInviteCopyStatus(t(successMessageKey));
      setInviteCopyStatusTone("success");
    } catch (error) {
      console.error("Failed to save screenshot:", error);
      setInviteCopyStatus(t(failureMessageKey));
      setInviteCopyStatusTone("error");
    }
  };

  const handleSaveResultScreenshot = async () => {
    if (!lastHandResult || !handResultsPanelRef.current) return;

    await saveShareablePanelScreenshot({
      panel: handResultsPanelRef.current,
      hiddenControlTestIds: [
        "export-hand-history-button",
        "open-hand-review-button",
        "save-result-screenshot-button",
        "close-hand-results-button",
      ],
      fileSuffix: `hand-${currentHandNumber ?? "result"}`,
      successMessageKey: "game.resultScreenshotSaved",
      failureMessageKey: "game.resultScreenshotFailed",
    });
  };

  const handleSaveFinalSummaryScreenshot = async () => {
    if (!finalGameResult || !finalSummaryPanelRef.current) return;

    await saveShareablePanelScreenshot({
      panel: finalSummaryPanelRef.current,
      hiddenControlTestIds: [
        "export-game-history-button",
        "open-saved-history-button",
        "save-final-summary-screenshot-button",
      ],
      fileSuffix: "final-results",
      successMessageKey: "game.final.screenshotSaved",
      failureMessageKey: "game.final.screenshotFailed",
    });
  };

  const downloadJsonExport = (
    payload: CompletedHandHistoryExport | CompletedGameHistoryExport,
    fileName: string,
  ) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    const downloadUrl = URL.createObjectURL(blob);
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  };

  const handleExportHandHistory = async () => {
    if (!room || currentHandNumber === null || isExportingHandHistory) {
      return;
    }

    setIsExportingHandHistory(true);
    try {
      const exportPayload = await handHistoryService.getCompletedHandHistory(
        room.id,
        currentHandNumber,
      );
      downloadJsonExport(
        exportPayload,
        `${room.id}-hand-${currentHandNumber}-history.json`,
      );
      setInviteCopyStatus(t("game.handHistoryExportSaved"));
      setInviteCopyStatusTone("success");
    } catch (error) {
      console.error("Failed to export hand history:", error);
      setInviteCopyStatus(t("game.handHistoryExportFailed"));
      setInviteCopyStatusTone("error");
    } finally {
      setIsExportingHandHistory(false);
    }
  };

  const handleOpenHandReview = async () => {
    if (!room || currentHandNumber === null || isOpeningHandReview) {
      return;
    }

    setIsOpeningHandReview(true);
    setHandReviewUnavailableSummary(null);
    try {
      const exportPayload = await handHistoryService.getCompletedHandHistory(
        room.id,
        currentHandNumber,
      );
      setHandReviewUnavailableSummary({
        actionCount: exportPayload.actions.length,
        playerCount: exportPayload.seats.length,
      });
    } catch (error) {
      console.error("Failed to open hand review:", error);
      setInviteCopyStatus(t("game.handReviewFailed"));
      setInviteCopyStatusTone("error");
    } finally {
      setIsOpeningHandReview(false);
    }
  };

  const handleExportGameHistory = async () => {
    if (!room || !isGameEnded || isExportingGameHistory) {
      return;
    }

    setIsExportingGameHistory(true);
    try {
      const exportPayload = await handHistoryService.getCompletedGameHistory(
        room.id,
      );
      downloadJsonExport(exportPayload, `${room.id}-all-hands-history.json`);
      setInviteCopyStatus(t("game.final.historyExportSaved"));
      setInviteCopyStatusTone("success");
    } catch (error) {
      console.error("Failed to export full game history:", error);
      setInviteCopyStatus(t("game.final.historyExportFailed"));
      setInviteCopyStatusTone("error");
    } finally {
      setIsExportingGameHistory(false);
    }
  };

  const handleOpenSavedHistory = () => {
    if (!room) {
      return;
    }
    navigate(`/history/${room.id}`);
  };

  const handleConfirmEndGame = () => {
    if (!canHostEndGame) return;
    closeConfirmModal("endGameConfirm");
    endGame();
  };

  const handleRequestLeave = () => {
    openConfirmModal("leaveConfirm");
  };

  const handleConfirmLeave = async () => {
    closeConfirmModal("leaveConfirm");
    const didLeave = await leaveRoom();
    if (didLeave) {
      navigate("/");
    }
  };

  const leaveAvailability = useMemo(() => {
    if (!room || !player) {
      return {
        canLeave: false,
        reason: t("game.leaveConfirm.unavailableGeneric"),
      };
    }

    if (isGameEnded || !isGameStarted) {
      return { canLeave: true, reason: null };
    }

    if (!isHandPausedForNextHand) {
      return {
        canLeave: false,
        reason: t("game.leaveConfirm.unavailableDuringHand"),
      };
    }

    if (hasReadiedCurrentPhase) {
      return {
        canLeave: false,
        reason: t("game.leaveConfirm.unavailableAfterReady"),
      };
    }

    return { canLeave: true, reason: null };
  }, [
    hasReadiedCurrentPhase,
    isGameEnded,
    isGameStarted,
    isHandPausedForNextHand,
    player,
    room,
    t,
  ]);

  const handleSaveProfile = async () => {
    if (!user) {
      return;
    }
    setIsSavingProfile(true);
    setProfileFeedback(null);
    try {
      await updateProfile(profileDisplayNameDraft, profileAvatarEmojiDraft);
      setProfileFeedback(t("game.profile.updateSuccess"));
    } catch (error) {
      setProfileFeedback(
        error instanceof Error ? error.message : t("game.profile.updateFailure"),
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleLegacyAction = (action: PlayerAction) => {
    if (action === "raise") {
      if (legacyRaiseAmount < minRaise) {
        return;
      }
      if (legacyRaiseAmount > maxStack) {
        return;
      }

      setShowMobileChipPopover(false);
      setQuickConfirmAction(null);
      setShowTrayConfirm(false);
      performAction("raise", legacyRaiseAmount);
      return;
    }

    if (action !== "check" && action !== "fold") {
      setQuickConfirmAction(null);
    }
    setShowMobileChipPopover(false);
    setShowTrayConfirm(false);
    performAction(action);
  };

  const handleQuickDecisionAction = (action: QuickConfirmAction) => {
    if (!isYourTurn) return;
    if (action === "check" && !canCheck) return;

    if (isAutomationMode) {
      setShowMobileChipPopover(false);
      setShowTrayConfirm(false);
      performAction(action);
      return;
    }

    setShowMobileChipPopover(false);
    setShowTrayConfirm(false);
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

  const rulesRankingRows = useMemo(
    () =>
      HAND_RANK_ORDER_BY_VARIANT[rulesVariant].map((rank, idx) => ({
        key: rank,
        order: idx + 1,
        title: formatHandRank(rank, locale),
        detail: HAND_RANK_DETAILS_BY_VARIANT[rulesVariant][locale][rank],
      })),
    [locale, rulesVariant],
  );

  const hiddenHudCopy = {
    potLabel: t("game.pot", { amount: displayPot }),
    chipsLabel: t("game.yourChips", { amount: currentPlayer?.chips ?? 0 }),
    roundLabel: currentHand
      ? t("game.round", { round: currentHand.bettingRound })
      : null,
    turnLabel: currentTurnPlayer
      ? t("game.turn", { name: currentTurnPlayer.name })
      : null,
  };
  const chatPreview =
    !activePreviewMessage || isDesktopSideDock
      ? null
      : {
          title: t("game.chat.preview.title"),
          senderName: activePreviewMessage.sender.playerName,
          senderEmoji: activePreviewMessage.sender.playerEmoji,
          message: toChatPreviewText(activePreviewMessage, t),
          timeIso: new Date(activePreviewMessage.createdAt).toISOString(),
          timeLabel: formatRelativeTime(activePreviewMessage.createdAt, locale, relativeNow),
          dismissLabel: t("game.chat.preview.dismiss"),
        };
  const desktopMainDockClassName = isDesktopSideDock
    ? "chip-composer-dock--desktop-main"
    : undefined;
  const desktopOperationDockClassName = isDesktopSideDock
    ? "chip-composer-dock--operation chip-composer-dock--desktop-main"
    : "chip-composer-dock--operation";
  const cardsBottomOffsetPx = isDesktopSideDock ? 0 : getBottomBarCardsOffsetPx(bottomBarHeight);
  const mobileBottomSafeHeight = isDesktopSideDock
    ? 0
    : getMobileTableBottomSafeHeightPx({
        cardsFlyoutHeight,
        bottomBarHeight,
      });

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
    <TableShell
      isDesktopTwoColumn={isDesktopSideDock}
      showDesktopTurnDock={showTurnActionDock && isDesktopSideDock}
      showDesktopOperationDock={(showOperationBar || showReadyActionArea) && isDesktopSideDock}
      desktopBottomBarHeight={bottomBarHeight}
      mobileBottomSafeHeight={mobileBottomSafeHeight}
      isChatPanelOpen={shouldShowChatPanel}
    >
      <div className="table-shell__desktop-layout">
        <div
          className="table-shell__game-column"
          data-testid={shouldShowDesktopRail ? "desktop-game-column" : undefined}
        >
          <TableTopBar
            roomTitle={t("game.room", { roomId: room.id })}
            playerCountLabel={t("game.playersCount", {
              count: tablePlayers.length,
              max: room.config.maxPlayers,
            })}
            ruleVariantLabel={ruleVariantLabel}
            inviteCopyLabel={t("game.copyInvite")}
            inviteCopyStatus={inviteCopyStatus}
            inviteCopyStatusTone={inviteCopyStatusTone}
            leaveLabel={t("common.leave")}
            settingsLabel={t("common.settings")}
            rulesLabel={rulesCopy.buttonLabel}
            rankingsLabel={t("game.rankings")}
            chatLabel={
              chatUnreadCount > 0
                ? t("game.chat.buttonWithUnread", { count: chatUnreadCount })
                : t("game.chat.button")
            }
            liveAudioLabel={t("game.audio.title")}
            liveAudioJoined={isLiveAudioJoined}
            liveAudioMuted={isLiveAudioMuted}
            liveAudioSpeaking={isLiveAudioSpeaking}
            liveAudioButtonRef={liveAudioButtonRef}
            finalResultsLabel={t("game.final.title")}
            startLabel={hasReadiedCurrentPhase ? t("game.ready.waitingOthers") : t("common.ready")}
            startDisabled={hasReadiedCurrentPhase}
            hiddenHudCopy={hiddenHudCopy}
            isChatPanelOpen={shouldShowChatPanel}
            showChatButton={!isDesktopSideDock}
            showChatPreview={!isDesktopSideDock}
            chatPreview={chatPreview}
            showFinalResultsButton={isGameEnded && Boolean(finalGameResult)}
            showStartGameButton={false}
            onCopyInvite={handleCopyInviteLink}
            onLeave={handleRequestLeave}
            onOpenSettings={() => {
              if (user) {
                setProfileDisplayNameDraft(user.displayName);
                setProfileAvatarEmojiDraft(user.avatarEmoji);
              }
              setProfileFeedback(null);
              openPrimaryModal("settings");
            }}
            onOpenRules={() => openPrimaryModal("rules")}
            onOpenRankings={() => openPrimaryModal("rankings")}
            onToggleChat={() => setChatPanelOpen(!isChatPanelOpen)}
            onOpenLiveAudio={handleToggleLiveAudioPopover}
            onOpenFinalResults={() => openPrimaryModal("finalSummary")}
            onStartGame={markReady}
            onOpenChatFromPreview={handleOpenChatFromPreview}
            onDismissPreview={handleDismissPreview}
          />

          {isWaitingForNextHand && (
            <section className="mx-3 mt-2 rounded-xl border border-cyan-400/45 bg-cyan-900/25 px-3 py-2 text-xs font-semibold text-cyan-100">
              {t("game.cardsAppearWhenHandStarts")}
            </section>
          )}

          <div ref={boardStageRef} className="table-shell__board-stage">
            {turnAlertToken !== null && (
              <div aria-live="assertive" key={`turn-alert-${turnAlertToken}`}>
                <TurnCenterAlert
                  eyebrow={t("game.turnAlert.eyebrow")}
                  title={t("game.turnAlert.title")}
                  anchorToStage={isDesktopSideDock}
                />
              </div>
            )}

            {shouldRenderCardsInBoardStage && (
              <YourCardsFlyout
                ref={mobileCardsFlyoutRef}
                isOpen={isCardsFlyoutOpen}
                hasHoleCards={hasHoleCards}
                cards={displayHoleCards ?? []}
                bottomOffsetPx={cardsBottomOffsetPx}
                placement={cardsFlyoutPlacement}
                title={t("game.yourCards")}
                emptyOpenStateLabel={t("game.cardsAppearWhenHandStarts")}
                emptyClosedStateLabel={`${t("game.hide")} ${t("game.yourCards")}`}
                hideLabel={t("game.hide")}
                showLabel={t("game.show")}
                onToggle={() => setIsCardsFlyoutOpen((prev) => !prev)}
              />
            )}

            {actionCenterAlert !== null && (
              <ActionCenterAlertOverlay
                key={`action-alert-${actionCenterAlert.id}`}
                pointerVector={actionPointerVector}
                eyebrow={t("game.actionAlert.eyebrow")}
                actor={actionCenterAlert.playerName}
                title={actionCenterAlert.text}
                tone={actionCenterAlert.tone}
                exiting={actionCenterAlert.exiting}
                cardRef={actionCenterAlertRef}
                anchorToStage={isDesktopSideDock}
              />
            )}

            <TableBoard
              feltOvalRef={feltOvalRef}
              boardCenterStackRef={boardCenterStackRef}
              communityLaneRef={communityLaneRef}
              potDropZoneRef={potDropZoneRef}
              setSeatNodeRef={(playerId, node) => {
                seatNodeRefs.current[playerId] = node;
              }}
              communitySlots={communitySlots}
              isYourTurn={isYourTurn}
              isDragOverDropZone={dragState.overDropZone}
              potLabel={t("game.potCenter")}
              potValue={`$${animatedPotValue}`}
              potHint={isYourTurn ? t("game.dragHint") : null}
              potPulse={potAnimationTick >= 0}
              seatOrbitItems={seatOrbitItems}
            />
          </div>

          {operationBarMode !== null && (
            <ChipComposerDock
              ref={bottomBarOverlayRef}
              className={desktopOperationDockClassName}
              testId="operation-overlay"
            >
              {showResolvedRunoutBoardsPreview && (
                <section className="showdown-revealed-hands" data-testid="showdown-runout-boards">
                  <div className="showdown-revealed-hands__header">
                    <h4 className="showdown-revealed-hands__title">{t("game.runouts.title")}</h4>
                  </div>
                  <div className="showdown-revealed-hands__list">
                    {resolvedRunoutBoards.map((board, runIndex) => (
                      <div
                        key={`showdown-runout-board-${runIndex}`}
                        className="showdown-revealed-hands__item"
                        data-testid={`showdown-runout-board-${runIndex}`}
                      >
                        <span className="showdown-revealed-hands__name">
                          {t("game.runouts.runLabel", { index: runIndex + 1 })}
                        </span>
                        <div className="showdown-revealed-hands__cards">
                          {board.map((card, cardIndex) => (
                            <Card
                              key={`showdown-runout-card-${runIndex}-${card.suit}-${card.rank}-${cardIndex}`}
                              card={card}
                              size="small"
                              dataTestId={`showdown-runout-card-${runIndex}-${cardIndex}`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {operationBarMode === "showdown" && revealedShowdownHands.length > 0 && (
                <section className="showdown-revealed-hands" data-testid="showdown-revealed-hands">
                  <div className="showdown-revealed-hands__header">
                    <h4 className="showdown-revealed-hands__title">{t("game.showdown.revealedHandsTitle")}</h4>
                  </div>
                  <div className="showdown-revealed-hands__list">
                    {revealedShowdownHands.map((entry) => (
                      <div
                        key={entry.playerId}
                        className="showdown-revealed-hands__item"
                        data-testid={`showdown-revealed-hand-${entry.playerId}`}
                      >
                        <span className="showdown-revealed-hands__name">{entry.playerName}</span>
                        <div className="showdown-revealed-hands__cards">
                          {entry.cards.map((card, cardIndex) => (
                            <Card
                              key={`${entry.playerId}-${card.suit}-${card.rank}-${cardIndex}`}
                              card={card}
                              size="small"
                              dataTestId={`showdown-revealed-card-${entry.playerId}-${cardIndex}`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <OperationActionBar
                mode={operationBarMode}
                isAutomationMode={isAutomationMode}
                runCountCanChoose={canChooseRunCount}
                runCountHasChosenTwice={hasChosenRunTwice}
                runCountReadyCount={runCountTwiceAgreedPlayerIdSet.size}
                runCountTotalCount={runCountDecisionState?.eligiblePlayerIds.length ?? 0}
                runCountWaitingPlayerNames={runCountWaitingPlayerNames}
                isResultRevealStep={isResultRevealStep}
                canRevealNextStreet={canRevealNextStreet}
                hasRevealedNextStreet={hasRevealedNextStreet}
                canShowMyHand={canShowMyHandAtShowdown}
                hasShownMyHand={hasShownMyHandAtShowdown}
                canFoldMyHand={canFoldMyHandAtShowdown}
                hasFoldedMyHand={hasFoldedMyHandAtShowdown}
                showdownIsDecisionTurn={isMyShowdownDecisionTurn}
                showdownWaitingPlayerName={showdownDecisionWaitingPlayerName}
                showdownIsForcedRevealTurn={isShowdownForcedRevealTurn}
                onChooseRunOnce={() => decideRunCount(1)}
                onChooseRunTwice={() => decideRunCount(2)}
                onRevealNextStreet={revealNextStreet}
                onShowMyHand={showMyHand}
                onFoldMyHand={muckMyHand}
                t={t}
              />
            </ChipComposerDock>
          )}

          {showPreGameReadyArea && (
            <ChipComposerDock
              ref={bottomBarOverlayRef}
              className={desktopOperationDockClassName}
              testId="operation-overlay"
            >
              <ReadyActionArea
                phase={readyActionPhase}
                canReady={canReadyInReadyActionArea}
                hasReadied={hasReadiedCurrentPhase}
                canEndGame={canHostEndGame}
                isHost={isHost}
                robots={robotPlayers.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                  emoji: entry.emoji,
                }))}
                onReady={markReady}
                onOpenEndGameConfirm={() => {
                  if (!canHostEndGame) return;
                  openConfirmModal("endGameConfirm");
                }}
                onAddRobot={() => addRobotPlayer()}
                onRemoveRobot={(robotPlayerId) => removeRobotPlayer(robotPlayerId)}
                t={t}
              />
            </ChipComposerDock>
          )}

          {showNextHandActionArea && !showHandResultsModal && (
            <ChipComposerDock
              ref={bottomBarOverlayRef}
              className={desktopOperationDockClassName}
              testId="operation-overlay"
            >
              <NextHandActionArea
                canReadyNextHand={canReadyNextHand}
                hasReadiedNextHand={hasReadiedCurrentPhase}
                canEndGame={canHostEndGame}
                onReadyNextHand={markReady}
                onOpenEndGameConfirm={() => {
                  if (!canHostEndGame) return;
                  openConfirmModal("endGameConfirm");
                }}
                t={t}
              />
            </ChipComposerDock>
          )}

          {shouldRenderStandaloneDesktopCardsFlyout && (
            <div className="desktop-dock-cluster desktop-dock-cluster--cards-only">
              <YourCardsFlyout
                isOpen={isCardsFlyoutOpen}
                hasHoleCards={hasHoleCards}
                cards={displayHoleCards ?? []}
                bottomOffsetPx={0}
                placement={desktopCardsFlyoutLayout.placement ?? "dock-left"}
                title={t("game.yourCards")}
                emptyOpenStateLabel={t("game.cardsAppearWhenHandStarts")}
                emptyClosedStateLabel={`${t("game.hide")} ${t("game.yourCards")}`}
                hideLabel={t("game.hide")}
                showLabel={t("game.show")}
                onToggle={() => setIsCardsFlyoutOpen((prev) => !prev)}
              />
              <div
                className="desktop-dock-cluster__anchor"
                data-testid="desktop-dock-anchor"
                aria-hidden="true"
              />
            </div>
          )}

          {showTurnActionDock && (
            <div className={isDesktopSideDock ? "desktop-dock-cluster" : undefined}>
              {shouldRenderCardsBesideDesktopDock && (
                <YourCardsFlyout
                  isOpen={isCardsFlyoutOpen}
                  hasHoleCards={hasHoleCards}
                  cards={displayHoleCards ?? []}
                  bottomOffsetPx={0}
                  placement={desktopCardsFlyoutLayout.placement ?? "dock-left"}
                  title={t("game.yourCards")}
                  emptyOpenStateLabel={t("game.cardsAppearWhenHandStarts")}
                  emptyClosedStateLabel={`${t("game.hide")} ${t("game.yourCards")}`}
                  hideLabel={t("game.hide")}
                  showLabel={t("game.show")}
                  onToggle={() => setIsCardsFlyoutOpen((prev) => !prev)}
                />
              )}
              <ChipComposerDock ref={bottomBarOverlayRef} className={desktopMainDockClassName}>
                <TurnActionDock
                  callAmount={callAmount}
                  isOpeningBetAction={(currentHand?.currentBet ?? 0) <= 0}
                  minRaise={minRaise}
                  maxStack={maxStack}
                  trayAmount={trayAmount}
                  trayInputValue={trayInputValue}
                  mobileChipDraftValue={mobileChipDraftValue}
                  showMobileChipPopover={showMobileChipPopover}
                  isDesktopClickBetting={isDesktopSideDock}
                  isCompactMobileLayout={isCompactMobileDock}
                  canStartDrag={canStartDrag}
                  isDragActive={dragState.active}
                  isYourTurn={isYourTurn}
                  canCheck={canCheck}
                  isAutomationMode={isAutomationMode}
                  legacyRaiseAmount={legacyRaiseAmount}
                  trayPresetButtons={trayPresetButtons}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onSetTrayDirectly={setTrayDirectly}
                  onTrayInputChange={handleCustomTrayInputChange}
                  onTrayInputBlur={handleCustomTrayInputBlur}
                  onOpenMobileChipPopover={openMobileChipPopover}
                  onCloseMobileChipPopover={closeMobileChipPopover}
                  onMobileChipDigit={handleMobileChipDigit}
                  onMobileChipBackspace={handleMobileChipBackspace}
                  onMobileChipClearDraft={handleMobileChipClearDraft}
                  onMobileChipConfirm={handleMobileChipConfirm}
                  onClearTray={clearTray}
                  onSubmitTray={requestTraySubmit}
                  onQuickDecisionAction={handleQuickDecisionAction}
                  quickConfirmAction={!isAutomationMode ? quickConfirmAction : null}
                  onQuickConfirmDismiss={() => setQuickConfirmAction(null)}
                  onQuickConfirmAccept={(action) => {
                    setQuickConfirmAction(null);
                    performAction(action);
                  }}
                  traySubmitLabel={desktopTraySubmitIntent?.label ?? null}
                  showTrayConfirm={showTrayConfirm}
                  onTrayConfirmDismiss={() => setShowTrayConfirm(false)}
                  onTrayConfirmAccept={acceptTraySubmit}
                  onLegacyAction={handleLegacyAction}
                  onLegacyRaiseAmountChange={setLegacyRaiseAmount}
                  t={t}
                />
              </ChipComposerDock>
            </div>
          )}
        </div>

        {shouldShowDesktopRail && (
          <aside className="desktop-right-rail" data-testid="desktop-right-rail">
            <div className="chat-panel-shell chat-panel-shell--desktop-rail">
              <ChatPanel onClose={() => undefined} showCloseButton={false} />
            </div>
          </aside>
        )}
      </div>

      {!shouldShowDesktopRail && shouldShowChatPanel && (
        <div className="chat-panel-shell">
          <ChatPanel onClose={() => setChatPanelOpen(false)} />
        </div>
      )}

      {showHandResultsModal && lastHandResult && !finalGameResult && (
        <HandResultsModal
          ref={handResultsPanelRef}
          ariaLabel={t("game.handResults", { handNumber: currentHandNumber ?? "?" })}
          footer={
            showNextHandActionArea ? (
              <NextHandActionArea
                canReadyNextHand={canReadyNextHand}
                hasReadiedNextHand={hasReadiedCurrentPhase}
                canEndGame={canHostEndGame}
                onReadyNextHand={handleReadyFromHandResultsModal}
                onOpenEndGameConfirm={() => {
                  if (!canHostEndGame) return;
                  openConfirmModal("endGameConfirm");
                }}
                t={t}
              />
            ) : null
          }
          onClose={() => closePrimaryModal("handResults")}
          t={t}
        >
          <HandResultsContent
            currentHandNumber={currentHandNumber}
            totalPot={lastHandResult.totalPot}
            winnerCount={lastHandResult.winners.length}
            myNetChange={myHandNetChange}
            showNetChange={hasNetByPlayerId}
            currentPlayerId={player.id}
            communityCards={Array.from(
              { length: 5 },
              (_, idx) => currentHand?.communityCards[idx] ?? null,
            )}
            runouts={lastHandResult.runouts?.map((runout) => ({
              runIndex: runout.runIndex,
              board: runout.board,
              winners: runout.winners.map((winner) => ({
                playerId: winner.playerId,
                playerName: winner.playerName,
                amountWon: winner.amountWon,
              })),
            }))}
            payoutBreakdownRows={payoutBreakdownRows}
            handResultRows={handResultRows.map((entry) => ({
              ...entry,
              hand: (entry.hand as HandEvaluation | null) ?? null,
            }))}
            revealedHandPlayerIdSet={revealedHandPlayerIdSet}
            onSaveResultScreenshot={handleSaveResultScreenshot}
            onExportHandHistory={handleExportHandHistory}
            isExportingHandHistory={isExportingHandHistory}
            onOpenHandReview={handleOpenHandReview}
            isOpeningHandReview={isOpeningHandReview}
            handReviewUnavailableSummary={handReviewUnavailableSummary}
            describeEvaluatedHand={(evaluatedHand) =>
              `${formatHandRank(evaluatedHand.rank, locale)} - ${formatHandDescription(evaluatedHand, locale)}`
            }
            t={t}
          />
        </HandResultsModal>
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
        <SettingsModal
          locale={locale}
          onLocaleChange={setLocale}
          profileDisplayName={profileDisplayNameDraft}
          profileAvatarEmoji={profileAvatarEmojiDraft}
          profileEmojiOptions={PLAYER_EMOJI_OPTIONS}
          onProfileDisplayNameChange={setProfileDisplayNameDraft}
          onProfileAvatarEmojiChange={setProfileAvatarEmojiDraft}
          onSaveProfile={handleSaveProfile}
          isSavingProfile={isSavingProfile}
          profileFeedback={profileFeedback}
          isHost={isHost}
          isPlayerStreetRevealEnabled={isPlayerStreetRevealEnabled}
          onStreetRevealChange={(enabled) =>
            updateRoomConfig({ allowPlayerStreetReveal: enabled })
          }
          onClose={() => closePrimaryModal("settings")}
          t={t}
        />
      )}

      {showLiveAudioPopover && room !== null && (
        <LiveAudioPopover
          anchorRef={liveAudioButtonRef}
          isOpen={showLiveAudioPopover}
          title={t("game.audio.title")}
          subtitle={t("game.audio.subtitle")}
          joinLabel={t("game.audio.join")}
          leaveLabel={t("game.audio.leave")}
          muteLabel={t("game.audio.mute")}
          unmuteLabel={t("game.audio.unmute")}
          enableAudioLabel={t("game.audio.enableAudio")}
          connectingLabel={t("game.audio.connecting")}
          connectedLabel={t("game.audio.connected")}
          reconnectingLabel={t("game.audio.reconnecting")}
          mutedLabel={t("game.audio.muted")}
          unavailableLabel={t("game.audio.unavailable")}
          reconnectPromptTitle={t("game.audio.reconnectPromptTitle")}
          reconnectPromptSubtitle={t("game.audio.reconnectPromptSubtitle")}
          reconnectLabel={t("game.audio.reconnect")}
          reconnectDismissLabel={t("game.audio.reconnectDismiss")}
          joinPopoverTitle={t("game.audio.joinPopoverTitle")}
          controlPopoverTitle={t("game.audio.controlPopoverTitle")}
          closeLabel={t("common.close")}
          error={
            liveAudioError?.startsWith("game.audio.error.")
              ? t(liveAudioError as MessageKey)
              : liveAudioError
          }
          available={isLiveAudioAvailable}
          isConfigLoaded={isLiveAudioConfigLoaded}
          isConnecting={isLiveAudioConnecting}
          isJoined={isLiveAudioJoined}
          isMuted={isLiveAudioMuted}
          isAudioPlaybackBlocked={isLiveAudioPlaybackBlocked}
          isReconnecting={isLiveAudioReconnecting}
          showReconnectPrompt={hasLiveAudioReconnectPrompt}
          onJoin={handleJoinLiveAudio}
          onReconnect={handleReconnectLiveAudio}
          onDismissReconnect={handleDismissLiveAudioReconnectPrompt}
          onLeave={handleLeaveLiveAudio}
          onMute={handleMuteLiveAudio}
          onUnmute={handleUnmuteLiveAudio}
          onEnableAudio={() => {
            void enableAudio();
          }}
          onClose={closeLiveAudioPopover}
        />
      )}

      {showRankingsModal && (
        <RankingsModal
          playerRankings={playerRankings}
          currentPlayerId={player.id}
          onClose={() => closePrimaryModal("rankings")}
          t={t}
        />
      )}

      {showRulesModal && (
        <RulesModal
          rulesCopy={rulesCopy}
          rankingRows={rulesRankingRows}
          onClose={() => closePrimaryModal("rules")}
          t={t}
        />
      )}

      {showEndGameConfirmModal && (
        <EndGameConfirmModal
          onCancel={() => closeConfirmModal("endGameConfirm")}
          onConfirm={handleConfirmEndGame}
          t={t}
        />
      )}

      {showLeaveConfirmModal && (
        <LeaveRoomConfirmModal
          canConfirm={leaveAvailability.canLeave}
          availabilityReason={leaveAvailability.reason}
          body={
            leaveAvailability.canLeave
              ? undefined
              : t("game.leaveConfirm.blockedBody")
          }
          warning={
            leaveAvailability.canLeave
              ? undefined
              : t("game.leaveConfirm.blockedWarning")
          }
          onCancel={() => closeConfirmModal("leaveConfirm")}
          onConfirm={handleConfirmLeave}
          t={t}
        />
      )}

      {showFinalSummaryModal && finalGameResult && (
        <FinalSummaryModal
          ref={finalSummaryPanelRef}
          finalGameResult={finalGameResult}
          finalSummaryCards={finalSummaryCards}
          finalStandings={finalStandings}
          currentPlayerId={player.id}
          isGameEnded={isGameEnded}
          onExportHistory={handleExportGameHistory}
          isExportingHistory={isExportingGameHistory}
          onOpenSavedHistory={handleOpenSavedHistory}
          onSaveScreenshot={handleSaveFinalSummaryScreenshot}
          onLeave={handleRequestLeave}
          onClose={() => closePrimaryModal("finalSummary")}
          t={t}
        />
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
    </TableShell>
  );
};

export const GameRoom: React.FC = () => useGameRoomElement();
