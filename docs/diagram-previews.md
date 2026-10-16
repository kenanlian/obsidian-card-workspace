# Diagram card previews / 图形卡片预览

Canvas cards render text/file/link/group nodes and valid connections from their JSON. Referenced files and external links are never read. Group backgrounds are drawn first; labels are shortened to 80 characters. Empty canvases, invalid files and oversized sources show a localized message.

Excalidraw cards use same-directory SVG exports in this order:

| Scene | Preferred export | Alternate export |
| --- | --- | --- |
| `Drawing.excalidraw` | `Drawing.svg` | `Drawing.excalidraw.svg` |
| `Drawing.excalidraw.md` | `Drawing.excalidraw.svg` | `Drawing.svg` |

The scene body is never read or decompressed. If neither export exists, install the Excalidraw plugin and enable SVG auto-export. Card Workspace does not install or configure it or trigger export. Export create/modify/delete/rename events refresh dependent previews, including changes that preserve file stats. SVG remains an attachment and does not enter card lists or the search index.

Both diagram types always occupy a 160px inline region beneath the title with `contain`, independently of Markdown card image mode, fit and text line settings. Links scopes retain their reference-list previews. Canvas, Excalidraw and Base search stays title-only.

Canvas JSON and exported SVG each have a 512 KiB UTF-8 limit checked before and after reading. Canvas draws at most 200 valid nodes and 400 valid connections and reports shortened previews. Diagram reads share the five-task preview queue and first-six-card startup prewarm. The per-view 512-entry preview LRU has an additional 16 MiB diagram Blob budget; display URLs exist only for the image viewport and are released on unmount or closing the view. No diagram data is persisted.

Right-click a navigation folder, the vault root, the folders section heading or a favorite folder and choose **New Excalidraw file**. This creates a valid empty `.excalidraw` scene with the localized Untitled name and opens it in a new tab. Name conflicts use numeric suffixes.

## 隔离测试 vault 验收

1. 在独立测试 vault 的 `.obsidian/plugins/card-workspace/` 中放入本交付构建的 `main.js`、`manifest.json` 和 `styles.css`，启用插件。不要覆盖日常 vault。
2. 新建含文本、文件、链接和分组节点以及连线的 Canvas；在 Card Workspace 打开其文件夹，检查标题下的缩略图、节点相对位置和箭头。空 Canvas 应显示空状态；坏 JSON 和大于 512 KiB 的文件应显示相应提示。
3. 放入 `图.excalidraw` 与同目录的 `图.svg`，以及 `图.excalidraw.md` 与 `图.excalidraw.svg`。检查导出 SVG 显示；修改、删除、恢复及重命名 SVG，确认自动更新。缺失时应提示「请安装 Excalidraw 插件并开启 SVG 自动导出」。将界面语言切换为英文检查对应提示。
4. 将卡片图片模式依次设为 off/right/inline、fit 设为 cover，文字预览设为 0 行；图形仍应固定内联并完整显示。检查 Markdown 图片、Base 占位、标题搜索与 Links 引用列表仍按原方式工作。滚动卡片流并快速切换文件夹，确认无旧图闪回或滚动跳位。
5. 从普通目录、库根目录、文件夹分区标题、收藏文件夹菜单新建 Excalidraw；连续新建检查数字后缀，确认目标路径正确、文件是合法空场景并在新标签打开。从 box/links 导航菜单创建时应先切换至目标文件夹。
