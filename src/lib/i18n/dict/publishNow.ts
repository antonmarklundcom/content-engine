/** The post page's "Publish now" button (PLAN.md §5.O13). */

export const en = {
  "publishNow.button": "Publish now",
  "publishNow.retry": "Publish again",
  "publishNow.resume": "Check and publish",
  "publishNow.working": "Publishing…",
  "publishNow.confirm":
    "Publish this post to @{handle} on {platform} now? This cannot be undone from here.",
  "publishNow.hint":
    "Posts straight to the account through Meta. Scheduled posts go out on their own.",
  "publishNow.notLinked": "Link this account in Settings → Meta to publish from here.",
  "publishNow.unsupported": "Publishing to {platform} is not built yet; use the post pack.",
  "publishNow.published": "Published.",
  "publishNow.pending": "Meta is still processing the video; it goes out on the next run.",
  "publishNow.failed": "Not published: {error}",
  "publishNow.skipped": "Nothing done: {reason}",
  "publishNow.lastError": "Last attempt: {error}",
  "publishNow.error": "Publishing failed; try again.",
};

export const sv: Record<keyof typeof en, string> = {
  "publishNow.button": "Publicera nu",
  "publishNow.retry": "Publicera igen",
  "publishNow.resume": "Kontrollera och publicera",
  "publishNow.working": "Publicerar…",
  "publishNow.confirm":
    "Publicera inlägget på @{handle} ({platform}) nu? Det går inte att ångra härifrån.",
  "publishNow.hint": "Postar direkt till kontot via Meta. Schemalagda inlägg går ut av sig själva.",
  "publishNow.notLinked": "Koppla kontot under Inställningar → Meta för att publicera härifrån.",
  "publishNow.unsupported": "Publicering till {platform} finns inte än; använd inläggspaketet.",
  "publishNow.published": "Publicerat.",
  "publishNow.pending": "Meta bearbetar fortfarande videon; den går ut vid nästa körning.",
  "publishNow.failed": "Inte publicerat: {error}",
  "publishNow.skipped": "Inget gjordes: {reason}",
  "publishNow.lastError": "Senaste försöket: {error}",
  "publishNow.error": "Publiceringen misslyckades; försök igen.",
};
