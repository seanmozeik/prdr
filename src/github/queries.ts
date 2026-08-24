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

export const reviewIndexQuery = `
query PrdrReviewIndex(
  $owner: String!
  $name: String!
  $number: Int!
  $includeChecks: Boolean!
  $includeIssueComments: Boolean!
  $includeReviews: Boolean!
  $includeThreads: Boolean!
  $checkCursor: String
  $issueCursor: String
  $reviewCursor: String
  $threadCursor: String
) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      author { login __typename }
      baseRefName
      headRefName
      headRefOid
      isDraft
      mergeStateStatus
      number
      reviewDecision
      state
      title
      updatedAt
      url
      statusCheckRollup @include(if: $includeChecks) {
        contexts(first: 100, after: $checkCursor) {
          pageInfo { endCursor hasNextPage }
          nodes {
            __typename
            ... on CheckRun {
              checkSuite { workflowRun { event workflow { name } } }
              completedAt
              conclusion
              detailsUrl
              name
              startedAt
              status
            }
            ... on StatusContext {
              context
              createdAt
              state
              targetUrl
            }
          }
        }
      }
      comments(first: 100, after: $issueCursor) @include(if: $includeIssueComments) {
        pageInfo { endCursor hasNextPage }
        nodes {
          author { login __typename }
          body
          createdAt
          databaseId
          id
          updatedAt
          url
        }
      }
      reviews(first: 100, after: $reviewCursor) @include(if: $includeReviews) {
        pageInfo { endCursor hasNextPage }
        nodes {
          author { login __typename }
          body
          commit { oid }
          fullDatabaseId
          id
          state
          submittedAt
          url
          comments(first: 100) {
            totalCount
            nodes {
              author { login __typename }
              body
              createdAt
              databaseId
              id
              line
              originalLine
              path
              replyTo { databaseId id }
              updatedAt
              url
            }
          }
        }
      }
      reviewThreads(first: 100, after: $threadCursor) @include(if: $includeThreads) {
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
            nodes { id replyTo { id } }
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
