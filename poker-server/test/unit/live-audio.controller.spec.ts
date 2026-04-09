import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { LiveAudioController } from '../../src/live-audio/live-audio.controller';

describe('LiveAudioController', () => {
  let controller: LiveAudioController;
  let authService: {
    getCurrentSession: jest.Mock;
  };
  let liveAudioService: {
    getPublicConfig: jest.Mock;
    createJoinToken: jest.Mock;
  };

  beforeEach(() => {
    authService = {
      getCurrentSession: jest.fn(),
    };

    liveAudioService = {
      getPublicConfig: jest.fn().mockReturnValue({
        enabled: true,
        serverUrl: 'wss://poker-16h0u738.livekit.cloud',
      }),
      createJoinToken: jest.fn(),
    };

    controller = new LiveAudioController(
      authService as any,
      liveAudioService as any,
    );
  });

  it('returns public config for authenticated clients', async () => {
    const result = await controller.getConfig(
      { headers: { cookie: 'poker_session=cookie-token' } } as any,
      undefined,
    );

    expect(result).toEqual({
      enabled: true,
      serverUrl: 'wss://poker-16h0u738.livekit.cloud',
    });
  });

  it('reads the auth cookie before the authorization header when minting a token', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: {
        id: 'user-1',
        displayName: 'Alice',
        avatarEmoji: '🦊',
      },
      sessionExpiresAt: Date.now() + 60_000,
    });
    liveAudioService.createJoinToken.mockResolvedValue({
      enabled: true,
      token: 'jwt-token',
    });

    await controller.createToken(
      { headers: { cookie: 'poker_session=cookie-token' } } as any,
      undefined,
      { roomId: 'ROOM83' },
    );

    expect(authService.getCurrentSession).toHaveBeenCalledWith('cookie-token');
    expect(liveAudioService.createJoinToken).toHaveBeenCalledWith({
      roomId: 'ROOM83',
      user: {
        id: 'user-1',
        displayName: 'Alice',
        avatarEmoji: '🦊',
      },
    });
  });

  it('supports bearer-token extraction when the auth cookie is absent', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: {
        id: 'user-1',
        displayName: 'Alice',
        avatarEmoji: '🦊',
      },
      sessionExpiresAt: Date.now() + 60_000,
    });
    liveAudioService.createJoinToken.mockResolvedValue({
      enabled: true,
      token: 'jwt-token',
    });

    await controller.createToken(
      { headers: {} } as any,
      'Bearer auth-token',
      { roomId: 'ROOM83' },
    );

    expect(authService.getCurrentSession).toHaveBeenCalledWith('auth-token');
  });

  it('rejects missing auth when minting a token', async () => {
    await expect(
      controller.createToken({ headers: {} } as any, undefined, {
        roomId: 'ROOM83',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns disabled config without looking up the current session', async () => {
    liveAudioService.getPublicConfig.mockReturnValue({
      enabled: false,
    });

    const result = await controller.getConfig({ headers: {} } as any, undefined);

    expect(result).toEqual({ enabled: false });
    expect(authService.getCurrentSession).not.toHaveBeenCalled();
  });

  it('returns a service unavailable error when the session is invalid', async () => {
    authService.getCurrentSession.mockResolvedValue(null);

    await expect(
      controller.createToken(
        { headers: {} } as any,
        'Bearer auth-token',
        { roomId: 'ROOM83' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('surfaces service-level disabled-state errors during token minting', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: {
        id: 'user-1',
        displayName: 'Alice',
        avatarEmoji: '🦊',
      },
      sessionExpiresAt: Date.now() + 60_000,
    });
    liveAudioService.createJoinToken.mockRejectedValue(
      new ServiceUnavailableException('Live audio is disabled'),
    );

    await expect(
      controller.createToken(
        { headers: {} } as any,
        'Bearer auth-token',
        { roomId: 'ROOM83' },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
