import fs from 'node:fs';
import nodePath from 'node:path';

const DATA_DIR = nodePath.resolve(process.cwd(), 'data');
const EVENTS_FILE = nodePath.join(DATA_DIR, 'scheduled_events.json');
const DEDUP_FILE = nodePath.join(DATA_DIR, 'processed_event_hashes.json');

export interface ScheduledEvent {
  id: string;
  type: 'halftime' | 'reminder' | 'goal' | 'redcard' | 'kickoff';
  fixtureId: string;
  scheduledAt: number;
  sent: boolean;
  payload?: any;
}

let events: ScheduledEvent[] = [];
let processedHashes: Set<string> = new Set();

function loadHashes(): void {
  try {
    const raw = fs.readFileSync(DEDUP_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) processedHashes = new Set(arr);
  } catch { processedHashes = new Set(); }
}

function persistHashes(): void {
  try { fs.writeFileSync(DEDUP_FILE, JSON.stringify([...processedHashes])); } catch { /* best effort */ }
}

loadHashes();

function ensureDataDir(): void {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

function load(): void {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(EVENTS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) events = arr;
  } catch { events = []; }
}

function persist(): void {
  ensureDataDir();
  try { fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2)); } catch { /* best effort */ }
}

load();

export function scheduleEvent(evt: Omit<ScheduledEvent, 'id' | 'sent'>): ScheduledEvent {
  const id = `evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const full: ScheduledEvent = { ...evt, id, sent: false };
  events.push(full);
  persist();
  return full;
}

export function markSent(id: string): void {
  const evt = events.find((e) => e.id === id);
  if (evt) { evt.sent = true; persist(); }
}

export function getPendingEvents(type?: string): ScheduledEvent[] {
  return events.filter((e) => !e.sent && (type ? e.type === type : true));
}

export function getEventsForFixture(fixtureId: string): ScheduledEvent[] {
  return events.filter((e) => e.fixtureId === fixtureId);
}

export function hasHalftimeSent(fixtureId: string): boolean {
  return events.some((e) => e.fixtureId === fixtureId && e.type === 'halftime' && e.sent);
}

export function markHalftimeSent(fixtureId: string): void {
  const existing = events.find((e) => e.fixtureId === fixtureId && e.type === 'halftime');
  if (existing) { existing.sent = true; persist(); }
  else { scheduleEvent({ type: 'halftime', fixtureId, scheduledAt: Date.now() }); markSent(events[events.length - 1].id); }
}

export function getCatchUpEvents(windowMs: number = 15 * 60 * 1000): ScheduledEvent[] {
  const cutoff = Date.now() - windowMs;
  return events.filter((e) => !e.sent && e.scheduledAt >= cutoff);
}

export function clearCompleted(): void {
  events = events.filter((e) => !e.sent || Date.now() - e.scheduledAt < 24 * 60 * 60 * 1000);
  persist();
}

export function isEventProcessed(hash: string): boolean {
  return processedHashes.has(hash);
}

export function markEventProcessed(hash: string): void {
  processedHashes.add(hash);
  persistHashes();
}

export function generateEventHash(fixtureId: string, eventType: string, detail: string): string {
  return `${fixtureId}_${eventType}_${detail}`.toUpperCase().replace(/[^A-Z0-9_]/g, '');
}

export default { scheduleEvent, markSent, getPendingEvents, getEventsForFixture, hasHalftimeSent, markHalftimeSent, getCatchUpEvents, clearCompleted, isEventProcessed, markEventProcessed, generateEventHash };
