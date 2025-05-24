// src/fileProcessor.ts
import * as vscode from 'vscode';
import { promises as fsPromises, constants as fsConstants } from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { MergedSheafyConfig } from './sheafyConfig'; // Assuming this path is correct

// ExportResultDetails interface remains the same
export interface ExportResultDetails {
    filePath?: string;
    type: 'clipboard' | 'tempTab' | 'file';
    success: boolean;
    message?: string;
}

// getGitignoreFilter, getAllFilesRecursive, getLanguageId functions remain the same as before.
// Make sure they are present in your file. For brevity, I'll omit them here but assume they exist.

async function getGitignoreFilter(rootPath: string): Promise<Ignore> {
    const ig = ignore();
    const gitignorePath = path.join(rootPath, '.gitignore');
    try {
        const gitignoreContent = await fsPromises.readFile(gitignorePath, 'utf-8');
        ig.add(gitignoreContent);
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            console.warn(`Sheafy: Could not read .gitignore at ${gitignorePath}: ${error.message}`);
        }
    }
    return ig;
}

async function getAllFilesRecursive(dirPath: string, arrayOfFiles: string[] = [], token?: vscode.CancellationToken): Promise<string[]> {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
    let entries;
    try {
        entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    } catch (error: any) {
        console.warn(`Sheafy: Could not read directory ${dirPath}: ${error.message}`);
        return arrayOfFiles;
    }

    for (const entry of entries) {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'build' || entry.name === 'dist') {
                continue;
            }
            await getAllFilesRecursive(fullPath, arrayOfFiles, token);
        } else {
            arrayOfFiles.push(fullPath);
        }
    }
    return arrayOfFiles;
}

function getLanguageId(filePath: string): string {
    const extension = path.extname(filePath).substring(1).toLowerCase();
    const langMap: { [key: string]: string } = {
        ts: 'typescript', tsx: 'typescriptreact',
        js: 'javascript', jsx: 'javascriptreact',
        py: 'python', java: 'java', cs: 'csharp',
        cpp: 'cpp', h: 'cpp', hpp: 'cpp', c: 'c',
        go: 'go', rb: 'ruby', php: 'php',
        html: 'html', htm: 'html', css: 'css',
        scss: 'scss', sass: 'sass', less: 'less',
        json: 'json', xml: 'xml', md: 'markdown',
        sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
        yaml: 'yaml', yml: 'yaml', toml: 'toml',
        sql: 'sql', swift: 'swift', kt: 'kotlin',
        rs: 'rust', lua: 'lua', pl: 'perl',
        scala: 'scala', vb: 'vb', dart: 'dart',
        dockerfile: 'dockerfile', graphql: 'graphql',
        vue: 'vue', svelte: 'svelte',
    };
    return langMap[extension] || extension || 'plaintext';
}


export async function exportContent(
    startPathInput: string,
    config: MergedSheafyConfig,
    progress: vscode.Progress<{ message?: string; increment?: number }>, // Added progress object
    token: vscode.CancellationToken // Added cancellation token
): Promise<ExportResultDetails[]> {

    const startPath = path.resolve(config.basePath, startPathInput);
    let allFilePaths: string[];

    progress.report({ increment: 0, message: "Discovering files..." }); // Initial message
    if (token.isCancellationRequested) throw new vscode.CancellationError();

    try {
        const stat = await fsPromises.stat(startPath);
        if (!stat.isDirectory()) {
            throw new Error(`Start path '${startPath}' is not a directory.`);
        }
        allFilePaths = await getAllFilesRecursive(startPath, [], token);
    } catch (error: any) {
        if (error instanceof vscode.CancellationError) throw error;
        vscode.window.showErrorMessage(`Sheafy: Error accessing start path ${startPath}: ${error.message}`);
        return [{ type: 'file', success: false, message: `Error accessing start path: ${error.message}` }];
    }
    progress.report({ increment: 15, message: `Found ${allFilePaths.length} files. Preparing filters...` });
    if (token.isCancellationRequested) throw new vscode.CancellationError();

    const mainFilter = ignore();
    const bundleFilename = config.bundle_name;
    const bundleRelPathInRootDir = path.relative(config.basePath, path.join(config.basePath, bundleFilename));
    mainFilter.add(bundleRelPathInRootDir.replace(/\\/g, '/'));
    const bundleRelPathInWorkingDir = path.relative(config.basePath, path.join(config.working_dir, bundleFilename));
    if (bundleRelPathInWorkingDir !== bundleRelPathInRootDir) {
        mainFilter.add(bundleRelPathInWorkingDir.replace(/\\/g, '/'));
    }
    mainFilter.add(path.relative(config.basePath, path.join(config.basePath, "sheafy.toml")).replace(/\\/g, '/'));
    if (config.ignore_patterns_array.length > 0) {
        mainFilter.add(config.ignore_patterns_array);
    }

    let gitignoreFilter: Ignore | null = null;
    if (config.use_gitignore) {
        gitignoreFilter = await getGitignoreFilter(config.basePath);
    }
    progress.report({ increment: 10, message: "Filtering and formatting content..." });
    if (token.isCancellationRequested) throw new vscode.CancellationError();

    const outputParts: string[] = [];
    if (config.prologue) {
        outputParts.push(config.prologue);
    }

    // Calculate increment per file for the processing part (e.g., 50% of total progress)
    const totalFiles = allFilePaths.length;
    const progressIncrementForFileProcessing = totalFiles > 0 ? 50 / totalFiles : 0;

    for (const filePath of allFilePaths) {
        if (token.isCancellationRequested) throw new vscode.CancellationError();

        const relPathForFilter = path.relative(config.basePath, filePath).replace(/\\/g, '/');
        let relPathForTemplate: string;
        const isFolderExportFromSubdirectory = (startPath !== config.basePath);

        if (isFolderExportFromSubdirectory && config.folderExportPathRelativeToClickedFolder) {
            relPathForTemplate = path.relative(startPath, filePath).replace(/\\/g, '/');
        } else {
            relPathForTemplate = path.relative(config.basePath, filePath).replace(/\\/g, '/');
        }

        if (relPathForFilter.startsWith('.git/') || relPathForFilter === '.git') {
            if(totalFiles === 1 && progressIncrementForFileProcessing > 0) progress.report({ increment: progressIncrementForFileProcessing }); // Ensure progress even for single ignored file
            continue;
        }
        if (gitignoreFilter && gitignoreFilter.ignores(relPathForFilter)) {
            if(totalFiles === 1 && progressIncrementForFileProcessing > 0) progress.report({ increment: progressIncrementForFileProcessing });
            continue;
        }
        if (mainFilter.ignores(relPathForFilter)) {
            if(totalFiles === 1 && progressIncrementForFileProcessing > 0) progress.report({ increment: progressIncrementForFileProcessing });
            continue;
        }

        try {
            const content = await fsPromises.readFile(filePath, 'utf-8');
            const lang = getLanguageId(filePath);
            let formattedContent = config.exportFormatTemplate
                .replace(/{relpath}/g, relPathForTemplate)
                .replace(/{lang}/g, lang)
                .replace(/{content}/g, content);
            outputParts.push(formattedContent);
        } catch (readError: any) {
            if (readError instanceof vscode.CancellationError) throw readError;
            console.warn(`Sheafy: Could not read file ${filePath}: ${readError.message}`);
            outputParts.push(`### ${relPathForTemplate}\n\n--- ERROR: Could not read file: ${readError.message} ---\n`);
        }
        if (progressIncrementForFileProcessing > 0) {
            progress.report({ increment: progressIncrementForFileProcessing });
        }
    }
    // Ensure the 50% allocated for file processing is reported if loop didn't run or was too fast.
    // This logic is a bit simplified; a more robust way is to track remaining progress for this step.
    // For now, if loop ran, it reported. If not (0 files), 50% is skipped.

    progress.report({ message: "Finalizing output...", increment: token.isCancellationRequested ? 0 : 5 }); // Small increment before join
    if (token.isCancellationRequested) throw new vscode.CancellationError();

    if (config.epilogue) {
        outputParts.push(config.epilogue);
    }
    const finalOutput = outputParts.join('\n\n');
    progress.report({ increment: 10, message: "Saving to destinations..." });
    if (token.isCancellationRequested) throw new vscode.CancellationError();

    const results: ExportResultDetails[] = [];
    for (const dest of config.exportDestinations) {
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        try {
            switch (dest) {
                case 'clipboard':
                    await vscode.env.clipboard.writeText(finalOutput);
                    results.push({ type: 'clipboard', success: true });
                    break;
                case 'tempTab':
                    const document = await vscode.workspace.openTextDocument({
                        content: finalOutput,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(document, { preview: false });
                    results.push({ type: 'tempTab', success: true });
                    break;
                case 'rootDir':
                case 'workingDir':
                    const targetDir = dest === 'rootDir' ? config.basePath : config.working_dir;
                    if (dest === 'workingDir' && targetDir !== config.basePath) {
                        try {
                            await fsPromises.mkdir(targetDir, { recursive: true });
                        } catch (mkdirError: any) {
                            results.push({ type: 'file', success: false, message: `Failed to create working directory ${targetDir}: ${mkdirError.message}` });
                            continue;
                        }
                    }
                    const outputFilePath = path.join(targetDir, config.bundle_name);
                    await fsPromises.writeFile(outputFilePath, finalOutput);
                    const relOutputFilePath = path.relative(config.basePath, outputFilePath) || config.bundle_name;
                    results.push({ type: 'file', success: true, filePath: relOutputFilePath });
                    break;
            }
        } catch (error: any) {
            if (error instanceof vscode.CancellationError) throw error;
            results.push({ type: dest === 'clipboard' || dest === 'tempTab' ? dest : 'file', success: false, message: (error as Error).message });
            console.error(`Sheafy: Error during export to ${dest}:`, error);
        }
    }
    // Remaining progress is handled in extension.ts after this function returns
    return results;
}
