import { PlayerAction } from 'poker-types';
import {
  RobotAgentService,
  RobotDecisionError,
  type RobotTurnContext,
} from '../../src/game/robot-agent.service';

const mockCreateOpenAI = jest.fn();
const mockCreateOpenAICompatible = jest.fn();
const mockToolLoopAgent = jest.fn();
const mockStepCountIs = jest.fn((count: number) => count);
const mockTool = jest.fn((config) => config);
const mockJsonSchema = jest.fn((schema) => schema);
const mockOutputObject = jest.fn((config) => ({
  name: 'object',
  parseCompleteOutput: jest.fn(),
  parsePartialOutput: jest.fn(),
  createElementStreamTransform: jest.fn(),
  ...config,
}));

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => mockCreateOpenAI(...args),
}));

jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (...args: unknown[]) =>
    mockCreateOpenAICompatible(...args),
}));

jest.mock('ai', () => ({
  ToolLoopAgent: mockToolLoopAgent,
  stepCountIs: (count: number) => mockStepCountIs(count),
  tool: (config: unknown) => mockTool(config),
  jsonSchema: (schema: unknown) => mockJsonSchema(schema),
  Output: {
    object: (config: unknown) => mockOutputObject(config),
  },
}));

describe('RobotAgentService', () => {
  const originalEnv = process.env;

  const createContext = (): RobotTurnContext => ({
    schemaVersion: '1.0' as const,
    roomId: 'ROOM1',
    handNumber: 1,
    nowIso: new Date().toISOString(),
    rules: {
      variant: 'standard' as const,
      smallBlind: 5,
      bigBlind: 10,
      bettingRound: 'FLOP' as const,
      raiseFormat: 'increment_over_call' as const,
    },
    personality: {
      key: 'balanced' as const,
      summary:
        'Mix value betting, pot control, and selective pressure without drifting too passive.',
      tuning: {
        aggression: 52,
        bluff: 34,
        pressure: 48,
        defend: 46,
        jam: 52,
        raiseSizeBias: 'medium' as const,
      },
    },
    hero: {
      playerId: 'robot-1',
      name: 'Robot 1',
      seatPosition: 0,
      chips: 980,
      currentBet: 10,
      status: 'active',
      holeCards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'Q', suit: 'hearts' },
      ],
    },
    table: {
      pot: 35,
      currentBet: 10,
      minRaise: 10,
      communityCards: [
        { rank: 'A', suit: 'clubs' },
        { rank: '7', suit: 'diamonds' },
        { rank: '2', suit: 'hearts' },
      ],
      playersPublic: [
        {
          playerId: 'robot-1',
          name: 'Robot 1',
          seatPosition: 0,
          chips: 980,
          currentBet: 10,
          status: 'active',
          isDealer: true,
          isSmallBlind: false,
          isBigBlind: false,
          lastAction: 'call' as PlayerAction,
        },
      ],
      revealedHoleCardsByPlayerId: {},
    },
    legalActions: {
      fold: { enabled: true },
      check: { enabled: true },
      call: { enabled: false, amountToCall: 0 },
      raise: {
        enabled: true,
        minIncrement: 10,
        maxIncrement: 40,
        suggestedIncrements: [10, 20],
      },
      allIn: { enabled: true, increment: 980 },
    },
    history: {
      recentActions: [],
    },
    constraints: {
      maxAgentSteps: 6,
      toolRetryLimit: 4,
      actionDelayMsMin: 0,
      actionDelayMsMax: 0,
    },
  });

  const validateAction = (candidate: { action: string; amount?: number }) => {
    if (candidate.action === 'raise') {
      return Number.isInteger(candidate.amount) &&
        candidate.amount !== undefined &&
        candidate.amount >= 10 &&
        candidate.amount <= 40
        ? { valid: true }
        : {
            valid: false,
            reason: 'Raise increment must be between 10 and 40',
          };
    }

    return { valid: true };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      AI_ROBOT_API_KEY: 'test-key',
      AI_ROBOT_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3',
      AI_ROBOT_MODEL_ID: 'doubao-seed-2-0-pro-260215',
      AI_ROBOT_API_MODE: 'responses',
    };

    mockCreateOpenAI.mockReturnValue({
      responses: jest.fn().mockReturnValue('responses-model'),
    });
    mockCreateOpenAICompatible.mockReturnValue({
      chatModel: jest.fn().mockReturnValue('chat-model'),
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses structured output with the responses model and returns a validated final action', async () => {
    let capturedConfig: Record<string, unknown> | undefined;
    let capturedPrompt: string | undefined;
    mockToolLoopAgent.mockImplementation((config) => {
      capturedConfig = config;
      return {
        generate: jest.fn().mockImplementation(async ({ prompt }) => {
          capturedPrompt = prompt;
          return {
            output: { action: 'check' },
          };
        }),
      };
    });

    const service = new RobotAgentService();
    const result = await service.decideAction({
      context: createContext(),
      validateAction,
    });

    expect(result).toEqual({
      action: 'check',
      persistedDecision: {
        source: 'provider-output',
        summary: 'Provider final output accepted.',
        validationRetryCount: 0,
      },
    });
    expect(mockStepCountIs).toHaveBeenCalledWith(7);
    expect(mockOutputObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: expect.anything(),
      }),
    );
    expect(capturedConfig).toEqual(
      expect.objectContaining({
        model: 'responses-model',
        output: expect.objectContaining({ name: 'object' }),
      }),
    );
    expect(
      (capturedConfig?.tools as Record<string, unknown>)?.attempt_action,
    ).toBeDefined();
    expect(
      (capturedConfig?.tools as Record<string, unknown>)?.done,
    ).toBeUndefined();
    expect(capturedConfig).not.toHaveProperty('temperature');
    expect(capturedConfig?.instructions).toContain('personality profile');
    expect(capturedPrompt).toContain('"key":"balanced"');
    expect(capturedPrompt).toContain('"raiseSizeBias":"medium"');
    expect(capturedPrompt).toContain('"defend":46');
    expect(capturedPrompt).toContain('"jam":52');
  });

  it('applies responses compatibility fetch for non-Volcengine OpenAI-compatible gateways', () => {
    process.env.AI_ROBOT_BASE_URL = 'https://api.hanbbq.top/v1';

    const responses = jest.fn().mockReturnValue('responses-model');
    mockCreateOpenAI.mockReturnValue({ responses });

    const service = new RobotAgentService();
    const model = service.createConfiguredModel('robot');

    expect(model).toBe('responses-model');
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'robot-openai-responses',
        baseURL: 'https://api.hanbbq.top/v1',
        apiKey: 'test-key',
        fetch: expect.any(Function),
      }),
    );
  });

  it('falls back to the latest validated tool candidate when structured output is invalid', async () => {
    mockToolLoopAgent.mockImplementation((config) => ({
      generate: jest.fn().mockImplementation(async () => {
        const attemptAction = (config.tools as Record<string, any>).attempt_action;
        await attemptAction.execute({ action: 'raise', amount: 999 });
        await attemptAction.execute({ action: 'check' });
        return {
          output: { action: 'raise', amount: 999 },
        };
      }),
    }));

    const service = new RobotAgentService();
    const result = await service.decideAction({
      context: createContext(),
      validateAction,
    });

    expect(result).toEqual({
      action: 'check',
      persistedDecision: {
        source: 'validated-tool-loop',
        summary:
          'Used latest validated tool-loop action after invalid final output with 1 validation retry.',
        validationRetryCount: 1,
      },
    });
  });

  it('throws a normalized error when the provider never produces a legal action', async () => {
    mockToolLoopAgent.mockImplementation(() => ({
      generate: jest.fn().mockResolvedValue({
        output: { action: 'raise', amount: 999 },
      }),
    }));

    const service = new RobotAgentService();

    await expect(
      service.decideAction({
        context: createContext(),
        validateAction,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RobotDecisionError>>({
        name: 'RobotDecisionError',
        code: 'invalid-final-action',
        validationRetryCount: 0,
      }),
    );
  });

  it('normalizes exhausted transient provider retries for fallback handling', async () => {
    mockToolLoopAgent.mockImplementation(() => ({
      generate: jest.fn().mockRejectedValue(new Error('Invalid JSON response')),
    }));

    const service = new RobotAgentService();

    await expect(
      service.decideAction({
        context: createContext(),
        validateAction,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RobotDecisionError>>({
        name: 'RobotDecisionError',
        code: 'exhausted-retries',
        validationRetryCount: 0,
      }),
    );
  });
});
