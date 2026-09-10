#!/usr/bin/env node
// Generate local launchd paths from this checkout, so moving computers does
// not retain another machine's user name, Node location or repository path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '../..');
if (process.platform !== 'darwin') throw new Error('Run ib:run from your process supervisor on this host; automatic launchd installation requires macOS');
const destination = path.join(os.homedir(), 'Library/LaunchAgents');
const backup = path.join(root, 'runtime', `launchd-backup-${Date.now()}`);
fs.mkdirSync(destination, { recursive: true }); fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
for (const [name, script, interval] of [
  ['com.polytheta.ib-execution', 'scripts/broker/worker.mjs', 30],
  ['com.polytheta.weekly-basket', 'scripts/run_weekly_basket.mjs', 60],
]) {
  const file = path.join(destination, `${name}.plist`);
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backup, `${name}.plist`));
  const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${name}</string><key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>${esc(path.join(root, script))}</string></array>
<key>WorkingDirectory</key><string>${esc(root)}</string><key>StartInterval</key><integer>${interval}</integer><key>RunAtLoad</key><false/>
<key>StandardOutPath</key><string>${esc(path.join(root, 'scripts/launchd', `${name}.out.log`))}</string><key>StandardErrorPath</key><string>${esc(path.join(root, 'scripts/launchd', `${name}.err.log`))}</string>
</dict></plist>`;
  const domain = `gui/${process.getuid()}`;
  const remove = spawnSync('launchctl', ['bootout', `${domain}/${name}`], { encoding: 'utf8' });
  if (remove.status !== 0 && !/No such process|Could not find service|No such file/i.test(remove.stderr)) throw new Error(`Unable to unload ${name}: ${remove.stderr}`);
  fs.writeFileSync(file, plist);
  const result = spawnSync('launchctl', ['bootstrap', domain, file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Unable to load ${name}: ${result.stderr}`);
  console.log(`${name}: installed with ${interval}s interval; execution activation is unchanged`);
}
