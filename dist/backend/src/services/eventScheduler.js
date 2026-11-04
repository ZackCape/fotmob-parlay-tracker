import fs from 'node:fs';
import nodePath from 'node:path';
const DATA_DIR = nodePath.resolve(process.cwd(), 'data');
const EVENTS_FILE = nodePath.join(DATA_DIR, 'scheduled_events.json');
const DEDUP_FILE = nodePath.join(DATA_DIR, 'processed_event_hashes.json');
let events = [];
let processedHashes = new Set();
function loadHashes() {
    try {
        const raw = fs.readFileSync(DEDUP_FILE, 'utf8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr))
            processedHashes = new Set(arr);
    }
    catch {
        processedHashes = new Set();
    }
}
function persistHashes() {
    try {
        fs.writeFileSync(DEDUP_FILE, JSON.stringify([...processedHashes]));
    }
    catch { /* best effort */ }
}
loadHashes();
function ensureDataDir() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    catch { /* exists */ }
}
function load() {
    ensureDataDir();
    try {
        const raw = fs.readFileSync(EVENTS_FILE, 'utf8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr))
            events = arr;
    }
    catch {
        events = [];
    }
}
function persist() {
    ensureDataDir();
    try {
        fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
    }
    catch { /* best effort */ }
}
load();
export function scheduleEvent(evt) {
    const id = `evt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const full = { ...evt, id, sent: false };
    events.push(full);
    persist();
    return full;
}
export function markSent(id) {
    const evt = events.find((e) => e.id === id);
    if (evt) {
        evt.sent = true;
        persist();
    }
}
export function getPendingEvents(type) {
    return events.filter((e) => !e.sent && (type ? e.type === type : true));
}
export function getEventsForFixture(fixtureId) {
    return events.filter((e) => e.fixtureId === fixtureId);
}
export function hasHalftimeSent(fixtureId) {
    return events.some((e) => e.fixtureId === fixtureId && e.type === 'halftime' && e.sent);
}
export function markHalftimeSent(fixtureId) {
    const existing = events.find((e) => e.fixtureId === fixtureId && e.type === 'halftime');
    if (existing) {
        existing.sent = true;
        persist();
    }
    else {
        scheduleEvent({ type: 'halftime', fixtureId, scheduledAt: Date.now() });
        markSent(events[events.length - 1].id);
    }
}
export function getCatchUpEvents(windowMs = 15 * 60 * 1000) {
    const cutoff = Date.now() - windowMs;
    return events.filter((e) => !e.sent && e.scheduledAt >= cutoff);
}
export function clearCompleted() {
    events = events.filter((e) => !e.sent || Date.now() - e.scheduledAt < 24 * 60 * 60 * 1000);
    persist();
}
export function isEventProcessed(hash) {
    return processedHashes.has(hash);
}
export function markEventProcessed(hash) {
    processedHashes.add(hash);
    persistHashes();
}
export function generateEventHash(fixtureId, eventType, detail) {
    return `${fixtureId}_${eventType}_${detail}`.toUpperCase().replace(/[^A-Z0-9_]/g, '');
}
export default { scheduleEvent, markSent, getPendingEvents, getEventsForFixture, hasHalftimeSent, markHalftimeSent, getCatchUpEvents, clearCompleted, isEventProcessed, markEventProcessed, generateEventHash };
