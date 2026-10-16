// LAST BELL — tiny synchronous event bus. Owned by the main agent.
// See CONTRACTS.md §5 for the list of event names and payloads.

export class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }

  emit(type, payload = {}) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${type}" threw`, err);
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}
