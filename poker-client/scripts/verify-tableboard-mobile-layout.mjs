import process from 'node:process';
import { chromium } from '../../poker-server/node_modules/@playwright/test/index.mjs';

const STORYBOOK_URL = process.env.STORYBOOK_URL ?? 'http://localhost:6007';
const STORIES = [
  {
    label: 'eight-handed-mobile',
    path: '/?path=/story/poker-tableboard--eight-handed-status-mobile-portrait-393-x-852',
    minSideGapPx: 8,
    maxSideGapPx: 10,
    maxSideBiasedGapPx: 10,
    minTopBottomGapPx: 7,
    maxTopBottomGapPx: 9,
    minSeatWidthPx: 68,
  },
  {
    label: 'ten-handed-mobile',
    path: '/?path=/story/poker-tableboard--ten-handed-status-mobile-portrait-393-x-852',
    minSideGapPx: 7.5,
    maxSideGapPx: 8.5,
    maxSideBiasedGapPx: 13.5,
    minTopBottomGapPx: 7.5,
    maxTopBottomGapPx: 8.5,
    minSeatWidthPx: 66,
  },
];

const measureStory = async (page, story) => {
  await page.goto(`${STORYBOOK_URL}${story.path}`, {
    waitUntil: 'domcontentloaded',
  });
  const frame = page.frameLocator('#storybook-preview-iframe');
  await frame.locator('.felt-oval').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);

  return frame.locator('.felt-oval').evaluate((feltNode) => {
    const feltRect = feltNode.getBoundingClientRect();
    const seatRects = Array.from(
      document.querySelectorAll('.seat-pod[data-testid^="player-seat-"]'),
    ).map((seatNode) => {
      const rect = seatNode.getBoundingClientRect();
      const centerX = rect.left - feltRect.left + rect.width / 2;
      const centerY = rect.top - feltRect.top + rect.height / 2;
      const offsetX = centerX - feltRect.width / 2;
      const offsetY = centerY - feltRect.height / 2;
      const sideGap = offsetX < 0 ? rect.left - feltRect.left : feltRect.right - rect.right;
      return {
        id: seatNode.getAttribute('data-testid') ?? 'unknown-seat',
        leftGap: rect.left - feltRect.left,
        rightGap: feltRect.right - rect.right,
        topGap: rect.top - feltRect.top,
        bottomGap: feltRect.bottom - rect.bottom,
        width: rect.width,
        sideGap,
        isSideBiased: Math.abs(offsetX) >= Math.abs(offsetY) * 0.45,
      };
    });

    const sideGaps = seatRects.flatMap((seatRect) => [
      seatRect.leftGap,
      seatRect.rightGap,
    ]);
    const sideBiasedSeatGaps = seatRects
      .filter((seatRect) => seatRect.isSideBiased)
      .map((seatRect) => seatRect.sideGap);

    return {
      seatCount: seatRects.length,
      minSideGapPx: Math.min(...sideGaps),
      maxSideGapPx: Math.max(...sideGaps),
      maxSideBiasedGapPx:
        sideBiasedSeatGaps.length > 0
          ? Math.max(...sideBiasedSeatGaps)
          : 0,
      minSeatWidthPx: Math.min(...seatRects.map((seatRect) => seatRect.width)),
      topBottomGapPx: Math.min(
        ...seatRects.flatMap((seatRect) => [seatRect.topGap, seatRect.bottomGap]),
      ),
      seats: seatRects.map((seatRect) => ({
        id: seatRect.id,
        leftGap: Number(seatRect.leftGap.toFixed(2)),
        rightGap: Number(seatRect.rightGap.toFixed(2)),
        sideGap: Number(seatRect.sideGap.toFixed(2)),
        isSideBiased: seatRect.isSideBiased,
        width: Number(seatRect.width.toFixed(2)),
      })),
    };
  });
};

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
  });

  for (const story of STORIES) {
    const metrics = await measureStory(page, story);
    console.log(
      JSON.stringify(
        {
          label: story.label,
          metrics: {
            ...metrics,
            minSideGapPx: Number(metrics.minSideGapPx.toFixed(2)),
            maxSideGapPx: Number(metrics.maxSideGapPx.toFixed(2)),
            maxSideBiasedGapPx: Number(metrics.maxSideBiasedGapPx.toFixed(2)),
            minSeatWidthPx: Number(metrics.minSeatWidthPx.toFixed(2)),
            topBottomGapPx: Number(metrics.topBottomGapPx.toFixed(2)),
          },
        },
        null,
        2,
      ),
    );

    if (metrics.seatCount < 8) {
      throw new Error(
        `[${story.label}] expected at least 8 seats but found ${metrics.seatCount}`,
      );
    }
    if (metrics.minSideGapPx < story.minSideGapPx) {
      throw new Error(
        `[${story.label}] min side gap ${metrics.minSideGapPx.toFixed(2)} is below ${story.minSideGapPx}px`,
      );
    }
    if (metrics.minSideGapPx > story.maxSideGapPx) {
      throw new Error(
        `[${story.label}] min side gap ${metrics.minSideGapPx.toFixed(2)} is above ${story.maxSideGapPx}px`,
      );
    }
    if (metrics.maxSideBiasedGapPx > story.maxSideBiasedGapPx) {
      throw new Error(
        `[${story.label}] side-biased gap ${metrics.maxSideBiasedGapPx.toFixed(2)} is above ${story.maxSideBiasedGapPx}px`,
      );
    }
    if (metrics.topBottomGapPx < story.minTopBottomGapPx) {
      throw new Error(
        `[${story.label}] top/bottom gap ${metrics.topBottomGapPx.toFixed(2)} is below ${story.minTopBottomGapPx}px`,
      );
    }
    if (metrics.topBottomGapPx > story.maxTopBottomGapPx) {
      throw new Error(
        `[${story.label}] top/bottom gap ${metrics.topBottomGapPx.toFixed(2)} is above ${story.maxTopBottomGapPx}px`,
      );
    }
    if (metrics.minSeatWidthPx < story.minSeatWidthPx) {
      throw new Error(
        `[${story.label}] min seat width ${metrics.minSeatWidthPx.toFixed(2)} is below ${story.minSeatWidthPx}px`,
      );
    }
  }

  await page.close();
} finally {
  await browser.close();
}
