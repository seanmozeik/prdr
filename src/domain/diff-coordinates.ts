import { Effect } from 'effect';

import type { RawPullRequestFile } from './pull-request-raw';
import { DiffCoordinateError } from './pull-request-read-errors';
import type { ReviewFinding, ReviewSide } from './pull-request-review';

interface HunkPosition {
  left: number;
  right: number;
}

const hunkHeader = /^@@ -(?<left>[0-9]+)(?:,[0-9]+)? \+(?<right>[0-9]+)(?:,[0-9]+)? @@/u;

const diffLines = (patch: string): ReadonlySet<string> => {
  const available = new Set<string>();
  let position: HunkPosition | null = null;
  for (const text of patch.split('\n')) {
    const header = hunkHeader.exec(text)?.groups;
    if (header !== undefined) {
      position = { left: Number(header['left']), right: Number(header['right']) };
    } else if (position !== null && text.startsWith('+')) {
      available.add(`RIGHT:${position.right}`);
      position.right += 1;
    } else if (position !== null && text.startsWith('-')) {
      available.add(`LEFT:${position.left}`);
      position.left += 1;
    } else if (position !== null && !text.startsWith(String.raw`\ No newline`)) {
      available.add(`LEFT:${position.left}`);
      available.add(`RIGHT:${position.right}`);
      position.left += 1;
      position.right += 1;
    }
  }
  return available;
};

const coordinate = (side: ReviewSide, line: number): string => `${side}:${line}`;

export const validateReviewFindings = Effect.fn('DiffCoordinates.validateFindings')(
  function* validateReviewFindings(
    files: readonly RawPullRequestFile[],
    findings: readonly ReviewFinding[],
  ) {
    const filesByPath = new Map<string, RawPullRequestFile[]>();
    for (const file of files) {
      const current = filesByPath.get(file.filename) ?? [];
      current.push(file);
      filesByPath.set(file.filename, current);
    }
    for (const finding of findings) {
      const matchingFiles = filesByPath.get(finding.path);
      if (matchingFiles === undefined) {
        return yield* DiffCoordinateError.make({
          detail: 'This path is not in the current pull request diff.',
          path: finding.path,
        });
      }
      const patches = matchingFiles.flatMap(({ patch }) =>
        patch === undefined || patch === null ? [] : [patch],
      );
      if (patches.length === 0) {
        return yield* DiffCoordinateError.make({
          detail: 'GitHub did not expose a text patch, so prdr cannot validate a line review.',
          path: finding.path,
        });
      }
      const available = new Set(patches.flatMap((patch) => Array.from(diffLines(patch))));
      if (!available.has(coordinate(finding.side, finding.line))) {
        return yield* DiffCoordinateError.make({
          detail: `${finding.side} line ${finding.line} is not in the current diff.`,
          path: finding.path,
        });
      }
      const hasStartLine = finding.startLine !== undefined;
      const hasStartSide = finding.startSide !== undefined;
      if (hasStartLine !== hasStartSide) {
        return yield* DiffCoordinateError.make({
          detail: 'A range must contain both startLine and startSide.',
          path: finding.path,
        });
      }
      if (
        finding.startLine !== undefined &&
        finding.startSide !== undefined &&
        !available.has(coordinate(finding.startSide, finding.startLine))
      ) {
        return yield* DiffCoordinateError.make({
          detail: `${finding.startSide} start line ${finding.startLine} is not in the current diff.`,
          path: finding.path,
        });
      }
      if (
        finding.startLine !== undefined &&
        finding.startSide === finding.side &&
        finding.startLine > finding.line
      ) {
        return yield* DiffCoordinateError.make({
          detail: 'The range start line must not be after the end line on the same side.',
          path: finding.path,
        });
      }
    }
    return yield* Effect.void;
  },
);
