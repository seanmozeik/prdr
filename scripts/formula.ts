const versionPattern = /^(?<prefix>[ \t]*version[ \t]+")[^"\r\n]+(?<suffix>"[ \t]*)$/gmu;
const checksumPattern = /^(?<prefix>[ \t]*sha256[ \t]+")[0-9a-fA-F]{64}(?<suffix>"[ \t]*)$/gmu;
const checksumValuePattern = /^[0-9a-f]{64}$/u;
const versionValuePattern =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const replaceExactlyOnce = (
  source: string,
  pattern: RegExp,
  value: string,
  field: string,
): string => {
  const matches = Array.from(source.matchAll(pattern));
  if (matches.length !== 1) {
    throw new TypeError(`Formula must contain exactly one ${field} field.`);
  }
  return source.replace(pattern, `$<prefix>${value}$<suffix>`);
};

export const updateFormula = (source: string, version: string, checksum: string): string => {
  if (!versionValuePattern.test(version)) {
    throw new TypeError('Package version must be a safe semantic version.');
  }
  if (!checksumValuePattern.test(checksum)) {
    throw new TypeError('Release checksum must contain 64 lowercase hexadecimal characters.');
  }
  const versioned = replaceExactlyOnce(source, versionPattern, version, 'version');
  return replaceExactlyOnce(versioned, checksumPattern, checksum, 'sha256');
};
