export async function sendTelegram(
  config: Pick<Env, 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID'>,
  text: string,
): Promise<void> {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = config;
  if (!token || !chat) {
    console.warn(`alert (telegram not configured): ${text}`);
    return;
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error(`telegram responded ${response.status}`);
}
