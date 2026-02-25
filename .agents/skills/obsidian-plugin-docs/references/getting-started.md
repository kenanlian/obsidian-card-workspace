# Getting Started

Source: Obsidian developer docs (obsidian-developer-docs repo).

## Contents

- [Build a plugin](#build-a-plugin)
- [Anatomy of a plugin](#anatomy-of-a-plugin)
- [Development workflow](#development-workflow)
- [Mobile development](#mobile-development)
- [Use React in your plugin](#use-react-in-your-plugin)
- [Use Svelte in your plugin](#use-svelte-in-your-plugin)

## Build a plugin

Plugins let you extend Obsidian with your own features to create a custom note-taking experience.

In this tutorial, you'll compile a sample plugin from source code and load it into Obsidian.

## What you'll learn

After you've completed this tutorial, you'll be able to:

- Configure an environment for developing Obsidian plugins.
- Compile a plugin from source code.
- Reload a plugin after making changes to it.

## Prerequisites

To complete this tutorial, you'll need:

- [Git](https://git-scm.com/) installed on your local machine.
- A local development environment for [Node.js](https://Node.js.org/en/about/).
- A code editor, such as [Visual Studio Code](https://code.visualstudio.com/).

## Before you start

When developing plugins, one mistake can lead to unintended changes to your vault. To prevent data loss, you should never develop plugins in your main vault. Always use a separate vault dedicated to plugin development.

[Create an empty vault](https://help.obsidian.md/Getting+started/Create+a+vault#Create+empty+vault).

## Step 1: Download the sample plugin

In this step, you'll download a sample plugin to the `plugins` directory in your vault's [`.obsidian` directory](https://help.obsidian.md/Advanced+topics/How+Obsidian+stores+data#Per+vault+data) so that Obsidian can find it.

The sample plugin you'll use in this tutorial is available in a [GitHub repository](https://github.com/obsidianmd/obsidian-sample-plugin).

1. Open a terminal window and change the project directory to the `plugins` directory.

   ```bash
   cd path/to/vault
   mkdir .obsidian/plugins
   cd .obsidian/plugins
   ```

2. Clone the sample plugin using Git.

   ```bash
   git clone https://github.com/obsidianmd/obsidian-sample-plugin.git
   ```

> [!tip] GitHub template repository
> The repository for the sample plugin is a GitHub template repository, which means you can create your own repository from the sample plugin. To learn how, refer to [Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template#creating-a-repository-from-a-template).
>
> Remember to use the URL of your own repository when cloning the sample plugin.

## Step 2: Build the plugin

In this step, you'll compile the sample plugin so that Obsidian can load it.

1. Navigate to the plugin directory.

   ```bash
   cd obsidian-sample-plugin
   ```

2. Install dependencies.

   ```bash
   npm install
   ```

3. Compile the source code. The following command keeps running in the terminal and rebuilds the plugin when you modify the source code.

   ```bash
   npm run dev
   ```

Notice that the plugin directory now has a `main.js` file that contains a compiled version of the plugin.

## Step 3: Enable the plugin

To load a plugin in Obsidian, you first need to enable it.

1. In Obsidian, open **Settings**.
2. In the side menu, select **Community plugins**.
3. Select **Turn on community plugins**.
4. Under **Installed plugins**, enable the **Sample Plugin** by selecting the toggle button next to it.

You're now ready to use the plugin in Obsidian. Next, we'll make some changes to the plugin.

## Step 4: Update the plugin manifest

In this step, you'll rename the plugin by updating the plugin manifest, `manifest.json`. The manifest contains information about your plugin, such as its name and description.

1. Open `manifest.json` in your code editor.
2. Change `id` to a unique identifier, such as `"hello-world"`.
3. Change `name` to a human-friendly name, such as `"Hello world"`.
4. Rename the plugin folder to match the plugin's `id`.
5. Restart Obsidian to load the new changes to the plugin manifest.

Go back to **Installed plugins** and notice that the name of the plugin has been updated to reflect the changes you made.

Remember to restart Obsidian whenever you make changes to `manifest.json`.

## Step 5: Update the source code

To let the user interact with your plugin, add a _ribbon icon_ that greets the user when they select it.

1. Open `main.ts` in your code editor.
2. Rename the plugin class from `MyPlugin` to `HelloWorldPlugin`.
3. Import `Notice` from the `obsidian` package (if it hasn't been imported already).

   ```ts
   import { Notice, Plugin } from 'obsidian';
   ```

4. In the `onload()` method, add the following code:

   ```ts
   this.addRibbonIcon('dice', 'Greet', () => {
     new Notice('Hello, world!');
   });
   ```

5. In the **Command palette**, select **Reload app without saving** to reload the plugin.

You can now see a dice icon in the ribbon on the left side of the Obsidian window. Select it to display a message in the upper-right corner.

Remember, you need to **reload your plugin after changing the source code**, either by disabling it then enabling it again in the community plugins panel, or using the command palette as detailed in part 5 of this step.  

> [!tip] Hot reloading
> Install the [Hot-Reload](https://github.com/pjeby/hot-reload) plugin to automatically reload your plugin while developing.

## Conclusion

In this tutorial, you've built your first Obsidian plugin using the TypeScript API. You've modified the plugin and reloaded it to reflect the changes inside Obsidian.

## Anatomy of a plugin

The [[Plugin|Plugin]] class defines the lifecycle of a plugin and exposes the operations available to all plugins:

```ts
import { Plugin } from 'obsidian';

export default class ExamplePlugin extends Plugin {
  async onload() {
    // Configure resources needed by the plugin.
  }
  async onunload() {
    // Release any resources configured by the plugin.
  }
}
```

## Plugin lifecycle

[[onload|onload()]] runs whenever the user starts using the plugin in Obsidian. This is where you'll configure most of the plugin's capabilities.

[[onunload|onunload()]] runs when the plugin is disabled. Any resources that your plugin is using must be released here to avoid affecting the performance of Obsidian after your plugin has been disabled.

To better understand when these methods are called, you can print a message to the console whenever the plugin loads and unloads. The console is a valuable tool that lets developers monitor the status of their code.

To view the console:

1. Toggle the Developer Tools by pressing Ctrl+Shift+I in Windows and Linux, or Cmd-Option-I on macOS.
2. Click on the Console tab in the Developer Tools window.

```ts
import { Plugin } from 'obsidian';

export default class ExamplePlugin extends Plugin {
  async onload() {
    console.log('loading plugin')
  }
  async onunload() {
    console.log('unloading plugin')
  }
}
```

## Development workflow

Whenever you make a change to the plugin source code, the plugin needs to be reloaded. You can reload the plugin by quitting Obsidian and starting it again, but that gets tiring quickly.

## Reload plugin inside Obsidian

You can reload the plugin by re-enabling it in the list of installed plugins:

1. Open **Preferences**.
2. Click **Community plugins**.
3. Find your plugin under **Installed plugins**.
4. Toggle the switch off to disable the plugin.
5. Toggle the switch on to enable the plugin.

You're now running the updated version of your plugin.

## Reload plugin on file changes

The [Hot-Reload](https://github.com/pjeby/hot-reload) plugin reloads your plugin whenever the source code changes.

For more information, check out the [forum announcement](https://forum.obsidian.md/t/plugin-release-for-developers-hot-reload-the-plugin-s-youre-developing/12185).

## Mobile development

Learn how you can develop your plugin for mobile devices.

## Emulate mobile device on desktop

You can emulate Obsidian running a mobile device directly from the Developer Tools.

1. Open the **Developer Tools**.
2. Select the **Console** tab.
3. Enter the following and then press `Enter`.

   ```ts
   this.app.emulateMobile(true);
   ```

To disable mobile emulation, enter the following and press `Enter`:

```ts
this.app.emulateMobile(false);
```


> [!tip]
> To instead toggle mobile emulation back and forth, you can use the `this.app.isMobile` flag:
>
> ```ts
> this.app.emulateMobile(!this.app.isMobile);
> ```

## Inspecting the webview on the actual mobile device

### Android

You can inspect Obsidian running on an Android device if you enable USB Debugging in Developer settings of Android. Then go to a chromium based browser on your desktop/laptop and navigate to chrome://inspect/. If you did everything right, if you have your phone/tablet connected to your PC via USB and the browser open at that link you should see your device pop up and it will let you run the usual devtools from there on it.

More in depth information can be found here: https://developer.chrome.com/docs/devtools/remote-debugging
### iOS

You can inspect Obsidian on an iOS device running 16.4 or later and a macOS based computer. Instructions on how to set it up can be found here: https://webkit.org/web-inspector/enabling-web-inspector/

## Platform-specific features

To detect the platform your plugin is running on, you can use [[Platform]]:

```ts
import { Platform } from 'obsidian';

if (Platform.isIosApp) {
  // ...
}

if (Platform.isAndroidApp) {
  // ...
}
```

## Disable your plugin on mobile devices

If your plugin requires the Node.js or Electron API, you can prevent users from installing the plugin on mobile devices.

To only support the desktop app, set `isDesktopOnly` to `true` in the [[Manifest]].

## Troubleshooting

This section lists common issues when developing for mobile devices.

### Node and Electron APIs

The Node.js API, and the Electron API aren't available on mobile devices. Any calls to these libraries made by your plugin or it's dependencies can cause your plugin to crash.

### Lookbehind in regular expressions

Lookbehind in regular expressions is only supported on iOS 16.4 and above, and some iPhone and iPad users may still use earlier versions. To implement a fallback for iOS users, either refer to [[#Platform-specific features]], or use a JavaScript library to detect specific browser versions.

Refer to [Can I Use](https://caniuse.com/js-regexp-lookbehind) for more information and exact version statistics. Look for "Safari on iOS".

## Use React in your plugin

In this guide, you'll configure your plugin to use [React](https://react.dev/). It assumes that you already have a plugin with a [[Views|custom view]] that you want to convert to use React.

While you don't need to use a separate framework to build a plugin, there are a few reasons why you'd want to use React:

- You have existing experience of React and want to use a familiar technology.
- You have existing React components that you want to reuse in your plugin.
- Your plugin requires complex state management or other features that can be cumbersome to implement with regular [[HTML elements]].

## Configure your plugin

1. Add React to your plugin dependencies:

   ```bash
   npm install react react-dom
   ```

2. Add type definitions for React:

   ```bash
   npm install --save-dev @types/react @types/react-dom
   ```

3. In `tsconfig.json`, enable JSX support on the `compilerOptions` object:

   ```ts
   {
     "compilerOptions": {
       "jsx": "react-jsx"
     }
   }
   ```

## Create a React component

Create a new file called `ReactView.tsx` in the plugin root directory, with the following content:

```tsx title="ReactView.tsx"
export const ReactView = () => {
  return <h4>Hello, React!</h4>;
};
```

## Mount the React component

To use the React component, it needs to be mounted on a [[HTML elements|HTML element]]. The following example mounts the `ReactView` component on the `this.contentEl` element:

```tsx
import { StrictMode } from 'react';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { Root, createRoot } from 'react-dom/client';
import { ReactView } from './ReactView';

const VIEW_TYPE_EXAMPLE = 'example-view';

class ExampleView extends ItemView {
	root: Root | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_EXAMPLE;
	}

	getDisplayText() {
		return 'Example view';
	}

	async onOpen() {
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<ReactView />,
			</StrictMode>,
		);
	}

	async onClose() {
		this.root?.unmount();
	}
}
```

For more information on `createRoot` and `unmount()`, refer to the documentation on [ReactDOM](https://react.dev/reference/react-dom/client/createRoot#root-render).

You can mount your React component on any `HTMLElement`, for example [[Plugins/User interface/Status bar|status bar items]]. Just make sure to clean up properly by calling `this.root.unmount()` when you're done.

## Create an App context

If you want to access the [[Reference/TypeScript API/App|App]] object from one of your React components, you need to pass it as a dependency. As your plugin grows, even though you're only using the `App` object in a few places, you start passing it through the whole component tree.

Another alternative is to create a React context for the app to make it globally available to all components inside your React view.

1. Use `createContext()` to create a new app context.

   ```tsx title="context.ts"
   import { createContext } from 'react';
   import { App } from 'obsidian';

   export const AppContext = createContext<App | undefined>(undefined);
   ```

2. Wrap the `ReactView` with a context provider and pass the app as the value.

   ```tsx title="view.tsx"
   this.root = createRoot(this.contentEl);
   this.root.render(
     <AppContext.Provider value={this.app}>
       <ReactView />
     </AppContext.Provider>
   );
   ```

3. Create a custom hook to make it easier to use the context in your components.

   ```tsx title="hooks.ts"
   import { useContext } from 'react';
   import { AppContext } from './context';

   export const useApp = (): App | undefined => {
     return useContext(AppContext);
   };
   ```

4. Use the hook in any React component within `ReactView` to access the app.

   ```tsx title="ReactView.tsx"
   import { useApp } from './hooks';

   export const ReactView = () => {
     const { vault } = useApp();

     return <h4>{vault.getName()}</h4>;
   };
   ```

For more information, refer to the React documentation for [Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) and [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks).

## Use Svelte in your plugin

This guide explains how to configure your plugin to use [Svelte](https://svelte.dev/), a light-weight alternative to traditional frameworks like React and Vue.

Svelte is built around a compiler that preprocesses your code and outputs optimized vanilla JavaScript. This means that it doesn't need a virtual DOM to track state changes, which allows your plugin to run with minimal additional overhead.

If you want to learn more about Svelte, and how to use it, refer to the [tutorial](https://svelte.dev/tutorial/svelte/welcome-to-svelte) and the [documentation](https://svelte.dev/docs/svelte/overview).

This guide assumes that you've finished [[Build a plugin]].

> [!tip] Visual Studio Code
> Svelte has an [official Visual Studio Code extension](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) that enables syntax highlighting and rich IntelliSense in Svelte components.

## Configure your plugin

To build a plugin with Svelte, you need to install the dependencies and configure your plugin to compile code written using Svelte. 
If you only want to use TypeScript's *type-only* features, you don't need `svelte-preprocess`.

1. Add Svelte to your plugin dependencies:

   ```bash
   npm install --save-dev svelte svelte-preprocess esbuild-svelte svelte-check
   ```

   > [!info]
   > Svelte requires at least TypeScript 5.0. To update to Typescript 5.0 run the following in your terminal.
   >
   > ```bash
   > npm install typescript@~5.0.0
   > ```

2. Extend the `tsconfig.json` to enable additional type checking for common Svelte issues. `verbatimModuleSyntax` is needed for `svelte-preprocess` and `skipLibCheck` is needed for `svelte-check` to work correctly.

   ```json
   {
     "compilerOptions": {
       "verbatimModuleSyntax": true,
       "skipLibCheck": true,
       // ...
     },
     "include": [
       "**/*.ts",
       "**/*.svelte"
     ]
   }
   ```

3. In `esbuild.config.mjs`, add the following imports to the top of the file:

   ```js
   import esbuildSvelte from 'esbuild-svelte';
   import { sveltePreprocess } from 'svelte-preprocess';
   ```

4. Add Svelte to the list of plugins.

   ```js
   const context = await esbuild.context({
     plugins: [
       esbuildSvelte({
         compilerOptions: { css: 'injected' },
         preprocess: sveltePreprocess(),
       }),
     ],
     // ...
   });
   ```
  
5. Add a script to run `svelte-check` to your `package.json`.
   
   ```json
   {
     // ...
     "scripts": {
       // ...
       "svelte-check": "svelte-check --tsconfig tsconfig.json"
     }
   }
   ```

## Create a Svelte component

In the root directory of the plugin, create a new file called `Counter.svelte`:

```tsx
<script lang="ts">
  interface Props {
    startCount: number;
  }

  let {
    startCount
  }: Props = $props();

  let count = $state(startCount);

  export function increment() {
    count += 1;
  }
</script>

<div class="number">
  <span>My number is {count}!</span>
</div>

<style>
  .number {
    color: red;
  }
</style>
```

## Mount the Svelte component

To use the Svelte component, it needs to be mounted on an existing [[HTML elements|HTML element]]. For example, if you are mounting on a custom [[ItemView|ItemView]] in Obsidian:

```ts
import { ItemView, WorkspaceLeaf } from 'obsidian';

// Import the Counter Svelte component and the `mount` and `unmount` methods.
import Counter from './Counter.svelte';
import { mount, unmount } from 'svelte';

export const VIEW_TYPE_EXAMPLE = 'example-view';

export class ExampleView extends ItemView {
  // A variable to hold on to the Counter instance mounted in this ItemView.
  counter: ReturnType<typeof Counter> | undefined;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_EXAMPLE;
  }

  getDisplayText() {
    return 'Example view';
  }

  async onOpen() {
    // Attach the Svelte component to the ItemViews content element and provide the needed props.
    this.counter = mount(Counter, {
      target: this.contentEl,
      props: {
        startCount: 5,
      }
    });

    // Since the component instance is typed, the exported `increment` method is known to TypeScript.
    this.counter.increment();
  }

  async onClose() {
    if (this.counter) {
      // Remove the Counter from the ItemView.
      unmount(this.counter);
    }
  }
}
```

See [[Views]] for more on how to incorporate this new view into the User Interface.
