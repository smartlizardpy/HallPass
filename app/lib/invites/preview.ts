/**
 * The words on an invite's link preview: the og:title and the line on the card.
 *
 * Pure, and shared by `/i/<code>`'s metadata and its `opengraph-image`, so the
 * title a chat app shows and the sentence printed on the image cannot drift
 * apart. The inviter is already a PUBLIC display name by the time it gets here
 * (`PublicInvite.from`: handle, else `@username`, never the Google name), and a
 * guest's link has none, which reads as "A friend" rather than as a gap.
 */

/** What the preview says for a dead, staged or unknown invite: it names nobody. */
export const GENERIC_PREVIEW_TITLE = "You're invited · HallPass";
export const GENERIC_PREVIEW_DESCRIPTION = "Jump into a game together on HallPass.";

/** The inviter as a sentence subject; a guest's link has no name. */
export function inviterName(from: string | null): string {
  const name = from?.trim();
  return name ? name : "A friend";
}

/** `Ozan invited you to play LAST BELL` — the og:title of a live invite. */
export function invitePreviewTitle(from: string | null, gameTitle: string): string {
  return `${inviterName(from)} invited you to play ${gameTitle}`;
}

/** The small line above the game title on the card. Uppercased in code: Satori has no `text-transform`. */
export function invitePreviewKicker(from: string | null): string {
  return `${inviterName(from).toUpperCase()} INVITED YOU TO PLAY`;
}
