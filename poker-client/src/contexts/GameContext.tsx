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
  Player,
  Card,
  PlayerAction,
  BettingRound,
  Hand,
  HandResult,
  GameEndedData,
  ClientToServerEvents,
} from "poker-types";
import { useSocket } from "./SocketContext";
import { writeLastPlayerEmoji, writeLastPlayerName } from "../utils/player-name-storage";

export interface PlayerActionFlashEvent {
  id: string;
  playerId: string;
  playerName: string;
  action: PlayerAction;
  amount?: number;
  isOpeningBet?: boolean;
  newPot: number;
  createdAt: number;
}

export interface NextStreetRevealState {
  nextRound: BettingRound;
  readyPlayerIds: string[];
  requiredPlayerIds: string[];
}

type DebugApi = {
  getRoom: () => Room | null;
  getPlayer: () => Player | null;
  getCards: () => Card[] | null;
  getLastHandResult: () => HandResult | null;
  getFinalGameResult: () => GameEndedData | null;
  getLastPlayerActionEvent: () => PlayerActionFlashEvent | null;
  getRevealedHandPlayerIds: () => string[];
  getNextStreetRevealState: () => NextStreetRevealState | null;
  getSocket: () => ReturnType<typeof useSocket>["socket"];
  createRoom: (name: string, emoji?: string) => void;
  joinRoom: (roomId: string, name: string, emoji?: string) => void;
  startGame: () => void;
  startNextHand: () => void;
  endGame: () => void;
  showMyHand: () => void;
  revealNextStreet: () => void;
  performAction: (action: PlayerAction, amount?: number, actionId?: string) => void;
  fold: () => void;
  check: () => void;
  call: () => void;
  raise: (amount: number) => void;
  allIn: () => void;
  leaveRoom: () => void;
  requestRebuy: (amount: number) => void;
  updateRoomConfig: (
    config: Partial<Pick<RoomConfig, "allowPlayerStreetReveal">>,
  ) => void;
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
  nextStreetRevealState: NextStreetRevealState | null;
  isHost: boolean;
  isRecoveringSession: boolean;
  lastError: string | null;
  createRoom: (playerName: string, playerEmoji?: string) => void;
  joinRoom: (roomId: string, playerName: string, playerEmoji?: string) => void;
  startGame: () => void;
  startNextHand: () => void;
  endGame: () => void;
  showMyHand: () => void;
  revealNextStreet: () => void;
  performAction: (action: PlayerAction, amount?: number, actionId?: string) => void;
  leaveRoom: () => void;
  requestRebuy: (amount: number) => void;
  updateRoomConfig: (
    config: Partial<Pick<RoomConfig, "allowPlayerStreetReveal">>,
  ) => void;
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

function isInvalidReconnectReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized.includes("not found");
}

declare global {
  interface Window {
    pokerDebug?: DebugApi;
  }
}

export const GameProvider: React.FC<GameProviderProps> = ({ children }) => {
  const { socket } = useSocket();
  const [room, setRoom] = useState<Room | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [yourCards, setYourCards] = useState<Card[] | null>(null);
  const [lastHandResult, setLastHandResult] = useState<HandResult | null>(null);
  const [finalGameResult, setFinalGameResult] = useState<GameEndedData | null>(null);
  const [lastPlayerActionEvent, setLastPlayerActionEvent] =
    useState<PlayerActionFlashEvent | null>(null);
  const [revealedHandPlayerIds, setRevealedHandPlayerIds] = useState<string[]>([]);
  const [nextStreetRevealState, setNextStreetRevealState] =
    useState<NextStreetRevealState | null>(null);
  const [isRecoveringSession, setIsRecoveringSession] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const playerRef = useRef<Player | null>(null);
  const reconnectInFlightRef = useRef(false);

  useEffect(() => {
    roomRef.current = room;
    playerRef.current = player;
  }, [room, player]);

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

  useEffect(() => {
    if (!socket) return;

    // Room created
    socket.on("ROOM_CREATED", (data) => {
      setRoom(data.room as unknown as Room); // SanitizedRoom from server
      const host = data.room.players[0];
      setPlayer({ ...host, cards: null } as Player);
      setYourCards(null);
      setLastPlayerActionEvent(null);
      setFinalGameResult(null);
      setNextStreetRevealState(null);
      setIsRecoveringSession(false);
      console.log("Room created:", data.roomId);
    });

    // Room joined
    socket.on("ROOM_JOINED", (data) => {
      setRoom(data.room as unknown as Room); // SanitizedRoom from server
      setPlayer(data.player);
      setYourCards(data.player?.cards ?? null);
      setLastPlayerActionEvent(null);
      setFinalGameResult(null);
      setNextStreetRevealState(null);
      setIsRecoveringSession(false);
      setLastError(null);
    });

    // Explicit reconnect success
    socket.on("RECONNECT_SUCCESS", (data) => {
      setRoom(data.room as unknown as Room);
      setPlayer(data.player as Player);
      setYourCards(data.yourCards ?? null);
      setLastPlayerActionEvent(null);
      setFinalGameResult(null);
      setNextStreetRevealState(null);
      setLastError(null);
      setIsRecoveringSession(false);
      reconnectInFlightRef.current = false;
    });

    // Explicit reconnect failure
    socket.on("RECONNECT_ERROR", (data) => {
      const reason = data.reason || "Reconnect failed";
      reconnectInFlightRef.current = false;
      setIsRecoveringSession(false);
      if (isInvalidReconnectReason(reason)) {
        clearStoredSession();
        setRoom(null);
        setPlayer(null);
        setYourCards(null);
      }
      setLastError(reason);
    });

    // Player joined
    socket.on("PLAYER_JOINED", (data) => {
      setRoom((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          players: [...prev.players, { ...data.player, cards: null } as Player],
        } as Room;
      });
    });

    // Player left
    socket.on("PLAYER_LEFT", (data) => {
      setRoom((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          players: prev.players.filter((p) => p.id !== data.playerId),
        };
      });
    });

    socket.on("PLAYER_DISCONNECTED", (data) => {
      setRoom((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          players: prev.players.map((p) =>
            p.id === data.playerId ? { ...p, status: "disconnected" } : p,
          ),
        };
      });
      setPlayer((prev) =>
        prev && prev.id === data.playerId
          ? { ...prev, status: "disconnected" }
          : prev,
      );
    });

    socket.on("PLAYER_RECONNECTED", (data) => {
      setRoom((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          players: prev.players.map((p) =>
            p.id === data.playerId ? { ...p, status: "connected" } : p,
          ),
        };
      });
      setPlayer((prev) =>
        prev && prev.id === data.playerId
          ? { ...prev, status: "connected" }
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

    // Game started
    socket.on("GAME_STARTED", (data) => {
      setLastHandResult(null);
      setFinalGameResult(null);
      setLastPlayerActionEvent(null);
      setRevealedHandPlayerIds([]);
      setNextStreetRevealState(null);
      // Reset hole cards until private YOUR_CARDS event arrives for this hand.
      setYourCards(null);
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
      setRoom((prev) => {
        if (!prev || !prev.currentHand) return prev;
        return {
          ...prev,
          currentHand: {
            ...prev.currentHand,
            communityCards: data.cards,
            bettingRound: data.round,
          },
        } as Room;
      });
    });

    // Hand complete
    socket.on("HAND_COMPLETE", (data) => {
      console.log("Hand complete:", data.result);
      setLastHandResult(data.result);
      setRevealedHandPlayerIds(data.revealedPlayerIds ?? []);
      setNextStreetRevealState(null);
      setYourCards((prevCards) => {
        const currentPlayerId = playerRef.current?.id;
        if (!currentPlayerId) return prevCards;
        const myHand = data.result.playerHands.find(
          (entry) => entry.playerId === currentPlayerId,
        );
        return myHand?.cards ?? prevCards;
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
        const winnerData = data.result.winners.find((w) => w.playerId === prev.id);
        return {
          ...prev,
          chips: winnerData ? prev.chips + winnerData.amountWon : prev.chips,
          currentBet: 0,
        };
      });
    });

    socket.on("PLAYER_HAND_REVEALED", (data) => {
      setRevealedHandPlayerIds((prev) =>
        prev.includes(data.playerId) ? prev : [...prev, data.playerId],
      );
    });

    socket.on("GAME_ENDED", (data) => {
      setFinalGameResult(data);
      setLastHandResult(null);
      setLastPlayerActionEvent(null);
      setRevealedHandPlayerIds([]);
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
      setNextStreetRevealState(null);
    });

    socket.on("NEXT_STREET_REVEAL_STATE", (data) => {
      setNextStreetRevealState({
        nextRound: data.nextRound,
        readyPlayerIds: data.readyPlayerIds ?? [],
        requiredPlayerIds: data.requiredPlayerIds ?? [],
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
      const actedPlayerBefore = roomSnapshot?.players.find((p) => p.id === data.playerId);
      const chipsCommitted = actedPlayerBefore
        ? Math.max(0, actedPlayerBefore.chips - data.newChips)
        : undefined;
      const resolvedAmount =
        data.amount ??
        (data.action === "check" || data.action === "fold" ? undefined : chipsCommitted);
      setLastPlayerActionEvent({
        id: `${Date.now()}-${data.playerId}-${data.action}`,
        playerId: data.playerId,
        playerName: data.playerName,
        action: data.action,
        amount: resolvedAmount,
        isOpeningBet: (roomSnapshot?.currentHand?.currentBet ?? 0) === 0,
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
                    const chipsCommitted = Math.max(0, p.chips - data.newChips);
                    const nextCurrentBet =
                      data.action === "check" || data.action === "fold"
                        ? p.currentBet
                        : p.currentBet + chipsCommitted;

                    return {
                      ...p,
                      chips: data.newChips,
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
        return { ...prev, chips: data.newChips, lastAction: data.action };
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
      }

      // Reset all players' currentBet to 0 for the new betting round
      setRoom((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          players: prev.players.map((p) => ({ ...p, currentBet: 0 })),
        };
      });
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
      socket.off("PLAYER_AUTO_FOLDED");
      socket.off("HOST_CHANGED");
      socket.off("ROOM_CONFIG_UPDATED");
      socket.off("GAME_STARTED");
      socket.off("YOUR_CARDS");
      socket.off("PLAYER_TURN");
      socket.off("PLAYER_ACTED");
      socket.off("COMMUNITY_CARDS_DEALT");
      socket.off("HAND_COMPLETE");
      socket.off("PLAYER_HAND_REVEALED");
      socket.off("GAME_ENDED");
      socket.off("NEW_HAND_STARTING");
      socket.off("NEXT_STREET_REVEAL_STATE");
      socket.off("BETTING_ROUND_COMPLETE");
      socket.off("ERROR");
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

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
            clearStoredSession();
            setRoom(null);
            setPlayer(null);
            setYourCards(null);
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
        Boolean(roomRef.current?.id && playerRef.current?.name) || Boolean(stored);
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
  }, [socket]);

  const createRoom = useCallback((playerName: string, playerEmoji?: string) => {
    if (!socket) return;
    setLastError(null);
    socket.emit("CREATE_ROOM", { playerName, playerEmoji }, (response) => {
      console.log("Create room response:", response);
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Failed to create room");
      }
    });
  }, [socket]);

  const joinRoom = useCallback((roomId: string, playerName: string, playerEmoji?: string) => {
    if (!socket) return;
    setLastError(null);
    socket.emit("JOIN_ROOM", { roomId, playerName, playerEmoji }, (response) => {
      console.log("Join room response:", response);
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Failed to join room");
      }
    });
  }, [socket]);

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

  const performAction = useCallback((action: PlayerAction, amount?: number, actionId?: string) => {
    if (!socket) return;
    setLastError(null);
    socket.emit("PLAYER_ACTION", { action, amount, actionId: actionId || createActionId() }, (response) => {
      console.log("Action response:", response);
      if (response && "success" in response && !response.success && response.error) {
        setLastError(response.error);
      }
    });
  }, [socket]);

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

  const leaveRoom = useCallback(() => {
    if (typeof window !== "undefined") {
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
    setNextStreetRevealState(null);
    setIsRecoveringSession(false);
    setLastError(null);

    if (!socket) return;
    socket.emit("LEAVE_ROOM", () => {
      // Local state is already cleared optimistically.
    });
  }, [socket]);

  const requestRebuy = useCallback((amount: number) => {
    if (!socket) return;
    setLastError(null);
    socket.emit("REQUEST_REBUY", { amount }, (response) => {
      console.log("Rebuy response:", response);
      if (response && "success" in response && !response.success) {
        setLastError(response.error || "Rebuy request failed");
      }
    });
  }, [socket]);

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
        getNextStreetRevealState: () => nextStreetRevealState,
        getSocket: () => socket,
        createRoom,
        joinRoom,
        startGame,
        startNextHand,
        endGame,
        showMyHand,
        revealNextStreet,
        performAction,
        fold: () => performAction("fold"),
        check: () => performAction("check"),
        call: () => performAction("call"),
        raise: (amount: number) => performAction("raise", amount),
        allIn: () => performAction("all-in"),
        leaveRoom,
        requestRebuy,
        updateRoomConfig,
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
    nextStreetRevealState,
    socket,
    isHost,
    createRoom,
    joinRoom,
    startGame,
    startNextHand,
    endGame,
    showMyHand,
    revealNextStreet,
    performAction,
    leaveRoom,
    requestRebuy,
    updateRoomConfig,
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
        nextStreetRevealState,
        isHost,
        isRecoveringSession,
        lastError,
        createRoom,
        joinRoom,
        startGame,
        startNextHand,
        endGame,
        showMyHand,
        revealNextStreet,
        performAction,
        leaveRoom,
        requestRebuy,
        updateRoomConfig,
        clearError,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};
