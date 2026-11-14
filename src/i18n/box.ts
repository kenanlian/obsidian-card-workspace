import type { UiLanguage } from "./types";

export interface BoxStrings {
  drawToggleCommand: string;
  drawNextCommand: string;
  drawRetry: string;
  drawTitle: string; drawRandom: string; drawCycle: string; drawDaily: string; drawNext: string; drawExit: string;
  drawCount: string; drawReset: string; drawResetConfirm: string; drawTomorrow: string; drawPaused: string;
  drawHidden: string;
  drawEmpty: string; drawLast: string; drawSaveFailed: string;
  drawProgress: (round: number, drawn: number, total: number) => string;
  drawCountSummary: (count: number) => string;
  drawRoundShort: (round: number) => string;
  drawPoolShort: (total: number) => string;
  drawStatusShort: { saveFailed: string; empty: string; paused: string; last: string; tomorrow: string };
  showAllItems: (count: number) => string;
  createBox: string;
  saveScopeAsBox: string;
  addScopeToBox: string;
  addScopeToThisBox: string;
  rename: string;
  duplicate: string;
  delete: string;
  configure: string;
  configureTitle: string;
  sortTitle: string;
  nameModalCreateTitle: string;
  nameModalRenameTitle: string;
  nameLabel: string;
  namePlaceholder: string;
  cancel: string;
  create: string;
  save: string;
  emptyNameError: string;
  saveScopeTitle: string;
  hitCountPreview: (count: number) => string;
  deleteConfirmTitle: string;
  deleteConfirmBody: (name: string) => string;
  deleteConfirm: string;
  addToBox: string;
  addToNewBox: string;
  removeFromBox: string;
  bulkAddToBox: string;
  bulkAddToBoxTitle: string;
  addedToBox: (count: number, name: string) => string;
  removedFromBox: (name: string) => string;
  removedFromBoxCount: (count: number, name: string) => string;
  configTitle: (name: string) => string;
  rulesHeading: string;
  ruleRootLabel: string;
  ruleSubfolderSuffix: string;
  ruleTagsSeparator: string;
  rulePropertiesSeparator: string;
  ruleFolderMissing: string;
  ruleNameLabel: string;
  ruleNamePlaceholder: string;
  removeRule: string;
  noRules: string;
  sortHeading: string;
  groupHeading: string;
  groupPropertyLabel: string;
  groupOrderByLabel: string;
  groupOrderDirectionLabel: string;
  manualHeading: string;
  noManualMembers: string;
  removeManualMember: string;
  excludedHeading: string;
  noExcludedMembers: string;
  restoreExcluded: string;
  restoreAllExcluded: string;
  done: string;
}

export const boxStrings: Record<UiLanguage, BoxStrings> = {
  en: {
    drawToggleCommand: "Draw cards: enter / exit",
    drawNextCommand: "Draw cards: next group",
    drawRetry: "Retry saving",
    drawTitle: "Draw cards", drawRandom: "Random each time", drawCycle: "Complete a round", drawDaily: "Daily wander",
    drawNext: "Draw next group", drawExit: "Exit draw", drawCount: "Cards per group", drawReset: "Reset progress",
    drawResetConfirm: "Reset saved draw progress immediately? Canceling this configuration will not undo the reset.",
    drawHidden: "No visible cards in the current group",
    drawTomorrow: "A new group tomorrow", drawPaused: "Draw paused", drawEmpty: "No cards available in this box",
    drawLast: "Last group of this round", drawSaveFailed: "Could not save draw progress. Retry saving before drawing again.",
    drawProgress: (round, drawn, total) => `Round ${round} · Drawn ${drawn} / ${total}`,
    drawCountSummary: count => count === 1 ? "1 card per group" : `${count} cards per group`,
    drawRoundShort: round => `Round ${round}`,
    drawPoolShort: total => total === 1 ? "1 card" : `${total} cards`,
    drawStatusShort: { saveFailed: "Not saved", empty: "Empty", paused: "Paused", last: "Last group", tomorrow: "New tomorrow" },
    showAllItems: count => `Show all (${count})`,
    createBox: "New card box…",
    saveScopeAsBox: "Save current view as card box…",
    addScopeToBox: "Add current view to card box",
    addScopeToThisBox: "Add current view to this card box",
    rename: "Rename…",
    duplicate: "Make a copy",
    delete: "Delete",
    configure: "Configure card box…",
    configureTitle: "Configure card box",
    sortTitle: "Sort cards",
    nameModalCreateTitle: "New card box",
    nameModalRenameTitle: "Rename card box",
    nameLabel: "Name",
    namePlaceholder: "Card box name",
    cancel: "Cancel",
    create: "Create",
    save: "Save",
    emptyNameError: "Enter a name for the card box.",
    saveScopeTitle: "Save current view as card box",
    hitCountPreview: (count: number) =>
      count === 1 ? "1 note matches the current view." : `${count} notes match the current view.`,
    deleteConfirmTitle: "Delete card box",
    deleteConfirmBody: (name: string) =>
      `Delete “${name}”? The card box and its rules are removed. Your notes are not affected.`,
    deleteConfirm: "Delete",
    addToBox: "Add to card box",
    addToNewBox: "New card box…",
    removeFromBox: "Remove from card box",
    bulkAddToBox: "Add to card box",
    bulkAddToBoxTitle: "Add selected to card box",
    addedToBox: (count: number, name: string) =>
      count === 1 ? `Added 1 note to “${name}”.` : `Added ${count} notes to “${name}”.`,
    removedFromBox: (name: string) => `Removed from “${name}”.`,
    removedFromBoxCount: (count: number, name: string) =>
      `Removed ${count} notes from “${name}”`,
    configTitle: (name: string) => `Configure “${name}”`,
    rulesHeading: "Rules",
    ruleRootLabel: "Vault root",
    ruleSubfolderSuffix: "incl. subfolders",
    ruleTagsSeparator: " · ",
    rulePropertiesSeparator: " · ",
    ruleFolderMissing: "Folder no longer exists",
    ruleNameLabel: "Rule name",
    ruleNamePlaceholder: "Leave empty to use the rule description",
    removeRule: "Remove rule",
    noRules:
      "No rules yet. Use “Add current view to card box” from the card box's right-click menu.",
    sortHeading: "Sort",
    groupHeading: "Grouping",
    groupPropertyLabel: "Group property",
    groupOrderByLabel: "Order groups by",
    groupOrderDirectionLabel: "Group order direction",
    manualHeading: "Manually added",
    noManualMembers: "No manually added notes.",
    removeManualMember: "Remove from card box",
    excludedHeading: "Removed notes",
    noExcludedMembers: "No removed notes.",
    restoreExcluded: "Restore",
    restoreAllExcluded: "Restore all",
    done: "Done",
  },
  zh: {
    drawToggleCommand: "抽卡：进入 / 退出",
    drawNextCommand: "抽卡：抽下一组",
    drawRetry: "重试保存",
    drawTitle: "抽卡", drawRandom: "每次随机", drawCycle: "轮完一遍再重复", drawDaily: "每日漫游",
    drawNext: "抽下一组", drawExit: "退出抽卡", drawCount: "每组张数", drawReset: "重置进度",
    drawResetConfirm: "立即重置已保存的抽卡进度？取消配置弹窗不会撤销此次重置。",
    drawHidden: "当前组暂无可见卡片",
    drawTomorrow: "明天会有新的一组", drawPaused: "抽卡已暂停", drawEmpty: "卡片盒中没有可抽的卡片",
    drawLast: "本轮最后一组", drawSaveFailed: "抽卡进度保存失败，请先重试保存再继续抽取。",
    drawProgress: (round, drawn, total) => `第 ${round} 轮 · 已抽 ${drawn} / 共 ${total}`,
    drawCountSummary: count => `每组 ${count} 张`,
    drawRoundShort: round => `第 ${round} 轮`,
    drawPoolShort: total => `共 ${total} 张`,
    drawStatusShort: { saveFailed: "未保存", empty: "无卡片", paused: "已暂停", last: "最后一组", tomorrow: "明日更新" },
    showAllItems: count => `显示全部（${count}）`,
    createBox: "新建卡片盒…",
    saveScopeAsBox: "将当前视图存为卡片盒…",
    addScopeToBox: "将当前视图加入卡片盒",
    addScopeToThisBox: "将当前视图加入此卡片盒",
    rename: "重命名…",
    duplicate: "创建副本",
    delete: "删除",
    configure: "配置卡片盒…",
    configureTitle: "配置卡片盒",
    sortTitle: "排序卡片",
    nameModalCreateTitle: "新建卡片盒",
    nameModalRenameTitle: "重命名卡片盒",
    nameLabel: "名称",
    namePlaceholder: "卡片盒名称",
    cancel: "取消",
    create: "创建",
    save: "保存",
    emptyNameError: "请输入卡片盒名称。",
    saveScopeTitle: "将当前视图存为卡片盒",
    hitCountPreview: (count: number) => `当前视图匹配 ${count} 篇笔记。`,
    deleteConfirmTitle: "删除卡片盒",
    deleteConfirmBody: (name: string) =>
      `确定删除“${name}”？将移除该卡片盒及其规则，你的笔记不受影响。`,
    deleteConfirm: "删除",
    addToBox: "加入卡片盒",
    addToNewBox: "新建卡片盒…",
    removeFromBox: "移出卡片盒",
    bulkAddToBox: "加入卡片盒",
    bulkAddToBoxTitle: "将所选加入卡片盒",
    addedToBox: (count: number, name: string) => `已将 ${count} 篇加入“${name}”。`,
    removedFromBox: (name: string) => `已从“${name}”移出。`,
    removedFromBoxCount: (count: number, name: string) => `已从「${name}」移出 ${count} 篇`,
    configTitle: (name: string) => `配置“${name}”`,
    rulesHeading: "规则",
    ruleRootLabel: "库根目录",
    ruleSubfolderSuffix: "含子文件夹",
    ruleTagsSeparator: " · ",
    rulePropertiesSeparator: " · ",
    ruleFolderMissing: "文件夹已不存在",
    ruleNameLabel: "规则名称",
    ruleNamePlaceholder: "留空则使用规则描述",
    removeRule: "删除规则",
    noRules: "还没有规则。请在卡片盒右键菜单中使用「加入当前视图」。",
    sortHeading: "排序",
    groupHeading: "分组",
    groupPropertyLabel: "分组属性",
    groupOrderByLabel: "分组排序依据",
    groupOrderDirectionLabel: "分组排序方向",
    manualHeading: "手动加入",
    noManualMembers: "还没有手动加入的笔记。",
    removeManualMember: "移出卡片盒",
    excludedHeading: "已移出的笔记",
    noExcludedMembers: "没有被移出的笔记。",
    restoreExcluded: "恢复",
    restoreAllExcluded: "全部恢复",
    done: "完成",
  },
};
