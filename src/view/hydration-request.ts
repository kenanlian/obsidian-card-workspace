export interface HydrateViewportRequest {
  readonly generation: number;
  readonly hydrationRevision: number;
  readonly start: number;
  readonly end: number;
  readonly paths: readonly string[];
}
