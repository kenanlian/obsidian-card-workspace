export interface HydrateViewportRequest {
  readonly generation: number;
  readonly hydrationRevision: number;
  readonly start: number;
  readonly end: number;
  readonly visibleStart?: number;
  readonly visibleEnd?: number;
  readonly paths: readonly string[];
}
