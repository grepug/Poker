import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { GameService } from '../game/game.service';
import { HandService } from '../game/hand.service';
import { BettingService } from '../game/betting.service';
import { TestDeckService } from '../game/test-deck.service';
import { IStorageService } from '../common/interfaces/storage.interface';
import {
  BettingRound,
  CreateRoomData,
  JoinRoomData,
  ReconnectData,
  PlayerActionData,
  RequestRebuyData,
  RevealNextStreetData,
  ShowMyHandData,
  UpdateRoomConfigData,
  RoomCreatedData,
  PlayerJoinedData,
  GameStartedData,
  YourCardsData,
  PlayerTurnData,
  PlayerActedData,
  BettingRoundCompleteData,
  CommunityCardsDealtData,
  HandCompleteData,
  GameEndedData,
  NextStreetRevealStateData,
  PlayerHandRevealedData,
  RoomConfigUpdatedData,
  Card,
} from 'poker-types';

const resolveGatewayCorsOrigin = ():
  | string
  | string[]
  | ((
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void) => {
  const raw = process.env.CORS_ORIGIN?.trim();

  if (!raw || raw === '*') {
    return (
      _origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, true);
    };
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length <= 1) {
    return origins[0] || raw;
  }

  return origins;
};

@WebSocketGateway({
  cors: {
    origin: resolveGatewayCorsOrigin(),
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private socketToPlayer: Map<string, { roomId: string; playerId: string }> =
    new Map();
  private roomActionQueues: Map<string, Promise<void>> = new Map();
  private processedActionFingerprints: Map<string, number> = new Map();
  private readonly processedActionTtlMs = 10 * 60 * 1000; // 10 minutes
  private readonly maxProcessedActionFingerprints = 10000;

  private getRoomShareUrl(client: Socket, roomId: string) {
    const configuredClientUrl = process.env.CLIENT_URL?.trim();
    if (configuredClientUrl) {
      return `${configuredClientUrl.replace(/\/$/, '')}/room/${roomId}`;
    }

    const originHeader = client.handshake.headers.origin;
    if (typeof originHeader === 'string' && originHeader.trim()) {
      return `${originHeader.replace(/\/$/, '')}/room/${roomId}`;
    }

    const hostHeader = client.handshake.headers.host;
    if (typeof hostHeader === 'string' && hostHeader.trim()) {
      const hostname = hostHeader.split(':')[0];
      const clientProtocol = process.env.CLIENT_PROTOCOL || 'http';
      const clientPort = process.env.CLIENT_PORT || '5173';
      return `${clientProtocol}://${hostname}:${clientPort}/room/${roomId}`;
    }

    return `/room/${roomId}`;
  }

  constructor(
    private readonly gameService: GameService,
    private readonly handService: HandService,
    private readonly bettingService: BettingService,
    private readonly testDeckService: TestDeckService,
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    const playerInfo = this.socketToPlayer.get(client.id);
    if (!playerInfo) return;
    this.socketToPlayer.delete(client.id);

    const { roomId, playerId } = playerInfo;
    const room = await this.getRoom(roomId);
    const gracePeriod = room?.config?.reconnectGracePeriod ?? 30000;
    const playerName =
      room?.players?.find((player) => player.id === playerId)?.name ?? '';

    const existingTimer = this.disconnectTimers.get(playerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Start grace period timer
    const timer = setTimeout(async () => {
      await this.handleDisconnectTimeout(roomId, playerId);
    }, gracePeriod);

    this.disconnectTimers.set(playerId, timer);

    // Notify room of disconnect
    this.server.to(roomId).emit('PLAYER_DISCONNECTED', {
      playerId,
      playerName,
      gracePeriod,
    });
  }

  @SubscribeMessage('CREATE_ROOM')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CreateRoomData,
  ) {
    try {
      // For simplicity, use socket ID as player name initially
      const hostName = `Player_${client.id.slice(0, 6)}`;

      const room = await this.gameService.createRoom(
        client.id,
        data.playerName || hostName,
        data.playerEmoji,
        data.config,
      );

      // Join socket room
      client.join(room.id);

      const host = room.players[0];
      this.trackPlayerSocket(client.id, room.id, host.id);

      const response: RoomCreatedData = {
        roomId: room.id,
        shareUrl: this.getRoomShareUrl(client, room.id),
        room: this.sanitizeRoom(room),
      };

      client.emit('ROOM_CREATED', response);
      this.logger.log(`Room ${room.id} created`);

      return { success: true };
    } catch (error) {
      this.logger.error(`Create room error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('JOIN_ROOM')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinRoomData,
  ) {
    try {
      const { room, player } = await this.gameService.addPlayerToRoom(
        data.roomId,
        client.id,
        data.playerName,
        data.playerEmoji,
      );

      client.join(room.id);

      this.trackPlayerSocket(client.id, room.id, player.id);

      // Notify all in room
      this.server.to(room.id).emit('PLAYER_JOINED', {
        player: this.sanitizePlayer(player),
      } as PlayerJoinedData);

      client.emit('ROOM_JOINED', {
        player,
        room: this.sanitizeRoom(room),
      });

      this.logger.log(`Player ${player.name} joined room ${room.id}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Join room error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('RECONNECT')
  async handleReconnect(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: ReconnectData,
  ) {
    try {
      const player = await this.gameService.updatePlayerSocket(
        data.roomId,
        data.playerName,
        client.id,
        data.playerId,
      );

      if (!player) {
        client.emit('RECONNECT_ERROR', { reason: 'Player not found in room' });
        return { success: false };
      }

      // Cancel disconnect timer
      const timer = this.disconnectTimers.get(player.id);
      if (timer) {
        clearTimeout(timer);
        this.disconnectTimers.delete(player.id);
      }

      client.join(data.roomId);

      this.trackPlayerSocket(client.id, data.roomId, player.id);

      // Get full room state - simplified, would need full sync
      client.emit('RECONNECT_SUCCESS', {
        player,
        room: this.sanitizeRoom(await this.getRoom(data.roomId)),
        yourCards: player.cards,
      });

      this.server.to(data.roomId).emit('PLAYER_RECONNECTED', {
        playerId: player.id,
        playerName: player.name,
      });

      this.logger.log(
        `Player ${player.name} reconnected to room ${data.roomId}`,
      );
      return { success: true };
    } catch (error) {
      this.logger.error(`Reconnect error: ${error.message}`);
      client.emit('RECONNECT_ERROR', { reason: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('START_GAME')
  async handleStartGame(@ConnectedSocket() client: Socket) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      const room = await this.getRoom(playerInfo.roomId);

      // Verify host
      if (room.hostId !== playerInfo.playerId) {
        throw new Error('Only host can start game');
      }

      const hand = await this.handService.startNewHand(room);
      const updatedRoom = await this.getRoom(playerInfo.roomId);

      // Broadcast game started
      const { activePlayers, ...handWithoutActivePlayers } = hand;
      const gameStartedData: GameStartedData = {
        hand: handWithoutActivePlayers,
        players: updatedRoom.players.map((p) => ({
          ...this.sanitizePlayer(p),
          hasCards: !!p.cards,
        })),
      };

      this.server.to(playerInfo.roomId).emit('GAME_STARTED', gameStartedData);

      // Send cards to each player privately after GAME_STARTED.
      // Client state resets cards on GAME_STARTED to avoid stale hand data.
      for (const seatPlayer of updatedRoom.players) {
        if (seatPlayer.cards && seatPlayer.socketId) {
          this.server.to(seatPlayer.socketId).emit('YOUR_CARDS', {
            cards: seatPlayer.cards,
          } as YourCardsData);
        }
      }

      // Emit first player's turn
      const currentPlayer = updatedRoom.players.find(
        (p) => p.id === hand.currentPlayerTurn,
      );
      if (currentPlayer) {
        this.emitPlayerTurn(updatedRoom, currentPlayer);
      }

      this.logger.log(`Game started in room ${playerInfo.roomId}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Start game error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('START_NEXT_HAND')
  async handleStartNextHand(@ConnectedSocket() client: Socket) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      const room = await this.getRoom(playerInfo.roomId);
      if (!room) throw new Error('Room not found');

      // Verify host
      if (room.hostId !== playerInfo.playerId) {
        throw new Error('Only host can start next hand');
      }

      if (!room.currentHand) {
        throw new Error('No hand state found');
      }

      if (room.currentHand.currentPlayerTurn) {
        throw new Error('Current hand is still in progress');
      }

      await this.startAndBroadcastNewHand(room.id);
      return { success: true };
    } catch (error) {
      this.logger.error(`Start next hand error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('END_GAME')
  async handleEndGame(@ConnectedSocket() client: Socket) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      const room = await this.getRoom(playerInfo.roomId);
      if (!room) throw new Error('Room not found');

      if (room.hostId !== playerInfo.playerId) {
        throw new Error('Only host can end game');
      }

      if (room.gameState !== 'IN_PROGRESS') {
        throw new Error('Game is not in progress');
      }

      if (!room.currentHand) {
        throw new Error('No hand state found');
      }

      if (room.currentHand.currentPlayerTurn) {
        throw new Error('Can only end game between hands');
      }

      const standings = [...room.players]
        .map((seatPlayer) => {
          const finalChips = seatPlayer.chips + (seatPlayer.currentBet || 0);
          const totalBuyIn = seatPlayer.totalBuyIn || 0;
          return {
            playerId: seatPlayer.id,
            playerName: seatPlayer.name,
            finalChips,
            totalBuyIn,
            profit: finalChips - totalBuyIn,
          };
        })
        .sort((a, b) => {
          if (b.finalChips !== a.finalChips) return b.finalChips - a.finalChips;
          if (b.profit !== a.profit) return b.profit - a.profit;
          return a.playerName.localeCompare(b.playerName);
        });

      const totalPlayers = standings.length;
      const totalBuyIn = standings.reduce((sum, entry) => sum + entry.totalBuyIn, 0);
      const totalChipsInPlay = standings.reduce(
        (sum, entry) => sum + entry.finalChips,
        0,
      );
      const profitablePlayers = standings.filter((entry) => entry.profit > 0).length;
      const averageFinalStack =
        totalPlayers > 0 ? Math.round(totalChipsInPlay / totalPlayers) : 0;
      const handsPlayed = room.currentHand.handNumber ?? 0;
      const chipLeader = standings[0]
        ? {
            playerId: standings[0].playerId,
            playerName: standings[0].playerName,
            amount: standings[0].finalChips,
          }
        : null;

      const biggestWinner = standings
        .filter((entry) => entry.profit > 0)
        .sort((a, b) => b.profit - a.profit)[0];
      const biggestLoss = standings
        .filter((entry) => entry.profit < 0)
        .sort((a, b) => a.profit - b.profit)[0];

      room.gameState = 'ENDED';
      room.currentHand = null;
      room.lastActivityAt = Date.now();
      room.players = room.players.map((seatPlayer) => {
        const nextStatus =
          seatPlayer.status === 'disconnected' ? 'disconnected' : 'waiting';
        return {
          ...seatPlayer,
          cards: null,
          currentBet: 0,
          lastAction: null,
          status: nextStatus,
        };
      });
      await this.storageService.saveRoom(room);

      const gameEndedData: GameEndedData = {
        standings,
        summary: {
          totalPlayers,
          handsPlayed,
          totalBuyIn,
          totalChipsInPlay,
          profitablePlayers,
          averageFinalStack,
          chipLeader,
          biggestWinner: biggestWinner
            ? {
                playerId: biggestWinner.playerId,
                playerName: biggestWinner.playerName,
                amount: biggestWinner.profit,
              }
            : null,
          biggestLoss: biggestLoss
            ? {
                playerId: biggestLoss.playerId,
                playerName: biggestLoss.playerName,
                amount: Math.abs(biggestLoss.profit),
              }
            : null,
        },
      };

      this.server.to(room.id).emit('GAME_ENDED', gameEndedData);
      this.logger.log(
        `Game ended in room ${room.id} by host ${playerInfo.playerId}`,
      );
      return { success: true };
    } catch (error) {
      this.logger.error(`End game error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('SHOW_MY_HAND')
  async handleShowMyHand(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data: ShowMyHandData,
  ) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      const room = await this.getRoom(playerInfo.roomId);
      if (!room?.currentHand) throw new Error('No hand state found');

      if (room.currentHand.currentPlayerTurn) {
        throw new Error('Current hand is still in progress');
      }

      const completedResult = room.currentHand.lastResult;
      if (!completedResult) {
        throw new Error('No completed hand result available');
      }

      const playerHand = completedResult.playerHands.find(
        (entry) => entry.playerId === playerInfo.playerId,
      );
      if (!playerHand) {
        throw new Error('You cannot reveal cards for this hand');
      }

      const currentReveals = new Set(room.currentHand.revealedPlayerIds ?? []);
      if (currentReveals.has(playerInfo.playerId)) {
        return { success: true };
      }

      currentReveals.add(playerInfo.playerId);
      room.currentHand.revealedPlayerIds = [...currentReveals];
      room.lastActivityAt = Date.now();
      await this.storageService.saveRoom(room);

      const player = room.players.find((p) => p.id === playerInfo.playerId);
      const revealData: PlayerHandRevealedData = {
        playerId: playerInfo.playerId,
        playerName: player?.name ?? '',
        handNumber: room.currentHand.handNumber,
      };

      this.server.to(room.id).emit('PLAYER_HAND_REVEALED', revealData);
      return { success: true };
    } catch (error) {
      this.logger.error(`Show hand error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('REVEAL_NEXT_STREET')
  async handleRevealNextStreet(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data: RevealNextStreetData,
  ) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      return await this.runRoomActionSequentially(playerInfo.roomId, async () => {
        const room = await this.getRoom(playerInfo.roomId);
        const hand = room?.currentHand;
        if (!room || !hand) throw new Error('No active hand');

        const nextRound = hand.pendingStreetRevealRound;
        if (!nextRound) {
          throw new Error('No next street reveal is pending');
        }

        const required = new Set<string>(
          hand.nextStreetRequiredPlayerIds ?? this.getStreetRevealRequiredPlayerIds(room),
        );
        if (!required.has(playerInfo.playerId)) {
          throw new Error('You are not eligible to reveal the next street');
        }

        const ready = new Set<string>(hand.nextStreetReadyPlayerIds ?? []);
        if (!ready.has(playerInfo.playerId)) {
          ready.add(playerInfo.playerId);
          hand.nextStreetReadyPlayerIds = [...ready];
          hand.nextStreetRequiredPlayerIds = [...required];
          room.lastActivityAt = Date.now();
          await this.storageService.saveRoom(room);
        }

        const revealState: NextStreetRevealStateData = {
          nextRound,
          readyPlayerIds: [...ready],
          requiredPlayerIds: [...required],
        };
        this.server.to(room.id).emit('NEXT_STREET_REVEAL_STATE', revealState);

        const allReady = ready.size > 0;
        if (allReady) {
          await this.advanceRoundAndBroadcast(room);
        }

        return { success: true };
      });
    } catch (error) {
      this.logger.error(`Reveal next street error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('UPDATE_ROOM_CONFIG')
  async handleUpdateRoomConfig(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UpdateRoomConfigData,
  ) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      const room = await this.getRoom(playerInfo.roomId);
      if (!room) throw new Error('Room not found');
      if (room.hostId !== playerInfo.playerId) {
        throw new Error('Only host can update settings');
      }

      const nextAllowReveal = data?.config?.allowPlayerStreetReveal;
      if (typeof nextAllowReveal !== 'boolean') {
        return { success: true };
      }

      room.config = {
        ...room.config,
        allowPlayerStreetReveal: nextAllowReveal,
      };
      room.lastActivityAt = Date.now();
      await this.storageService.saveRoom(room);

      this.server.to(room.id).emit('ROOM_CONFIG_UPDATED', {
        config: room.config,
      } as RoomConfigUpdatedData);
      return { success: true };
    } catch (error) {
      this.logger.error(`Update room config error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('PLAYER_ACTION')
  async handlePlayerAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: PlayerActionData,
  ) {
    const playerInfo = this.socketToPlayer.get(client.id);
    const requestActionId = data.actionId?.trim();
    const baseActionLog = {
      roomId: playerInfo?.roomId ?? null,
      playerId: playerInfo?.playerId ?? null,
      action: data.action,
      amount: data.amount ?? null,
      actionId: requestActionId ?? null,
      socketId: client.id,
    };

    try {
      if (!playerInfo) throw new Error('Not in a room');

      return await this.runRoomActionSequentially(playerInfo.roomId, async () => {
        const room = await this.getRoom(playerInfo.roomId);
        const player = room.players.find((p) => p.id === playerInfo.playerId);
        if (!player) throw new Error('Player not found');
        if (!room.currentHand) throw new Error('No active hand');

        const actionId = requestActionId;
        const actionLog = {
          ...baseActionLog,
          roomId: room.id,
          playerId: player.id,
          handNumber: room.currentHand.handNumber,
          playerName: player.name,
        };

        if (
          actionId &&
          this.hasProcessedAction(
            room.id,
            room.currentHand.handNumber,
            player.id,
            actionId,
          )
        ) {
          this.logger.warn(
            `Duplicate action ignored ${this.serializeForLog(actionLog)}`,
          );
          return { success: true, duplicate: true };
        }

        await this.bettingService.processAction(
          room,
          playerInfo.playerId,
          data.action,
          data.amount,
        );

        if (actionId) {
          this.markProcessedAction(
            room.id,
            room.currentHand.handNumber,
            player.id,
            actionId,
          );
        }

        const updatedRoom = await this.getRoom(playerInfo.roomId);

        // Broadcast action
        const actionData: PlayerActedData = {
          playerId: player.id,
          playerName: player.name,
          action: data.action,
          amount: data.amount,
          newPot: updatedRoom.currentHand!.pot,
          newChips: player.chips,
        };

        this.server.to(playerInfo.roomId).emit('PLAYER_ACTED', actionData);
        this.logger.log(
          `Action applied ${this.serializeForLog({
            ...actionLog,
            newPot: updatedRoom.currentHand!.pot,
            newChips: player.chips,
          })}`,
        );

        // Check if betting round complete
        const isComplete = this.bettingService.isBettingRoundComplete(updatedRoom);
        this.logger.debug(`Betting round complete: ${isComplete}`);

        if (isComplete) {
          await this.handleBettingRoundComplete(updatedRoom);
        } else {
          // Move to next player
          const nextPlayer = this.handService.getNextPlayer(updatedRoom);
          this.logger.debug(
            `Next player: ${nextPlayer?.name}, current: ${updatedRoom.currentHand?.currentPlayerTurn}`,
          );
          if (nextPlayer) {
            updatedRoom.currentHand!.currentPlayerTurn = nextPlayer.id;
            await this.storageService.saveRoom(updatedRoom);
            this.logger.debug(`Turn advanced to ${nextPlayer.name}`);
            this.emitPlayerTurn(updatedRoom, nextPlayer);
          }
        }

        return { success: true };
      });
    } catch (error) {
      this.logger.warn(
        `Player action rejected ${this.serializeForLog({
          ...baseActionLog,
          reason: error.message,
        })}`,
      );
      client.emit('ERROR', { message: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('REQUEST_REBUY')
  async handleRebuy(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: RequestRebuyData,
  ) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      await this.gameService.addChipsToPlayer(
        playerInfo.roomId,
        playerInfo.playerId,
        data.amount,
      );

      const room = await this.getRoom(playerInfo.roomId);
      const player = room.players.find((p) => p.id === playerInfo.playerId)!;

      this.server.to(playerInfo.roomId).emit('PLAYER_REBOUGHT', {
        playerId: player.id,
        playerName: player.name,
        amount: data.amount,
        newChipCount: player.chips,
        newTotalBuyIn: player.totalBuyIn,
      });

      return { success: true };
    } catch (error) {
      client.emit('ERROR', { message: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('LEAVE_ROOM')
  async handleLeaveRoom(@ConnectedSocket() client: Socket) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) return { success: true };

      const room = await this.gameService.removePlayerFromRoom(
        playerInfo.roomId,
        playerInfo.playerId,
      );

      client.leave(playerInfo.roomId);
      this.socketToPlayer.delete(client.id);

      if (room) {
        this.server.to(playerInfo.roomId).emit('PLAYER_LEFT', {
          playerId: playerInfo.playerId,
          playerName: '', // Would need to cache
        });

        // If host changed
        const oldHostId = playerInfo.playerId;
        if (room.hostId !== oldHostId) {
          const newHost = room.players.find((p) => p.id === room.hostId)!;
          this.server.to(playerInfo.roomId).emit('HOST_CHANGED', {
            newHostId: newHost.id,
            newHostName: newHost.name,
          });
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Leave room error: ${error.message}`);
      return { success: false };
    }
  }

  // Helper methods

  private serializeForLog(payload: Record<string, unknown>): string {
    return JSON.stringify(payload);
  }

  private async runRoomActionSequentially<T>(
    roomId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.roomActionQueues.get(roomId) ?? Promise.resolve();
    let releaseCurrent: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const queuePromise = previous.finally(() => gate);
    this.roomActionQueues.set(roomId, queuePromise);

    await previous;

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.roomActionQueues.get(roomId) === queuePromise) {
        this.roomActionQueues.delete(roomId);
      }
    }
  }

  private buildActionFingerprint(
    roomId: string,
    handNumber: number,
    playerId: string,
    actionId: string,
  ): string {
    return `${roomId}:${handNumber}:${playerId}:${actionId}`;
  }

  private hasProcessedAction(
    roomId: string,
    handNumber: number,
    playerId: string,
    actionId: string,
  ): boolean {
    this.pruneProcessedActions();
    const fingerprint = this.buildActionFingerprint(
      roomId,
      handNumber,
      playerId,
      actionId,
    );
    return this.processedActionFingerprints.has(fingerprint);
  }

  private markProcessedAction(
    roomId: string,
    handNumber: number,
    playerId: string,
    actionId: string,
  ) {
    const fingerprint = this.buildActionFingerprint(
      roomId,
      handNumber,
      playerId,
      actionId,
    );
    this.processedActionFingerprints.set(fingerprint, Date.now());
    this.pruneProcessedActions();
  }

  private pruneProcessedActions() {
    const cutoff = Date.now() - this.processedActionTtlMs;
    for (const [key, timestamp] of this.processedActionFingerprints.entries()) {
      if (timestamp < cutoff) {
        this.processedActionFingerprints.delete(key);
      }
    }

    while (
      this.processedActionFingerprints.size >
      this.maxProcessedActionFingerprints
    ) {
      const oldestKey = this.processedActionFingerprints.keys().next().value;
      if (!oldestKey) break;
      this.processedActionFingerprints.delete(oldestKey);
    }
  }

  private async handleBettingRoundComplete(room: any) {
    const hand = room.currentHand;
    const allowPlayerStreetReveal = room.config?.allowPlayerStreetReveal ?? true;

    // Check if hand is over
    if (this.handService.isHandComplete(room)) {
      await this.completeAndBroadcastHand(room);
      return;
    }

    const nextRound = this.getNextBettingRound(hand.bettingRound);
    const shouldWaitForPlayerReveal =
      allowPlayerStreetReveal &&
      !this.shouldAutoDealRemainingCommunityCards(room);

    if (shouldWaitForPlayerReveal) {
      const requiredPlayerIds = this.getStreetRevealRequiredPlayerIds(room);
      if (requiredPlayerIds.length === 0) {
        await this.advanceRoundAndBroadcast(room);
        return;
      }

      for (const seatPlayer of room.players) {
        seatPlayer.currentBet = 0;
      }
      room.currentHand.currentBet = 0;
      room.currentHand.currentPlayerTurn = null;
      room.currentHand.roundActions = {};
      room.currentHand.pendingStreetRevealRound = nextRound;
      room.currentHand.nextStreetReadyPlayerIds = [];
      room.currentHand.nextStreetRequiredPlayerIds = requiredPlayerIds;
      room.lastActivityAt = Date.now();
      await this.storageService.saveRoom(room);

      this.server.to(room.id).emit('BETTING_ROUND_COMPLETE', {
        nextRound,
        awaitingPlayerStreetReveal: true,
        readyPlayerIds: [],
        requiredPlayerIds,
      } as BettingRoundCompleteData);

      this.server.to(room.id).emit('NEXT_STREET_REVEAL_STATE', {
        nextRound,
        readyPlayerIds: [],
        requiredPlayerIds,
      } as NextStreetRevealStateData);
      return;
    }

    await this.advanceRoundAndBroadcast(room);
  }

  private getNextBettingRound(round: BettingRound): BettingRound {
    switch (round) {
      case 'PRE_FLOP':
        return 'FLOP';
      case 'FLOP':
        return 'TURN';
      case 'TURN':
        return 'RIVER';
      case 'RIVER':
      default:
        return 'SHOWDOWN';
    }
  }

  private shouldAutoDealRemainingCommunityCards(room: any): boolean {
    const hand = room.currentHand;
    if (!hand) return false;

    const playersWhoCanAct = room.players.filter(
      (player: any) =>
        hand.activePlayers.includes(player.id) &&
        player.status !== 'folded' &&
        player.status !== 'all-in',
    );

    return playersWhoCanAct.length <= 1;
  }

  private getStreetRevealRequiredPlayerIds(room: any): string[] {
    return room.players
      .filter(
        (player: any) =>
          Boolean(player.cards) &&
          player.status !== 'waiting' &&
          player.status !== 'left' &&
          player.status !== 'disconnected',
      )
      .map((player: any) => player.id);
  }

  private async completeAndBroadcastHand(room: any) {
    const result = await this.handService.determineWinner(room);
    const isShowdown = room.currentHand.bettingRound === 'SHOWDOWN';
    const revealedPlayerIds = isShowdown
      ? result.playerHands.map((entry) => entry.playerId)
      : [];
    room.currentHand.lastResult = result;
    room.currentHand.revealedPlayerIds = revealedPlayerIds;
    room.currentHand.currentPlayerTurn = null;
    room.currentHand.pendingStreetRevealRound = null;
    room.currentHand.nextStreetReadyPlayerIds = [];
    room.currentHand.nextStreetRequiredPlayerIds = [];
    await this.storageService.saveRoom(room);

    const handCompleteData: HandCompleteData = {
      result,
      handNumber: room.currentHand.handNumber,
      isShowdown,
      revealedPlayerIds,
    };

    this.server.to(room.id).emit('HAND_COMPLETE', handCompleteData);
    if (this.testDeckService.isTestMode()) {
      // Keep auto-advance in TEST_MODE to preserve deterministic e2e cadence.
      setTimeout(async () => {
        try {
          await this.startAndBroadcastNewHand(room.id);
        } catch (error) {
          this.logger.error(`Error starting new hand: ${error.message}`);
        }
      }, 5000);
    }
  }

  private async advanceRoundAndBroadcast(room: any) {
    if (room.currentHand) {
      room.currentHand.pendingStreetRevealRound = null;
      room.currentHand.nextStreetReadyPlayerIds = [];
      room.currentHand.nextStreetRequiredPlayerIds = [];
    }

    const nextRound = await this.handService.advanceBettingRound(room);
    const updatedRoom = await this.getRoom(room.id);

    this.server.to(room.id).emit('BETTING_ROUND_COMPLETE', {
      nextRound,
    } as BettingRoundCompleteData);

    this.server.to(room.id).emit('COMMUNITY_CARDS_DEALT', {
      cards: updatedRoom.currentHand!.communityCards,
      round: nextRound,
    } as CommunityCardsDealtData);

    if (nextRound === 'SHOWDOWN') {
      await this.completeAndBroadcastHand(updatedRoom);
      return;
    }

    const currentPlayer = updatedRoom.players.find(
      (p) => p.id === updatedRoom.currentHand!.currentPlayerTurn,
    );
    if (currentPlayer) {
      this.emitPlayerTurn(updatedRoom, currentPlayer);
    }
  }

  private async startAndBroadcastNewHand(roomId: string) {
    const room = await this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found for new hand`);
    }

    const newHand = await this.handService.startNewHand(room);
    const updatedRoom = await this.getRoom(roomId);
    if (!updatedRoom) {
      throw new Error(`Room ${roomId} missing after starting new hand`);
    }

    this.server.to(roomId).emit('NEW_HAND_STARTING');

    const { activePlayers, ...handWithoutActivePlayers } = newHand;
    const gameStartedData: GameStartedData = {
      hand: handWithoutActivePlayers,
      players: updatedRoom.players.map((p) => ({
        ...this.sanitizePlayer(p),
        hasCards: !!p.cards,
      })),
    };

    this.server.to(roomId).emit('GAME_STARTED', gameStartedData);

    // Send cards to each player privately.
    for (const seatPlayer of updatedRoom.players) {
      if (seatPlayer.cards && seatPlayer.socketId) {
        this.server.to(seatPlayer.socketId).emit('YOUR_CARDS', {
          cards: seatPlayer.cards,
        } as YourCardsData);
      }
    }

    const currentPlayer = updatedRoom.players.find(
      (p) => p.id === newHand.currentPlayerTurn,
    );
    if (currentPlayer) {
      this.emitPlayerTurn(updatedRoom, currentPlayer);
    }
  }

  private emitPlayerTurn(room: any, player: any) {
    const turnData: PlayerTurnData = {
      playerId: player.id,
      playerName: player.name,
      timeLimit: 30000,
      currentBet: room.currentHand!.currentBet,
      minRaise: this.bettingService.calculateMinRaise(room),
      canCheck: player.currentBet === room.currentHand!.currentBet,
    };

    this.server.to(room.id).emit('PLAYER_TURN', turnData);
  }

  private async handleDisconnectTimeout(roomId: string, playerId: string) {
    try {
      const room = await this.getRoom(roomId);

      // Auto-fold if it's their turn
      if (room.currentHand?.currentPlayerTurn === playerId) {
        await this.bettingService.processAction(room, playerId, 'fold');

        this.server.to(roomId).emit('PLAYER_AUTO_FOLDED', {
          playerId,
          playerName: room.players.find((p) => p.id === playerId)?.name || '',
        });

        // Continue game
        const updatedRoom = await this.getRoom(roomId);
        if (this.bettingService.isBettingRoundComplete(updatedRoom)) {
          await this.handleBettingRoundComplete(updatedRoom);
        }
      }

      await this.gameService.markPlayerDisconnected(roomId, playerId);
    } catch (error) {
      this.logger.error(`Disconnect timeout error: ${error.message}`);
    }
  }

  /**
   * TEST MODE ONLY: Set a predetermined deck for deterministic testing
   * Only works when TEST_MODE environment variable is set to 'true'
   */
  @SubscribeMessage('setTestDeck')
  async handleSetTestDeck(
    @MessageBody() data: { roomId: string; deck: Card[] },
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.testDeckService.isTestMode()) {
        return {
          success: false,
          error: 'Test decks can only be set when TEST_MODE=true',
        };
      }

      const { roomId, deck } = data;

      if (!roomId || !deck || !Array.isArray(deck)) {
        return {
          success: false,
          error: 'Invalid data: roomId and deck array required',
        };
      }

      // Validate deck has valid cards
      if (deck.length === 0) {
        return {
          success: false,
          error: 'Deck cannot be empty',
        };
      }

      this.testDeckService.setDeck(roomId, deck);
      this.logger.log(
        `Test deck set for room ${roomId} with ${deck.length} cards`,
      );

      return { success: true };
    } catch (error) {
      this.logger.error(`Set test deck error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async getRoom(roomId: string): Promise<any> {
    return await this.storageService.getRoom(roomId);
  }

  private trackPlayerSocket(socketId: string, roomId: string, playerId: string) {
    for (const [trackedSocketId, tracked] of this.socketToPlayer.entries()) {
      if (tracked.playerId === playerId && trackedSocketId !== socketId) {
        this.socketToPlayer.delete(trackedSocketId);
      }
    }

    this.socketToPlayer.set(socketId, { roomId, playerId });
  }

  private findSocketByPlayerId(playerId: string): Socket | null {
    const staleSocketIds: string[] = [];

    for (const [socketId, info] of this.socketToPlayer.entries()) {
      if (info.playerId !== playerId) {
        continue;
      }

      const socket = this.server.sockets.sockets.get(socketId) || null;
      if (socket) {
        for (const staleSocketId of staleSocketIds) {
          this.socketToPlayer.delete(staleSocketId);
        }
        return socket;
      }

      staleSocketIds.push(socketId);
    }

    for (const staleSocketId of staleSocketIds) {
      this.socketToPlayer.delete(staleSocketId);
    }

    return null;
  }

  private sanitizeRoom(room: any): any {
    // Remove sensitive data
    return {
      ...room,
      players: room.players.map((p: any) => this.sanitizePlayer(p)),
    };
  }

  private sanitizePlayer(player: any): any {
    return {
      ...player,
      cards: undefined, // Don't send cards in general updates
    };
  }
}
