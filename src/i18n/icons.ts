export interface IconStrings {
  locale: "en" | "zh";
  change: string; noIcon: string; reset: string; resetDefault: string; description: string;
  navigationHeading: string; cardsHeading: string; defaultSubtitle: string;
  tabIcons: string; tabEmoji: string; searchIcons: string; searchEmoji: string;
  recent: string; suggested: string; allIcons: string; empty: string; invalid: string;
  resultCount: (count: number) => string;
  error: string; retry: string; close: string; emojiCategories: string; tone: string; tones: string[];
  categories: Record<string, string>; groups: string[];
}
export const iconStrings: Record<"en" | "zh", IconStrings> = {
  en: { locale: "en", change: "Change icon", noIcon: "No icon", reset: "Remove custom icon", resetDefault: "Restore built-in icon",
    description: "Icons chosen directly on an item or card take priority over these defaults.",
    navigationHeading: "Default navigation icons", cardsHeading: "Default card icons", defaultSubtitle: "Default icon",
    tabIcons: "Icons", tabEmoji: "Emoji", searchIcons: "Search icons", searchEmoji: "Search or paste an emoji",
    recent: "Recently used", suggested: "Suggested", allIcons: "All icons", empty: "No matching icons",
    invalid: "Paste a single emoji from the offline catalogue.", resultCount: count => `${count} results`,
    error: "Could not save the icon. The change still applies until restart.", retry: "Retry saving", close: "Close",
    emojiCategories: "Emoji categories", tone: "Skin tone", tones: ["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"],
    categories: { folder: "Folders", tag: "Tags", property: "Property names", "property-value": "Property values", box: "Card boxes", backlinks: "Backlinks", outgoing: "Outgoing links", template: "Templates", markdown: "Markdown cards", base: "Base cards", canvas: "Canvas cards", excalidraw: "Excalidraw cards", image: "Image cards", pdf: "PDF cards", audio: "Audio cards", video: "Video cards", file: "Other file cards" },
    groups: ["Smileys & Emotion", "People & Body", "Component", "Animals & Nature", "Food & Drink", "Travel & Places", "Activities", "Objects", "Symbols", "Flags"] },
  zh: { locale: "zh", change: "更改图标", noIcon: "无图标", reset: "移除自定义图标", resetDefault: "恢复内置图标",
    description: "直接在条目或卡片上选择的图标优先于这里的默认图标。",
    navigationHeading: "导航默认图标", cardsHeading: "卡片默认图标", defaultSubtitle: "默认图标",
    tabIcons: "图标", tabEmoji: "Emoji", searchIcons: "搜索图标", searchEmoji: "搜索或粘贴 emoji",
    recent: "最近使用", suggested: "推荐", allIcons: "全部图标", empty: "没有匹配的图标",
    invalid: "请粘贴离线目录中的单个 emoji。", resultCount: count => `${count} 个结果`,
    error: "图标保存失败；重启前当前更改仍然生效。", retry: "重试保存", close: "关闭",
    emojiCategories: "Emoji 分类", tone: "肤色", tones: ["默认", "浅色", "中浅色", "中等", "中深色", "深色"],
    categories: { folder: "文件夹", tag: "标签", property: "属性名", "property-value": "属性值", box: "卡片盒", backlinks: "反链", outgoing: "出链", template: "模板", markdown: "Markdown 卡片", base: "Base 卡片", canvas: "Canvas 卡片", excalidraw: "Excalidraw 卡片", image: "图片卡片", pdf: "PDF 卡片", audio: "音频卡片", video: "视频卡片", file: "其他文件卡片" },
    groups: ["表情与情感", "人物与身体", "组件", "动物与自然", "食物与饮料", "旅行与地点", "活动", "物品", "符号", "旗帜"] },
};
