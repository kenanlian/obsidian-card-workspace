# Releasing

Source: Obsidian developer docs (obsidian-developer-docs repo).

## Contents

- [Plugin guidelines](#plugin-guidelines)
- [Submission requirements for plugins](#submission-requirements-for-plugins)
- [Submit your plugin](#submit-your-plugin)
- [Beta-testing plugins](#beta-testing-plugins)
- [Release your plugin with GitHub Actions](#release-your-plugin-with-github-actions)

## Plugin guidelines

This page lists common review comments plugin authors get when submitting their plugin.

While the guidelines on this page are recommendations, depending on their severity, we may still require you to address any violations.

> [!important] Policies for plugin developers
> Make sure that you've read our [[Developer policies]] as well as the [[Submission requirements for plugins]].

## General

### Avoid using global app instance

Avoid using the global app object, `app` (or `window.app`). Instead, use the reference provided by your plugin instance, `this.app`.

The global app object is intended for debugging purposes and might be removed in the future.

### Avoid unnecessary logging to console

Please avoid unnecessary logging.
In it's default configuration, the developer console should only show error messages, debug messages should not be shown.

### Consider organizing your code base using folders

If your plugin uses more than one `.ts` file, consider organizing them into folders to make it easier to review and maintain.

### Rename placeholder class names

The sample plugin contains placeholder names for common classes, such as `MyPlugin`, `MyPluginSettings`, and `SampleSettingTab`. Rename these to reflect the name of your plugin.

## Mobile
![[Mobile development#Node and Electron APIs]]

![[Mobile development#Lookbehind in regular expressions]]
## UI text

This section lists guidelines for formatting text in the user interface, such as settings, commands, and buttons.

The example below from **Settings → Appearance** demonstrates the guidelines for text in the user interface.

![[settings-headings.png]]

1. [[#Only use headings under settings if you have more than one section.|General settings are at the top and don't have a heading]].
2. [[#Avoid "settings" in settings headings|Section headings don't have "settings" in the heading text]].
3. [[#Use Sentence case in UI]].

For more information on writing and formatting text for Obsidian, refer to our [Style guide](https://help.obsidian.md/Contributing+to+Obsidian/Style+guide).

### Only use headings under settings if you have more than one section.

Avoid adding a top-level heading in the settings tab, such as "General", "Settings", or the name of your plugin.

If you have more than one section under settings, and one contains general settings, keep them at the top without adding a heading.

For example, look at the settings under **Settings → Appearance**.

### Avoid "settings" in settings headings

In the settings tab, you can add headings to organize settings. Avoid including the word "settings" to these headings. Since everything in under the settings tab is settings, repeating it for every heading becomes redundant.

- Prefer "Advanced" over "Advanced settings".
- Prefer "Templates" over "Settings for templates".

### Use sentence case in UI

Any text in UI elements should be using [Sentence case](https://en.wiktionary.org/wiki/sentence_case) instead of [Title Case](https://en.wikipedia.org/wiki/Title_case), where only the first word in a sentence, and proper nouns, should be capitalized.

- Prefer "Template folder location" over "Template Folder Location".
- Prefer "Create new note" over "Create New Note".

### Use `setHeading` instead of a `<h1>`, `<h2>`

Using the heading elements from HTML will result in inconsistent styling between different plugins.
Instead you should prefer the following:
```ts
new Setting(containerEl).setName('your heading title').setHeading();
```
## Security

### Avoid `innerHTML`, `outerHTML` and `insertAdjacentHTML`

Building DOM elements from user-defined input, using `innerHTML`, `outerHTML` and `insertAdjacentHTML` can pose a security risk.

The following example builds a DOM element using a string that contains user input, `${name}`. `name` can contain other DOM elements, such as `<script>alert()</script>`, and can allow a potential attacker to execute arbitrary code on the user's computer.

```ts
function showName(name: string) {
  let containerElement = document.querySelector('.my-container');
  // DON'T DO THIS
  containerElement.innerHTML = `<div class="my-class"><b>Your name is: </b>${name}</div>`;
}
```

Instead, use the DOM API or the Obsidian helper functions, such as `createEl()`, `createDiv()` and `createSpan()` to build the DOM element programmatically. For more information, refer to [[HTML elements]].

To cleanup a HTML elements contents use `el.empty();`

## Resource management

### Clean up resources when plugin unloads

Any resources created by the plugin, such as event listeners, must be destroyed or released when the plugin unloads.

When possible, use methods like [[registerEvent|registerEvent()]] or [[addCommand|addCommand()]] to automatically clean up resources when the plugin unloads.

```ts
export default class MyPlugin extends Plugin {
  onload() {
    this.registerEvent(this.app.vault.on('create', this.onCreate));
  }

  onCreate: (file: TAbstractFile) => {
    // ...
  }
}
```

> [!note]
> You don't need to clean up resources that are guaranteed to be removed when your plugin unloads. For example, if you register a `mouseenter` listener on a DOM element, the event listener will be garbage-collected when the element goes out of scope.

### Don't detach leaves in `onunload`

When the user updates your plugin, any open leaves will be reinitialized at their original position, regardless of where the user had moved them.

## Commands

### Avoid setting a default hotkey for commands

Setting a default hotkey may lead to conflicts between plugins and may override hotkeys that the user has already configured.

It's also difficult to choose a default hotkey that is available on all operating systems.

### Use the appropriate callback type for commands

When you add a command in your plugin, use the appropriate callback type.

- Use `callback` if the command runs unconditionally.
- Use `checkCallback` if the command only runs under certain conditions.

If the command requires an open and active Markdown editor, use `editorCallback`, or the corresponding `editorCheckCallback`.

## Workspace

### Avoid accessing `workspace.activeLeaf` directly

If you want to access the active view, use [[getActiveViewOfType|getActiveViewOfType()]] instead:

```ts
const view = this.app.workspace.getActiveViewOfType(MarkdownView);

// getActiveViewOfType will return null if the active view is null, or if it's not a MarkdownView.
if (view) {
  // ...
}
```

If you want to access the editor in the active note, use `activeEditor` instead:

```ts
const editor = this.app.workspace.activeEditor?.editor;

if (editor) {
    // ...
}
```

### Avoid managing references to custom views

Managing references to custom view can cause memory leaks or unintended consequences.

**Don't** do this:

```ts
this.registerView(MY_VIEW_TYPE, () => this.view = new MyCustomView());
```

Do this instead:

```ts
this.registerView(MY_VIEW_TYPE, () => new MyCustomView());
```

To access the view from your plugin, use `Workspace.getActiveLeavesOfType()`:

```ts
for (let leaf of app.workspace.getActiveLeavesOfType(MY_VIEW_TYPE)) {
  let view = leaf.view;
  if (view instanceof MyCustomView) {
    // ...
  }
}
```

## Vault

### Prefer the Editor API instead of `Vault.modify` to the active file

If you want to edit an active note, use the [[Editor]] interface instead of [[Vault/modify|Vault.modify()]].

Editor maintains information about the active note, such as cursor position, selection, and folded content. When you use [[Vault/modify|Vault.modify()]] to edit the note, all that information is lost, which leads to a poor experience for the user.

Editor is also more efficient when making small changes to parts of the note.

### Prefer `Vault.process` instead of `Vault.modify` to modify a file in the background

If you want to edit a note that is not currently opened, use the [[Reference/TypeScript API/Vault/process|Vault.process]] function instead of [[modify|Vault.modify]].

The `process` function modifies the file atomically, which means that your plugin won't run into conflicts with other plugins modifying the same file.

### Prefer `FileManager.processFrontMatter` to modify frontmatter of a note

Instead of extracting the frontmatter of a note, parsing and modifying the YAML manually you should use the [[processFrontMatter|FileManager.processFrontMatter]] function.

`processFrontMatter` runs atomically, so modifying the file will not conflict with other plugins editing the same file.
It will also ensure a consistent layout of the YAML produced.

### Prefer the Vault API over the Adapter API

Obsidian exposes two APIs for file operations: the Vault API (`app.vault`) and the Adapter API (`app.vault.adapter`).

While the file operations in the Adapter API are often more familiar to many developers, the Vault API has two main advantages over the adapter.

- **Performance:** The Vault API has a caching layer that can speed up file reads when the file is already known to Obsidian.
- **Safety:** The Vault API performs file operations serially to avoid any race conditions, for example when reading a file that is being written to at the same time.

### Avoid iterating all files to find a file by its path

This is inefficient, especially for large vaults. Use [[getFileByPath|Vault.getFileByPath]], [[getFolderByPath|Vault.getFolderByPath]] or [[getAbstractFileByPath|Vault.getAbstractFileByPath]] instead.

**Don't** do this:

```ts
this.app.vault.getFiles().find(file => file.path === filePath);
```

Do this instead:

```ts
const filePath = 'folder/file.md';
// if you want to get a file
const file = this.app.vault.getFileByPath(filePath);
```

```ts
const folderPath = 'folder';
// or if you want to get a folder
const folder = this.app.vault.getFolderByPath(folderPath);
```

If you aren't sure if the path provided is for a folder or a file, use:
```ts
const abstractFile = this.app.vault.getAbstractFileByPath(filePath);

if (file instanceof TFile) {
	// it's a file
}
if (file instanceof TFolder) {
	// it's a folder
}
```

### Use `normalizePath()` to clean up user-defined paths

Use [[normalizePath|normalizePath()]] whenever you accept user-defined paths to files or folders in the vault, or when you construct your own paths in the plugin code.

`normalizePath()` takes a path and scrubs it to be safe for the file system and for cross-platform use. This function:

- Cleans up the use of forward and backward slashes, such as replacing 1 or more of `\` or `/` with a single `/`.
- Removes leading and trailing forward and backward slashes.
- Replaces any non-breaking spaces, `\u00A0`, with a regular space.
- Runs the path through [String.prototype.normalize](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize).

```ts
import { normalizePath } from 'obsidian';
const pathToPlugin = normalizePath('//my-folder\file');
// pathToPlugin contains "my-folder/file" not "//my-folder\"
```

## Editor

### Change or reconfigure editor extensions

If you want to change or reconfigure an [[Editor extensions|editor extension]] after you've registered using [[registerEditorExtension|registerEditorExtension()]], use [[updateOptions|updateOptions()]] to update all editors.

```ts
class MyPlugin extends Plugin {
  private editorExtension: Extension[] = [];

  onload() {
    //...

    this.registerEditorExtension(this.editorExtension);
  }

  updateEditorExtension() {
    // Empty the array while keeping the same reference
    // (Don't create a new array here)
    this.editorExtension.length = 0;

    // Create new editor extension
    let myNewExtension = this.createEditorExtension();
    // Add it to the array
    this.editorExtension.push(myNewExtension);

    // Flush the changes to all editors
    this.app.workspace.updateOptions();
  }
}

```
## Styling

### No hardcoded styling

**Don't** do this:

```ts
const el = containerEl.createDiv();
el.style.color = 'white';
el.style.backgroundColor = 'red';
```

To make it easy for users to modify the styling of your plugin you should use CSS classes, as hardcoding the styling in the plugin code makes it impossible to modify with themes and snippets.

**Do** this instead:

```ts
const el = containerEl.createDiv({cls: 'warning-container'});
```

 In the plugins CSS add the following:

```css
.warning-container {
	color: var(--text-normal);
	background-color: var(--background-modifier-error);
}
```

To make the styling of your plugin consistent with Obsidian and other plugins you should use the [[CSS variables]] provided by Obsidian.
If there is no variable available that fits in your case, you can create your own.

## TypeScript

### Prefer `const` and `let` over `var`

For more information, refer to [4 Reasons Why var is Considered Obsolete in Modern JavaScript](https://javascript.plainenglish.io/4-reasons-why-var-is-considered-obsolete-in-modern-javascript-a30296b5f08f).

### Prefer async/await over Promise

Recent versions of JavaScript and TypeScript support the `async` and `await` keywords to run code asynchronously, which allow for more readable code than using Promises.

**Don't** do this:

```ts
function test(): Promise<string | null> {
  return requestUrl('https://example.com')
    .then(res => res.text
    .catch(e => {
      console.log(e);
      return null;
    });
}
```

Do this instead:

```ts
async function AsyncTest(): Promise<string | null> {
  try {
    let res = await requestUrl('https://example.com');
    let text = await r.text;
    return text;
  }
  catch (e) {
    console.log(e);
    return null;
  }
}
```

## Submission requirements for plugins

This page lists extends the [[Developer policies]] with plugin-specific requirements that all plugins must follow to be published.

## Only use `fundingUrl` to link to services for financial support

Use [[Manifest#fundingUrl|fundingUrl]] if you accept financial support for your plugin, using services like Buy Me A Coffee or GitHub Sponsors.

If you don't accept donations, remove `fundingUrl` from your manifest.

## Set an appropriate `minAppVersion`

The `minAppVersion` in the [[Reference/Manifest|Manifest]] should be set to the minimum required version of the Obsidian app that your plugin is compatible with.
If you don't know what an appropriate version number is, use the latest stable build number.

## Keep plugin descriptions short and simple

Good plugin descriptions help users understand your plugin quickly and succinctly. Good descriptions often start with an action statement such as:

- "Translate selected text into..."
- "Generate notes automatically from..."
- "Import notes from..."
- "Sync highlights and annotations from..."
- "Open links in..."

Avoid starting your description with "This is a plugin", because it'll be obvious to users in the context of the Community Plugins directory.

Your description should:

- Follow the [Obsidian style guide](https://help.obsidian.md/Contributing+to+Obsidian/Style+guide).
- Have 250 characters maximum.
- End with a period `.`.
- Avoid using emoji or special characters.
- Use correct capitalization for acronyms, proper nouns and trademarks such as "Obsidian", "Markdown", "PDF". If you are not sure how to capitalize a term, refer to its website or Wikipedia description.

## Node.js and Electron APIs are only allowed on desktop

The Node.js and Electron APIs are only available in the desktop version of Obsidian. For example, Node.js packages like `fs`, `crypto`, and `os`, are only available on desktop.

If your plugin uses any of these APIs, you **must** set `isDesktopOnly` to `true` in the `manifest.json`.

> [!tip]
> Many Node.js features have Web API alternatives:
>
> - [`SubtleCrypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto) instead of [`crypto`](https://nodejs.org/api/crypto.html).
> - `navigator.clipboard.readText()` and `navigator.clipboard.writeText()` to access clipboard contents.

## Don't include the plugin ID in the command ID

Obsidian automatically prefixes command IDs with your plugin ID.
You don't need to include the plugin ID yourself.

## Remove all the sample code

The sample plugin includes examples how to do many of the most common things a plugin requires.
It's only there to get you started, sample code should be removed from your plugin before submission.

## Submit your plugin

If you want to share your plugin with the Obsidian community, the best way is to submit it to the [official list of plugins](https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json). Once we've reviewed and published your plugin, users can install it directly from within Obsidian. It'll also be featured in the [plugin directory](https://obsidian.md/plugins) on the Obsidian website.

You only need to submit the initial version of your plugin. After your plugin has been published, users can download new releases from GitHub directly from within Obsidian.

## Prerequisites

To complete this guide, you'll need:

- A [GitHub](https://github.com/signup) account.

## Before you begin

Before you submit your plugin, make sure you have the following files in the root folder of your repository:

- A `README.md` that describes the purpose of the plugin, and how to use it.
- A `LICENSE` that determines how others are allowed to use the plugin and its source code. If you need help to [add a license](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/adding-a-license-to-a-repository) for your plugin, refer to [Choose a License](https://choosealicense.com/).
- A `manifest.json` that describes your plugin. For more information, refer to [[Manifest]].

Also make sure that you follow the [[Developer policies]] and the [[Submission requirements for plugins|submission requirements]] before you submit your plugin.

## Step 1: Publish your plugin to GitHub

> [!note] Template repositories
> If you created your plugin from one of our template repositories, you may skip this step.

To review your plugin, we need to access to the source code on GitHub. If you're unfamiliar with GitHub, refer to the GitHub docs for how to [Create a new repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository).

## Step 2: Create a release

In this step, you'll prepare a release for your plugin that's ready to be submitted.

1. In `manifest.json`, update `version` to a new version that follows the [Semantic Versioning](https://semver.org/) specification, for example `1.0.0` for your initial release. Versions supported only in the format `x.y.z`.
2. [Create a GitHub release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository#creating-a-release). The "Tag version" of the release must match the version in your `manifest.json`.
3. Enter a name for the release, and describe it in the description field. Obsidian doesn't use the release name for anything, so feel free to name it however you like.
4. Upload the following plugin assets to the release as binary attachments:

   - `main.js`
   - `manifest.json`
   - `styles.css` (optional)

## Step 3: Submit your plugin for review

In this step, you'll submit your plugin to the Obsidian team for review.

1. In [community-plugins.json](https://github.com/obsidianmd/obsidian-releases/edit/master/community-plugins.json), add a new entry at the end of the JSON array.

   ```json
   {
     "id": "doggo-dictation",
     "name": "Doggo Dictation",
     "author": "John Dolittle",
     "description": "Transcribes dog speech into notes.",
     "repo": "drdolittle/doggo-dictation"
   }
   ```

   - `id`, `name`, `author`, and `description` determines how your plugin appears to the user, and should match the corresponding properties in your [[Manifest]].
   - `id` is unique to your plugin. Search `community-plugins.json` to confirm that there's no existing plugin with the same id. The `id` can't contain `obsidian`.
   - `repo` is the path to your GitHub repository. For example, if your GitHub repo is located at https://github.com/your-username/your-repo-name, the path is `your-username/your-repo-name`.

   Remember to add a comma after the closing brace, `}`, of the previous entry.

2. Select **Commit changes...** in the upper-right corner.
3. Select **Propose changes**.
4. Select **Create pull request**.
5. Select **Preview**, and then select **Community Plugin**.
6. Click **Create pull request**.
7. In the name of the pull request, enter "Add plugin: [...]", where [...] is the name of your plugin.
8. Fill in the details in the description for the pull request. For the checkboxes, insert an `x` between the brackets, `[x]`, to mark them as done.
9. Click **Create pull request** (for the last time 🤞).

You've now submitted your plugin to the Obsidian plugin directory. Sit back and wait for an initial validation by our friendly bot. It may take a few minutes before the results are ready.

- If you see a **Ready for review** label on your PR, your submission has passed the automatic validation.
- If you see a **Validation failed** label on your PR, you need to address all listed issues until the bot assigns a **Ready for review** label.

Once your submission is ready for review, you can sit back and wait for the Obsidian team to review it.

> [!question] How long does it take to review my plugin?
> The time it takes to review your submission depends on the current workload of the Obsidian team. The team is still small, so please be patient while you wait for your plugin to be reviewed. We're currently unable to give any estimates on when we'll be able to review your submission.

> [!warning] Ignore merge conflicts
> If you see in your PR GitHub's warning `This branch has conflicts that must be resolved`, just ignore it. Don't merge or rebase your PR.
> Once your plugin passes all reviews, the Obsidian team will resolve those conflicts before publishing your plugin.

## Step 4: Address review comments

Once a reviewer has reviewed your plugin, they'll add a comment to your pull request with the result of the review. The reviewer may require that you update your plugin, or they can offer suggestions on how you can improve it.

Address any required changes and update the GitHub release with the new changes. Leave a comment on the PR to let us know you've addressed the feedback. Don't open a new PR.

We'll publish the plugin as soon we've verified that all required changes have been addressed.

> [!note]
> While only Obsidian team members can publish your plugin, other community members may also offer to review your submission in the meantime.

## Next steps

Once we've reviewed and published your plugin, it's time to announce it to the community:

- Announce in [Share & showcase](https://forum.obsidian.md/c/share-showcase/9) in the forums.
- Announce in the `#updates` channel on [Discord](https://discord.gg/veuWUTm). You need the [`developer` role](https://discord.com/channels/686053708261228577/702717892533157999/830492034807758859) to post in `#updates`.

## Beta-testing plugins

Before you [[Submit your plugin|submit your plugin]], you may want to let users try it out first. While Obsidian doesn't officially support beta releases, we recommend that you use the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to distribute your plugin to beta testers before it's been published.

For more information, refer to the [BRAT](https://tfthacker.com/BRAT) documentation.

## Release your plugin with GitHub Actions

Manually releasing your plugin can be time-consuming and error-prone. In this guide, you'll configure your plugin to use [GitHub Actions](https://github.com/features/actions) to automatically create a release when you create a new tag.

1. In the root directory of your plugin, create a file called `release.yml` under `.github/workflows` with the following content:

   ```yml
   name: Release Obsidian plugin

   on:
     push:
       tags:
         - "*"

   jobs:
     build:
       runs-on: ubuntu-latest
       permissions:
         contents: write
       steps:
         - uses: actions/checkout@v3

         - name: Use Node.js
           uses: actions/setup-node@v3
           with:
             node-version: "18.x"

         - name: Build plugin
           run: |
             npm install
             npm run build

         - name: Create release
           env:
             GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
           run: |
             tag="${GITHUB_REF#refs/tags/}"

             gh release create "$tag" \
               --title="$tag" \
               --draft \
               main.js manifest.json styles.css
   ```

2. In your terminal, commit the workflow.

   ```bash
   git add .github/workflows/release.yml
   git commit -m "Add release workflow"
   git push origin main
   ```

3. Browse to your repository on GitHub and select the **Settings** tab. Expand the **Actions** menu in the left sidebar, navigate to the **General** menu, scroll to the **Workflow permissions** section, select the **Read and write permissions** option, and save.

4. Create a tag that matches the version in the `manifest.json` file.

   ```bash
   git tag -a 1.0.1 -m "1.0.1"
   git push origin 1.0.1
   ```

   - `-a` creates an [annotated tag](https://git-scm.com/book/en/v2/Git-Basics-Tagging#_creating_tags).
   - `-m` specifies the name of your release. For Obsidian plugins, this must be the same as the version.

5. Browse to your repository on GitHub and select the **Actions** tab. Your workflow might still be running, or it might have finished already.

6. When the workflow finishes, go back to the main page of your repository and select **Releases** in the sidebar on the right side. The workflow has created a draft GitHub release and uploaded the required assets as binary attachments.

7. Select **Edit** (pencil icon) on the right side of the release name.

8. Add release notes to let users know what happened in this release, and then select **Publish release**.

You've successfully set up your plugin to automatically create a GitHub release whenever you create a new tag.

- If this is the first release for this plugin, you're now ready to [[Submit your plugin]].
- If this is an update to an already published plugin, your users can now update to the latest version.
