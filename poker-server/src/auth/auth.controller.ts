import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Ip,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, PublicAuthUser } from './auth.service';
import {
  clearAuthSessionCookie,
  readAuthSessionCookie,
  setAuthSessionCookie,
} from './session-cookie';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('modes')
  getAuthModes() {
    return this.authService.getAuthModes();
  }

  @Post('passkey/register/start')
  startPasskeyRegistration(
    @Body() body: { displayName?: string; avatarEmoji?: string },
    @Ip() ip: string,
  ) {
    return this.authService.startPasskeyRegistration({
      displayName: body.displayName || '',
      avatarEmoji: body.avatarEmoji || '',
      rateLimitKey: ip,
    });
  }

  @Post('passkey/register/finish')
  finishPasskeyRegistration(
    @Body() body: { flowId?: string; response?: unknown },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.completeSession(
      request,
      response,
      this.authService.finishPasskeyRegistration({
        flowId: body.flowId || '',
        response: body.response,
      }),
    );
  }

  @Post('passkey/login/start')
  startPasskeyLogin(@Ip() ip: string) {
    return this.authService.startPasskeyLogin({
      rateLimitKey: ip,
    });
  }

  @Post('passkey/login/finish')
  finishPasskeyLogin(
    @Body() body: { flowId?: string; response?: unknown },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.completeSession(
      request,
      response,
      this.authService.finishPasskeyLogin({
        flowId: body.flowId || '',
        response: body.response,
      }),
    );
  }

  @Post('password/login')
  async loginWithPassword(
    @Body() body: { accountId?: string; password?: string },
    @Ip() ip: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const modes = this.authService.getAuthModes();
    if (!modes.password) {
      throw new ForbiddenException('Password login is disabled');
    }

    return this.completeSession(
      request,
      response,
      this.authService.loginWithPassword({
        accountId: body.accountId || '',
        password: body.password || '',
        rateLimitKey: ip,
      }),
    );
  }

  @Get('me')
  async getMe(
    @Req() request: Request,
    @Headers('authorization') authorization?: string,
  ) {
    const token = this.extractSessionToken(request, authorization);
    const current = await this.authService.getCurrentSession(token);
    if (!current) {
      throw new UnauthorizedException('Invalid session');
    }

    return {
      user: current.user,
      sessionExpiresAt: current.sessionExpiresAt,
      authModes: this.authService.getAuthModes(),
    };
  }

  @Patch('me/profile')
  async updateProfile(
    @Req() request: Request,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { displayName?: string; avatarEmoji?: string },
  ) {
    const token = this.extractSessionToken(request, authorization);
    const user = await this.authService.updateProfileByToken({
      token,
      displayName: body.displayName || '',
      avatarEmoji: body.avatarEmoji || '',
    });

    return { user };
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('authorization') authorization?: string,
  ) {
    const token = this.extractSessionToken(request, authorization);
    await this.authService.logout(token);
    clearAuthSessionCookie(request, response);
    return { success: true };
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

  private async completeSession(
    request: Request,
    response: Response,
    sessionPromise: Promise<{
      sessionToken: string;
      sessionExpiresAt: number;
      user: PublicAuthUser;
    }>,
  ) {
    const session = await sessionPromise;
    setAuthSessionCookie(
      request,
      response,
      session.sessionToken,
      session.sessionExpiresAt,
    );
    return {
      user: session.user,
      sessionExpiresAt: session.sessionExpiresAt,
      authModes: this.authService.getAuthModes(),
    };
  }
}
