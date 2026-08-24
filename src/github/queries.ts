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
              id
              replyTo { id }
            }
          }
        }
      }
    }
  }
}`;

export const reviewThreadNodeQuery = `
query PrdrReviewThread($threadId: ID!) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
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
          body
          id
          replyTo { id }
          updatedAt
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

export const pullRequestsQuery = `
query PrdrPullRequests(
  $owner: String!
  $name: String!
  $first: Int!
  $cursor: String
  $states: [PullRequestState!]
  $base: String
  $head: String
) {
  repository(owner: $owner, name: $name) {
    pullRequests(
      first: $first
      after: $cursor
      states: $states
      baseRefName: $base
      headRefName: $head
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      totalCount
      pageInfo { endCursor hasNextPage }
      nodes {
        author { login }
        baseRefName
        body
        comments { totalCount }
        commits(last: 1) {
          nodes { commit { statusCheckRollup { state } } }
        }
        createdAt
        headRefName
        headRefOid
        headRepositoryOwner { login }
        isDraft
        mergeStateStatus
        number
        reviewDecision
        reviewThreads { totalCount }
        state
        title
        updatedAt
        url
      }
    }
  }
}`;
