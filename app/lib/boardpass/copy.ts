/**
 * BoardPass — every user-facing string, in one place.
 *
 * English only for now. Keeping the words out of the components means a Turkish
 * dictionary later is a second object of the same shape and a one-line lookup,
 * not an edit to every file. Server messages that the client shows verbatim live
 * here too, so the two cannot drift.
 */

export const copy = {
  brand: "BoardPass",

  // ── Login ──────────────────────────────────────────────────────────────────
  loginTitle: "Welcome back!",
  loginSubtitle: "Sign in with your HallPass username and Board PIN.",
  usernameLabel: "Username",
  pinLabel: "Six-digit PIN",
  join: "Join HallPass",
  joining: "Joining…",
  /** The ONE failure message: unknown user, wrong PIN, locked, not enabled. */
  loginFailed: "That username or PIN didn't work. Try again.",
  loginThrottled: "Too many tries from this board. Wait a few minutes and try again.",
  alreadyPlaying: "You're already on this board.",
  boardFull: "This board already has 8 players.",
  unavailable: "BoardPass isn't available right now.",
  googleSession:
    "You're signed in with Google here. Sign out to use Board Mode.",

  // ── Board mode ─────────────────────────────────────────────────────────────
  boardMode: "Board Mode",
  addPlayer: "Add Player",
  removePlayer: "Remove player",
  endSession: "End Session",
  endConfirmTitle: "End this board session?",
  endConfirmBody: "All players will be signed out of Board Mode.",
  cancel: "Cancel",
  whoIsPlaying: (game: string) => `Who's playing ${game}?`,
  playingAs: (name: string) => `Playing as ${name}`,
  stillPlayingTitle: "Still playing?",
  stillPlayingBody: "This board session will end soon.",
  keepPlaying: "Keep Playing",
  sessionExpired: "This board session ended. Sign in again to keep playing.",
  externalNote: "This game is hosted elsewhere, so scores won't be saved to anyone.",
  nobodyYet: "Add a player to get started.",
  reconnecting: "Reconnecting…",

  // ── Floating login window ──────────────────────────────────────────────────
  dragHandle: "Drag to move",
  minimize: "Minimize",
  restore: "Open sign-in",
  close: "Close",
  resetPosition: "Reset position",
  backspace: "Delete last digit",
  clearPin: "Clear",
  pinProgress: (n: number) => `${n} of 6 digits entered`,
  moveWindowHint: "Use the arrow keys to move this window.",

  // ── Settings ───────────────────────────────────────────────────────────────
  settingsTitle: "BoardPass",
  settingsBlurb:
    "Sign in to HallPass on shared school boards with your username and a six-digit PIN. No Google sign-in needed.",
  createPin: "Create Board PIN",
  changePin: "Change PIN",
  disable: "Disable BoardPass",
  enabled: "BoardPass enabled",
  yourUsername: "Your username",
  pickUsernameFirst: "Pick a username first. It's what you'll type on the board.",
  chooseUsername: "Choose a username",
  newPin: "Choose a PIN",
  confirmPin: "Confirm your PIN",
  pinMismatch: "The two PINs didn't match. Try again.",
  pinWeak: "That PIN is too easy to guess. Try a less obvious one.",
  pinInvalid: "A PIN is exactly six digits.",
  pinHint:
    "Don't reuse your phone PIN or a birthday. You can change it any time.",
  confirmItsYou: "Confirm it's you",
  confirmItsYouBody:
    "For safety, sign in with Google again before changing BoardPass.",
  readyTitle: "Your BoardPass is ready!",
  readyBody: "At school, open HallPass, choose BoardPass, and enter your username and PIN.",
  disableConfirm: "Disable BoardPass? You'll need a new PIN to use it again.",
  signedInOnBoards: (n: number) =>
    n === 1 ? "Signed in on 1 board" : `Signed in on ${n} boards`,
  signOutBoards: "Sign out of all boards",
  signedOutBoards: "Signed out of every board.",
  saveFailed: "Couldn't save that. Try again.",
} as const;
