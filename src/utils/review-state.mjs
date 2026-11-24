import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

function sessionFile(event, directory, root) {
  if (!event.session_id || !event.turn_id) return;
  const session = createHash('sha256').update(event.session_id).digest('hex');
  return join(root ?? (process.env.CODEX_HOME || join(homedir(), '.codex')), directory, session);
}
export function saveState(event, directory, value, root) {
  const path = sessionFile(event, directory, root);
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const pending = `${path}.${randomUUID()}`;
  writeFileSync(pending, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  renameSync(pending, path);
}
export function clearState(event, directory, root) {
  const path = sessionFile(event, directory, root);
  if (path) {
    try {
      unlinkSync(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
export function readState(event, directory, root) {
  const path = sessionFile(event, directory, root);
  if (!path) return;
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (state.turn === event.turn_id) return state;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
