# File types / 文件类型

**Settings → Card Workspace → Show file types** controls folders, card boxes, and outgoing/backlink lists. The default for new installations and upgrades is **Common formats**.

| Setting | Files shown |
| --- | --- |
| Documents only | Markdown (`.md`), Bases (`.base`), Canvas (`.canvas`), and Excalidraw (`.excalidraw`, `.excalidraw.md`) |
| Common formats | Documents plus formats registered by Obsidian and installed plugins |
| All formats | Every file exposed by the Vault API, including unknown extensions and extensionless files |

Common formats retain Obsidian's native images, PDF, audio, and video formats as a fallback when its registry is unavailable. Refresh Card Workspace after enabling or disabling a plugin that registers file types. The setting does not change Obsidian's own file visibility or scan hidden directories.

Changing the setting hides or reveals cards without removing favorites, pins, or manual box membership. Existing scope rules, tags, properties, and search still apply. Non-Markdown files have title-only search; their binary contents are never read for indexing. Markdown retains full-text search. Obsidian-supported formats open in the host; other formats open through the system default application.

Image files support previews for AVIF, BMP, GIF, JPEG/JPG, PNG, SVG, and WebP. They follow **Card images** (Off / Right thumbnail / Below title) and **Image fit**. Animated images have static first-frame thumbnails. See [Card images](card-images.md) for limits and caching. PDF, audio, video, and other formats show a file card with a type icon and extension; they do not have content previews or players.

## 中文

在 **设置 → Card Workspace → 显示文件类型** 中选择显示范围，统一作用于文件夹、卡片盒和出链／反链列表。新安装和升级均默认使用“常规格式”。

| 档位 | 显示范围 |
| --- | --- |
| 仅文档 | Markdown（`.md`）、Base（`.base`）、Canvas（`.canvas`）、Excalidraw（`.excalidraw`、`.excalidraw.md`） |
| 常规格式 | 文档，以及 Obsidian 和已安装插件注册支持的格式 |
| 全部格式 | Vault API 提供的全部文件，包括未知扩展名和无扩展名文件 |

宿主注册表不可用时，常规格式仍包含原生图片、PDF、音频和视频。启用或禁用注册文件类型的插件后，请刷新 Card Workspace。此设置不修改 Obsidian 自身的文件显示设置，也不扫描隐藏目录。

切换档位只隐藏或显示卡片，保留收藏、置顶和手动入盒记录；原有作用域规则、标签、属性和搜索继续生效。非 Markdown 文件仅索引标题，不为搜索读取二进制正文；Markdown 保持全文搜索。宿主支持的格式在 Obsidian 中打开，其他格式交给系统默认应用。

图片卡片支持 AVIF、BMP、GIF、JPEG/JPG、PNG、SVG 和 WebP，跟随“卡片图片”的关闭／右侧缩略图／标题下方设置，以及“图片显示方式”。动图只显示静态首帧。大小限制和缓存见[卡片图片](card-images.md)。PDF、音频、视频和其他格式先显示类型图标、扩展名等文件信息，不提供正文预览或播放器。
