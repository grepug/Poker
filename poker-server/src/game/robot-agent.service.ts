import { Injectable, Logger } from '@nestjs/common';
import {
  PersistedRobotDecisionMetadata,
  PersistedRobotFallbackCause,
  PlayerAction,
} from 'poker-types';
import { z } from 'zod';
import {
  createResponsesCompatFetch,
} from './openai-responses-compat';

export type RobotActionCandidate = {
  action: PlayerAction;
  amount?: number;
};

export type RobotActionDecision = RobotActionCandidate & {
  persistedDecision: PersistedRobotDecisionMetadata;
};

export type RobotActionValidation = {
  valid: boolean;
  reason?: string;
  legalActions?: Record<string, unknown>;
};

export type RobotDecisionFailureCode =
  | 'provider-error'
  | 'invalid-final-action'
  | 'exhausted-retries';

export class RobotDecisionError extends Error {
  constructor(
    readonly code: RobotDecisionFailureCode,
    message: string,
    readonly validationRetryCount = 0,
  ) {
    super(message);
    this.name = 'RobotDecisionError';
  }
}

export type RobotTurnContext = {
  schemaVersion: '1.0';
  roomId: string;
  handNumber: number;
  nowIso: string;
  rules: {
    variant: 'standard' | 'shortDeck';
    smallBlind: number;
    bigBlind: number;
    bettingRound: 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';
    raiseFormat: 'increment_over_call';
  };
  hero: {
    playerId: string;
    name: string;
    seatPosition: number;
    chips: number;
    currentBet: number;
    status: string;
    holeCards: Array<{ rank: string; suit: string }>;
  };
  table: {
    pot: number;
    currentBet: number;
    minRaise: number;
    communityCards: Array<{ rank: string; suit: string }>;
    playersPublic: Array<{
      playerId: string;
      name: string;
      seatPosition: number;
      chips: number;
      currentBet: number;
      status: string;
      isDealer: boolean;
      isSmallBlind: boolean;
      isBigBlind: boolean;
      lastAction: PlayerAction | null;
    }>;
    revealedHoleCardsByPlayerId: Record<
      string,
      Array<{ rank: string; suit: string }>
    >;
  };
  legalActions: {
    fold: { enabled: boolean };
    check: { enabled: boolean };
    call: { enabled: boolean; amountToCall: number };
    raise: {
      enabled: boolean;
      minIncrement: number;
      maxIncrement: number;
      suggestedIncrements: number[];
    };
    allIn: { enabled: boolean; increment: number };
  };
  history: {
    recentActions: Array<{
      playerId: string;
      action: PlayerAction;
      amount?: number;
      bettingRound: 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';
    }>;
  };
  constraints: {
    maxAgentSteps: number;
    toolRetryLimit: number;
    actionDelayMsMin: number;
    actionDelayMsMax: number;
  };
};

const ACTION_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['fold', 'check', 'call', 'raise', 'all-in'],
    },
    amount: {
      type: 'number',
    },
  },
  required: ['action'],
  additionalProperties: false,
} as const;

const ACTION_OUTPUT_SCHEMA = z.object({
  action: z.enum(['fold', 'check', 'call', 'raise', 'all-in']),
  amount: z.number().optional(),
});

const ROBOT_SYSTEM_PROMPT = `
You are a poker robot player in a Texas Hold'em game.

GOAL
- Maximize long-term expected chip value.
- Always complete your turn with a legal action.

HARD RULES
- You may use only provided turn context.
- Never assume hidden cards or private information.
- Never invent actions or rules.
- Use tools to decide; do not provide plain-text final action.

TOOL LOOP POLICY
1) Analyze context.
2) Call attempt_action with candidate action.
3) If rejected, use reason/legal actions and retry.
4) Once you have a legal action, return it as structured output.
5) Stay within max step limit.

ACTION POLICY
- Prefer check over fold when check is legal.
- Raise amount must be integer and legal increment-over-call.
`;

@Injectable()
export class RobotAgentService {
  private readonly logger = new Logger(RobotAgentService.name);

  isConfigured(): boolean {
    return Boolean(
      process.env.AI_ROBOT_API_KEY?.trim() &&
      process.env.AI_ROBOT_BASE_URL?.trim() &&
      process.env.AI_ROBOT_MODEL_ID?.trim(),
    );
  }

  getConfigurationError(): string | null {
    if (this.isConfigured()) {
      return null;
    }
    return 'Robot AI is not configured. Set AI_ROBOT_API_KEY, AI_ROBOT_BASE_URL and AI_ROBOT_MODEL_ID.';
  }

  async decideAction(params: {
    context: RobotTurnContext;
    validateAction: (candidate: RobotActionCandidate) => RobotActionValidation;
  }): Promise<RobotActionDecision> {
    const configError = this.getConfigurationError();
    if (configError) {
      throw new Error(configError);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ToolLoopAgent, stepCountIs, tool, jsonSchema, Output } =
      require('ai');

    const maxAgentSteps = Math.max(
      2,
      params.context.constraints.maxAgentSteps || 6,
    );
    const maxToolRetries = Math.max(
      1,
      params.context.constraints.toolRetryLimit || 4,
    );

    const apiMode = this.getApiMode();
    const model = this.createConfiguredModel('robot');
    const maxProviderAttempts = apiMode === 'responses' ? 3 : 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxProviderAttempts; attempt += 1) {
      let finalizedAction: RobotActionDecision | null = null;
      let latestValidAction: RobotActionCandidate | null = null;
      let retryCount = 0;

      const agent = new ToolLoopAgent({
        model,
        instructions: ROBOT_SYSTEM_PROMPT,
        // Structured output finalization can consume one extra step.
        stopWhen: stepCountIs(maxAgentSteps + 1),
        output: Output.object({
          schema: ACTION_OUTPUT_SCHEMA,
        }),
        ...(apiMode === 'responses'
          ? {}
          : { temperature: Number(process.env.AI_ROBOT_TEMPERATURE || '0.3') }),
        tools: {
          attempt_action: tool({
            description:
              'Propose an action candidate. Returns whether it is legal and, when invalid, why.',
            inputSchema: jsonSchema(ACTION_INPUT_SCHEMA),
            execute: async (input: RobotActionCandidate) => {
              const candidate = this.normalizeAction(input);
              const validation = params.validateAction(candidate);
              if (validation.valid) {
                latestValidAction = candidate;
                return {
                  ok: true,
                  candidate,
                };
              }

              retryCount += 1;
              return {
                ok: false,
                reason: validation.reason || 'Invalid action',
                legalActions:
                  validation.legalActions || params.context.legalActions,
                retriesRemaining: Math.max(0, maxToolRetries - retryCount),
              };
            },
          }),
        },
      });

      let result:
        | {
            output?: RobotActionCandidate;
          }
        | undefined;

      try {
        result = await agent.generate({
          prompt: this.buildTurnPrompt(params.context),
        });
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error(String(error));
        lastError = normalizedError;
        const isTransientRetryable = this.isTransientResponsesError(
          apiMode,
          normalizedError,
        );

        if (attempt < maxProviderAttempts && isTransientRetryable) {
          this.logger.warn(
            `Robot responses attempt ${attempt} failed with transient parse error; retrying`,
          );
          continue;
        }

        throw new RobotDecisionError(
          isTransientRetryable ? 'exhausted-retries' : 'provider-error',
          isTransientRetryable
            ? 'Robot agent exhausted retries without a legal action'
            : normalizedError.message || 'Robot provider request failed',
          retryCount,
        );
      }

      const outputCandidate = result?.output
        ? this.normalizeAction(result.output)
        : null;
      if (outputCandidate) {
        const validation = params.validateAction(outputCandidate);
        if (validation.valid) {
          finalizedAction = {
            ...outputCandidate,
            persistedDecision: {
              source: 'provider-output',
              summary: this.buildProviderOutputSummary(retryCount),
              validationRetryCount: retryCount,
            },
          };
        } else {
          lastError = new RobotDecisionError(
            'invalid-final-action',
            validation.reason || 'Robot agent produced an invalid final action',
            retryCount,
          );
        }
      }

      if (finalizedAction) {
        return finalizedAction;
      }
      if (latestValidAction) {
        return {
          ...latestValidAction,
          persistedDecision: {
            source: 'validated-tool-loop',
            summary: this.buildValidatedToolLoopSummary(lastError, retryCount),
            validationRetryCount: retryCount,
          },
        };
      }
      if (lastError && attempt < maxProviderAttempts) {
        continue;
      }
    }

    if (lastError instanceof RobotDecisionError) {
      throw lastError;
    }
    if (lastError) {
      throw new RobotDecisionError(
        'provider-error',
        lastError.message || 'Robot provider request failed',
        0,
      );
    }
    throw new RobotDecisionError(
      'exhausted-retries',
      'Robot agent exhausted retries without a legal action',
      0,
    );
  }

  createConfiguredModel(providerNamePrefix: string) {
    const baseURL = process.env.AI_ROBOT_BASE_URL!.trim();
    const apiKey = process.env.AI_ROBOT_API_KEY!.trim();
    const modelId = process.env.AI_ROBOT_MODEL_ID!.trim();
    const apiMode = this.getApiMode();

    if (apiMode === 'responses') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createOpenAI } = require('@ai-sdk/openai');
      const provider = createOpenAI({
        name: `${providerNamePrefix}-openai-responses`,
        baseURL,
        apiKey,
        fetch: createResponsesCompatFetch(),
      });
      return provider.responses(modelId);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
    const provider = createOpenAICompatible({
      name: `${providerNamePrefix}-openai-compatible`,
      baseURL,
      apiKey,
    });
    return provider.chatModel(modelId);
  }

  getApiMode(): 'chat' | 'responses' {
    return (process.env.AI_ROBOT_API_MODE || 'chat').trim() === 'responses'
      ? 'responses'
      : 'chat';
  }

  private isTransientResponsesError(
    apiMode: 'chat' | 'responses',
    error: Error,
  ): boolean {
    return apiMode === 'responses' && error.message.includes('Invalid JSON response');
  }

  private buildTurnPrompt(context: RobotTurnContext): string {
    return [
      'Turn context JSON follows.',
      'Use attempt_action to validate candidates, then return the final legal action as structured output.',
      'Never use hidden information.',
      JSON.stringify(context),
    ].join('\n\n');
  }

  private normalizeAction(
    candidate: RobotActionCandidate,
  ): RobotActionCandidate {
    if (candidate.action !== 'raise') {
      return { action: candidate.action };
    }

    const amount = Number(candidate.amount || 0);
    return {
      action: 'raise',
      amount: Number.isFinite(amount) ? Math.max(1, Math.floor(amount)) : 1,
    };
  }

  private buildProviderOutputSummary(retryCount: number): string {
    return retryCount > 0
      ? `Provider final output accepted after ${retryCount} validation ${retryCount === 1 ? 'retry' : 'retries'}.`
      : 'Provider final output accepted.';
  }

  private buildValidatedToolLoopSummary(
    lastError: Error | null,
    retryCount: number,
  ): string {
    const retrySummary =
      retryCount > 0
        ? ` with ${retryCount} validation ${retryCount === 1 ? 'retry' : 'retries'}`
        : '';
    if (lastError instanceof RobotDecisionError) {
      switch (lastError.code) {
        case 'invalid-final-action':
          return `Used latest validated tool-loop action after invalid final output${retrySummary}.`;
        case 'provider-error':
          return `Used latest validated tool-loop action after provider finalization failed${retrySummary}.`;
        case 'exhausted-retries':
          return `Used latest validated tool-loop action after retry exhaustion${retrySummary}.`;
      }
    }
    return `Used latest validated tool-loop action${retrySummary}.`;
  }
}

export function toRobotFallbackCause(
  error: unknown,
): PersistedRobotFallbackCause {
  if (error instanceof RobotDecisionError) {
    switch (error.code) {
      case 'provider-error':
        return 'provider-error';
      case 'invalid-final-action':
        return 'invalid-final-action';
      case 'exhausted-retries':
        return 'exhausted-retries';
    }
  }
  return 'provider-error';
}
