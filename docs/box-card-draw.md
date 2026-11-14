# Card box draws / 卡片盒抽卡

Open a card box and select the dice button (or **More → Draw cards** on phones).
Each box has its own method and group size in **Configure card box → Draw cards**.
The default is 5 cards; supported group sizes are 1–100.
The draw strip stays on one line: a method icon, progress, and the most important
status. Hover it for the full description.

- **Random each time**: independent random groups. Groups are local to the view and are discarded on exit.
- **Complete a round**: each visible member is drawn once per round. The last group may be smaller. The next draw starts a new round. Progress and the current group are saved.
- **Daily wander**: shares round progress with Complete a round, but generates one group per local calendar day. Reenter to get the next day's group; leaving the view open overnight does not replace it. Missed days do not accumulate.

Draw order ignores pins, sorting, grouping, and browse filters. Searching pauses the
current group and searches the full visible box; next-group actions are disabled.
Bulk operations affect the visible search results while searching, and the visible
current group otherwise. Clearing search restores the same group.

Departing members disappear without replacement unless the entire group leaves:
then a replacement group is generated, including in daily mode. If the pool is
empty, replacement waits for a member to join. File visibility changes only hide
cards and retain their progress. File and folder renames preserve recorded identity.

Reset requires confirmation and takes effect immediately, even if the configuration
modal is subsequently canceled. Other configuration edits take effect on Done.
Changing group size affects the next group. Duplicating a box copies its configuration
without its progress. Leaving the box or closing the view exits draw mode.

Progress lives in plugin data, so the synchronization service must include plugin
settings. When Obsidian reports an external settings change, the plugin loads the
final disk snapshot. Concurrent device histories are not merged. A failed save keeps
the group visible and offers Retry saving without drawing another group.

## 中文

在卡片盒工具栏点击骰子进入抽卡；手机可从「更多」进入。「配置卡片盒 → 抽卡」可设置方式和每组张数。抽卡栏保持单行，只显示方式图标、进度和最重要的一个状态；悬停可查看完整说明。

- **每次随机**：每组独立随机，组内不重复，退出即丢弃当前组。
- **轮完一遍再重复**：每轮不重复，最后一组可能不足 N 张；下次抽取才开始新轮。当前组和进度持久保存。
- **每日漫游**：共用轮次进度，每个本地自然日固定一组。跨午夜不会自动换组，重新进入时才生成新一天的一组，错过的日子不累积。

抽卡期间暂停浏览筛选和分组，置顶和排序不改变抽取顺序。搜索显示全盒搜索结果，暂停抽下一组；清空搜索恢复原组。批量操作只作用于当前可见结果。

成员部分离盒不补位，全部离盒立即补抽，每日漫游同样适用；池为空时等待成员加入。可见性隐藏不删除记录，也不触发补抽。重置确认后立即生效，取消配置弹窗不会撤销。多设备采用最终同步保留的数据，不合并历史。
