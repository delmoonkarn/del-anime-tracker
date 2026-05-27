// Orchestrates the ATracker.exe build:
//   1. Patch the pkg-cached Node base binary's icon (see set-exe-icon.mjs)
//   2. Run pkg with PKG_NODE_PATH pointed at that base so pkg (a) skips the
//      hash check and (b) uses the same binary for bytecode compilation.

import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cacheDir = path.join(homedir(), '.pkg-cache');

// Match v22 specifically — see set-exe-icon.mjs for why.
function findFetched() {
  if (!fs.existsSync(cacheDir)) return null;
  for (const v of fs.readdirSync(cacheDir)) {
    const vDir = path.join(cacheDir, v);
    if (!fs.statSync(vDir).isDirectory()) continue;
    for (const f of fs.readdirSync(vDir)) {
      if (f.startsWith('fetched-v22.') && f.includes('win-x64')) {
        return path.join(vDir, f);
      }
    }
  }
  return null;
}

function run(cmd, args, env = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    console.error(`\n[!] step failed (exit ${r.status}): ${cmd}`);
    process.exit(r.status ?? 1);
  }
}

// Step 1: icon-patch the pkg base. set-exe-icon.mjs takes care of triggering
// the download if it's not cached yet, then rcedits the icon in place.
run('node', ['scripts/set-exe-icon.mjs']);

const fetched = findFetched();
if (!fetched) {
  console.error('[build-exe] No pkg base binary found after icon step.');
  process.exit(1);
}

// Step 2: free the output path then build. PKG_NODE_PATH skips the hash
// check AND tells pkg which Node binary to use for bytecode compilation.
const outPath = path.join(root, 'ATracker.exe');
if (fs.existsSync(outPath)) {
  try {
    fs.unlinkSync(outPath);
  } catch {
    setTimeout(() => fs.unlinkSync(outPath), 300);
  }
}

run(
  'pkg',
  ['launcher.js', '--target', 'node22-win-x64', '--output', 'ATracker.exe'],
  { PKG_NODE_PATH: fetched },
);

console.log('\n✔ ATracker.exe built with embedded icon.');
