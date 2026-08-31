/**
 * Persistent Time Trial leaderboard + PB ghost storage. Owner: GAME.
 * Everything lives in localStorage; nothing is fetched at runtime.
 */
import { GhostLap } from './ghost.js';

const LB_KEY = 'f1_26_tt_leaderboard_v1';
const GHOST_KEY = 'f1_26_tt_ghost_v1';
const LEGACY_BEST = 'f1_best';
const MAX_ENTRIES = 12;

export class Leaderboard {
  constructor() { this.entries = []; this.load(); }

  load() {
    this.entries = [];
    try {
      const raw = JSON.parse(localStorage.getItem(LB_KEY) || '[]');
      if (Array.isArray(raw)) {
        this.entries = raw
          .filter((e) => e && typeof e.time === 'number' && isFinite(e.time) && e.time > 1)
          .slice(0, MAX_ENTRIES);
      }
    } catch { /* corrupt or unavailable */ }
    if (!this.entries.length) {
      // migrate the scaffold's single-value best so an existing PB is not lost
      try {
        const t = JSON.parse(localStorage.getItem(LEGACY_BEST) || 'null');
        if (typeof t === 'number' && isFinite(t) && t > 1) {
          this.entries = [{ time: t, sectors: [0, 0, 0], valid: true, date: Date.now(), assists: null, legacy: true }];
        }
      } catch { /* ignore */ }
    }
    this.#sort();
    return this.entries;
  }

  #sort() { this.entries.sort((a, b) => a.time - b.time); }

  save() {
    try {
      localStorage.setItem(LB_KEY, JSON.stringify(this.entries.slice(0, MAX_ENTRIES)));
      const b = this.best();
      if (b) localStorage.setItem(LEGACY_BEST, JSON.stringify(b.time));
    } catch { /* quota / private mode */ }
  }

  /** @returns {boolean} true if this is a new personal best. */
  add(entry) {
    const prev = this.best();
    this.entries.push({ ...entry, date: entry.date ?? Date.now() });
    this.#sort();
    this.entries.length = Math.min(this.entries.length, MAX_ENTRIES);
    this.save();
    return !prev || entry.time < prev.time - 1e-6;
  }

  best() { return this.entries[0] ?? null; }
  top(n = 10) { return this.entries.slice(0, n); }

  clear() {
    this.entries = [];
    try { localStorage.removeItem(LB_KEY); localStorage.removeItem(GHOST_KEY); localStorage.removeItem(LEGACY_BEST); } catch { /* ignore */ }
  }
}

export function loadGhost() {
  try { return GhostLap.decode(JSON.parse(localStorage.getItem(GHOST_KEY) || 'null')); } catch { return null; }
}

export function saveGhost(lap) {
  if (!lap) return false;
  try { localStorage.setItem(GHOST_KEY, JSON.stringify(lap.encode())); return true; }
  catch (e) { console.warn('[game] could not persist ghost:', e?.message); return false; }
}

export function clearGhost() { try { localStorage.removeItem(GHOST_KEY); } catch { /* ignore */ } }
