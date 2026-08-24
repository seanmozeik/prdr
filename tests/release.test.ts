import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

import pkg from '../package.json' with { type: 'json' };
import { createDeterministicTarGzip, type ArchiveEntry } from '../scripts/archive';
import { updateFormula } from '../scripts/formula';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporaryDirectories: string[] = [];
const PackedManifest = Schema.Struct({
  dependencies: Schema.optionalKey(Schema.Unknown),
  name: Schema.String,
  version: Schema.String,
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

const entries = (): readonly ArchiveEntry[] => [
  {
    data: new TextEncoder().encode('#!/usr/bin/env bun\nconsole.log("prdr");\n'),
    mode: 0o755,
    path: 'prdr-0.1.0/dist/prdr.js',
  },
  {
    data: new TextEncoder().encode('{"name":"@example/prdr"}\n'),
    mode: 0o644,
    path: 'prdr-0.1.0/package.json',
  },
  {
    data: new TextEncoder().encode('# prdr skill\n'),
    mode: 0o644,
    path: 'prdr-0.1.0/skills/prdr/SKILL.md',
  },
];

describe('release archive', () => {
  it('produces identical gzip bytes from identical ordered content', () => {
    const first = createDeterministicTarGzip(entries());
    const second = createDeterministicTarGzip(entries().toReversed());

    expect(first).toEqual(second);
    expect(sha256(first)).toBe(sha256(second));
    expect(first[9]).toBe(255);
  });

  it('contains only declared files and preserves the CLI executable mode', async () => {
    const archive = new Bun.Archive(createDeterministicTarGzip(entries()));
    const files = await archive.files();
    expect(Array.from(files.keys()).toSorted()).toEqual([
      'prdr-0.1.0/dist/prdr.js',
      'prdr-0.1.0/package.json',
      'prdr-0.1.0/skills/prdr/SKILL.md',
    ]);

    const directory = mkdtempSync(path.join(tmpdir(), 'prdr-release-'));
    temporaryDirectories.push(directory);
    await archive.extract(directory);
    const mode = statSync(path.join(directory, 'prdr-0.1.0', 'dist', 'prdr.js')).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it('rejects duplicate and unsafe archive paths', () => {
    const [first] = entries();
    if (first === undefined) {
      throw new Error('The release fixture has no entries.');
    }
    const duplicate = [first, first];
    expect(() => createDeterministicTarGzip(duplicate)).toThrow('unique');
    expect(() =>
      createDeterministicTarGzip([{ data: new Uint8Array(), mode: 0o644, path: '../outside' }]),
    ).toThrow('Unsafe archive path');
    expect(() =>
      createDeterministicTarGzip([{ data: new Uint8Array(), mode: 0o644, path: 'a//outside' }]),
    ).toThrow('Unsafe archive path');
    expect(() =>
      createDeterministicTarGzip([{ data: new Uint8Array(), mode: 0o644, path: 'C:/outside' }]),
    ).toThrow('Unsafe archive path');
    expect(() =>
      createDeterministicTarGzip([{ data: new Uint8Array(), mode: 0o644, path: 'bad\0name' }]),
    ).toThrow('Unsafe archive path');
  });

  it('updates exactly one formula version and checksum field', () => {
    const checksum = 'a'.repeat(64);
    const source = `class Prdr < Formula\n  version "0.1.0"\n  sha256 "${'b'.repeat(64)}"\nend\n`;

    const updated = updateFormula(source, '0.2.0', checksum);

    expect(updated).toContain('version "0.2.0"');
    expect(updated).toContain(`sha256 "${checksum}"`);
    expect(() =>
      updateFormula(source.replace(/^[ \t]*sha256.*$/mu, ''), '0.2.0', checksum),
    ).toThrow('exactly one sha256');
    expect(() => updateFormula(`${source}${source}`, '0.2.0', checksum)).toThrow(
      'exactly one version',
    );
    expect(() => updateFormula(source, '#{system("bad")}', checksum)).toThrow('semantic version');
    expect(() => updateFormula(source, '0.2.0', 'A'.repeat(64))).toThrow('lowercase hexadecimal');
  });

  it('packs and runs the CLI without runtime dependencies or source files', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'prdr-package-'));
    temporaryDirectories.push(directory);
    const packed = Bun.spawnSync(['bun', 'pm', 'pack', '--destination', directory], {
      cwd: root,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    if (packed.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(packed.stderr));
    }
    const tarball = path.join(directory, `seanmozeik-prdr-${pkg.version}.tgz`);
    const archive = new Bun.Archive(await Bun.file(tarball).bytes());
    const files = await archive.files();
    const packedPaths = Array.from(files.keys()).toSorted();
    const chunkPaths = packedPaths.filter((file) => file.startsWith('package/dist/chunks/'));
    expect(packedPaths.filter((file) => !file.startsWith('package/dist/chunks/'))).toEqual([
      'package/LICENSE',
      'package/README.md',
      'package/dist/prdr.js',
      'package/package.json',
      'package/skills/prdr/SKILL.md',
    ]);
    expect(chunkPaths.length).toBeGreaterThan(0);
    expect(
      chunkPaths.every((file) =>
        /^package\/dist\/chunks\/[A-Za-z0-9_-]+-[A-Za-z0-9]+\.js$/u.test(file),
      ),
    ).toBe(true);
    const launcherFile = files.get('package/dist/prdr.js');
    if (launcherFile === undefined) {
      throw new Error('The packed package has no CLI launcher.');
    }
    expect(launcherFile.size).toBeLessThan(16 * 1024);
    const manifestFile = files.get('package/package.json');
    if (manifestFile === undefined) {
      throw new Error('The packed package has no package.json file.');
    }
    const manifest = Schema.decodeSync(Schema.fromJsonString(PackedManifest))(
      await manifestFile.text(),
    );
    expect(manifest).toMatchObject({ name: '@seanmozeik/prdr', version: pkg.version });
    expect(manifest.dependencies).toBeUndefined();

    const consumer = path.join(directory, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      path.join(consumer, 'package.json'),
      `${JSON.stringify({
        dependencies: { '@seanmozeik/prdr': tarball },
        name: 'prdr-package-consumer',
        private: true,
      })}\n`,
    );
    const installed = Bun.spawnSync(['bun', 'install'], {
      cwd: consumer,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    if (installed.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(installed.stderr));
    }
    const installedPackage = path.join(consumer, 'node_modules', '@seanmozeik', 'prdr');
    expect(existsSync(path.join(installedPackage, 'src'))).toBe(false);
    expect(existsSync(path.join(installedPackage, 'node_modules'))).toBe(false);

    const executable = path.join(consumer, 'node_modules', '.bin', 'prdr');
    const version = Bun.spawnSync([executable, '--version'], { cwd: consumer, stdout: 'pipe' });
    const help = Bun.spawnSync([executable, '--help'], { cwd: consumer, stdout: 'pipe' });
    const skill = Bun.spawnSync([executable, 'skill'], { cwd: consumer, stdout: 'pipe' });
    const commandHelp = Bun.spawnSync([executable, 'list', '--help'], {
      cwd: consumer,
      stdout: 'pipe',
    });
    expect(version.exitCode).toBe(0);
    expect(new TextDecoder().decode(version.stdout)).toBe(`prdr v${pkg.version}\n`);
    expect(help.exitCode).toBe(0);
    expect(new TextDecoder().decode(help.stdout)).toContain('USAGE');
    expect(skill.exitCode).toBe(0);
    expect(new TextDecoder().decode(skill.stdout)).toContain('name: prdr');
    expect(commandHelp.exitCode).toBe(0);
    expect(new TextDecoder().decode(commandHelp.stdout)).toContain('prdr list');
  });
});
