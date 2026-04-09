import type { Meta, StoryObj } from "@storybook/react-vite";
import { FinalSummaryModal } from "@/components/poker/final-summary-modal";
import {
  finalGameResultFixture,
  finalStandingsFixture,
  finalSummaryCardsFixture,
  storyTranslate,
} from "@/components/poker/storybook-fixtures";

const meta = {
  title: "Poker/FinalSummaryModal",
  component: FinalSummaryModal,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    finalGameResult: finalGameResultFixture,
    finalSummaryCards: finalSummaryCardsFixture,
    finalStandings: finalStandingsFixture,
    currentPlayerId: "p1",
    isGameEnded: false,
    onExportHistory: () => {},
    isExportingHistory: false,
    onOpenSavedHistory: () => {},
    onSaveScreenshot: () => {},
    onLeave: () => {},
    onClose: () => {},
    t: storyTranslate,
  },
} satisfies Meta<typeof FinalSummaryModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveRoom: Story = {};

export const GameEnded: Story = {
  args: {
    isGameEnded: true,
  },
};
