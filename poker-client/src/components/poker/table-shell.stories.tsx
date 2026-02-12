import type { Meta, StoryObj } from "@storybook/react-vite";
import { TableShell } from "@/components/poker/table-shell";

const meta = {
  title: "Poker/TableShell",
  component: TableShell,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    isYourTurn: true,
    isDesktopSideDock: true,
    isChatPanelOpen: false,
    children: (
      <div className="mx-auto max-w-5xl p-6">
        <div className="surface-panel p-6">
          <h2 className="text-xl font-black text-white">Table Surface</h2>
          <p className="mt-2 text-sm text-emerald-100/80">
            Table shell with felt, center lanes, and side dock.
          </p>
        </div>
      </div>
    ),
  },
} satisfies Meta<typeof TableShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopTurn: Story = {};

export const ChatOpen: Story = {
  args: {
    isChatPanelOpen: true,
  },
};

export const Mobile: Story = {
  args: {
    isDesktopSideDock: false,
  },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
};

