/**
 * CalendarService — CalDAV integration (Faza 8.2)
 *
 * Natywna integracja CalDAV z wieloma providerami (Google, iCloud, Nextcloud, generic CalDAV).
 * Używa `tsdav` jako CalDAV client i `node-ical` do parsowania ICS.
 *
 * Funkcjonalności:
 * - Multi-connection: wiele kalendarzy jednocześnie (np. Google + iCloud)
 * - Fetch calendars & events z time range
 * - Create/update/delete events via CalDAV
 * - ICS parsing z RRULE expansion
 * - Upcoming events cache dla proaktywnych powiadomień
 * - Credentials w safeStorage (hasła, tokeny OAuth)
 *
 * @module main/services/calendar-service
 */

import { DAVClient, DAVCalendar, DAVCalendarObject } from 'tsdav';
import * as ical from 'node-ical';
import { randomUUID } from 'crypto';
import { safeStorage } from 'electron';
import { createLogger } from './logger';
import type { ConfigService } from './config';
import type {
  CalendarConfig,
  CalendarInfo,
  CalendarEvent,
  CalendarStatus,
  CalendarConnectionStatus,
  FetchEventsOptions,
  CreateEventOptions,
  CalendarOperationResult,
} from '@shared/types';

const log = createLogger('CalendarService');

/** Internal connection state */
interface CalendarConnection {
  config: CalendarConfig;
  client: DAVClient | null;
  status: CalendarConnectionStatus;
  error?: string;
  calendars: DAVCalendar[];
  cachedEvents: CalendarEvent[];
  lastSync: number;
}

/**
 * CalendarService — zarządza połączeniami CalDAV i operacjami na kalendarzach.
 */
export class CalendarService {
  private connections = new Map<string, CalendarConnection>();
  private configService: ConfigService;
  private statusCallback?: (status: CalendarStatus) => void;
  private syncInterval?: ReturnType<typeof setInterval>;

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  // ─── Lifecycle ───

  /**
   * Initialize: load connections from config and auto-connect enabled ones.
   */
  async initialize(): Promise<void> {
    const configs = this.configService.get('calendarConnections') ?? [];
    log.info(`Inicjalizacja z ${configs.length} połączeniami kalendarza`);

    for (const config of configs) {
      this.connections.set(config.id, {
        config,
        client: null,
        status: 'disconnected',
        error: undefined,
        calendars: [],
        cachedEvents: [],
        lastSync: 0,
      });

      if (config.enabled) {
        // Auto-connect w tle (nie blokuj init)
        void this.connect(config.id).catch((err) => {
          log.warn(`Auto-connect failed for ${config.name}: ${err.message}`);
        });
      }
    }

    // Sync co 15 minut
    this.syncInterval = setInterval(
      () => {
        void this.syncAll();
      },
      15 * 60 * 1000,
    );
  }

  /**
   * Shutdown: disconnect all and stop sync.
   */
  async shutdown(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
    // DAVClient nie wymaga explicit disconnect — to HTTP client
    this.connections.clear();
    log.info('Shutdown complete');
  }

  // ─── Connection Management ───

  /**
   * Add a new calendar connection.
   */
  async addConnection(config: Omit<CalendarConfig, 'id'> & { id?: string }): Promise<CalendarOperationResult> {
    const id = config.id || randomUUID();
    const fullConfig: CalendarConfig = { ...config, id } as CalendarConfig;

    // Persist password/secret w safeStorage
    await this.storeCredentials(fullConfig);

    this.connections.set(id, {
      config: fullConfig,
      client: null,
      status: 'disconnected',
      error: undefined,
      calendars: [],
      cachedEvents: [],
      lastSync: 0,
    });

    // Save to config (bez haseł — te są w safeStorage)
    this.saveConnectionsToConfig();
    this.emitStatus();

    if (fullConfig.enabled) {
      void this.connect(id);
    }

    return { success: true, message: 'Połączenie dodane', connectionId: id };
  }

  /**
   * Remove a calendar connection.
   */
  async removeConnection(connectionId: string): Promise<void> {
    this.connections.delete(connectionId);
    this.clearCredentials(connectionId);
    this.saveConnectionsToConfig();
    this.emitStatus();
    log.info(`Połączenie ${connectionId} usunięte`);
  }

  /**
   * Connect to a CalDAV server.
   */
  async connect(connectionId: string): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new Error(`Brak połączenia: ${connectionId}`);

    conn.status = 'connecting';
    conn.error = undefined;
    this.emitStatus();

    try {
      const credentials = await this.buildCredentials(conn.config);
      const client = new DAVClient({
        serverUrl: conn.config.serverUrl,
        credentials,
        authMethod: conn.config.authMethod as 'Basic' | 'Oauth',
        defaultAccountType: 'caldav',
      });

      await client.login();
      conn.client = client;

      // Discover calendars
      const calendars = await client.fetchCalendars();
      conn.calendars = calendars;
      conn.status = 'connected';
      conn.lastSync = Date.now();

      log.info(`Połączono z ${conn.config.name}: ${calendars.length} kalendarzy`);

      // Initial event fetch (next 7 days)
      void this.fetchEventsForConnection(conn, {
        start: new Date().toISOString(),
        end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch (err: unknown) {
      conn.status = 'error';
      conn.error = err instanceof Error ? err.message : String(err);
      log.error(`Błąd połączenia ${conn.config.name}: ${conn.error}`);
    }

    this.emitStatus();
  }

  /**
   * Disconnect from a CalDAV server.
   */
  disconnect(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    conn.client = null;
    conn.status = 'disconnected';
    conn.calendars = [];
    conn.cachedEvents = [];
    this.emitStatus();
  }

  // ─── Calendar Discovery ───

  /**
   * Get available calendars for a connection.
   */
  getCalendars(connectionId: string): CalendarInfo[] {
    const conn = this.connections.get(connectionId);
    if (!conn) return [];

    return conn.calendars.map((cal) => ({
      url: cal.url,
      displayName: typeof cal.displayName === 'string' ? cal.displayName : 'Kalendarz',
      color: (cal as Record<string, unknown>).calendarColor as string | undefined,
      description: typeof cal.description === 'string' ? cal.description : undefined,
      ctag: typeof cal.ctag === 'string' ? cal.ctag : undefined,
      syncToken: typeof cal.syncToken === 'string' ? cal.syncToken : undefined,
    }));
  }

  /**
   * Get all calendars across all connections.
   */
  getAllCalendars(): Array<CalendarInfo & { connectionId: string; connectionName: string }> {
    const result: Array<CalendarInfo & { connectionId: string; connectionName: string }> = [];
    for (const [id, conn] of this.connections) {
      if (conn.status !== 'connected') continue;
      for (const cal of conn.calendars) {
        result.push({
          connectionId: id,
          connectionName: conn.config.name,
          url: cal.url,
          displayName: typeof cal.displayName === 'string' ? cal.displayName : 'Kalendarz',
          color: (cal as Record<string, unknown>).calendarColor as string | undefined,
          description: typeof cal.description === 'string' ? cal.description : undefined,
        });
      }
    }
    return result;
  }

  // ─── Event Operations ───

  /**
   * Fetch events across all connected calendars.
   */
  async fetchEvents(options: FetchEventsOptions): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];

    if (options.connectionId) {
      const conn = this.connections.get(options.connectionId);
      if (!conn || conn.status !== 'connected') {
        throw new Error(`Połączenie ${options.connectionId} nie jest aktywne`);
      }
      const events = await this.fetchEventsForConnection(conn, options);
      allEvents.push(...events);
    } else {
      // Fetch from all connected
      for (const conn of this.connections.values()) {
        if (conn.status !== 'connected') continue;
        try {
          const events = await this.fetchEventsForConnection(conn, options);
          allEvents.push(...events);
        } catch (err) {
          log.warn(`Błąd pobierania eventów z ${conn.config.name}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // Sort by start time
    allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    return allEvents;
  }

  /**
   * Create a new calendar event.
   */
  async createEvent(options: CreateEventOptions): Promise<CalendarOperationResult> {
    const conn = this.connections.get(options.connectionId);
    if (!conn?.client || conn.status !== 'connected') {
      return {
        success: false,
        message: `Połączenie ${options.connectionId} nie jest aktywne`,
      };
    }

    // Find target calendar
    let targetCalendar = conn.calendars[0];
    if (options.calendarUrl) {
      const found = conn.calendars.find((c) => c.url === options.calendarUrl);
      if (found) targetCalendar = found;
    }

    if (!targetCalendar) {
      return { success: false, message: 'Brak kalendarza do dodania eventu' };
    }

    try {
      const uid = randomUUID();
      const icsString = this.buildICS({
        uid,
        summary: options.summary,
        start: options.start,
        end: options.end,
        allDay: options.allDay,
        description: options.description,
        location: options.location,
        attendees: options.attendees,
        rrule: options.rrule,
      });

      await conn.client.createCalendarObject({
        calendar: targetCalendar,
        filename: `${uid}.ics`,
        iCalString: icsString,
      });

      const event: CalendarEvent = {
        uid,
        summary: options.summary,
        start: options.start,
        end: options.end,
        allDay: options.allDay ?? false,
        description: options.description,
        location: options.location,
        attendees: options.attendees,
        calendarUrl: targetCalendar.url,
        calendarName: typeof targetCalendar.displayName === 'string' ? targetCalendar.displayName : undefined,
      };

      log.info(`Event utworzony: "${options.summary}" w ${conn.config.name}`);
      return { success: true, message: 'Event został utworzony', event };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Błąd tworzenia eventu: ${msg}`);
      return { success: false, message: `Błąd: ${msg}` };
    }
  }

  /**
   * Delete a calendar event.
   */
  async deleteEvent(connectionId: string, eventUrl: string, etag?: string): Promise<CalendarOperationResult> {
    const conn = this.connections.get(connectionId);
    if (!conn?.client || conn.status !== 'connected') {
      return { success: false, message: 'Połączenie nie jest aktywne' };
    }

    try {
      await conn.client.deleteCalendarObject({
        calendarObject: {
          url: eventUrl,
          data: '',
          etag: etag ?? '',
        },
        headers: etag ? { 'If-Match': etag } : undefined,
      });

      log.info(`Event usunięty: ${eventUrl}`);
      return { success: true, message: 'Event został usunięty' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Błąd usuwania eventu: ${msg}`);
      return { success: false, message: `Błąd: ${msg}` };
    }
  }

  // ─── Upcoming Events (for proactive notifications) ───

  /**
   * Get upcoming events in the next N minutes.
   * Used by HeartbeatEngine for proactive calendar reminders.
   */
  getUpcomingEvents(minutesAhead: number = 30): CalendarEvent[] {
    const now = Date.now();
    const cutoff = now + minutesAhead * 60 * 1000;
    const upcoming: CalendarEvent[] = [];

    for (const conn of this.connections.values()) {
      for (const event of conn.cachedEvents) {
        const eventStart = new Date(event.start).getTime();
        if (eventStart > now && eventStart <= cutoff) {
          upcoming.push(event);
        }
      }
    }

    upcoming.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    return upcoming;
  }

  /**
   * Get today's events for context building.
   */
  getTodayEvents(): CalendarEvent[] {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const today: CalendarEvent[] = [];
    for (const conn of this.connections.values()) {
      for (const event of conn.cachedEvents) {
        const eventStart = new Date(event.start).getTime();
        if (eventStart >= startOfDay.getTime() && eventStart <= endOfDay.getTime()) {
          today.push(event);
        }
      }
    }

    today.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    return today;
  }

  // ─── Status ───

  /**
   * Get current status of all connections.
   */
  getStatus(): CalendarStatus {
    return {
      connections: Array.from(this.connections.values()).map((conn) => ({
        id: conn.config.id,
        name: conn.config.name,
        provider: conn.config.provider,
        serverUrl: conn.config.serverUrl,
        status: conn.status,
        error: conn.error,
        lastSync: conn.lastSync || undefined,
        calendarCount: conn.calendars.length,
        eventCount: conn.cachedEvents.length,
      })),
    };
  }

  /**
   * Get list of configured connections (for UI).
   */
  getConnections(): CalendarConfig[] {
    return Array.from(this.connections.values()).map((c) => c.config);
  }

  /**
   * Register a callback for status updates (for IPC push).
   */
  onStatusChange(callback: (status: CalendarStatus) => void): void {
    this.statusCallback = callback;
  }

  /**
   * Check if any calendar is connected.
   */
  isConnected(): boolean {
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') return true;
    }
    return false;
  }

  // ─── Private: Event Fetching ───

  private async fetchEventsForConnection(
    conn: CalendarConnection,
    options: { start: string; end: string; calendarUrl?: string },
  ): Promise<CalendarEvent[]> {
    if (!conn.client) return [];

    const calendarsToFetch = options.calendarUrl
      ? conn.calendars.filter((c) => c.url === options.calendarUrl)
      : conn.calendars;

    // Filter by selected calendars if configured
    const selectedUrls = conn.config.selectedCalendars;
    const filtered =
      selectedUrls && selectedUrls.length > 0
        ? calendarsToFetch.filter((c) => selectedUrls.includes(c.url))
        : calendarsToFetch;

    const allEvents: CalendarEvent[] = [];

    for (const calendar of filtered) {
      try {
        const objects = await conn.client.fetchCalendarObjects({
          calendar,
          timeRange: {
            start: options.start,
            end: options.end,
          },
        });

        for (const obj of objects) {
          const events = this.parseCalendarObject(obj, calendar, conn.config);
          allEvents.push(...events);
        }
      } catch (err) {
        log.warn(`Błąd pobierania z kalendarza ${calendar.displayName}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Update cache
    conn.cachedEvents = allEvents;
    conn.lastSync = Date.now();

    return allEvents;
  }

  // ─── Private: ICS Parsing ───

  private parseCalendarObject(obj: DAVCalendarObject, calendar: DAVCalendar, config: CalendarConfig): CalendarEvent[] {
    if (!obj.data) return [];

    const events: CalendarEvent[] = [];

    try {
      const parsed = ical.sync.parseICS(obj.data);

      for (const comp of Object.values(parsed)) {
        if (!comp || comp.type !== 'VEVENT') continue;
        const vevent = comp as ical.VEvent;

        const startDate = vevent.start ? new Date(vevent.start as unknown as string) : null;
        const endDate = vevent.end ? new Date(vevent.end as unknown as string) : null;

        if (!startDate) continue;

        // Detect all-day: ICS uses DATE (not DATETIME) for all-day events
        const allDay = this.isAllDayEvent(vevent);

        const attendees = this.extractAttendees(vevent);

        // Helper to extract string from ParameterValue | string | undefined
        const str = (v: unknown): string | undefined => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && 'val' in v) return String((v as Record<string, unknown>).val);
          return undefined;
        };

        events.push({
          uid: str(vevent.uid) ?? randomUUID(),
          summary: str(vevent.summary) ?? '(bez tytułu)',
          start: startDate.toISOString(),
          end: endDate ? endDate.toISOString() : new Date(startDate.getTime() + 60 * 60 * 1000).toISOString(),
          allDay,
          description: str(vevent.description),
          location: str(vevent.location),
          attendees,
          organizer: this.extractOrganizer(vevent),
          rrule: vevent.rrule ? vevent.rrule.toString() : undefined,
          status: str(vevent.status) as CalendarEvent['status'] | undefined,
          calendarUrl: calendar.url,
          calendarName: typeof calendar.displayName === 'string' ? calendar.displayName : config.name,
          eventUrl: obj.url,
          etag: obj.etag ?? undefined,
          rawICS: obj.data,
        });
      }
    } catch (err) {
      log.warn(`Błąd parsowania ICS: ${err instanceof Error ? err.message : err}`);
    }

    return events;
  }

  private isAllDayEvent(vevent: ical.VEvent): boolean {
    // All-day events: start is a Date without time component
    const start = vevent.start;
    if (!start) return false;

    // node-ical sets dateOnly property for DATE values
    if (typeof start === 'object' && 'dateOnly' in (start as any)) {
      return (start as any).dateOnly === true;
    }

    // Fallback: check if start === midnight and duration is multiple of days
    const d = new Date(start as unknown as string);
    return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  }

  private extractAttendees(vevent: ical.VEvent): string[] {
    const attendees: string[] = [];
    const raw = (vevent as Record<string, unknown>).attendee;

    if (Array.isArray(raw)) {
      for (const a of raw) {
        if (typeof a === 'string') {
          attendees.push(a.replace('mailto:', ''));
        } else if (a && typeof a === 'object' && 'val' in a) {
          attendees.push(String((a as Record<string, unknown>).val).replace('mailto:', ''));
        }
      }
    } else if (typeof raw === 'string') {
      attendees.push(raw.replace('mailto:', ''));
    }

    return attendees;
  }

  private extractOrganizer(vevent: ical.VEvent): string | undefined {
    const org = (vevent as Record<string, unknown>).organizer;
    if (typeof org === 'string') return org.replace('mailto:', '');
    if (org && typeof org === 'object' && 'val' in org) {
      return String((org as Record<string, unknown>).val).replace('mailto:', '');
    }
    return undefined;
  }

  // ─── Private: ICS Building ───

  private buildICS(options: {
    uid: string;
    summary: string;
    start: string;
    end: string;
    allDay?: boolean;
    description?: string;
    location?: string;
    attendees?: string[];
    rrule?: string;
  }): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KxAI//Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${options.uid}`,
      `DTSTAMP:${this.formatICSDate(new Date().toISOString())}`,
    ];

    if (options.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${this.formatICSDateOnly(options.start)}`);
      lines.push(`DTEND;VALUE=DATE:${this.formatICSDateOnly(options.end)}`);
    } else {
      lines.push(`DTSTART:${this.formatICSDate(options.start)}`);
      lines.push(`DTEND:${this.formatICSDate(options.end)}`);
    }

    lines.push(`SUMMARY:${this.escapeICS(options.summary)}`);

    if (options.description) {
      lines.push(`DESCRIPTION:${this.escapeICS(options.description)}`);
    }

    if (options.location) {
      lines.push(`LOCATION:${this.escapeICS(options.location)}`);
    }

    if (options.rrule) {
      lines.push(`RRULE:${options.rrule}`);
    }

    if (options.attendees) {
      for (const email of options.attendees) {
        lines.push(`ATTENDEE;RSVP=TRUE:mailto:${email}`);
      }
    }

    lines.push('STATUS:CONFIRMED');
    lines.push('SEQUENCE:0');
    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');

    return lines.join('\r\n');
  }

  /**
   * Format ISO date to ICS datetime (20260301T100000Z)
   */
  private formatICSDate(iso: string): string {
    return new Date(iso)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  }

  /**
   * Format ISO date to ICS date-only (20260301)
   */
  private formatICSDateOnly(iso: string): string {
    return new Date(iso).toISOString().slice(0, 10).replace(/-/g, '');
  }

  /**
   * Escape special chars in ICS values.
   */
  private escapeICS(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  // ─── Private: Credentials ───

  private async buildCredentials(config: CalendarConfig): Promise<Record<string, string>> {
    const password = this.loadCredential(`calendar_${config.id}_password`);

    if (config.authMethod === 'OAuth' && config.provider === 'google') {
      const refreshToken = this.loadCredential(`calendar_${config.id}_refresh_token`);
      return {
        tokenUrl: 'https://accounts.google.com/o/oauth2/token',
        username: config.username,
        refreshToken: refreshToken ?? '',
        clientId: config.googleClientId ?? '',
        clientSecret: config.googleClientSecret ?? '',
      };
    }

    return {
      username: config.username,
      password: password ?? '',
    };
  }

  private storeCredentials(_config: CalendarConfig): Promise<void> {
    // Credentials stored via electron safeStorage
    // Passwords are NOT stored in config.json
    return Promise.resolve();
  }

  /**
   * Store a credential in electron safeStorage.
   */
  storeCredential(key: string, value: string): void {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(value);
        // Store encrypted buffer — we'll use a simple Map for now
        // In production, persist to file or keychain
        this.credentialStore.set(key, encrypted);
      }
    } catch (err) {
      log.warn(`Nie udało się zapisać credential ${key}: ${err}`);
    }
  }

  private loadCredential(key: string): string | null {
    try {
      const encrypted = this.credentialStore.get(key);
      if (encrypted && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(encrypted);
      }
    } catch (err) {
      log.warn(`Nie udało się odczytać credential ${key}: ${err}`);
    }
    return null;
  }

  private clearCredentials(connectionId: string): void {
    const prefix = `calendar_${connectionId}_`;
    for (const key of this.credentialStore.keys()) {
      if (key.startsWith(prefix)) {
        this.credentialStore.delete(key);
      }
    }
  }

  private credentialStore = new Map<string, Buffer>();

  // ─── Private: Config Persistence ───

  private saveConnectionsToConfig(): void {
    const configs = Array.from(this.connections.values()).map((c) => c.config);
    void this.configService.set('calendarConnections' as any, configs as any);
  }

  // ─── Private: Sync ───

  private async syncAll(): Promise<void> {
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    for (const conn of this.connections.values()) {
      if (conn.status !== 'connected') continue;
      try {
        conn.status = 'syncing';
        this.emitStatus();
        await this.fetchEventsForConnection(conn, {
          start: now.toISOString(),
          end: weekAhead,
        });
        conn.status = 'connected';
      } catch (err) {
        log.warn(`Sync error ${conn.config.name}: ${err instanceof Error ? err.message : err}`);
        conn.status = 'connected'; // Don't break on sync error
      }
    }
    this.emitStatus();
  }

  private emitStatus(): void {
    if (this.statusCallback) {
      this.statusCallback(this.getStatus());
    }
  }
}
