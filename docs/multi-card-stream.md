# Desktop card streams and independent panes

On desktop, one Card Workspace pane can retain several independent card streams with one shared source navigation. Phones and tablets keep the existing single-stream interface.

## Create and identify streams

A pane keeps the original two-column layout: source navigation on the left, card streams on the right. Each stream's own toolbar shows its title; clicking the title opens the stream menu. There is no separate stream list or workspace bar.

To open a source in a new stream:

- Middle-click any navigation row. Ctrl/Cmd-click does the same on folders, boxes, links and favorites. On tags and property values, Ctrl/Cmd-click still adds a filter, so use middle-click there.
- Choose **Open in a new card stream** from a navigation context menu. Tags and property values open over the entire vault, including subfolders, with only the chosen condition.
- Choose **New stream…** from a stream menu to pick a folder, box, tag, property value or links reference.
- **Split stream** duplicates the current stream's browsing conditions and reading position.

A new stream opens to the right of the current one, one card column wide (320 px), and becomes the current target. Existing streams keep their widths. When the pane sits in a sidebar, the sidebar widens to fit the new stream, leaving at least 400 px for the main workspace. Otherwise, and once that limit is reached, the stream row scrolls horizontally. Closing streams never shrinks the sidebar.

New streams start from the source's default arrangement with an empty search and filters. Repeated sources are allowed; default titles add a number to tell copies apart, and **Rename stream** changes only the stream's display name.

## Select, collapse and compare

Clicking or focusing inside a stream makes it the current target. With several streams, the current one has an accent line above its toolbar, and the other titles are muted. Navigation always controls the current stream in that pane. Moving keyboard focus into navigation or another Obsidian pane does not change the target. Choosing a stream from the menu or a command scrolls it into view.

The stream menu lists every stream (a check marks the current one) and offers:

- **Maximize stream** shows only that stream at the full pane width. **Restore streams** returns to the side-by-side row. While maximized, selecting another stream maximizes that one instead.
- **Collapse stream** shrinks it to a narrow vertical strip with its title. Clicking the strip expands and selects it; right-clicking opens its menu.
- **Move left** / **Move right** reorder streams; dragging a stream's title or strip does the same.
- **Close stream** removes it without deleting notes or boxes. Toolbars also show a close button when the pane has more than one stream.

Drag a thin separator between streams to change the width of the stream to its left (minimum 240 px). The outer right edge has no stream resize handle: use Obsidian's native sidebar divider to resize the sidebar. The last expanded stream stretches to fill spare space. There is no fixed stream-count limit, and streams never collapse automatically. Streams scrolled out of view pause their preview work. A narrow desktop pane uses the existing navigation/content switch.

All streams may be collapsed or closed. With no current target, choosing a navigation source creates a new stream. Closing or moving the last stream leaves an empty pane offering **New stream…**, **Reopen closed stream**, and the navigation toggle. **Reopen closed stream** restores up to ten recently closed streams in the same session; that history is cleared on restart.

## Independent browsing, shared notes

Each stream keeps its own source, subfolder inclusion, search, tag/property filters, card/task mode, sorting, grouping, collapsed groups, task filters and reading position. Changing these controls affects only that stream and does not change the defaults used by other streams or the box definition.

Notes, actual tags/properties, box members and rules, favorites, icons and appearance remain shared. Folder and links streams share existing global pins; box streams share that box's pins. Shared changes update relevant streams without clearing their browsing conditions. Collapsed streams refresh from current data when reopened.

New and duplicated links streams default to a fixed reference. A fixed reference stays unchanged when another note opens, while link results continue updating. Explicit follow mode tracks Obsidian's opened note and shows its reference and mode.

## Move or copy to a new pane

**Move to a new pane** creates a normal Obsidian leaf in the main workspace, preferably to the right of a recent editor in the same window. It transfers browsing conditions, reading position and temporary bulk selection. The source is removed only after the target is ready. Failed transfers preserve the source.

**Copy to a new pane** preserves the original and starts an independent copy without bulk selection. Menus and drag gestures are not transferred. Each pane has its own navigation. Global open-source commands ask for a target when multiple Card Workspace panes exist in the same window; cancelling changes nothing.

Normal Obsidian workspace restoration preserves each pane's streams, order, names, conditions, collapse and maximize choices, current target and widths. Missing sources show a repairable empty state. Missing reading anchors fall back to a nearby position. Temporary bulk selections and the recently closed history are not restored after restart.

## Keyboard and boundaries

Desktop commands also create, split, maximize/restore, collapse, close, reopen and transfer streams, or select the next/previous stream. They use the active Card Workspace pane and require a current target when operating on a stream; no shortcuts are assigned by default.

Stream titles and collapsed strips are buttons: Enter/Space opens the menu or expands the stream. **Move left** / **Move right** offer a keyboard alternative to dragging. Focused separators resize with Left/Right; Shift uses a larger step. Current and collapsed states have accessible labels as well as visual styling.

This version does not add moving streams into existing panes, drag-out detachment, operating-system windows or cross-window transfers, saved named stream groups, reopening entire closed panes, or cross-stream card drops that change membership. Existing note-opening destinations remain available.
