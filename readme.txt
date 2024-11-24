vi.js - give all input elements (input, textarea, select) on a page a vi editing mode
vi-editing-mode - firefox addon and chromium extension that adds vi.js to all pages

Automatically and non-intrusively add a vi editing mode to all textareas/inputs.
Behaviour remains unchanged (like insert mode), hitting Escape enables command
mode.

# Description

Automatically and non-intrusively add a vi editing mode to all textarea/input
elements on pages, so you can use vim keys/shortcuts to edit and navigate text.
Inputs/textareas keep working as they normally do (like insert mode, handled by
the browser), hitting "escape" enables command mode on the focused element,
indicated with a box-shadow.

Features:
- Simple, automatic, non-intrusive vi editing.
- Command, visual and visual-line modes.
- Plenty of commands/keys (but please contribute more!)
- Multi-level undo and redo.
- Repeat.
- The tab key inserts literal tabs after having been in command mode, until the
  element loses focus.
- Only basic addon permissions needed. (clipboard read/write permission
  requested on first use).

Non-goals:
- vi-like keys for other browser behaviour, like navigating on a page or the
  internet.
- Full-blown vi/vim editor (not all commands are needed, it doesn't have to
  look like a standalone vi/vim, it would be too much for an input element).
- Marks, tags, macros, registers, custom key mappings and other advanced features.

# Limitations

Since vi.js uses basic textarea/input elements, it inherits some
limitations/behaviour:

Textareas don't expose whether text (e.g. the selection) is visible in the
viewport. This limits how vi.js can implement some commands/motions.

Insert mode is handled by the browser (with the exeception of Tab, which can
insert a literal tab), including undo/redo while typing. JS doesn't have access
to textarea undo/redo history. vi.js tracks history for changes it makes (based
on commands), and tracks changes during insert by comparing contents between
going into insert mode. The edits a user makes in insert mode are turned into a
single history change to undo/redo.

In vi/vim, the cursor is typically "on" a character. With a textarea, it is
shown between characters. The position at the end of the line, after the last
character, before the newline, is not normally a separate position in vi. vi.js
lets you navigate to these positions, which changes how some motion keys work.

Access to the clipboard is only explicitly with the "y" and "p" keys. Commands
that remove/replace text don't change the clipboard.

Not all input types are supported, browsers only allow editing selections on
some types: text, search, url, tel, password. Others don't work: email, time,
etc.

Popular messaging web applications have custom UI elements for sending messages,
for their rich text. They often don't use standard textarea/input elements, so
this plugin won't help with those apps.

Some applications use "Escape" as a shortcut to cancel. Use "ctrl-{" as
alternative.  Unfortunately, the obvious alternative "ctrl-[" is interpreted by
firefox as "back" and can't be intercepted.

Plenty of vi/vim keys haven't been implemented yet. People typically use a
subset of all the many vi/vim key bindings. Please submit a PR for commands
you're missing and want. Keep the code maintainable.

# Other work

Various "vi enabling" addons exist. Most of them enable vi-like shortcuts for
navigating etc, without changing how text is edited in textarea/input elements.

Other plugins do change textareas into vi/vim editors, mostly by turning text
in a textarea/input element into a full-blown vim(-like) editor, sometimes not
handling regular input elements, others turning a single line in a big editor.

The difference is that vi.js and vi-editing-mode explicitly wants to keep
original textarea/input elements as unmodified as possible, allowing vi.js to
always be available and easy to enable, not getting in the way.

# Implementation

vi.js is quite closely modelled after the Edit widget in
https://github.com/mjl-/duit, a UI toolkit for Go. That code in turn was
modeled after https://github.com/mjl-/vixen, a vi-clone written in Limbo.

vi.js has simpler requirements than duit and vixen. vi.js doesn't have to
read/write from on-disk files, there is no backing store.

# Developing

First disable the currently installed addon/extension.

For firefox, go to about:debugging, click "This firefox", click "Load Temporary
Add-on" and select a newly built zip file.

For chromium, open the extensions page, enable developer mode (top right),
click "Load unpacked" on the left, and select the vijs directory.

# Releasing

- Update manifest.json with version.
- Create annotated tag.
- Run "make zip", which writes a zip file to local/.
- Upload zip file to mozilla addon pages and chrome web store developer dashboard:
	- https://addons.mozilla.org/en-US/developers/addon/vi-editing-mode/versions
	- https://chrome.google.com/webstore/devconsole/

Public URLs:
- https://addons.mozilla.org/en-US/firefox/addon/vi-editing-mode/
- https://chromewebstore.google.com/detail/vi-editing-mode/fjencagempclanimjkpljinmknpabbbp
