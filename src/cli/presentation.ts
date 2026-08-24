import type { ReviewListItem } from '../domain/listing';
import type { PullRequestSnapshot } from '../domain/model';
import type { ReviewListPage } from '../domain/pagination';
import { renderMarkdown, sanitizeTerminalLine, tone } from '../lib/tty';

const location = (item: ReviewListItem): string => {
  if (item.path === null) {
    return '';
  }
  const path = sanitizeTerminalLine(item.path);
  return item.line === null ? ` ${path}` : ` ${path}:${item.line}`;
};

export const printSnapshot = (snapshot: PullRequestSnapshot): void => {
  const open = snapshot.threads.filter((thread) => !thread.isResolved).length;
  const resolved = snapshot.threads.length - open;
  console.log(
    tone.title(`#${snapshot.target.number} ${sanitizeTerminalLine(snapshot.pullRequest.title)}`),
  );
  console.log(sanitizeTerminalLine(snapshot.pullRequest.url));
  console.log(
    `${sanitizeTerminalLine(snapshot.pullRequest.headRefName)} @ ${sanitizeTerminalLine(snapshot.pullRequest.headRefOid.slice(0, 12))} -> ${sanitizeTerminalLine(snapshot.pullRequest.baseRefName)}`,
  );
  console.log(`${open} open thread(s), ${resolved} resolved thread(s)`);
  console.log(
    `${snapshot.issueComments.length} issue comment(s), ${snapshot.reviews.length} review(s), ${snapshot.checks.length} check(s)`,
  );
};

export const printList = (page: ReviewListPage): void => {
  console.log(
    `${sanitizeTerminalLine(page.target.nameWithOwner)}#${page.target.number} @ ${sanitizeTerminalLine(page.headRefOid.slice(0, 12))}`,
  );
  if (page.items.length === 0) {
    console.log(
      page.total === 0 ? 'No matching review items.' : 'No review items remain after this cursor.',
    );
    return;
  }
  for (const item of page.items) {
    const title = sanitizeTerminalLine(item.title ?? item.preview);
    console.log(
      `${tone.accent(sanitizeTerminalLine(item.ref))} ${item.state} ${item.provider}/${item.severity} @${sanitizeTerminalLine(item.author)}${location(item)}`,
    );
    console.log(`  ${title}`);
    if (item.threadRef !== null) {
      console.log(`  ${sanitizeTerminalLine(item.threadRef)}, ${item.replyCount} reply/replies`);
    }
  }
  console.log(`Returned ${page.items.length} of ${page.total} matching item(s).`);
  if (page.nextCursor !== null) {
    console.log(`Next cursor: ${sanitizeTerminalLine(page.nextCursor)}`);
  }
};

export const printComment = (value: {
  readonly comment: {
    readonly body: string | null;
    readonly html_url: string;
    readonly ref: string;
  };
  readonly thread: { readonly ref: string } | null;
}): void => {
  console.log(tone.title(sanitizeTerminalLine(value.comment.ref)));
  if (value.thread !== null) {
    console.log(sanitizeTerminalLine(value.thread.ref));
  }
  console.log(sanitizeTerminalLine(value.comment.html_url));
  console.log('');
  console.log(renderMarkdown(value.comment.body ?? '', process.stdout.columns));
};

export const printMutation = (value: unknown): void => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'html_url' in value &&
    typeof value.html_url === 'string'
  ) {
    console.log(sanitizeTerminalLine(value.html_url));
    return;
  }
  console.log(sanitizeTerminalLine(JSON.stringify(value)));
};
