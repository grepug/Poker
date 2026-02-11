import type { Meta, StoryObj } from "@storybook/react-vite";
import { RulesModal } from "@/components/poker/rules-modal";
import {
  rankingRowsFixture,
  rulesCopyFixture,
  storyTranslate,
} from "@/components/poker/storybook-fixtures";

const meta = {
  title: "Poker/RulesModal",
  component: RulesModal,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    rulesCopy: rulesCopyFixture,
    rankingRows: rankingRowsFixture,
    onClose: () => {},
    t: storyTranslate,
  },
} satisfies Meta<typeof RulesModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

