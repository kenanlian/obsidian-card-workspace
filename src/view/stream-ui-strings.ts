/** Labels shared by the desktop stream surface and its host menus. */
export interface StreamUiStrings {
  streams: string;
  create: string;
  reopen: string;
  current: string;
  noCurrent: string;
  autoCollapsed: string;
  collapsed: string;
  pending: string;
  showOnly: string;
  tile: string;
  collapse: string;
  duplicate: string;
  rename: string;
  close: string;
  moveToPane: string;
  copyToPane: string;
  manage: string;
  moveEarlier: string;
  moveLater: string;
  horizontal: string;
  vertical: string;
  toggleNavigation: string;
  resize: string;
  resizeHelp: string;
  empty: string;
  unsupported: string;
  recovery: string;
}
const EN: StreamUiStrings = {
  streams: "Card streams", create: "New stream", reopen: "Reopen closed stream", current: "Current target", noCurrent: "No current target",
  autoCollapsed: "Collapsed to fit available space", collapsed: "Collapsed", pending: "Loading…",
  showOnly: "Show only this stream", tile: "Tile this stream", collapse: "Collapse stream", duplicate: "Duplicate stream",
  rename: "Rename stream", close: "Close stream", moveToPane: "Move to a new pane", copyToPane: "Copy to a new pane",
  manage: "Manage stream", moveEarlier: "Move earlier", moveLater: "Move later", horizontal: "Arrange side by side", vertical: "Arrange top to bottom",
  toggleNavigation: "Toggle source navigation", resize: "Resize adjacent streams", resizeHelp: "Use arrow keys to resize; hold Shift for larger steps.",
  empty: "Create a stream to start browsing cards.", unsupported: "This saved workspace was created by a newer version.", recovery: "Open a recovery stream",
};
const ZH: StreamUiStrings = {
  streams: "卡片流", create: "新建卡片流", reopen: "重新打开已关闭的卡片流", current: "当前目标", noCurrent: "未选择当前目标",
  autoCollapsed: "空间不足，已自动折叠", collapsed: "已折叠", pending: "加载中…",
  showOnly: "仅显示此卡片流", tile: "平铺此卡片流", collapse: "折叠卡片流", duplicate: "复制卡片流",
  rename: "重命名卡片流", close: "关闭卡片流", moveToPane: "移至新窗格", copyToPane: "复制到新窗格",
  manage: "管理卡片流", moveEarlier: "向前移动", moveLater: "向后移动", horizontal: "左右排列", vertical: "上下排列",
  toggleNavigation: "切换来源导航", resize: "调整相邻卡片流大小", resizeHelp: "使用方向键调整大小；按住 Shift 可加大步长。",
  empty: "创建卡片流，开始浏览卡片。", unsupported: "此工作区由较新版本保存。", recovery: "打开恢复卡片流",
};
export function getStreamUiStrings(language: string): StreamUiStrings {
  return language.toLowerCase().startsWith("zh") ? ZH : EN;
}
