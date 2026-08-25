// Fresh test for files.list with path expansion fix
import { runPowerShell } from './src/tools/executor.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const oneDriveDesktop = join(homedir(), "OneDrive", "Desktop");
const regularDesktop = join(homedir(), "Desktop");
const desktopPath = existsSync(oneDriveDesktop) ? oneDriveDesktop : regularDesktop;
console.log('Desktop path:', desktopPath);
console.log('Exists:', existsSync(desktopPath));

// Test the actual files.list tool by importing fresh
const result = await runPowerShell(`Get-ChildItem -Path '${desktopPath}' | Select-Object Name, LastWriteTime | ConvertTo-Json`);
console.log('Result:', result.stdout);