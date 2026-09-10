import fs from 'node:fs';
// lock must be held for the entire run, including publication/delivery.
export function acquireLock(file) {
  try { fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid lock file; review before removing');
    try { process.kill(pid, 0); } catch (e) {
      if (e.code !== 'ESRCH') throw e;
      fs.unlinkSync(file);
      return acquireLock(file);
    }
    throw new Error('Another run is active');
  }
  return () => { try { if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); } catch { /* already released */ } };
}
