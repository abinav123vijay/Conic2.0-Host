import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(entryPath);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [entryPath] : [];
  });
}

const testFiles = findTests(testsDirectory);
const result = spawnSync(process.execPath, [
  '--import', 'tsx',
  '--import', pathToFileURL(path.join(testsDirectory, 'setup.mjs')).href,
  '--test',
  ...testFiles
], { cwd: process.cwd(), stdio: 'inherit' });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
