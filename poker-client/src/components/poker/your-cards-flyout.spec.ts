import { readFileSync } from "node:fs";
import postcss, { type AtRule, type Container, type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const indexCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const indexCssRoot = postcss.parse(indexCss);

function normalizeMediaQuery(query: string): string {
  return query.replace(/^@media\s+/, "").trim();
}

function getRule(container: Container, selector: string): Rule {
  const matchingRule = container.nodes?.find(
    (node): node is Rule => node.type === "rule" && node.selector === selector,
  );

  if (!matchingRule) {
    throw new Error(`Missing CSS block for selector: ${selector}`);
  }

  return matchingRule;
}

function getMediaQuery(container: Container, query: string): AtRule {
  const normalizedQuery = normalizeMediaQuery(query);
  const matchingMediaQuery = container.nodes?.find(
    (node): node is AtRule => node.type === "atrule" && node.name === "media" && node.params === normalizedQuery,
  );

  if (!matchingMediaQuery) {
    throw new Error(`Missing media query: ${query}`);
  }

  return matchingMediaQuery;
}

function getDeclarationValue(rule: Rule, propertyName: string): string | undefined {
  return rule.nodes?.find(
    (node): node is Declaration => node.type === "decl" && node.prop === propertyName,
  )?.value;
}

describe("your-cards-flyout styles", () => {
  it("lets the bottom placement inherit the compact base width", () => {
    const bottomRule = getRule(indexCssRoot, ".your-cards-flyout--bottom");

    expect(getDeclarationValue(bottomRule, "width")).toBeUndefined();
  });

  it("keeps a minimum width for the bottom placement in short landscape layouts", () => {
    const landscapeMediaQuery = getMediaQuery(
      indexCssRoot,
      "@media (orientation: landscape) and (max-height: 500px)",
    );
    const bottomRule = getRule(landscapeMediaQuery, ".your-cards-flyout--bottom");

    expect(getDeclarationValue(bottomRule, "width")).toBe("clamp(9.15rem, 24vw, 10rem)");
  });

  it("preserves the existing wider bottom placement outside mobile", () => {
    const tabletMediaQuery = getMediaQuery(indexCssRoot, "@media (min-width: 768px)");
    const bottomRule = getRule(tabletMediaQuery, ".your-cards-flyout--bottom");

    expect(getDeclarationValue(bottomRule, "width")).toMatch(/^min\(\s*14rem,/);
  });

  it("keeps the non-mobile override after the short-landscape mobile rule", () => {
    const landscapeMediaQuery = getMediaQuery(
      indexCssRoot,
      "@media (orientation: landscape) and (max-height: 500px)",
    );
    const tabletMediaQuery = getMediaQuery(indexCssRoot, "@media (min-width: 768px)");
    const rootNodes = indexCssRoot.nodes ?? [];
    const landscapeMediaIndex = rootNodes.indexOf(landscapeMediaQuery);
    const tabletMediaIndex = rootNodes.indexOf(tabletMediaQuery);

    expect(landscapeMediaIndex).toBeGreaterThan(-1);
    expect(tabletMediaIndex).toBeGreaterThan(-1);
    expect(landscapeMediaIndex).toBeLessThan(tabletMediaIndex);
  });
});
