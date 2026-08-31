import type { UiStrings } from "../i18n";
import type { Rule } from "./types";

type RuleContent = Pick<Rule, "folder" | "includeSubfolders" | "tags">;

/**
 * Content-derived rule identity.
 *
 * Two rules share an id exactly when they match the same paths, so a rule whose
 * `id` was never persisted can self-heal from its own content.
 */
export function deriveRuleId(rule: RuleContent): string {
  return `r:${rule.folder}|${rule.includeSubfolders}|${[...rule.tags].sort().join(",")}`;
}

export function describeBoxRule(strings: UiStrings, rule: RuleContent): string {
  const boxStrings = strings.box;
  let label = rule.folder === "" ? boxStrings.ruleRootLabel : rule.folder;
  if (rule.includeSubfolders) {
    label += ` (${boxStrings.ruleSubfolderSuffix})`;
  }
  if (rule.tags.length > 0) {
    label += boxStrings.ruleTagsSeparator + rule.tags.map((tag) => `#${tag}`).join(", ");
  }
  return label;
}

export function resolveRuleLabel(strings: UiStrings, rule: Rule): string {
  const name = rule.name.trim();
  return name === "" ? describeBoxRule(strings, rule) : name;
}
