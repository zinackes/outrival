export async function sendSlackMessage(webhookUrl: string, text: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // ne jamais faire échouer l'action principale à cause d'une notif
  }
}
