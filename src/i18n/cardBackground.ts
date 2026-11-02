export function cardBackgroundStrings(language: string) {
  const zh = language === "zh" || language.startsWith("zh-");
  const tints = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;
  const names = zh ? ["红", "橙", "黄", "绿", "青", "蓝", "紫", "粉"] : ["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink"];
  return {
    title: zh ? "背景颜色" : "Background color",
    defaultName: zh ? "默认卡片背景颜色" : "Default card background color",
    defaultDesc: zh ? "适用于未单独设置颜色的卡片，预设色随明暗主题适配。" : "Applies to cards without an individual color. Presets adapt to light and dark themes.",
    theme: zh ? "跟随主题" : "Follow theme",
    inherit: zh ? "跟随默认" : "Follow default",
    failed: zh ? "背景颜色保存失败，请重试。" : "Could not save background color. Please try again.",
    colors: Object.fromEntries(tints.map((tint, index) => [tint, names[index]!])) as Record<typeof tints[number], string>,
  };
}
