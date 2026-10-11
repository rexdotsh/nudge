import type { NudgeDO } from './nudge-do';

declare global {
  interface Env {
    ASSETS: Fetcher;
    NUDGE: DurableObjectNamespace<NudgeDO>;
  }
}
