// Load .env (KEY=VALUE lines) from the repo root without overriding the real environment.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.env.ENV_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
try {
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env: rely on the environment */ }
