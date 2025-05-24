// src/fileProcessor.ts
import * as vscode from 'vscode';
import { promises as fsPromises, constants as fsConstants } from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore'; // 确保你已经 npm install ignore @types/ignore
import { MergedSheafyConfig } from './sheafyConfig';

export interface ExportOptions {
    startPath: string;      // The folder to start exporting from (absolute)
    // Other options are now derived from MergedSheafyConfig directly in exportContent
}

export interface ExportResultDetails {
    filePath?: string; // Path of the file written, relative to workspace root
    type: 'clipboard' | 'tempTab' | 'file';
    success: boolean;
    message?: string;
}

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
        // If .gitignore doesn't exist, ig will simply be empty, which is fine.
    }
    return ig;
}

async function getAllFilesRecursive(dirPath: string, arrayOfFiles: string[] = []): Promise<string[]> {
    let entries;
    try {
        entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    } catch (error: any) {
        // Log error or handle (e.g., skip inaccessible directories)
        console.warn(`Sheafy: Could not read directory ${dirPath}: ${error.message}`);
        return arrayOfFiles; // Return what has been collected so far
    }

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            // Explicitly ignore .git directories at any level.
            // Also common build/dependency dirs that are almost universally ignored.
            if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'build' || entry.name === 'dist') {
                continue;
            }
            await getAllFilesRecursive(fullPath, arrayOfFiles);
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
        py: 'python',
        java: 'java',
        cs: 'csharp',
        cpp: 'cpp', h: 'cpp', hpp: 'cpp',
        c: 'c',
        go: 'go',
        rb: 'ruby',
        php: 'php',
        html: 'html', htm: 'html',
        css: 'css',
        scss: 'scss', sass: 'sass',
        less: 'less',
        json: 'json',
        xml: 'xml',
        md: 'markdown',
        sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
        yaml: 'yaml', yml: 'yaml',
        toml: 'toml',
        sql: 'sql',
        swift: 'swift',
        kt: 'kotlin',
        rs: 'rust',
        lua: 'lua',
        pl: 'perl',
        scala: 'scala',
        vb: 'vb',
        dart: 'dart',
        dockerfile: 'dockerfile',
        graphql: 'graphql',
        vue: 'vue',
        svelte: 'svelte',
    };
    return langMap[extension] || extension || 'plaintext';
}


export async function exportContent(
    startPathInput: string, // Can be relative or absolute, will be resolved
    config: MergedSheafyConfig
): Promise<ExportResultDetails[]> {

    const startPath = path.resolve(config.basePath, startPathInput);

    let allFilePaths: string[];
    try {
        const stat = await fsPromises.stat(startPath);
        if (!stat.isDirectory()) {
            throw new Error(`Start path '${startPath}' is not a directory.`);
        }
        allFilePaths = await getAllFilesRecursive(startPath);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Sheafy: Error accessing start path ${startPath}: ${error.message}`);
        return [{ type: 'file', success: false, message: `Error accessing start path: ${error.message}` }];
    }

    const mainFilter = ignore(); // For sheafy.toml patterns and bundle_name

    // 1. Add bundle_name to ignored files (relative to basePath for consistent filtering)
    // The bundle_name is relative to either basePath (for rootDir) or working_dir.
    // We need to make sure these potential output paths are ignored relative to the basePath.
    const bundleFilename = config.bundle_name;
    const bundleRelPathInRootDir = path.relative(config.basePath, path.join(config.basePath, bundleFilename));
    mainFilter.add(bundleRelPathInRootDir.replace(/\\/g, '/')); // Normalize slashes for ignore pattern

    const bundleRelPathInWorkingDir = path.relative(config.basePath, path.join(config.working_dir, bundleFilename));
    if (bundleRelPathInWorkingDir !== bundleRelPathInRootDir) {
        mainFilter.add(bundleRelPathInWorkingDir.replace(/\\/g, '/'));
    }
    // Also ignore sheafy.toml itself
    mainFilter.add(path.relative(config.basePath, path.join(config.basePath, "sheafy.toml")).replace(/\\/g, '/'));


    // 2. Add custom ignore patterns from sheafy.toml (these are already relative or gitignore-style)
    if (config.ignore_patterns_array.length > 0) {
        mainFilter.add(config.ignore_patterns_array);
    }

    // 3. Prepare .gitignore filter if respectGitignore is true
    let gitignoreFilter: Ignore | null = null;
    if (config.use_gitignore) {
        gitignoreFilter = await getGitignoreFilter(config.basePath); // .gitignore is relative to basePath
    }

    const outputParts: string[] = [];

    if (config.prologue) {
        outputParts.push(config.prologue);
    }

    const fileProcessingPromises = allFilePaths.map(async (filePath) => {
        // For filtering, paths should be relative to the basePath (where .gitignore and sheafy.toml patterns are rooted)
        const relPathForFilter = path.relative(config.basePath, filePath).replace(/\\/g, '/');

        let relPathForTemplate: string;
        const isFolderExportFromSubdirectory = (startPath !== config.basePath);

        if (isFolderExportFromSubdirectory && config.folderExportPathRelativeToClickedFolder) {
            // For folder export (not project root) AND setting is true: relative to clicked folder (startPath)
            relPathForTemplate = path.relative(startPath, filePath).replace(/\\/g, '/');
        } else {
            // For project export OR folder export with setting false (default): relative to workspace root (config.basePath)
            relPathForTemplate = path.relative(config.basePath, filePath).replace(/\\/g, '/');
        }
        if (relPathForFilter.startsWith('.git/') || relPathForFilter === '.git') return null;

        if (gitignoreFilter && gitignoreFilter.ignores(relPathForFilter)) {
            return null;
        }
        if (mainFilter.ignores(relPathForFilter)) {
            return null;
        }

        try {
            const content = await fsPromises.readFile(filePath, 'utf-8');
            const lang = getLanguageId(filePath);
            let formattedContent = config.exportFormatTemplate
                .replace(/{relpath}/g, relPathForTemplate)
                .replace(/{lang}/g, lang)
                .replace(/{content}/g, content);
            return formattedContent;
        } catch (readError: any) {
            console.warn(`Sheafy: Could not read file ${filePath}: ${readError.message}`);
            // Include a note about the error in the output for this file
            return `### ${relPathForTemplate}\n\n--- ERROR: Could not read file: ${readError.message} ---\n`;
        }
    });

    const processedContents = (await Promise.all(fileProcessingPromises)).filter(content => content !== null) as string[];
    outputParts.push(...processedContents);

    if (config.epilogue) {
        outputParts.push(config.epilogue);
    }

    const finalOutput = outputParts.join('\n\n');
    const results: ExportResultDetails[] = [];

    for (const dest of config.exportDestinations) {
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
                        try { // Ensure working_dir exists
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
            results.push({ type: dest === 'clipboard' || dest === 'tempTab' ? dest : 'file', success: false, message: error.message });
            console.error(`Sheafy: Error during export to ${dest}:`, error);
        }
    }
    return results;
}
