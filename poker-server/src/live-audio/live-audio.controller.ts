import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { readAuthSessionCookie } from '../auth/session-cookie';
import { LiveAudioService } from './live-audio.service';

@Controller('api/live-audio')
export class LiveAudioController {
  constructor(
    private readonly authService: AuthService,
    private readonly liveAudioService: LiveAudioService,
  ) {}

  @Get('config')
  getConfig(@Req() _request: Request, @Headers('authorization') _authorization?: string) {
    return this.liveAudioService.getPublicConfig();
  }

  @Post('token')
  async createToken(
    @Req() request: Request,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { roomId?: string },
  ) {
    const token = this.extractSessionToken(request, authorization);
    const current = await this.authService.getCurrentSession(token);
    if (!current) {
      throw new UnauthorizedException('Invalid session');
    }

    return this.liveAudioService.createJoinToken({
      roomId: body.roomId || '',
      user: current.user,
    });
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
