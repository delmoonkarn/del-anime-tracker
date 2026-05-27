// Embeds icon/icon.ico into the pkg-cached Node base binary BEFORE pkg uses
// it, so the icon survives in the final .exe.
//
// Why this dance:
//   - rcedit/resedit AFTER pkg breaks the appended JS payload (the .exe boots
//     with "SyntaxError ... bootstrap.js:1").
//   - Editing the `fetched-*` base directly is normally reverted by pkg's
//     hash check ("Binary hash does NOT match. Re-fetching...").
//   - BUT pkg-fetch checks for the env var PKG_NODE_PATH and, when set,
//     SKIPS the hash check entirely (see node_modules/@yao-pkg/pkg-fetch/
//     lib-es5/index.js around line 189). So we icon-patch the fetched
//     binary and run pkg with PKG_NODE_PATH=1 — pkg uses our modified base
//     verbatim and appends the JS payload on top. Icon survives.

import { execSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const icoPath = path.join(root, 'icon', 'icon.ico');
const rceditBin = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
const cacheDir = path.join(homedir(), '.pkg-cache');

if (!fs.existsSync(icoPath)) {
  console.error(`[icon] Missing icon at ${icoPath}`);
  process.exit(1);
}
if (!fs.existsSync(rceditBin)) {
  console.error(`[icon] rcedit binary missing at ${rceditBin}`);
  process.exit(1);
}

// Match v22 specifically — node target is node22-win-x64 (see build-exe.mjs).
// Older v18 binaries may still be in the cache from earlier builds; ignore
// them so we don't accidentally icon-patch the wrong version.
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

let fetched = findFetched();
if (!fetched) {
  console.log('[icon] No pkg base in cache; triggering a download…');
  // Relative paths because shell:true + absolute path with spaces (this
  // project lives at "ATracker 2 overhaul") gets word-split on Windows.
  spawnSync('pkg', ['launcher.js', '--target', 'node22-win-x64', '--output', '_pkg_warmup.exe'], {
    stdio: 'inherit',
    shell: true,
    cwd: root,
  });
  try {
    fs.unlinkSync(path.join(root, '_pkg_warmup.exe'));
  } catch {}
  fetched = findFetched();
}
if (!fetched) {
  console.error('[icon] Failed to locate pkg base binary');
  process.exit(1);
}

console.log(`[icon] Embedding ${path.relative(root, icoPath)} into ${path.basename(fetched)}`);
execSync(`"${rceditBin}" "${fetched}" --set-icon "${icoPath}"`, { stdio: 'inherit' });
console.log('[icon] Done. Run pkg with PKG_NODE_PATH set so it skips the hash check.');
