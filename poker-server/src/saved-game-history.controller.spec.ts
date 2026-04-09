import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth/auth.service';
import { SavedGameHistoryController } from './saved-game-history.controller';

describe('SavedGameHistoryController', () => {
  let controller: SavedGameHistoryController;
  let authService: {
    getCurrentSession: jest.Mock;
  };
  let savedGameStorageService: {
    listSavedGamesForUser: jest.Mock;
    getSavedGameDetailForUser: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      getCurrentSession: jest.fn(),
    };
    savedGameStorageService = {
      listSavedGamesForUser: jest.fn(),
      getSavedGameDetailForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SavedGameHistoryController],
      providers: [
        {
          provide: 'ISavedGameArchiveStorageService',
          useValue: savedGameStorageService,
        },
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    }).compile();

    controller = module.get<SavedGameHistoryController>(
      SavedGameHistoryController,
    );
  });

  it('lists saved games for the authenticated user', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: { id: 'user-alice' },
    });
    savedGameStorageService.listSavedGamesForUser.mockResolvedValue([
      {
        archiveId: 'ROOM1',
        roomId: 'ROOM1',
        requesterUserId: 'user-alice',
        requesterPlayerId: 'alice',
      },
    ]);

    const result = await controller.listSavedGames(
      { headers: { cookie: 'poker_session=token-alice' } } as any,
      undefined,
    );

    expect(savedGameStorageService.listSavedGamesForUser).toHaveBeenCalledWith(
      'user-alice',
    );
    expect(result).toEqual([
      expect.objectContaining({
        archiveId: 'ROOM1',
        requesterUserId: 'user-alice',
      }),
    ]);
  });

  it('returns saved game detail for the authenticated user', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: { id: 'user-alice' },
    });
    savedGameStorageService.getSavedGameDetailForUser.mockResolvedValue({
      archiveId: 'ROOM1',
      roomId: 'ROOM1',
      requesterUserId: 'user-alice',
      requesterPlayerId: 'alice',
      handCount: 2,
      hands: [],
    });

    const result = await controller.getSavedGameDetail(
      'ROOM1',
      { headers: { cookie: 'poker_session=token-alice' } } as any,
      undefined,
    );

    expect(
      savedGameStorageService.getSavedGameDetailForUser,
    ).toHaveBeenCalledWith('ROOM1', 'user-alice');
    expect(result).toEqual(
      expect.objectContaining({
        archiveId: 'ROOM1',
        requesterUserId: 'user-alice',
      }),
    );
  });

  it('rejects missing or invalid sessions', async () => {
    authService.getCurrentSession.mockResolvedValue(null);

    await expect(
      controller.listSavedGames({ headers: {} } as any, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
