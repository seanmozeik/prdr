#!/usr/bin/env bun
/**
 * 1) Bundle `src/cli/index.ts` to the executable declared in package.json.
 * 2) Pack `artifacts/prdr-{version}.tar.gz` for GitHub and Homebrew.
 * 3) Patch `Formula/prdr.rb` with the archive version and checksum.
 *
 * Fast iteration (JS only, no tarball / formula):
 *   bun run build -- --no-formula
 */
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pkg from '../package.json' with { type: 'json' };
import { createDeterministicTarGzip, type ArchiveEntry } from './archive';
import { updateFormula } from './formula';

const root = fileURLToPath(new URL('..', import.meta.url));
const skipTarballAndFormula = process.argv.includes('--no-formula');
const { version } = pkg;
const distPrefix = './dist/';
const distDir = path.join(root, 'dist');
const entry = './src/cli/index.ts';

const binPath = pkg.bin.prdr;
if (!binPath.startsWith(distPrefix)) {
  throw new TypeError(`package.json bin.prdr must start with "${distPrefix}", got "${binPath}"`);
}
const CLI_BUNDLE_NAME = binPath.slice(distPrefix.length);

rmSync(distDir, { force: true, recursive: true });
mkdirSync(distDir, { recursive: true });

const cli = Bun.spawnSync(
  [
    'bun',
    'build',
    entry,
    '--target=bun',
    '--format=esm',
    '--splitting',
    `--outdir=${distDir}`,
    `--entry-naming=${CLI_BUNDLE_NAME}`,
    '--chunk-naming=chunks/[name]-[hash].[ext]',
    '--minify',
  ],
  { cwd: root, stderr: 'inherit', stdout: 'inherit' },
);
if (cli.exitCode !== 0) {
  process.exit(cli.exitCode);
}

const outPath = path.join(distDir, CLI_BUNDLE_NAME);
chmodSync(outPath, 0o755);

if (skipTarballAndFormula) {
  process.exit(0);
}

const archiveInner = `prdr-${version}`;
mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const tarName = `prdr-${version}.tar.gz`;
const tarPath = path.join(root, 'artifacts', tarName);

const archiveEntries: ArchiveEntry[] = [
  {
    data: await Bun.file(path.join(root, 'package.json')).bytes(),
    mode: 0o644,
    path: `${archiveInner}/package.json`,
  },
];
const distFiles = new Bun.Glob('**/*');
for await (const relativePath of distFiles.scan({ cwd: distDir, onlyFiles: true })) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  archiveEntries.push({
    data: await Bun.file(path.join(distDir, relativePath)).bytes(),
    mode: normalizedPath === CLI_BUNDLE_NAME ? 0o755 : 0o644,
    path: `${archiveInner}/dist/${normalizedPath}`,
  });
}
const skillRoot = path.join(root, 'skills');
const skillFiles = new Bun.Glob('**/*');
for await (const relativePath of skillFiles.scan({ cwd: skillRoot, onlyFiles: true })) {
  archiveEntries.push({
    data: await Bun.file(path.join(skillRoot, relativePath)).bytes(),
    mode: 0o644,
    path: `${archiveInner}/skills/${relativePath.replaceAll('\\', '/')}`,
  });
}
await Bun.write(tarPath, createDeterministicTarGzip(archiveEntries));

const sha256 = new Bun.CryptoHasher('sha256')
  .update(await Bun.file(tarPath).arrayBuffer())
  .digest('hex');

const formulaPath = path.join(root, 'Formula', 'prdr.rb');
const formula = updateFormula(await Bun.file(formulaPath).text(), version, sha256);
await Bun.write(formulaPath, formula);

process.stdout.write(
  `Wrote ${tarPath}\nsha256 ${sha256}\nUpdated Formula/prdr.rb to version ${version}\n`,
);
