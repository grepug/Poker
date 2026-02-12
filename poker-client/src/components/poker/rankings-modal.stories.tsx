import type { Meta, StoryObj } from "@storybook/react-vite";
import { RankingsModal } from "@/components/poker/rankings-modal";
import { playerRankingsFixture, storyTranslate } from "@/components/poker/storybook-fixtures";

const meta = {
  title: "Poker/RankingsModal",
  component: RankingsModal,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    playerRankings: playerRankingsFixture,
    currentPlayerId: "p1",
    onClose: () => {},
    t: storyTranslate,
  },
} satisfies Meta<typeof RankingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

