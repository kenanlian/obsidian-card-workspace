# Custom content icons / 自定义内容图标

Click a navigation item's icon or a card's title icon to choose a Lucide icon or a
native emoji, or **No icon** to show the item as plain text. Hovering an icon shows a
square highlight plate sized from the glyph, so navigation and card icons look the same.
Clicking the same icon again closes the picker. **Change icon** is also in the item's
context menu (including favorites), next to the favorite and background options;
**Remove custom icon** appears there only when the item has its own icon, and removes
it directly without opening the picker. Keyboard users can open the tree row's
existing context menu with the menu key or Shift+F10. Expand arrows continue to expand
the tree. Clicking an icon never navigates, filters, opens a note, selects a bulk
item, or begins a card drag. Hover the title text or preview to preview a note.

The picker header shows the item being edited and its category. The **Icons** tab
lists recently used icons, suggestions for the item's category, and then every icon
the host provides. Search matches whole words in any order (`open folder` finds
`folder-open`) and common Chinese keywords. The **Emoji** tab has a category bar that
jumps to each section, and a skin-tone button whose choice is remembered. Paste a
single emoji into the search box and press Enter to use it; pasting on the Icons tab
switches to Emoji. The footer previews the hovered icon's name and offers **No icon**
(highlighted while active) and **Remove custom icon** (disabled when there is nothing
to remove). An item without an icon keeps **Change icon** in its context menu.

Choosing an icon saves it and closes the picker. Click outside or press Escape to
close without changing anything. Arrow keys move between candidates across sections,
Arrow Up from the first row returns to search, and Enter/Space confirms. Arrow keys
also switch the tabs. If saving fails, the picker stays open and shows **Retry
saving**, which writes the latest settings without reverting a newer selection. On
phones the picker opens as a bottom sheet and does not raise the keyboard until you
tap search.

Set category defaults in **Settings → Card Workspace → Default navigation icons** and
**Default card icons**. A reset button appears beside a category once it has a custom
default. Choose **No icon** for a category to show all its items as plain text; an
individual item can still override that with an icon. The order is **individual
override → category default → built-in icon**.
Resetting an item removes only its override; resetting a category removes only that
default. Nothing changes until you configure an icon.

Supported identities:

| Content | Individual identity |
| --- | --- |
| Folder (including vault root) | Folder path |
| Tag (including synthetic parents) | Full tag path |
| Property name | Normalized property key |
| Property value | Key + typed value (text `"1"`, number `1`, boolean, missing are distinct) |
| Card box | Stable box ID |
| Backlinks / outgoing links | Direction, independently |
| Template | Stable registration ID |
| Card title | File path, shared across folders, boxes, and links |

Favorites use their original object's icon. Folder/tag parents and property names
do not pass icons to their children. A template entry's icon is independent of its
underlying file's card icon. Category defaults for cards are separate for Markdown,
Base, Canvas, Excalidraw, image, PDF, audio, video, and other files.

Paused filters and links without an active file still allow icon configuration.
Sections, arrows, toolbar actions, status marks, group headings, and Obsidian's native
interfaces keep their existing icons. No frontmatter is read or written for icons.

The Emoji tab contains all **3,944 fully-qualified Unicode Emoji 17.0 sequences** with
CLDR 48 English/Chinese names and keywords. Paste a single flag, skin-tone or ZWJ
sequence into search; the picker recognizes the whole sequence and normalizes
variation selectors. Pasting multiple emoji shows a hint instead of a result. Appearance and glyph support depend on your operating system.
Lucide uses the host's installed icon catalogue; unavailable saved IDs fall back to
the built-in icon while preserving your choice for another host version.

Everything is offline. The first Emoji-tab opening parses the compact catalogue;
opening Lucide does not. Subsequent openings reuse the data, and both grids render a
bounded visible window. [Sources, generator, and Unicode license](../data/emoji/README.md)
are included in the repository.

Folder/file moves preserve overrides; deletion removes corresponding path overrides.
Box/template renames keep their stable IDs, and deleting a definition clears its
icon. A registered template whose file is temporarily missing keeps its icon.
Plugin tag renames migrate subtree icons; partial successes keep the old icons and
copy to the new paths, with an existing destination icon winning conflicts. Fully
successful tag deletion clears its subtree icons. External metadata changes and
objects absent from the current scope do not trigger identity guesses or pruning.
The picker closes when its target is renamed/deleted, its anchor leaves the view,
or the view/plugin closes.

---

点击导航条目或卡片标题的图标即可选择 Lucide 图标、原生 emoji，或选择 **无图标** 以纯文字显示；
悬停时出现按图标尺寸计算的正方形高亮底板（导航与卡片比例一致），再次点击同一图标会关闭弹层。
无图标的条目仍可通过右键菜单 **更改图标** 重新设置。右键菜单（含收藏）在收藏、背景色附近提供
**更改图标**；只有存在单独图标时才显示 **移除自定义图标**，且直接移除、不打开弹层。

弹层顶部显示正在编辑的对象与类别。**图标** 页依次列出最近使用、按类别推荐和全部图标，
搜索支持任意顺序的单词与常用中文关键词。**Emoji** 页提供分类条和会被记住的肤色按钮；
可直接把单个 emoji 粘贴进搜索框并回车。选中即保存并关闭；点击框外或按 Esc 关闭且不做更改；
保存失败时弹层保持打开并可重试。手机上以底部面板打开，不会自动弹出键盘。

在 **设置 → Card Workspace → 导航默认图标 / 卡片默认图标** 配置类别默认，已自定义的类别旁会出现
恢复按钮；类别默认也可设为 **无图标**，该类条目将全部显示为纯文字，单个条目仍可另设图标。优先级为 **逐项覆盖 → 类别默认 → 内置图标**；恢复默认仅删除当前层配置。父文件夹、父标签和
属性名不向下继承；收藏跟随原对象；模板图标与底层文件的卡片图标独立。

Emoji 使用离线 Unicode 17.0 与 CLDR 48 中英文名称、关键词数据，支持分类跳转、肤色和完整
组合粘贴。系统决定 emoji 的外观和支持程度。不修改笔记 frontmatter。

## Verification

Run the ordinary full CI chain, then the synthetic Chromium acceptance harness:

```sh
npm run lint && npm run check && npm run check:svelte && npm run build && npm test
node scripts/run-content-icons-browser.mjs /tmp/content-icons-report.json
```

The harness exercises the production CJS/Svelte/CSS with explicit host API substitutes
in desktop/phone/tablet viewports and light/dark themes. It checks choose-and-close,
reopening on the Emoji tab, whole-sequence paste, bounded rendering, icon-vs-title dragging, popup bounds, disabled
links, multiple views, and a second document. It asserts that icon updates do not read
or enumerate vault files or reproject cards. Physical phones/tablets, operating-system
safe areas/keyboards, and real Obsidian pop-out window acceptance remain manual checks;
a browser viewport and iframe do not substitute for those host/device checks.


Measured with Node 22.18.0 and Chromium 153.0.8010.12 on this Linux/WSL workspace:

| Measurement | Result |
| --- | --- |
| Baseline production CJS | 1,043,393 bytes |
| Production CJS with custom icons | 1,517,979 bytes |
| Bundle increase | 474,586 bytes (463.46 KiB, 45.48%) |
| Catalogue loader initialization (6 isolated browser samples) | 3.6–4.6 ms; median 4.1 ms |
| First Emoji-tab activation, including catalogue and bounded grid creation | 10.9–14.6 ms |
| Browser acceptance combinations | 6 (desktop/phone/tablet × light/dark) |

These are diagnostic measurements, not device guarantees. The loader probe uses the
same catalogue module in an isolated browser namespace; tab timing uses the production
picker. All six probes were uninitialized before measurement. Reports are written to
the caller's absolute output path; screenshots for dark-theme desktop/phone/tablet are
written to `/tmp/fce-content-icons-<device>.png` by the browser harness.
