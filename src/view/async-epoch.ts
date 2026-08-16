/** A monotonically increasing generation guard used to discard stale async results. */
export interface EpochToken {
  readonly value: number;
}

export class AsyncEpoch {
  private current = 0;

  /** Starts a new operation: increments and returns the new token. */
  bump(): EpochToken {
    this.current += 1;
    return { value: this.current };
  }

  /** The current token, without incrementing. */
  token(): EpochToken {
    return { value: this.current };
  }

  /** Whether the token still belongs to the newest generation. */
  isCurrent(token: EpochToken): boolean {
    return token.value === this.current;
  }

  /** For the cases that must project the generation into UI state. */
  get value(): number {
    return this.current;
  }
}
