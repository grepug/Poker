import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RejoinableRoomSummary, Room } from 'poker-types';
import { AuthService } from './auth/auth.service';
import { readAuthSessionCookie } from './auth/session-cookie';
import type { IHandHistoryStorageService } from './common/interfaces/hand-history-storage.interface';
import type { IStorageService } from './common/interfaces/storage.interface';

type RoomPlayerWithUser = Room['players'][number] & {
  userId?: string;
};

@Controller('api/rooms')
export class HandHistoryController {
  constructor(
    private readonly authService: AuthService,
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
    @Inject('IHandHistoryStorageService')
    private readonly handHistoryStorageService: IHandHistoryStorageService,
  ) {}

  @Get('rejoinable')
  async listRejoinableRooms(
    @Req() request: Request,
    @Headers('authorization') authorization?: string,
  ): Promise<RejoinableRoomSummary[]> {
    const current = await this.resolveCurrentSession(request, authorization);
    const rooms = await this.storageService.getAllRooms();

    return rooms
      .map((room) => this.toRejoinableRoomSummary(room, current.user.id))
      .filter(
        (summary): summary is RejoinableRoomSummary => summary !== null,
      )
      .sort((left, right) => right.lastActivityAt - left.lastActivityAt);
  }

  @Get(':roomId/hands/:handNumber/history')
  async getCompletedHandHistory(
    @Param('roomId') roomId: string,
    @Param('handNumber') handNumberRaw: string,
    @Req() request: Request,
    @Headers('authorization') authorization?: string,
  ) {
    const handNumber = Number.parseInt(handNumberRaw, 10);
    if (!Number.isFinite(handNumber) || handNumber <= 0) {
      throw new BadRequestException('Hand number must be a positive integer');
    }

    const requesterPlayerId = await this.resolveRequesterPlayerId(
      roomId,
      request,
      authorization,
    );
    const exportPayload =
      await this.handHistoryStorageService.getCompletedHandHistory(
        roomId,
        handNumber,
        requesterPlayerId,
      );

    if (!exportPayload) {
      throw new NotFoundException('Completed hand history unavailable');
    }

    return exportPayload;
  }

  @Get(':roomId/history')
  async getCompletedGameHistory(
    @Param('roomId') roomId: string,
    @Req() request: Request,
    @Headers('authorization') authorization?: string,
  ) {
    const { room, requesterPlayerId } = await this.resolveRequester(
      roomId,
      request,
      authorization,
    );

    if (room.gameState !== 'ENDED') {
      throw new ConflictException(
        'Completed game history unavailable until the game has ended',
      );
    }

    const exportPayload =
      await this.handHistoryStorageService.getCompletedGameHistory(
        roomId,
        requesterPlayerId,
      );

    if (!exportPayload) {
      throw new NotFoundException('Completed game history unavailable');
    }

    return exportPayload;
  }

  private async resolveRequesterPlayerId(
    roomId: string,
    request: Request,
    authorization?: string,
  ): Promise<string> {
    const { requesterPlayerId } = await this.resolveRequester(
      roomId,
      request,
      authorization,
    );
    return requesterPlayerId;
  }

  private async resolveRequester(
    roomId: string,
    request: Request,
    authorization?: string,
  ): Promise<{ room: Room; requesterPlayerId: string }> {
    const current = await this.resolveCurrentSession(request, authorization);

    const room = await this.storageService.getRoom(roomId);
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const roomPlayer = (room.players as RoomPlayerWithUser[]).find(
      (player) => player.userId === current.user.id,
    );
    if (!roomPlayer) {
      throw new ForbiddenException('You are not a member of this room');
    }

    return {
      room,
      requesterPlayerId: roomPlayer.id,
    };
  }

  private async resolveCurrentSession(
    request: Request,
    authorization?: string,
  ) {
    const token = this.extractSessionToken(request, authorization);
    const current = await this.authService.getCurrentSession(token);
    if (!current) {
      throw new UnauthorizedException('Invalid session');
    }

    return current;
  }

  private toRejoinableRoomSummary(
    room: Room,
    userId: string,
  ): RejoinableRoomSummary | null {
    const player = (room.players as RoomPlayerWithUser[]).find(
      (entry) => entry.userId === userId,
    );
    if (!player || player.status !== 'left' || room.gameState === 'ENDED') {
      return null;
    }

    const seatedPlayers = room.players.filter((entry) => entry.status !== 'left');
    const storedSeatIsInvalid =
      player.position < 0 || player.position >= room.config.maxPlayers;
    const seatIsTakenByAnotherPlayer = seatedPlayers.some(
      (entry) => entry.id !== player.id && entry.position === player.position,
    );
    const roomHasSpareSeat = seatedPlayers.length < room.config.maxPlayers;
    if ((storedSeatIsInvalid || seatIsTakenByAnotherPlayer) && !roomHasSpareSeat) {
      return null;
    }

    return {
      roomId: room.id,
      hostName: room.players.find((entry) => entry.id === room.hostId)?.name ?? null,
      seatedPlayerCount: seatedPlayers.length,
      maxPlayers: room.config.maxPlayers,
      useShortDeckRules: room.config.useShortDeckRules ?? false,
      lastActivityAt: room.lastActivityAt,
    };
  }

  private extractSessionToken(
    request: Request,
    authorization?: string,
  ): string {
    const cookieToken = readAuthSessionCookie(request.headers.cookie);
    if (cookieToken) {
      return cookieToken;
    }

    const rawAuthorization = authorization?.trim() || '';
    if (!rawAuthorization) {
      throw new UnauthorizedException('Missing authorization token');
    }

    if (/^bearer\s+/i.test(rawAuthorization)) {
      return rawAuthorization.replace(/^bearer\s+/i, '').trim();
    }

    return rawAuthorization;
  }
}
