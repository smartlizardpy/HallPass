// LAST BELL — net.js: one small message bus for gameplay that must behave the same in solo and co-op.
// Owned by the lead. Contract: CONTRACTS.md §13 and docs/last-bell-update/architecture.md §2.6.
//
// Solo: there is no network. This peer is the host, requests call the local handler, and broadcasts
// are delivered to this peer straight away. Co-op: coop.js binds a transport (bindTransport). The host
// is authoritative: guests ask (request / toHost) and the host decides and broadcasts.
//
//   net.isHost / net.isOnline / net.selfId          solo: true / false / 'local'
//   net.on(type, fn(data, fromId)) → off()          host broadcasts (also delivered to the host itself)
//   net.broadcast(type, data, { reliable })         host only → everyone, including self
//   net.request(type, data) → Promise<result>       → host (solo: the local handler). Rejects never:
//                                                   failures resolve to { ok: false, error }
//   net.handle(type, fn(data, fromId) → result)     host-side handler for request() and toHost()
//   net.toHost(type, data, { reliable })            fire-and-forget → host's handler (result dropped)
//   net.provideState(key, () => state)              full-state resync (Director joining, reconnects)
//   net.onState(key, fn(state))                     …applied on the receiving peer
//
// `fromId` always comes from the transport (the SDK link), never from the payload. Handlers must
// validate everything else (distance, floor, prerequisites, who is asking).
//
// Transport interface (implemented by coop.js):
//   { isHost(): bool, selfId(): string,
//     broadcast(type, data, opts), toHost(type, data, opts), request(type, data) → Promise }
// …and the transport calls back into: net._deliver(type, data, from)    (a broadcast arrived)
//                                     net._callHandler(type, data, from) (a request/toHost arrived, host)
//                                     net.applySnapshot(all)            (full state arrived)

export class Net {
  constructor(game) {
    this.game = game;
    this.transport = null;
    this._on = new Map(); // type -> Set<fn>
    this._handlers = new Map(); // type -> fn
    this._providers = new Map(); // key -> () => state
    this._stateOn = new Map(); // key -> Set<fn>
    this.stats = { sent: 0, delivered: 0, requests: 0, dropped: 0 };
  }

  get isOnline() {
    return !!this.transport;
  }

  get isHost() {
    return this.transport ? !!this.transport.isHost() : true;
  }

  get selfId() {
    return this.transport ? this.transport.selfId() : 'local';
  }

  bindTransport(transport) {
    this.transport = transport || null;
  }

  unbindTransport(transport) {
    if (!transport || this.transport === transport) this.transport = null;
  }

  on(type, fn) {
    let set = this._on.get(type);
    if (!set) this._on.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  handle(type, fn) {
    this._handlers.set(type, fn);
    return () => {
      if (this._handlers.get(type) === fn) this._handlers.delete(type);
    };
  }

  broadcast(type, data, opts = {}) {
    if (!this.isHost) {
      console.warn(`[net] broadcast '${type}' refused: only the host broadcasts`);
      return;
    }
    this.stats.sent++;
    if (this.transport) {
      try {
        this.transport.broadcast(type, data, opts);
      } catch (err) {
        console.warn(`[net] broadcast '${type}' failed`, err);
      }
    }
    this._deliver(type, data, this.selfId);
  }

  toHost(type, data, opts = {}) {
    this.stats.sent++;
    if (this.isHost) {
      this._callHandler(type, data, this.selfId);
      return;
    }
    try {
      this.transport.toHost(type, data, opts);
    } catch (err) {
      console.warn(`[net] toHost '${type}' failed`, err);
    }
  }

  request(type, data) {
    this.stats.requests++;
    if (this.isHost) return this._callHandler(type, data, this.selfId);
    try {
      return Promise.resolve(this.transport.request(type, data)).then(
        (r) => r ?? { ok: false, error: 'empty' },
        (err) => ({ ok: false, error: String(err?.code || err?.message || err || 'failed') }),
      );
    } catch (err) {
      return Promise.resolve({ ok: false, error: String(err?.message || err) });
    }
  }

  provideState(key, fn) {
    this._providers.set(key, fn);
    return () => {
      if (this._providers.get(key) === fn) this._providers.delete(key);
    };
  }

  onState(key, fn) {
    let set = this._stateOn.get(key);
    if (!set) this._stateOn.set(key, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Host: every provided state, for a peer that needs to catch up. */
  snapshotAll() {
    const out = {};
    for (const [key, fn] of this._providers) {
      try {
        out[key] = fn();
      } catch (err) {
        console.warn(`[net] state '${key}' failed`, err);
      }
    }
    return out;
  }

  applySnapshot(all) {
    if (!all || typeof all !== 'object') return;
    for (const key of Object.keys(all)) {
      const set = this._stateOn.get(key);
      if (!set) continue;
      for (const fn of [...set]) {
        try {
          fn(all[key]);
        } catch (err) {
          console.error(`[net] applying state '${key}' failed`, err);
        }
      }
    }
  }

  // ---- called by the transport ------------------------------------------------------------
  _deliver(type, data, from) {
    const set = this._on.get(type);
    if (!set || !set.size) return;
    this.stats.delivered++;
    for (const fn of [...set]) {
      try {
        fn(data, from);
      } catch (err) {
        console.error(`[net] handler for '${type}' failed`, err);
      }
    }
  }

  _callHandler(type, data, from) {
    const h = this._handlers.get(type);
    if (!h) {
      this.stats.dropped++;
      return Promise.resolve({ ok: false, error: 'no-handler' });
    }
    try {
      return Promise.resolve(h(data, from)).then(
        (r) => r ?? { ok: true },
        (err) => {
          console.error(`[net] request '${type}' failed`, err);
          return { ok: false, error: 'handler-failed' };
        },
      );
    } catch (err) {
      console.error(`[net] request '${type}' failed`, err);
      return Promise.resolve({ ok: false, error: 'handler-failed' });
    }
  }
}
