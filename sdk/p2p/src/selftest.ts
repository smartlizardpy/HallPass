/**
 * `HallPassP2P.selfTest()` — what a "Test connection" button needs: can this
 * network reach a STUN server (direct connections possible), is a TURN relay
 * reachable, and a best-effort NAT type. Notes are written for players.
 */

import { DEMO_GAME_ID } from "./codes";
import { defaultApi } from "./client";
import { env } from "./env";
import { fetchConfig } from "./signaling";
import type { NatType, SelfTestOptions, SelfTestResult } from "./types";

interface Cand {
  type: string;
  address: string;
  port: number;
  relatedPort: number;
}

const list = (u: string | string[] | undefined): string[] => (Array.isArray(u) ? u : u ? [u] : []);

function parse(c: RTCIceCandidate): Cand | null {
  const s = c.candidate || "";
  const type = c.type ?? /\btyp (\w+)/.exec(s)?.[1];
  if (!type) return null;
  const parts = s.split(" ");
  return {
    type,
    address: c.address ?? parts[4] ?? "",
    port: c.port ?? Number(parts[5]),
    relatedPort: c.relatedPort ?? Number(/\brport (\d+)/.exec(s)?.[1] ?? 0),
  };
}

function gather(config: RTCConfiguration, timeoutMs: number): Promise<Cand[]> {
  const PC = env.RTCPeerConnection!;
  const out: Cand[] = [];
  return new Promise((resolve) => {
    let pc: RTCPeerConnection;
    try {
      pc = new PC(config);
    } catch {
      resolve(out);
      return;
    }
    const done = () => {
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        // closed
      }
      resolve(out);
    };
    const timer = setTimeout(done, timeoutMs);
    pc.onicecandidate = (e) => {
      if (!e.candidate) return done();
      const c = parse(e.candidate);
      if (c) out.push(c);
    };
    pc.createDataChannel("probe");
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .catch(done);
  });
}

export async function selfTest(opts: SelfTestOptions = {}): Promise<SelfTestResult> {
  const notes: string[] = [];
  if (!env.RTCPeerConnection) {
    return { stun: false, turn: false, natType: "unknown", notes: ["This browser doesn't support WebRTC, so peer-to-peer play won't work here."] };
  }
  let servers = opts.iceServers;
  if (!servers) {
    const cfg = await fetchConfig((opts.api || defaultApi()).replace(/\/+$/, ""), opts.gameId || DEMO_GAME_ID);
    if (!cfg) notes.push("Couldn't reach HallPass for relay settings, so only direct connections were tested.");
    servers = cfg?.iceServers ?? [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  }
  const stunServers = servers
    .map((s) => ({ urls: list(s.urls).filter((u) => u.startsWith("stun:")) }))
    .filter((s) => s.urls.length);
  const turnServers = servers
    .map((s) => ({ ...s, urls: list(s.urls).filter((u) => /^turns?:/.test(u)) }))
    .filter((s) => s.urls.length && s.username);
  const timeout = opts.timeoutMs ?? 5000;
  const [direct, relayed] = await Promise.all([
    stunServers.length ? gather({ iceServers: stunServers }, timeout) : Promise.resolve([]),
    turnServers.length ? gather({ iceServers: turnServers, iceTransportPolicy: "relay" }, timeout) : Promise.resolve([]),
  ]);

  const srflx = direct.filter((c) => c.type === "srflx");
  const stun = srflx.length > 0;
  const turn = relayed.some((c) => c.type === "relay");

  let natType: NatType = "unknown";
  if (stun) {
    // One local socket mapped to different public ports by different STUN
    // servers means a symmetric NAT (best effort: needs two STUN servers).
    const bySocket = new Map<number, Set<string>>();
    for (const c of srflx) {
      const set = bySocket.get(c.relatedPort) ?? new Set<string>();
      set.add(`${c.address}:${c.port}`);
      bySocket.set(c.relatedPort, set);
    }
    natType = [...bySocket.values()].some((s) => s.size > 1) ? "symmetric" : "cone";
  } else if (direct.length) natType = "udp-blocked";

  if (stun) notes.push("Direct connections to other players are possible from this network.");
  else notes.push("This network blocks direct connections (no reply from a STUN server). You'll need the relay to play online.");
  if (natType === "symmetric") {
    notes.push("Your network changes ports for every connection (symmetric NAT), so direct connections may fail and the relay may be needed.");
  }
  if (turn) notes.push("The relay server is reachable, so you should be able to connect even on a strict network.");
  else if (turnServers.length) notes.push("The relay server couldn't be reached from this network.");
  else notes.push("No relay server is set up, so players on strict networks (many schools) may not be able to connect.");
  return { stun, turn, natType, notes };
}
