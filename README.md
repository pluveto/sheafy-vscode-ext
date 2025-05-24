# Sheafy VS Code Extension

Sheafy is a VS Code extension designed to help you consolidate and export the contents of your project folders or the entire project into a single text file. It's highly configurable, respecting `.gitignore` rules and allowing custom templates and ignore patterns.

## Features

* **Export Folder/Project**:
    * Right-click a folder in the explorer: "Sheafy: Export this folder to clipboard".
    * Command: "Sheafy: Export current project to text file" (exports to configured destinations).
* **Multiple Export Destinations**: Export to clipboard, a new temporary editor tab, a file in the project root, or a file in a custom `working_dir`. (Configurable via `sheafy.exportDestinations` setting and `sheafy.toml`).
* **.gitignore Aware**: Obeys rules in your root `.gitignore` file (toggleable).
* **Customizable Output**: Define your own format for each file's output using the `sheafy.exportFormatTemplate` setting.
* **Project-Specific Configuration**: Use a `sheafy.toml` file in your project root for fine-grained control:
    * Define output `bundle_name` and `working_dir`.
    * Add custom `ignore_patterns` (gitignore syntax).
    * Override global `use_gitignore` behavior.
    * Add `prologue` and `epilogue` text to your bundle.
* **Initialize Configuration**: Command "Sheafy: Initialize sheafy.toml configuration" to quickly create a default `sheafy.toml` file.

## Commands

* **`Sheafy: Export this folder to clipboard`**: (Available on folder right-click in Explorer) Recursively exports the selected folder's content to the clipboard.
* **`Sheafy: Export current project to text file`**: Exports the entire current workspace project based on your settings (VS Code and `sheafy.toml`) to the configured destinations.
* **`Sheafy: Initialize sheafy.toml configuration`**: Creates a `sheafy.toml` file in your project root with default settings.

## Configuration

Sheafy can be configured via VS Code settings (`settings.json`) and a project-specific `sheafy.toml` file.

### VS Code Settings (`settings.json`)

Access these via File > Preferences > Settings, and search for "sheafy".

* **`sheafy.respectGitignore`** (boolean, default: `true`):
    Whether to respect `.gitignore` rules. Can be overridden by `use_gitignore` in `sheafy.toml`.
* **`sheafy.exportDestinations`** (array, default: `["clipboard"]`):
    An array specifying where to export. Options: `"clipboard"`, `"tempTab"`, `"rootDir"`, `"workingDir"`.
* **`sheafy.exportFormatTemplate`** (string, default: `### {relpath}\n\n```{lang}\n{content}\n\`\`\`\`\n`):
    The template used for each file. Placeholders:
    * `{relpath}`: Relative path of the file.
    * `{lang}`: Detected language ID for syntax highlighting.
    * `{content}`: The content of the file.
* **`sheafy.folderExport.pathRelativeToClickedFolder`** (boolean, default: `false`):
    * If `false` (default): When using "Export this folder...", `{relpath}` is relative to the workspace root.
    * If `true`: When using "Export this folder...", `{relpath}` is relative to the clicked folder.
    For "Export current project...", `{relpath}` is always relative to the workspace root.

### `sheafy.toml` File

Create this file in your project root (or use the initialization command). It allows for project-specific overrides and additional settings.

```toml
[sheafy]
# Output filename for bundle command (used for 'rootDir' or 'workingDir' destinations)
bundle_name = "project_bundle.md"

# Optional working directory / default export directory (relative to this config file)
# Default is the project root if not specified.
# working_dir = "docs/export"

# Whether to respect .gitignore files.
# If 'use_gitignore' is set here (true or false), it overrides the VSCode setting.
# If commented out or absent, the VSCode setting "sheafy.respectGitignore" is used.
# use_gitignore = true

# Optional: Add custom ignore patterns (multi-line string, gitignore syntax)
# These are applied *in addition* to .gitignore rules (if use_gitignore is true).
ignore_patterns = """
# Secret files
*.secret
*.env

# Common build outputs
dist/
build/
target/
out/

# Sheafy's own output file and config
# project_bundle.md
# sheafy.toml
"""

# Optional prologue text to include at the start of the bundle
prologue = """
# Project Export: My Awesome Project

This document contains an aggregation of files from the project.
"""

# Optional epilogue text to include at the end of the bundle
epilogue = """
---
End of Project Export
"""
```
* `bundle_name` is automatically added to the ignore list.

## Usage

1.  **Configure (Optional)**:
    * Adjust VS Code settings under "Sheafy".
    * For project-specific settings, run `Sheafy: Initialize sheafy.toml configuration` and edit `sheafy.toml`.
2.  **Export**:
    * **Specific Folder**: Right-click a folder in VS Code's Explorer and select "Sheafy: Export this folder to clipboard".
    * **Entire Project**: Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`), type "Sheafy", and select "Sheafy: Export current project to text file".

## Default Export Format Template

The default template is:

```
### {relpath}

```{lang}
{content}
````
```

This produces a Markdown output where each file's content is placed in a fenced code block, preceded by its relative path as a heading.

---

Happy Sheafing!
