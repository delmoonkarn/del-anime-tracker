// Anime Tracker launcher (v2 — prod mode, inline server).
// Packaged into ATracker.exe via @yao-pkg/pkg. The .exe sits in the project
// root; double-click to launch:
//   1. install deps if node_modules is missing (first run)
//   2. build dist/ + dist-server/ if missing (first run after install / source change)
//   3. require dist-server/index.cjs into this process — one Hono process
//      serving the prebuilt SPA + API on :3001. No child spawn, no Vite,
//      no tsx, no npm wrapper.
//   4. open the user's default browser once the server logs "[api] listening"
//
// Inlining the server (rather than spawning a child `node`) sidesteps a pkg
// quirk where spawn('node', …) on Windows gets routed back through the .exe,
// which then shell-splits on the space in "ATracker 2 overhaul". It also
// shaves another ~100ms off startup by avoiding the extra Node boot.
//
// Dev mode (HMR, watch, two ports) is still available via `npm run dev`.

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// process.execPath = the path to the running .exe (lives at project root).
const projectDir = path.dirname(process.execPath);
process.chdir(projectDir);

const PORT = 3001;
const URL = `http://localhost:${PORT}`;

function openBrowser(url) {
  // `start "" url` — `""` is the empty window title argument that `start`
  // needs when the path/URL might be quoted.
  spawn('cmd', ['/c', 'start', '""', url], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function fail(msg, err) {
  console.error('\n[!] ' + msg);
  if (err) console.error(err.message || err);
  // Brief delay so stderr flushes before the console window closes.
  setTimeout(() => process.exit(1), 3000);
}

console.log('========================================');
console.log('  Anime Tracker');
console.log('  Project: ' + projectDir);
console.log('========================================\n');

if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
  fail(
    'package.json not found here. Place ATracker.exe inside the project folder.',
  );
  return;
}

if (!fs.existsSync(path.join(projectDir, 'node_modules'))) {
  console.log('[setup] node_modules missing — running npm install (first run only)...\n');
  const install = spawnSync(npmCmd(), ['install', '--no-audit', '--no-fund'], {
    cwd: projectDir,
    stdio: 'inherit',
    shell: true,
  });
  if (install.status !== 0) {
    fail('npm install failed. Make sure Node.js is installed (https://nodejs.org/).', install.error);
    return;
  }
  console.log('');
}

// Build if either output is missing. We don't try to detect source changes —
// if the user edits code they should re-run `npm run build` themselves; the
// .exe path is "launch the last known good build."
const distIndex = path.join(projectDir, 'dist', 'index.html');
const serverBundle = path.join(projectDir, 'dist-server', 'index.cjs');
if (!fs.existsSync(distIndex) || !fs.existsSync(serverBundle)) {
  console.log('[build] dist/ or dist-server/ missing — building (first run only)...\n');
  const built = spawnSync(npmCmd(), ['run', 'build'], {
    cwd: projectDir,
    stdio: 'inherit',
    shell: true,
  });
  if (built.status !== 0) {
    fail('Build failed. Run `npm run build` manually to see the error.', built.error);
    return;
  }
  console.log('');
}

// Open the browser as soon as the server reports it's listening. The server
// bundle calls console.log("[api] listening on ...") inside serve()'s ready
// callback — we hook process.stdout.write to detect that, since we're in
// the same process.
const realWrite = process.stdout.write.bind(process.stdout);
let opened = false;
process.stdout.write = function (chunk, ...rest) {
  const text = typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? '';
  if (!opened && text.includes('[api] listening')) {
    opened = true;
    // Restore the original write before opening the browser to avoid
    // accidentally re-triggering on any later log lines that happen to
    // contain the same substring.
    process.stdout.write = realWrite;
    openBrowser(URL);
  }
  return realWrite(chunk, ...rest);
};

// Fallback: open the browser after 5s even if the marker never showed up.
setTimeout(() => {
  if (!opened) {
    opened = true;
    process.stdout.write = realWrite;
    openBrowser(URL);
  }
}, 5000);

// Set PORT for the server before requiring it. The bundle reads
// process.env.PORT at module-eval time (it's used to bind the listener).
process.env.PORT = String(PORT);

console.log('[run] Starting server on ' + URL + ' ...\n');

// Require the bundled server — synchronous, runs in this process. The bundle
// pulls in Hono / JSZip from itself (esbuild inlined them) and resolves
// better-sqlite3's native binding from ./node_modules at runtime.
try {
  require(serverBundle);
} catch (err) {
  fail('Failed to start the server.', err);
  return;
}

// ---------- shutdown handling ----------
// No child process — the server runs in this process. better-sqlite3 holds
// the DB file lock until we exit, so just make sure the process actually
// goes down on Ctrl+C / window close.

let shuttingDown = false;
function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[run] Shutting down (${reason})...`);
  process.exit(code);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => shutdown(sig, 0));
}
process.on('uncaughtException', (err) => {
  console.error('[run] uncaughtException:', err);
  shutdown('uncaughtException', 1);
});
