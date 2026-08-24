export const reviewThreadsQuery = `
query PrdrReviewThreads($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { endCursor hasNextPage }
        nodes {
          id
          isOutdated
          isResolved
          line
          originalLine
          path
          resolvedBy { login }
          subjectType
          viewerCanReply
          viewerCanResolve
          viewerCanUnresolve
          comments(first: 100) {
            totalCount
            nodes {
              databaseId
              id
              replyTo { databaseId id }
            }
          }
        }
      }
    }
  }
}`;

export const resolveThreadMutation = `
mutation PrdrResolveThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`;

export const unresolveThreadMutation = `
mutation PrdrUnresolveThread($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`;
