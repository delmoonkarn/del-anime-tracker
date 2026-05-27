// Bundles server/index.ts -> dist-server/index.cjs as a single CommonJS file.
// Lets the .exe launcher boot the server with `node dist-server/index.cjs`
// instead of going through npm + tsx, which saves ~2-3s on cold start.
//
// better-sqlite3 is marked external — it ships a native .node binding that
// can't be inlined. At runtime Node resolves it from node_modules/ next to
// the bundle (cwd is the project root, the launcher chdirs there).

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

await build({
  entryPoints: [path.join(root, 'server/index.ts')],
  outfile: path.join(root, 'dist-server/index.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['better-sqlite3'],
  logLevel: 'info',
});
