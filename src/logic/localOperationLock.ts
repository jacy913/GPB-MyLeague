export type LocalOperation =
  | 'idle'
  | 'season_reset'
  | 'player_generation'
  | 'backup_import'
  | 'universe_termination';

export class LocalOperationLock {
  private activeOperation: LocalOperation = 'idle';

  public acquire(operation: Exclude<LocalOperation, 'idle'>): boolean {
    if (this.activeOperation !== 'idle') {
      return false;
    }

    this.activeOperation = operation;
    return true;
  }

  public release(operation: Exclude<LocalOperation, 'idle'>): void {
    if (this.activeOperation === operation) {
      this.activeOperation = 'idle';
    }
  }

  public get current(): LocalOperation {
    return this.activeOperation;
  }
}
