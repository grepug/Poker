import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CompletedHandHistoryExport,
  SavedGameHandAnalysis,
  SavedGameLocalizedAnalysis,
} from 'poker-types';
import { z } from 'zod';
import type { ISavedGameArchiveStorageService } from '../common/interfaces/saved-game-archive-storage.interface';
import { RobotAgentService } from './robot-agent.service';

const REVIEW_OUTPUT_SCHEMA = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  keyAdjustments: z.array(z.string().min(1)).min(1).max(3),
});

const PREWARMED_REVIEW_LOCALES = ['en', 'zh_hans'] as const;

@Injectable()
export class SavedGameReviewService {
  private readonly logger = new Logger(SavedGameReviewService.name);
  private reviewQueue: Promise<void> = Promise.resolve();
  private readonly queuedArchiveIds = new Set<string>();
  private readonly queuedLocalizationKeys = new Set<string>();

  constructor(
    @Inject('ISavedGameArchiveStorageService')
    private readonly savedGameArchiveStorageService: ISavedGameArchiveStorageService,
    private readonly robotAgentService: RobotAgentService,
  ) {}

  async scheduleArchiveReview(archiveId: string): Promise<void> {
    if (this.queuedArchiveIds.has(archiveId)) {
      return;
    }

    this.queuedArchiveIds.add(archiveId);
    const runReview = async () => {
      try {
        await this.runArchiveReview(archiveId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown review error';
        this.logger.error(
          `Saved game review scheduling failed for ${archiveId}: ${message}`,
        );
      } finally {
        this.queuedArchiveIds.delete(archiveId);
      }
    };

    this.reviewQueue = this.reviewQueue
      .catch(() => undefined)
      .then(runReview);
  }

  async scheduleHandLocalization(params: {
    archiveId: string;
    requesterUserId: string;
    handNumber: number;
    locale?: string;
  }): Promise<boolean> {
    const locale = this.normalizeLocale(params.locale);
    const preparation = await this.prepareHandLocalization({
      ...params,
      locale,
    });
    if (!preparation.shouldQueue) {
      return preparation.didWrite;
    }

    const queueKey = [
      params.archiveId,
      params.requesterUserId,
      params.handNumber,
      locale,
    ].join(':');
    if (this.queuedLocalizationKeys.has(queueKey)) {
      return preparation.didWrite;
    }

    this.queuedLocalizationKeys.add(queueKey);
    const runLocalization = async () => {
      try {
        await this.finishQueuedHandLocalization({
          ...params,
          locale,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown localization error';
        this.logger.error(
          `Saved game localization failed for ${queueKey}: ${message}`,
        );
      } finally {
        this.queuedLocalizationKeys.delete(queueKey);
      }
    };

    this.reviewQueue = this.reviewQueue
      .catch(() => undefined)
      .then(runLocalization);
    return preparation.didWrite;
  }

  async runArchiveReview(archiveId: string): Promise<void> {
    const targets =
      await this.savedGameArchiveStorageService.getSavedGameReviewTargets(
        archiveId,
      );
    if (!targets) {
      return;
    }

    if (!this.robotAgentService.isConfigured()) {
      const failureReason =
        this.robotAgentService.getConfigurationError() ||
        'Robot AI is not configured.';
      await this.markArchiveUnavailable(targets.archiveId, targets.playerViews, failureReason);
      return;
    }

    for (const playerView of targets.playerViews) {
      for (const hand of playerView.hands) {
        try {
          const review = await this.generateStructuredReview({
            archiveId,
            requesterPlayerId: playerView.requesterPlayerId,
            handHistory: hand.history,
          });
          const localizedByLocale: SavedGameHandAnalysis['localizedByLocale'] = {
            en: this.buildLocalizedReadyEntry(review),
          };
          for (const locale of PREWARMED_REVIEW_LOCALES) {
            if (locale === 'en') {
              continue;
            }
            try {
              const localizedReview = await this.localizeReviewText({
                locale,
                canonicalReview: review,
              });
              localizedByLocale[locale] =
                this.buildLocalizedReadyEntry(localizedReview);
            } catch (error) {
              localizedByLocale[locale] = this.buildLocalizedFailureEntry(
                error instanceof Error
                  ? error.message
                  : 'Failed to localize review',
              );
            }
          }
          await this.savedGameArchiveStorageService.updateSavedGameHandAnalysis(
            archiveId,
            playerView.requesterUserId,
            hand.handNumber,
            this.buildCanonicalReadyAnalysis(review, localizedByLocale),
          );
        } catch (error) {
          const failureReason =
            error instanceof Error ? error.message : 'Failed to generate review';
          await this.savedGameArchiveStorageService.updateSavedGameHandAnalysis(
            archiveId,
            playerView.requesterUserId,
            hand.handNumber,
            this.buildUnavailableAnalysis('failed', failureReason),
          );
        }
      }
    }
  }

  private async markArchiveUnavailable(
    archiveId: string,
    playerViews: Array<{
      requesterUserId: string;
      hands: Array<{ handNumber: number }>;
    }>,
    failureReason: string,
  ) {
    for (const playerView of playerViews) {
      for (const hand of playerView.hands) {
        await this.savedGameArchiveStorageService.updateSavedGameHandAnalysis(
          archiveId,
          playerView.requesterUserId,
          hand.handNumber,
          this.buildUnavailableAnalysis('unavailable', failureReason),
        );
      }
    }
  }

  private async prepareHandLocalization(params: {
    archiveId: string;
    requesterUserId: string;
    handNumber: number;
    locale: string;
  }): Promise<{ didWrite: boolean; shouldQueue: boolean }> {
    const analysis =
      await this.savedGameArchiveStorageService.getSavedGameHandAnalysis(
        params.archiveId,
        params.requesterUserId,
        params.handNumber,
      );
    if (!analysis || analysis.status !== 'ready') {
      return { didWrite: false, shouldQueue: false };
    }

    const existingLocalization = analysis.localizedByLocale?.[params.locale];
    if (existingLocalization) {
      return { didWrite: false, shouldQueue: false };
    }

    const canonicalReview = this.toCanonicalReviewText(analysis);
    if (!canonicalReview) {
      return { didWrite: false, shouldQueue: false };
    }

    if (params.locale === 'en') {
      const didWrite =
        await this.savedGameArchiveStorageService.mergeSavedGameHandLocalization(
        params.archiveId,
        params.requesterUserId,
        params.handNumber,
        params.locale,
        this.buildLocalizedReadyEntry(canonicalReview),
      );
      return { didWrite, shouldQueue: false };
    }

    const configError = this.robotAgentService.getConfigurationError();
    if (configError) {
      const didWrite =
        await this.savedGameArchiveStorageService.mergeSavedGameHandLocalization(
        params.archiveId,
        params.requesterUserId,
        params.handNumber,
        params.locale,
        this.buildLocalizedFailureEntry(configError),
      );
      return { didWrite, shouldQueue: false };
    }

    const didWrite =
      await this.savedGameArchiveStorageService.mergeSavedGameHandLocalization(
      params.archiveId,
      params.requesterUserId,
      params.handNumber,
      params.locale,
      this.buildLocalizedPendingEntry(),
    );
    return { didWrite, shouldQueue: didWrite };
  }

  private async finishQueuedHandLocalization(params: {
    archiveId: string;
    requesterUserId: string;
    handNumber: number;
    locale: string;
  }): Promise<void> {
    const analysis =
      await this.savedGameArchiveStorageService.getSavedGameHandAnalysis(
        params.archiveId,
        params.requesterUserId,
        params.handNumber,
      );
    if (!analysis || analysis.status !== 'ready') {
      return;
    }

    const existingLocalization = analysis.localizedByLocale?.[params.locale];
    if (
      existingLocalization?.status === 'ready' ||
      existingLocalization?.status === 'failed' ||
      existingLocalization?.status === 'unavailable'
    ) {
      return;
    }

    const canonicalReview = this.toCanonicalReviewText(analysis);
    if (!canonicalReview) {
      return;
    }

    try {
      const localizedReview = await this.localizeReviewText({
        locale: params.locale,
        canonicalReview,
      });
      await this.savedGameArchiveStorageService.mergeSavedGameHandLocalization(
        params.archiveId,
        params.requesterUserId,
        params.handNumber,
        params.locale,
        this.buildLocalizedReadyEntry(localizedReview),
      );
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : 'Failed to localize review';
      await this.savedGameArchiveStorageService.mergeSavedGameHandLocalization(
        params.archiveId,
        params.requesterUserId,
        params.handNumber,
        params.locale,
        this.buildLocalizedFailureEntry(failureReason),
      );
    }
  }

  private async generateStructuredReview(params: {
    archiveId: string;
    requesterPlayerId: string;
    handHistory: CompletedHandHistoryExport;
  }): Promise<z.infer<typeof REVIEW_OUTPUT_SCHEMA>> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { generateObject } = require('ai');
    const result = await generateObject({
      model: this.robotAgentService.createConfiguredModel('saved-game-review'),
      schema: REVIEW_OUTPUT_SCHEMA,
      prompt: this.buildReviewPrompt(params),
      ...(this.robotAgentService.getApiMode() === 'responses'
        ? {}
        : { temperature: Number(process.env.AI_ROBOT_TEMPERATURE || '0.3') }),
    });

    return result.object;
  }

  private async localizeReviewText(params: {
    locale: string;
    canonicalReview: z.infer<typeof REVIEW_OUTPUT_SCHEMA>;
  }): Promise<z.infer<typeof REVIEW_OUTPUT_SCHEMA>> {
    if (params.locale === 'en') {
      return params.canonicalReview;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { generateObject } = require('ai');
    const result = await generateObject({
      model: this.robotAgentService.createConfiguredModel(
        'saved-game-review-localization',
      ),
      schema: REVIEW_OUTPUT_SCHEMA,
      prompt: this.buildLocalizationPrompt(params),
      ...(this.robotAgentService.getApiMode() === 'responses'
        ? {}
        : { temperature: Number(process.env.AI_ROBOT_TEMPERATURE || '0.1') }),
    });

    return result.object;
  }

  private buildReviewPrompt(params: {
    archiveId: string;
    requesterPlayerId: string;
    handHistory: CompletedHandHistoryExport;
  }): string {
    return [
      'You are generating AI poker strategy review for a saved hand.',
      'Use only the provided player-scoped hand history.',
      'Do not claim solver-grade GTO or equilibrium certainty.',
      'Do not assume hidden opponent hole cards when they are absent.',
      'Give concise, practical post-game review for the requester.',
      JSON.stringify({
        archiveId: params.archiveId,
        requesterPlayerId: params.requesterPlayerId,
        handHistory: params.handHistory,
      }),
    ].join('\n\n');
  }

  private buildLocalizationPrompt(params: {
    locale: string;
    canonicalReview: z.infer<typeof REVIEW_OUTPUT_SCHEMA>;
  }): string {
    return [
      'You are localizing saved-game poker review copy.',
      'Translate the canonical review into the requested locale without changing poker meaning.',
      'Do not add strategy claims, markdown, or extra bullets.',
      `Target locale: ${this.describeLocale(params.locale)}`,
      JSON.stringify(params.canonicalReview),
    ].join('\n\n');
  }

  private buildCanonicalReadyAnalysis(
    review: z.infer<typeof REVIEW_OUTPUT_SCHEMA>,
    localizedByLocale: SavedGameHandAnalysis['localizedByLocale'],
  ): SavedGameHandAnalysis {
    const updatedAt = Date.now();
    return {
      status: 'ready',
      updatedAt,
      provider: 'ai-robot-config',
      headline: review.headline,
      summary: review.summary,
      keyAdjustments: review.keyAdjustments,
      failureReason: null,
      localizedByLocale: Object.fromEntries(
        Object.entries(localizedByLocale ?? {}).map(([locale, localized]) => [
          locale,
          {
            ...localized,
            updatedAt,
          },
        ]),
      ),
    };
  }

  private buildUnavailableAnalysis(
    status: 'failed' | 'unavailable',
    failureReason: string,
  ): SavedGameHandAnalysis {
    return {
      status,
      updatedAt: Date.now(),
      provider: 'ai-robot-config',
      headline: null,
      summary: null,
      keyAdjustments: [],
      failureReason,
      localizedByLocale: {},
    };
  }

  private buildLocalizedPendingEntry(): SavedGameLocalizedAnalysis {
    return {
      status: 'pending',
      updatedAt: Date.now(),
      headline: null,
      summary: null,
      keyAdjustments: [],
      failureReason: null,
    };
  }

  private buildLocalizedReadyEntry(
    review: z.infer<typeof REVIEW_OUTPUT_SCHEMA>,
    updatedAt = Date.now(),
  ): SavedGameLocalizedAnalysis {
    return {
      status: 'ready',
      updatedAt,
      headline: review.headline,
      summary: review.summary,
      keyAdjustments: review.keyAdjustments,
      failureReason: null,
    };
  }

  private buildLocalizedFailureEntry(
    failureReason: string,
  ): SavedGameLocalizedAnalysis {
    return {
      status: 'failed',
      updatedAt: Date.now(),
      headline: null,
      summary: null,
      keyAdjustments: [],
      failureReason,
    };
  }

  private toCanonicalReviewText(
    analysis: SavedGameHandAnalysis,
  ): z.infer<typeof REVIEW_OUTPUT_SCHEMA> | null {
    if (
      analysis.status !== 'ready' ||
      !analysis.headline?.trim() ||
      !analysis.summary?.trim() ||
      !(analysis.keyAdjustments ?? []).length
    ) {
      return null;
    }

    return {
      headline: analysis.headline,
      summary: analysis.summary,
      keyAdjustments: analysis.keyAdjustments ?? [],
    };
  }

  private normalizeLocale(locale?: string): string {
    const normalized = (locale ?? '').trim().toLowerCase().replace(/-/g, '_');
    if (!normalized) {
      return 'en';
    }
    if (normalized === 'en' || normalized.startsWith('en_')) {
      return 'en';
    }
    if (
      normalized === 'zh_hans' ||
      normalized === 'zh_cn' ||
      normalized === 'zh_hans_cn'
    ) {
      return 'zh_hans';
    }
    if (!/^[a-z]{2,3}(?:_[a-z0-9]{2,8})*$/.test(normalized)) {
      return 'en';
    }
    return normalized;
  }

  private describeLocale(locale: string): string {
    if (locale === 'en') {
      return 'English (en)';
    }
    if (locale === 'zh_hans') {
      return 'Simplified Chinese (zh_hans)';
    }
    return locale;
  }

}
