// Tiny synchronous event bus. Owner: CORE (do not rewrite; add events only).
export class Bus {
  #m = new Map();
  on(e, f) { (this.#m.get(e) ?? this.#m.set(e, []).get(e)).push(f); return () => this.off(e, f); }
  off(e, f) { const a = this.#m.get(e); if (a) a.splice(a.indexOf(f) >>> 0, 1); }
  emit(e, p) { const a = this.#m.get(e); if (a) for (const f of a.slice()) f(p); }
}
