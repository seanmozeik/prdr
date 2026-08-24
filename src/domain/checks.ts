export const checkBucketValues = ['cancel', 'fail', 'pass', 'pending', 'skipping'] as const;
export const attentionCheckBucketValues = ['cancel', 'fail', 'pending'] as const;
export type CheckBucket = (typeof checkBucketValues)[number];

export const checkBucket = (state: string): CheckBucket => {
  const normalized = state.toUpperCase();
  if (normalized === 'SUCCESS' || normalized === 'NEUTRAL') {
    return 'pass';
  }
  if (normalized === 'SKIPPED') {
    return 'skipping';
  }
  if (['EXPECTED', 'IN_PROGRESS', 'PENDING', 'QUEUED', 'WAITING'].includes(normalized)) {
    return 'pending';
  }
  return normalized === 'CANCELLED' ? 'cancel' : 'fail';
};
