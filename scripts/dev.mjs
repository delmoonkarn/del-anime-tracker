// Dev runner — replaces `concurrently` which was silently swallowing
// `tsx watch`'s subprocess on Windows (the nested npm → concurrently → tsx
// → spawned Node chain dropped stdio). This script spawns the two dev
// processes ourselves with inherited stdio and a clean SIGINT teardown.
//
// Layout:
//   - Vite dev server on :5173 (frontend)
//   - Hono API on :3001 (server/index.ts, restarted on change via node --watch)
//   - Vite proxies /api/* → :3001 (see vite.config.ts)

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const isWin = process.platform === 'win32';
// Use bare command names — npm puts node_modules/.bin on PATH for scripts,
// and shell:true lets the OS shell resolve to the right wrapper (.cmd on
// Windows, no extension on Unix). Avoids quoting headaches when the
// project path contains spaces.

function start(name, cmd, args, color) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Windows requires shell:true to invoke .cmd wrappers (tsx.cmd, vite.cmd).
    // On Unix the binaries are direct, but shell:true is harmless there too.
    shell: isWin,
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const stream = (input, output) => {
    let buf = '';
    input.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) output.write(`${prefix}${line}\n`);
    });
  };
  stream(child.stdout, process.stdout);
  stream(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
}

const children = [];

// 36 = cyan, 35 = magenta
children.push(start('vite', 'vite', [], '36'));
children.push(start('api', 'tsx', ['watch', 'server/index.ts'], '35'));

let exiting = false;
function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const c of children) {
    if (!c.killed && c.pid) {
      if (isWin) {
        // Windows: walk the whole tree so the spawned Node under tsx
        // doesn't leak and hold port 3001 hostage on next launch.
        try {
          spawnSync('taskkill', ['/F', '/T', '/PID', String(c.pid)], {
            stdio: 'ignore',
            shell: true,
          });
        } catch {}
      } else {
        try {
          c.kill('SIGTERM');
        } catch {}
      }
    }
  }
  setTimeout(() => process.exit(code), 200);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => shutdown(0));
}
process.on('exit', () => shutdown(0));
