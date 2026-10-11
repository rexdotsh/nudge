import type { NudgeDO } from './nudge-do';

declare global {
  interface Env {
    NUDGE: DurableObjectNamespace<NudgeDO>;
    AUTH_SECRET: string;
    SETUP_CODE: string;
    VAPID_JWK: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    HEALTHCHECK_URL?: string;
  }
}
