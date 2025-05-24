// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import { loadSheafyConfig, SHEAFY_TOML_FILENAME, MergedSheafyConfig } from './sheafyConfig';
import { exportContent, ExportResultDetails } from './fileProcessor';

export function activate(context: vscode.ExtensionContext) {
	console.log('Sheafy extension is now active!');

	const handleExportResults = (results: ExportResultDetails[], operationDisplayName: string) => {
		let successMessages: string[] = [];
		let errorMessages: string[] = [];

		results.forEach(result => {
			if (result.success) {
				switch (result.type) {
					case 'clipboard':
						successMessages.push("Copied to clipboard.");
						break;
					case 'tempTab':
						successMessages.push("Opened in a new tab.");
						break;
					case 'file':
						successMessages.push(`Written to file: ${result.filePath}`);
						break;
				}
			} else {
				errorMessages.push(`Failed to export to ${result.type}: ${result.message}`);
			}
		});

		if (successMessages.length > 0) {
			vscode.window.showInformationMessage(`Sheafy: ${operationDisplayName} successful! ${successMessages.join(' ')}`);
		}
		if (errorMessages.length > 0) {
			vscode.window.showErrorMessage(`Sheafy: ${operationDisplayName} encountered errors. ${errorMessages.join(' ')}`);
		}
		if (successMessages.length === 0 && errorMessages.length === 0) {
			vscode.window.showWarningMessage(`Sheafy: ${operationDisplayName} completed, but no output was generated or an unknown issue occurred.`);
		}
	};

	const exportFolderToClipboardCommand = vscode.commands.registerCommand(
		'sheafy.exportFolderToClipboard',
		async (folderUri?: vscode.Uri) => {
			if (!folderUri) {
				vscode.window.showErrorMessage('Sheafy: No folder selected for export.');
				return;
			}

			try {
				// loadSheafyConfig will now include 'folderExportPathRelativeToClickedFolder'
				const config = await loadSheafyConfig(folderUri);
				const specificConfig: MergedSheafyConfig = {
					...config,
					exportDestinations: ['clipboard'] // Override destinations for this specific command
				};

				// The 'startPath' for folder export is folderUri.fsPath
				// The logic within exportContent will use specificConfig.folderExportPathRelativeToClickedFolder
				// and specificConfig.basePath along with folderUri.fsPath to determine {relpath}
				const results = await exportContent(folderUri.fsPath, specificConfig);
				handleExportResults(results, `Folder export to clipboard`);

			} catch (error: any) {
				vscode.window.showErrorMessage(`Sheafy: Error exporting folder: ${error.message}`);
				console.error("Sheafy exportFolderToClipboard error:", error);
			}
		}
	);

	const exportProjectCommand = vscode.commands.registerCommand(
		'sheafy.exportProjectToTextFile', // Name implies file, but destinations are from config
		async () => {
			// Use first workspace folder as the project root for this command.
			// loadSheafyConfig will determine the basePath correctly.
			let projectRootUri: vscode.Uri | undefined;
			if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
				projectRootUri = vscode.workspace.workspaceFolders[0].uri;
			} else if (vscode.window.activeTextEditor) {
				const activeDocUri = vscode.window.activeTextEditor.document.uri;
				const wsFolder = vscode.workspace.getWorkspaceFolder(activeDocUri);
				if (wsFolder) {
					projectRootUri = wsFolder.uri;
				} else if (activeDocUri.scheme === 'file') {
					// Not in a workspace, but have an open file. Use its directory.
					// This might not be ideal as "project" usually implies a workspace.
					// Consider prompting or erroring if no workspace.
					// For now, sheafyConfig will try to use path.dirname(activeDocUri.fsPath)
					projectRootUri = activeDocUri; // loadSheafyConfig will derive basePath
				}
			}

			if (!projectRootUri) {
				vscode.window.showErrorMessage('Sheafy: No project folder open or file active to determine export root.');
				return;
			}

			try {
				const config = await loadSheafyConfig(projectRootUri);

				if (config.exportDestinations.length === 0) {
					vscode.window.showWarningMessage('Sheafy: No export destinations configured. Please check your Sheafy settings and sheafy.toml.');
					return;
				}
				const results = await exportContent(config.basePath, config); // Export from basePath (project root)
				handleExportResults(results, "Project export");

			} catch (error: any) {
				vscode.window.showErrorMessage(`Sheafy: Error exporting project: ${error.message}`);
				console.error("Sheafy exportProjectCommand error:", error);
			}
		}
	);

	const initConfigCommand = vscode.commands.registerCommand(
		'sheafy.initializeSheafyConfig',
		async () => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				vscode.window.showErrorMessage('Sheafy: No workspace folder open to initialize configuration.');
				return;
			}
			const rootPath = workspaceFolders[0].uri.fsPath;
			const tomlPath = path.join(rootPath, SHEAFY_TOML_FILENAME);

			try {
				await fsPromises.access(tomlPath); // Check if file exists
				vscode.window.showInformationMessage(`Sheafy: ${SHEAFY_TOML_FILENAME} already exists at ${tomlPath}.`);
			} catch {
				// File does not exist, create it
				const defaultConfigContent = `[sheafy]
# Output filename for bundle command (when 'rootDir' or 'workingDir' destination is chosen)
bundle_name = "project_bundle.md"

# Optional working directory / default export directory (relative to this config file)
# Default is the project root if not specified.
# Example: working_dir = "docs/export"
working_dir = "."

# Whether to respect .gitignore files.
# This can also be controlled by the VSCode setting "sheafy.respectGitignore".
# If 'use_gitignore' is set in this TOML file, it will override the VSCode setting.
# Allowed values: true or false. If commented out or absent, VSCode setting is used.
# use_gitignore = true

# Optional: Add custom ignore patterns (multi-line string, gitignore syntax).
# These patterns are applied *in addition* to .gitignore rules (if use_gitignore is true).
# Lines starting with # are comments.
ignore_patterns = """
# IDE and OS specific files
.vscode/
.idea/
*.code-workspace
.DS_Store

# Node.js
node_modules/
package-lock.json
yarn.lock
*.log

# Build outputs
dist/
build/
out/
target/

# Sheafy's own output file (if different from bundle_name or you want to be explicit)
# project_bundle.md 
# sheafy.toml
"""

# Optional prologue text to include at the start of the bundle
prologue = """
"""

# Optional epilogue text to include at the end of the bundle
epilogue = """
"""
`;
				try {
					await fsPromises.writeFile(tomlPath, defaultConfigContent);
					vscode.window.showInformationMessage(`Sheafy: ${SHEAFY_TOML_FILENAME} created successfully at ${tomlPath}.`);
					const document = await vscode.workspace.openTextDocument(tomlPath);
					await vscode.window.showTextDocument(document);
				} catch (error: any) {
					vscode.window.showErrorMessage(`Sheafy: Failed to create ${SHEAFY_TOML_FILENAME}: ${error.message}`);
					console.error("Sheafy initConfigCommand writeFile error:", error);
				}
			}
		}
	);

	context.subscriptions.push(
		exportFolderToClipboardCommand,
		exportProjectCommand,
		initConfigCommand
	);
}

export function deactivate() {
	console.log('Sheafy extension is now deactivated.');
}
