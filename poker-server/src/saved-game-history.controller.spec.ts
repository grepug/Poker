import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth/auth.service';
import { SavedGameHistoryController } from './saved-game-history.controller';
import { SavedGameReviewService } from './game/saved-game-review.service';

describe('SavedGameHistoryController', () => {
  let controller: SavedGameHistoryController;
  let authService: {
    getCurrentSession: jest.Mock;
  };
  let savedGameStorageService: {
    listSavedGamesForUser: jest.Mock;
    getSavedGameDetailForUser: jest.Mock;
  };
  let savedGameReviewService: {
    scheduleHandLocalization: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      getCurrentSession: jest.fn(),
    };
    savedGameStorageService = {
      listSavedGamesForUser: jest.fn(),
      getSavedGameDetailForUser: jest.fn(),
    };
    savedGameReviewService = {
      scheduleHandLocalization: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SavedGameHistoryController],
      providers: [
        {
          provide: SavedGameReviewService,
          useValue: savedGameReviewService,
        },
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
    savedGameStorageService.getSavedGameDetailForUser
      .mockResolvedValueOnce({
        archiveId: 'ROOM1',
        roomId: 'ROOM1',
        requesterUserId: 'user-alice',
        requesterPlayerId: 'alice',
        handCount: 2,
        hands: [
          {
            handNumber: 1,
            analysis: {
              status: 'ready',
              headline: 'Play tighter preflop',
              summary: 'Fold more offsuit broadways.',
              keyAdjustments: ['Fold KJo UTG'],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
      archiveId: 'ROOM1',
      roomId: 'ROOM1',
      requesterUserId: 'user-alice',
      requesterPlayerId: 'alice',
      handCount: 2,
      hands: [
        {
          handNumber: 1,
          analysis: {
            status: 'ready',
            headline: 'Play tighter preflop',
            summary: 'Fold more offsuit broadways.',
            keyAdjustments: ['Fold KJo UTG'],
            localizedByLocale: {
              zh_hans: {
                status: 'pending',
                headline: null,
                summary: null,
                keyAdjustments: [],
              },
            },
          },
        },
      ],
    });
    savedGameReviewService.scheduleHandLocalization.mockResolvedValue(true);

    const result = await controller.getSavedGameDetail(
      'ROOM1',
      { headers: { cookie: 'poker_session=token-alice' } } as any,
      'zh_hans',
      undefined,
    );

    expect(
      savedGameStorageService.getSavedGameDetailForUser,
    ).toHaveBeenNthCalledWith(1, 'ROOM1', 'user-alice');
    expect(
      savedGameStorageService.getSavedGameDetailForUser,
    ).toHaveBeenNthCalledWith(2, 'ROOM1', 'user-alice');
    expect(savedGameReviewService.scheduleHandLocalization).toHaveBeenCalledWith(
      {
        archiveId: 'ROOM1',
        requesterUserId: 'user-alice',
        handNumber: 1,
        locale: 'zh_hans',
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        archiveId: 'ROOM1',
        requesterUserId: 'user-alice',
        hands: [
          expect.objectContaining({
            analysis: expect.objectContaining({
              localizedByLocale: expect.objectContaining({
                zh_hans: expect.objectContaining({
                  status: 'pending',
                }),
              }),
            }),
          }),
        ],
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
