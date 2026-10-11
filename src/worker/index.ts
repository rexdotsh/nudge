export { NudgeDO } from './nudge-do';

export default {
  fetch: () => Response.json({ error: 'not_found' }, { status: 404 }),
} satisfies ExportedHandler<Env>;
