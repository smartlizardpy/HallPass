/**
 * The browser surface the SDK touches, in one swappable object. Unit tests
 * replace `RTCPeerConnection` with an in-memory fake; nothing else in the SDK
 * reaches for these globals directly.
 */

type G = typeof globalThis & {
  RTCPeerConnection?: typeof RTCPeerConnection;
  MediaStream?: typeof MediaStream;
};
const g = globalThis as G;

export const env = {
  RTCPeerConnection: g.RTCPeerConnection as typeof RTCPeerConnection | undefined,
  MediaStream: g.MediaStream as typeof MediaStream | undefined,
  getUserMedia: (c: MediaStreamConstraints): Promise<MediaStream> => navigator.mediaDevices.getUserMedia(c),
  /** Epoch milliseconds from the monotonic clock. */
  now: (): number => performance.timeOrigin + performance.now(),
  random: (): number => Math.random(),
};

export const hasDocument = (): boolean => typeof document !== "undefined";
