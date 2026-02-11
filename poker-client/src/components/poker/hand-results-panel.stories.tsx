import type { Meta, StoryObj } from "@storybook/react-vite";
import { HandResultsPanel } from "@/components/poker/hand-results-panel";

const meta = {
  title: "Poker/HandResultsPanel",
  component: HandResultsPanel,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    children: (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-emerald-100">Hand #22</p>
        <p className="text-base font-black text-white">Kai wins with Straight</p>
        <p className="text-xs text-emerald-100/75">Main pot: $320 • Side pot: $80</p>
      </div>
    ),
  },
} satisfies Meta<typeof HandResultsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Summary: Story = {};

