import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
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
    return detail;
  }

  @Get(':archiveId/hands/:handNumber')
  async getSavedGameHandDetail(
    @Param('archiveId') archiveId: string,
    @Param('handNumber', ParseIntPipe) handNumber: number,
    @Req() request: Request,
    @Query('locale') locale?: string,
    @Headers('authorization') authorization?: string,
  ) {
    const current = await this.getCurrentSession(request, authorization);
    const detail =
      await this.savedGameArchiveStorageService.getSavedGameHandDetailForUser(
        archiveId,
        current.user.id,
        handNumber,
      );
    if (!detail) {
      throw new NotFoundException('Saved hand unavailable');
    }
    if (detail.analysis.status !== 'ready') {
      return detail;
    }

    const didUpdateLocalizationState =
      await this.savedGameReviewService.scheduleHandLocalization({
        archiveId,
        requesterUserId: current.user.id,
        handNumber,
        locale,
      });
    if (!didUpdateLocalizationState) {
      return detail;
    }

    const refreshedDetail =
      await this.savedGameArchiveStorageService.getSavedGameHandDetailForUser(
        archiveId,
        current.user.id,
        handNumber,
      );
    if (!refreshedDetail) {
      throw new NotFoundException('Saved hand unavailable');
    }
    return refreshedDetail;
  }

  @Post(':archiveId/hands/:handNumber/retry')
  async retrySavedGameHandReview(
    @Param('archiveId') archiveId: string,
    @Param('handNumber', ParseIntPipe) handNumber: number,
    @Req() request: Request,
    @Query('locale') locale?: string,
    @Headers('authorization') authorization?: string,
  ) {
    const current = await this.getCurrentSession(request, authorization);
    const detail =
      await this.savedGameArchiveStorageService.getSavedGameHandDetailForUser(
        archiveId,
        current.user.id,
        handNumber,
      );
    if (!detail) {
      throw new NotFoundException('Saved hand unavailable');
    }

    await this.savedGameReviewService.retryHandReview({
      archiveId,
      requesterUserId: current.user.id,
      handNumber,
      locale,
    });

    const refreshedDetail =
      await this.savedGameArchiveStorageService.getSavedGameHandDetailForUser(
        archiveId,
        current.user.id,
        handNumber,
      );
    if (!refreshedDetail) {
      throw new NotFoundException('Saved hand unavailable');
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
