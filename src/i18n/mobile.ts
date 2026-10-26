export interface MobileStrings {
  localStorageUnavailable: string; cacheUnavailable: string; back: string; backUnavailable: string;
  discardTitle: string; discard: string; keepEditing: string; wait: string;
  insertInto: (path: string) => string; noTarget: string; copy: string; staleTarget: string; selectText: string;
  bulkSelect: string; moveEarlier: string; moveLater: string;
}
export const mobileStrings: Record<"en" | "zh", MobileStrings> = {
  en: {
    localStorageUnavailable: "Device settings could not be saved. Changes remain in this session.",
    cacheUnavailable: "Vault local identity unavailable. Persistent caches are disabled for this session.",
    back: "Back", backUnavailable: "Use Obsidian's back navigation on this host.",
    discardTitle: "Discard this draft?", discard: "Discard", keepEditing: "Keep editing", wait: "Sending. Please wait.",
    insertInto: path => `Insert into ${path}`, noTarget: "No valid Markdown editor target", copy: "Copy", staleTarget: "The editor target changed. Return to the note and open cards again.", selectText: "Select and copy this text",
    bulkSelect: "Select cards", moveEarlier: "Move earlier", moveLater: "Move later",
  },
  zh: {
    localStorageUnavailable: "设备设置保存失败，修改仍保留在当前会话中。", cacheUnavailable: "无法保存仓库本地身份，本次会话已关闭持久缓存。",
    back: "返回", backUnavailable: "此宿主请使用 Obsidian 返回入口。", discardTitle: "放弃此草稿？", discard: "放弃", keepEditing: "继续编辑", wait: "正在发送，请稍候。",
    insertInto: path => `插入到 ${path}`, noTarget: "没有有效的 Markdown 编辑器目标", copy: "复制", staleTarget: "目标编辑器已变化，请回到笔记后重新打开卡片页面。", selectText: "请选择并复制以下文本",
    bulkSelect: "选择卡片", moveEarlier: "向前移动", moveLater: "向后移动",
  },
};
