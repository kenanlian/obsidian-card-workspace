# Guides

Source: Obsidian developer docs (obsidian-developer-docs repo).

## Contents

- [Build a Bases view](#build-a-bases-view)
- [Defer views](#defer-views)
- [Optimize plugin load time](#optimize-plugin-load-time)
- [Store secrets](#store-secrets)
- [Support pop-out windows](#support-pop-out-windows)

## Build a Bases view

---
permalink: plugins/guides/bases-view
---
Bases is a core plugin in Obsidian which display dynamic views of your notes as tables, cards, lists, and more. If you're unfamiliar with Bases, please read about them in the [help docs](https://help.obsidian.md/bases) before getting started.

Plugins can use the Obsidian API to create completely custom views of the data powering Bases. In this guide, you'll walk through extending the sample plugin to create a simplified version of the list view.

## What you'll learn

After you've completed this guide, you'll be able to:

- Create a custom [Bases view](https://help.obsidian.md/bases/views).
- Dynamically render data from note properties in a list format.

## Prerequisites

To complete this guide, you'll need:

- [Git](https://git-scm.com/) installed on your local machine.
- A local development environment for [Node.js](https://Node.js.org/en/about/).
- A code editor, such as [Visual Studio Code](https://code.visualstudio.com/).

Additionally, this guide will build off of the sample plugin created in a previous guide. Follow the [[Build a plugin]] guide before starting this guide.

## Before you start

When developing plugins, one mistake can lead to unintended changes to your vault. To prevent data loss, you should never develop plugins in your main vault. Always use a separate vault dedicated to plugin development.

[Create an empty vault](https://help.obsidian.md/Getting+started/Create+a+vault#Create+empty+vault).

## Step 1: Sample plugin setup

In this guide it is assumed that you have a directory on your computer with the sample plugin and that you know how to build your plugin and test it in Obsidian.

For the purposes of this list view plugin, we can remove a large portion of the code from the `MyPlugin` class, leaving just the `onload` function.

```TypeScript
export default class MyPlugin extends Plugin {
  async onload() {
  }
}
```

## Step 2: Create and register the Bases view

Once you have an empty plugin which can be built and loaded into Obsidian, you can begin building a Bases view. Start with a view that statically displays "Hello World".

```TypeScript
export const ExampleViewType = 'example-view';

export default class MyPlugin extends Plugin {
  async onload() {
    // Tell Obsidian about the new view type that this plugin provides.
    this.registerBasesView(ExampleViewType, {
      name: 'Example',
      icon: 'lucide-graduation-cap',
      factory: (controller, containerEl) => {
        new MyBasesView(controller, containerEl)
      },
    });
  }
}

export class MyBasesView extends BasesView {
  readonly type = ExampleViewType;
  private containerEl: HTMLElement;

  constructor(controller: QueryController, parentEl: HTMLElement) {
    super(controller);
    this.containerEl = parentEl.createDiv('bases-example-view-container');
  }

  // onDataUpdated is called by Obsidian whenever there is a configuration
  // or data change in the vault which may affect your view. For now,
  // simply draw "Hello World" to screen.
  public onDataUpdated(): void {
    this.containerEl.empty();
    this.containerEl.createDiv({ text: 'Hello World' });
  }
}
```

Build your plugin, reload the app, and create a new Base file. Use the menu on the left of the toolbar, and select the right chevron next to the view in the list. From this menu, change the layout to your newly created "Example" view type.

## Step 3: Add configuration

The menu where you changed the view layout can also contain additional configuration options for your view. Add an `options` property in the call to `registerBasesView`.

In your IDE, you can view the definition of `ViewOption` to see the different controls available. Each control will create an entry in the view configuration menu, and user input will automatically be stored in the Bases configuration file.

```typescript
export default class MyPlugin extends Plugin {
  async onload() {
    // Tell Obsidian about the new view type that this plugin provides.
    this.registerBasesView(ExampleViewType, {
      name: "Example",
      icon: 'lucide-graduation-cap',
      factory: (controller, containerEl) => {
        new MyBasesView(controller, containerEl)
      },
      options: () => ([
        {
          // The type of option. 'text' is a text input.
          type: 'text',
          // The name displayed in the settings menu.
          displayName: 'Property separator',
          // The value saved to the view settings.
          key: 'separator',
          // The default value for this option.
          default: ' - ',
        },
        // ...
    ]),
    });
  }
}
```

![[example-bases-view-configuration.gif#interface]]

## Step 4: Display list items

The final step in creating a new Bases view is to transform the data from properties into the format you want to display. Obsidian will call the `onDataUpdated` method on your view whenever there are changes to the data. To keep this example simple, the code below clears the container, and rerenders a list entry for every file provided in the data set. It is important, however, to keep in mind the best practices of web development. An unfiltered Base will provide an entry for every file in the vault, so your view should be able to handle thousands of entries, reuse DOM elements, and avoid rendering off screen where appropriate.

```typescript
// Add `implements HoverParent` to enable hovering over file links.
export class MyBasesView extends BasesView implements HoverParent {

  hoverPopover: HoverPopover | null;

  // ...

  public onDataUpdated(): void {
    const { app } = this;

    // Retrieve the user configured order set in the Properties menu.
    const order = this.config.getOrder()

    // Clear entries created by previous iterations. Remember, you should
    // instead attempt element reuse when possible.
    this.containerEl.empty();

    // The property separator configured by the ViewOptions above can be
    // retrieved from the view config. Be sure to set a default value.
    const propertySeparator = String(this.config.get('separator')) || ' - ';

    // this.data contains both grouped and ungrouped versions of the data.
    // If it's appropriate for your view type, use the grouped form.
    for (const group of this.data.groupedData) {
      const groupEl = this.containerEl.createDiv('bases-list-group');
      const groupListEl = groupEl.createEl('ul', 'bases-list-group-list');

      // Each entry in the group is a separate file in the vault matching
      // the Base filters. For list view, each entry is a separate line.
      for (const entry of group.entries) {
        groupListEl.createEl('li', 'bases-list-entry', (el) => {
          let firstProp = true;
          for (const propertyName of order) {
            // Properties in the order can be parsed to determine what type
            // they are: formula, note, or file.
            const { type, name } = parsePropertyId(propertyName);
  
            // `entry.getValue` returns the evaluated result of the property
            // in the context of this entry.
            const value = entry.getValue(propertyName);
  
            // Skip rendering properties which have an empty value.
            // The list items for each file may have differing length.
            if (value.isEmpty()) continue;
  
            if (!firstProp) {
              el.createSpan({
                cls: 'bases-list-separator',
                text: propertySeparator
              });
            }
            firstProp = false;
  
            // If the `file.name` property is included in the order, render
            // it specially so that it links to that file.
            if (name === 'name' && type === 'file') {
              const fileName = String(entry.file.name);
              const linkEl = el.createEl('a', { text: fileName });
              linkEl.onClickEvent((evt) => {
                if (evt.button !== 0 && evt.button !== 1) return;
                evt.preventDefault();
                const path = entry.file.path;
                const modEvent = Keymap.isModEvent(evt);
                void app.workspace.openLinkText(path, '', modEvent);
              });
  
              linkEl.addEventListener('mouseover', (evt) => {
                app.workspace.trigger('hover-link', {
                  event: evt,
                  source: 'bases',
                  hoverParent: this,
                  targetEl: linkEl,
                  linktext: entry.file.path,
                });
              });
            }
            // For all other properties, just display the value as text.
            // In your view you may also choose to use the `Value.renderTo`
            // API to better support photos, links, icons, etc.
            else {
              el.createSpan({
                cls: 'bases-list-entry-property',
                text: value.toString()
              });
            }
          }
        });
      }
    }
  }
}
```

Rebuild your plugin and reload the app. Your Base should now display a list item for every file in the vault!

## Conclusion

Congratulations on building your first Bases view! Bases are a powerful new way to view the data in your vault and we can't wait to see what new views you create.

This website contains the full API reference for Bases. Here are a couple places to get started:

- [[BasesView|BasesView]]
- [[BasesViewConfig|BasesViewConfig]]
- [[BasesEntryGroup|BasesEntryGroup]]

If you have any questions, please join the [Obsidian Discord server](https://discord.gg/obsidianmd) and ask in the "obsidian-bases" or "plugin-dev" channels.

## Defer views

---
aliases:
  - Plugins/Guides/Understanding+deferred+views
permalink: plugins/guides/defer-views
---
As of Obsidian v1.7.2, When Obsidian loads, all views are created as instances of **DeferredView**. Once a view is visible on screen (i.e. the tab is selected within its containing tab group), the `leaf` will rerender and the view will be switched out to the correct `View` instance.

This change might break some assumptions that your plugin is currently making.

### Accessing `leaf.view`

If your plugin is iterating the workspace (using either `iterateAllLeaves` or `getLeavesOfType`), it's now very important that you perform an `instanceof` check before making any assumptions about `leaf.view`.

```ts
// Bad
workspace.iterateAllLeaves(leaf => {
    if (leaf.view.getViewType() === 'my-view') {
        let view = leaf.view as MyCustomView;
        ...
    }
});

// Good
workspace.iterateAllLeaves(leaf => {
    if (leaf.view instanceof MyCustomView) {
        ...
    }
});
```

```ts
// Bad
let leaf = workspace.getLeavesOfType('my-view').first();
if (leaf) {
	let view = leaf.view as MyCustomView;
}
...

// Good
let leaf = workspace.getLeavesOfType('my-view').first();
if (leaf && leaf.view instanceof MyCustomView) {
    ...
}
```

This will avoid your plugin breaking by making a bad assumption about the workspace and causing your plugin to error out.

### Accessing your `CustomView` anywhere in the workspace

> A general rule to follow: if your plugin is attempting to communicate with a view, that view should be visible.

If your plugin needs to access an instance of `CustomView` in the workspace, you might notice that the previous code snippets won't work.

For most use cases, the solution is simple:

```ts
let leaf = workspace.getLeavesOfType('my-view').first();
if (leaf) {
	await workspace.revealLeaf(leaf); // Ensure the view is visible, `await` it to make sure the view is fully loaded
	if (leaf.view instanceof MyCustomView) {
		let view = leaf.view; // You now have your CustomView
	}
}
```

For most cases, this will be the correct way to handle accessing your custom view.

### Accessing your `CustomView` without reveal (Advanced)

There are some cases where you want to access a view without revealing it. For example, if your plugin is applying modifications to an existing view type.

In this case, you will need to manually request that the view is loaded.

```ts
let leaves = workspace.getLeavesOfType('my-view');
for (let leaf of leaves) {
  if (requireApiVersion('1.7.2')) {
    await leaf.loadIfDeferred(); // Ensure view is fully loaded
  }
  // perform modifications here...
}
```

> [!Warning] Performance warning
> Manually calling `loadIfDeferred`, your plugin is removing this performance optimization from the given views. Use this *sparingly*.

## Optimize plugin load time

---
aliases:
  - Plugins/Guides/Optimizing+plugin+load+time
permalink: plugins/guides/load-time
---
Plugins play an important role in app load time. To ensure that Obsidian behaves correctly, Obsidian loads all plugins before the user can interact with the app.

You can test the startup time of Obsidian by going to **Settings** → **General** → **Advanced**. and select the stopwatch icon to debug startup time. This view indicates how long it takes for the app to launch.

### How do I improve my plugin's load time?

- Simplify your plugin `onload`.
- Check your plugin View constructor.
- Avoid the [common pitfalls](#Pitfalls).

First, the easy stuff. Make sure that you are using a production build of your plugin. If you are using a bundler like esbuild, rollup, or webpack, you can likely create a "development" build or a "production" build. A production build will usually be smaller, load faster, and remove code that's only used for testing. When you create a release, ensure that the `main.js` file is a production build.

In your build configuration, you should consider minifying your plugin code. This will make the overall plugin file size smaller and therefore faster for plugin to read from disk and load.

Next, make sure you aren't doing anything expensive inside your plugin's `onload` function. The `onload` function should only include code necessary for the plugin to initialize. This includes app registrations, like registering commands, view types, and Markdown post-processors. It should not include anything computationally expensive or data fetching.

If your plugin creates any custom views, be mindful of your custom view constructor. When Obsidian opens, it will reopen all the views saved to the user's workspace. If your view is loaded (and not [[Defer views|deferred]]), this will directly impact the app load time.

### If you have code that you want to run at startup, where should it go?

For most cases, you will want to wrap your code inside a `onLayoutReady` callback. These callbacks are deferred and are only called after Obsidian finishes loading.

## Pitfalls

### Listening to `vault.on('create')`

As a part of Obsidian's vault initialization process, it will call `create` for every file. If your plugin needs to react to new files getting created, you need to wait for the workspace to be ready first. Your vault event registration should be inside an `onLayoutReady` callback; this will ensure you don't start reacting to events until the workspace is fully initialized.

#### Option A. Check if the layout is ready

```ts
class MyPlugin extends Plugin {
    onload(app: App) {
	    super(app);
        this.registerEvent(this.app.vault.on('create', this.onCreate, this));
    }

	onCreate() {
	    if (!this.app.workspace.layoutReady) {
	      // Workspace is still loading, do nothing
	      return;
	    }
		// ...
	}
}
```

#### Option B. Register the handler once the layout is ready

```ts
class MyPlugin extends Plugin {
    onload(app: App) {
	    super(app);
	    this.app.workspace.onLayoutReady(() => {
	        this.registerEvent(this.app.vault.on('create', this.onCreate, this));
	    });
    }

	onCreate() {
		// ...
	}
}
```

For additional help with optimizing your plugin, reach out for [[Home#Join the developer community|help from the developer community]]!

## Store secrets

---
permalink: plugins/guides/secret-storage
aliases:
  - SecretStorage and SecretComponent
---
[[SecretStorage]] provides a secure way to store and manage sensitive data like API keys and tokens in Obsidian plugins. Instead of storing secrets directly in your plugin's `data.json` file, SecretStorage offers a centralized key-value store that allows users to share secrets across multiple plugins.

In this guide, you'll learn how to use [[SecretStorage]] and [[SecretComponent]] to securely handle secrets in your plugin settings.

## What you'll learn

After you've completed this guide, you'll be able to:

- Replace direct secret input with the SecretComponent.
- Retrieve stored secrets using the SecretStorage API.
- Understand why SecretStorage improves security and user experience.

## Before you start

This guide assumes you're familiar with creating plugin settings in Obsidian. If you haven't already, read [[Settings]] to understand how to create a settings tab and save plugin configuration.

## Why use SecretStorage?

When plugins store secrets directly in `data.json`, several problems arise:

- **Security**: Secrets are stored in plaintext alongside other plugin data.
- **Duplication**: Users must copy the same API key into every plugin that needs it.
- **Maintenance**: If a token changes, users must update every plugin manually.

SecretStorage addresses these issues by providing a central store for secrets. Users save each secret with a name, and any plugin can reference it by that name.

![[settings-secret-list.png]]

## Step 1: Update your settings interface

Start with a typical plugin settings setup. The `mySetting` property will store the *name* of a secret, not the secret value itself.

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";

export interface MyPluginSettings {
  mySetting: string;
}
```

## Step 2: Add the SecretComponent to your settings tab

Replace the standard text input with a `SecretComponent`. Import `SecretComponent` from `obsidian` and use the `addComponent` method on your `Setting`:

```ts
import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import MyPlugin from "./main";

export class SampleSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('API key')
      .setDesc('Select a secret from SecretStorage')
      .addComponent(el => new SecretComponent(this.app, el)
        .setValue(this.plugin.settings.mySetting)
        .onChange(value => {
          this.plugin.settings.mySetting = value;
          this.plugin.saveSettings();
        }));
  }
}
```

The `SecretComponent` presents users with an interface to select from existing secrets or create a new one. When saved, your plugin settings contain the *name* of the secret, not the actual secret value.

![[settings-secretcomponent.png]]

## Step 3: Retrieve the secret value

When your plugin needs the actual secret value, use the `SecretStorage` API:

```ts
const secret = app.secretStorage.get(this.settings.mySetting);
if (secret) { // secret value might be null

}
```

This retrieves the secret value associated with the name stored in your settings. The actual secret is stored in local storage, keyed to the specific vault.

## Complete example

Here's the full settings tab implementation:

```ts
import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import MyPlugin from "./main";

export interface MyPluginSettings {
  mySetting: string;
}

export class SampleSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('API key')
      .setDesc('Select a secret from SecretStorage')
      .addComponent(el => new SecretComponent(this.app, el)
        .setValue(this.plugin.settings.mySetting)
        .onChange(value => {
          this.plugin.settings.mySetting = value;
          this.plugin.saveSettings();
        }));
  }
}
```

## FAQ

### Why does SecretComponent use `addComponent` instead of having its own method like `addText`?

Unlike other setting components, `SecretComponent` requires the `App` instance in its constructor to access the SecretStorage API. The standard `addText`, `addToggle`, and similar methods don't pass `App` to their callbacks. The `Setting#addComponent` method gives you full control over component instantiation, allowing you to pass the required `App` reference.

## Support pop-out windows

---
aliases:
  - Plugins/Guides/Supporting Pop-Out Windows
permalink: /plugins/guides/pop-out-windows
---
With the release of [Obsidian v0.15.0](https://obsidian.md/changelog/2022-06-14-desktop-v0.15.0/), the pop-out windows feature was added to the desktop version of Obsidian. 

For most plugins, this feature should work out-of-the-box. However, some things work differently when your plugin renders things in pop-out windows.

Most importantly, pop-out windows come with a complete different set of globals. Each pop-out window introduces its own `Window` object, `Document` object, and fresh copies of all global constructors (like `HTMLElement` and `MouseEvent`).

This means that some of the things you previously had assumed to be global and use only _a single_ definition, will now only work in the main window. Here are some examples:

```ts
let myElement: HTMLElement = ...;

// This will always append to the main window
document.body.appendChild(myElement);

// This will actually be false if element is in a pop-out window
if (myElement instanceof HTMLElement) {

}

element.on('click', '.my-css-class', (event) => {
    // This will be false if the event is triggered in a pop-out window
    if (event instanceof MouseEvent) {

    }
}
```

The Obsidian API includes various helper function and accessors to better support pop-out windows:

- A global `activeWindow` and `activeDocument` variable, which always points to the current focused window and its document. 
- An `element.win` and `element.doc` getter, which respectively point to the `Window` and `Document` objects that the element belongs to.
- A function for performing cross-window compatible `instanceof` checks. Use `element.instanceOf(HTMLElement)` and `event.instanceOf(MouseEvent)`, instead of `element instanceof HTMLElement` and `event instanceof MouseEvent`.
- `HTMLElement.onWindowMigrated(callback)` which hooks a callback on the element for when it is inserted into a different window than it originally was in. This can be used for complex renderers like canvases to re-initialize the rendering context.

Using these APIs, the previous example would look like this:

```ts
let myElement: HTMLElement = ...;

// Bad: myElement would be added to the currently focused document, which is not necessarily the one you want
activeDocument.body.appendChild(myElement);
// Good: This will append myElement to the same window as someElement
someElement.doc.body.appendChild(myElement);

// This will work correctly in pop-out windows
if (myElement.instanceOf(HTMLElement)) {

}

element.on('click', '.my-css-class', (event) => {
    // This will work correctly in pop-out windows
    if (event.instanceOf(MouseEvent)) {

    }
}
```
