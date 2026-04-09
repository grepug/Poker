import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { GameService } from '../game/game.service';
import { HandService } from '../game/hand.service';
import { BettingService } from '../game/betting.service';
import { TestDeckService } from '../game/test-deck.service';
import {
  RobotAgentService,
  RobotActionCandidate,
  RobotActionDecision,
  RobotDecisionError,
  RobotTurnContext,
  toRobotFallbackCause,
} from '../game/robot-agent.service';
import { SavedGameReviewService } from '../game/saved-game-review.service';
import { IStorageService } from '../common/interfaces/storage.interface';
import { ISavedGameArchiveStorageService } from '../common/interfaces/saved-game-archive-storage.interface';
import { IChatStorageService } from '../common/interfaces/chat-storage.interface';
import { IChatMediaStorageService } from '../common/interfaces/chat-media-storage.interface';
import { AuthService } from '../auth/auth.service';
import { readAuthSessionCookie } from '../auth/session-cookie';
import {
  PlayerProfileUpdatedRealtimeEvent,
  realtimeEventBus,
} from '../common/realtime-events';
import {
  BettingRound,
  BlindType,
  CreateRoomData,
  JoinRoomData,
  ReconnectData,
  PlayerActionData,
  PlayerActionDisplayKind,
  RequestRebuyData,
  MuckMyHandData,
  RevealNextStreetData,
  SetRunCountData,
  ShowMyHandData,
  UpdateRoomConfigData,
  PlayerReadyData,
  AddRobotPlayerData,
  RemoveRobotPlayerData,
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
  RunCountDecisionStateData,
  PlayerHandMuckedData,
  PlayerHandRevealedData,
  ShowdownDecisionStateData,
  RoomConfigUpdatedData,
  ReadyStateUpdatedData,
  ReadyPhase,
  ChatHistorySyncData,
  ChatMessage,
  GetChatHistoryData,
  SendChatMessageData,
  SendChatMessageAck,
  Card,
  PlayerProfileUpdatedData,
  PersistedRobotDecisionMetadata,
  PersistedRobotFallbackCause,
  UpdateProfileData,
  HandResult,
  Room,
  RunCount,
} from 'poker-types';
import { roomEvent, roomWrite } from '../storage/room-write.factory';

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

const parsePositiveIntegerEnv = (
  rawValue: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
};

@WebSocketGateway({
  cors: {
    origin: resolveGatewayCorsOrigin(),
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private runCountDecisionTimers: Map<string, NodeJS.Timeout> = new Map();
  private socketToPlayer: Map<string, { roomId: string; playerId: string }> =
    new Map();
  private roomActionQueues: Map<string, Promise<void>> = new Map();
  private robotTurnTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingRobotActionDecisions: Map<
    string,
    PersistedRobotDecisionMetadata
  > = new Map();
  private processedActionFingerprints: Map<string, number> = new Map();
  private readonly processedActionTtlMs = 10 * 60 * 1000; // 10 minutes
  private readonly maxProcessedActionFingerprints = 10000;
  private readonly runCountDecisionWindowMs = parsePositiveIntegerEnv(
    process.env.RUN_COUNT_DECISION_WINDOW_MS,
    15000,
  );

  private processedChatMessageFingerprints: Map<
    string,
    { timestamp: number; message: ChatMessage }
  > = new Map();
  private getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    return fallback;
  }

  private parseRobotDelayMs(
    value: string | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.max(0, Math.floor(parsed));
  }

  private isPlayerDisconnected(
    player:
      | {
          status?: string;
          connectionStatus?: string;
        }
      | null
      | undefined,
  ): boolean {
    if (!player) {
      return false;
    }

    return (
      player.connectionStatus === 'disconnected' ||
      player.status === 'disconnected'
    );
  }
  private readonly processedChatMessageTtlMs = Number(
    process.env.CHAT_DEDUPE_WINDOW_MS || '600000',
  );
  private readonly maxProcessedChatMessageFingerprints = Number(
    process.env.CHAT_MAX_DEDUPE_CACHE_SIZE || '50000',
  );
  private readonly chatRateLimitCount = Number(
    process.env.CHAT_RATE_LIMIT_COUNT || '5',
  );
  private readonly chatRateLimitWindowMs = Number(
    process.env.CHAT_RATE_LIMIT_WINDOW_MS || '10000',
  );
  private readonly chatMessageMaxLength = Number(
    process.env.CHAT_TEXT_MAX_LENGTH || '300',
  );
  private readonly chatVoiceMaxDurationMs = Number(
    process.env.CHAT_VOICE_MAX_DURATION_MS || '60000',
  );
  private readonly chatVoiceMaxBytes = Number(
    process.env.CHAT_VOICE_MAX_BYTES || '2097152',
  );
  private readonly chatPageSize = Number(process.env.CHAT_PAGE_SIZE || '50');
  private readonly chatPageMaxSize = Number(
    process.env.CHAT_PAGE_MAX_SIZE || '200',
  );
  private readonly chatRateWindows = new Map<string, number[]>();
  private readonly profileUpdatedListenerKey = 'events-gateway-profile-updated';
  private readonly profileUpdatedListener = (
    payload: PlayerProfileUpdatedRealtimeEvent,
  ) => {
    const message: PlayerProfileUpdatedData = {
      playerId: payload.playerId,
      playerName: payload.playerName,
      playerEmoji: payload.playerEmoji,
    };
    this.server.to(payload.roomId).emit('PLAYER_PROFILE_UPDATED', message);
  };

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
    private readonly robotAgentService: RobotAgentService,
    private readonly savedGameReviewService: SavedGameReviewService,
    private readonly authService: AuthService,
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
    @Inject('ISavedGameArchiveStorageService')
    private readonly savedGameArchiveStorageService: ISavedGameArchiveStorageService,
    @Inject('IChatStorageService')
    private readonly chatStorageService: IChatStorageService,
    @Inject('IChatMediaStorageService')
    private readonly chatMediaStorageService: IChatMediaStorageService,
  ) {
    realtimeEventBus.setSingletonListener(
      'PLAYER_PROFILE_UPDATED',
      this.profileUpdatedListenerKey,
      this.profileUpdatedListener,
    );
  }

  onModuleDestroy() {
    realtimeEventBus.clearSingletonListener(
      'PLAYER_PROFILE_UPDATED',
      this.profileUpdatedListenerKey,
      this.profileUpdatedListener,
    );
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    for (const timer of this.runCountDecisionTimers.values()) {
      clearTimeout(timer);
    }
    this.runCountDecisionTimers.clear();
  }

  private extractSocketToken(client: Socket): string {
    const authPayload = client.handshake.auth as
      | Record<string, unknown>
      | undefined;
    const authTokenCandidate = authPayload?.token;
    if (typeof authTokenCandidate === 'string' && authTokenCandidate.trim()) {
      return authTokenCandidate.trim();
    }

    const cookieToken = readAuthSessionCookie(client.handshake.headers.cookie);
    if (cookieToken) {
      return cookieToken;
    }

    const authorizationHeader = client.handshake.headers.authorization;
    if (typeof authorizationHeader === 'string' && authorizationHeader.trim()) {
      if (/^bearer\s+/i.test(authorizationHeader)) {
        return authorizationHeader.replace(/^bearer\s+/i, '').trim();
      }

      return authorizationHeader.trim();
    }

    return '';
  }

  private async requireAuthenticatedUser(
    client: Socket,
    tokenOverride?: string,
  ) {
    const token = tokenOverride?.trim() || this.extractSocketToken(client);
    if (!token) {
      throw new Error('Authentication required');
    }

    const user = await this.authService.getUserByToken(token);
    if (!user) {
      throw new Error('Invalid session');
    }

    return user;
  }

  private resolveRoomReadyPhase(room: any): ReadyPhase | null {
    if (room?.gameState === 'WAITING') {
      return 'START_GAME';
    }

    if (
      room?.gameState === 'IN_PROGRESS' &&
      room?.currentHand &&
      room.currentHand.currentPlayerTurn === null &&
      room.currentHand.lastResult
    ) {
      return 'NEXT_HAND';
    }

    return null;
  }

  private getReadyEligiblePlayerIds(room: any): string[] {
    return (room?.players ?? [])
      .filter((player: any) => player.status !== 'left')
      .filter((player: any) => !this.isPlayerDisconnected(player))
      .map((player: any) => player.id);
  }

  private syncRoomReadyState(room: any): void {
    const phase = this.resolveRoomReadyPhase(room);
    const eligiblePlayerIds = this.getReadyEligiblePlayerIds(room);
    const autoReadyRobotIds = (room?.players ?? [])
      .filter(
        (player: any) =>
          player.isRobot &&
          eligiblePlayerIds.includes(player.id) &&
          player.status !== 'left',
      )
      .map((player: any) => player.id);
    const currentReady = Array.isArray(room?.readyPlayerIds)
      ? room.readyPlayerIds
      : [];

    if (!phase) {
      room.readyPhase = null;
      room.readyPlayerIds = [];
      return;
    }

    room.readyPhase = phase;
    const filteredReady = currentReady.filter((playerId: string) =>
      eligiblePlayerIds.includes(playerId),
    );
    room.readyPlayerIds = [
      ...new Set([...filteredReady, ...autoReadyRobotIds]),
    ];
  }

  private emitReadyStateUpdated(roomId: string, room: any): void {
    const payload: ReadyStateUpdatedData = {
      phase: room?.readyPhase ?? null,
      readyPlayerIds: room?.readyPlayerIds ?? [],
    };
    this.server.to(roomId).emit('READY_STATE_UPDATED', payload);
  }

  private areAllEligiblePlayersReady(room: any): boolean {
    const eligiblePlayerIds = this.getReadyEligiblePlayerIds(room);
    if (eligiblePlayerIds.length < 2) {
      return false;
    }

    const readySet = new Set(room?.readyPlayerIds ?? []);
    return eligiblePlayerIds.every((playerId) => readySet.has(playerId));
  }

  private async startGameAndBroadcast(room: any): Promise<void> {
    const hand = await this.handService.startNewHand(room);
    const updatedRoom = await this.getRoom(room.id);

    const { activePlayers: _activePlayers, ...handWithoutActivePlayers } = hand;
    void _activePlayers;
    const gameStartedData: GameStartedData = {
      hand: handWithoutActivePlayers,
      players: updatedRoom.players.map((p) => ({
        ...this.sanitizePlayer(p),
        hasCards: !!p.cards,
      })),
    };

    this.server.to(room.id).emit('GAME_STARTED', gameStartedData);

    for (const seatPlayer of updatedRoom.players) {
      if (seatPlayer.cards && seatPlayer.socketId) {
        this.server.to(seatPlayer.socketId).emit('YOUR_CARDS', {
          cards: seatPlayer.cards,
        } as YourCardsData);
      }
    }

    const currentPlayer = updatedRoom.players.find(
      (p) => p.id === hand.currentPlayerTurn,
    );
    if (currentPlayer) {
      this.emitPlayerTurn(updatedRoom, currentPlayer);
    }

    this.logger.log(`Game started in room ${room.id}`);
  }

  private async markPlayerReadyAndMaybeStart(
    roomId: string,
    playerId: string,
    phase: ReadyPhase,
    allowTestShortcut: boolean,
  ) {
    const room = await this.getRoom(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    if (room.gameState === 'ENDED') {
      throw new Error('Game has ended. Leave room to start a new game.');
    }

    this.syncRoomReadyState(room);
    if (room.readyPhase !== phase) {
      throw new Error('Not accepting ready actions right now');
    }

    const eligiblePlayerIds = this.getReadyEligiblePlayerIds(room);
    if (!eligiblePlayerIds.includes(playerId)) {
      throw new Error('You are not eligible to ready');
    }
    if (eligiblePlayerIds.length < 2) {
      throw new Error('Need at least 2 connected players to start.');
    }

    const readySet = new Set(room.readyPlayerIds ?? []);
    readySet.add(playerId);

    if (allowTestShortcut && this.testDeckService.isTestMode()) {
      for (const eligiblePlayerId of eligiblePlayerIds) {
        readySet.add(eligiblePlayerId);
      }
    }

    room.readyPlayerIds = [...readySet];
    room.lastActivityAt = Date.now();
    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId,
          type: 'READY_STATE_UPDATED',
          actor: { source: 'EVENTS_GATEWAY', playerId },
          payload: {
            phase,
            readyPlayerIds: room.readyPlayerIds,
          },
        }),
      ),
    );
    this.emitReadyStateUpdated(room.id, room);

    const allReady = this.areAllEligiblePlayersReady(room);
    if (!allReady) {
      return { started: false };
    }

    if (phase === 'START_GAME') {
      await this.startGameAndBroadcast(room);
      return { started: true };
    }

    await this.startAndBroadcastNewHand(room.id);
    return { started: true };
  }

  private async maybeStartReadyPhaseIfAllReady(
    roomId: string,
    room: any,
  ): Promise<boolean> {
    this.syncRoomReadyState(room);
    const phase = room?.readyPhase;
    if (phase !== 'START_GAME' && phase !== 'NEXT_HAND') {
      return false;
    }

    if (!this.areAllEligiblePlayersReady(room)) {
      return false;
    }

    if (phase === 'START_GAME') {
      await this.startGameAndBroadcast(room);
      return true;
    }

    await this.startAndBroadcastNewHand(roomId);
    return true;
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    const playerInfo = this.socketToPlayer.get(client.id);
    if (!playerInfo) return;
    this.socketToPlayer.delete(client.id);

    const { roomId, playerId } = playerInfo;

    try {
      await this.runRoomActionSequentially(roomId, async () => {
        const room = await this.getRoom(roomId);
        const gracePeriod = room?.config?.reconnectGracePeriod ?? 120000;
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
        const updatedRoom = await this.gameService.markPlayerDisconnected(
          roomId,
          playerId,
        );
        if (updatedRoom) {
          this.syncRoomReadyState(updatedRoom);
          await this.storageService.persistRoom(
            updatedRoom,
            roomWrite(
              roomEvent({
                roomId,
                type: 'READY_STATE_UPDATED',
                actor: { source: 'EVENTS_GATEWAY', playerId },
                payload: {
                  phase: updatedRoom.readyPhase,
                  readyPlayerIds: updatedRoom.readyPlayerIds,
                },
              }),
            ),
          );
          const started = await this.maybeStartReadyPhaseIfAllReady(
            roomId,
            updatedRoom,
          );
          if (!started) {
            this.emitReadyStateUpdated(roomId, updatedRoom);
          }
        }

        // Notify room of disconnect
        this.server.to(roomId).emit('PLAYER_DISCONNECTED', {
          playerId,
          playerName,
          gracePeriod,
        });

        const pendingDecision = updatedRoom?.currentHand?.runCountDecision;
        const eligiblePlayerIds = pendingDecision?.eligiblePlayerIds ?? [];
        const twiceAgreedPlayerIds = new Set(
          pendingDecision?.twiceAgreedPlayerIds ?? [],
        );
        if (
          updatedRoom?.currentHand &&
          eligiblePlayerIds.includes(playerId) &&
          !twiceAgreedPlayerIds.has(playerId)
        ) {
          await this.resolveRunCountDecision(updatedRoom, 1);
        }
      });
    } catch (error) {
      this.logger.error(`Disconnect handling error: ${error.message}`);
    }
  }

  @SubscribeMessage('CREATE_ROOM')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: CreateRoomData,
  ) {
    try {
      const authenticatedUser = await this.requireAuthenticatedUser(client);

      const room = await this.gameService.createRoom(
        client.id,
        authenticatedUser.displayName,
        authenticatedUser.avatarEmoji,
        data.config,
        authenticatedUser.id,
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
      await this.emitInitialChatHistory(client, room.id);
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
      const authenticatedUser = await this.requireAuthenticatedUser(client);
      return await this.runRoomActionSequentially(data.roomId, async () => {
        const { room, player, rejoined } =
          await this.gameService.addPlayerToRoom(
            data.roomId,
            client.id,
            authenticatedUser.displayName,
            authenticatedUser.avatarEmoji,
            authenticatedUser.id,
          );

        client.join(room.id);

        this.trackPlayerSocket(client.id, room.id, player.id);

        if (rejoined) {
          const timer = this.disconnectTimers.get(player.id);
          if (timer) {
            clearTimeout(timer);
            this.disconnectTimers.delete(player.id);
          }

          this.server.to(room.id).emit('PLAYER_RECONNECTED', {
            playerId: player.id,
            playerName: player.name,
            status: player.status,
            connectionStatus: player.connectionStatus ?? 'connected',
          });
        } else {
          // Notify all in room
          this.server.to(room.id).emit('PLAYER_JOINED', {
            player: this.sanitizePlayer(player),
          } as PlayerJoinedData);
        }

        client.emit('ROOM_JOINED', {
          player: this.sanitizePlayer(player),
          room: this.sanitizeRoom(room),
        });
        await this.emitInitialChatHistory(client, room.id);

        this.logger.log(
          `Player ${player.name} ${rejoined ? 'rejoined' : 'joined'} room ${room.id}`,
        );
        this.syncRoomReadyState(room);
        await this.storageService.persistRoom(
          room,
          roomWrite(
            roomEvent({
              roomId: room.id,
              type: 'READY_STATE_UPDATED',
              actor: { source: 'EVENTS_GATEWAY', playerId: player.id },
              payload: {
                phase: room.readyPhase,
                readyPlayerIds: room.readyPlayerIds,
              },
            }),
          ),
        );
        this.emitReadyStateUpdated(room.id, room);
        return { success: true };
      });
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
      const authenticatedUser = await this.requireAuthenticatedUser(client);
      return await this.runRoomActionSequentially(data.roomId, async () => {
        const player = await this.gameService.updatePlayerSocket(
          data.roomId,
          authenticatedUser.displayName,
          client.id,
          data.playerId,
          authenticatedUser.id,
        );

        if (!player) {
          client.emit('RECONNECT_ERROR', {
            reason: 'Player not found in room',
          });
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
        const room = await this.getRoom(data.roomId);
        if (!room) {
          throw new Error('Room not found');
        }
        this.syncRoomReadyState(room);
        await this.storageService.persistRoom(
          room,
          roomWrite(
            roomEvent({
              roomId: room.id,
              type: 'READY_STATE_UPDATED',
              actor: { source: 'EVENTS_GATEWAY', playerId: player.id },
              payload: {
                phase: room.readyPhase,
                readyPlayerIds: room.readyPlayerIds,
              },
            }),
          ),
        );
        client.emit('RECONNECT_SUCCESS', {
          player: this.sanitizePlayer(player),
          room: this.sanitizeRoom(room),
          yourCards: player.cards,
        });
        await this.emitInitialChatHistory(client, data.roomId);

        this.server.to(data.roomId).emit('PLAYER_RECONNECTED', {
          playerId: player.id,
          playerName: player.name,
          status: player.status,
          connectionStatus: player.connectionStatus ?? 'connected',
        });
        this.emitReadyStateUpdated(data.roomId, room);

        this.logger.log(
          `Player ${player.name} reconnected to room ${data.roomId}`,
        );
        return { success: true };
      });
    } catch (error) {
      this.logger.error(`Reconnect error: ${error.message}`);
      client.emit('RECONNECT_ERROR', { reason: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('UPDATE_PROFILE')
  async handleUpdateProfile(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: UpdateProfileData,
  ) {
    try {
      const authenticatedUser = await this.requireAuthenticatedUser(client);
      const user = await this.authService.updateProfileByUserId({
        userId: authenticatedUser.id,
        displayName: data.displayName,
        avatarEmoji: data.avatarEmoji,
      });
      return { success: true, user };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update profile';
      this.logger.error(`Update profile error: ${message}`);
      client.emit('ERROR', { message });
      return { success: false, error: message };
    }
  }

  @SubscribeMessage('SEND_CHAT_MESSAGE')
  async handleSendChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SendChatMessageData,
  ): Promise<SendChatMessageAck> {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) {
        throw new Error('Not in a room');
      }

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const room = await this.getRoom(playerInfo.roomId);
          if (!room) {
            throw new Error('Room not found');
          }

          const sender = room.players.find(
            (player) => player.id === playerInfo.playerId,
          );
          if (!sender) {
            throw new Error('Player not found in room');
          }

          const clientMessageId = data.clientMessageId?.trim();
          if (!clientMessageId) {
            throw new Error('clientMessageId is required');
          }

          const existing = this.getProcessedChatMessage(
            playerInfo.roomId,
            playerInfo.playerId,
            clientMessageId,
          );
          if (existing) {
            return {
              success: true,
              duplicate: true,
              message: existing,
            };
          }

          this.assertChatRateLimit(playerInfo.roomId, playerInfo.playerId);
          const normalized = this.normalizeChatMessageData(
            data,
            playerInfo.roomId,
          );

          const appendResult = await this.chatStorageService.appendMessage(
            {
              roomId: playerInfo.roomId,
              kind: normalized.kind,
              text: normalized.kind === 'TEXT' ? normalized.text : undefined,
              voice: normalized.kind === 'VOICE' ? normalized.voice : undefined,
              clientMessageId,
              sender: {
                playerId: sender.id,
                playerName: sender.name,
                playerEmoji: sender.emoji,
              },
            },
            {
              dedupeWindowMs: this.processedChatMessageTtlMs,
            },
          );

          this.markProcessedChatMessage(
            playerInfo.roomId,
            playerInfo.playerId,
            clientMessageId,
            appendResult.message,
          );

          if (!appendResult.duplicate) {
            this.server.to(playerInfo.roomId).emit('CHAT_MESSAGE_ADDED', {
              message: appendResult.message,
            });
          }

          return {
            success: true,
            duplicate: appendResult.duplicate,
            message: appendResult.message,
          };
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to send chat message';
      client.emit('ERROR', { message });
      return { success: false, error: message };
    }
  }

  @SubscribeMessage('GET_CHAT_HISTORY')
  async handleGetChatHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: GetChatHistoryData,
  ): Promise<
    ChatHistorySyncData & {
      success: boolean;
      error?: string;
    }
  > {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) {
        throw new Error('Not in a room');
      }

      const limit = this.normalizeHistoryPageLimit(data?.limit);
      const page = await this.chatStorageService.getMessagePage(
        playerInfo.roomId,
        {
          beforeSeq: data?.beforeSeq,
          limit,
        },
      );

      return {
        success: true,
        ...page,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load chat history';
      return {
        success: false,
        error: message,
        messages: [],
        hasMore: false,
        nextBeforeSeq: null,
      };
    }
  }

  @SubscribeMessage('START_GAME')
  async handleStartGame(@ConnectedSocket() client: Socket) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');
      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const result = await this.markPlayerReadyAndMaybeStart(
            playerInfo.roomId,
            playerInfo.playerId,
            'START_GAME',
            true,
          );
          return { success: true, started: result.started };
        },
      );
    } catch (error) {
      this.logger.error(`Start game error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('START_NEXT_HAND')
  async handleStartNextHand(@ConnectedSocket() client: Socket) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');
      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const result = await this.markPlayerReadyAndMaybeStart(
            playerInfo.roomId,
            playerInfo.playerId,
            'NEXT_HAND',
            true,
          );
          return { success: true, started: result.started };
        },
      );
    } catch (error) {
      this.logger.error(`Start next hand error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('PLAYER_READY')
  async handlePlayerReady(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data: PlayerReadyData,
  ) {
    void _data;
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const room = await this.getRoom(playerInfo.roomId);
          if (!room) throw new Error('Room not found');

          const phase = this.resolveRoomReadyPhase(room);
          if (!phase) {
            throw new Error('No readiness action available right now');
          }

          const result = await this.markPlayerReadyAndMaybeStart(
            playerInfo.roomId,
            playerInfo.playerId,
            phase,
            true,
          );
          return { success: true, started: result.started };
        },
      );
    } catch (error) {
      this.logger.error(`Player ready error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('ADD_ROBOT_PLAYER')
  async handleAddRobotPlayer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: AddRobotPlayerData,
  ) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const { room, player } = await this.gameService.addRobotToRoom(
            playerInfo.roomId,
            playerInfo.playerId,
            data?.name,
            data?.emoji,
          );

          this.server.to(room.id).emit('PLAYER_JOINED', {
            player: this.sanitizePlayer(player),
          } as PlayerJoinedData);

          this.syncRoomReadyState(room);
          await this.storageService.persistRoom(
            room,
            roomWrite(
              roomEvent({
                roomId: room.id,
                type: 'READY_STATE_UPDATED',
                actor: {
                  source: 'EVENTS_GATEWAY',
                  playerId: playerInfo.playerId,
                },
                payload: {
                  phase: room.readyPhase,
                  readyPlayerIds: room.readyPlayerIds,
                },
              }),
            ),
          );
          const started = await this.maybeStartReadyPhaseIfAllReady(
            room.id,
            room,
          );
          if (!started) {
            this.emitReadyStateUpdated(room.id, room);
          }
          return { success: true, playerId: player.id };
        },
      );
    } catch (error) {
      const message = this.getErrorMessage(error, 'Failed to add robot');
      this.logger.error(`Add robot error: ${message}`);
      client.emit('ERROR', { message });
      return { success: false, error: message };
    }
  }

  @SubscribeMessage('REMOVE_ROBOT_PLAYER')
  async handleRemoveRobotPlayer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: RemoveRobotPlayerData,
  ) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const room = await this.getRoom(playerInfo.roomId);
          const robot = room?.players?.find(
            (entry: any) => entry.id === data.playerId && entry.isRobot,
          );
          if (!robot) {
            throw new Error('Robot player not found');
          }

          const updatedRoom = await this.gameService.removeRobotFromRoom(
            playerInfo.roomId,
            playerInfo.playerId,
            data.playerId,
          );

          this.server.to(updatedRoom.id).emit('PLAYER_LEFT', {
            playerId: data.playerId,
            playerName: robot.name,
          });

          this.syncRoomReadyState(updatedRoom);
          await this.storageService.persistRoom(
            updatedRoom,
            roomWrite(
              roomEvent({
                roomId: updatedRoom.id,
                type: 'READY_STATE_UPDATED',
                actor: {
                  source: 'EVENTS_GATEWAY',
                  playerId: playerInfo.playerId,
                },
                payload: {
                  phase: updatedRoom.readyPhase,
                  readyPlayerIds: updatedRoom.readyPlayerIds,
                },
              }),
            ),
          );
          const started = await this.maybeStartReadyPhaseIfAllReady(
            updatedRoom.id,
            updatedRoom,
          );
          if (!started) {
            this.emitReadyStateUpdated(updatedRoom.id, updatedRoom);
          }
          return { success: true };
        },
      );
    } catch (error) {
      const message = this.getErrorMessage(error, 'Failed to remove robot');
      this.logger.error(`Remove robot error: ${message}`);
      client.emit('ERROR', { message });
      return { success: false, error: message };
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
            handsPlayedCount: seatPlayer.handsPlayedCount ?? 0,
            handsWonCount: seatPlayer.handsWonCount ?? 0,
            vpipHandsCount: seatPlayer.vpipHandsCount ?? 0,
          };
        })
        .sort((a, b) => {
          if (b.finalChips !== a.finalChips) return b.finalChips - a.finalChips;
          if (b.profit !== a.profit) return b.profit - a.profit;
          return a.playerName.localeCompare(b.playerName);
        });

      const totalPlayers = standings.length;
      const totalBuyIn = standings.reduce(
        (sum, entry) => sum + entry.totalBuyIn,
        0,
      );
      const totalChipsInPlay = standings.reduce(
        (sum, entry) => sum + entry.finalChips,
        0,
      );
      const profitablePlayers = standings.filter(
        (entry) => entry.profit > 0,
      ).length;
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
      room.readyPhase = null;
      room.readyPlayerIds = [];
      room.lastActivityAt = Date.now();
      room.players = room.players.map((seatPlayer) => {
        return {
          ...seatPlayer,
          cards: null,
          currentBet: 0,
          lastAction: null,
          status: seatPlayer.status === 'left' ? 'left' : 'waiting',
        };
      });
      await this.storageService.persistRoom(
        room,
        roomWrite(
          roomEvent({
            roomId: room.id,
            type: 'ROOM_CONFIG_UPDATED',
            actor: { source: 'EVENTS_GATEWAY', playerId: playerInfo.playerId },
            payload: {
              config: room.config,
            },
          }),
        ),
      );
      const archived = await this.savedGameArchiveStorageService.archiveEndedRoom(
        room.id,
      );
      if (archived?.archiveId) {
        await this.savedGameReviewService.scheduleArchiveReview(
          archived.archiveId,
        );
      }

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
    void _data;
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const room = await this.getRoom(playerInfo.roomId);
          if (!room?.currentHand) throw new Error('No hand state found');

          if (room.currentHand.currentPlayerTurn) {
            throw new Error('Current hand is still in progress');
          }

          const hand = room.currentHand;
          const isPendingShowdown =
            hand.bettingRound === 'SHOWDOWN' && !hand.lastResult;
          if (isPendingShowdown) {
            if ((hand.showdownDecisionOrder ?? []).length === 0) {
              await this.initializeShowdownDecisionState(room);
            }

            if (!hand.activePlayers.includes(playerInfo.playerId)) {
              throw new Error('You cannot reveal cards for this hand');
            }

            if (hand.showdownDecisionPlayerId !== playerInfo.playerId) {
              throw new Error('It is not your showdown decision turn');
            }

            const didReveal = await this.applyShowdownReveal(
              room,
              playerInfo.playerId,
            );
            if (!didReveal) {
              return { success: true };
            }

            await this.advanceShowdownDecision(room);
            return { success: true };
          }

          const completedResult = hand.lastResult;
          if (!completedResult) {
            throw new Error('No completed hand result available');
          }

          const playerHand = completedResult.playerHands.find(
            (entry) => entry.playerId === playerInfo.playerId,
          );
          if (!playerHand) {
            throw new Error('You cannot reveal cards for this hand');
          }

          const currentReveals = new Set(hand.revealedPlayerIds ?? []);
          if (currentReveals.has(playerInfo.playerId)) {
            return { success: true };
          }

          currentReveals.add(playerInfo.playerId);
          hand.revealedPlayerIds = [...currentReveals];
          const player = room.players.find((p) => p.id === playerInfo.playerId);
          room.lastActivityAt = Date.now();
          await this.storageService.persistRoom(
            room,
            roomWrite(
              roomEvent({
                roomId: room.id,
                type: 'SHOWDOWN_DECISION_UPDATED',
                actor: {
                  source: 'EVENTS_GATEWAY',
                  playerId: playerInfo.playerId,
                  playerName: player?.name ?? '',
                },
                handNumber: hand.handNumber,
                street: hand.bettingRound,
                payload: {
                  action: 'REVEAL',
                  revealedPlayerIds: hand.revealedPlayerIds,
                },
              }),
            ),
          );

          const settledCards =
            hand.settledPlayerCardsByPlayerId?.[playerInfo.playerId] ??
            playerHand.cards;
          const revealData: PlayerHandRevealedData = {
            playerId: playerInfo.playerId,
            playerName: player?.name ?? '',
            cards: settledCards,
            handNumber: hand.handNumber,
            showdownOrderIndex: -1,
          };

          this.server.to(room.id).emit('PLAYER_HAND_REVEALED', revealData);
          return { success: true };
        },
      );
    } catch (error) {
      this.logger.error(`Show hand error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false };
    }
  }

  @SubscribeMessage('MUCK_MY_HAND')
  async handleMuckMyHand(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data: MuckMyHandData,
  ) {
    void _data;
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const room = await this.getRoom(playerInfo.roomId);
          const hand = room?.currentHand;
          if (!room || !hand) throw new Error('No hand state found');

          if (hand.currentPlayerTurn) {
            throw new Error('Current hand is still in progress');
          }

          const isPendingShowdown =
            hand.bettingRound === 'SHOWDOWN' && !hand.lastResult;
          if (!isPendingShowdown) {
            throw new Error('Fold is only available during showdown');
          }

          if ((hand.showdownDecisionOrder ?? []).length === 0) {
            await this.initializeShowdownDecisionState(room);
          }

          if (!hand.activePlayers.includes(playerInfo.playerId)) {
            throw new Error('You cannot fold for this hand');
          }

          if (hand.showdownDecisionPlayerId !== playerInfo.playerId) {
            throw new Error('It is not your showdown decision turn');
          }

          if (
            (hand.showdownForcedRevealPlayerIds ?? []).includes(
              playerInfo.playerId,
            )
          ) {
            throw new Error('All-in players must reveal at showdown');
          }

          const didMuck = await this.applyShowdownMuck(
            room,
            playerInfo.playerId,
          );
          if (!didMuck) {
            return { success: true };
          }

          await this.advanceShowdownDecision(room);
          return { success: true };
        },
      );
    } catch (error) {
      this.logger.error(`Fold hand error: ${error.message}`);
      client.emit('ERROR', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('REVEAL_NEXT_STREET')
  async handleRevealNextStreet(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data: RevealNextStreetData,
  ) {
    void _data;
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const room = await this.getRoom(playerInfo.roomId);
          const hand = room?.currentHand;
          if (!room || !hand) throw new Error('No active hand');

          const nextRound = hand.pendingStreetRevealRound;
          if (!nextRound) {
            throw new Error('No next street reveal is pending');
          }

          const required = new Set<string>(
            hand.nextStreetRequiredPlayerIds ??
              this.getStreetRevealRequiredPlayerIds(room),
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
            await this.storageService.persistRoom(
              room,
              roomWrite(
                roomEvent({
                  roomId: room.id,
                  type: 'STREET_REVEAL_UPDATED',
                  actor: { source: 'EVENTS_GATEWAY', playerId: playerInfo.playerId },
                  handNumber: hand.handNumber,
                  street: nextRound,
                  payload: {
                    nextRound,
                    readyPlayerIds: [...ready],
                    requiredPlayerIds: [...required],
                  },
                }),
              ),
            );
          }

          const revealState: NextStreetRevealStateData = {
            nextRound,
            readyPlayerIds: [...ready],
            requiredPlayerIds: [...required],
          };
          this.server.to(room.id).emit('NEXT_STREET_REVEAL_STATE', revealState);

          const allReady = ready.size > 0;
          if (allReady) {
            const shouldRevealHandResult =
              nextRound === 'SHOWDOWN' &&
              (hand.bettingRound === 'SHOWDOWN' ||
                (typeof this.handService.isHandComplete === 'function' &&
                  this.handService.isHandComplete(room)));
            if (shouldRevealHandResult) {
              await this.completeAndBroadcastHand(room);
            } else {
              await this.advanceRoundAndBroadcast(room);
            }
          }

          return { success: true };
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Reveal next street failed';

      if (message === 'No next street reveal is pending') {
        this.logger.debug(
          `Reveal next street already handled (duplicate request): ${client.id}`,
        );
        return { success: true, duplicate: true };
      }

      this.logger.error(`Reveal next street error: ${message}`);
      client.emit('ERROR', { message });
      return { success: false, error: message };
    }
  }

  @SubscribeMessage('SET_RUN_COUNT')
  async handleSetRunCount(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SetRunCountData,
  ) {
    try {
      const playerInfo = this.socketToPlayer.get(client.id);
      if (!playerInfo) throw new Error('Not in a room');

      const requestedRunCount: RunCount = data?.runCount === 2 ? 2 : 1;

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const room = await this.getRoom(playerInfo.roomId);
          const hand = room?.currentHand;
          if (!room || !hand) {
            throw new Error('No active hand');
          }

          const decision = hand.runCountDecision;
          if (!decision || decision.eligiblePlayerIds.length === 0) {
            return { success: true, duplicate: true };
          }

          if (Date.now() >= decision.expiresAt) {
            await this.resolveRunCountDecision(room, 1);
            return { success: true, duplicate: true };
          }

          if (!decision.eligiblePlayerIds.includes(playerInfo.playerId)) {
            throw new Error('You are not eligible to choose the run count');
          }

          if (requestedRunCount === 1) {
            await this.resolveRunCountDecision(room, 1);
            return { success: true };
          }

          const twiceAgreedPlayerIds = new Set(
            decision.twiceAgreedPlayerIds ?? [],
          );
          const alreadyAgreed = twiceAgreedPlayerIds.has(playerInfo.playerId);
          if (!alreadyAgreed) {
            twiceAgreedPlayerIds.add(playerInfo.playerId);
            hand.runCountDecision = {
              ...decision,
              twiceAgreedPlayerIds: [...twiceAgreedPlayerIds],
            };
            room.lastActivityAt = Date.now();
            await this.storageService.persistRoom(room);
          }

          this.emitRunCountDecisionState(room);

          const everyoneAgreedTwice = decision.eligiblePlayerIds.every(
            (playerId) => twiceAgreedPlayerIds.has(playerId),
          );
          if (everyoneAgreedTwice) {
            await this.resolveRunCountDecision(room, 2);
          }

          return { success: true, duplicate: alreadyAgreed };
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Set run count failed';
      this.logger.error(`Set run count error: ${message}`);
      client.emit('ERROR', { message });
      return { success: false, error: message };
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
      await this.storageService.persistRoom(
        room,
        roomWrite(
          roomEvent({
            roomId: room.id,
            type: 'STREET_REVEAL_UPDATED',
            actor: { source: 'EVENTS_GATEWAY', playerId: playerInfo.playerId },
            handNumber: room.currentHand?.handNumber ?? null,
            street: room.currentHand?.bettingRound ?? null,
            payload: {
              nextRound: room.currentHand?.pendingStreetRevealRound ?? null,
              config: room.config,
            },
          }),
        ),
      );

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
    const pendingRobotDecisionKey = requestActionId
      ? this.getPendingRobotActionDecisionKey(client.id, requestActionId)
      : null;
    const pendingRobotDecision = pendingRobotDecisionKey
      ? this.pendingRobotActionDecisions.get(pendingRobotDecisionKey)
      : undefined;
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

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
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

          const preActionChips = player.chips;
          const preRoundCurrentBet = room.currentHand.currentBet;

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
            {
              actionId: actionId ?? null,
              robotDecision: pendingRobotDecision,
            },
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
          const updatedPlayer = updatedRoom.players.find(
            (p) => p.id === player.id,
          );
          if (!updatedPlayer) {
            throw new Error('Updated player not found');
          }

          const resolvedAction = updatedPlayer.lastAction ?? data.action;

          const displayKind = (() => {
            switch (resolvedAction) {
              case 'fold':
                return 'fold' as PlayerActionDisplayKind;
              case 'check':
                return 'check' as PlayerActionDisplayKind;
              case 'call':
                return 'call-to' as PlayerActionDisplayKind;
              case 'all-in':
                return 'all-in-to' as PlayerActionDisplayKind;
              case 'raise':
                return preRoundCurrentBet <= 0
                  ? ('bet-to' as PlayerActionDisplayKind)
                  : ('raise-to' as PlayerActionDisplayKind);
            }
          })();

          const committedAmount = Math.max(
            0,
            preActionChips - updatedPlayer.chips,
          );
          const blindType: BlindType | null = null;

          // Broadcast action
          const actionData: PlayerActedData = {
            playerId: player.id,
            playerName: player.name,
            action: resolvedAction,
            playerStatus: updatedPlayer.status,
            amount: resolvedAction === 'all-in' ? undefined : data.amount,
            displayKind,
            totalBetAfterAction: updatedPlayer.currentBet,
            committedAmount,
            blindType,
            newPot: updatedRoom.currentHand!.pot,
            newChips: updatedPlayer.chips,
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
              await this.storageService.persistRoom(updatedRoom);
              this.logger.debug(`Turn advanced to ${nextPlayer.name}`);
              this.emitPlayerTurn(updatedRoom, nextPlayer);
            }
          }

          return { success: true };
        },
      );
    } catch (error) {
      this.logger.warn(
        `Player action rejected ${this.serializeForLog({
          ...baseActionLog,
          reason: error.message,
        })}`,
      );
      client.emit('ERROR', { message: error.message });
      return { success: false };
    } finally {
      if (pendingRobotDecisionKey) {
        this.pendingRobotActionDecisions.delete(pendingRobotDecisionKey);
      }
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

      return await this.runRoomActionSequentially(
        playerInfo.roomId,
        async () => {
          const roomBeforeLeave = await this.getRoom(playerInfo.roomId);
          const leavingPlayer = roomBeforeLeave?.players.find(
            (player) => player.id === playerInfo.playerId,
          );
          const room = await this.gameService.removePlayerFromRoom(
            playerInfo.roomId,
            playerInfo.playerId,
          );

          client.leave(playerInfo.roomId);
          this.socketToPlayer.delete(client.id);

          if (room) {
            this.syncRoomReadyState(room);
            await this.storageService.persistRoom(room);
            this.server.to(playerInfo.roomId).emit('PLAYER_LEFT', {
              playerId: playerInfo.playerId,
              playerName: leavingPlayer?.name ?? '',
            });
            this.emitReadyStateUpdated(playerInfo.roomId, room);

            // If host changed
            const oldHostId = playerInfo.playerId;
            if (room.hostId !== oldHostId) {
              const newHost = room.players.find((p) => p.id === room.hostId)!;
              this.server.to(playerInfo.roomId).emit('HOST_CHANGED', {
                newHostId: newHost.id,
                newHostName: newHost.name,
              });
            }

            if (room.currentHand && room.gameState === 'IN_PROGRESS') {
              if (
                room.currentHand.bettingRound === 'SHOWDOWN' &&
                !room.currentHand.lastResult
              ) {
                await this.advanceShowdownDecision(room);
              } else if (room.currentHand.bettingRound !== 'SHOWDOWN') {
                if (this.bettingService.isBettingRoundComplete(room)) {
                  await this.handleBettingRoundComplete(room);
                } else if (room.currentHand.currentPlayerTurn === null) {
                  const nextPlayer = this.handService.getNextPlayer(room);
                  if (nextPlayer) {
                    room.currentHand.currentPlayerTurn = nextPlayer.id;
                    await this.storageService.persistRoom(room);
                    this.emitPlayerTurn(room, nextPlayer);
                  }
                }
              }
            }
          } else {
            this.clearRobotTurnTimer(playerInfo.roomId);
            await this.chatStorageService.deleteRoomChat(playerInfo.roomId);
            await this.chatMediaStorageService.deleteRoomMedia(
              playerInfo.roomId,
            );
          }

          return { success: true };
        },
      );
    } catch (error) {
      this.logger.error(`Leave room error: ${error.message}`);
      return { success: false };
    }
  }

  private normalizeHistoryPageLimit(limit?: number): number {
    if (limit === undefined || !Number.isFinite(limit)) {
      return Math.min(this.chatPageSize, this.chatPageMaxSize);
    }

    return Math.min(this.chatPageMaxSize, Math.max(1, Math.floor(limit)));
  }

  private async emitInitialChatHistory(client: Socket, roomId: string) {
    try {
      const page = await this.chatStorageService.getMessagePage(roomId, {
        limit: this.normalizeHistoryPageLimit(this.chatPageSize),
      });

      client.emit('CHAT_HISTORY_SYNC', page);
    } catch (error) {
      this.logger.warn(
        'Failed to emit initial chat history for room ' +
          roomId +
          ': ' +
          (error as Error).message,
      );
    }
  }

  private normalizeChatMessageData(
    data: SendChatMessageData,
    roomId: string,
  ):
    | { kind: 'TEXT'; text: string }
    | { kind: 'VOICE'; voice: SendChatMessageData['voice'] } {
    if (!data || (data.kind !== 'TEXT' && data.kind !== 'VOICE')) {
      throw new Error('Invalid chat message kind');
    }

    if (data.kind === 'TEXT') {
      const text = data.text?.trim() || '';
      if (!text) {
        throw new Error('Message cannot be empty');
      }
      if (text.length > this.chatMessageMaxLength) {
        throw new Error(
          `Message exceeds ${this.chatMessageMaxLength} characters`,
        );
      }
      return {
        kind: 'TEXT',
        text,
      };
    }

    const voice = data.voice;
    if (!voice) {
      throw new Error('Voice payload is required');
    }

    const allowedMimeTypes = new Set([
      'audio/webm',
      'audio/ogg',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
      'audio/x-wav',
    ]);
    const normalizedVoiceMimeType = voice.mimeType
      ?.trim()
      .toLowerCase()
      .split(';', 1)[0]
      ?.trim();
    if (
      !normalizedVoiceMimeType ||
      !allowedMimeTypes.has(normalizedVoiceMimeType)
    ) {
      throw new Error('Unsupported audio mime type');
    }

    if (
      !voice.audioUrl.startsWith(
        `/uploads/chat-audio/${encodeURIComponent(roomId)}/`,
      )
    ) {
      throw new Error('Invalid voice audio URL for room');
    }

    if (!Number.isFinite(voice.durationMs) || voice.durationMs <= 0) {
      throw new Error('Invalid voice duration');
    }
    if (voice.durationMs > this.chatVoiceMaxDurationMs) {
      throw new Error(`Voice message exceeds ${this.chatVoiceMaxDurationMs}ms`);
    }

    if (!Number.isFinite(voice.sizeBytes) || voice.sizeBytes <= 0) {
      throw new Error('Invalid voice size');
    }
    if (voice.sizeBytes > this.chatVoiceMaxBytes) {
      throw new Error(`Voice message exceeds ${this.chatVoiceMaxBytes} bytes`);
    }

    return {
      kind: 'VOICE',
      voice: {
        ...voice,
        mimeType: normalizedVoiceMimeType,
      },
    };
  }

  private assertChatRateLimit(roomId: string, playerId: string) {
    const key = `${roomId}:${playerId}`;
    const now = Date.now();
    const windowStart = now - this.chatRateLimitWindowMs;
    const history = (this.chatRateWindows.get(key) || []).filter(
      (timestamp) => timestamp >= windowStart,
    );

    if (history.length >= this.chatRateLimitCount) {
      throw new Error('You are sending messages too quickly');
    }

    history.push(now);
    this.chatRateWindows.set(key, history);

    if (this.chatRateWindows.size > 10000) {
      this.pruneChatRateWindows(now);
    }
  }

  private pruneChatRateWindows(now: number) {
    const windowStart = now - this.chatRateLimitWindowMs;
    for (const [key, history] of this.chatRateWindows.entries()) {
      const active = history.filter((timestamp) => timestamp >= windowStart);
      if (active.length === 0) {
        this.chatRateWindows.delete(key);
      } else {
        this.chatRateWindows.set(key, active);
      }
    }
  }

  private buildChatMessageFingerprint(
    roomId: string,
    playerId: string,
    clientMessageId: string,
  ): string {
    return `${roomId}:${playerId}:${clientMessageId}`;
  }

  private getProcessedChatMessage(
    roomId: string,
    playerId: string,
    clientMessageId: string,
  ): ChatMessage | null {
    this.pruneProcessedChatMessages();
    const key = this.buildChatMessageFingerprint(
      roomId,
      playerId,
      clientMessageId,
    );
    return this.processedChatMessageFingerprints.get(key)?.message || null;
  }

  private markProcessedChatMessage(
    roomId: string,
    playerId: string,
    clientMessageId: string,
    message: ChatMessage,
  ) {
    this.pruneProcessedChatMessages();

    const key = this.buildChatMessageFingerprint(
      roomId,
      playerId,
      clientMessageId,
    );
    this.processedChatMessageFingerprints.set(key, {
      timestamp: Date.now(),
      message,
    });

    if (
      this.processedChatMessageFingerprints.size >
      this.maxProcessedChatMessageFingerprints
    ) {
      const oldestKey = this.processedChatMessageFingerprints
        .keys()
        .next().value;
      if (oldestKey) {
        this.processedChatMessageFingerprints.delete(oldestKey);
      }
    }
  }

  private pruneProcessedChatMessages() {
    const cutoff = Date.now() - this.processedChatMessageTtlMs;
    for (const [
      key,
      value,
    ] of this.processedChatMessageFingerprints.entries()) {
      if (value.timestamp < cutoff) {
        this.processedChatMessageFingerprints.delete(key);
      }
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

    await previous.catch(() => undefined);

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
    const allowPlayerStreetReveal =
      room.config?.allowPlayerStreetReveal ?? true;

    // Check if hand is over
    if (this.handService.isHandComplete(room)) {
      const queuedResultReveal = await this.queueHandResultRevealGate(room);
      if (!queuedResultReveal) {
        await this.completeAndBroadcastHand(room);
      }
      return;
    }

    const nextRound = this.getNextBettingRound(hand.bettingRound);
    const isTransitioningToShowdown = nextRound === 'SHOWDOWN';
    const shouldWaitForPlayerReveal =
      allowPlayerStreetReveal &&
      !this.shouldAutoDealRemainingCommunityCards(room) &&
      !isTransitioningToShowdown;

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
      await this.storageService.persistRoom(
        room,
        roomWrite(
          roomEvent({
            roomId: room.id,
            type: 'STREET_REVEAL_UPDATED',
            actor: { source: 'EVENTS_GATEWAY' },
            handNumber: room.currentHand?.handNumber ?? null,
            street: nextRound,
            payload: {
              nextRound,
              awaitingPlayerStreetReveal: true,
              requiredPlayerIds,
            },
          }),
        ),
      );

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

    if (this.shouldOfferRunCountDecision(room)) {
      const initialized = await this.initializeRunCountDecision(room);
      if (initialized) {
        return;
      }
    }

    await this.advanceRoundAndBroadcast(room);
  }

  private getRunCountDecisionTimerKey(roomId: string, handNumber: number): string {
    return `${roomId}:${handNumber}`;
  }

  private clearRunCountDecisionTimer(roomId: string, handNumber: number): void {
    const timerKey = this.getRunCountDecisionTimerKey(roomId, handNumber);
    const existingTimer = this.runCountDecisionTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.runCountDecisionTimers.delete(timerKey);
    }
  }

  private emitRunCountDecisionState(room: Room | null | undefined): void {
    if (!room) {
      return;
    }

    const hand = room.currentHand;
    const decision = hand?.runCountDecision;
    if (!hand || !decision || decision.eligiblePlayerIds.length === 0) {
      this.server.to(room.id).emit('RUN_COUNT_DECISION_STATE', null);
      return;
    }

    const payload: RunCountDecisionStateData = {
      handNumber: hand.handNumber,
      eligiblePlayerIds: decision.eligiblePlayerIds ?? [],
      twiceAgreedPlayerIds: decision.twiceAgreedPlayerIds ?? [],
      expiresAt: decision.expiresAt,
    };

    this.server.to(room.id).emit('RUN_COUNT_DECISION_STATE', payload);
  }

  private getRunCountEligiblePlayerIds(room: any): string[] {
    const hand = room?.currentHand;
    if (!hand) {
      return [];
    }

    return [...(room.players ?? [])]
      .filter(
        (player: any) =>
          hand.activePlayers.includes(player.id) &&
          player.status !== 'left' &&
          Boolean(player.cards),
      )
      .sort((left: any, right: any) => left.position - right.position)
      .map((player: any) => player.id);
  }

  private shouldOfferRunCountDecision(room: any): boolean {
    const hand = room?.currentHand;
    if (!hand) {
      return false;
    }

    if (hand.bettingRound === 'SHOWDOWN' || hand.communityCards.length >= 5) {
      return false;
    }

    if (hand.runCountDecision?.eligiblePlayerIds?.length) {
      return true;
    }

    if (!this.shouldAutoDealRemainingCommunityCards(room)) {
      return false;
    }

    return this.getRunCountEligiblePlayerIds(room).length >= 2;
  }

  private scheduleRunCountDecisionTimeout(room: any): void {
    const hand = room?.currentHand;
    const decision = hand?.runCountDecision;
    if (!hand || !decision) {
      return;
    }

    const timerKey = this.getRunCountDecisionTimerKey(room.id, hand.handNumber);
    const existingTimer = this.runCountDecisionTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const remainingMs = Math.max(0, decision.expiresAt - Date.now());
    const timer = setTimeout(async () => {
      this.runCountDecisionTimers.delete(timerKey);
      try {
        await this.runRoomActionSequentially(room.id, async () => {
          const latestRoom = await this.getRoom(room.id);
          const latestHand = latestRoom?.currentHand;
          const latestDecision = latestHand?.runCountDecision;
          if (
            !latestRoom ||
            !latestHand ||
            latestHand.handNumber !== hand.handNumber ||
            !latestDecision
          ) {
            return;
          }

          if (Date.now() < latestDecision.expiresAt) {
            return;
          }

          await this.resolveRunCountDecision(latestRoom, 1);
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(`Run count decision timeout error: ${message}`);
      }
    }, remainingMs);

    this.runCountDecisionTimers.set(timerKey, timer);
  }

  private async initializeRunCountDecision(room: any): Promise<boolean> {
    const hand = room?.currentHand;
    if (!hand) {
      return false;
    }

    if (hand.runCountDecision?.eligiblePlayerIds?.length) {
      if (Date.now() >= hand.runCountDecision.expiresAt) {
        await this.resolveRunCountDecision(room, 1);
        return true;
      }

      this.scheduleRunCountDecisionTimeout(room);
      this.emitRunCountDecisionState(room);
      return true;
    }

    const eligiblePlayerIds = this.getRunCountEligiblePlayerIds(room);
    if (eligiblePlayerIds.length < 2) {
      return false;
    }

    hand.currentPlayerTurn = null;
    hand.pendingStreetRevealRound = null;
    hand.nextStreetReadyPlayerIds = [];
    hand.nextStreetRequiredPlayerIds = [];
    hand.runCountDecision = {
      eligiblePlayerIds,
      twiceAgreedPlayerIds: [],
      expiresAt: Date.now() + this.runCountDecisionWindowMs,
    };
    room.lastActivityAt = Date.now();
    await this.storageService.persistRoom(room);

    this.scheduleRunCountDecisionTimeout(room);
    this.emitRunCountDecisionState(room);
    return true;
  }

  private async prepareShowdownDecisionState(room: any): Promise<void> {
    if (room.currentHand) {
      room.currentHand.currentPlayerTurn = null;
      room.currentHand.revealedPlayerIds = [];
      room.currentHand.showdownDecisionOrder = [];
      room.currentHand.showdownDecisionIndex = undefined;
      room.currentHand.showdownDecisionPlayerId = null;
      room.currentHand.showdownForcedRevealPlayerIds = [];
      room.lastActivityAt = Date.now();
      await this.storageService.persistRoom(room);
    }

    await this.initializeShowdownDecisionState(room);
  }

  private async resolveRunCountDecision(
    room: any,
    runCount: RunCount,
  ): Promise<void> {
    const hand = room?.currentHand;
    if (!hand) {
      return;
    }

    this.clearRunCountDecisionTimer(room.id, hand.handNumber);
    await this.handService.resolveRunCount(room, runCount);

    const updatedRoom = await this.getRoom(room.id);
    if (!updatedRoom?.currentHand) {
      return;
    }

    this.server.to(room.id).emit('RUN_COUNT_DECISION_STATE', null);
    this.server.to(room.id).emit('BETTING_ROUND_COMPLETE', {
      nextRound: 'SHOWDOWN',
    } as BettingRoundCompleteData);
    this.server.to(room.id).emit('COMMUNITY_CARDS_DEALT', {
      cards: updatedRoom.currentHand.communityCards,
      round: 'SHOWDOWN',
      runCount,
      runoutBoards:
        updatedRoom.currentHand.runoutBoards ?? [
          [...(updatedRoom.currentHand.communityCards ?? [])],
        ],
    } as CommunityCardsDealtData);

    await this.prepareShowdownDecisionState(updatedRoom);
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
          !player.isRobot &&
          player.status !== 'waiting' &&
          player.status !== 'left' &&
          !this.isPlayerDisconnected(player),
      )
      .map((player: any) => player.id);
  }

  private getShowdownContendingPlayers(room: any): any[] {
    const hand = room?.currentHand;
    if (!hand) {
      return [];
    }

    const activeSet = new Set<string>(hand.activePlayers ?? []);
    return room.players
      .filter(
        (player: any) =>
          activeSet.has(player.id) &&
          player.status !== 'left' &&
          Boolean(player.cards),
      )
      .sort((left: any, right: any) => left.position - right.position);
  }

  private getShowdownContendingPlayerIds(room: any): string[] {
    return this.getShowdownContendingPlayers(room).map(
      (player: any) => player.id,
    );
  }

  private getShowdownStartPlayerId(
    room: any,
    contenders: any[],
  ): string | null {
    const hand = room?.currentHand;
    if (!hand || contenders.length === 0) {
      return null;
    }

    const contenderSet = new Set(contenders.map((player) => player.id));
    const lastAggressorId = hand.showdownLastAggressorPlayerId;
    if (lastAggressorId && contenderSet.has(lastAggressorId)) {
      return lastAggressorId;
    }

    const dealerPosition = hand.dealerPosition;
    return (
      contenders.find((player) => player.position > dealerPosition)?.id ??
      contenders[0].id
    );
  }

  private buildShowdownDecisionOrder(room: any, contenders: any[]): string[] {
    if (contenders.length === 0) {
      return [];
    }

    const sortedContenders = [...contenders].sort(
      (left, right) => left.position - right.position,
    );
    const startPlayerId = this.getShowdownStartPlayerId(room, sortedContenders);
    if (!startPlayerId) {
      return sortedContenders.map((player) => player.id);
    }

    const startIndex = sortedContenders.findIndex(
      (player) => player.id === startPlayerId,
    );
    if (startIndex <= 0) {
      return sortedContenders.map((player) => player.id);
    }

    return [
      ...sortedContenders.slice(startIndex),
      ...sortedContenders.slice(0, startIndex),
    ].map((player) => player.id);
  }

  private clearShowdownDecisionState(hand: any): void {
    hand.showdownDecisionOrder = [];
    hand.showdownDecisionIndex = undefined;
    hand.showdownDecisionPlayerId = null;
    hand.showdownForcedRevealPlayerIds = [];
  }

  private emitShowdownDecisionState(room: any): void {
    const hand = room?.currentHand;
    if (!hand || hand.bettingRound !== 'SHOWDOWN' || hand.lastResult) {
      return;
    }

    const currentPlayerId = hand.showdownDecisionPlayerId ?? null;
    const currentPlayerName =
      room.players.find((player: any) => player.id === currentPlayerId)?.name ??
      null;

    const payload: ShowdownDecisionStateData = {
      handNumber: hand.handNumber,
      orderedPlayerIds: hand.showdownDecisionOrder ?? [],
      currentPlayerId,
      currentPlayerName,
      forcedRevealPlayerIds: hand.showdownForcedRevealPlayerIds ?? [],
    };

    this.server.to(room.id).emit('SHOWDOWN_DECISION_STATE', payload);
  }

  private async applyShowdownReveal(
    room: any,
    playerId: string,
  ): Promise<boolean> {
    const hand = room?.currentHand;
    if (!hand || hand.bettingRound !== 'SHOWDOWN' || hand.lastResult) {
      return false;
    }

    const contenderSet = new Set(this.getShowdownContendingPlayerIds(room));
    if (!contenderSet.has(playerId)) {
      return false;
    }

    const revealedSet = new Set(hand.revealedPlayerIds ?? []);
    if (revealedSet.has(playerId)) {
      return false;
    }

    const player = room.players.find(
      (seatPlayer: any) => seatPlayer.id === playerId,
    );
    if (!player?.cards) {
      throw new Error('Cards are unavailable for showdown reveal');
    }

    revealedSet.add(playerId);
    hand.revealedPlayerIds = [...revealedSet];
    room.lastActivityAt = Date.now();
    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId: room.id,
          type: 'SHOWDOWN_DECISION_UPDATED',
          actor: { source: 'EVENTS_GATEWAY', playerId },
          handNumber: hand.handNumber,
          street: hand.bettingRound,
          payload: {
            action: 'REVEAL',
            revealedPlayerIds: hand.revealedPlayerIds,
          },
        }),
      ),
    );

    const revealData: PlayerHandRevealedData = {
      playerId,
      playerName: player.name ?? '',
      cards: player.cards,
      handNumber: hand.handNumber,
      showdownOrderIndex: (hand.showdownDecisionOrder ?? []).indexOf(playerId),
    };
    this.server.to(room.id).emit('PLAYER_HAND_REVEALED', revealData);
    return true;
  }

  private async applyShowdownMuck(
    room: any,
    playerId: string,
  ): Promise<boolean> {
    const hand = room?.currentHand;
    if (!hand || hand.bettingRound !== 'SHOWDOWN' || hand.lastResult) {
      return false;
    }

    const contenderSet = new Set(this.getShowdownContendingPlayerIds(room));
    if (!contenderSet.has(playerId)) {
      return false;
    }

    hand.activePlayers = (hand.activePlayers ?? []).filter(
      (id: string) => id !== playerId,
    );
    hand.revealedPlayerIds = (hand.revealedPlayerIds ?? []).filter(
      (id: string) => id !== playerId,
    );

    const player = room.players.find(
      (seatPlayer: any) => seatPlayer.id === playerId,
    );
    if (player) {
      player.status = 'folded';
      player.lastAction = 'fold';
      player.cards = null;
    }

    room.lastActivityAt = Date.now();
    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId: room.id,
          type: 'SHOWDOWN_DECISION_UPDATED',
          actor: { source: 'EVENTS_GATEWAY', playerId },
          handNumber: hand.handNumber,
          street: hand.bettingRound,
          payload: {
            action: 'MUCK',
            activePlayers: hand.activePlayers,
            revealedPlayerIds: hand.revealedPlayerIds,
          },
        }),
      ),
    );

    const muckData: PlayerHandMuckedData = {
      playerId,
      playerName: player?.name ?? '',
      handNumber: hand.handNumber,
    };
    this.server.to(room.id).emit('PLAYER_HAND_MUCKED', muckData);
    return true;
  }

  private async initializeShowdownDecisionState(room: any): Promise<void> {
    const hand = room?.currentHand;
    if (!hand || hand.bettingRound !== 'SHOWDOWN' || hand.lastResult) {
      return;
    }

    const contenders = this.getShowdownContendingPlayers(room);
    hand.revealedPlayerIds = (hand.revealedPlayerIds ?? []).filter(
      (playerId: string) =>
        contenders.some((contender) => contender.id === playerId),
    );
    hand.showdownDecisionOrder = this.buildShowdownDecisionOrder(
      room,
      contenders,
    );
    hand.showdownForcedRevealPlayerIds = contenders
      .filter((player) => player.status === 'all-in')
      .map((player) => player.id);
    hand.showdownDecisionIndex = undefined;
    hand.showdownDecisionPlayerId = null;

    await this.advanceShowdownDecision(room);
  }

  private async advanceShowdownDecision(room: any): Promise<void> {
    const hand = room?.currentHand;
    if (!hand || hand.bettingRound !== 'SHOWDOWN' || hand.lastResult) {
      return;
    }

    let guard = 0;
    while (guard < 30) {
      guard += 1;

      const contenders = this.getShowdownContendingPlayers(room);
      const contenderIds = contenders.map((player) => player.id);
      const contenderSet = new Set(contenderIds);
      const revealedSet = new Set(
        (hand.revealedPlayerIds ?? []).filter((playerId: string) =>
          contenderSet.has(playerId),
        ),
      );
      hand.revealedPlayerIds = [...revealedSet];

      const existingOrder = hand.showdownDecisionOrder ?? [];
      const missingContenders = contenderIds.filter(
        (playerId) => !existingOrder.includes(playerId),
      );
      const order =
        existingOrder.length > 0
          ? [...existingOrder, ...missingContenders]
          : this.buildShowdownDecisionOrder(room, contenders);
      hand.showdownDecisionOrder = order;

      const forcedRevealSet = new Set(hand.showdownForcedRevealPlayerIds ?? []);
      for (const contender of contenders) {
        if (contender.status === 'all-in') {
          forcedRevealSet.add(contender.id);
        }
      }
      hand.showdownForcedRevealPlayerIds = [...forcedRevealSet];

      if (contenderIds.length <= 1) {
        this.clearShowdownDecisionState(hand);
        room.lastActivityAt = Date.now();
        await this.storageService.persistRoom(
          room,
          roomWrite(
            roomEvent({
              roomId: room.id,
              type: 'SHOWDOWN_DECISION_UPDATED',
              actor: { source: 'EVENTS_GATEWAY' },
              handNumber: hand.handNumber,
              street: hand.bettingRound,
              payload: {
                orderedPlayerIds: hand.showdownDecisionOrder,
                currentPlayerId: hand.showdownDecisionPlayerId,
                forcedRevealPlayerIds: hand.showdownForcedRevealPlayerIds,
                resolved: true,
              },
            }),
          ),
        );
        this.emitShowdownDecisionState(room);
        const queuedResultReveal = await this.queueHandResultRevealGate(room);
        if (!queuedResultReveal) {
          await this.completeAndBroadcastHand(room);
        }
        return;
      }

      const nextIndex = order.findIndex(
        (playerId) => contenderSet.has(playerId) && !revealedSet.has(playerId),
      );

      if (nextIndex === -1) {
        this.clearShowdownDecisionState(hand);
        room.lastActivityAt = Date.now();
        await this.storageService.persistRoom(
          room,
          roomWrite(
            roomEvent({
              roomId: room.id,
              type: 'SHOWDOWN_DECISION_UPDATED',
              actor: { source: 'EVENTS_GATEWAY' },
              handNumber: hand.handNumber,
              street: hand.bettingRound,
              payload: {
                orderedPlayerIds: hand.showdownDecisionOrder,
                currentPlayerId: hand.showdownDecisionPlayerId,
                forcedRevealPlayerIds: hand.showdownForcedRevealPlayerIds,
                resolved: true,
              },
            }),
          ),
        );
        this.emitShowdownDecisionState(room);
        const queuedResultReveal = await this.queueHandResultRevealGate(room);
        if (!queuedResultReveal) {
          await this.completeAndBroadcastHand(room);
        }
        return;
      }

      const nextPlayerId = order[nextIndex];
      hand.showdownDecisionIndex = nextIndex;
      hand.showdownDecisionPlayerId = nextPlayerId;
      room.lastActivityAt = Date.now();
      await this.storageService.persistRoom(
        room,
        roomWrite(
          roomEvent({
            roomId: room.id,
            type: 'SHOWDOWN_DECISION_UPDATED',
            actor: { source: 'EVENTS_GATEWAY' },
            handNumber: hand.handNumber,
            street: hand.bettingRound,
            payload: {
              orderedPlayerIds: hand.showdownDecisionOrder,
              currentPlayerId: hand.showdownDecisionPlayerId,
              forcedRevealPlayerIds: hand.showdownForcedRevealPlayerIds,
            },
          }),
        ),
      );
      this.emitShowdownDecisionState(room);

      const nextPlayer = room.players.find(
        (player: any) => player.id === nextPlayerId,
      );
      const shouldAutoReveal =
        (hand.showdownForcedRevealPlayerIds ?? []).includes(nextPlayerId) ||
        nextPlayer?.isRobot;

      if (!shouldAutoReveal) {
        return;
      }

      await this.applyShowdownReveal(room, nextPlayerId);
    }

    throw new Error('Showdown decision advance exceeded safety limit');
  }

  private async queueHandResultRevealGate(room: any): Promise<boolean> {
    const hand = room?.currentHand;
    if (!hand || hand.lastResult) {
      return false;
    }

    if (hand.pendingStreetRevealRound === 'SHOWDOWN') {
      return true;
    }

    const requiredPlayerIds = this.getStreetRevealRequiredPlayerIds(room);
    if (requiredPlayerIds.length === 0) {
      return false;
    }

    hand.currentPlayerTurn = null;
    hand.pendingStreetRevealRound = 'SHOWDOWN';
    hand.nextStreetReadyPlayerIds = [];
    hand.nextStreetRequiredPlayerIds = requiredPlayerIds;
    room.lastActivityAt = Date.now();
    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId: room.id,
          type: 'STREET_REVEAL_UPDATED',
          actor: { source: 'EVENTS_GATEWAY' },
          handNumber: hand.handNumber,
          street: 'SHOWDOWN',
          payload: {
            nextRound: 'SHOWDOWN',
            requiredPlayerIds,
            readyPlayerIds: [],
          },
        }),
      ),
    );

    this.server.to(room.id).emit('NEXT_STREET_REVEAL_STATE', {
      nextRound: 'SHOWDOWN',
      readyPlayerIds: [],
      requiredPlayerIds,
    } as NextStreetRevealStateData);

    return true;
  }

  private async completeAndBroadcastHand(room: any) {
    this.clearRobotTurnTimer(room.id);
    const result = await this.handService.determineWinner(room);
    const isShowdown = room.currentHand.bettingRound === 'SHOWDOWN';
    const revealedPlayerIds = result.playerHands
      .filter((entry) => entry.cardsVisibility === 'shown')
      .map((entry) => entry.playerId);
    room.currentHand.lastResult = result;
    room.currentHand.revealedPlayerIds = revealedPlayerIds;
    room.currentHand.currentPlayerTurn = null;
    room.currentHand.pendingStreetRevealRound = null;
    room.currentHand.nextStreetReadyPlayerIds = [];
    room.currentHand.nextStreetRequiredPlayerIds = [];
    this.clearShowdownDecisionState(room.currentHand);
    room.currentHand.showdownLastAggressorPlayerId = null;
    room.readyPhase = 'NEXT_HAND';
    room.readyPlayerIds = [];
    await this.storageService.persistRoom(
      room,
      roomWrite(
        roomEvent({
          roomId: room.id,
          type: 'HAND_SETTLED',
          actor: { source: 'EVENTS_GATEWAY' },
          handNumber: room.currentHand.handNumber,
          street: room.currentHand.bettingRound,
          payload: {
            handNumber: room.currentHand.handNumber,
            isShowdown,
            result,
            revealedPlayerIds,
          },
        }),
      ),
    );

    const handCompleteData: HandCompleteData = {
      result: this.sanitizeHandResult(result)!,
      handNumber: room.currentHand.handNumber,
      isShowdown,
      revealedPlayerIds,
    };

    this.server.to(room.id).emit('HAND_COMPLETE', handCompleteData);
    this.emitReadyStateUpdated(room.id, room);
    if (this.testDeckService.isTestMode()) {
      // Keep auto-advance in TEST_MODE to preserve deterministic e2e cadence.
      setTimeout(async () => {
        try {
          await this.startAndBroadcastNewHand(room.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (this.isIgnorableTestModeAutoAdvanceError(message)) {
            this.logger.debug(
              `Skipping test-mode auto-advance for room ${room.id}: ${message}`,
            );
            return;
          }

          this.logger.error(`Error starting new hand: ${message}`);
        }
      }, 5000);
    }
  }

  private isIgnorableTestModeAutoAdvanceError(message: string): boolean {
    return (
      message.includes('Cannot deal 2 cards from deck of 0') ||
      message.includes('Need at least 2 players to start a hand') ||
      /Room .* not found for new hand/.test(message) ||
      /Room .* missing after starting new hand/.test(message)
    );
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
      runCount: updatedRoom.currentHand?.runCount,
      runoutBoards: updatedRoom.currentHand?.runoutBoards,
    } as CommunityCardsDealtData);

    if (nextRound === 'SHOWDOWN') {
      await this.prepareShowdownDecisionState(updatedRoom);
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
    this.clearRobotTurnTimer(roomId);
    const room = await this.getRoom(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found for new hand`);
    }

    const newHand = await this.handService.startNewHand(room);
    const updatedRoom = await this.getRoom(roomId);
    if (!updatedRoom) {
      throw new Error(`Room ${roomId} missing after starting new hand`);
    }

    this.emitReadyStateUpdated(roomId, updatedRoom);

    this.server.to(roomId).emit('NEW_HAND_STARTING');

    const { activePlayers: _activePlayers, ...handWithoutActivePlayers } =
      newHand;
    void _activePlayers;
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

  private clearRobotTurnTimer(roomId: string): void {
    const timer = this.robotTurnTimers.get(roomId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.robotTurnTimers.delete(roomId);
  }

  private scheduleRobotTurn(room: any, player: any): void {
    this.clearRobotTurnTimer(room.id);

    const minDelayMs = this.parseRobotDelayMs(
      process.env.AI_ROBOT_ACTION_DELAY_MIN_MS,
      1000,
    );
    const maxDelayMs = this.parseRobotDelayMs(
      process.env.AI_ROBOT_ACTION_DELAY_MAX_MS,
      2500,
    );
    const upperBound = Math.max(minDelayMs, maxDelayMs);
    const delayMs = Math.max(
      0,
      Math.floor(Math.random() * (upperBound - minDelayMs + 1)) + minDelayMs,
    );
    const handNumber = room.currentHand?.handNumber;

    const timer = setTimeout(async () => {
      this.robotTurnTimers.delete(room.id);
      try {
        await this.executeRobotTurn(room.id, player.id, handNumber);
      } catch (error) {
        this.logger.warn(
          `Robot turn execution failed in room ${room.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }, delayMs);

    this.robotTurnTimers.set(room.id, timer);
  }

  private resolveRobotLegalActions(room: any, robotPlayerId: string) {
    const hand = room.currentHand;
    const robotPlayer = room.players.find(
      (player: any) => player.id === robotPlayerId,
    );
    if (!hand || !robotPlayer) {
      return null;
    }

    const amountToCall = Math.max(0, hand.currentBet - robotPlayer.currentBet);
    const minRaiseIncrement = Math.max(
      1,
      Number(
        this.bettingService.calculateMinRaise(room) ||
          room.config.bigBlind ||
          1,
      ),
    );
    const maxRaiseIncrement = Math.max(0, robotPlayer.chips - amountToCall);
    const raiseEnabled =
      maxRaiseIncrement >= minRaiseIncrement &&
      this.bettingService.validateAction(
        room,
        robotPlayerId,
        'raise',
        minRaiseIncrement,
      ).valid;

    const suggestedIncrements = [
      minRaiseIncrement,
      Math.floor(Math.max(minRaiseIncrement, maxRaiseIncrement) / 2),
      maxRaiseIncrement,
    ]
      .filter(
        (value, index, arr) =>
          value >= minRaiseIncrement &&
          value <= maxRaiseIncrement &&
          arr.indexOf(value) === index,
      )
      .sort((a, b) => a - b);

    return {
      fold: {
        enabled: this.bettingService.validateAction(room, robotPlayerId, 'fold')
          .valid,
      },
      check: {
        enabled: this.bettingService.validateAction(
          room,
          robotPlayerId,
          'check',
        ).valid,
      },
      call: {
        enabled: this.bettingService.validateAction(room, robotPlayerId, 'call')
          .valid,
        amountToCall,
      },
      raise: {
        enabled: raiseEnabled,
        minIncrement: minRaiseIncrement,
        maxIncrement: maxRaiseIncrement,
        suggestedIncrements,
      },
      allIn: {
        enabled: this.bettingService.validateAction(
          room,
          robotPlayerId,
          'all-in',
        ).valid,
        increment: Math.max(0, robotPlayer.chips - amountToCall),
      },
    };
  }

  private buildRobotTurnContext(
    room: any,
    robotPlayerId: string,
  ): RobotTurnContext {
    const hand = room.currentHand;
    const robotPlayer = room.players.find(
      (player: any) => player.id === robotPlayerId,
    );
    if (!hand || !robotPlayer || !robotPlayer.cards) {
      throw new Error('Cannot build robot turn context');
    }

    const legalActions = this.resolveRobotLegalActions(room, robotPlayerId);
    if (!legalActions) {
      throw new Error('Cannot resolve legal robot actions');
    }

    const revealedHoleCardsByPlayerId: Record<
      string,
      Array<{ rank: string; suit: string }>
    > = {};
    for (const playerId of hand.revealedPlayerIds ?? []) {
      const revealedPlayer = room.players.find(
        (player: any) => player.id === playerId,
      );
      if (revealedPlayer?.cards?.length) {
        revealedHoleCardsByPlayerId[playerId] = revealedPlayer.cards;
      }
    }

    const recentActions = (room.players ?? [])
      .filter((player: any) => player.lastAction)
      .map((player: any) => ({
        playerId: player.id,
        action: player.lastAction,
        bettingRound: hand.bettingRound,
      }));

    return {
      schemaVersion: '1.0',
      roomId: room.id,
      handNumber: hand.handNumber,
      nowIso: new Date().toISOString(),
      rules: {
        variant: room.config.useShortDeckRules ? 'shortDeck' : 'standard',
        smallBlind: room.config.smallBlind,
        bigBlind: room.config.bigBlind,
        bettingRound: hand.bettingRound,
        raiseFormat: 'increment_over_call',
      },
      hero: {
        playerId: robotPlayer.id,
        name: robotPlayer.name,
        seatPosition: robotPlayer.position,
        chips: robotPlayer.chips,
        currentBet: robotPlayer.currentBet,
        status: robotPlayer.status,
        holeCards: robotPlayer.cards,
      },
      table: {
        pot: hand.pot,
        currentBet: hand.currentBet,
        minRaise: this.bettingService.calculateMinRaise(room),
        communityCards: hand.communityCards ?? [],
        playersPublic: (room.players ?? []).map((player: any) => ({
          playerId: player.id,
          name: player.name,
          seatPosition: player.position,
          chips: player.chips,
          currentBet: player.currentBet,
          status: player.status,
          isDealer: player.position === hand.dealerPosition,
          isSmallBlind: player.position === hand.smallBlindPosition,
          isBigBlind: player.position === hand.bigBlindPosition,
          lastAction: player.lastAction ?? null,
        })),
        revealedHoleCardsByPlayerId,
      },
      legalActions,
      history: {
        recentActions: recentActions.slice(-12),
      },
      constraints: {
        maxAgentSteps: Number(process.env.AI_ROBOT_MAX_AGENT_STEPS || '6'),
        toolRetryLimit: Number(process.env.AI_ROBOT_TOOL_RETRY_LIMIT || '4'),
        actionDelayMsMin: Number(
          process.env.AI_ROBOT_ACTION_DELAY_MIN_MS || '1000',
        ),
        actionDelayMsMax: Number(
          process.env.AI_ROBOT_ACTION_DELAY_MAX_MS || '2500',
        ),
      },
    };
  }

  private resolveRobotFallbackAction(
    room: any,
    robotPlayerId: string,
  ): RobotActionCandidate {
    const checkValidation = this.bettingService.validateAction(
      room,
      robotPlayerId,
      'check',
    );
    if (checkValidation.valid) {
      return { action: 'check' };
    }
    return { action: 'fold' };
  }

  private async executeRobotTurn(
    roomId: string,
    robotPlayerId: string,
    expectedHandNumber?: number,
  ): Promise<void> {
    const room = await this.getRoom(roomId);
    const hand = room?.currentHand;
    const robotPlayer = room?.players?.find(
      (player: any) => player.id === robotPlayerId,
    );
    if (!room || !hand || !robotPlayer?.isRobot) {
      return;
    }
    if (expectedHandNumber && hand.handNumber !== expectedHandNumber) {
      return;
    }
    if (hand.currentPlayerTurn !== robotPlayerId) {
      return;
    }

    const roomSnapshot = JSON.parse(JSON.stringify(room));
    const context = this.buildRobotTurnContext(roomSnapshot, robotPlayerId);

    let selectedAction: RobotActionDecision;
    if (!this.robotAgentService.isConfigured()) {
      selectedAction = this.buildRobotFallbackDecision(
        this.resolveRobotFallbackAction(roomSnapshot, robotPlayerId),
        'provider-unavailable',
        0,
      );
    } else {
      try {
        selectedAction = await this.robotAgentService.decideAction({
          context,
          validateAction: (candidate) => {
            const validation = this.bettingService.validateAction(
              roomSnapshot,
              robotPlayerId,
              candidate.action,
              candidate.action === 'raise' ? candidate.amount : undefined,
            );
            return {
              valid: validation.valid,
              reason: validation.reason,
              legalActions: context.legalActions,
            };
          },
        });
      } catch (error) {
        this.logger.warn(
          `Robot agent fallback in room ${roomId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        selectedAction = this.buildRobotFallbackDecision(
          this.resolveRobotFallbackAction(roomSnapshot, robotPlayerId),
          toRobotFallbackCause(error),
          this.getRobotFallbackRetryCount(error),
        );
      }
    }

    const actionId = `robot-${hand.handNumber}-${Date.now()}`;
    const tempSocketId = `robot:${roomId}:${robotPlayerId}:${Date.now()}`;
    this.pendingRobotActionDecisions.set(
      this.getPendingRobotActionDecisionKey(tempSocketId, actionId),
      selectedAction.persistedDecision,
    );
    this.socketToPlayer.set(tempSocketId, { roomId, playerId: robotPlayerId });

    try {
      await this.handlePlayerAction(
        {
          id: tempSocketId,
          emit: () => undefined,
        } as unknown as Socket,
        {
          action: selectedAction.action,
          amount: selectedAction.amount,
          actionId,
        },
      );
    } finally {
      this.pendingRobotActionDecisions.delete(
        this.getPendingRobotActionDecisionKey(tempSocketId, actionId),
      );
      this.socketToPlayer.delete(tempSocketId);
    }
  }

  private buildRobotFallbackDecision(
    action: RobotActionCandidate,
    fallbackCause: PersistedRobotFallbackCause,
    validationRetryCount = 0,
  ): RobotActionDecision {
    const retrySummary =
      validationRetryCount > 0
        ? ` after ${validationRetryCount} validation ${validationRetryCount === 1 ? 'retry' : 'retries'}`
        : '';
    return {
      ...action,
      persistedDecision: {
        source: 'deterministic-fallback',
        fallbackCause,
        summary: `Deterministic fallback ${action.action} because ${fallbackCause.replace(/-/g, ' ')}${retrySummary}.`,
        validationRetryCount,
      },
    };
  }

  private getPendingRobotActionDecisionKey(
    socketId: string,
    actionId: string,
  ): string {
    return `${socketId}:${actionId}`;
  }

  private getRobotFallbackRetryCount(error: unknown): number {
    return error instanceof RobotDecisionError ? error.validationRetryCount : 0;
  }

  private emitPlayerTurn(room: any, player: any) {
    this.clearRobotTurnTimer(room.id);

    const turnData: PlayerTurnData = {
      playerId: player.id,
      playerName: player.name,
      timeLimit: 30000,
      currentBet: room.currentHand!.currentBet,
      minRaise: this.bettingService.calculateMinRaise(room),
      canCheck: player.currentBet === room.currentHand!.currentBet,
    };

    this.server.to(room.id).emit('PLAYER_TURN', turnData);

    if (player.isRobot) {
      this.scheduleRobotTurn(room, player);
    }
  }

  private async handleDisconnectTimeout(roomId: string, playerId: string) {
    try {
      await this.runRoomActionSequentially(roomId, async () => {
        const room = await this.getRoom(roomId);
        if (!room) {
          return;
        }

        const player = room.players.find((p) => p.id === playerId);
        if (!player || !this.isPlayerDisconnected(player)) {
          // Player already reconnected (or left); stale timeout should do nothing.
          return;
        }

        if (
          room.currentHand?.bettingRound === 'SHOWDOWN' &&
          !room.currentHand.lastResult &&
          room.currentHand.showdownDecisionPlayerId === playerId
        ) {
          const forceReveal = (
            room.currentHand.showdownForcedRevealPlayerIds ?? []
          ).includes(playerId);
          if (forceReveal) {
            await this.applyShowdownReveal(room, playerId);
          } else {
            await this.applyShowdownMuck(room, playerId);
          }
          await this.advanceShowdownDecision(room);
        }

        const pendingDecision = room.currentHand?.runCountDecision;
        const eligiblePlayerIds = pendingDecision?.eligiblePlayerIds ?? [];
        const twiceAgreedPlayerIds = new Set(
          pendingDecision?.twiceAgreedPlayerIds ?? [],
        );
        if (
          room.currentHand &&
          eligiblePlayerIds.includes(playerId) &&
          !twiceAgreedPlayerIds.has(playerId)
        ) {
          await this.resolveRunCountDecision(room, 1);
          return;
        }

        // Auto-fold if it's their turn
        if (room.currentHand?.currentPlayerTurn === playerId) {
          await this.bettingService.processAction(room, playerId, 'fold');

          this.server.to(roomId).emit('PLAYER_AUTO_FOLDED', {
            playerId,
            playerName: room.players.find((p) => p.id === playerId)?.name || '',
          });

          // Continue game
          const updatedRoom = await this.getRoom(roomId);
          if (!updatedRoom?.currentHand) {
            const disconnectedRoom =
              await this.gameService.markPlayerDisconnected(roomId, playerId);
            if (disconnectedRoom) {
              this.syncRoomReadyState(disconnectedRoom);
              await this.storageService.persistRoom(disconnectedRoom);
              const started = await this.maybeStartReadyPhaseIfAllReady(
                roomId,
                disconnectedRoom,
              );
              if (!started) {
                this.emitReadyStateUpdated(roomId, disconnectedRoom);
              }
            }
            return;
          }

          if (this.bettingService.isBettingRoundComplete(updatedRoom)) {
            await this.handleBettingRoundComplete(updatedRoom);
          } else {
            const nextPlayer = this.handService.getNextPlayer(updatedRoom);
            if (nextPlayer) {
              updatedRoom.currentHand.currentPlayerTurn = nextPlayer.id;
              await this.storageService.persistRoom(updatedRoom);
              this.emitPlayerTurn(updatedRoom, nextPlayer);
            }
          }
        }

        const disconnectedRoom = await this.gameService.markPlayerDisconnected(
          roomId,
          playerId,
        );
        if (disconnectedRoom) {
          this.syncRoomReadyState(disconnectedRoom);
          await this.storageService.persistRoom(disconnectedRoom);
          const started = await this.maybeStartReadyPhaseIfAllReady(
            roomId,
            disconnectedRoom,
          );
          if (!started) {
            this.emitReadyStateUpdated(roomId, disconnectedRoom);
          }
        }
      });
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

  private trackPlayerSocket(
    socketId: string,
    roomId: string,
    playerId: string,
  ) {
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
    const sanitizedCurrentHand = room.currentHand
      ? (() => {
          const {
            settledPlayerCardsByPlayerId: _settledPlayerCardsByPlayerId,
            ...safeCurrentHand
          } = room.currentHand;
          void _settledPlayerCardsByPlayerId;

          return {
            ...safeCurrentHand,
            lastResult: this.sanitizeHandResult(room.currentHand.lastResult),
          };
        })()
      : room.currentHand;

    return {
      ...room,
      currentHand: sanitizedCurrentHand,
      players: room.players.map((p: any) => this.sanitizePlayer(p)),
    };
  }

  private sanitizeHandResult(
    result: HandResult | null | undefined,
  ): HandResult | null | undefined {
    if (!result) {
      return result;
    }

    return {
      ...result,
      runouts: result.runouts?.map((runout) => ({
        ...runout,
        winners: runout.winners.map((winner) => ({
          ...winner,
          hand: null,
        })),
      })),
      playerHands: result.playerHands.map((entry) =>
        entry.cardsVisibility === 'shown'
          ? entry
          : {
              ...entry,
              cards: [],
              hand: null,
              runHands: entry.runHands?.map((runHand) => ({
                ...runHand,
                hand: null,
              })),
            },
      ),
    };
  }

  private sanitizePlayer(player: any): any {
    const { userId: _userId, cards: _cards, ...safePlayer } = player;
    void _userId;
    void _cards;
    return {
      ...safePlayer,
      cards: undefined, // Don't send cards in general updates
    };
  }
}
