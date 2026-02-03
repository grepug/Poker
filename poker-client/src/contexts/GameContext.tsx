import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { Room, Player, Card, PlayerAction, Hand } from "poker-types";
import { useSocket } from "./SocketContext";

interface GameContextType {
  room: Room | null;
  player: Player | null;
  yourCards: Card[] | null;
  isHost: boolean;
  createRoom: (playerName: string) => void;
  joinRoom: (roomId: string, playerName: string) => void;
  startGame: () => void;
  performAction: (action: PlayerAction, amount?: number) => void;
  leaveRoom: () => void;
  requestRebuy: (amount: number) => void;
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

export const GameProvider: React.FC<GameProviderProps> = ({ children }) => {
  const { socket } = useSocket();
  const [room, setRoom] = useState<Room | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [yourCards, setYourCards] = useState<Card[] | null>(null);

  useEffect(() => {
    if (!socket) return;

    // Room created
    socket.on("ROOM_CREATED", (data) => {
      setRoom(data.room as any); // SanitizedRoom from server
      const host = data.room.players[0];
      setPlayer({ ...host, cards: null } as Player);
      console.log("Room created:", data.roomId);
    });

    // Room joined
    socket.on("ROOM_JOINED", (data) => {
      setRoom(data.room as any); // SanitizedRoom from server
      setPlayer(data.player);
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

    // Host changed
    socket.on("HOST_CHANGED", (data) => {
      setRoom((prev) => {
        if (!prev) return null;
        return { ...prev, hostId: data.newHostId };
      });
    });

    // Game started
    socket.on("GAME_STARTED", (data) => {
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

    // Player turn
    socket.on("PLAYER_TURN", (data) => {
      console.log("Player turn:", data);
    });

    // Player acted
    socket.on("PLAYER_ACTED", (data) => {
      setRoom((prev) => {
        if (!prev || !prev.currentHand) return prev;

        const updatedPlayers = prev.players.map((p) =>
          p.id === data.playerId ? { ...p, chips: data.newChips } : p,
        );

        return {
          ...prev,
          players: updatedPlayers,
          currentHand: {
            ...prev.currentHand,
            pot: data.newPot,
          },
        };
      });
    });

    // Community cards dealt
    socket.on("COMMUNITY_CARDS_DEALT", (data) => {
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
      // Update chips for winners
      setRoom((prev) => {
        if (!prev) return prev;
        const updatedPlayers = prev.players.map((p) => {
          const winnerData = data.result.winners.find(
            (w) => w.playerId === p.id,
          );
          if (winnerData) {
            return { ...p, chips: p.chips + winnerData.amountWon };
          }
          return p;
        });
        return { ...prev, players: updatedPlayers };
      });
    });

    // New hand starting
    socket.on("NEW_HAND_STARTING", () => {
      console.log("New hand starting, waiting for GAME_STARTED event...");
    });

    // Player turn
    socket.on("PLAYER_TURN", (data) => {
      console.log("Player turn:", data);
      // Update currentPlayerTurn
      setRoom((prev) => {
        if (!prev || !prev.currentHand) return prev;
        return {
          ...prev,
          currentHand: {
            ...prev.currentHand,
            currentPlayerTurn: data.playerId,
          },
        } as Room;
      });
    });

    // Player acted
    socket.on("PLAYER_ACTED", (data) => {
      console.log("Player acted:", data);
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
                  ...p,
                  chips: data.newChips,
                  lastAction: data.action,
                  currentBet: data.amount || p.currentBet,
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
    });

    // Error
    socket.on("ERROR", (data) => {
      console.error("Socket error:", data.message);
      alert(data.message);
    });

    return () => {
      socket.off("ROOM_CREATED");
      socket.off("ROOM_JOINED");
      socket.off("PLAYER_JOINED");
      socket.off("PLAYER_LEFT");
      socket.off("HOST_CHANGED");
      socket.off("GAME_STARTED");
      socket.off("YOUR_CARDS");
      socket.off("PLAYER_TURN");
      socket.off("PLAYER_ACTED");
      socket.off("COMMUNITY_CARDS_DEALT");
      socket.off("HAND_COMPLETE");
      socket.off("NEW_HAND_STARTING");
      socket.off("BETTING_ROUND_COMPLETE");
      socket.off("ERROR");
    };
  }, [socket]);

  const createRoom = (playerName: string) => {
    if (!socket) return;
    socket.emit("CREATE_ROOM", { playerName }, (response) => {
      console.log("Create room response:", response);
    });
  };

  const joinRoom = (roomId: string, playerName: string) => {
    if (!socket) return;
    socket.emit("JOIN_ROOM", { roomId, playerName }, (response) => {
      console.log("Join room response:", response);
    });
  };

  const startGame = () => {
    if (!socket) return;
    socket.emit("START_GAME", (response) => {
      console.log("Start game response:", response);
    });
  };

  const performAction = (action: PlayerAction, amount?: number) => {
    if (!socket) return;
    socket.emit("PLAYER_ACTION", { action, amount }, (response) => {
      console.log("Action response:", response);
    });
  };

  const leaveRoom = () => {
    if (!socket) return;
    socket.emit("LEAVE_ROOM", () => {
      setRoom(null);
      setPlayer(null);
      setYourCards(null);
    });
  };

  const requestRebuy = (amount: number) => {
    if (!socket) return;
    socket.emit("REQUEST_REBUY", { amount }, (response) => {
      console.log("Rebuy response:", response);
    });
  };

  const isHost = player?.id === room?.hostId;

  // Expose debug functions to window for testing
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).pokerDebug = {
        getRoom: () => room,
        getPlayer: () => player,
        getCards: () => yourCards,
        getSocket: () => socket,
        createRoom,
        joinRoom,
        startGame,
        performAction,
        fold: () => performAction("fold"),
        check: () => performAction("check"),
        call: () => performAction("call"),
        raise: (amount: number) => performAction("raise", amount),
        allIn: () => performAction("all-in"),
        leaveRoom,
        requestRebuy,
        emitCustom: (event: string, data: any) =>
          socket?.emit(event as any, data),
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
    socket,
    isHost,
    createRoom,
    joinRoom,
    startGame,
    performAction,
    leaveRoom,
    requestRebuy,
  ]);

  return (
    <GameContext.Provider
      value={{
        room,
        player,
        yourCards,
        isHost,
        createRoom,
        joinRoom,
        startGame,
        performAction,
        leaveRoom,
        requestRebuy,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};
