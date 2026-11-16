# Desktop card streams and independent panes

On desktop, one Card Workspace pane can retain several independent card streams with one shared source navigation. Phones and tablets keep the existing single-stream interface.

## Create and identify streams

Use **New stream** to choose a folder, box, tag, property value, or links reference. A source navigation context menu can also **Open in a new card stream**. Tags and property values open over the entire vault, including subfolders, with only the chosen condition.

New streams start from the source's default arrangement with an empty search and filters. Duplicating copies the current browsing conditions and reading position. The new stream is expanded and selected. The original remains available. Repeated sources are allowed; default titles distinguish copies, and **Rename stream** changes only the stream's research name.

## Select, collapse and compare

The vertical stream list appears above source navigation. Clicking a visible stream selects it without changing the tiled combination. Clicking a collapsed entry expands and selects it. Navigation always controls the selected stream in that pane. Moving keyboard focus into navigation or another Obsidian pane does not change the remembered target.

- **Show only this stream** explicitly collapses the others.
- **Tile this stream** preserves the others' expansion choices.
- **Collapse stream** hides its content but retains its context and list entry.
- **Close stream** removes it without deleting notes or boxes.

Streams can be reordered, arranged side by side or top to bottom, and resized with separators. There is no fixed stream-count limit. When space runs out, the current stream and more recently used streams stay visible first; other streams collapse with an explanation. Growing the pane restores streams that were collapsed for space, respecting subsequent manual choices. A narrow desktop pane uses the existing navigation/content switch and retains a stream-list button.

All streams may be collapsed or closed. With no current target, choosing a navigation source creates a new stream. Closing or moving the last stream leaves an empty pane. **Reopen closed stream** restores up to ten recently closed streams in the same session; that history is cleared on restart.

## Independent browsing, shared notes

Each stream keeps its own source, subfolder inclusion, search, tag/property filters, card/task mode, sorting, grouping, collapsed groups, task filters and reading position. Changing these controls affects only that stream and does not change the defaults used by other streams or the box definition.

Notes, actual tags/properties, box members and rules, favorites, icons and appearance remain shared. Folder and links streams share existing global pins; box streams share that box's pins. Shared changes update relevant streams without clearing their browsing conditions. Collapsed streams refresh from current data when reopened.

New and duplicated links streams default to a fixed reference. A fixed reference stays unchanged when another note opens, while link results continue updating. Explicit follow mode tracks Obsidian's opened note and shows its reference and mode.

## Move or copy to a new pane

**Move to a new pane** creates a normal Obsidian leaf in the main workspace, preferably to the right of a recent editor in the same window. It transfers browsing conditions, reading position and temporary bulk selection. The source is removed only after the target is ready. Failed transfers preserve the source.

**Copy to a new pane** preserves the original and starts an independent copy without bulk selection. Menus and drag gestures are not transferred. Each pane has its own navigation. Global open-source commands ask for a target when multiple Card Workspace panes exist in the same window; cancelling changes nothing.

Normal Obsidian workspace restoration preserves each pane's streams, order, names, conditions, expansion choices, current target and sizes. Missing sources show a repairable empty state. Missing reading anchors fall back to a nearby position. Temporary bulk selections and the recently closed history are not restored after restart.

## Keyboard and boundaries

Desktop commands also create, duplicate, collapse, close, reopen and transfer streams, or select the next/previous stream. They use the active Card Workspace pane and require a current target when operating on a stream; no shortcuts are assigned by default.

The stream list supports arrow keys, Home/End, Enter/Space and the context-menu key. Reorder buttons offer a keyboard alternative to pointer interaction. Focused separators resize with direction keys; Shift uses a larger step. Current and collapsed states have text and accessible labels as well as visual styling.

This version does not add moving streams into existing panes, drag-out detachment, operating-system windows or cross-window transfers, saved named stream groups, reopening entire closed panes, or cross-stream card drops that change membership. Existing note-opening destinations remain available.
