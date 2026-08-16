import type { UiLanguage } from "./types";

export interface BoxStrings {
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
  ruleFolderMissing: string;
  removeRule: string;
  noRules: string;
  sortHeading: string;
  manualHeading: string;
  noManualMembers: string;
  removeManualMember: string;
  excludedHeading: string;
  noExcludedMembers: string;
  restoreExcluded: string;
  restoreAllExcluded: string;
  done: string;
  emptyBoxHint: string;
}

export const boxStrings: Record<UiLanguage, BoxStrings> = {
  en: {
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
    ruleFolderMissing: "Folder no longer exists",
    removeRule: "Remove rule",
    noRules:
      "No rules yet. Use “Add current view to card box” from the card box's right-click menu.",
    sortHeading: "Sort",
    manualHeading: "Manually added",
    noManualMembers: "No manually added notes.",
    removeManualMember: "Remove from card box",
    excludedHeading: "Removed notes",
    noExcludedMembers: "No removed notes.",
    restoreExcluded: "Restore",
    restoreAllExcluded: "Restore all",
    done: "Done",
    emptyBoxHint: "This card box is empty. Add notes from the card list or add a rule.",
  },
  zh: {
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
    ruleFolderMissing: "文件夹已不存在",
    removeRule: "删除规则",
    noRules: "还没有规则。请在卡片盒右键菜单中使用「加入当前视图」。",
    sortHeading: "排序",
    manualHeading: "手动加入",
    noManualMembers: "还没有手动加入的笔记。",
    removeManualMember: "移出卡片盒",
    excludedHeading: "已移出的笔记",
    noExcludedMembers: "没有被移出的笔记。",
    restoreExcluded: "恢复",
    restoreAllExcluded: "全部恢复",
    done: "完成",
    emptyBoxHint: "此卡片盒为空。可从卡片列表加入笔记，或添加规则。",
  },
};
