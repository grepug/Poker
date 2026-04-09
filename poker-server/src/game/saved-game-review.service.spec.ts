import { SavedGameReviewService } from './saved-game-review.service';

describe('SavedGameReviewService', () => {
  let service: SavedGameReviewService;
  let archiveStorageService: {
    getSavedGameReviewTargets: jest.Mock;
    updateSavedGameHandAnalysis: jest.Mock;
    getSavedGameHandAnalysis: jest.Mock;
  };
  let robotAgentService: {
    isConfigured: jest.Mock;
    getConfigurationError: jest.Mock;
    createConfiguredModel: jest.Mock;
    getApiMode: jest.Mock;
  };

  beforeEach(() => {
    archiveStorageService = {
      getSavedGameReviewTargets: jest.fn(),
      updateSavedGameHandAnalysis: jest.fn().mockResolvedValue(undefined),
      getSavedGameHandAnalysis: jest.fn(),
    };
    robotAgentService = {
      isConfigured: jest.fn(),
      getConfigurationError: jest.fn(),
      createConfiguredModel: jest.fn(),
      getApiMode: jest.fn().mockReturnValue('responses'),
    };

    service = new SavedGameReviewService(
      archiveStorageService as any,
      robotAgentService as any,
    );
  });

  it('marks archived hands unavailable when the shared robot model is not configured', async () => {
    archiveStorageService.getSavedGameReviewTargets.mockResolvedValue({
      archiveId: 'ROOM1',
      playerViews: [
        {
          requesterUserId: 'user-alice',
          hands: [{ handNumber: 1, history: { handNumber: 1 } }],
        },
        {
          requesterUserId: 'user-bob',
          hands: [{ handNumber: 1, history: { handNumber: 1 } }],
        },
      ],
    });
    robotAgentService.isConfigured.mockReturnValue(false);
    robotAgentService.getConfigurationError.mockReturnValue(
      'Robot AI is not configured.',
    );

    await service.runArchiveReview('ROOM1');

    expect(
      archiveStorageService.updateSavedGameHandAnalysis,
    ).toHaveBeenCalledTimes(2);
    expect(
      archiveStorageService.updateSavedGameHandAnalysis,
    ).toHaveBeenNthCalledWith(
      1,
      'ROOM1',
      'user-alice',
      1,
      expect.objectContaining({
        status: 'unavailable',
        failureReason: 'Robot AI is not configured.',
      }),
    );
  });

  it('marks archived hands ready when structured review generation succeeds', async () => {
    archiveStorageService.getSavedGameReviewTargets.mockResolvedValue({
      archiveId: 'ROOM1',
      playerViews: [
        {
          requesterUserId: 'user-alice',
          hands: [{ handNumber: 2, history: { handNumber: 2 } }],
        },
      ],
    });
    robotAgentService.isConfigured.mockReturnValue(true);
    robotAgentService.getConfigurationError.mockReturnValue(null);
    jest
      .spyOn(service as any, 'generateStructuredReview')
      .mockResolvedValue({
        headline: 'River bluff catch was too thin',
        summary: 'Fold more often against this line.',
        keyAdjustments: ['Fold river versus large polar sizing'],
      });
    jest
      .spyOn(service as any, 'localizeReviewText')
      .mockResolvedValue({
        headline: '河牌抓诈唬太薄了',
        summary: '面对这条线时要更常弃牌。',
        keyAdjustments: ['面对两极化大尺码时更多河牌弃牌'],
      });

    await service.runArchiveReview('ROOM1');

    expect(
      archiveStorageService.updateSavedGameHandAnalysis,
    ).toHaveBeenCalledWith(
      'ROOM1',
      'user-alice',
      2,
      expect.objectContaining({
        status: 'ready',
        headline: 'River bluff catch was too thin',
        summary: 'Fold more often against this line.',
        localizedByLocale: {
          en: expect.objectContaining({
            status: 'ready',
            headline: 'River bluff catch was too thin',
          }),
          zh_hans: expect.objectContaining({
            status: 'ready',
            headline: '河牌抓诈唬太薄了',
          }),
        },
      }),
    );
  });

  it('queues archive reviews sequentially and deduplicates repeated schedule requests', async () => {
    const started: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstReviewFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    jest.spyOn(service, 'runArchiveReview').mockImplementation(async (archiveId) => {
      started.push(archiveId);
      if (archiveId === 'ROOM1') {
        await firstReviewFinished;
      }
    });

    await service.scheduleArchiveReview('ROOM1');
    await service.scheduleArchiveReview('ROOM1');
    await service.scheduleArchiveReview('ROOM2');
    await Promise.resolve();

    expect(started).toEqual(['ROOM1']);

    releaseFirst?.();
    await (service as any).reviewQueue;

    expect(started).toEqual(['ROOM1', 'ROOM2']);
  });

  it('localizes a missing future locale from canonical review and caches it', async () => {
    archiveStorageService.getSavedGameHandAnalysis.mockResolvedValue({
      status: 'ready',
      headline: 'Play tighter preflop',
      summary: 'Fold more offsuit broadways.',
      keyAdjustments: ['Fold KJo UTG'],
      localizedByLocale: {
        en: {
          status: 'ready',
          headline: 'Play tighter preflop',
          summary: 'Fold more offsuit broadways.',
          keyAdjustments: ['Fold KJo UTG'],
        },
      },
    });

    jest
      .spyOn(service as any, 'localizeReviewText')
      .mockResolvedValue({
        headline: 'Jouez plus serré préflop',
        summary: 'Couchez plus de broadways offsuit.',
        keyAdjustments: ['Couchez KJo UTG'],
      });

    await service.scheduleHandLocalization({
      archiveId: 'ROOM1',
      requesterUserId: 'user-alice',
      handNumber: 3,
      locale: 'fr',
    });
    await (service as any).reviewQueue;

    expect(
      archiveStorageService.updateSavedGameHandAnalysis,
    ).toHaveBeenCalledWith(
      'ROOM1',
      'user-alice',
      3,
      expect.objectContaining({
        localizedByLocale: expect.objectContaining({
          fr: expect.objectContaining({
            status: 'ready',
            headline: 'Jouez plus serré préflop',
          }),
        }),
      }),
    );
  });

  it('falls back malformed locale requests to english cache deterministically', async () => {
    archiveStorageService.getSavedGameHandAnalysis.mockResolvedValue({
      status: 'ready',
      headline: 'Value bet bigger on the turn',
      summary: 'You left value on the table.',
      keyAdjustments: ['Size up turn value bets'],
      localizedByLocale: {},
    });

    const localizeReviewTextSpy = jest.spyOn(service as any, 'localizeReviewText');

    await service.scheduleHandLocalization({
      archiveId: 'ROOM1',
      requesterUserId: 'user-alice',
      handNumber: 4,
      locale: '!!!',
    });
    await (service as any).reviewQueue;

    expect(localizeReviewTextSpy).not.toHaveBeenCalled();
    expect(
      archiveStorageService.updateSavedGameHandAnalysis,
    ).toHaveBeenCalledWith(
      'ROOM1',
      'user-alice',
      4,
      expect.objectContaining({
        localizedByLocale: expect.objectContaining({
          en: expect.objectContaining({
            status: 'ready',
            headline: 'Value bet bigger on the turn',
          }),
        }),
      }),
    );
  });

  it('reuses an existing locale cache without rerunning localization', async () => {
    archiveStorageService.getSavedGameHandAnalysis.mockResolvedValue({
      status: 'ready',
      headline: 'Play tighter preflop',
      summary: 'Fold more offsuit broadways.',
      keyAdjustments: ['Fold KJo UTG'],
      localizedByLocale: {
        en: {
          status: 'ready',
          headline: 'Play tighter preflop',
          summary: 'Fold more offsuit broadways.',
          keyAdjustments: ['Fold KJo UTG'],
        },
        zh_hans: {
          status: 'ready',
          headline: '翻前更紧一些',
          summary: '更多弃掉非同花大张。',
          keyAdjustments: ['UTG 弃掉 KJo'],
        },
      },
    });

    const localizeReviewTextSpy = jest.spyOn(service as any, 'localizeReviewText');

    await service.scheduleHandLocalization({
      archiveId: 'ROOM1',
      requesterUserId: 'user-alice',
      handNumber: 5,
      locale: 'zh_hans',
    });
    await (service as any).reviewQueue;

    expect(localizeReviewTextSpy).not.toHaveBeenCalled();
    expect(
      archiveStorageService.updateSavedGameHandAnalysis,
    ).not.toHaveBeenCalled();
  });
});
