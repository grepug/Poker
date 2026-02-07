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
  CreateRoomData,
  JoinRoomData,
  ReconnectData,
  PlayerActionData,
  RequestRebuyData,
  RoomCreatedData,
  PlayerJoinedData,
  GameStartedData,
  YourCardsData,
  PlayerTurnData,
  PlayerActedData,
  BettingRoundCompleteData,
  CommunityCardsDealtData,
  HandCompleteData,
  Card,
} from 'poker-types';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
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

    const { roomId, playerId } = playerInfo;

    // Start grace period timer
    const timer = setTimeout(async () => {
      await this.handleDisconnectTimeout(roomId, playerId);
    }, 30000); // 30 second grace period

    this.disconnectTimers.set(playerId, timer);

    // Notify room of disconnect
    this.server.to(roomId).emit('PLAYER_DISCONNECTED', {
      playerId,
      playerName: '', // Would need to fetch from room
      gracePeriod: 30000,
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
        data.config,
      );

      // Join socket room
      client.join(room.id);

      const host = room.players[0];
      this.socketToPlayer.set(client.id, {
        roomId: room.id,
        playerId: host.id,
      });

      const response: RoomCreatedData = {
        roomId: room.id,
        shareUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/room/${room.id}`,
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
      );

      client.join(room.id);

      this.socketToPlayer.set(client.id, {
        roomId: room.id,
        playerId: player.id,
      });

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

      this.socketToPlayer.set(client.id, {
        roomId: data.roomId,
        playerId: player.id,
      });

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

      // Send cards to each player privately
      for (const player of updatedRoom.players) {
        if (player.cards) {
          const socket = this.findSocketByPlayerId(player.id);
          if (socket) {
            socket.emit('YOUR_CARDS', { cards: player.cards });
          }
        }
      }

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

  @SubscribeMessage('PLAYER_ACTION')
  async handlePlayerAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: PlayerActionData,
  ) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      const room = await this.getRoom(playerInfo.roomId);
      const player = room.players.find((p) => p.id === playerInfo.playerId);
      if (!player) throw new Error('Player not found');

      await this.bettingService.processAction(
        room,
        playerInfo.playerId,
        data.action,
        data.amount,
      );

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

      // Check if betting round complete
      const isComplete =
        this.bettingService.isBettingRoundComplete(updatedRoom);
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
    } catch (error) {
      this.logger.error(`Player action error: ${error.message}`);
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

  private async handleBettingRoundComplete(room: any) {
    const hand = room.currentHand;

    // Check if hand is over
    if (this.handService.isHandComplete(room)) {
      const result = await this.handService.determineWinner(room);
      room.currentHand.currentPlayerTurn = null;
      await this.storageService.saveRoom(room);

      const handCompleteData: HandCompleteData = {
        result,
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
    } else {
      // Advance to next round
      const nextRound = await this.handService.advanceBettingRound(room);
      const updatedRoom = await this.getRoom(room.id);

      this.server.to(room.id).emit('BETTING_ROUND_COMPLETE', {
        nextRound,
      } as BettingRoundCompleteData);

      this.server.to(room.id).emit('COMMUNITY_CARDS_DEALT', {
        cards: updatedRoom.currentHand!.communityCards,
        round: nextRound,
      } as CommunityCardsDealtData);

      // If we reached showdown, determine winner immediately
      if (nextRound === 'SHOWDOWN') {
        const result = await this.handService.determineWinner(updatedRoom);
        updatedRoom.currentHand.currentPlayerTurn = null;
        await this.storageService.saveRoom(updatedRoom);

        const handCompleteData: HandCompleteData = {
          result,
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
      } else {
        // Emit first player's turn for new round
        const currentPlayer = updatedRoom.players.find(
          (p) => p.id === updatedRoom.currentHand!.currentPlayerTurn,
        );
        if (currentPlayer) {
          this.emitPlayerTurn(updatedRoom, currentPlayer);
        }
      }
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

  private findSocketByPlayerId(playerId: string): Socket | null {
    for (const [socketId, info] of this.socketToPlayer.entries()) {
      if (info.playerId === playerId) {
        return this.server.sockets.sockets.get(socketId) || null;
      }
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
