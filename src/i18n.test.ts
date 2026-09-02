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

  it("provides exact property lane copy in English and Chinese", () => {
    const en = getUiStrings("en").property;
    const zh = getUiStrings("zh").property;

    expect([en.sectionLabel, en.chooseVisible, en.searchPlaceholder, en.clearFilters, en.hideThisProperty])
      .toEqual(["Properties", "Choose visible properties", "Search properties…", "Clear property filters", "Hide this property"]);
    expect([en.addToFilter, en.removeFromFilter, en.filterByOnlyThisValue])
      .toEqual(["Add to filter", "Remove from filter", "Filter by only this value"]);
    expect([en.emptyNoProperties, en.partialWarning, en.unavailable])
      .toEqual(["No properties found", "Some property metadata is still loading", "Property metadata is unavailable"]);
    expect([en.valueUnassigned, en.valueTrue, en.valueFalse]).toEqual(["Unassigned", "True", "False"]);
    expect([en.typeText, en.typeNumber, en.typeBoolean]).toEqual(["Text", "Number", "Boolean"]);
    expect(en.activeFilterSummary(1)).toBe("1 property filter active");
    expect(en.activeFilterSummary(3)).toBe("3 property filters active");
    expect(en.emptyPropertyFilter).toBe("No notes match the current property filters.");
    expect(en.sectionEmpty).toBe("No properties selected — choose which properties to show");

    expect([zh.sectionLabel, zh.chooseVisible, zh.searchPlaceholder, zh.clearFilters, zh.hideThisProperty])
      .toEqual(["属性", "选择可见属性", "搜索属性…", "清除属性筛选", "隐藏此属性"]);
    expect([zh.addToFilter, zh.removeFromFilter, zh.filterByOnlyThisValue])
      .toEqual(["加入筛选", "从筛选中移除", "仅按此值筛选"]);
    expect([zh.emptyNoProperties, zh.partialWarning, zh.unavailable])
      .toEqual(["未发现属性", "部分属性元数据仍在加载", "属性元数据暂不可用"]);
    expect([zh.valueUnassigned, zh.valueTrue, zh.valueFalse]).toEqual(["未分配", "是", "否"]);
    expect([zh.typeText, zh.typeNumber, zh.typeBoolean]).toEqual(["文本", "数字", "布尔值"]);
    expect(zh.activeFilterSummary(1)).toBe("已启用 1 个属性筛选");
    expect(zh.activeFilterSummary(3)).toBe("已启用 3 个属性筛选");
    expect(zh.emptyPropertyFilter).toBe("没有笔记符合当前属性筛选。");
    expect(zh.sectionEmpty).toBe("尚未选择属性——请选择要显示的属性");
  });
});
