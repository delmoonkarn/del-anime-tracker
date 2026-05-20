// GET /api/db-zip → streams the current SQLite database back as a .zip,
// named `DD_MM_YYYY_data.zip` (current date, day-first). WAL is flushed
// into the main .db file before the read so the zip is self-contained —
// no .db-wal/.db-shm sidecars needed to restore.

import JSZip from 'jszip';
import { readDbSnapshot } from '@/lib/db';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export async function GET() {
  try {
    const { buffer } = readDbSnapshot();
    const zip = new JSZip();
    // Nested under data/ so the extracted layout matches the project's
    // expected file path — user can drop the whole data/ folder straight
    // into the repo root to restore (overwriting the existing data/).
    zip.file('data/anime-tracker.db', buffer);
    // ArrayBuffer is the type the Web Response constructor accepts cleanly
    // across the various TS lib versions Next.js may be compiled against.
    const zipped = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const now = new Date();
    const filename = `${pad(now.getDate())}_${pad(now.getMonth() + 1)}_${now.getFullYear()}_data.zip`;
    return new Response(zipped, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api/db-zip] failed:', err);
    return new Response('Failed to build database zip', { status: 500 });
  }
}
