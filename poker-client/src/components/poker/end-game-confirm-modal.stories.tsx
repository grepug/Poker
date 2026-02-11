import type { Meta, StoryObj } from "@storybook/react-vite";
import { EndGameConfirmModal } from "@/components/poker/end-game-confirm-modal";
import { storyTranslate } from "@/components/poker/storybook-fixtures";

const meta = {
  title: "Poker/EndGameConfirmModal",
  component: EndGameConfirmModal,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    onCancel: () => {},
    onConfirm: () => {},
    t: storyTranslate,
  },
} satisfies Meta<typeof EndGameConfirmModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

