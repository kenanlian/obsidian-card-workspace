<script lang="ts">
  import { getUiStrings } from "../i18n";
  import NavigationPane from "../view/NavigationPane.svelte";
  import type { PanelNavState, PanelScopeState } from "../view/panel-model";
  import type { NavigationIntent } from "../view/navigation-model";
  import type { NavContextMenuPayload } from "../view/types";

  interface Props {
    initialNav: PanelNavState;
    scope: PanelScopeState;
    activeFilterTags?: string[];
    onIntent?: (intent: NavigationIntent) => void;
    onMenu?: (payload: NavContextMenuPayload) => void;
    onResize?: (width: number) => void;
  }

  let {
    initialNav, scope, activeFilterTags = [], onIntent, onMenu, onResize,
  }: Props = $props();
  // svelte-ignore state_referenced_locally -- test harness deliberately snapshots its seed before explicit setNav calls
  let currentNav = $state(initialNav);

  export function setNav(next: PanelNavState): void {
    currentNav = next;
  }
</script>

<NavigationPane
  strings={getUiStrings("en")}
  nav={currentNav}
  {scope}
  {activeFilterTags}
  onNavigationIntent={onIntent}
  onNavContextMenu={onMenu}
  onNavPaneResize={onResize}
/>
