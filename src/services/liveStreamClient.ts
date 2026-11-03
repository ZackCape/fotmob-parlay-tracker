/**
 * Cape Predictor — Live Stream & SSE Client
 *
 * Resilient EventSource client for sub-second live events, momentum waveforms,
 * chronological incident timelines, and late-game Pressure Squeeze radar alerts.
 */

export type LiveStreamEventType =
  | 'GOAL'
  | 'DISALLOWED_GOAL'
  | 'VAR_ROLLBACK'
  | 'RED_CARD'
  | 'HT'
  | 'FT'
  | 'STEAM'
  | 'MOMENTUM_UPDATE'
  | 'PRESSURE_SQUEEZE';

export interface LiveStreamEvent {
  type: LiveStreamEventType;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  minute: string | number | null;
  detail: string;
  timestamp: number;
  momentum?: number;
  momentumHistory?: Array<{ minute: number; score: number; timestamp?: number }>;
  timelineEntry?: {
    id: string;
    fixtureId: string;
    type: string;
    minute: number | string;
    team?: string;
    detail: string;
  };
  pressureSqueeze?: {
    fixtureId: string;
    homeTeam: string;
    awayTeam: string;
    minute: number;
    score: string;
    dominantTeam: 'home' | 'away';
    trailingTeam?: 'home' | 'away';
    momentumScore: number;
    recommendedMarkets: string[];
    urgency: 'HIGH' | 'EXTREME';
    reason: string;
    timestamp: number;
  };
  inPlayOdds?: {
    market: string;
    takenOdds: number;
    liveOdds: number;
    iClvPercent: number;
  };
}

type EventListener = (event: LiveStreamEvent) => void;
type ConnectionStatusListener = (connected: boolean) => void;

class LiveStreamClient {
  private eventSource: EventSource | null = null;
  private listeners: Set<EventListener> = new Set();
  private statusListeners: Set<ConnectionStatusListener> = new Set();
  private reconnectDelay = 1000;
  private maxReconnectDelay = 15000;
  private reconnectTimer: any = null;
  private isExplicitlyClosed = false;
  private isConnected = false;

  constructor() {
    // Lazily initialized on first subscription or start()
  }

  public start(): void {
    if (typeof window === 'undefined') return;
    if (this.eventSource) return;

    this.isExplicitlyClosed = false;
    this.connect();
  }

  private connect(): void {
    if (this.isExplicitlyClosed) return;

    try {
      const url = '/api/live/stream';
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        this.isConnected = true;
        this.reconnectDelay = 1000;
        this.notifyStatus(true);
      };

      this.eventSource.onerror = () => {
        this.isConnected = false;
        this.notifyStatus(false);
        this.cleanup();
        this.scheduleReconnect();
      };

      // General message event
      this.eventSource.onmessage = (e) => {
        try {
          const data: LiveStreamEvent = JSON.parse(e.data);
          this.broadcast(data);
        } catch { /* parse failure */ }
      };

      // Named SSE events
      const eventNames = [
        'goal',
        'disallowed_goal',
        'var_rollback',
        'red_card',
        'ht',
        'ft',
        'steam',
        'momentum_update',
        'pressure_squeeze',
      ];

      for (const name of eventNames) {
        this.eventSource.addEventListener(name, (e: any) => {
          try {
            const data: LiveStreamEvent = JSON.parse(e.data);
            this.broadcast(data);
          } catch { /* parse error */ }
        });
      }
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isExplicitlyClosed || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  private cleanup(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private broadcast(event: LiveStreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[LiveStreamClient] Listener error:', err);
      }
    }
  }

  private notifyStatus(connected: boolean): void {
    for (const listener of this.statusListeners) {
      try {
        listener(connected);
      } catch { /* swallow */ }
    }
  }

  public subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    if (!this.eventSource && !this.isExplicitlyClosed) {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onStatusChange(listener: ConnectionStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.isConnected);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public close(): void {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    this.isConnected = false;
    this.notifyStatus(false);
  }

  public async fetchLiveMatches(): Promise<any[]> {
    try {
      const res = await fetch('/api/live/matches');
      if (!res.ok) return [];
      const data = await res.json();
      return data.matches || [];
    } catch {
      return [];
    }
  }

  public async fetchMatchTracker(fixtureId: string): Promise<any | null> {
    try {
      const res = await fetch(`/api/live/tracker/${encodeURIComponent(fixtureId)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.match || null;
    } catch {
      return null;
    }
  }
}

export const liveStreamClient = new LiveStreamClient();
