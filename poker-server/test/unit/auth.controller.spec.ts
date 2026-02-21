import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    getAuthModes: jest.Mock;
    startPasskeyRegistration: jest.Mock;
    finishPasskeyRegistration: jest.Mock;
    startPasskeyLogin: jest.Mock;
    finishPasskeyLogin: jest.Mock;
    loginWithPassword: jest.Mock;
    getCurrentSession: jest.Mock;
    updateProfileByToken: jest.Mock;
    logout: jest.Mock;
  };

  beforeEach(() => {
    authService = {
      getAuthModes: jest.fn().mockReturnValue({ passkey: true, password: true }),
      startPasskeyRegistration: jest.fn(),
      finishPasskeyRegistration: jest.fn(),
      startPasskeyLogin: jest.fn(),
      finishPasskeyLogin: jest.fn(),
      loginWithPassword: jest.fn(),
      getCurrentSession: jest.fn(),
      updateProfileByToken: jest.fn(),
      logout: jest.fn(),
    };

    controller = new AuthController(authService as any);
  });

  it('forwards passkey registration start with normalized body and ip', async () => {
    authService.startPasskeyRegistration.mockResolvedValue({
      flowId: 'flow',
      options: {},
    });

    await controller.startPasskeyRegistration({}, '127.0.0.1');

    expect(authService.startPasskeyRegistration).toHaveBeenCalledWith({
      displayName: '',
      avatarEmoji: '',
      rateLimitKey: '127.0.0.1',
    });
  });

  it('forwards password login with rate limit key', async () => {
    authService.loginWithPassword.mockResolvedValue({
      sessionToken: 'token',
      user: { id: 'u-1' },
    });

    await controller.loginWithPassword(
      { accountId: 'test1', password: 'test1234' },
      '10.0.0.1',
    );

    expect(authService.loginWithPassword).toHaveBeenCalledWith({
      accountId: 'test1',
      password: 'test1234',
      rateLimitKey: '10.0.0.1',
    });
  });

  it('rejects password login when mode is disabled', async () => {
    authService.getAuthModes.mockReturnValue({ passkey: true, password: false });

    await expect(
      controller.loginWithPassword(
        { accountId: 'test1', password: 'test1234' },
        '10.0.0.1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects getMe when authorization header is missing', async () => {
    await expect(controller.getMe(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns current session payload for valid bearer token', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: { id: 'u-1', displayName: 'Alice' },
      sessionExpiresAt: Date.now() + 60_000,
    });

    const result = await controller.getMe('Bearer token-123');

    expect(authService.getCurrentSession).toHaveBeenCalledWith('token-123');
    expect(result).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ id: 'u-1' }),
        authModes: { passkey: true, password: true },
      }),
    );
  });

  it('forwards token and profile payload to updateProfileByToken', async () => {
    authService.updateProfileByToken.mockResolvedValue({
      id: 'u-1',
      displayName: 'Bob',
      avatarEmoji: '🐻',
    });

    await controller.updateProfile('Bearer abc', {
      displayName: 'Bob',
      avatarEmoji: '🐻',
    });

    expect(authService.updateProfileByToken).toHaveBeenCalledWith({
      token: 'abc',
      displayName: 'Bob',
      avatarEmoji: '🐻',
    });
  });

  it('forwards logout with extracted bearer token', async () => {
    await controller.logout('Bearer token-logout');

    expect(authService.logout).toHaveBeenCalledWith('token-logout');
  });
});
