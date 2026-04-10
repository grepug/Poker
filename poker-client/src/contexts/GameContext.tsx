/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type {
  Room,
  RoomConfig,
  BlindType,
  Player,
  Card,
  PlayerAction,
  PlayerActionDisplayKind,
  BettingRound,
  Hand,
  HandResult,
  GameEndedData,
  ShowdownDecisionStateData,
  RunCount,
  RunCountDecisionStateData,
  ClientToServerEvents,
  ChatHistorySyncData,
  ChatMessage,
  SessionDisplacedData,
  SendChatMessageData,
  VoiceMessagePayload,
} from "poker-types";
import { useSocket } from "./SocketContext";
import { getVoicePlaybackState } from "../services/voice-playback.service";
import {
  writeLastPlayerEmoji,
  writeLastPlayerName,
} from "../utils/player-name-storage";

export interface PlayerActionFlashEvent {
  id: string;
  playerId: string;
  playerName: string;
  action: PlayerAction;
  amount?: number;
  isOpeningBet?: boolean;
  displayKind?: PlayerActionDisplayKind;
  totalBetAfterAction?: number;
  committedAmount?: number;
  blindType?: BlindType | null;
  newPot: number;
  createdAt: number;
}

const resolveFallbackDisplayKind = ({
  action,
  preRoundCurrentBet,
}: {
  action: PlayerAction;
  preRoundCurrentBet: number;
}): PlayerActionDisplayKind => {
  switch (action) {
    case "fold":
      return "fold";
    case "check":
      return "check";
    case "call":
      return "call-to";
    case "all-in":
      return "all-in-to";
    case "raise":
      return preRoundCurrentBet <= 0 ? "bet-to" : "raise-to";
  }
};

interface NextStreetRevealState {
  nextRound: BettingRound;
  readyPlayerIds: string[];
  requiredPlayerIds: string[];
}

export interface RevealedShowdownHand {
  playerId: string;
  playerName: string;
  cards: Card[];
  showdownOrderIndex: number;
}

interface CreateRoomOptions {
  useShortDeckRules?: boolean;
  maxPlayers?: number;
}

type DebugApi = {
  getRoom: () => Room | null;
  getPlayer: () => Player | null;
  getCards: () => Card[] | null;
  getLastHandResult: () => HandResult | null;
  getFinalGameResult: () => GameEndedData | null;
  getLastPlayerActionEvent: () => PlayerActionFlashEvent | null;
  getRevealedHandPlayerIds: () => string[];
  getShowdownDecisionState: () => ShowdownDecisionStateData | null;
  getRunCountDecisionState: () => RunCountDecisionStateData | null;
  getRevealedShowdownHandsByPlayerId: () => Record<
    string,
    RevealedShowdownHand
  >;
  getNextStreetRevealState: () => NextStreetRevealState | null;
  getSocket: () => ReturnType<typeof useSocket>["socket"];
  createRoom: (
    name?: string,
    emoji?: string,
    options?: CreateRoomOptions,
  ) => void;
  joinRoom: (roomId: string, name?: string, emoji?: string) => Promise<boolean>;
  startGame: () => void;
  startNextHand: () => void;
  markReady: () => void;
  endGame: () => void;
  showMyHand: () => void;
  muckMyHand: () => void;
  revealNextStreet: () => void;
  decideRunCount: (runCount: RunCount) => void;
  performAction: (
    action: PlayerAction,
    amount?: number,
    actionId?: string,
  ) => void;
  fold: () => void;
  check: () => void;
  call: () => void;
  raise: (amount: number) => void;
  allIn: () => void;
  leaveRoom: () => Promise<boolean>;
  requestRebuy: (amount: number) => void;
  updateRoomConfig: (
    config: Partial<Pick<RoomConfig, "allowPlayerStreetReveal">>,
  ) => void;
  addRobotPlayer: (name?: string, emoji?: string) => void;
  removeRobotPlayer: (playerId: string) => void;
  getChatMessages: () => ChatMessage[];
  getChatUnreadCount: () => number;
  sendChatText: (text: string, clientMessageId?: string) => void;
  sendChatVoice: (voice: VoiceMessagePayload, clientMessageId?: string) => void;
  loadOlderChatMessages: () => void;
  setChatPanelOpen: (open: boolean) => void;
  clearChatUnread: () => void;
  getVoicePlaybackState: () => { sourceUrl: string | null; isPlaying: boolean };
  clearError: () => void;
  emitCustom: (event: keyof ClientToServerEvents, data: unknown) => void;
  logState: () => void;
};

interface GameContextType {
  room: Room | null;
  player: Player | null;
  yourCards: Card[] | null;
  lastHandResult: HandResult | null;
  finalGameResult: GameEndedData | null;
  lastPlayerActionEvent: PlayerActionFlashEvent | null;
  revealedHandPlayerIds: string[];
  showdownDecisionState: ShowdownDecisionStateData | null;
  runCountDecisionState: RunCountDecisionStateData | null;
  revealedShowdownHandsByPlayerId: Record<string, RevealedShowdownHand>;
  nextStreetRevealState: NextStreetRevealState | null;
  isHost: boolean;
  isRecoveringSession: boolean;
  lastError: string | null;
  chatMessages: ChatMessage[];
  chatHasMore: boolean;
  chatLoadingHistory: boolean;
  chatUnreadCount: number;
  isChatPanelOpen: boolean;
  createRoom: (
    playerName?: string,
    playerEmoji?: string,
    options?: CreateRoomOptions,
  ) => void;
  joinRoom: (
    roomId: string,
    playerName?: string,
    playerEmoji?: string,
  ) => Promise<boolean>;
  startGame: () => void;
  startNextHand: () => void;
  markReady: () => void;
  endGame: () => void;
  showMyHand: () => void;
  muckMyHand: () => void;
  revealNextStreet: () => void;
  decideRunCount: (runCount: RunCount) => void;
  performAction: (
    action: PlayerAction,
    amount?: number,
    actionId?: string,
  ) => void;
  leaveRoom: () => Promise<boolean>;
  requestRebuy: (amount: number) => void;
  updateRoomConfig: (
    config: Partial<Pick<RoomConfig, "allowPlayerStreetReveal">>,
  ) => void;
  addRobotPlayer: (name?: string, emoji?: string) => void;
  removeRobotPlayer: (playerId: string) => void;
  sendChatText: (text: string, clientMessageId?: string) => void;
  sendChatVoice: (voice: VoiceMessagePayload, clientMessageId?: string) => void;
  loadOlderChatMessages: () => void;
  setChatPanelOpen: (open: boolean) => void;
  clearChatUnread: () => void;
  clearError: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within GameProvider");
  }
  return context;
};

interface GameProviderProps {
  children: ReactNode;
}

type StoredSession = {
  roomId: string;
  playerId: string;
  playerName: string;
};

const SESSION_STORAGE_KEY = "poker.activeSession";
const JUST_LEFT_ROOM_STORAGE_KEY = "poker.justLeftRoom";
const FINAL_RESULT_STORAGE_PREFIX = "poker.finalResult.";
const createActionId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.roomId !== "string" ||
      !parsed.roomId ||
      typeof parsed.playerId !== "string" ||
      !parsed.playerId ||
      typeof parsed.playerName !== "string" ||
      !parsed.playerName
    ) {
      return null;
    }
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

function readStoredFinalResult(roomId: string): GameEndedData | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(
    `${FINAL_RESULT_STORAGE_PREFIX}${roomId}`,
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameEndedData;
  } catch {
    return null;
  }
}

function writeStoredFinalResult(roomId: string, result: GameEndedData) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    `${FINAL_RESULT_STORAGE_PREFIX}${roomId}`,
    JSON.stringify(result),
  );
}

function clearStoredFinalResult(roomId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(`${FINAL_RESULT_STORAGE_PREFIX}${roomId}`);
}

function isInvalidReconnectReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized.includes("not found");
}

function deriveNextStreetRevealStateFromRoom(
  roomState: Room | null | undefined,
): NextStreetRevealState | null {
  const currentHand = roomState?.currentHand;
  if (!currentHand?.pendingStreetRevealRound) {
    return null;
  }

  return {
    nextRound: currentHand.pendingStreetRevealRound,
    readyPlayerIds: currentHand.nextStreetReadyPlayerIds ?? [],
    requiredPlayerIds: currentHand.nextStreetRequiredPlayerIds ?? [],
  };
}

function deriveLastHandResultFromRoom(
  roomState: Room | null | undefined,
): HandResult | null {
  return roomState?.currentHand?.lastResult ?? null;
}

function deriveRevealedHandPlayerIdsFromRoom(
  roomState: Room | null | undefined,
): string[] {
  return roomState?.currentHand?.revealedPlayerIds ?? [];
}

function deriveShowdownDecisionStateFromRoom(
  roomState: Room | null | undefined,
): ShowdownDecisionStateData | null {
  const currentHand = roomState?.currentHand;
  if (
    !currentHand ||
    currentHand.bettingRound !== "SHOWDOWN" ||
    currentHand.lastResult
  ) {
    return null;
  }

  const orderedPlayerIds = currentHand.showdownDecisionOrder ?? [];
  if (orderedPlayerIds.length === 0) {
    return null;
  }

  const currentPlayerId = currentHand.showdownDecisionPlayerId ?? null;
  const currentPlayerName =
    roomState?.players.find((seatPlayer) => seatPlayer.id === currentPlayerId)
      ?.name ?? null;

  return {
    handNumber: currentHand.handNumber,
    orderedPlayerIds,
    currentPlayerId,
    currentPlayerName,
    forcedRevealPlayerIds: currentHand.showdownForcedRevealPlayerIds ?? [],
  };
}

function deriveRunCountDecisionStateFromRoom(
  roomState: Room | null | undefined,
): RunCountDecisionStateData | null {
  const currentHand = roomState?.currentHand;
  const decision = currentHand?.runCountDecision;
  if (!currentHand || !decision || decision.eligiblePlayerIds.length === 0) {
    return null;
  }

  return {
    handNumber: currentHand.handNumber,
    eligiblePlayerIds: decision.eligiblePlayerIds ?? [],
    twiceAgreedPlayerIds: decision.twiceAgreedPlayerIds ?? [],
    expiresAt: decision.expiresAt,
  };
}

const CHAT_HISTORY_PAGE_LIMIT = 50;

function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const bySeq = new Map<number, ChatMessage>();
  for (const message of messages) {
    bySeq.set(message.seq, message);
  }

  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

function mergeChatMessageLists(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  return normalizeChatMessages([...existing, ...incoming]);
}

declare global {
  interface Window {
    pokerDebug?: DebugApi;
  }
}

const useGameProviderElement = ({ children }: GameProviderProps) => {
  const { socket } = useSocket();
  const [room, setRoom] = useState<Room | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [yourCards, setYourCards] = useState<Card[] | null>(null);
  const [lastHandResult, setLastHandResult] = useState<HandResult | null>(null);
  const [finalGameResult, setFinalGameResult] = useState<GameEndedData | null>(
    null,
  );
  const [lastPlayerActionEvent, setLastPlayerActionEvent] =
    useState<PlayerActionFlashEvent | null>(null);
  const [revealedHandPlayerIds, setRevealedHandPlayerIds] = useState<string[]>(
    [],
  );
  const [showdownDecisionState, setShowdownDecisionState] =
    useState<ShowdownDecisionStateData | null>(null);
  const [runCountDecisionState, setRunCountDecisionState] =
    useState<RunCountDecisionStateData | null>(null);
  const [revealedShowdownHandsByPlayerId, setRevealedShowdownHandsByPlayerId] =
    useState<Record<string, RevealedShowdownHand>>({});
  const [nextStreetRevealState, setNextStreetRevealState] =
    useState<NextStreetRevealState | null>(null);
  const [isRecoveringSession, setIsRecoveringSession] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatHasMore, setChatHasMore] = useState(false);
  const [chatNextBeforeSeq, setChatNextBeforeSeq] = useState<number | null>(
    null,
  );
  const [chatLoadingHistory, setChatLoadingHistory] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [isChatPanelOpen, setIsChatPanelOpenState] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const playerRef = useRef<Player | null>(null);
  const reconnectInFlightRef = useRef(false);
  const chatPanelOpenRef = useRef(false);

  useEffect(() => {
    roomRef.current = room;
    playerRef.current = player;
  }, [room, player]);

  useEffect(() => {
    chatPanelOpenRef.current = isChatPanelOpen;
  }, [isChatPanelOpen]);

  useEffect(() => {
    if (!room?.id || !player?.id || !player.name) return;
    writeStoredSession({
      roomId: room.id,
      playerId: player.id,
      playerName: player.name,
    });
  }, [player?.id, player?.name, room?.id]);

  useEffect(() => {
    if (!player?.name) return;
    writeLastPlayerName(player.name);
  }, [player?.name]);

  useEffect(() => {
    if (!player?.emoji) return;
    writeLastPlayerEmoji(player.emoji);
  }, [player?.emoji]);

  const clearActiveRoomState = useCallback(
    ({
      markJustLeft = false,
      errorMessage = null,
    }: {
      markJustLeft?: boolean;
      errorMessage?: string | null;
    } = {}) => {
      const currentRoomId = roomRef.current?.id;
      if (currentRoomId) {
        clearStoredFinalResult(currentRoomId);
      }
      if (typeof window !== "undefined" && markJustLeft) {
        window.sessionStorage.setItem(JUST_LEFT_ROOM_STORAGE_KEY, "1");
      }
      clearStoredSession();
      setRoom(null);
      setPlayer(null);
      setYourCards(null);
      setLastHandResult(null);
      setFinalGameResult(null);
      setLastPlayerActionEvent(null);
      setRevealedHandPlayerIds([]);
      setShowdownDecisionState(null);
      setRunCountDecisionState(null);
      setRevealedShowdownHandsByPlayerId({});
      setNextStreetRevealState(null);
      setIsRecoveringSession(false);
      setLastError(errorMessage);
      setChatMessages([]);
      setChatHasMore(false);
      setChatNextBeforeSeq(null);
      setChatLoadingHistory(false);
      setChatUnreadCount(0);
      setIsChatPanelOpenState(false);
    },
    [],
  );

  const registerSocketStateListeners = useCallback(
    (socketInstance: NonNullable<typeof socket>) => {
      const socket = socketInstance;

      // Room created
      socket.on("ROOM_CREATED", (data) => {
        const roomState = data.room as unknown as Room;
        setRoom(roomState); // SanitizedRoom from server
        const host = data.room.players[0];
        setPlayer({ ...host, cards: null } as Player);
        setYourCards(null);
        setLastHandResult(deriveLastHandResultFromRoom(roomState));
        setRevealedHandPlayerIds(
          deriveRevealedHandPlayerIdsFromRoom(roomState),
        );
        setShowdownDecisionState(
          deriveShowdownDecisionStateFromRoom(roomState),
        );
        setRunCountDecisionState(
          deriveRunCountDecisionStateFromRoom(roomState),
        );
        setRevealedShowdownHandsByPlayerId({});
        setLastPlayerActionEvent(null);
        setFinalGameResult(null);
        setNextStreetRevealState(
          deriveNextStreetRevealStateFromRoom(roomState),
        );
        clearStoredFinalResult(data.room.id);
        setChatMessages([]);
        setChatHasMore(false);
        setChatNextBeforeSeq(null);
        setChatUnreadCount(0);
        setChatLoadingHistory(false);
        setIsRecoveringSession(false);
        console.log("Room created:", data.roomId);
      });

      // Room joined
      socket.on("ROOM_JOINED", (data) => {
        const roomState = data.room as unknown as Room;
        setRoom(roomState); // SanitizedRoom from server
        setPlayer(data.player);
        setYourCards(data.player?.cards ?? null);
        setLastHandResult(deriveLastHandResultFromRoom(roomState));
        setRevealedHandPlayerIds(
          deriveRevealedHandPlayerIdsFromRoom(roomState),
        );
        setShowdownDecisionState(
          deriveShowdownDecisionStateFromRoom(roomState),
        );
        setRunCountDecisionState(
          deriveRunCountDecisionStateFromRoom(roomState),
        );
        setRevealedShowdownHandsByPlayerId({});
        setLastPlayerActionEvent(null);
        const restoredFinalResult =
          roomState.gameState === "ENDED" && roomState.id
            ? readStoredFinalResult(roomState.id)
            : null;
        setFinalGameResult(restoredFinalResult);
        setNextStreetRevealState(
          deriveNextStreetRevealStateFromRoom(roomState),
        );
        setChatMessages([]);
        setChatHasMore(false);
        setChatNextBeforeSeq(null);
        setChatUnreadCount(0);
        setChatLoadingHistory(false);
        setIsRecoveringSession(false);
        setLastError(null);
      });

      // Explicit reconnect success
      socket.on("RECONNECT_SUCCESS", (data) => {
        const roomState = data.room as unknown as Room;
        setRoom(roomState);
        setPlayer(data.player as Player);
        setYourCards(data.yourCards ?? null);
        setLastHandResult(deriveLastHandResultFromRoom(roomState));
        setRevealedHandPlayerIds(
          deriveRevealedHandPlayerIdsFromRoom(roomState),
        );
        setShowdownDecisionState(
          deriveShowdownDecisionStateFromRoom(roomState),
        );
        setRunCountDecisionState(
          deriveRunCountDecisionStateFromRoom(roomState),
        );
        setRevealedShowdownHandsByPlayerId({});
        setLastPlayerActionEvent(null);
        const restoredFinalResult =
          roomState.gameState === "ENDED" && roomState.id
            ? readStoredFinalResult(roomState.id)
            : null;
        setFinalGameResult(restoredFinalResult);
        setNextStreetRevealState(
          deriveNextStreetRevealStateFromRoom(roomState),
        );
        setChatMessages([]);
        setChatHasMore(false);
        setChatNextBeforeSeq(null);
        setChatUnreadCount(0);
        setChatLoadingHistory(false);
        setLastError(null);
        setIsRecoveringSession(false);
        reconnectInFlightRef.current = false;
      });

      // Explicit reconnect failure
      socket.on("RECONNECT_ERROR", (data) => {
        const reason = data.reason || "Reconnect failed";
        reconnectInFlightRef.current = false;
        setIsRecoveringSession(false);
        setShowdownDecisionState(null);
        setRunCountDecisionState(null);
        setRevealedShowdownHandsByPlayerId({});
        if (isInvalidReconnectReason(reason)) {
          clearActiveRoomState({ errorMessage: reason });
          return;
        }
        setLastError(reason);
      });

      // Player joined
      socket.on("PLAYER_JOINED", (data) => {
        setRoom((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            players: [
              ...prev.players,
              { ...data.player, cards: null } as Player,
            ],
          } as Room;
        });
      });

      // Player left
      socket.on("PLAYER_LEFT", (data) => {
        setRoom((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p.id === data.playerId
                ? {
                    ...p,
                    status: "left",
                    cards: null,
                    currentBet: 0,
                    lastAction: null,
                  }
                : p,
            ),
          };
        });
      });

      socket.on("PLAYER_DISCONNECTED", (data) => {
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p.id === data.playerId
                ? { ...p, connectionStatus: "disconnected" }
                : p,
            ),
          };
        });
        setPlayer((prev) =>
          prev && prev.id === data.playerId
            ? { ...prev, connectionStatus: "disconnected" }
            : prev,
        );
      });

      socket.on("PLAYER_RECONNECTED", (data) => {
        const nextStatus = data.status;
        const nextConnectionStatus = data.connectionStatus ?? "connected";
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p.id === data.playerId
                ? {
                    ...p,
                    name: data.playerName,
                    emoji: data.playerEmoji ?? p.emoji,
                    ...(nextStatus ? { status: nextStatus } : {}),
                    connectionStatus: nextConnectionStatus,
                  }
                : p,
            ),
          };
        });
        setPlayer((prev) =>
          prev && prev.id === data.playerId
            ? {
                ...prev,
                name: data.playerName,
                emoji: data.playerEmoji ?? prev.emoji,
                ...(nextStatus ? { status: nextStatus } : {}),
                connectionStatus: nextConnectionStatus,
              }
            : prev,
        );
      });

      socket.on("SESSION_DISPLACED", (data: SessionDisplacedData) => {
        const activeRoomId = roomRef.current?.id;
        const activePlayerId = playerRef.current?.id;
        if (
          (activeRoomId && data.roomId !== activeRoomId) ||
          (activePlayerId && data.playerId !== activePlayerId)
        ) {
          return;
        }

        reconnectInFlightRef.current = false;
        clearActiveRoomState({
          markJustLeft: true,
          errorMessage: data.message || "This table was moved to another device.",
        });
      });

      socket.on("PLAYER_PROFILE_UPDATED", (data) => {
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map((playerEntry) =>
              playerEntry.id === data.playerId
                ? {
                    ...playerEntry,
                    name: data.playerName,
                    emoji: data.playerEmoji ?? playerEntry.emoji,
                  }
                : playerEntry,
            ),
          };
        });
        setPlayer((prev) =>
          prev && prev.id === data.playerId
            ? {
                ...prev,
                name: data.playerName,
                emoji: data.playerEmoji ?? prev.emoji,
              }
            : prev,
        );
      });

      socket.on("PLAYER_AUTO_FOLDED", (data) => {
        setLastPlayerActionEvent({
          id: `${Date.now()}-${data.playerId}-auto-fold`,
          playerId: data.playerId,
          playerName: data.playerName,
          action: "fold",
          newPot: roomRef.current?.currentHand?.pot ?? 0,
          createdAt: Date.now(),
        });
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p.id === data.playerId
                ? { ...p, status: "folded", lastAction: "fold" }
                : p,
            ),
          };
        });
        setPlayer((prev) =>
          prev && prev.id === data.playerId
            ? { ...prev, status: "folded", lastAction: "fold" }
            : prev,
        );
      });

      // Host changed
      socket.on("HOST_CHANGED", (data) => {
        setRoom((prev) => {
          if (!prev) return null;
          return { ...prev, hostId: data.newHostId };
        });
      });

      socket.on("ROOM_CONFIG_UPDATED", (data) => {
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            config: data.config,
          };
        });
      });

      socket.on("READY_STATE_UPDATED", (data) => {
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            readyPhase: data.phase ?? null,
            readyPlayerIds: data.readyPlayerIds ?? [],
          };
        });
      });

      // Game started
      socket.on("GAME_STARTED", (data) => {
        setLastHandResult(null);
        setFinalGameResult(null);
        const currentRoomId = roomRef.current?.id;
        if (currentRoomId) {
          clearStoredFinalResult(currentRoomId);
        }
        setLastPlayerActionEvent(null);
        setRevealedHandPlayerIds([]);
        setShowdownDecisionState(null);
        setRunCountDecisionState(null);
        setRevealedShowdownHandsByPlayerId({});
        setNextStreetRevealState(null);
        // Avoid clearing cards for active seats to prevent out-of-order GAME_STARTED/YOUR_CARDS races.
        // If this player is not dealt in, clear cards immediately.
        setYourCards((prevCards) => {
          const currentPlayerId = playerRef.current?.id;
          if (!currentPlayerId) return null;
          const seatForCurrentPlayer = data.players?.find(
            (p) => p.id === currentPlayerId,
          );
          return seatForCurrentPlayer?.hasCards ? prevCards : null;
        });
        setRoom((prev) => {
          if (!prev) return null;
          // Map players with cards field added
          const playersWithCards = data.players.map((p) => ({
            ...p,
            cards: null as Card[] | null,
          })) as Player[];

          return {
            ...prev,
            currentHand: data.hand as Hand,
            players: playersWithCards,
            gameState: "IN_PROGRESS",
            readyPhase: null,
            readyPlayerIds: [],
          } as Room;
        });

        // Update player chips from game start
        setPlayer((prev) => {
          if (!prev) return prev;
          const updatedPlayer = data.players.find((p) => p.id === prev.id);
          console.log("Updating player on GAME_STARTED:", {
            prev: prev.chips,
            updated: updatedPlayer?.chips,
          });
          return updatedPlayer
            ? { ...prev, ...updatedPlayer, cards: prev.cards }
            : prev;
        });
      });

      // Your cards
      socket.on("YOUR_CARDS", (data) => {
        setYourCards(data.cards);
      });

      // Community cards dealt
      socket.on("COMMUNITY_CARDS_DEALT", (data) => {
        setNextStreetRevealState(null);
        setRunCountDecisionState(null);
        setRoom((prev) => {
          if (!prev || !prev.currentHand) return prev;
          return {
            ...prev,
            currentHand: {
              ...prev.currentHand,
              communityCards: data.cards,
              bettingRound: data.round,
              runCount: data.runCount ?? prev.currentHand.runCount,
              runoutBoards: data.runoutBoards ?? prev.currentHand.runoutBoards,
              runCountDecision: null,
            },
          } as Room;
        });
      });

      // Hand complete
      socket.on("HAND_COMPLETE", (data) => {
        console.log("Hand complete:", data.result);
        setLastHandResult(data.result);
        setRevealedHandPlayerIds(data.revealedPlayerIds ?? []);
        setShowdownDecisionState(null);
        setRunCountDecisionState(null);
        setRevealedShowdownHandsByPlayerId({});
        setNextStreetRevealState(null);
        setYourCards((prevCards) => {
          const currentPlayerId = playerRef.current?.id;
          if (!currentPlayerId) return prevCards;
          const myHand = data.result.playerHands.find(
            (entry) => entry.playerId === currentPlayerId,
          );
          if (!myHand) {
            return prevCards;
          }
          if (myHand.cardsVisibility === "shown" && myHand.cards.length > 0) {
            return myHand.cards;
          }
          return prevCards;
        });
        // Mark hand paused and settle winner chips until the next GAME_STARTED arrives.
        setRoom((prev) => {
          if (!prev || !prev.currentHand) return prev;
          const updatedPlayers = prev.players.map((p) => {
            const winnerData = data.result.winners.find(
              (w) => w.playerId === p.id,
            );
            return {
              ...p,
              chips: winnerData ? p.chips + winnerData.amountWon : p.chips,
              currentBet: 0,
            };
          });
          return {
            ...prev,
            players: updatedPlayers,
            currentHand: {
              ...prev.currentHand,
              currentPlayerTurn: null,
            },
          };
        });

        setPlayer((prev) => {
          if (!prev) return prev;
          const winnerData = data.result.winners.find(
            (w) => w.playerId === prev.id,
          );
          return {
            ...prev,
            chips: winnerData ? prev.chips + winnerData.amountWon : prev.chips,
            currentBet: 0,
          };
        });
      });

      socket.on("SHOWDOWN_DECISION_STATE", (data) => {
        setShowdownDecisionState(data);
      });

      socket.on("RUN_COUNT_DECISION_STATE", (data) => {
        setRunCountDecisionState(data);
        setRoom((prev) => {
          if (!prev || !prev.currentHand) return prev;
          return {
            ...prev,
            currentHand: {
              ...prev.currentHand,
              currentPlayerTurn: null,
              runCountDecision: data
                ? {
                    eligiblePlayerIds: data.eligiblePlayerIds ?? [],
                    twiceAgreedPlayerIds: data.twiceAgreedPlayerIds ?? [],
                    expiresAt: data.expiresAt,
                  }
                : null,
            },
          } as Room;
        });
      });

      socket.on("PLAYER_HAND_REVEALED", (data) => {
        setRevealedHandPlayerIds((prev) =>
          prev.includes(data.playerId) ? prev : [...prev, data.playerId],
        );
        setRevealedShowdownHandsByPlayerId((prev) => ({
          ...prev,
          [data.playerId]: {
            playerId: data.playerId,
            playerName: data.playerName,
            cards: data.cards ?? [],
            showdownOrderIndex: data.showdownOrderIndex ?? -1,
          },
        }));
      });

      socket.on("PLAYER_HAND_MUCKED", (data) => {
        setRevealedHandPlayerIds((prev) =>
          prev.filter((playerId) => playerId !== data.playerId),
        );
        setRevealedShowdownHandsByPlayerId((prev) => {
          if (!prev[data.playerId]) {
            return prev;
          }

          const next = { ...prev };
          delete next[data.playerId];
          return next;
        });
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map((seatPlayer) =>
              seatPlayer.id === data.playerId
                ? { ...seatPlayer, status: "folded", lastAction: "fold" }
                : seatPlayer,
            ),
          };
        });
        setPlayer((prev) =>
          prev && prev.id === data.playerId
            ? { ...prev, status: "folded", lastAction: "fold" }
            : prev,
        );
      });

      socket.on("GAME_ENDED", (data) => {
        setFinalGameResult(data);
        const currentRoomId = roomRef.current?.id;
        if (currentRoomId) {
          writeStoredFinalResult(currentRoomId, data);
        }
        setLastHandResult(null);
        setLastPlayerActionEvent(null);
        setRevealedHandPlayerIds([]);
        setShowdownDecisionState(null);
        setRunCountDecisionState(null);
        setRevealedShowdownHandsByPlayerId({});
        setNextStreetRevealState(null);
        setYourCards(null);

        const standingsByPlayerId = new Map(
          data.standings.map((entry) => [entry.playerId, entry]),
        );

        setRoom((prev) => {
          if (!prev) return prev;

          return {
            ...prev,
            gameState: "ENDED",
            currentHand: null,
            readyPhase: null,
            readyPlayerIds: [],
            players: prev.players.map((seatPlayer) => {
              const standing = standingsByPlayerId.get(seatPlayer.id);
              return {
                ...seatPlayer,
                chips: standing ? standing.finalChips : seatPlayer.chips,
                currentBet: 0,
                lastAction: null,
                cards: null,
              };
            }),
          };
        });

        setPlayer((prev) => {
          if (!prev) return prev;
          const standing = standingsByPlayerId.get(prev.id);
          return {
            ...prev,
            chips: standing ? standing.finalChips : prev.chips,
            currentBet: 0,
            lastAction: null,
            cards: null,
          };
        });
      });

      // New hand starting
      socket.on("NEW_HAND_STARTING", () => {
        console.log("New hand starting, waiting for GAME_STARTED event...");
        setShowdownDecisionState(null);
        setRunCountDecisionState(null);
        setRevealedShowdownHandsByPlayerId({});
        setNextStreetRevealState(null);
      });

      socket.on("NEXT_STREET_REVEAL_STATE", (data) => {
        setNextStreetRevealState({
          nextRound: data.nextRound,
          readyPlayerIds: data.readyPlayerIds ?? [],
          requiredPlayerIds: data.requiredPlayerIds ?? [],
        });
        setRoom((prev) => {
          if (!prev || !prev.currentHand) return prev;
          return {
            ...prev,
            currentHand: {
              ...prev.currentHand,
              currentPlayerTurn: null,
              pendingStreetRevealRound: data.nextRound,
            },
          };
        });
      });

      // Player turn
      socket.on("PLAYER_TURN", (data) => {
        console.log("Player turn:", data);

        setRoom((prev) => {
          if (!prev || !prev.currentHand) return prev;
          return {
            ...prev,
            currentHand: {
              ...prev.currentHand,
              currentPlayerTurn: data.playerId,
              currentBet: data.currentBet,
              minRaise: data.minRaise,
            },
          } as Room;
        });
      });

      // Player acted
      socket.on("PLAYER_ACTED", (data) => {
        console.log("Player acted:", data);
        const roomSnapshot = roomRef.current;
        const actedPlayerBefore = roomSnapshot?.players.find(
          (p) => p.id === data.playerId,
        );
        const preRoundCurrentBet = roomSnapshot?.currentHand?.currentBet ?? 0;
        const preActionCurrentBet = actedPlayerBefore?.currentBet ?? 0;
        const chipsCommitted = actedPlayerBefore
          ? Math.max(0, actedPlayerBefore.chips - data.newChips)
          : 0;
        const committedAmount = data.committedAmount ?? chipsCommitted;
        const isNoChipAction =
          data.action === "check" || data.action === "fold";
        const totalBetAfterAction =
          data.totalBetAfterAction ??
          (isNoChipAction
            ? preActionCurrentBet
            : preActionCurrentBet + committedAmount);
        const resolvedDisplayKind =
          data.displayKind ??
          resolveFallbackDisplayKind({
            action: data.action,
            preRoundCurrentBet,
          });
        const resolvedAmount = isNoChipAction ? undefined : totalBetAfterAction;
        const resolvedStatus =
          data.playerStatus ??
          (data.action === "fold"
            ? "folded"
            : data.action === "all-in"
              ? "all-in"
              : undefined);

        setLastPlayerActionEvent({
          id: `${Date.now()}-${data.playerId}-${data.action}`,
          playerId: data.playerId,
          playerName: data.playerName,
          action: data.action,
          amount: resolvedAmount,
          isOpeningBet: resolvedDisplayKind === "bet-to",
          displayKind: resolvedDisplayKind,
          totalBetAfterAction,
          committedAmount,
          blindType: data.blindType ?? null,
          newPot: data.newPot,
          createdAt: Date.now(),
        });
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            currentHand: prev.currentHand
              ? {
                  ...prev.currentHand,
                  pot: data.newPot,
                }
              : prev.currentHand,
            players: prev.players.map((p) =>
              p.id === data.playerId
                ? {
                    // Keep currentBet in sync for call/all-in when payload has no explicit amount.
                    // We derive the committed amount from chip delta.
                    ...(() => {
                      const chipsCommitted = Math.max(
                        0,
                        p.chips - data.newChips,
                      );
                      const resolvedCommittedAmount =
                        data.committedAmount ?? chipsCommitted;
                      const nextCurrentBet =
                        data.totalBetAfterAction ??
                        (data.action === "check" || data.action === "fold"
                          ? p.currentBet
                          : p.currentBet + resolvedCommittedAmount);

                      return {
                        ...p,
                        chips: data.newChips,
                        status: resolvedStatus ?? p.status,
                        lastAction: data.action,
                        currentBet: nextCurrentBet,
                      };
                    })(),
                  }
                : p,
            ),
          } as Room;
        });

        // Update player state if it's the current player
        setPlayer((prev) => {
          if (!prev || prev.id !== data.playerId) return prev;
          const committedByDiff = Math.max(0, prev.chips - data.newChips);
          const resolvedCommittedAmount =
            data.committedAmount ?? committedByDiff;
          return {
            ...prev,
            chips: data.newChips,
            status: resolvedStatus ?? prev.status,
            lastAction: data.action,
            currentBet:
              data.totalBetAfterAction ??
              (data.action === "check" || data.action === "fold"
                ? prev.currentBet
                : prev.currentBet + resolvedCommittedAmount),
          };
        });
      });

      // Betting round complete
      socket.on("BETTING_ROUND_COMPLETE", (data) => {
        console.log("Betting round complete, next round:", data.nextRound);

        if (data.awaitingPlayerStreetReveal) {
          setNextStreetRevealState({
            nextRound: data.nextRound,
            readyPlayerIds: data.readyPlayerIds ?? [],
            requiredPlayerIds: data.requiredPlayerIds ?? [],
          });
        } else {
          setNextStreetRevealState(null);
          setRunCountDecisionState(null);
        }
        if (data.nextRound !== "SHOWDOWN") {
          setShowdownDecisionState(null);
          setRevealedShowdownHandsByPlayerId({});
        }

        // Reset all players' currentBet to 0 for the new betting round
        setRoom((prev) => {
          if (!prev) return prev;

          return {
            ...prev,
            currentHand: prev.currentHand
              ? {
                  ...prev.currentHand,
                  currentBet: 0,
                  currentPlayerTurn: data.awaitingPlayerStreetReveal
                    ? null
                    : prev.currentHand.currentPlayerTurn,
                  pendingStreetRevealRound: data.awaitingPlayerStreetReveal
                    ? data.nextRound
                    : null,
                  runCountDecision: null,
                }
              : prev.currentHand,
            players: prev.players.map((p) => ({ ...p, currentBet: 0 })),
          };
        });
      });

      socket.on("CHAT_HISTORY_SYNC", (data: ChatHistorySyncData) => {
        const normalizedMessages = normalizeChatMessages(data.messages ?? []);
        setChatMessages((prev) =>
          mergeChatMessageLists(prev, normalizedMessages),
        );
        setChatHasMore(Boolean(data.hasMore));
        setChatNextBeforeSeq(data.nextBeforeSeq ?? null);
        setChatLoadingHistory(false);
        if (chatPanelOpenRef.current) {
          setChatUnreadCount(0);
        }
      });

      socket.on("CHAT_MESSAGE_ADDED", (data) => {
        if (!data?.message) {
          return;
        }

        setChatMessages((prev) => mergeChatMessageLists(prev, [data.message]));
        if (
          !chatPanelOpenRef.current &&
          data.message.sender.playerId !== playerRef.current?.id
        ) {
          setChatUnreadCount((prev) => prev + 1);
        }
      });

      // Error
      socket.on("ERROR", (data) => {
        console.error("Socket error:", data.message);
        setLastError(data.message);
      });

      return () => {
        socket.off("ROOM_CREATED");
        socket.off("ROOM_JOINED");
        socket.off("RECONNECT_SUCCESS");
        socket.off("RECONNECT_ERROR");
        socket.off("PLAYER_JOINED");
        socket.off("PLAYER_LEFT");
        socket.off("PLAYER_DISCONNECTED");
        socket.off("PLAYER_RECONNECTED");
        socket.off("SESSION_DISPLACED");
        socket.off("PLAYER_PROFILE_UPDATED");
        socket.off("PLAYER_AUTO_FOLDED");
        socket.off("HOST_CHANGED");
        socket.off("ROOM_CONFIG_UPDATED");
        socket.off("READY_STATE_UPDATED");
        socket.off("GAME_STARTED");
        socket.off("YOUR_CARDS");
        socket.off("PLAYER_TURN");
        socket.off("PLAYER_ACTED");
        socket.off("COMMUNITY_CARDS_DEALT");
        socket.off("HAND_COMPLETE");
        socket.off("SHOWDOWN_DECISION_STATE");
        socket.off("RUN_COUNT_DECISION_STATE");
        socket.off("PLAYER_HAND_REVEALED");
        socket.off("PLAYER_HAND_MUCKED");
        socket.off("GAME_ENDED");
        socket.off("NEW_HAND_STARTING");
        socket.off("NEXT_STREET_REVEAL_STATE");
        socket.off("BETTING_ROUND_COMPLETE");
        socket.off("CHAT_HISTORY_SYNC");
        socket.off("CHAT_MESSAGE_ADDED");
        socket.off("ERROR");
      };
    },
    [clearActiveRoomState],
  );

  useEffect(() => {
    if (!socket) return;
    return registerSocketStateListeners(socket);
  }, [registerSocketStateListeners, socket]);

  const bindReconnectLifecycleListeners = useCallback(
    (socketInstance: NonNullable<typeof socket>) => {
      const socket = socketInstance;

      const attemptSessionRecovery = () => {
        if (reconnectInFlightRef.current) return;

        const roomState = roomRef.current;
        const playerState = playerRef.current;
        const fromState =
          roomState?.id && playerState?.name && playerState?.id
            ? {
                roomId: roomState.id,
                playerName: playerState.name,
                playerId: playerState.id,
              }
            : null;
        const fromStorage = readStoredSession();
        const payload = fromState ?? fromStorage;

        if (!payload) {
          setIsRecoveringSession(false);
          return;
        }

        reconnectInFlightRef.current = true;
        setIsRecoveringSession(true);
        socket.emit("RECONNECT", payload, (response) => {
          reconnectInFlightRef.current = false;
          if (response && "success" in response && !response.success) {
            const reason = response.error || "Reconnect failed";
            setIsRecoveringSession(false);
            if (isInvalidReconnectReason(reason)) {
              clearActiveRoomState({ errorMessage: reason });
              return;
            }
            setLastError(reason);
          }
        });
      };

      const handleConnect = () => {
        attemptSessionRecovery();
      };

      const handleDisconnect = () => {
        const stored = readStoredSession();
        const hasKnownSession =
          Boolean(roomRef.current?.id && playerRef.current?.name) ||
          Boolean(stored);
        setIsRecoveringSession(hasKnownSession);
      };

      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);

      if (socket.connected) {
        handleConnect();
      }

      return () => {
        socket.off("connect", handleConnect);
        socket.off("disconnect", handleDisconnect);
      };
    },
    [clearActiveRoomState],
  );

  useEffect(() => {
    if (!socket) return;
    return bindReconnectLifecycleListeners(socket);
  }, [bindReconnectLifecycleListeners, socket]);

  const createRoom = useCallback(
    (
      playerName?: string,
      playerEmoji?: string,
      options: CreateRoomOptions = {},
    ) => {
      if (!socket) return;
      setLastError(null);
      const payload: {
        playerName?: string;
        playerEmoji?: string;
        config: { useShortDeckRules: boolean; maxPlayers?: number };
      } = {
        config: {
          useShortDeckRules: Boolean(options.useShortDeckRules),
        },
      };
      if (options.maxPlayers !== undefined) {
        payload.config.maxPlayers = options.maxPlayers;
      }
      if (playerName) {
        payload.playerName = playerName;
      }
      if (playerEmoji) {
        payload.playerEmoji = playerEmoji;
      }
      socket.emit("CREATE_ROOM", payload, (response) => {
        console.log("Create room response:", response);
        if (response && "success" in response && !response.success) {
          setLastError(response.error || "Failed to create room");
        }
      });
    },
    [socket],
  );

  const joinRoom = useCallback(
    (
      roomId: string,
      playerName?: string,
      playerEmoji?: string,
    ): Promise<boolean> => {
      if (!socket) {
        setLastError("Connection unavailable");
        return Promise.resolve(false);
      }
      setLastError(null);
      const payload: {
        roomId: string;
        playerName?: string;
        playerEmoji?: string;
      } = { roomId };
      if (playerName) {
        payload.playerName = playerName;
      }
      if (playerEmoji) {
        payload.playerEmoji = playerEmoji;
      }
      return new Promise((resolve) => {
        socket.emit("JOIN_ROOM", payload, (response) => {
          console.log("Join room response:", response);
          if (response && "success" in response && !response.success) {
            setLastError(response.error || "Failed to join room");
            resolve(false);
            return;
          }
          resolve(true);
        });
      });
    },
    [socket],
  );

  const startGame = useCallback(() => {
    if (!socket) return;
    setLastError(null);
    socket.emit("START_GAME", (response) => {
      console.log("Start game response:", response);
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Failed to start game");
      }
    });
  }, [socket]);

  const startNextHand = useCallback(() => {
    if (!socket) return;
    setLastError(null);
    socket.emit("START_NEXT_HAND", (response) => {
      console.log("Start next hand response:", response);
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Failed to start next hand");
      }
    });
  }, [socket]);

  const markReady = useCallback(() => {
    if (!socket) return;
    setLastError(null);
    socket.emit("PLAYER_READY", {}, (response) => {
      console.log("Player ready response:", response);
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Failed to mark ready");
      }
    });
  }, [socket]);

  const endGame = useCallback(() => {
    if (!socket) return;
    setLastError(null);
    socket.emit("END_GAME", (response) => {
      console.log("End game response:", response);
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Failed to end game");
      }
    });
  }, [socket]);

  const showMyHand = useCallback(() => {
    if (!socket) return;
    setLastError(null);
    socket.emit("SHOW_MY_HAND", {}, (response) => {
      console.log("Show hand response:", response);
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Failed to show hand");
      }
    });
  }, [socket]);

  const muckMyHand = useCallback(() => {
    if (!socket) return;
    setLastError(null);
    socket.emit("MUCK_MY_HAND", {}, (response) => {
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Failed to fold hand");
      }
    });
  }, [socket]);

  const performAction = useCallback(
    (action: PlayerAction, amount?: number, actionId?: string) => {
      if (!socket) return;
      setLastError(null);
      socket.emit(
        "PLAYER_ACTION",
        { action, amount, actionId: actionId || createActionId() },
        (response) => {
          console.log("Action response:", response);
          if (
            response &&
            "success" in response &&
            !response.success &&
            response.error
          ) {
            setLastError(response.error);
          }
        },
      );
    },
    [socket],
  );

  const revealNextStreet = useCallback(() => {
    if (!socket) return;
    setLastError(null);
    socket.emit("REVEAL_NEXT_STREET", {}, (response) => {
      console.log("Reveal next street response:", response);
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Failed to reveal next street");
      }
    });
  }, [socket]);

  const decideRunCount = useCallback(
    (runCount: RunCount) => {
      if (!socket) return;
      setLastError(null);
      socket.emit("SET_RUN_COUNT", { runCount }, (response) => {
        console.log("Set run count response:", response);
        if (response && "success" in response && !response.success) {
          setLastError(response.error || "Failed to set run count");
        }
      });
    },
    [socket],
  );

  const leaveRoom = useCallback(async (): Promise<boolean> => {
    if (!socket) {
      setLastError("Connection unavailable");
      return false;
    }

    setLastError(null);
    const currentRoomId = roomRef.current?.id;

    const didLeave = await new Promise<boolean>((resolve) => {
      socket.emit("LEAVE_ROOM", (response?: { success?: boolean; error?: string }) => {
        if (response && "success" in response && !response.success) {
          setLastError(response.error || "Failed to leave room");
          resolve(false);
          return;
        }
        resolve(true);
      });
    });

    if (!didLeave) {
      return false;
    }

    if (currentRoomId) {
      clearStoredFinalResult(currentRoomId);
    }
    clearActiveRoomState({ markJustLeft: true });

    return true;
  }, [clearActiveRoomState, socket]);

  const requestRebuy = useCallback(
    (amount: number) => {
      if (!socket) return;
      setLastError(null);
      socket.emit("REQUEST_REBUY", { amount }, (response) => {
        console.log("Rebuy response:", response);
        if (response && "success" in response && !response.success) {
          setLastError(response.error || "Rebuy request failed");
        }
      });
    },
    [socket],
  );

  const updateRoomConfig = useCallback(
    (config: Partial<Pick<RoomConfig, "allowPlayerStreetReveal">>) => {
      if (!socket) return;
      setLastError(null);
      socket.emit("UPDATE_ROOM_CONFIG", { config }, (response) => {
        console.log("Update room config response:", response);
        if (response && "success" in response && !response.success) {
          setLastError(response.error || "Failed to update room settings");
        }
      });
    },
    [socket],
  );

  const addRobotPlayer = useCallback(
    (name?: string, emoji?: string) => {
      if (!socket) return;
      setLastError(null);
      socket.emit("ADD_ROBOT_PLAYER", { name, emoji }, (response) => {
        if (response && "success" in response && !response.success) {
          setLastError(response.error || "Failed to add robot player");
        }
      });
    },
    [socket],
  );

  const removeRobotPlayer = useCallback(
    (playerId: string) => {
      if (!socket) return;
      setLastError(null);
      socket.emit("REMOVE_ROBOT_PLAYER", { playerId }, (response) => {
        if (response && "success" in response && !response.success) {
          setLastError(response.error || "Failed to remove robot player");
        }
      });
    },
    [socket],
  );

  const setChatPanelOpen = useCallback((open: boolean) => {
    setIsChatPanelOpenState(open);
    if (open) {
      setChatUnreadCount(0);
    }
  }, []);

  const clearChatUnread = useCallback(() => {
    setChatUnreadCount(0);
  }, []);

  const sendChatPayload = useCallback(
    (payload: SendChatMessageData) => {
      if (!socket) return;
      setLastError(null);
      socket.emit(
        "SEND_CHAT_MESSAGE",
        payload,
        (response: {
          success?: boolean;
          error?: string;
          message?: ChatMessage;
        }) => {
          if (!response?.success) {
            setLastError(response?.error || "Failed to send message");
            return;
          }

          const message = response.message;
          if (message) {
            setChatMessages((prev) => mergeChatMessageLists(prev, [message]));
          }
        },
      );
    },
    [socket],
  );

  const sendChatText = useCallback(
    (text: string, clientMessageId?: string) => {
      const normalizedText = text.trim();
      if (!normalizedText) {
        return;
      }

      sendChatPayload({
        kind: "TEXT",
        text: normalizedText,
        clientMessageId: clientMessageId || createActionId(),
      });
    },
    [sendChatPayload],
  );

  const sendChatVoice = useCallback(
    (voice: VoiceMessagePayload, clientMessageId?: string) => {
      sendChatPayload({
        kind: "VOICE",
        voice,
        clientMessageId: clientMessageId || createActionId(),
      });
    },
    [sendChatPayload],
  );

  const loadOlderChatMessages = useCallback(() => {
    if (
      !socket ||
      chatLoadingHistory ||
      !chatHasMore ||
      chatNextBeforeSeq === null
    ) {
      return;
    }

    setChatLoadingHistory(true);
    socket.emit(
      "GET_CHAT_HISTORY",
      {
        beforeSeq: chatNextBeforeSeq,
        limit: CHAT_HISTORY_PAGE_LIMIT,
      },
      (response: {
        success?: boolean;
        error?: string;
        messages?: ChatMessage[];
        hasMore?: boolean;
        nextBeforeSeq?: number | null;
      }) => {
        setChatLoadingHistory(false);
        if (!response?.success) {
          setLastError(response?.error || "Failed to load chat history");
          return;
        }

        setChatMessages((prev) =>
          mergeChatMessageLists(response.messages ?? [], prev),
        );
        setChatHasMore(Boolean(response.hasMore));
        setChatNextBeforeSeq(response.nextBeforeSeq ?? null);
      },
    );
  }, [socket, chatLoadingHistory, chatHasMore, chatNextBeforeSeq]);

  const clearError = useCallback(() => setLastError(null), []);

  const isHost = player?.id === room?.hostId;

  // Expose debug functions to window for testing
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.pokerDebug = {
        getRoom: () => room,
        getPlayer: () => player,
        getCards: () => yourCards,
        getLastHandResult: () => lastHandResult,
        getFinalGameResult: () => finalGameResult,
        getLastPlayerActionEvent: () => lastPlayerActionEvent,
        getRevealedHandPlayerIds: () => revealedHandPlayerIds,
        getShowdownDecisionState: () => showdownDecisionState,
        getRunCountDecisionState: () => runCountDecisionState,
        getRevealedShowdownHandsByPlayerId: () =>
          revealedShowdownHandsByPlayerId,
        getNextStreetRevealState: () => nextStreetRevealState,
        getSocket: () => socket,
        createRoom,
        joinRoom,
        startGame,
        startNextHand,
        markReady,
        endGame,
        showMyHand,
        muckMyHand,
        revealNextStreet,
        decideRunCount,
        performAction,
        fold: () => performAction("fold"),
        check: () => performAction("check"),
        call: () => performAction("call"),
        raise: (amount: number) => performAction("raise", amount),
        allIn: () => performAction("all-in"),
        leaveRoom,
        requestRebuy,
        updateRoomConfig,
        addRobotPlayer,
        removeRobotPlayer,
        getChatMessages: () => chatMessages,
        getChatUnreadCount: () => chatUnreadCount,
        sendChatText,
        sendChatVoice,
        loadOlderChatMessages,
        setChatPanelOpen,
        clearChatUnread,
        getVoicePlaybackState,
        clearError,
        emitCustom: (event, data) => {
          const rawSocket = socket as unknown as {
            emit: (...args: unknown[]) => void;
          } | null;
          rawSocket?.emit(event, data);
        },
        logState: () => {
          console.log("Room:", room);
          console.log("Player:", player);
          console.log("Your Cards:", yourCards);
          console.log("Is Host:", isHost);
        },
      };
    }
  }, [
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
    socket,
    isHost,
    createRoom,
    joinRoom,
    startGame,
    startNextHand,
    markReady,
    endGame,
    showMyHand,
    muckMyHand,
    revealNextStreet,
    decideRunCount,
    performAction,
    leaveRoom,
    requestRebuy,
    updateRoomConfig,
    addRobotPlayer,
    removeRobotPlayer,
    chatMessages,
    chatUnreadCount,
    sendChatText,
    sendChatVoice,
    loadOlderChatMessages,
    setChatPanelOpen,
    clearChatUnread,
    clearError,
  ]);

  return (
    <GameContext.Provider
      value={{
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
        isRecoveringSession,
        lastError,
        chatMessages,
        chatHasMore,
        chatLoadingHistory,
        chatUnreadCount,
        isChatPanelOpen,
        createRoom,
        joinRoom,
        startGame,
        startNextHand,
        markReady,
        endGame,
        showMyHand,
        muckMyHand,
        revealNextStreet,
        decideRunCount,
        performAction,
        leaveRoom,
        requestRebuy,
        updateRoomConfig,
        addRobotPlayer,
        removeRobotPlayer,
        sendChatText,
        sendChatVoice,
        loadOlderChatMessages,
        setChatPanelOpen,
        clearChatUnread,
        clearError,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const GameProvider: React.FC<GameProviderProps> = (props) =>
  useGameProviderElement(props);
