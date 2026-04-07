import { test, expect, Page } from '@playwright/test';

const FRONTEND_URL =
  process.env.PW_FRONTEND_URL ??
  `http://${process.env.PW_FRONTEND_HOST ?? 'localhost'}:${process.env.PW_FRONTEND_PORT ?? '5174'}`;
const BACKEND_URL =
  process.env.PW_BACKEND_URL ??
  `http://${process.env.PW_BACKEND_HOST ?? 'localhost'}:${process.env.PW_BACKEND_PORT ?? '3001'}`;
const DEFAULT_TEST_PASSWORD = 'test1234';
const liveRobotConfigured = Boolean(
  process.env.AI_ROBOT_API_KEY?.trim() &&
    process.env.AI_ROBOT_BASE_URL?.trim() &&
    process.env.AI_ROBOT_MODEL_ID?.trim(),
);

async function waitForPokerDebug(page: Page) {
  await page.waitForFunction(() => window.pokerDebug !== undefined, {
    timeout: 5000,
  });
}

async function authenticateTestUser(
  page: Page,
  accountId: string,
  profile: { displayName: string; avatarEmoji?: string },
) {
  await page.goto(FRONTEND_URL);

  const avatarEmoji = profile.avatarEmoji ?? '🙂';
  await page.evaluate(
    async ({ backendOrigin, loginAccountId, password, displayName, avatar }) => {
      const loginResponse = await fetch(`${backendOrigin}/api/auth/password/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: loginAccountId,
          password,
        }),
      });

      const loginPayload = (await loginResponse.json()) as {
        sessionToken?: string;
        message?: string;
        error?: string;
      };
      if (!loginResponse.ok || !loginPayload.sessionToken) {
        throw new Error(
          loginPayload.message ||
            loginPayload.error ||
            `login failed (${loginResponse.status})`,
        );
      }

      window.localStorage.setItem('poker.authToken', loginPayload.sessionToken);

      const profileResponse = await fetch(`${backendOrigin}/api/auth/me/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginPayload.sessionToken}`,
        },
        body: JSON.stringify({
          displayName,
          avatarEmoji: avatar,
        }),
      });
      if (!profileResponse.ok) {
        const profilePayload = (await profileResponse.json()) as {
          message?: string;
          error?: string;
        };
        throw new Error(
          profilePayload.message ||
            profilePayload.error ||
            `profile update failed (${profileResponse.status})`,
        );
      }
    },
    {
      backendOrigin: BACKEND_URL,
      loginAccountId: accountId,
      password: DEFAULT_TEST_PASSWORD,
      displayName: profile.displayName,
      avatar: avatarEmoji,
    },
  );

  await page.goto(FRONTEND_URL);
  await page.waitForSelector('[data-testid="connection-status"]');
  await expect(page.locator('[data-testid="connection-status"]')).toContainText(
    'Connected',
  );
}

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
      };
    };
  }
}
