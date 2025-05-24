// src/sheafyConfig.ts
import * as vscode from 'vscode';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { parse } from '@iarna/toml'; // 确保你已经 npm install @iarna/toml @types/iarna__toml (如果后者存在) 或者只安装前者

export const SHEAFY_TOML_FILENAME = "sheafy.toml";

export interface SheafyTomlConfig {
    bundle_name?: string;
    working_dir?: string;
    use_gitignore?: boolean;
    ignore_patterns?: string; // Multi-line string
    prologue?: string;
    epilogue?: string;
}

export interface SheafyVSCodeSettings {
    respectGitignore: boolean;
    exportDestinations: Array<'clipboard' | 'tempTab' | 'rootDir' | 'workingDir'>;
    exportFormatTemplate: string;
    folderExportPathRelativeToClickedFolder: boolean;
}

export interface MergedSheafyConfig {
    tomlConfig: SheafyTomlConfig | null;
    vscodeSettings: SheafyVSCodeSettings;
    // Effective values after merging/considering defaults
    bundle_name: string;
    working_dir: string; // Absolute path
    use_gitignore: boolean;
    ignore_patterns_array: string[]; // Parsed from multi-line string
    prologue: string;
    epilogue: string;
    basePath: string; // Workspace root path
    exportFormatTemplate: string;
    exportDestinations: Array<'clipboard' | 'tempTab' | 'rootDir' | 'workingDir'>;
    folderExportPathRelativeToClickedFolder: boolean;
}

export async function loadSheafyConfig(resourceUri?: vscode.Uri): Promise<MergedSheafyConfig> {
    let basePath: string;
    let workspaceFolder: vscode.WorkspaceFolder | undefined;

    if (resourceUri) {
        workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
    }

    if (!workspaceFolder && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        // Fallback to the first workspace folder if resourceUri doesn't resolve or isn't provided
        workspaceFolder = vscode.workspace.workspaceFolders[0];
    }

    if (!workspaceFolder) {
        // If still no workspace folder, attempt to use the path of the active editor if available
        const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
        if (activeEditorUri && activeEditorUri.scheme === 'file') {
            workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditorUri);
            if (!workspaceFolder) { // If not part of a workspace, use the directory of the file
                 basePath = path.dirname(activeEditorUri.fsPath);
            } else {
                basePath = workspaceFolder.uri.fsPath;
            }
        } else {
            // As a last resort, if no workspace and no active editor, throw error or use a sensible default for non-workspace operations.
            // For now, we'll throw as most operations depend on a base path.
            throw new Error("Sheafy: Cannot determine workspace folder. Please open a folder or workspace.");
        }
    } else {
        basePath = workspaceFolder.uri.fsPath;
    }


    // 1. Load VSCode settings
    const vsSettings = vscode.workspace.getConfiguration('sheafy', workspaceFolder?.uri);
    const vscodeConfig: SheafyVSCodeSettings = {
        respectGitignore: vsSettings.get<boolean>('respectGitignore', true),
        exportDestinations: vsSettings.get<Array<'clipboard' | 'tempTab' | 'rootDir' | 'workingDir'>>('exportDestinations', ['clipboard']),
        exportFormatTemplate: vsSettings.get<string>('exportFormatTemplate', "### {relpath}\n\n```{lang}\n{content}\n````\n"),
        folderExportPathRelativeToClickedFolder: vsSettings.get<boolean>('folderExport.pathRelativeToClickedFolder', false) // <--- 读取新设置
    };

    // 2. Load sheafy.toml
    let tomlConfig: SheafyTomlConfig | null = null;
    const tomlPath = path.join(basePath, SHEAFY_TOML_FILENAME);
    try {
        const tomlContent = await fsPromises.readFile(tomlPath, 'utf-8');
        const parsedToml = parse(tomlContent); // @iarna/toml can throw TomlError
        if (parsedToml.sheafy && typeof parsedToml.sheafy === 'object') {
            tomlConfig = parsedToml.sheafy as SheafyTomlConfig;
        } else {
            vscode.window.showWarningMessage(`Sheafy: ${SHEAFY_TOML_FILENAME} found, but is missing a [sheafy] section or is malformed. Using defaults.`);
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            // sheafy.toml not found, which is fine.
        } else if (error.name === 'TomlError') { // Check for TomlError specifically
             vscode.window.showErrorMessage(`Sheafy: Error parsing ${SHEAFY_TOML_FILENAME}: ${error.message} (line ${error.line}, col ${error.col}).`);
        } else {
            vscode.window.showErrorMessage(`Sheafy: Error reading ${SHEAFY_TOML_FILENAME}: ${error.message}`);
            console.error(`Sheafy TOML read/parse error:`, error);
        }
    }

    // 3. Merge and establish effective values
    const effectiveBundleName = tomlConfig?.bundle_name || "project_bundle.md";
    const effectiveWorkingDir = path.resolve(basePath, tomlConfig?.working_dir || ".");

    let effectiveUseGitignore = vscodeConfig.respectGitignore; // Default to VSCode setting
    if (tomlConfig?.use_gitignore !== undefined) { // If sheafy.toml specifies it, it takes precedence
        effectiveUseGitignore = tomlConfig.use_gitignore;
    }

    const ignorePatternsRaw = tomlConfig?.ignore_patterns || "";
    const effectiveIgnorePatternsArray = ignorePatternsRaw
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0 && !p.startsWith('#'));


    return {
        tomlConfig,
        vscodeSettings: vscodeConfig,
        bundle_name: effectiveBundleName,
        working_dir: effectiveWorkingDir,
        use_gitignore: effectiveUseGitignore,
        ignore_patterns_array: effectiveIgnorePatternsArray,
        prologue: tomlConfig?.prologue || "",
        epilogue: tomlConfig?.epilogue || "",
        basePath: basePath,
        exportFormatTemplate: vscodeConfig.exportFormatTemplate,
        exportDestinations: vscodeConfig.exportDestinations.length > 0 ? vscodeConfig.exportDestinations : ['clipboard'], // Ensure at least one default
        folderExportPathRelativeToClickedFolder: vscodeConfig.folderExportPathRelativeToClickedFolder // <--- 添加到返回对象

    };
}
