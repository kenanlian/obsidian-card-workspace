# Diagram card previews / 图形卡片预览

Canvas cards render text/file/link/group nodes and valid connections from their JSON. Referenced files and external links are never read. Group backgrounds are drawn first; labels are shortened to 80 characters. Empty canvases, invalid files and oversized sources show a localized message.

Excalidraw cards use same-directory SVG exports in this order:

| Scene | Preferred export | Alternate export |
| --- | --- | --- |
| `Drawing.excalidraw` | `Drawing.svg` | `Drawing.excalidraw.svg` |
| `Drawing.excalidraw.md` | `Drawing.excalidraw.svg` | `Drawing.svg` |

The scene body is never read or decompressed. If neither export exists, enable SVG auto-export in Excalidraw, then edit and save the drawing once, or manually export an SVG. Enabling auto-export alone does not generate exports for existing drawings. Card Workspace does not install or configure Excalidraw or trigger export. Export create/modify/delete/rename events refresh dependent previews, including changes that preserve file stats. SVG remains an attachment and does not enter card lists or the search index.

Excalidraw previews remove the standard export's canvas background in memory so the preview surface shows through. Recognition requires the `svg-source:excalidraw` marker and a plain, full-viewBox background rectangle before the drawing content. Drawing fills and unrecognized background structures are preserved; the SVG file on disk is unchanged. An export containing only the recognized background shows the empty-diagram message.

Both diagram types always occupy a 160px inline region beneath the title with `contain`, independently of Markdown card image mode, fit and text line settings. Links scopes retain their reference-list previews. Canvas, Excalidraw and Base search stays title-only.

Canvas JSON and exported SVG each have a 512 KiB UTF-8 limit checked before and after reading. Canvas draws at most 200 valid nodes and 400 valid connections and reports shortened previews. Diagram reads share the five-task preview queue and first-six-card startup prewarm. The per-view 512-entry preview LRU has an additional 16 MiB diagram Blob budget; display URLs exist only for the image viewport and are released on unmount or closing the view. No diagram data is persisted.

Right-click a navigation folder, the vault root, the folders section heading or a favorite folder and choose **New Excalidraw file**. This creates an `.excalidraw.md` drawing with the localized Untitled name and opens it in a new tab. The Markdown container includes `excalidraw-plugin: parsed` frontmatter, the `excalidraw` tag, the standard warning banner, an empty Text Elements section and an uncompressed empty scene in the Drawing section's `json` code block. Name conflicts add numeric suffixes before the complete extension, such as `Untitled 1.excalidraw.md`. Existing files are not converted.

## 隔离测试 vault 验收

1. 在独立测试 vault 的 `.obsidian/plugins/card-workspace/` 中放入本交付构建的 `main.js`、`manifest.json` 和 `styles.css`，启用插件。不要覆盖日常 vault。
2. 新建含文本、文件、链接和分组节点以及连线的 Canvas；在 Card Workspace 打开其文件夹，检查标题下的缩略图、节点相对位置和箭头。空 Canvas 应显示空状态；坏 JSON 和大于 512 KiB 的文件应显示相应提示。
3. 放入 `图.excalidraw` 与同目录的 `图.svg`，以及 `图.excalidraw.md` 与 `图.excalidraw.svg`。对 `.excalidraw.md` 同时提供内容不同的 `图.excalidraw.svg` 和 `图.svg`，确认前者优先；移除前者后应显示后者。修改、删除、恢复及重命名 SVG，确认自动更新。两者都缺失时应完整显示提示：「未找到 SVG 预览。请开启 Excalidraw 的 SVG 自动导出，并编辑保存一次绘图，或手动导出 SVG。」将界面语言切换为英文检查对应提示。
4. 将卡片图片模式依次设为 off/right/inline、fit 设为 cover，文字预览设为 0 行；图形仍应固定内联并完整显示。检查 Markdown 图片、Base 占位、标题搜索与 Links 引用列表仍按原方式工作。滚动卡片流并快速切换文件夹，确认无旧图闪回或滚动跳位。
5. 在隔离测试库启用本机新版 Excalidraw 插件。从普通目录、库根目录、文件夹分区标题、收藏文件夹菜单新建 Excalidraw；连续新建检查 `未命名.excalidraw.md`、`未命名 1.excalidraw.md` 等完整后缀，确认目标路径正确并在新标签直接打开空绘图，无格式错误。绘制图形、保存并重新打开，确认内容保留。切换英文后重复，检查本地化 Untitled 名称及菜单。从 box/links 导航菜单创建时应先切换至目标文件夹。真实宿主验收由用户执行，自动化测试不替代此步骤。
