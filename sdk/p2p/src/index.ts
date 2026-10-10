/**
 * HallPass P2P co-op SDK — entry point. Builds to one dependency-free ES module
 * (`/sdk/p2p/v1/hallpass-p2p.js`) that games vendor and import relatively:
 *
 *   import { HallPassP2P } from './lib/hallpass-p2p.js';
 *   const client = await HallPassP2P.connect({ gameId: 'last-bell', gameVersion: '1.2.0', name: 'Guest 4821' });
 *   const room = await client.createRoom({ maxPlayers: 4, lockOnStart: true });
 *
 * See sdk/README.md ("P2P co-op") for the full API and the gotchas.
 */

import { connect, VERSION } from "./client";
import { P2PError } from "./errors";
import { selfTest } from "./selftest";

export { P2PError };
export type * from "./types";

export const HallPassP2P = {
  /** Semver of this SDK build. */
  version: VERSION,
  connect,
  selfTest,
  P2PError,
};

export default HallPassP2P;
