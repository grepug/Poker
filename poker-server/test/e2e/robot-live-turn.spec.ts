import { test, expect, Page } from '@playwright/test';
import {
  authenticateTestUser,
  waitForPokerDebug,
} from './helpers/persistence-e2e.helpers';

const liveRobotConfigured = Boolean(
  process.env.AI_ROBOT_API_KEY?.trim() &&
    process.env.AI_ROBOT_BASE_URL?.trim() &&
    process.env.AI_ROBOT_MODEL_ID?.trim(),
);

async function createRoomViaSocket(page: Page, playerName: string) {
  await waitForPokerDebug(page);
  await page.evaluate(async (requestedName) => {
    const socket = (window as any).pokerDebug?.getSocket?.();
    if (!socket) {
      throw new Error('Unable to create room: socket unavailable');
    }

    await new Promise<void>((resolve, reject) => {
      socket.emit(
        'CREATE_ROOM',
        { playerName: requestedName },
        (response: { success?: boolean; error?: string }) => {
          if (response?.success) {
            resolve();
            return;
          }

          reject(new Error(response?.error || 'Unknown CREATE_ROOM failure'));
        },
      );
    });
  }, playerName);

  await page.waitForSelector('[data-testid="room-title"]');
}

async function setTestDeckForCurrentRoom(
  page: Page,
  deck: Array<{ suit: string; rank: string }>,
) {
  await waitForPokerDebug(page);
  await page.evaluate(async (testDeck) => {
    const pokerDebug = (window as any).pokerDebug;
    const roomId = pokerDebug?.getRoom?.()?.id;
    const socket = pokerDebug?.getSocket?.();

    if (!roomId || !socket) {
      throw new Error('Unable to set test deck: room/socket unavailable');
    }

    await new Promise<void>((resolve, reject) => {
      socket.emit(
        'setTestDeck',
        { roomId, deck: testDeck },
        (response: { success: boolean; error?: string }) => {
          if (response?.success) {
            resolve();
            return;
          }

          reject(
            new Error(response?.error || 'Unknown setTestDeck failure from server'),
          );
        },
      );
    });
  }, deck);
}

async function playSafeHumanAction(page: Page) {
  const checkButton = page.locator('[data-testid="action-check"]');
  if ((await checkButton.count()) > 0 && (await checkButton.first().isVisible())) {
    await checkButton.first().click();
    return;
  }

  const callButton = page.locator('[data-testid="action-call"]');
  if ((await callButton.count()) > 0 && (await callButton.first().isVisible())) {
    await callButton.first().click();
    return;
  }

  throw new Error('No safe human action available to hand control to the robot');
}

async function waitForRobotProgress(
  page: Page,
  params: {
    robotId: string;
    baselineActionId: string | null;
    baselineCurrentBet: number;
    timeout: number;
  },
) {
  await page.waitForFunction(
    ({ robotId, baselineActionId, baselineCurrentBet }) => {
      const pokerDebug = (window as any).pokerDebug;
      const room = pokerDebug?.getRoom?.();
      const event = pokerDebug?.getLastPlayerActionEvent?.();
      const robot = (room?.players ?? []).find(
        (player: any) => player.id === robotId,
      );

      if (!robot || !room?.currentHand) {
        return false;
      }

      const actionEventChanged =
        !!event && event.playerId === robotId && event.id !== baselineActionId;
      const robotStateChanged =
        robot.lastAction !== null || robot.currentBet !== baselineCurrentBet;
      const turnMovedAway = room.currentHand.currentPlayerTurn !== robotId;

      return actionEventChanged || (robotStateChanged && turnMovedAway);
    },
    params,
    { timeout: params.timeout },
  );
}

async function installRobotShowdownStores(page: Page) {
  await waitForPokerDebug(page);
  await page.evaluate(() => {
    const socket = (window as any).pokerDebug?.getSocket?.();
    if (!socket) {
      throw new Error('Unable to observe robot showdown: socket unavailable');
    }

    const showdownStore = ((window as any).__liveRobotShowdownStore ??= {
      attached: false,
      events: [] as any[],
    });
    if (!showdownStore.attached) {
      socket.on('SHOWDOWN_DECISION_STATE', (payload: any) => {
        showdownStore.events.push(payload);
      });
      showdownStore.attached = true;
    }

    const handCompleteStore = ((window as any).__liveRobotHandCompleteStore ??= {
      attached: false,
      events: [] as any[],
    });
    if (!handCompleteStore.attached) {
      socket.on('HAND_COMPLETE', (payload: any) => {
        handCompleteStore.events.push(payload?.result ?? payload);
      });
      handCompleteStore.attached = true;
    }
  });
}

async function hasVisibleButton(page: Page, testId: string) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  return (
    (await locator.count()) > 0 &&
    (await locator.first().isVisible().catch(() => false))
  );
}

async function getHandSnapshot(page: Page) {
  return page.evaluate(() => {
    const room = (window as any).pokerDebug?.getRoom?.();
    const hand = room?.currentHand;
    return {
      handNumber: hand?.handNumber ?? null,
      bettingRound: hand?.bettingRound ?? null,
      currentPlayerTurn: hand?.currentPlayerTurn ?? null,
      showdownDecisionPlayerId: hand?.showdownDecisionPlayerId ?? null,
      pendingStreetRevealRound: hand?.pendingStreetRevealRound ?? null,
      revealedPlayerIds: hand?.revealedPlayerIds ?? [],
      handCompleteEvents:
        (window as any).__liveRobotHandCompleteStore?.events ?? [],
      showdownEvents: (window as any).__liveRobotShowdownStore?.events ?? [],
    };
  });
}

test.describe('Poker E2E - Live Robot Turn', () => {
  test.skip(
    !liveRobotConfigured,
    'Live robot provider env is required for live robot e2e',
  );

  test('robot completes a provider-backed turn in a real browser game', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();

    try {
      await authenticateTestUser(hostPage, 'test1', {
        displayName: 'Alice',
        avatarEmoji: '🦊',
      });
      await createRoomViaSocket(hostPage, 'Alice');
      await setTestDeckForCurrentRoom(hostPage, [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'clubs' },
        { rank: 'Q', suit: 'hearts' },
        { rank: '7', suit: 'diamonds' },
        { rank: '2', suit: 'clubs' },
        { rank: '9', suit: 'spades' },
        { rank: '4', suit: 'hearts' },
        { rank: 'J', suit: 'diamonds' },
        { rank: '3', suit: 'spades' },
        { rank: '8', suit: 'clubs' },
        { rank: '5', suit: 'diamonds' },
      ]);

      await hostPage.click('[data-testid="add-robot-button"]');
      await hostPage.waitForFunction(
        () =>
          ((window as any).pokerDebug?.getRoom?.()?.players ?? []).some(
            (player: any) => player.isRobot && player.status !== 'left',
          ),
        { timeout: 10000 },
      );

      const identities = await hostPage.evaluate(() => {
        const pokerDebug = (window as any).pokerDebug;
        const room = pokerDebug?.getRoom?.();
        const player = pokerDebug?.getPlayer?.();
        const robot = (room?.players ?? []).find(
          (candidate: any) => candidate.isRobot && candidate.status !== 'left',
        );
        return {
          playerId: player?.id ?? null,
          robotId: robot?.id ?? null,
        };
      });

      expect(identities.robotId).toBeTruthy();
      expect(identities.playerId).toBeTruthy();

      await hostPage.click('[data-testid="start-game-button"]');
      await hostPage.waitForSelector('[data-testid="round-value"]', {
        timeout: 15000,
      });

      const baselineActionId = await hostPage.evaluate(
        () => window.pokerDebug?.getLastPlayerActionEvent?.()?.id ?? null,
      );
      const baselineRobotState = await hostPage.evaluate((robotId) => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const robot = (room?.players ?? []).find(
          (candidate: any) => candidate.id === robotId,
        );
        return {
          currentBet: robot?.currentBet ?? null,
          currentPlayerTurn: room?.currentHand?.currentPlayerTurn ?? null,
        };
      }, identities.robotId);

      expect(baselineRobotState.currentBet).not.toBeNull();

      try {
        await waitForRobotProgress(hostPage, {
          robotId: identities.robotId!,
          baselineActionId,
          baselineCurrentBet: baselineRobotState.currentBet,
          timeout: 25000,
        });
      } catch {
        const isHumanTurn = await hostPage.evaluate(
          (playerId) =>
            (window as any).pokerDebug?.getRoom?.()?.currentHand?.currentPlayerTurn ===
            playerId,
          identities.playerId,
        );

        expect(
          isHumanTurn,
          'Robot did not act within the initial window and the hand did not return to the human turn',
        ).toBe(true);
        await playSafeHumanAction(hostPage);

        await waitForRobotProgress(hostPage, {
          robotId: identities.robotId!,
          baselineActionId,
          baselineCurrentBet: baselineRobotState.currentBet,
          timeout: 25000,
        });
      }

      const robotAction = await hostPage.evaluate(() => {
        const event = (window as any).pokerDebug?.getLastPlayerActionEvent?.();
        const room = (window as any).pokerDebug?.getRoom?.();
        return {
          event,
          currentPlayerTurn: room?.currentHand?.currentPlayerTurn ?? null,
          bettingRound: room?.currentHand?.bettingRound ?? null,
        };
      });

      expect(robotAction.event).toEqual(
        expect.objectContaining({
          playerId: identities.robotId,
          action: expect.stringMatching(/fold|check|call|raise|all-in/),
        }),
      );
      expect(robotAction.currentPlayerTurn).not.toBe(identities.robotId);
      expect(robotAction.bettingRound).toBeTruthy();
    } finally {
      await hostContext.close();
    }
  });

  test('robot showdown decisions do not stall when the robot is not forced all-in', async ({
    browser,
  }) => {
    test.setTimeout(120000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();

    try {
      await authenticateTestUser(hostPage, 'test1', {
        displayName: 'Alice',
        avatarEmoji: '🐺',
      });
      await createRoomViaSocket(hostPage, 'Alice');
      await installRobotShowdownStores(hostPage);
      await setTestDeckForCurrentRoom(hostPage, [
        { rank: '7', suit: 'diamonds' },
        { rank: 'A', suit: 'spades' },
        { rank: '5', suit: 'clubs' },
        { rank: 'A', suit: 'hearts' },
        { rank: '2', suit: 'clubs' },
        { rank: '9', suit: 'spades' },
        { rank: '4', suit: 'hearts' },
        { rank: 'J', suit: 'diamonds' },
        { rank: '3', suit: 'spades' },
        { rank: '8', suit: 'clubs' },
        { rank: '6', suit: 'diamonds' },
      ]);

      await hostPage.click('[data-testid="add-robot-button"]');
      await hostPage.waitForFunction(
        () =>
          ((window as any).pokerDebug?.getRoom?.()?.players ?? []).some(
            (player: any) => player.isRobot && player.status !== 'left',
          ),
        { timeout: 10000 },
      );

      const identities = await hostPage.evaluate(() => {
        const pokerDebug = (window as any).pokerDebug;
        const room = pokerDebug?.getRoom?.();
        const player = pokerDebug?.getPlayer?.();
        const robot = (room?.players ?? []).find(
          (candidate: any) => candidate.isRobot && candidate.status !== 'left',
        );
        return {
          playerId: player?.id ?? null,
          robotId: robot?.id ?? null,
        };
      });

      expect(identities.robotId).toBeTruthy();
      expect(identities.playerId).toBeTruthy();

      await hostPage.click('[data-testid="start-game-button"]');
      await hostPage.waitForSelector('[data-testid="round-value"]', {
        timeout: 15000,
      });

      const startedAt = Date.now();
      let result: any = null;
      while (Date.now() - startedAt < 90000) {
        const state = await getHandSnapshot(hostPage);
        if (state.handCompleteEvents.length > 0) {
          result = state.handCompleteEvents[state.handCompleteEvents.length - 1];
          break;
        }

        if (state.pendingStreetRevealRound === 'SHOWDOWN') {
          if (await hasVisibleButton(hostPage, 'reveal-next-street-button')) {
            await hostPage.click('[data-testid="reveal-next-street-button"]');
          }
        } else if (
          state.bettingRound === 'SHOWDOWN' &&
          (await hasVisibleButton(hostPage, 'show-my-hand-button'))
        ) {
          await hostPage.click('[data-testid="show-my-hand-button"]');
        } else if (state.currentPlayerTurn === identities.playerId) {
          await playSafeHumanAction(hostPage);
        }

        await hostPage.waitForTimeout(200);
      }

      expect(result, 'Live robot showdown hand did not complete').toBeTruthy();

      const finalState = await getHandSnapshot(hostPage);
      const sawNonForcedRobotShowdownActor = finalState.showdownEvents.some(
        (event: any) =>
          event.currentPlayerId === identities.robotId &&
          !((event.forcedRevealPlayerIds ?? []) as string[]).includes(
            identities.robotId!,
          ),
      );

      expect(
        sawNonForcedRobotShowdownActor,
        'Expected a non-forced robot showdown actor during the live hand',
      ).toBe(true);
      expect(result.playerHands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            playerId: identities.robotId,
            cardsVisibility: 'shown',
          }),
        ]),
      );
    } finally {
      await hostContext.close();
    }
  });
});

declare global {
  interface Window {
    pokerDebug: {
      getRoom: () => any;
      getPlayer: () => any;
      getLastPlayerActionEvent: () => any;
      getSocket: () => {
        emit: (
          event: string,
          data: any,
          callback: (response: { success?: boolean; error?: string }) => void,
        ) => void;
        on: (event: string, handler: (payload: any) => void) => void;
      };
    };
    __liveRobotShowdownStore?: {
      attached: boolean;
      events: any[];
    };
    __liveRobotHandCompleteStore?: {
      attached: boolean;
      events: any[];
    };
  }
}
