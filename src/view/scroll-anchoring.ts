const DEFAULT_MAX_ANCHOR_DELTA = 80;

export interface ScrollAnchorInput {
  heightDelta: number;
  changedIndex: number;
  firstVisibleIndex: number;
  nowMs: number;
  userScrollLockUntilMs: number;
  maxAnchorDelta?: number;
}

export function computeScrollAnchorDelta(input: ScrollAnchorInput): number {
  const {
    heightDelta,
    changedIndex,
    firstVisibleIndex,
    nowMs,
    userScrollLockUntilMs,
    maxAnchorDelta = DEFAULT_MAX_ANCHOR_DELTA,
  } = input;

  if (!Number.isFinite(heightDelta) || heightDelta === 0) {
    return 0;
  }

  if (changedIndex >= firstVisibleIndex) {
    return 0;
  }

  if (nowMs <= userScrollLockUntilMs) {
    return 0;
  }

  const magnitude = Math.abs(heightDelta);
  if (magnitude <= maxAnchorDelta) {
    return heightDelta;
  }

  return Math.sign(heightDelta) * maxAnchorDelta;
}
