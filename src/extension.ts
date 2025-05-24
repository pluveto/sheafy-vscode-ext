// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import { loadSheafyConfig, SHEAFY_TOML_FILENAME, MergedSheafyConfig } from './sheafyConfig'; // Assuming path is correct
import { exportContent, ExportResultDetails } from './fileProcessor'; // Assuming path is correct

export function activate(context: vscode.ExtensionContext) {
    console.log('Sheafy extension is now active!');

    const handleExportResults = (results: ExportResultDetails[], operationDisplayName: string) => {
        // This function remains the same as before
        let successMessages: string[] = [];
        let errorMessages: string[] = [];

        results.forEach(result => {
            if (result.success) {
                switch (result.type) {
                    case 'clipboard': successMessages.push("Copied to clipboard."); break;
                    case 'tempTab': successMessages.push("Opened in a new tab."); break;
                    case 'file': successMessages.push(`Written to file: ${result.filePath}`); break;
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
        if (successMessages.length === 0 && errorMessages.length === 0 && results.length > 0 && results.every(r => !r.success)) {
            // All failed, but no specific messages accumulated (shouldn't happen if message is always set on error)
             vscode.window.showWarningMessage(`Sheafy: ${operationDisplayName} failed. Check logs for details.`);
        } else if (successMessages.length === 0 && errorMessages.length === 0 && results.length === 0) {
            // No export destinations or no files found perhaps
            vscode.window.showWarningMessage(`Sheafy: ${operationDisplayName} completed, but no output was generated based on current settings or files found.`);
        }
    };

    const exportFolderToClipboardCommand = vscode.commands.registerCommand(
        'sheafy.exportFolderToClipboard',
        async (folderUri?: vscode.Uri) => {
            if (!folderUri) {
                vscode.window.showErrorMessage('Sheafy: No folder selected for export.');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Sheafy: Exporting folder to clipboard...`,
                cancellable: true
            }, async (progress, token) => {
                try {
                    progress.report({ increment: 0, message: "Loading configuration..." });
                    const config = await loadSheafyConfig(folderUri);
                    if (token.isCancellationRequested) throw new vscode.CancellationError();
                    progress.report({ increment: 10 }); // Config loaded

                    const specificConfig: MergedSheafyConfig = {
                        ...config,
                        exportDestinations: ['clipboard']
                    };
                    
                    // exportContent will handle increments from 10 to 90
                    const results = await exportContent(folderUri.fsPath, specificConfig, progress, token);
                    if (token.isCancellationRequested) throw new vscode.CancellationError();

                    progress.report({ increment: 100, message: "Finalizing..." }); // Complete to 100
                    handleExportResults(results, `Folder export to clipboard`);

                } catch (error: any) {
                    if (error instanceof vscode.CancellationError) {
                        vscode.window.showInformationMessage("Sheafy: Folder export cancelled.");
                    } else {
                        vscode.window.showErrorMessage(`Sheafy: Error exporting folder: ${error.message}`);
                        console.error("Sheafy exportFolderToClipboard error:", error);
                    }
                }
            });
        }
    );

    const exportProjectCommand = vscode.commands.registerCommand(
        'sheafy.exportProjectToTextFile',
        async () => {
            let projectRootUri: vscode.Uri | undefined;
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                projectRootUri = vscode.workspace.workspaceFolders[0].uri;
            } else if (vscode.window.activeTextEditor) {
                // ... (logic to determine projectRootUri from active editor, same as before)
                const activeDocUri = vscode.window.activeTextEditor.document.uri;
                const wsFolder = vscode.workspace.getWorkspaceFolder(activeDocUri);
                if (wsFolder) {
                    projectRootUri = wsFolder.uri;
                } else if (activeDocUri.scheme === 'file') {
                    projectRootUri = activeDocUri; 
                }
            }

            if (!projectRootUri) {
                vscode.window.showErrorMessage('Sheafy: No project folder open or file active to determine export root.');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Sheafy: Exporting project...`,
                cancellable: true
            }, async (progress, token) => {
                try {
                    progress.report({ increment: 0, message: "Loading configuration..." });
                    const config = await loadSheafyConfig(projectRootUri);
                    if (token.isCancellationRequested) throw new vscode.CancellationError();
                    progress.report({ increment: 10 }); // Config loaded

                    if (config.exportDestinations.length === 0) {
                        vscode.window.showWarningMessage('Sheafy: No export destinations configured.');
                        return; // Exits progress scope
                    }
                    
                    // exportContent will handle increments from 10 to 90 (or more if config is fast)
                    const results = await exportContent(config.basePath, config, progress, token);
                    if (token.isCancellationRequested) throw new vscode.CancellationError();

                    progress.report({ increment: 100, message: "Finalizing..." }); // Complete to 100
                    handleExportResults(results, "Project export");

                } catch (error: any) {
                     if (error instanceof vscode.CancellationError) {
                        vscode.window.showInformationMessage("Sheafy: Project export cancelled.");
                    } else {
                        vscode.window.showErrorMessage(`Sheafy: Error exporting project: ${error.message}`);
                        console.error("Sheafy exportProjectCommand error:", error);
                    }
                }
            });
        }
    );

    // initConfigCommand remains the same as before
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
                await fsPromises.access(tomlPath);
                vscode.window.showInformationMessage(`Sheafy: ${SHEAFY_TOML_FILENAME} already exists at ${tomlPath}.`);
            } catch {
                const defaultConfigContent = `[sheafy]
# ... (default TOML content as provided before) ...
bundle_name = "project_bundle.md"
working_dir = "."
ignore_patterns = """
.vscode/
.idea/
*.code-workspace
.DS_Store
node_modules/
package-lock.json
yarn.lock
*.log
dist/
build/
out/
target/
"""
prologue = ""
epilogue = ""
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
