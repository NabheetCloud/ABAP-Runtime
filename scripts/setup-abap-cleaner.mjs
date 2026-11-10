#!/usr/bin/env node
// Fetches SAP's ABAP cleaner (https://github.com/SAP/abap-cleaner, Apache-2.0) into vendor/abap-cleaner: the
// stand-alone build for this platform, which brings its own Java runtime. RAP Studio calls its command line
// (rap clean, the studio's "Clean up") to clean ABAP code the way ADT's ABAP cleaner does.
//   node scripts/setup-abap-cleaner.mjs [--version 1.29.2]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'vendor', 'abap-cleaner');
const i = process.argv.indexOf('--version');
const version = i > 0 ? process.argv[i + 1] : '1.29.2';
const asset = {
  'darwin-arm64': 'com.sap.adt.abapcleaner.app-macosx.cocoa.aarch64.tar.gz',
  'darwin-x64': 'com.sap.adt.abapcleaner.app-macosx.cocoa.x86_64.tar.gz',
  'linux-x64': 'com.sap.adt.abapcleaner.app-linux.gtk.x86_64.tar.gz',
  'win32-x64': 'com.sap.adt.abapcleaner.app-win32.win32.x86_64.zip',
}[`${process.platform}-${process.arch}`];
if (!asset) { console.error(`[abap-cleaner] no stand-alone build for ${process.platform}-${process.arch}`); process.exit(1); }

const url = `https://github.com/SAP/abap-cleaner/releases/download/v${version}/${asset}`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const file = path.join(os.tmpdir(), asset);
console.log(`[abap-cleaner] downloading ${url}`);
execFileSync('curl', ['-fsSL', '-o', file, url], { stdio: 'inherit' });
if (asset.endsWith('.zip')) execFileSync('tar', ['-xf', file, '-C', DIR], { stdio: 'inherit' });
else execFileSync('tar', ['-xzf', file, '-C', DIR], { stdio: 'inherit' });
fs.rmSync(file, { force: true });
fs.writeFileSync(path.join(DIR, 'VERSION'), version);
console.log(`[abap-cleaner] ${version} ready in ${path.relative(ROOT, DIR)}`);
