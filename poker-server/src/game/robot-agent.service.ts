import { Injectable, Logger } from '@nestjs/common';
import { PlayerAction } from 'poker-types';
import { z } from 'zod';
import {
  createVolcengineResponsesCompatFetch,
  isVolcengineResponsesBaseUrl,
} from './openai-responses-compat';

export type RobotActionCandidate = {
  action: PlayerAction;
  amount?: number;
};

export type RobotActionValidation = {
  valid: boolean;
  reason?: string;
  legalActions?: Record<string, unknown>;
};

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
  }): Promise<RobotActionCandidate> {
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
    const model = this.createModel();
    const maxProviderAttempts = apiMode === 'responses' ? 3 : 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxProviderAttempts; attempt += 1) {
      let finalizedAction: RobotActionCandidate | null = null;
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

        if (
          attempt < maxProviderAttempts &&
          this.isTransientResponsesError(apiMode, normalizedError)
        ) {
          this.logger.warn(
            `Robot responses attempt ${attempt} failed with transient parse error; retrying`,
          );
          continue;
        }

        throw normalizedError;
      }

      const outputCandidate = result?.output
        ? this.normalizeAction(result.output)
        : null;
      if (outputCandidate) {
        const validation = params.validateAction(outputCandidate);
        if (validation.valid) {
          finalizedAction = outputCandidate;
        } else {
          lastError = new Error(
            validation.reason || 'Robot agent produced an invalid final action',
          );
        }
      }

      if (finalizedAction) {
        return finalizedAction;
      }
      if (latestValidAction) {
        return latestValidAction;
      }
      if (lastError && attempt < maxProviderAttempts) {
        continue;
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new Error('Robot agent failed to produce a legal action');
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
        name: 'robot-openai-responses',
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
      name: 'robot-openai-compatible',
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
}
