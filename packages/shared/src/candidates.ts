/** Copy for the single aggregated "new competitors detected" notification. */
export function buildDetectionTitle(count: number): string {
  return count > 1
    ? `${count} new competitors detected`
    : "1 new competitor detected";
}

export function buildDetectionBody(titles: string[]): string {
  const head = titles.slice(0, 3).join(", ");
  const extra = titles.length - 3;
  return extra > 0 ? `${head} +${extra} more` : head;
}
