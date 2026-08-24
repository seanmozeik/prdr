import type { ReviewListItem } from '../domain/listing';
import type { PullRequestSnapshot } from '../domain/model';
import { renderMarkdown, tone } from '../lib/tty';

const location = (item: ReviewListItem): string => {
  if (item.path === null) {
    return '';
  }
  return item.line === null ? ` ${item.path}` : ` ${item.path}:${item.line}`;
};

export const printSnapshot = (snapshot: PullRequestSnapshot): void => {
  const open = snapshot.threads.filter((thread) => !thread.isResolved).length;
  const resolved = snapshot.threads.length - open;
  console.log(tone.title(`#${snapshot.target.number} ${snapshot.pullRequest.title}`));
  console.log(snapshot.pullRequest.url);
  console.log(
    `${snapshot.pullRequest.headRefName} @ ${snapshot.pullRequest.headRefOid.slice(0, 12)} -> ${snapshot.pullRequest.baseRefName}`,
  );
  console.log(`${open} open thread(s), ${resolved} resolved thread(s)`);
  console.log(
    `${snapshot.issueComments.length} issue comment(s), ${snapshot.reviews.length} review(s), ${snapshot.checks.length} check(s)`,
  );
};

export const printList = (items: readonly ReviewListItem[]): void => {
  if (items.length === 0) {
    console.log('No matching review items.');
    return;
  }
  for (const item of items) {
    const title = item.title ?? item.body?.split(/\r?\n/u)[0]?.slice(0, 100) ?? '(empty)';
    console.log(
      `${tone.accent(item.ref)} ${item.state} ${item.provider}/${item.severity} @${item.author}${location(item)}`,
    );
    console.log(`  ${title}`);
    if (item.threadRef !== null) {
      console.log(`  ${item.threadRef}, ${item.replyCount} reply/replies`);
    }
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
  console.log(tone.title(value.comment.ref));
  if (value.thread !== null) {
    console.log(value.thread.ref);
  }
  console.log(value.comment.html_url);
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
    console.log(value.html_url);
    return;
  }
  console.log(JSON.stringify(value));
};
