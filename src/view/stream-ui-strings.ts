/** Labels shared by the desktop stream surface and its host menus. */
export interface StreamUiStrings {
  createAt: string; splitAt: string; moveAt: string; sides: Record<"left" | "right" | "top" | "bottom", string>;
  dragStream: string;
  switcher: string;
  create: string;
  reopen: string;
  current: string;
  collapsed: string;
  expand: string;
  pending: string;
  maximize: string;
  restore: string;
  collapse: string;
  duplicate: string;
  rename: string;
  close: string;
  moveToPane: string;
  copyToPane: string;
  moveLeft: string;
  moveRight: string;
  toggleNavigation: string;
  resize: string;
  resizeHelp: string;
  empty: string;
  unsupported: string;
  recovery: string;
}
const EN: StreamUiStrings = {
  createAt: "New stream at…", splitAt: "Split stream at…", moveAt: "Move stream to…", sides: {left:"Left",right:"Right",top:"Above",bottom:"Below"},
  dragStream: "Drag to move stream", switcher: "Card streams", create: "New stream…", reopen: "Reopen closed stream", current: "Current target",
  collapsed: "Collapsed", expand: "Expand stream", pending: "Loading…",
  maximize: "Maximize stream", restore: "Restore streams", collapse: "Collapse stream", duplicate: "Split stream",
  rename: "Rename stream", close: "Close stream", moveToPane: "Move to a new pane", copyToPane: "Copy to a new pane",
  moveLeft: "Move left", moveRight: "Move right",
  toggleNavigation: "Toggle source navigation", resize: "Resize stream", resizeHelp: "Use arrow keys to resize; hold Shift for larger steps.",
  empty: "Create a stream to start browsing cards.", unsupported: "This saved workspace was created by a newer version.", recovery: "Open a recovery stream",
};
const ZH: StreamUiStrings = {
  createAt: "在指定位置新建…", splitAt: "在指定位置拆分…", moveAt: "移动到…", sides: {left:"左侧",right:"右侧",top:"上方",bottom:"下方"},
  dragStream: "拖动以移动卡片流", switcher: "卡片流", create: "新建卡片流…", reopen: "重新打开已关闭的卡片流", current: "当前目标",
  collapsed: "已折叠", expand: "展开卡片流", pending: "加载中…",
  maximize: "最大化卡片流", restore: "还原卡片流", collapse: "折叠卡片流", duplicate: "拆分卡片流",
  rename: "重命名卡片流", close: "关闭卡片流", moveToPane: "移至新窗格", copyToPane: "复制到新窗格",
  moveLeft: "向左移", moveRight: "向右移",
  toggleNavigation: "切换来源导航", resize: "调整分屏大小", resizeHelp: "使用方向键调整大小；按住 Shift 可加大步长。",
  empty: "创建卡片流，开始浏览卡片。", unsupported: "此工作区由较新版本保存。", recovery: "打开恢复卡片流",
};
export function getStreamUiStrings(language: string): StreamUiStrings {
  return language.toLowerCase().startsWith("zh") ? ZH : EN;
}
