import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth/auth.service';
import { readAuthSessionCookie } from './auth/session-cookie';
import type { ISavedGameArchiveStorageService } from './common/interfaces/saved-game-archive-storage.interface';
import { SavedGameReviewService } from './game/saved-game-review.service';

@Controller('api/history/games')
export class SavedGameHistoryController {
  constructor(
    private readonly authService: AuthService,
    @Inject('ISavedGameArchiveStorageService')
    private readonly savedGameArchiveStorageService: ISavedGameArchiveStorageService,
    private readonly savedGameReviewService: SavedGameReviewService,
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
    @Query('locale') locale?: string,
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
    const readyHands = detail.hands.filter(
      (hand) => hand.analysis.status === 'ready',
    );
    if (readyHands.length === 0) {
      return detail;
    }

    const localizationWrites = await Promise.all(
      readyHands.map((hand) =>
        this.savedGameReviewService.scheduleHandLocalization({
          archiveId,
          requesterUserId: current.user.id,
          handNumber: hand.handNumber,
          locale,
        }),
      ),
    );
    const didUpdateLocalizationState = localizationWrites.some(Boolean);
    if (!didUpdateLocalizationState) {
      return detail;
    }

    const refreshedDetail =
      await this.savedGameArchiveStorageService.getSavedGameDetailForUser(
        archiveId,
        current.user.id,
      );
    if (!refreshedDetail) {
      throw new NotFoundException('Saved game unavailable');
    }
    return refreshedDetail;
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
