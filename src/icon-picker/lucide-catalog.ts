import { getIconIds } from "obsidian";
import { lucideBaseName, normalizeIconSpec, type IconCategory } from "../icon-config";

export interface LucideEntry { id: string; name: string; tokens: string[]; keywords: string }

const COMMON = ["star", "heart", "bookmark", "flag", "lightbulb", "sparkles", "zap", "flame", "target", "rocket", "brain", "book-open",
  "notebook-pen", "library", "graduation-cap", "briefcase", "calendar", "clock", "list-todo", "circle-check", "inbox", "archive",
  "code", "terminal", "palette", "pen-tool", "music", "camera", "film", "globe", "map-pin", "house", "users", "message-circle",
  "mail", "coffee", "leaf", "sun", "moon", "cloud", "shield", "key", "lock", "wrench", "layers", "puzzle", "trophy", "gift"];
const BY_CATEGORY: Partial<Record<IconCategory, string[]>> = {
  folder: ["folder", "folder-open", "folder-heart", "folder-kanban", "folder-git-2", "folder-archive", "folder-lock", "folder-code"],
  tag: ["tag", "tags", "hash", "bookmark", "flag", "circle-dot"],
  property: ["list", "list-tree", "sliders-horizontal", "database", "table", "braces"],
  "property-value": ["dot", "circle", "square", "triangle", "diamond", "hexagon", "circle-check", "circle-x"],
  box: ["box", "package", "archive", "inbox", "container", "gallery-thumbnails"],
  backlinks: ["links-coming-in", "arrow-down-left", "undo-2", "link"],
  outgoing: ["links-going-out", "arrow-up-right", "redo-2", "external-link"],
  template: ["file-plus-2", "layout-template", "stamp", "copy", "clipboard-list"],
  markdown: ["file-text", "notebook", "sticky-note", "scroll-text", "book-text"],
  base: ["layout-list", "table-2", "database"], canvas: ["layout-dashboard", "frame", "network"],
  excalidraw: ["pen-tool", "brush", "shapes"], image: ["image", "images", "camera"], pdf: ["file-text", "book", "file-type"],
  audio: ["file-audio", "music", "headphones", "mic"], video: ["file-video", "film", "clapperboard", "video"], file: ["file", "paperclip", "file-archive"],
};
/** Bilingual keywords for common glyphs; the ID tokens already cover English names. */
const KEYWORDS = "folder:文件夹 目录|folder-open:打开 文件夹|folder-heart:收藏 喜欢 文件夹|folder-kanban:项目 看板|folder-archive:归档|folder-lock:私密 加密|folder-code:代码 项目|"
  + "tag:标签|tags:标签|hash:井号 话题 标签|bookmark:书签 收藏|flag:旗帜 标记 重要|star:星 收藏 重要|heart:心 喜欢 爱|lightbulb:灯泡 想法 灵感 创意|"
  + "sparkles:闪光 灵感 魔法 ai|zap:闪电 快速 能量|flame:火 热门|target:目标 靶子|rocket:火箭 启动 项目|brain:大脑 思考 知识|book:书 阅读|book-open:书 阅读 学习|"
  + "book-text:书 文档|notebook:笔记本 笔记|notebook-pen:笔记 日记 写作|library:图书馆 书库 资料|graduation-cap:学习 毕业 课程 学校|briefcase:工作 公文包 职业|"
  + "calendar:日历 日程 日期|clock:时钟 时间|list-todo:待办 任务 清单|circle-check:完成 勾选 已完成|inbox:收件箱 收集|archive:归档 存档|code:代码 编程|"
  + "terminal:终端 命令行|palette:调色板 设计 颜色 艺术|pen-tool:钢笔 设计 绘图|music:音乐|camera:相机 拍照 摄影|film:电影 影片|globe:地球 网络 世界|"
  + "map-pin:地点 位置 地图|house:家 主页 首页|users:用户 团队 人|user:用户 个人|message-circle:消息 聊天 评论|mail:邮件 邮箱|coffee:咖啡 休息|"
  + "leaf:叶子 自然 植物|sun:太阳 白天|moon:月亮 夜晚|cloud:云|shield:盾牌 安全|key:钥匙 密码|lock:锁 私密|wrench:扳手 工具 设置|settings:设置 齿轮|"
  + "layers:图层 层级|puzzle:拼图 插件|trophy:奖杯 成就|gift:礼物|file:文件|file-text:文档 文本 笔记|sticky-note:便签 便利贴|scroll-text:卷轴 文稿|"
  + "image:图片 图像|images:图片 相册|file-audio:音频|headphones:耳机 音频|mic:麦克风 录音|video:视频|file-video:视频|clapperboard:场记板 视频|"
  + "box:盒子 卡片盒|package:包裹 盒子|container:容器|list:列表 属性|list-tree:树 层级|database:数据库 数据|table:表格|table-2:表格|braces:花括号 代码 数据|"
  + "sliders-horizontal:滑块 调整 属性|dot:点|circle:圆|square:方块|triangle:三角|diamond:菱形|hexagon:六边形|circle-x:取消 错误|link:链接|"
  + "links-coming-in:反链 入链|links-going-out:出链|external-link:外部链接|file-plus-2:新建 模板|layout-template:模板 布局|stamp:印章 模板|copy:复制|"
  + "clipboard-list:剪贴板 清单|layout-list:列表 base|layout-dashboard:画布 看板 canvas|frame:框架|network:网络 关系图|brush:画笔|shapes:形状|"
  + "paperclip:附件 回形针|search:搜索|bell:铃铛 提醒 通知|pin:图钉 固定|trash-2:删除 垃圾桶|pencil:铅笔 编辑|quote:引用 引号|chart-column:图表 统计|"
  + "dollar-sign:钱 财务 美元|wallet:钱包 财务|shopping-cart:购物车 购物|plane:飞机 旅行|car:汽车|bike:自行车 运动|dumbbell:健身 运动|utensils:餐具 美食 吃饭|"
  + "gamepad-2:游戏|tv:电视|smile:笑脸 表情|bug:虫子 bug 问题|cpu:芯片 硬件|smartphone:手机|laptop:笔记本电脑|server:服务器|git-branch:分支 git|"
  + "kanban:看板|goal:目标|compass:指南针 探索|mountain:山 户外|tree-pine:树 自然|flower-2:花|cat:猫|dog:狗|baby:婴儿|stethoscope:医疗 健康|pill:药 健康";
const keywordMap = new Map(KEYWORDS.split("|").map(entry => entry.split(":") as [string, string]));

export interface LucideCatalog {
  entries: LucideEntry[];
  suggested: (category: IconCategory | undefined) => LucideEntry[];
  search: (query: string) => LucideEntry[];
}
/** Built per picker session because plugins may register icons at any time. Only IDs that survive settings normalization are offered. */
export function createLucideCatalog(): LucideCatalog {
  const byName = new Map<string, LucideEntry>();
  for (const id of getIconIds()) {
    if (!normalizeIconSpec({ kind: "lucide", value: id })) continue;
    const name = lucideBaseName(id);
    const existing = byName.get(name);
    if (existing && !(id.startsWith("lucide-") && !existing.id.startsWith("lucide-"))) continue;
    byName.set(name, { id, name, tokens: name.split("-"), keywords: keywordMap.get(name) ?? "" });
  }
  const entries = Array.from(byName.values());
  return {
    entries,
    suggested: category => {
      const seen = new Set<string>();
      return [...(category ? BY_CATEGORY[category] ?? [] : []), ...COMMON].flatMap(name => {
        const entry = byName.get(name);
        if (!entry || seen.has(name)) return [];
        seen.add(name); return [entry];
      });
    },
    search: query => {
      const needle = query.trim().toLowerCase();
      if (!needle) return entries;
      const compact = needle.replace(/\s+/g, "-");
      const terms = needle.split(/[\s-]+/).filter(Boolean);
      const scored: Array<{ entry: LucideEntry; score: number; order: number }> = [];
      entries.forEach((entry, order) => {
        let score = -1;
        if (entry.name === compact) score = 0;
        else if (entry.name.startsWith(compact)) score = 1;
        else if (terms.every(term => entry.tokens.some(token => token.startsWith(term)))) score = 2;
        else if (entry.name.includes(compact)) score = 3;
        else if (entry.keywords && terms.every(term => entry.keywords.includes(term))) score = 4;
        if (score >= 0) scored.push({ entry, score, order });
      });
      return scored.sort((a, b) => a.score - b.score || a.order - b.order).map(item => item.entry);
    },
  };
}
