import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CompletedHandHistoryExport, SavedGameHandAnalysis } from 'poker-types';
import { z } from 'zod';
import type { ISavedGameArchiveStorageService } from '../common/interfaces/saved-game-archive-storage.interface';
import {
  createVolcengineResponsesCompatFetch,
  isVolcengineResponsesBaseUrl,
} from './openai-responses-compat';
import { RobotAgentService } from './robot-agent.service';

const REVIEW_OUTPUT_SCHEMA = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  keyAdjustments: z.array(z.string().min(1)).min(1).max(3),
});

@Injectable()
export class SavedGameReviewService {
  private readonly logger = new Logger(SavedGameReviewService.name);

  constructor(
    @Inject('ISavedGameArchiveStorageService')
    private readonly savedGameArchiveStorageService: ISavedGameArchiveStorageService,
    private readonly robotAgentService: RobotAgentService,
  ) {}

  async scheduleArchiveReview(archiveId: string): Promise<void> {
    void this.runArchiveReview(archiveId).catch((error) => {
      const message =
        error instanceof Error ? error.message : 'Unknown review error';
      this.logger.error(
        `Saved game review scheduling failed for ${archiveId}: ${message}`,
      );
    });
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
          await this.savedGameArchiveStorageService.updateSavedGameHandAnalysis(
            archiveId,
            playerView.requesterUserId,
            hand.handNumber,
            {
              status: 'ready',
              updatedAt: Date.now(),
              provider: 'ai-robot-config',
              headline: review.headline,
              summary: review.summary,
              keyAdjustments: review.keyAdjustments,
              failureReason: null,
            },
          );
        } catch (error) {
          const failureReason =
            error instanceof Error ? error.message : 'Failed to generate review';
          await this.savedGameArchiveStorageService.updateSavedGameHandAnalysis(
            archiveId,
            playerView.requesterUserId,
            hand.handNumber,
            {
              status: 'failed',
              updatedAt: Date.now(),
              provider: 'ai-robot-config',
              headline: null,
              summary: null,
              keyAdjustments: [],
              failureReason,
            },
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
          {
            status: 'unavailable',
            updatedAt: Date.now(),
            provider: 'ai-robot-config',
            headline: null,
            summary: null,
            keyAdjustments: [],
            failureReason,
          },
        );
      }
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
      model: this.createModel(),
      schema: REVIEW_OUTPUT_SCHEMA,
      prompt: this.buildReviewPrompt(params),
      ...(this.getApiMode() === 'responses'
        ? {}
        : { temperature: Number(process.env.AI_ROBOT_TEMPERATURE || '0.3') }),
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

  private createModel() {
    const baseURL = process.env.AI_ROBOT_BASE_URL!.trim();
    const apiKey = process.env.AI_ROBOT_API_KEY!.trim();
    const modelId = process.env.AI_ROBOT_MODEL_ID!.trim();
    const apiMode = this.getApiMode();

    if (apiMode === 'responses') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createOpenAI } = require('@ai-sdk/openai');
      const provider = createOpenAI({
        name: 'saved-game-review-openai-responses',
        baseURL,
        apiKey,
        ...(isVolcengineResponsesBaseUrl(baseURL)
          ? { fetch: createVolcengineResponsesCompatFetch() }
          : {}),
      });
      return provider.responses(modelId);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
    const provider = createOpenAICompatible({
      name: 'saved-game-review-openai-compatible',
      baseURL,
      apiKey,
    });
    return provider.chatModel(modelId);
  }

  private getApiMode(): 'chat' | 'responses' {
    return (process.env.AI_ROBOT_API_MODE || 'chat').trim() === 'responses'
      ? 'responses'
      : 'chat';
  }
}
