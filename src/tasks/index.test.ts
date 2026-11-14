import { describe, expect, it } from "vitest";

import {
  applyLinePatches,
  buildTaskTree,
  compareIsoDates,
  convertLineToTask,
  formatIsoDate,
  isCompletedStatusChar,
  isValidIsoDate,
  parseIsoDateLocal,
  parseTaskLine,
  resolveDatePreset,
  setTaskDate,
  setTaskStatus,
  splitContentLines,
  TASK_DATE_MARKERS,
  toggleTaskStatus,
} from "./index";
import { parseTaskLine as parseTaskLineDirect } from "./task-line";
import { formatIsoDate as formatIsoDateDirect } from "./task-dates";
import { setTaskDate as setTaskDateDirect } from "./task-edit";
import { buildTaskTree as buildTaskTreeDirect } from "./task-tree";

describe("src/tasks public barrel", () => {
  it("re-exports the task-line API other modules code against", () => {
    expect(parseTaskLine).toBe(parseTaskLineDirect);
    expect(formatIsoDate).toBe(formatIsoDateDirect);
    expect(setTaskDate).toBe(setTaskDateDirect);
    expect(buildTaskTree).toBe(buildTaskTreeDirect);
    expect(TASK_DATE_MARKERS).toEqual({
      created: "\u2795",
      done: "\u2705",
      due: "\u{1F4C5}",
    });
    expect(typeof compareIsoDates).toBe("function");
    expect(typeof isValidIsoDate).toBe("function");
    expect(typeof parseIsoDateLocal).toBe("function");
    expect(typeof resolveDatePreset).toBe("function");
    expect(typeof isCompletedStatusChar).toBe("function");
    expect(typeof applyLinePatches).toBe("function");
    expect(typeof convertLineToTask).toBe("function");
    expect(typeof setTaskStatus).toBe("function");
    expect(typeof toggleTaskStatus).toBe("function");
    expect(typeof splitContentLines).toBe("function");
  });
});
