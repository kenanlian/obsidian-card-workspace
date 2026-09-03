import type { UiStrings } from "../i18n";
import {
  normalizePropertyFilterClauses,
  serializePropertyScalarRef,
  type PropertyFilterClause,
} from "../property-filter-settings";
import { buildPropertyScalarLabel } from "./property-metadata";
import type { Rule } from "./types";

type RuleContent = Pick<Rule, "folder" | "includeSubfolders" | "tags" | "properties">;

const byKey = (a: PropertyFilterClause, b: PropertyFilterClause): number =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

/**
 * Content-derived rule identity.
 *
 * Two rules share an id exactly when they match the same paths, so a rule whose
 * `id` was never persisted can self-heal from its own content. Property
 * clauses normalize inside the derivation, so disordered clause values derive
 * the same id without relying on caller-side normalization.
 */
export function deriveRuleId(rule: RuleContent): string {
  const base = `r:${rule.folder}|${rule.includeSubfolders}|${[...rule.tags].sort().join(",")}`;
  const pairs = normalizePropertyFilterClauses(rule.properties)
    .sort(byKey)
    .map((clause) => [clause.key, clause.values.map(serializePropertyScalarRef)]);
  return pairs.length === 0 ? base : `${base}|${JSON.stringify(pairs)}`;
}

export function describeBoxRule(strings: UiStrings, rule: RuleContent): string {
  const boxStrings = strings.box;
  const clauses = normalizePropertyFilterClauses(rule.properties);
  let label = rule.folder === "" ? boxStrings.ruleRootLabel : rule.folder;
  if (rule.includeSubfolders) {
    label += ` (${boxStrings.ruleSubfolderSuffix})`;
  }
  if (rule.tags.length > 0) {
    label += boxStrings.ruleTagsSeparator + rule.tags.map((tag) => `#${tag}`).join(", ");
  }
  if (clauses.length > 0) {
    label += boxStrings.rulePropertiesSeparator + clauses
      .map((clause) =>
        `${clause.key}: ${clause.values.map((value) => buildPropertyScalarLabel(value, strings.property)).join(", ")}`)
      .join(" · ");
  }
  return label;
}

export function resolveRuleLabel(strings: UiStrings, rule: Rule): string {
  const name = rule.name.trim();
  return name === "" ? describeBoxRule(strings, rule) : name;
}
