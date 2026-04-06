import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  Room,
  RoomConfig,
  Player,
  PlayerStatus,
  ReadyPhase,
} from 'poker-types';
import { IStorageService } from '../common/interfaces/storage.interface';
import { generateRoomId, generatePlayerId } from '../common/utils/id-generator';

type ServerPlayer = Player & { userId?: string };

const MIN_ROOM_PLAYERS = 2;
const MAX_ROOM_PLAYERS = 20;

const normalizeMaxPlayers = (maxPlayers: unknown): number => {
  const parsedMaxPlayers = Number(maxPlayers);
  if (
    !Number.isFinite(parsedMaxPlayers) ||
    !Number.isInteger(parsedMaxPlayers) ||
    parsedMaxPlayers < MIN_ROOM_PLAYERS ||
    parsedMaxPlayers > MAX_ROOM_PLAYERS
  ) {
    throw new Error(
      `maxPlayers must be an integer between ${MIN_ROOM_PLAYERS} and ${MAX_ROOM_PLAYERS}`,
    );
  }

  return parsedMaxPlayers;
};

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  constructor(
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
  ) {}

  /**
   * Create a new game room
   */
  async createRoom(
    hostSocketId: string,
    hostName: string,
    hostEmoji?: string,
    config?: Partial<RoomConfig>,
    hostUserId?: string,
  ): Promise<Room> {
    const roomId = generateRoomId();
    const hostId = generatePlayerId();

    const defaultConfig: RoomConfig = {
      startingChips: 1000,
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 20,
      useShortDeckRules: false,
      reconnectGracePeriod: 120000,
      allowPlayerStreetReveal: process.env.TEST_MODE ? false : true,
    };
    const normalizedConfig =
      config && Object.prototype.hasOwnProperty.call(config, 'maxPlayers')
        ? { ...config, maxPlayers: normalizeMaxPlayers(config.maxPlayers) }
        : config;

    const host: ServerPlayer = {
      id: hostId,
      userId: hostUserId,
      socketId: hostSocketId,
      name: hostName,
      emoji: hostEmoji,
      chips: 0, // Chips assigned when game starts
      totalBuyIn: 0,
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
      position: 0,
      status: 'waiting' as PlayerStatus,
      cards: null,
      currentBet: 0,
      lastAction: null,
      lastConnectedAt: Date.now(),
    };

    const room: Room = {
      id: roomId,
      hostId,
      config: { ...defaultConfig, ...normalizedConfig },
      players: [host],
      gameState: 'WAITING',
      currentHand: null,
      readyPhase: 'START_GAME' as ReadyPhase,
      readyPlayerIds: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    await this.storageService.saveRoom(room);
    this.logger.log(`Room ${roomId} created by ${hostName}`);

    return room;
  }

  /**
   * Add a player to a room
   */
  async addPlayerToRoom(
    roomId: string,
    socketId: string,
    playerName: string,
    playerEmoji?: string,
    userId?: string,
  ): Promise<{ room: Room; player: Player; rejoined: boolean }> {
    const normalizedPlayerName = playerName.trim();
    if (!normalizedPlayerName) {
      throw new Error('Player name cannot be empty');
    }

    const room = await this.storageService.getRoom(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    if (room.gameState === 'ENDED') {
      throw new Error('Cannot join room - game has ended');
    }

    const playersWithUserId = room.players as ServerPlayer[];
    const existingPlayerByUserId = userId
      ? playersWithUserId.find((player) => player.userId === userId)
      : undefined;
    const existingPlayer =
      existingPlayerByUserId ??
      playersWithUserId.find((p) => p.name === normalizedPlayerName);
    if (existingPlayer) {
      if (
        existingPlayer.status !== 'disconnected' &&
        existingPlayer.status !== 'left'
      ) {
        throw new Error('Name already taken');
      }

      const priorStatus = existingPlayer.status;
      const maxPlayers = room.config.maxPlayers;
      if (priorStatus === 'left') {
        const seatedPlayers = this.getSeatedPlayers(room);
        const reclaimedSeatUnavailable =
          existingPlayer.position < 0 ||
          existingPlayer.position >= maxPlayers ||
          seatedPlayers.some(
            (player) => player.position === existingPlayer.position,
          );

        if (reclaimedSeatUnavailable) {
          if (seatedPlayers.length >= maxPlayers) {
            throw new Error('Room is full');
          }

          const nextPosition = this.findNextAvailablePosition(room);
          if (nextPosition < 0 || nextPosition >= maxPlayers) {
            throw new Error('Room is full');
          }
          existingPlayer.position = nextPosition;
        }
      }

      existingPlayer.socketId = socketId;
      existingPlayer.status =
        priorStatus === 'left' ? ('waiting' as PlayerStatus) : 'connected';
      existingPlayer.lastConnectedAt = Date.now();
      if (priorStatus === 'left') {
        existingPlayer.cards = null;
        existingPlayer.currentBet = 0;
        existingPlayer.lastAction = null;
      }
      if (playerEmoji !== undefined) {
        existingPlayer.emoji = playerEmoji;
      }
      if (userId) {
        existingPlayer.userId = userId;
      }
      existingPlayer.name = normalizedPlayerName;
      room.lastActivityAt = Date.now();

      await this.storageService.saveRoom(room);
      this.logger.log(
        `Player ${normalizedPlayerName} reclaimed seat in room ${roomId}`,
      );

      return { room, player: existingPlayer, rejoined: true };
    }

    // Check if room is full
    const seatedPlayers = this.getSeatedPlayers(room);
    if (seatedPlayers.length >= room.config.maxPlayers) {
      throw new Error('Room is full');
    }

    const joinsDuringActiveGame = room.gameState === 'IN_PROGRESS';
    const playerId = generatePlayerId();
    const position = this.findNextAvailablePosition(room);
    if (position < 0 || position >= room.config.maxPlayers) {
      throw new Error('Room is full');
    }
    const initialChips = joinsDuringActiveGame ? room.config.startingChips : 0;
    const initialBuyIn = joinsDuringActiveGame ? room.config.startingChips : 0;

    const player: ServerPlayer = {
      id: playerId,
      userId,
      socketId,
      name: normalizedPlayerName,
      emoji: playerEmoji,
      chips: initialChips,
      totalBuyIn: initialBuyIn,
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
      position,
      status: 'waiting' as PlayerStatus,
      cards: null,
      currentBet: 0,
      lastAction: null,
      lastConnectedAt: Date.now(),
    };

    room.players.push(player);
    room.lastActivityAt = Date.now();

    await this.storageService.saveRoom(room);
    this.logger.log(`Player ${normalizedPlayerName} joined room ${roomId}`);

    return { room, player, rejoined: false };
  }

  /**
   * Remove a player from a room
   */
  async removePlayerFromRoom(
    roomId: string,
    playerId: string,
  ): Promise<Room | null> {
    const room = await this.storageService.getRoom(roomId);

    if (!room) {
      return null;
    }

    const playerIndex = room.players.findIndex((p) => p.id === playerId);
    if (playerIndex === -1) {
      return room;
    }

    const player = room.players[playerIndex];
    if (player.status === 'left') {
      return room;
    }
    player.status = 'left';
    player.socketId = '';
    player.cards = null;
    player.currentBet = 0;
    player.lastAction = null;
    player.lastConnectedAt = Date.now();

    if (room.currentHand) {
      room.currentHand.activePlayers = room.currentHand.activePlayers.filter(
        (id) => id !== playerId,
      );
      if (room.currentHand.roundActions?.[playerId]) {
        delete room.currentHand.roundActions[playerId];
      }
      if (room.currentHand.currentPlayerTurn === playerId) {
        room.currentHand.currentPlayerTurn = null;
      }
    }
    room.readyPlayerIds = (room.readyPlayerIds || []).filter(
      (readyPlayerId) => readyPlayerId !== playerId,
    );
    room.lastActivityAt = Date.now();

    this.logger.log(`Player ${player.name} marked left in room ${roomId}`);

    // If room is empty, delete it
    const seatedPlayers = this.getSeatedPlayers(room);
    if (seatedPlayers.length === 0) {
      await this.storageService.deleteRoom(roomId);
      this.logger.log(`Room ${roomId} deleted (empty)`);
      return null;
    }

    // If host left, transfer to next player
    if (room.hostId === playerId) {
      const newHost = seatedPlayers[0];
      room.hostId = newHost.id;
      this.logger.log(`Host transferred to ${newHost.name} in room ${roomId}`);
    }

    await this.storageService.saveRoom(room);
    return room;
  }

  /**
   * Update player socket ID (for reconnection)
   */
  async updatePlayerSocket(
    roomId: string,
    playerName: string,
    newSocketId: string,
    playerId?: string,
    userId?: string,
  ): Promise<Player | null> {
    const normalizedPlayerName = playerName.trim();
    const room = await this.storageService.getRoom(roomId);

    if (!room) {
      return null;
    }

    const playersWithUserId = room.players as ServerPlayer[];
    const player = playerId
      ? playersWithUserId.find((p) => p.id === playerId)
      : userId
        ? playersWithUserId.find((p) => p.userId === userId)
        : playersWithUserId.find((p) => p.name === normalizedPlayerName);
    if (!player) {
      return null;
    }
    if (player.status === 'left') {
      return null;
    }

    player.socketId = newSocketId;
    player.status = 'connected';
    player.lastConnectedAt = Date.now();
    room.lastActivityAt = Date.now();

    await this.storageService.saveRoom(room);
    this.logger.log(`Player ${player.name} reconnected in room ${roomId}`);

    return player;
  }

  /**
   * Mark player as disconnected
   */
  async markPlayerDisconnected(
    roomId: string,
    playerId: string,
  ): Promise<Room | null> {
    const room = await this.storageService.getRoom(roomId);

    if (!room) {
      return null;
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      return room;
    }
    if (player.status === 'left') {
      return room;
    }

    player.status = 'disconnected';
    room.lastActivityAt = Date.now();

    await this.storageService.saveRoom(room);
    this.logger.log(`Player ${player.name} disconnected in room ${roomId}`);

    return room;
  }

  /**
   * Add chips to player (re-buy)
   */
  async addChipsToPlayer(
    roomId: string,
    playerId: string,
    amount: number,
  ): Promise<Room | null> {
    const room = await this.storageService.getRoom(roomId);

    if (!room) {
      return null;
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      return room;
    }

    player.chips += amount;
    player.totalBuyIn += amount;
    room.lastActivityAt = Date.now();

    await this.storageService.saveRoom(room);
    this.logger.log(
      `Player ${player.name} bought ${amount} chips in room ${roomId}`,
    );

    return room;
  }

  /**
   * Find next available position in room
   */
  private findNextAvailablePosition(room: Room): number {
    const occupiedPositions = new Set(
      this.getSeatedPlayers(room).map((p) => p.position),
    );

    for (let i = 0; i < room.config.maxPlayers; i++) {
      if (!occupiedPositions.has(i)) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Transfer host to another player
   */
  async transferHost(roomId: string, newHostId: string): Promise<Room | null> {
    const room = await this.storageService.getRoom(roomId);

    if (!room) {
      return null;
    }

    const newHost = room.players.find((p) => p.id === newHostId);
    if (!newHost) {
      throw new Error('New host not found in room');
    }

    room.hostId = newHostId;
    room.lastActivityAt = Date.now();

    await this.storageService.saveRoom(room);
    this.logger.log(`Host transferred to ${newHost.name} in room ${roomId}`);

    return room;
  }

  /**
   * Validate that a room is in a valid state
   */
  validateRoomState(room: Room): boolean {
    if (!room.id || !room.hostId) {
      return false;
    }

    const seatedPlayers = this.getSeatedPlayers(room);
    if (seatedPlayers.length === 0) {
      return false;
    }

    if (!seatedPlayers.some((p) => p.id === room.hostId)) {
      return false;
    }

    return true;
  }

  private getSeatedPlayers(room: Room): Player[] {
    return room.players.filter((player) => player.status !== 'left');
  }
}
