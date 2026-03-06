import { Injectable, Logger } from '@nestjs/common';
import { PlayerAction } from 'poker-types';

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
4) Call done only with a legal action.
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
    const { ToolLoopAgent, stepCountIs, tool, jsonSchema } = require('ai');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');

    const maxAgentSteps = Math.max(
      2,
      params.context.constraints.maxAgentSteps || 6,
    );
    const maxToolRetries = Math.max(
      1,
      params.context.constraints.toolRetryLimit || 4,
    );

    let finalizedAction: RobotActionCandidate | null = null;
    let latestValidAction: RobotActionCandidate | null = null;
    let retryCount = 0;

    const provider = createOpenAICompatible({
      name: 'robot-openai-compatible',
      baseURL: process.env.AI_ROBOT_BASE_URL!.trim(),
      apiKey: process.env.AI_ROBOT_API_KEY!.trim(),
    });

    const agent = new ToolLoopAgent({
      model: provider.chatModel(process.env.AI_ROBOT_MODEL_ID!.trim()),
      instructions: ROBOT_SYSTEM_PROMPT,
      toolChoice: 'required',
      stopWhen: stepCountIs(maxAgentSteps),
      temperature: Number(process.env.AI_ROBOT_TEMPERATURE || '0.3'),
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
        done: tool({
          description:
            'Finalize turn with a legal action after at least one successful attempt_action.',
          inputSchema: jsonSchema(ACTION_INPUT_SCHEMA),
          execute: async (input: RobotActionCandidate) => {
            const candidate = this.normalizeAction(input);
            const validation = params.validateAction(candidate);
            if (!validation.valid) {
              return {
                ok: false,
                reason: validation.reason || 'Invalid final action',
                legalActions:
                  validation.legalActions || params.context.legalActions,
              };
            }

            finalizedAction = candidate;
            latestValidAction = candidate;
            return { ok: true, finalized: true, candidate };
          },
        }),
      },
    });

    await agent.generate({
      prompt: this.buildTurnPrompt(params.context),
    });

    if (finalizedAction) {
      return finalizedAction;
    }
    if (latestValidAction) {
      return latestValidAction;
    }

    throw new Error('Robot agent failed to produce a legal action');
  }

  private buildTurnPrompt(context: RobotTurnContext): string {
    return [
      'Turn context JSON follows.',
      'Use tools to validate actions and finish with done().',
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
