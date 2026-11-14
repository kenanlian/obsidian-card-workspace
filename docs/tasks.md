# Tasks / 任务

Open a folder or a card box and press **Task view** in the toolbar. The button stays pressed while that source shows tasks instead of note cards. On a phone, and on a tablet whose toolbar is narrower than 640 pixels, the same action is a checked item in **More actions**. Outgoing links and backlinks have no task view.

Every folder uses one shared task view, sort, and grouping. That choice stays on the device, with the other view preferences. Each card box stores its own. A box you have not switched yet stays on cards, with **Due date** / **Ascending** and **None** for grouping, even when folders are already in task view. Switching a box does not change the folder setting.

The first time a folder or box enters task view, the stream shows **Reading tasks...** until every Markdown file in that source has been checked. The list then appears all at once. Files with no checkbox tasks are skipped and not read. Later notes that join the same source are picked up without returning to that reading state. **No tasks here yet.** means the source has no tasks. **No tasks match the current search or filters.** means tag filters, property filters, or the task filter removed all of them.

## What a task card shows

Each card is one root checkbox task. Nested checkbox tasks appear under it as subtasks, and the footer counts them as completed/total, announced as **1 of 3 subtasks complete**. A card without subtasks has no footer unless **Show source note on task cards** is on. A list item that is not a checkbox is omitted. A checkbox nested under a plain bullet stays under the nearest checkbox ancestor, or becomes its own card when there is no checkbox above it. Only Markdown files contribute tasks.

A status character other than a single space counts as done. `- [x]`, `- [-]`, and `- [/]` are all complete; `- [ ]` is not. The marker may be `-`, `*`, `+`, or a number, including inside a blockquote. Checking an open task writes `[x]`. Unchecking writes `[ ]`, including when the line was `[-]` or `[/]`. Checking or unchecking one line does not change its parent or its children. The count is only a tally.

The card text is plain. Inline Markdown markers are removed, and a link shows its visible label. Dates and a trailing block id (`^block-id`) are left in the note and omitted from the text. **Show source note on task cards**, off by default, adds the note's name at the bottom of each card; clicking it opens the note. This setting is stored on each device. Clicking the task text, or pressing Enter or Space on it, opens that line. Ctrl/Cmd-click or middle-click opens a new tab, and so do **Open task** and **Open task in new tab** in the context menu. **Copy task text** copies the plain text and reports **Task text copied.** or **Could not copy the task text.**

The cursor moves to the line only when that line still contains the text from the last read. If it does not, the note still opens and the cursor stays where the editor puts it.

## Sort, group, filter, pins, and bulk

**Sort & group** in task view uses task fields. **Sort by** offers **Due date**, **Created date**, **Completed date**, **File**, and **Task text**. **Order** is **Ascending** or **Descending**. The default is **Due date**, **Ascending**. Tasks with no date for the chosen field stay last in either order. Equal values keep file order, then line order.

**Group by** offers **None**, **File**, **Status**, **Due date**, **Created date**, and **Completed date**. **Status** splits into **Incomplete** and **Completed**. **Due date** uses **Overdue**, **Today**, **Tomorrow**, **This week**, **Later**, and **No due date**. Tomorrow stays its own group even when it falls in the next week. **This week** follows Obsidian’s first day of the week. **Created date** and **Completed date** use the same **Day**, **Week**, **Two weeks**, **Month**, **Year**, and **Relative periods** choices as card time grouping, including Monday weeks and the two-week periods anchored to 5 January 1970. Tasks without that date land in **No created date** or **No completed date**. Those two date groupings follow **Ascending** or **Descending** only when you are also sorting by the same date; every other grouping keeps its fixed order. **Collapse all** and **Expand all** apply once groups exist.

Tag and property filters still select files before tasks are listed. The search box placeholder becomes **Filter tasks**. It matches the task text, any nested subtask’s text, or the file title, as a case-insensitive substring, and highlights those spans. It does not query the full-text index, and an index that is still building does not block it or show the index status. Grouping stays in place while a filter is typed. Leaving task view keeps the text in the box and treats it as an ordinary full-text search: a ready index runs that search, and an index that is not ready blocks a non-empty query the same way card search does.

Pins are not applied in task view, and task cards have no pin control. Saved pins are left as they are and apply again in card view. **Bulk actions** is hidden in the toolbar and in **More actions**, and entering task view leaves bulk mode.

## Dates on a card

Each task row has three date chips: **Created date** (➕), **Completed date** (✅), and **Due date** (📅). A set chip shows a short date, with the year when it is not this year. An open task’s due chip is marked **overdue** or **due today**. On a phone or tablet every chip stays visible. On desktop, an unset date on a subtask appears when that row is hovered or focused.

Click a chip to edit it. The picker is a month calendar with **Previous month**, **Next month**, **Today**, **Tomorrow**, **Next Monday**, and **Clear**. **Next Monday** is the Monday after today, so a Monday itself resolves seven days ahead. **Clear** is unavailable when the date is unset. Click outside or press Escape to close without saving. Clicking the same chip again closes the picker. Phones open it as a bottom sheet; other devices open a popover beside the chip. A failed save keeps the picker open and shows **Could not save the date. Try again.**

The write looks for the line that was indexed. If that line number now holds different text, the same line text is used when it occurs exactly once. If the text is gone, or it occurs more than once, the card reports **This task changed in the note. The list is refreshing.** A line that is no longer a checkbox reports **This line is no longer a task.** A missing note reports **The note for this task no longer exists.** Any other failure reports **Could not update the task.**

Checking a task card follows **Add completion date when checking off tasks**. When that setting is on, checking a task with no completion date writes today’s ✅ date, and unchecking removes the completion dates on that line. The setting row stays visible when **Enhanced task editing** is off, because task cards use it either way. It starts on.

## Editing tasks in a note

Task editing settings are in **Settings → Card Workspace → New notes and templates**, under **Tasks**. **Add created date to new tasks** and **Add completion date when checking off tasks** stay visible either way. **Task date buttons** and **Hide task date text** appear only while **Enhanced task editing** is on. **Show source note on task cards** is in the same group and does not depend on it.

**Insert task or convert lines to tasks** is an editor command. Run it from the command palette, assign a hotkey, or insert it through Obsidian’s core Slash commands plugin. It converts the cursor line, or every line touched by the selection, in one undo step. A selection that ends at the start of a line does not include that line. A blank line becomes `- [ ] `, with the cursor after the checkbox. An existing list marker gains a checkbox. Other text is prefixed with `- [ ] `, after any indent or blockquote. Headings, code fences, table rows, horizontal rules, and lines that are already tasks are left alone.

**Add created date to new tasks** makes that command append today’s created date (➕) when it creates or converts a task that does not already have one. The cursor stays before the date. The command remains available when **Enhanced task editing** is off.

**Enhanced task editing** is on by default. In Live Preview it adds **Task dates** buttons at the end of each task line for **Created date**, **Completed date**, and **Due date**. Source mode and reading view keep the Markdown text and do not show the buttons. **Task date buttons** chooses **Compact** or **Full**. **Compact** shows an unset date only on the hovered line, the line with the caret, or a focused button. **Full** always shows all three. A due date before today is marked overdue while the task is open. The buttons use the same calendar, including the phone bottom sheet. They are not drawn inside frontmatter, fenced code, or `$$` display math.

**Add completion date when checking off tasks** is on by default, and the editor applies it only while enhanced editing is also on. Checking a task in the editor adds today’s completion date (✅) in the same undo step, and unchecking removes the completion dates on that line. A line that already has a completion date, including one written by the Tasks plugin, is left as it is, so the two plugins do not stack a second ✅ date for the same check. The editor does not add or remove a completion date for undo, redo, paste, a drop into the editor, a remote or sync change, a change that is not added to editor history, a change that touches more than 20 lines or inserts or removes a line break, or a click that changes more than the status character. Typing or deleting the status is still recognized. Date buttons do not themselves trigger another completion-date edit.

**Hide task date text** is off by default. In Live Preview it hides valid task dates, together with the space before them, so the date buttons at the end of the line are the only place the dates show; a button's tooltip gives its date. The line that holds the caret or a selection still shows the date text, so it can be edited directly. Invalid dates stay visible. The underlying Markdown is unchanged.

## How dates are stored

Dates use the Obsidian Tasks emoji syntax and stay in the Markdown line:

```markdown
- [ ] Write the notes ➕ 2026-11-14 📅 2026-11-20
- [x] Ship the build ✅ 2026-11-14
  - [ ] Nested subtask
- [-] Cancelled, treated as done
```

A created date is ➕, a completion date is ✅, and a due date is written as 📅. A due date written as 📆 or 🗓 is still read as due, and editing it rewrites that token as 📅. The date is `YYYY-MM-DD`. The first valid date of each kind is the one the card and the buttons use. Other Tasks fields, such as priority, recurrence, start, and scheduled, stay in the task text and are not separate chips. Disabling Card Workspace leaves every character in the note. The task stream, the command, the buttons, and the automatic completion date stop with the plugin.

## Limits

Linked-note sources cannot switch to task view. Checkbox tasks inside frontmatter, fenced code, or display math do not get Live Preview buttons. Parent and child checkboxes stay independent. A physical phone or tablet still needs its own check for **More actions**, the bottom-sheet calendar, touch chips, and Live Preview buttons. A resized desktop window does not stand in for that.
