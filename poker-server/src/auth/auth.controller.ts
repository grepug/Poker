import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Ip,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

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
  ) {
    return this.authService.finishPasskeyRegistration({
      flowId: body.flowId || '',
      response: body.response,
    });
  }

  @Post('passkey/login/start')
  startPasskeyLogin(@Ip() ip: string) {
    return this.authService.startPasskeyLogin({
      rateLimitKey: ip,
    });
  }

  @Post('passkey/login/finish')
  finishPasskeyLogin(@Body() body: { flowId?: string; response?: unknown }) {
    return this.authService.finishPasskeyLogin({
      flowId: body.flowId || '',
      response: body.response,
    });
  }

  @Post('password/login')
  async loginWithPassword(
    @Body() body: { accountId?: string; password?: string },
    @Ip() ip: string,
  ) {
    const modes = this.authService.getAuthModes();
    if (!modes.password) {
      throw new ForbiddenException('Password login is disabled');
    }

    return this.authService.loginWithPassword({
      accountId: body.accountId || '',
      password: body.password || '',
      rateLimitKey: ip,
    });
  }

  @Get('me')
  async getMe(@Headers('authorization') authorization?: string) {
    const token = this.extractBearerToken(authorization);
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
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { displayName?: string; avatarEmoji?: string },
  ) {
    const token = this.extractBearerToken(authorization);
    const user = await this.authService.updateProfileByToken({
      token,
      displayName: body.displayName || '',
      avatarEmoji: body.avatarEmoji || '',
    });

    return { user };
  }

  @Post('logout')
  async logout(@Headers('authorization') authorization?: string) {
    const token = this.extractBearerToken(authorization);
    await this.authService.logout(token);
    return { success: true };
  }

  private extractBearerToken(authorization?: string): string {
    const raw = authorization?.trim() || '';
    if (!raw) {
      throw new UnauthorizedException('Missing authorization token');
    }

    if (/^bearer\s+/i.test(raw)) {
      return raw.replace(/^bearer\s+/i, '').trim();
    }

    return raw;
  }
}
