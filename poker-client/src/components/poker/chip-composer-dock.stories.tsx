import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChipComposerDock } from "@/components/poker/chip-composer-dock";

const meta = {
  title: "Poker/ChipComposerDock",
  component: ChipComposerDock,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    children: (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-emerald-50">Your turn: Call $20</p>
        <div className="flex flex-wrap gap-2">
          <button className="chip-action chip-action--check">Check</button>
          <button className="chip-action chip-action--call">Call $20</button>
          <button className="chip-action chip-action--raise">Raise</button>
          <button className="chip-action chip-action--allin">All In</button>
        </div>
      </div>
    ),
  },
} satisfies Meta<typeof ChipComposerDock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

