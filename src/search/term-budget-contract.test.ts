import { describe, expect, it } from "vitest";

import { SEARCH_INDEX_MAX_TERMS_PER_FIELD } from "../search-tokenization";
import { PHASE3_MINISEARCH_CONTRACT } from "./types";

describe("index term budget contract", () => {
  it("keeps the hardcoded contract cap equal to SEARCH_INDEX_MAX_TERMS_PER_FIELD", () => {
    expect(PHASE3_MINISEARCH_CONTRACT.tokenizer.maxTermsPerField).toBe(
      SEARCH_INDEX_MAX_TERMS_PER_FIELD,
    );
  });
});
