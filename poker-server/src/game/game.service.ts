import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Room, RoomConfig, Player, PlayerStatus } from 'poker-types';
import { IStorageService } from '../common/interfaces/storage.interface';
import { generateRoomId, generatePlayerId } from '../common/utils/id-generator';

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
  ): Promise<Room> {
    const roomId = generateRoomId();
    const hostId = generatePlayerId();

    const defaultConfig: RoomConfig = {
      startingChips: 1000,
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 10,
      reconnectGracePeriod: 120000,
    };

    const host: Player = {
      id: hostId,
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
      config: { ...defaultConfig, ...config },
      players: [host],
      gameState: 'WAITING',
      currentHand: null,
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
  ): Promise<{ room: Room; player: Player; rejoined: boolean }> {
    const room = await this.storageService.getRoom(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    if (room.gameState === 'ENDED') {
      throw new Error('Cannot join room - game has ended');
    }

    const existingPlayer = room.players.find((p) => p.name === playerName);
    if (existingPlayer) {
      if (existingPlayer.status !== 'disconnected') {
        throw new Error('Name already taken');
      }

      existingPlayer.socketId = socketId;
      existingPlayer.status = 'connected';
      existingPlayer.lastConnectedAt = Date.now();
      if (playerEmoji !== undefined) {
        existingPlayer.emoji = playerEmoji;
      }
      room.lastActivityAt = Date.now();

      await this.storageService.saveRoom(room);
      this.logger.log(`Player ${playerName} reclaimed seat in room ${roomId}`);

      return { room, player: existingPlayer, rejoined: true };
    }

    // Check if room is full
    if (room.players.length >= room.config.maxPlayers) {
      throw new Error('Room is full');
    }

    const joinsDuringActiveGame = room.gameState === 'IN_PROGRESS';
    const playerId = generatePlayerId();
    const position = this.findNextAvailablePosition(room);
    const initialChips = joinsDuringActiveGame ? room.config.startingChips : 0;
    const initialBuyIn = joinsDuringActiveGame ? room.config.startingChips : 0;

    const player: Player = {
      id: playerId,
      socketId,
      name: playerName,
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
    this.logger.log(`Player ${playerName} joined room ${roomId}`);

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
    room.players.splice(playerIndex, 1);
    room.lastActivityAt = Date.now();

    this.logger.log(`Player ${player.name} removed from room ${roomId}`);

    // If room is empty, delete it
    if (room.players.length === 0) {
      await this.storageService.deleteRoom(roomId);
      this.logger.log(`Room ${roomId} deleted (empty)`);
      return null;
    }

    // If host left, transfer to next player
    if (room.hostId === playerId) {
      const newHost = room.players[0];
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
  ): Promise<Player | null> {
    const room = await this.storageService.getRoom(roomId);

    if (!room) {
      return null;
    }

    const player = playerId
      ? room.players.find((p) => p.id === playerId)
      : room.players.find((p) => p.name === playerName);
    if (!player) {
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
    const occupiedPositions = new Set(room.players.map((p) => p.position));

    for (let i = 0; i < room.config.maxPlayers; i++) {
      if (!occupiedPositions.has(i)) {
        return i;
      }
    }

    return room.players.length; // Fallback
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

    if (room.players.length === 0) {
      return false;
    }

    if (!room.players.some((p) => p.id === room.hostId)) {
      return false;
    }

    return true;
  }
}
