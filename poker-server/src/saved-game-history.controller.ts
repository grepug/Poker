import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth/auth.service';
import { readAuthSessionCookie } from './auth/session-cookie';
import type { ISavedGameArchiveStorageService } from './common/interfaces/saved-game-archive-storage.interface';

@Controller('api/history/games')
export class SavedGameHistoryController {
  constructor(
    private readonly authService: AuthService,
    @Inject('ISavedGameArchiveStorageService')
    private readonly savedGameArchiveStorageService: ISavedGameArchiveStorageService,
  ) {}

  @Get()
  async listSavedGames(
    @Req() request: Request,
    @Headers('authorization') authorization?: string,
  ) {
    const current = await this.getCurrentSession(request, authorization);
    return this.savedGameArchiveStorageService.listSavedGamesForUser(
      current.user.id,
    );
  }

  @Get(':archiveId')
  async getSavedGameDetail(
    @Param('archiveId') archiveId: string,
    @Req() request: Request,
    @Headers('authorization') authorization?: string,
  ) {
    const current = await this.getCurrentSession(request, authorization);
    const detail =
      await this.savedGameArchiveStorageService.getSavedGameDetailForUser(
        archiveId,
        current.user.id,
      );
    if (!detail) {
      throw new NotFoundException('Saved game unavailable');
    }
    return detail;
  }

  private async getCurrentSession(
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
