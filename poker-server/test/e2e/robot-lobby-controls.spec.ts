import { test, expect, Page } from '@playwright/test';
import {
  authenticateTestUser,
  waitForPokerDebug,
} from './helpers/persistence-e2e.helpers';

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
