import fs from 'node:fs';
import path from 'node:path';
export function readJournal(file) {
  if (!fs.existsSync(file)) return { intents: {}, fills: {}, signals: {} };
  // Never replace a damaged financial journal with an empty one.
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function saveJournal(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
