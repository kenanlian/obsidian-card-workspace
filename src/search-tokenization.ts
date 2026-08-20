import MiniSearch from "minisearch";

const defaultTokenize = MiniSearch.getDefault("tokenize") as (text: string) => string[];
const HAN_CODE_POINT_PATTERN = /\p{Script=Han}/u;
const HAN_TERM_PATTERN = /^\p{Script=Han}+$/u;
const HAN_RUN_PATTERN = /\p{Script=Han}+/gu;

interface TextRun {
  kind: "han" | "non-han";
  text: string;
}

function splitTextRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let offset = 0;

  for (const match of text.matchAll(HAN_RUN_PATTERN)) {
    const index = match.index;
    if (index > offset) {
      runs.push({ kind: "non-han", text: text.slice(offset, index) });
    }

    runs.push({ kind: "han", text: match[0] });
    offset = index + match[0].length;
  }

  if (offset < text.length) {
    runs.push({ kind: "non-han", text: text.slice(offset) });
  }

  return runs;
}

function appendHanIndexTerms(run: string, terms: string[]): void {
  const codePoints = Array.from(run);
  for (const codePoint of codePoints) {
    terms.push(codePoint);
  }

  for (let index = 0; index + 1 < codePoints.length; index += 1) {
    terms.push(codePoints[index] + codePoints[index + 1]);
  }
}

function appendHanQueryTerms(run: string, terms: string[]): void {
  const codePoints = Array.from(run);
  if (codePoints.length === 1) {
    terms.push(codePoints[0]);
    return;
  }

  for (let index = 0; index + 1 < codePoints.length; index += 1) {
    terms.push(codePoints[index] + codePoints[index + 1]);
  }
}

export function tokenizeSearchIndexText(text: string): string[] {
  if (!HAN_CODE_POINT_PATTERN.test(text)) {
    return defaultTokenize(text);
  }

  const terms: string[] = [];
  for (const run of splitTextRuns(text)) {
    if (run.kind === "han") {
      appendHanIndexTerms(run.text, terms);
    } else {
      for (const term of defaultTokenize(run.text)) {
        terms.push(term);
      }
    }
  }

  return terms;
}

export function tokenizeSearchQuery(text: string): string[] {
  if (!HAN_CODE_POINT_PATTERN.test(text)) {
    return defaultTokenize(text).filter(Boolean);
  }

  const terms: string[] = [];
  for (const run of splitTextRuns(text)) {
    if (run.kind === "han") {
      appendHanQueryTerms(run.text, terms);
    } else {
      for (const term of defaultTokenize(run.text)) {
        if (term) {
          terms.push(term);
        }
      }
    }
  }

  return terms;
}

export function getSearchDisplayTerms(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  const appendUnique = (term: string): void => {
    const normalized = term.toLowerCase();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    terms.push(normalized);
  };

  for (const whitespaceToken of query.split(/\s+/u)) {
    if (whitespaceToken.length === 0) {
      continue;
    }

    if (!HAN_CODE_POINT_PATTERN.test(whitespaceToken)) {
      appendUnique(whitespaceToken);
      continue;
    }

    for (const run of splitTextRuns(whitespaceToken)) {
      if (run.kind === "han") {
        appendUnique(run.text);
      } else {
        for (const term of defaultTokenize(run.text)) {
          appendUnique(term);
        }
      }
    }
  }

  return terms;
}

export function shouldUsePrefixSearch(term: string): boolean {
  return term.length === 0 || !HAN_TERM_PATTERN.test(term);
}
