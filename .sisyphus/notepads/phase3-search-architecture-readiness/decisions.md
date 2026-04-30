
## Obsidian Plugin Lifecycle & Service Ownership Patterns

**Date**: 2026-04-18  
**Purpose**: Authoritative references for plugin-owned `SearchService` init/dispose seam

---

### 1. Official Documentation Sources

#### Primary: Component Class (Base for Plugin)
- **URL**: https://docs.obsidian.md/Reference/TypeScript+API/Component
- **Source**: Obsidian Developer Docs (official)
- **Key Insight**: `Plugin` extends `Component`, which provides automatic resource cleanup

#### Reference: Plugin Class
- **URL**: https://docs.obsidian.md/Reference/TypeScript+API/Plugin
- **Source**: Obsidian Developer Docs (official)

#### Sample Plugin Implementation
- **URL**: https://github.com/obsidianmd/obsidian-sample-plugin/blob/dc2fa22c4d279199fb07a205a0c11eb155641f3d/src/main.ts
- **Source**: Official Obsidian sample plugin
- **Commit**: `dc2fa22c4d279199fb07a205a0c11eb155641f3d`

---

### 2. Core Lifecycle Methods

From official docs and sample plugin:

```typescript
export default class MyPlugin extends Plugin {
  async onload() {
    // Initialization happens here
    // - Load settings
    // - Register commands
    // - Register events
    // - Initialize plugin-owned services
  }

  onunload() {
    // Cleanup happens here
    // Note: Most cleanup is AUTOMATIC for registered resources
  }
}
```

**Key Principle**: `onload()` is async-capable; `onunload()` is synchronous.

---

### 3. Resource Registration Methods (Automatic Cleanup)

The `Component` class (inherited by `Plugin`) provides these registration methods:

| Method | Purpose | Cleanup Behavior |
|--------|---------|------------------|
| `register(cb)` | Register custom cleanup callback | Calls callback on unload |
| `registerEvent(eventRef)` | Register Obsidian event listener | Detaches event on unload |
| `registerDomEvent(el, type, cb)` | Register DOM event listener | Removes listener on unload |
| `registerInterval(id)` | Register `setInterval` ID | Clears interval on unload |
| `addChild(component)` | Add child component | Unloads child on unload |

**Source**: https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/TypeScript%20API/Component.md

---

### 4. Minimal Plugin-Owned Service Pattern

For a `SearchService` that must be initialized and disposed by the plugin host:

```typescript
// main.ts - Plugin owns service lifecycle
export default class MyPlugin extends Plugin {
  private searchService: SearchService;

  async onload() {
    // Initialize service
    this.searchService = new SearchService(this.app);
    
    // Register service's event listeners through the service
    this.searchService.registerEvents((eventRef) => {
      this.registerEvent(eventRef);
    });
    
    // Register custom cleanup for service disposal
    this.register(() => {
      this.searchService.dispose();
    });
  }
}

// SearchService.ts - Service exposes registration seam
class SearchService {
  constructor(private app: App) {
    // Initialization
  }
  
  registerEvents(register: (eventRef: EventRef) => void): void {
    // Service creates its own event refs
    register(this.app.vault.on('create', this.handleCreate));
    register(this.app.vault.on('delete', this.handleDelete));
    register(this.app.vault.on('rename', this.handleRename));
  }
  
  dispose(): void {
    // Manual cleanup for non-registered resources
    // (Events are auto-cleaned by plugin's registerEvent)
  }
}
```

---

### 5. Key Guidelines from Official Docs

From "Plugin guidelines" (https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines):

> "Any resources created by the plugin, such as event listeners, must be destroyed or released when the plugin unloads. When possible, use methods like `registerEvent()` or `addCommand()` to automatically clean up resources when the plugin unloads."

**Critical Rule**: 
- Use `register*()` methods for automatic cleanup
- Only manual cleanup needed for resources NOT registered through Component methods
- `onunload()` should be minimal - most cleanup happens automatically

---

### 6. Recommended Service Interface

Based on official patterns, a minimal service seam:

```typescript
interface PluginService {
  // Called during plugin.onload()
  initialize(): void;
  
  // Service receives register function from plugin
  // Service creates events, plugin registers them for auto-cleanup
  registerEvents(register: (eventRef: EventRef) => void): void;
  
  // Called via this.register(() => service.dispose()) in plugin
  dispose(): void;
}
```

---

### 7. Summary for SearchService Design

1. **Plugin owns lifecycle**: `main.ts` creates/disposes the service
2. **Service exposes registration seam**: Service creates events, plugin registers them
3. **Use `register()` for service disposal**: Wrap service.dispose() in a callback
4. **Keep `onunload()` minimal**: Rely on automatic cleanup for registered resources
5. **No manual event cleanup**: Events registered via `registerEvent()` auto-clean

---

## Task 4 Decision: Keep SearchService Contract Narrow and Fallback-First

**Date**: 2026-04-18

### Decision

Introduce a minimal plugin-owned search seam in `src/search/` with a no-index adapter (`NoIndexSearchService`) and defer all persistent/indexed implementation details.

### Why

- Satisfies lifecycle ownership requirements now (`initialize`/`dispose`) without forcing `main.ts` lifecycle wiring ahead of Task 5.
- Preserves coordinator boundaries: views can submit query inputs but the service does not own query/panel state.
- Keeps future indexed mode compatible by standardizing `orderedPaths + optional scores` as the return shape.
- Explicit `orderedPaths: null` fallback signal avoids introducing a second card-visibility path before indexed infrastructure exists.

### Scope Guardrail

No IndexedDB, MiniSearch, schema, rebuild command, worker, or tokenizer work was added in this task.

## Task 6 Decision (2026-04-18)
- Keep hardening scope test-only: add exactly one combined tag+search+pin regression assertion and avoid production-code changes because invariants were already implemented.
