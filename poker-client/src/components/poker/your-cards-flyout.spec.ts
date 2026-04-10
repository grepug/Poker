import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

function getCssBlock(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "m"));

  if (!match) {
    throw new Error(`Missing CSS block for selector: ${selector}`);
  }

  return match[1];
}

function getMediaQueryBlock(css: string, query: string): string {
  const startIndex = css.indexOf(query);

  if (startIndex === -1) {
    throw new Error(`Missing media query: ${query}`);
  }

  const bodyStartIndex = css.indexOf("{", startIndex);

  if (bodyStartIndex === -1) {
    throw new Error(`Missing opening brace for media query: ${query}`);
  }

  let depth = 0;

  for (let index = bodyStartIndex; index < css.length; index += 1) {
    const character = css[index];

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return css.slice(bodyStartIndex + 1, index);
      }
    }
  }

  throw new Error(`Unclosed media query: ${query}`);
}

describe("your-cards-flyout styles", () => {
  it("lets the bottom placement inherit the compact base width", () => {
    const bottomBlock = getCssBlock(indexCss, ".your-cards-flyout--bottom");

    expect(bottomBlock).not.toMatch(/\bwidth\s*:/);
  });

  it("keeps a minimum width for the bottom placement in short landscape layouts", () => {
    const landscapeMediaBlock = getMediaQueryBlock(
      indexCss,
      "@media (orientation: landscape) and (max-height: 500px)",
    );
    const bottomBlock = getCssBlock(landscapeMediaBlock, ".your-cards-flyout--bottom");

    expect(bottomBlock).toMatch(/width:\s*clamp\(9\.15rem,\s*24vw,\s*10rem\)/);
  });

  it("preserves the existing wider bottom placement outside mobile", () => {
    const tabletMediaBlock = getMediaQueryBlock(indexCss, "@media (min-width: 768px)");
    const bottomBlock = getCssBlock(tabletMediaBlock, ".your-cards-flyout--bottom");

    expect(bottomBlock).toMatch(/width:\s*min\(\s*14rem,/);
  });

  it("keeps the non-mobile override after the short-landscape mobile rule", () => {
    const landscapeMediaIndex = indexCss.indexOf(
      "@media (orientation: landscape) and (max-height: 500px)",
    );
    const tabletMediaIndex = indexCss.indexOf("@media (min-width: 768px)");

    expect(landscapeMediaIndex).toBeGreaterThan(-1);
    expect(tabletMediaIndex).toBeGreaterThan(-1);
    expect(landscapeMediaIndex).toBeLessThan(tabletMediaIndex);
  });
});
