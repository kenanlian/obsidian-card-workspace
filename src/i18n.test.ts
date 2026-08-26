import { describe, expect, it } from "vitest";
import {
  getCardCornerRadiusOptions,
  getDefaultCardOpenBehaviorOptions,
  getDragInsertActionOptions,
  getUiStrings,
  resolveUiLanguage,
} from "./i18n";

describe("i18n", () => {
  it("resolves Chinese locales and falls back to English otherwise", () => {
    expect(resolveUiLanguage("zh")).toBe("zh");
    expect(resolveUiLanguage("zh-TW")).toBe("zh");
    expect(resolveUiLanguage("zh-CN")).toBe("zh");
    expect(resolveUiLanguage("en")).toBe("en");
    expect(resolveUiLanguage("fr")).toBe("en");
  });

  it("returns Chinese UI strings for Chinese locales", () => {
    const strings = getUiStrings("zh");
    expect(strings.settingTab.previewLinesName).toBe("预览行数");
    expect(strings.toolbar.actions.sortTitle).toBe("排序卡片");
    expect(strings.view.merge.defaultMergedTitle).toBe("合并笔记");
  });

  it("localizes settings dropdown options", () => {
    expect(getDefaultCardOpenBehaviorOptions("en")[0]?.label).toBe("Current pane / current tab");
    expect(getDefaultCardOpenBehaviorOptions("zh")[0]?.label).toBe("当前窗格 / 当前标签页");
    expect(getDragInsertActionOptions("en")[0]?.label).toBe("Ask every time");
    expect(getDragInsertActionOptions("zh")[0]?.label).toBe("每次弹框确认");
    expect(getDragInsertActionOptions("zh")[4]?.label).toBe("插入卡片标题&内容");
    expect(getCardCornerRadiusOptions("zh")[2]?.label).toBe("圆角");
  });

  it("provides exact navigation filter, empty, and accessibility copy", () => {
    const en = getUiStrings("en").toolbar.navPane;
    const zh = getUiStrings("zh").toolbar.navPane;
    expect([en.filterLabel, en.filterPlaceholder, en.clearFilter, en.noResults]).toEqual([
      "Filter navigation", "Filter navigation…", "Clear navigation filter", "No navigation items found",
    ]);
    expect([zh.filterLabel, zh.filterPlaceholder, zh.clearFilter, zh.noResults]).toEqual([
      "筛选导航", "筛选导航…", "清除导航筛选", "未找到导航项目",
    ]);
    expect(en.resizeValue(240)).toContain("240");
    expect(zh.activeFileDescription).toBe("当前文件");
  });
});
