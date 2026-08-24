const TAR_BLOCK_SIZE = 512;
const TAR_END_BLOCKS = 2;
const GZIP_OS_BYTE_OFFSET = 9;
const GZIP_UNKNOWN_OS = 255;
const windowsDrivePathPattern = /^[A-Za-z]:\//u;

export interface ArchiveEntry {
  readonly data: Uint8Array;
  readonly mode: number;
  readonly path: string;
}

interface TarPath {
  readonly name: string;
  readonly prefix: string;
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const hasUnsafePathCharacter = (value: string): boolean => {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point !== undefined && (point < 32 || point === 127)) {
      return true;
    }
  }
  return false;
};

const normalizedPath = (value: string): string => {
  const path = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  const segments = path.split('/');
  if (
    path === '' ||
    path.startsWith('/') ||
    hasUnsafePathCharacter(path) ||
    windowsDrivePathPattern.test(path) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`Unsafe archive path: ${value}`);
  }
  return path;
};

const compareText = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  return left === right ? 0 : 1;
};

const splitTarPath = (path: string): TarPath => {
  if (encode(path).length <= 100) {
    return { name: path, prefix: '' };
  }
  const segments = path.split('/');
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const prefix = segments.slice(0, index).join('/');
    const name = segments.slice(index).join('/');
    if (encode(prefix).length <= 155 && encode(name).length <= 100) {
      return { name, prefix };
    }
  }
  throw new TypeError(`Archive path is too long for ustar: ${path}`);
};

const writeBytes = (
  target: Uint8Array,
  offset: number,
  length: number,
  value: Uint8Array,
): void => {
  if (value.length > length) {
    throw new RangeError(`Tar field needs ${value.length} bytes but has ${length}.`);
  }
  target.set(value, offset);
};

const writeString = (target: Uint8Array, offset: number, length: number, value: string): void => {
  writeBytes(target, offset, length, encode(value));
};

const octal = (value: number, length: number): Uint8Array =>
  encode(`${value.toString(8).padStart(length - 1, '0')}\0`);

const writeOctal = (target: Uint8Array, offset: number, length: number, value: number): void => {
  writeBytes(target, offset, length, octal(value, length));
};

const createHeader = (path: string, mode: number, size: number, type: '0' | '5'): Uint8Array => {
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  const tarPath = splitTarPath(path);
  writeString(header, 0, 100, tarPath.name);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, type);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'root');
  writeString(header, 297, 32, 'root');
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, tarPath.prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
};

const directoryPaths = (files: readonly ArchiveEntry[]): readonly string[] => {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(`${segments.slice(0, index).join('/')}/`);
    }
  }
  return Array.from(directories).toSorted(compareText);
};

const paddedLength = (length: number): number =>
  Math.ceil(length / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;

const concatenate = (parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

export const createDeterministicTarGzip = (entries: readonly ArchiveEntry[]): Uint8Array => {
  const files = entries
    .map((entry) => ({ ...entry, path: normalizedPath(entry.path) }))
    .toSorted((left, right) => compareText(left.path, right.path));
  if (new Set(files.map(({ path }) => path)).size !== files.length) {
    throw new TypeError('Archive paths must be unique.');
  }
  const parts: Uint8Array[] = [];
  for (const directory of directoryPaths(files)) {
    parts.push(createHeader(directory, 0o755, 0, '5'));
  }
  for (const file of files) {
    parts.push(createHeader(file.path, file.mode, file.data.length, '0'));
    const padded = new Uint8Array(paddedLength(file.data.length));
    padded.set(file.data);
    parts.push(padded);
  }
  parts.push(new Uint8Array(TAR_BLOCK_SIZE * TAR_END_BLOCKS));
  const archive = Bun.gzipSync(concatenate(parts), { level: 9 });
  archive[GZIP_OS_BYTE_OFFSET] = GZIP_UNKNOWN_OS;
  return archive;
};
