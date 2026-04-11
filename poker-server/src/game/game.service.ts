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
import { roomEvent, roomWrite } from '../storage/room-write.factory';

type ServerPlayer = Player & { userId?: string };

const MIN_ROOM_PLAYERS = 2;
const MAX_ROOM_PLAYERS = 15;

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

const isDisconnected = (player: Player): boolean =>
  player.connectionStatus === 'disconnected' ||
  player.status === 'disconnected';

const resolveReconnectStatus = (status: PlayerStatus): PlayerStatus =>
  status === 'disconnected' ? 'connected' : status;

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
      maxPlayers: 10,
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
      isRobot: false,
      emoji: hostEmoji,
      chips: 0, // Chips assigned when game starts
      totalBuyIn: 0,
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
      position: 0,
      status: 'waiting' as PlayerStatus,
      connectionStatus: 'connected',
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

    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'ROOM_CREATED',
          actor: { source: 'ROOM_SERVICE', playerId: hostId, playerName: hostName, userId: hostUserId },
          payload: {
            hostId,
            hostName,
            config: room.config,
          },
        }),
      ),
    );
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
    const existingPlayerByName = playersWithUserId.find(
      (player) => player.name === normalizedPlayerName,
    );
    const leftSeatReservedForDifferentUser =
      Boolean(existingPlayerByName) &&
      existingPlayerByName?.status === 'left' &&
      Boolean(existingPlayerByName.userId) &&
      existingPlayerByName.userId !== userId;
    if (leftSeatReservedForDifferentUser && !existingPlayerByUserId) {
      throw new Error('Name already taken');
    }
    const existingPlayer = existingPlayerByUserId ?? existingPlayerByName;
    if (existingPlayer) {
      const sameAuthenticatedUser =
        Boolean(userId) && existingPlayerByUserId?.id === existingPlayer.id;
      if (!isDisconnected(existingPlayer) && existingPlayer.status !== 'left') {
        if (!sameAuthenticatedUser) {
          throw new Error('Name already taken');
        }
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
        priorStatus === 'left'
          ? ('waiting' as PlayerStatus)
          : resolveReconnectStatus(priorStatus);
      existingPlayer.connectionStatus = 'connected';
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

      await this.storageService.persistRoom(
        room,
        roomWrite(
          roomEvent({
            roomId: room.id,
            type: 'PLAYER_REJOINED',
            actor: {
              source: 'ROOM_SERVICE',
              playerId: existingPlayer.id,
              playerName: existingPlayer.name,
              userId,
            },
            payload: {
              playerId: existingPlayer.id,
              playerName: existingPlayer.name,
              priorStatus,
              position: existingPlayer.position,
            },
          }),
        ),
      );
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
      isRobot: false,
      emoji: playerEmoji,
      chips: initialChips,
      totalBuyIn: initialBuyIn,
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
      position,
      status: 'waiting' as PlayerStatus,
      connectionStatus: 'connected',
      cards: null,
      currentBet: 0,
      lastAction: null,
      lastConnectedAt: Date.now(),
    };

    room.players.push(player);
    room.lastActivityAt = Date.now();

    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'PLAYER_JOINED',
          actor: {
            source: 'ROOM_SERVICE',
            playerId: player.id,
            playerName: player.name,
            userId,
          },
          payload: {
            playerId: player.id,
            playerName: player.name,
            position: player.position,
            joinedDuringActiveGame: joinsDuringActiveGame,
          },
        }),
      ),
    );
    this.logger.log(`Player ${normalizedPlayerName} joined room ${roomId}`);

    return { room, player, rejoined: false };
  }

  async addRobotToRoom(
    roomId: string,
    hostPlayerId: string,
    robotName?: string,
    robotEmoji?: string,
  ): Promise<{ room: Room; player: Player }> {
    const room = await this.storageService.getRoom(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    if (room.hostId !== hostPlayerId) {
      throw new Error('Only host can manage robots');
    }

    if (!this.canManageRobots(room)) {
      throw new Error(
        'Robots can only be managed before game start or between hands',
      );
    }

    const seatedPlayers = this.getSeatedPlayers(room);
    if (seatedPlayers.length >= room.config.maxPlayers) {
      throw new Error('Room is full');
    }

    const baseName = robotName?.trim() || this.buildDefaultRobotName(room);
    const uniqueName = this.ensureUniquePlayerName(room, baseName);
    const position = this.findNextAvailablePosition(room);
    if (position < 0 || position >= room.config.maxPlayers) {
      throw new Error('Room is full');
    }

    const joinsDuringInProgressGame = room.gameState === 'IN_PROGRESS';
    const initialChips = joinsDuringInProgressGame
      ? room.config.startingChips
      : 0;
    const initialBuyIn = joinsDuringInProgressGame
      ? room.config.startingChips
      : 0;
    const robotPlayer: Player = {
      id: generatePlayerId(),
      socketId: '',
      name: uniqueName,
      isRobot: true,
      emoji: robotEmoji,
      chips: initialChips,
      totalBuyIn: initialBuyIn,
      handsPlayedCount: 0,
      handsWonCount: 0,
      vpipHandsCount: 0,
      position,
      status: 'waiting',
      cards: null,
      currentBet: 0,
      lastAction: null,
      lastConnectedAt: Date.now(),
    };

    room.players.push(robotPlayer);
    room.lastActivityAt = Date.now();
    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'PLAYER_JOINED',
          actor: {
            source: 'ROOM_SERVICE',
            playerId: robotPlayer.id,
            playerName: robotPlayer.name,
          },
          payload: {
            playerId: robotPlayer.id,
            playerName: robotPlayer.name,
            position: robotPlayer.position,
            joinedDuringActiveGame: joinsDuringInProgressGame,
          },
        }),
      ),
    );

    this.logger.log(`Robot ${robotPlayer.name} added to room ${room.id}`);
    return { room, player: robotPlayer };
  }

  async removeRobotFromRoom(
    roomId: string,
    hostPlayerId: string,
    robotPlayerId: string,
  ): Promise<Room> {
    const room = await this.storageService.getRoom(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    if (room.hostId !== hostPlayerId) {
      throw new Error('Only host can manage robots');
    }

    if (!this.canManageRobots(room)) {
      throw new Error(
        'Robots can only be managed before game start or between hands',
      );
    }

    const robot = room.players.find(
      (player) => player.id === robotPlayerId && player.isRobot,
    );
    if (!robot) {
      throw new Error('Robot player not found');
    }

    const updatedRoom = await this.removePlayerFromRoom(roomId, robotPlayerId);
    if (!updatedRoom) {
      throw new Error('Room no longer exists');
    }

    this.logger.log(`Robot ${robot.name} removed from room ${room.id}`);
    return updatedRoom;
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
    player.connectionStatus = 'connected';
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

    const previousHostId = room.hostId;
    const seatedHumanPlayers = this.getSeatedHumanPlayers(room);
    if (seatedHumanPlayers.length === 0) {
      await this.storageService.deleteRoom(roomId);
      this.logger.log(`Room ${roomId} deleted (no human players remaining)`);
      return null;
    }

    // If host left, transfer to next player
    if (room.hostId === playerId) {
      const newHost = seatedHumanPlayers[0];
      room.hostId = newHost.id;
      this.logger.log(`Host transferred to ${newHost.name} in room ${roomId}`);
    }

    const events = [
      roomEvent({
        roomId,
        type: 'PLAYER_LEFT',
        actor: {
          source: 'ROOM_SERVICE',
          playerId: player.id,
          playerName: player.name,
          userId: (player as ServerPlayer).userId,
        },
        payload: {
          playerId: player.id,
          playerName: player.name,
        },
      }),
    ];
    if (room.hostId !== previousHostId) {
      events.push(
        roomEvent({
          roomId,
          type: 'HOST_CHANGED',
          actor: { source: 'ROOM_SERVICE' },
          payload: {
            hostId: room.hostId,
          },
        }),
      );
    }
    await this.storageService.persistRoom(room, roomWrite(...events));
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
    if (player.isRobot) {
      return null;
    }
    if (userId) {
      if (!player.userId || player.userId !== userId) {
        return null;
      }
    }

    player.socketId = newSocketId;
    player.status = resolveReconnectStatus(player.status);
    player.connectionStatus = 'connected';
    player.lastConnectedAt = Date.now();
    room.lastActivityAt = Date.now();

    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'PLAYER_REJOINED',
          actor: {
            source: 'ROOM_SERVICE',
            playerId: player.id,
            playerName: player.name,
            userId,
          },
          payload: {
            playerId: player.id,
            socketId: newSocketId,
          },
        }),
      ),
    );
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

    player.connectionStatus = 'disconnected';
    room.lastActivityAt = Date.now();

    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'PLAYER_DISCONNECTED',
          actor: {
            source: 'ROOM_SERVICE',
            playerId: player.id,
            playerName: player.name,
            userId: (player as ServerPlayer).userId,
          },
          payload: {
            playerId: player.id,
            playerName: player.name,
          },
        }),
      ),
    );
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

    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'PLAYER_REBOUGHT',
          actor: {
            source: 'ROOM_SERVICE',
            playerId: player.id,
            playerName: player.name,
            userId: (player as ServerPlayer).userId,
          },
          payload: {
            playerId: player.id,
            amount,
            chips: player.chips,
            totalBuyIn: player.totalBuyIn,
          },
        }),
      ),
    );
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

  private canManageRobots(room: Room): boolean {
    if (room.gameState === 'WAITING') {
      return true;
    }

    if (
      room.gameState === 'IN_PROGRESS' &&
      room.currentHand &&
      room.currentHand.currentPlayerTurn === null &&
      room.currentHand.lastResult
    ) {
      return true;
    }

    return false;
  }

  private buildDefaultRobotName(room: Room): string {
    const usedRobotIndexes = new Set<number>();
    for (const player of room.players) {
      const match = player.name.match(/^Robot\s+(\d+)$/i);
      if (match?.[1]) {
        usedRobotIndexes.add(Number(match[1]));
      }
    }

    let nextIndex = 1;
    while (usedRobotIndexes.has(nextIndex)) {
      nextIndex += 1;
    }

    return `Robot ${nextIndex}`;
  }

  private ensureUniquePlayerName(room: Room, baseName: string): string {
    const normalizedBaseName = baseName.trim() || 'Robot';
    const takenNames = new Set(
      room.players
        .filter((player) => player.status !== 'left')
        .map((player) => player.name.toLowerCase()),
    );

    if (!takenNames.has(normalizedBaseName.toLowerCase())) {
      return normalizedBaseName;
    }

    let suffix = 2;
    while (takenNames.has(`${normalizedBaseName} ${suffix}`.toLowerCase())) {
      suffix += 1;
    }
    return `${normalizedBaseName} ${suffix}`;
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

    await this.persistHostTransfer(roomId, room, newHost);

    return room;
  }

  async transferHostOnDisconnectTimeout(
    roomId: string,
    disconnectedHostId: string,
  ): Promise<Room | null> {
    const room = await this.storageService.getRoom(roomId);

    if (!room) {
      return null;
    }

    if (room.hostId !== disconnectedHostId) {
      return room;
    }

    const replacementHost = this.getConnectedSeatedHumanPlayers(room).find(
      (player) => player.id !== disconnectedHostId,
    );
    if (!replacementHost) {
      return room;
    }

    await this.persistHostTransfer(roomId, room, replacementHost);
    return room;
  }

  private async persistHostTransfer(
    roomId: string,
    room: Room,
    newHost: Player,
  ): Promise<void> {
    room.hostId = newHost.id;
    room.lastActivityAt = Date.now();

    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'HOST_CHANGED',
          actor: { source: 'ROOM_SERVICE' },
          payload: {
            hostId: newHost.id,
            hostName: newHost.name,
          },
        }),
      ),
    );
    this.logger.log(`Host transferred to ${newHost.name} in room ${roomId}`);
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

  private getSeatedHumanPlayers(room: Room): Player[] {
    return this.getSeatedPlayers(room).filter((player) => !player.isRobot);
  }

  private getConnectedSeatedHumanPlayers(room: Room): Player[] {
    return this.getSeatedHumanPlayers(room).filter(
      (player) => !isDisconnected(player),
    );
  }
}
