import { readFileSync } from "node:fs";
import postcss, { type AtRule, type Container, type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const indexCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const indexCssRoot = postcss.parse(indexCss);

function getContainerQuery(container: Container, query: string): AtRule {
  const matchingQuery = container.nodes?.find(
    (node): node is AtRule =>
      node.type === "atrule" &&
      node.name === "container" &&
      node.params === query,
  );

  if (!matchingQuery) {
    throw new Error(`Missing container query: ${query}`);
  }

  return matchingQuery;
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

function getDeclarationValue(rule: Rule, propertyName: string): string | undefined {
  return rule.nodes?.find(
    (node): node is Declaration => node.type === "decl" && node.prop === propertyName,
  )?.value;
}

describe("table board center stack spacing", () => {
  it("keeps a little more community-to-pot spacing on mobile portrait breakpoints", () => {
    const mobileContainerQuery = getContainerQuery(
      indexCssRoot,
      "tablefelt (max-width: 560px)",
    );
    const compactMobileContainerQuery = getContainerQuery(
      indexCssRoot,
      "tablefelt (max-width: 430px)",
    );
    const mobileBoardCenterRule = getRule(mobileContainerQuery, ".board-center-stack");
    const compactMobileBoardCenterRule = getRule(
      compactMobileContainerQuery,
      ".board-center-stack",
    );

    expect(getDeclarationValue(mobileBoardCenterRule, "gap")).toBe("0.98rem");
    expect(getDeclarationValue(compactMobileBoardCenterRule, "gap")).toBe("0.88rem");
  });
});
