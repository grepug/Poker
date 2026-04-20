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
    getSavedGameHandDetailForUser: jest.Mock;
  };
  let savedGameReviewService: {
    scheduleHandLocalization: jest.Mock;
    retryHandReview: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      getCurrentSession: jest.fn(),
    };
    savedGameStorageService = {
      listSavedGamesForUser: jest.fn(),
      getSavedGameDetailForUser: jest.fn(),
      getSavedGameHandDetailForUser: jest.fn(),
    };
    savedGameReviewService = {
      scheduleHandLocalization: jest.fn().mockResolvedValue(undefined),
      retryHandReview: jest.fn().mockResolvedValue(false),
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

  it('returns saved game detail summary for the authenticated user without scheduling archive-wide localization', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: { id: 'user-alice' },
    });
    savedGameStorageService.getSavedGameDetailForUser.mockResolvedValue({
      archiveId: 'ROOM1',
      roomId: 'ROOM1',
      requesterUserId: 'user-alice',
      requesterPlayerId: 'alice',
      handCount: 2,
      hands: [
        {
          handNumber: 1,
          totalPot: 80,
          actionCount: 3,
          analysis: {
            status: 'ready',
            headline: 'Play tighter preflop',
            summary: 'Fold more offsuit broadways.',
            keyAdjustments: ['Fold KJo UTG'],
          },
        },
      ],
    });

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
    ).toHaveBeenCalledTimes(1);
    expect(savedGameReviewService.scheduleHandLocalization).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        archiveId: 'ROOM1',
        requesterUserId: 'user-alice',
        hands: [
          expect.objectContaining({
            totalPot: 80,
            actionCount: 3,
            analysis: expect.objectContaining({
              status: 'ready',
            }),
          }),
        ],
      }),
    );
  });

  it('returns a requested hand detail and schedules localization only for that hand', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: { id: 'user-alice' },
    });
    savedGameStorageService.getSavedGameHandDetailForUser
      .mockResolvedValueOnce({
        handNumber: 1,
        history: {
          roomId: 'ROOM1',
          handNumber: 1,
          requesterPlayerId: 'alice',
          version: 1,
          dealerPosition: 1,
          smallBlindPosition: 1,
          bigBlindPosition: 2,
          blinds: {
            smallBlind: 5,
            bigBlind: 10,
          },
          communityCardsByStreet: {
            preFlop: [],
            flop: [],
            turn: [],
            river: [],
          },
          seats: [],
          actions: [],
          settlement: {
            isShowdown: false,
            revealedPlayerIds: [],
            totalPot: 15,
            payouts: [],
            winners: [],
            netByPlayerId: {},
          },
        },
        analysis: {
          status: 'ready',
          headline: 'Play tighter preflop',
          summary: 'Fold more offsuit broadways.',
          keyAdjustments: ['Fold KJo UTG'],
        },
      })
      .mockResolvedValueOnce({
        handNumber: 1,
        history: {
          roomId: 'ROOM1',
          handNumber: 1,
          requesterPlayerId: 'alice',
          version: 1,
          dealerPosition: 1,
          smallBlindPosition: 1,
          bigBlindPosition: 2,
          blinds: {
            smallBlind: 5,
            bigBlind: 10,
          },
          communityCardsByStreet: {
            preFlop: [],
            flop: [],
            turn: [],
            river: [],
          },
          seats: [],
          actions: [],
          settlement: {
            isShowdown: false,
            revealedPlayerIds: [],
            totalPot: 15,
            payouts: [],
            winners: [],
            netByPlayerId: {},
          },
        },
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
      });
    savedGameReviewService.scheduleHandLocalization.mockResolvedValue(true);

    const result = await (controller as any).getSavedGameHandDetail(
      'ROOM1',
      1,
      { headers: { cookie: 'poker_session=token-alice' } } as any,
      'zh_hans',
      undefined,
    );

    expect(
      savedGameStorageService.getSavedGameHandDetailForUser,
    ).toHaveBeenNthCalledWith(1, 'ROOM1', 'user-alice', 1);
    expect(
      savedGameStorageService.getSavedGameHandDetailForUser,
    ).toHaveBeenNthCalledWith(2, 'ROOM1', 'user-alice', 1);
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
        handNumber: 1,
        analysis: expect.objectContaining({
          localizedByLocale: expect.objectContaining({
            zh_hans: expect.objectContaining({
              status: 'pending',
            }),
          }),
        }),
      }),
    );
  });

  it('rejects missing or invalid sessions', async () => {
    authService.getCurrentSession.mockResolvedValue(null);

    await expect(
      controller.listSavedGames({ headers: {} } as any, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('retries a failed hand review for the authenticated user and returns refreshed hand detail', async () => {
    authService.getCurrentSession.mockResolvedValue({
      user: { id: 'user-alice' },
    });
    savedGameStorageService.getSavedGameHandDetailForUser
      .mockResolvedValueOnce({
        handNumber: 2,
        history: {
          roomId: 'ROOM1',
          handNumber: 2,
          requesterPlayerId: 'alice',
          version: 1,
          dealerPosition: 1,
          smallBlindPosition: 1,
          bigBlindPosition: 2,
          blinds: { smallBlind: 5, bigBlind: 10 },
          communityCardsByStreet: {
            preFlop: [],
            flop: [],
            turn: [],
            river: [],
          },
          seats: [],
          actions: [],
          settlement: {
            isShowdown: false,
            revealedPlayerIds: [],
            totalPot: 15,
            payouts: [],
            winners: [],
            netByPlayerId: {},
          },
        },
        analysis: {
          status: 'failed',
          failureReason: 'Insufficient credits',
        },
      })
      .mockResolvedValueOnce({
        handNumber: 2,
        history: {
          roomId: 'ROOM1',
          handNumber: 2,
          requesterPlayerId: 'alice',
          version: 1,
          dealerPosition: 1,
          smallBlindPosition: 1,
          bigBlindPosition: 2,
          blinds: { smallBlind: 5, bigBlind: 10 },
          communityCardsByStreet: {
            preFlop: [],
            flop: [],
            turn: [],
            river: [],
          },
          seats: [],
          actions: [],
          settlement: {
            isShowdown: false,
            revealedPlayerIds: [],
            totalPot: 15,
            payouts: [],
            winners: [],
            netByPlayerId: {},
          },
        },
        analysis: {
          status: 'pending',
          failureReason: null,
        },
      });
    savedGameReviewService.retryHandReview.mockResolvedValue(true);

    const result = await (controller as any).retrySavedGameHandReview(
      'ROOM1',
      2,
      { headers: { cookie: 'poker_session=token-alice' } } as any,
      'en',
      undefined,
    );

    expect(savedGameReviewService.retryHandReview).toHaveBeenCalledWith({
      archiveId: 'ROOM1',
      requesterUserId: 'user-alice',
      handNumber: 2,
      locale: 'en',
    });
    expect(
      savedGameStorageService.getSavedGameHandDetailForUser,
    ).toHaveBeenNthCalledWith(1, 'ROOM1', 'user-alice', 2);
    expect(
      savedGameStorageService.getSavedGameHandDetailForUser,
    ).toHaveBeenNthCalledWith(2, 'ROOM1', 'user-alice', 2);
    expect(result).toEqual(
      expect.objectContaining({
        handNumber: 2,
        analysis: expect.objectContaining({
          status: 'pending',
        }),
      }),
    );
  });
});
