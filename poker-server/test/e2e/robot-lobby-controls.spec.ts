import { test, expect, Page } from '@playwright/test';

const FRONTEND_URL =
  process.env.PW_FRONTEND_URL ??
  `http://${process.env.PW_FRONTEND_HOST ?? 'localhost'}:${process.env.PW_FRONTEND_PORT ?? '5174'}`;
const BACKEND_URL =
  process.env.PW_BACKEND_URL ??
  `http://${process.env.PW_BACKEND_HOST ?? 'localhost'}:${process.env.PW_BACKEND_PORT ?? '3001'}`;
const DEFAULT_TEST_PASSWORD = 'test1234';

async function waitForPokerDebug(page: Page) {
  await page.waitForFunction(() => window.pokerDebug !== undefined, {
    timeout: 5000,
  });
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

async function authenticateTestUser(
  page: Page,
  accountId: string,
  profile: { displayName: string; avatarEmoji?: string },
) {
  await page.goto(FRONTEND_URL);

  const avatarEmoji = profile.avatarEmoji ?? '🙂';
  await page.evaluate(
    async ({
      backendOrigin,
      loginAccountId,
      password,
      displayName,
      avatar,
    }) => {
      const loginResponse = await fetch(
        `${backendOrigin}/api/auth/password/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: loginAccountId,
            password,
          }),
        },
      );

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

      const profileResponse = await fetch(
        `${backendOrigin}/api/auth/me/profile`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${loginPayload.sessionToken}`,
          },
          body: JSON.stringify({
            displayName,
            avatarEmoji: avatar,
          }),
        },
      );
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

test.describe('Poker E2E - Robot Lobby Controls', () => {
  test('host can add and remove a robot from the pre-game bottom bar', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();

    try {
      await authenticateTestUser(hostPage, 'test1', {
        displayName: 'Alice',
        avatarEmoji: '🙂',
      });
      await createRoomViaSocket(hostPage, 'Alice');

      await expect(
        hostPage.locator('[data-testid="ready-action-area"]'),
      ).toBeVisible();
      await expect(
        hostPage.locator('[data-testid="add-robot-button"]'),
      ).toBeVisible();
      await expect(
        hostPage.locator('[data-testid="robot-empty-state"]'),
      ).toBeVisible();

      await hostPage.click('[data-testid="add-robot-button"]');
      await hostPage.waitForFunction(
        () =>
          ((window as any).pokerDebug?.getRoom?.()?.players ?? []).some(
            (player: any) => player.isRobot && player.status !== 'left',
          ),
        { timeout: 10000 },
      );

      const robot = await hostPage.evaluate(() => {
        const players = (window as any).pokerDebug?.getRoom?.()?.players ?? [];
        const seat = players.find(
          (player: any) => player.isRobot && player.status !== 'left',
        );
        return seat ? { id: seat.id, name: seat.name } : null;
      });

      expect(robot).not.toBeNull();
      if (!robot) {
        throw new Error('Robot was not added to room state');
      }

      await expect(
        hostPage.locator(`[data-testid="robot-item-${robot.id}"]`),
      ).toContainText(robot.name);
      await expect(
        hostPage.locator('[data-testid="start-game-button"]'),
      ).toBeEnabled();

      await hostPage.click(`[data-testid="remove-robot-${robot.id}"]`);
      await hostPage.waitForFunction(
        (robotId) =>
          !((window as any).pokerDebug?.getRoom?.()?.players ?? []).some(
            (player: any) => player.id === robotId && player.status !== 'left',
          ),
        robot.id,
        { timeout: 10000 },
      );

      await expect(
        hostPage.locator('[data-testid="robot-empty-state"]'),
      ).toBeVisible();
      await expect(
        hostPage.locator('[data-testid="start-game-button"]'),
      ).toBeDisabled();
    } finally {
      await hostContext.close();
    }
  });
});

declare global {
  interface Window {
    pokerDebug: {
      getRoom: () => any;
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
