import { SavedGameReviewService } from './saved-game-review.service';

describe('SavedGameReviewService', () => {
  let service: SavedGameReviewService;
  let archiveStorageService: {
    getSavedGameReviewTargets: jest.Mock;
    updateSavedGameHandAnalysis: jest.Mock;
  };
  let robotAgentService: {
    isConfigured: jest.Mock;
    getConfigurationError: jest.Mock;
  };

  beforeEach(() => {
    archiveStorageService = {
      getSavedGameReviewTargets: jest.fn(),
      updateSavedGameHandAnalysis: jest.fn().mockResolvedValue(undefined),
    };
    robotAgentService = {
      isConfigured: jest.fn(),
      getConfigurationError: jest.fn(),
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
});
