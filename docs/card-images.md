# Card images / 卡片图片

Since 1.3.4, **Card images** defaults to **Right thumbnail** (88 × 88 CSS pixels), and **Image fit** defaults to **Crop to fill**. Open Obsidian **Settings → Card Workspace → Card images** to switch to **Below title** (160 CSS pixels high) or **Off**. Choose **Show whole image** under **Image fit** to display the entire image within the same region. Notes without a supported local image reference keep their normal text layout. Columns remain aligned by rows, with each card keeping its own height.

从 1.3.4 起，**卡片图片**默认使用**右侧缩略图**（88 × 88 CSS 像素），**图片显示方式**默认为**裁切铺满**。可在 Obsidian **设置 → Card Workspace → 卡片图片**中切换为**标题下方内联图片**（固定高度 160 CSS 像素）或**关闭**；在**图片显示方式**中选择**完整显示**，可在相同区域内展示整张图片。没有受支持本地图片引用的笔记保留普通文字布局；多列仍按行排列，卡片保持各自高度。

The plugin uses Obsidian's cached body embeds to find the first resolvable local AVIF, BMP, GIF, JPEG, PNG, SVG, or WebP image, including Wiki embeds and Markdown images. Attachments may live outside the folder being browsed. Missing and unsupported references are skipped. Remote images, frontmatter cover fields, HTML images, and embedded notes are excluded. Animated images use their static first frame; standalone image cards use the same display settings and cache. A selected image that fails generation does not cause another attachment to be read.

插件通过 Obsidian 的正文嵌入缓存寻找第一张可解析的本地 AVIF、BMP、GIF、JPEG、PNG、SVG 或 WebP，支持 Wiki 嵌入和 Markdown 图片，附件可以位于当前文件夹之外。缺失或不支持的引用会被跳过。远程图片、frontmatter 封面字段、HTML 图片和嵌入笔记不显示。动图使用静态首帧；独立图片卡片沿用相同的显示设置和缓存。已选中图片生成失败时，不继续读取其他附件。

Originals are limited to **50,000,000 bytes** and **50,000,000 pixels**. Mounted cards reserve a blank image region as soon as cached metadata identifies a supported local image within the file-size budget, before thumbnail loading starts. Missing references and files outside the byte budget get no region. Raster dimensions and animation frame bounds are checked in a Worker before decoding; SVG sources are limited to 512 KiB, sanitized on the host and rasterized to a bounded static thumbnail; rejected images and loading failures keep an unavailable region of the same size. Decoded images fade in over 240 ms, or appear immediately when reduced motion is enabled. Clicking an image opens its card's file.

原图上限为 **50,000,000 字节、50,000,000 像素**。进入渲染范围的卡片通过缓存的图片引用和文件大小提前保留空白区域，不等待缩略图加载。缺失引用和字节超限的文件不占位。Worker 在解码前检查栅格图片尺寸和动画帧边界；SVG 源文件限制为 512 KiB，在宿主中净化并生成有界静态缩略图；后续检查不通过或加载失败时保留相同大小的不可用区域。图片解码完成后用 240ms 淡入；开启减少动态效果时直接显示。点击图片沿用卡片打开笔记的行为。

Only visible rows and one neighboring row on either side request images. Cold generation waits for visible text and a foreground paint, with one original read/generation task across the plugin. Thumbnails preserve aspect ratio, never enlarge small images, and have a maximum edge of 1024 pixels. WebP at quality 0.85 is preferred, with PNG as the encoding fallback. First generation of a large image still costs a disk read and decode.

图片只在可见行及前后各一行按需加载。冷生成后置于可见文字补齐与前台绘制，同一插件最多运行一个原图读取／生成任务。缩略图保持比例、不放大小图，最长边为 1024 像素，优先编码为质量 0.85 的 WebP，编码不可用时使用 PNG。大图首次生成仍有磁盘读取和解码成本。

Thumbnails stay local: memory holds at most 64 Blobs / 16 MiB, and a separate per-vault IndexedDB cache holds at most 2000 entries / 256 MiB. Matching cached thumbnails skip the original attachment read. Changing layout, fit, preview lines, or search query does not regenerate thumbnails. The browser display URLs are shared for repeated attachments within a view and released when demand leaves, the view closes, or images are disabled. Each cold task terminates its Worker after completion to release native decoder buffers; the last view using images closes the database connection. Cache storage failure falls back to bounded memory; an unavailable Worker displays existing thumbnails only. No original image is used as a fallback.

缩略图保存在本地：内存最多保留 64 个 Blob／16 MiB，独立、按仓库隔离的 IndexedDB 缓存最多保留 2000 条／256 MiB。命中缓存时不重读原图。布局、显示方式、预览行数及搜索词变化不会重新生成缩略图。同一视图中重复附件共享显示 URL，离开需求范围、关闭视图或关闭功能时释放；每个冷任务完成后终止其 Worker，以释放浏览器解码器的原生缓冲区，最后一个使用图片的视图退出后关闭数据库连接。持久化失败时使用受限内存缓存；Worker 不可用时只显示已有缩略图，不回退显示原图。
