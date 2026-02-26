import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../src/main/services/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock tsdav
vi.mock('tsdav', () => ({
  DAVClient: vi.fn().mockImplementation(() => ({
    login: vi.fn().mockResolvedValue(undefined),
    fetchCalendars: vi.fn().mockResolvedValue([]),
    fetchCalendarObjects: vi.fn().mockResolvedValue([]),
    createCalendarObject: vi.fn().mockResolvedValue(undefined),
    deleteCalendarObject: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock node-ical
vi.mock('node-ical', () => ({
  sync: {
    parseICS: vi.fn().mockReturnValue({}),
  },
}));

// Mock electron safeStorage
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

import { CalendarService } from '../src/main/services/calendar-service';

function createMockConfig() {
  return {
    get: vi.fn().mockReturnValue([]),
    set: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('CalendarService', () => {
  let configService: ReturnType<typeof createMockConfig>;
  let service: CalendarService;

  beforeEach(() => {
    vi.clearAllMocks();
    configService = createMockConfig();
    service = new CalendarService(configService);
  });

  // ─── Lifecycle ───

  describe('initialize / shutdown', () => {
    it('should initialize with empty connections', async () => {
      configService.get.mockReturnValue([]);
      await service.initialize();
      expect(service.getConnections()).toEqual([]);
    });

    it('should load connections from config', async () => {
      const configs = [
        { id: 'c1', name: 'Google', provider: 'google', serverUrl: 'https://cal.google.com', enabled: false, username: 'user', authMethod: 'Basic' },
      ];
      configService.get.mockReturnValue(configs);
      await service.initialize();
      expect(service.getConnections()).toHaveLength(1);
    });

    it('should shutdown cleanly', async () => {
      await service.initialize();
      await service.shutdown();
      expect(service.getConnections()).toEqual([]);
    });
  });

  // ─── Connection Management ───

  describe('addConnection', () => {
    it('should add a new connection', async () => {
      const result = await service.addConnection({
        name: 'Test',
        provider: 'generic' as any,
        serverUrl: 'https://caldav.example.com',
        username: 'user',
        authMethod: 'Basic',
        enabled: false,
      });
      expect(result.success).toBe(true);
      expect(result.connectionId).toBeDefined();
      expect(service.getConnections()).toHaveLength(1);
    });

    it('should use provided id if given', async () => {
      const result = await service.addConnection({
        id: 'custom-id',
        name: 'Test',
        provider: 'generic' as any,
        serverUrl: 'https://caldav.example.com',
        username: 'user',
        authMethod: 'Basic',
        enabled: false,
      });
      expect(result.connectionId).toBe('custom-id');
    });
  });

  describe('removeConnection', () => {
    it('should remove an existing connection', async () => {
      await service.addConnection({
        id: 'to-remove',
        name: 'Test',
        provider: 'generic' as any,
        serverUrl: 'https://example.com',
        username: 'user',
        authMethod: 'Basic',
        enabled: false,
      });
      expect(service.getConnections()).toHaveLength(1);
      await service.removeConnection('to-remove');
      expect(service.getConnections()).toHaveLength(0);
    });
  });

  describe('disconnect', () => {
    it('should set status to disconnected', async () => {
      await service.addConnection({
        id: 'conn1',
        name: 'Test',
        provider: 'generic' as any,
        serverUrl: 'https://example.com',
        username: 'user',
        authMethod: 'Basic',
        enabled: false,
      });
      service.disconnect('conn1');
      const status = service.getStatus();
      expect(status.connections[0].status).toBe('disconnected');
    });

    it('should not throw for unknown connection', () => {
      expect(() => service.disconnect('nonexistent')).not.toThrow();
    });
  });

  // ─── Calendar Discovery ───

  describe('getCalendars', () => {
    it('should return empty for unknown connection', () => {
      expect(service.getCalendars('nonexistent')).toEqual([]);
    });
  });

  describe('getAllCalendars', () => {
    it('should return empty when no connections', () => {
      expect(service.getAllCalendars()).toEqual([]);
    });
  });

  // ─── Status ───

  describe('getStatus', () => {
    it('should return status of all connections', async () => {
      await service.addConnection({
        id: 'c1',
        name: 'Cal1',
        provider: 'generic' as any,
        serverUrl: 'https://example.com',
        username: 'user',
        authMethod: 'Basic',
        enabled: false,
      });
      const status = service.getStatus();
      expect(status.connections).toHaveLength(1);
      expect(status.connections[0].name).toBe('Cal1');
      expect(status.connections[0].status).toBe('disconnected');
    });
  });

  describe('isConnected', () => {
    it('should return false when no connections', () => {
      expect(service.isConnected()).toBe(false);
    });

    it('should return false when all disconnected', async () => {
      await service.addConnection({
        id: 'c1',
        name: 'Cal',
        provider: 'generic' as any,
        serverUrl: 'https://example.com',
        username: 'user',
        authMethod: 'Basic',
        enabled: false,
      });
      expect(service.isConnected()).toBe(false);
    });
  });

  describe('onStatusChange', () => {
    it('should register callback and call it on status change', async () => {
      const cb = vi.fn();
      service.onStatusChange(cb);
      await service.addConnection({
        id: 'c1',
        name: 'Cal',
        provider: 'generic' as any,
        serverUrl: 'https://example.com',
        username: 'user',
        authMethod: 'Basic',
        enabled: false,
      });
      expect(cb).toHaveBeenCalled();
    });
  });

  // ─── Upcoming / Today Events ───

  describe('getUpcomingEvents', () => {
    it('should return empty when no events', () => {
      expect(service.getUpcomingEvents()).toEqual([]);
    });

    it('should return events within time window', async () => {
      await service.addConnection({
        id: 'c1',
        name: 'Cal',
        provider: 'generic' as any,
        serverUrl: 'https://example.com',
        username: 'user',
        authMethod: 'Basic',
        enabled: false,
      });
      // Inject cached events
      const conn = (service as any).connections.get('c1');
      const inWindow = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // +15min
      const outOfWindow = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +60min
      const past = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // -5min
      conn.cachedEvents = [
        { uid: '1', summary: 'Soon', start: inWindow, end: inWindow, allDay: false },
        { uid: '2', summary: 'Later', start: outOfWindow, end: outOfWindow, allDay: false },
        { uid: '3', summary: 'Past', start: past, end: past, allDay: false },
      ];

      const upcoming = service.getUpcomingEvents(30);
      expect(upcoming).toHaveLength(1);
      expect(upcoming[0].summary).toBe('Soon');
    });
  });

  describe('getTodayEvents', () => {
    it('should return empty when no events', () => {
      expect(service.getTodayEvents()).toEqual([]);
    });

    it('should return today events only', async () => {
      await service.addConnection({
        id: 'c1',
        name: 'Cal',
        provider: 'generic' as any,
        serverUrl: 'https://example.com',
        username: 'user',
        authMethod: 'Basic',
        enabled: false,
      });
      const conn = (service as any).connections.get('c1');
      const todayNoon = new Date();
      todayNoon.setHours(12, 0, 0, 0);
      const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);

      conn.cachedEvents = [
        { uid: '1', summary: 'Today', start: todayNoon.toISOString(), end: todayNoon.toISOString(), allDay: false },
        { uid: '2', summary: 'Tomorrow', start: tomorrow.toISOString(), end: tomorrow.toISOString(), allDay: false },
      ];

      const today = service.getTodayEvents();
      expect(today).toHaveLength(1);
      expect(today[0].summary).toBe('Today');
    });
  });

  // ─── ICS Building ───

  describe('buildICS', () => {
    const build = (options: any) => (service as any).buildICS(options);

    it('should build valid ICS string', () => {
      const ics = build({
        uid: 'test-uid',
        summary: 'Meeting',
        start: '2026-03-01T10:00:00Z',
        end: '2026-03-01T11:00:00Z',
      });
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('END:VCALENDAR');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('END:VEVENT');
      expect(ics).toContain('UID:test-uid');
      expect(ics).toContain('SUMMARY:Meeting');
    });

    it('should handle all-day events', () => {
      const ics = build({
        uid: 'ad-uid',
        summary: 'All Day',
        start: '2026-03-01T00:00:00Z',
        end: '2026-03-02T00:00:00Z',
        allDay: true,
      });
      expect(ics).toContain('DTSTART;VALUE=DATE:');
      expect(ics).toContain('DTEND;VALUE=DATE:');
    });

    it('should include description and location', () => {
      const ics = build({
        uid: 'uid',
        summary: 'Event',
        start: '2026-03-01T10:00:00Z',
        end: '2026-03-01T11:00:00Z',
        description: 'Important meeting',
        location: 'Office Room A',
      });
      expect(ics).toContain('DESCRIPTION:Important meeting');
      expect(ics).toContain('LOCATION:Office Room A');
    });

    it('should include attendees', () => {
      const ics = build({
        uid: 'uid',
        summary: 'Event',
        start: '2026-03-01T10:00:00Z',
        end: '2026-03-01T11:00:00Z',
        attendees: ['alice@example.com', 'bob@example.com'],
      });
      expect(ics).toContain('ATTENDEE;RSVP=TRUE:mailto:alice@example.com');
      expect(ics).toContain('ATTENDEE;RSVP=TRUE:mailto:bob@example.com');
    });

    it('should include RRULE', () => {
      const ics = build({
        uid: 'uid',
        summary: 'Weekly',
        start: '2026-03-01T10:00:00Z',
        end: '2026-03-01T11:00:00Z',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      });
      expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    });
  });

  describe('formatICSDate', () => {
    const format = (iso: string) => (service as any).formatICSDate(iso);

    it('should format ISO to ICS datetime', () => {
      const result = format('2026-03-01T10:30:00.000Z');
      expect(result).toBe('20260301T103000Z');
    });
  });

  describe('formatICSDateOnly', () => {
    const format = (iso: string) => (service as any).formatICSDateOnly(iso);

    it('should format ISO to ICS date-only', () => {
      const result = format('2026-03-01T00:00:00Z');
      expect(result).toBe('20260301');
    });
  });

  describe('escapeICS', () => {
    const escape = (text: string) => (service as any).escapeICS(text);

    it('should escape backslashes', () => {
      expect(escape('a\\b')).toBe('a\\\\b');
    });

    it('should escape semicolons', () => {
      expect(escape('a;b')).toBe('a\\;b');
    });

    it('should escape commas', () => {
      expect(escape('a,b')).toBe('a\\,b');
    });

    it('should escape newlines', () => {
      expect(escape('a\nb')).toBe('a\\nb');
    });

    it('should handle multiple escapes', () => {
      expect(escape('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
    });
  });

  // ─── ICS Parsing ───

  describe('isAllDayEvent', () => {
    const check = (vevent: any) => (service as any).isAllDayEvent(vevent);

    it('should return true when dateOnly is set', () => {
      expect(check({ start: { dateOnly: true } })).toBe(true);
    });

    it('should return false when dateOnly is false', () => {
      expect(check({ start: { dateOnly: false } })).toBe(false);
    });

    it('should detect midnight as all-day fallback', () => {
      // Create a Date that is midnight in local timezone
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      expect(check({ start: midnight.toISOString() })).toBe(true);
    });

    it('should return false for non-midnight start', () => {
      const afternoon = new Date('2026-03-01T14:30:00Z');
      expect(check({ start: afternoon.toISOString() })).toBe(false);
    });

    it('should return false when no start', () => {
      expect(check({})).toBe(false);
    });
  });

  describe('extractAttendees', () => {
    const extract = (vevent: any) => (service as any).extractAttendees(vevent);

    it('should extract array of mailto attendees', () => {
      const result = extract({ attendee: ['mailto:a@b.com', 'mailto:c@d.com'] });
      expect(result).toEqual(['a@b.com', 'c@d.com']);
    });

    it('should extract single string attendee', () => {
      const result = extract({ attendee: 'mailto:x@y.com' });
      expect(result).toEqual(['x@y.com']);
    });

    it('should handle object attendees with val', () => {
      const result = extract({ attendee: [{ val: 'mailto:obj@test.com' }] });
      expect(result).toEqual(['obj@test.com']);
    });

    it('should return empty for no attendees', () => {
      expect(extract({})).toEqual([]);
    });
  });

  describe('extractOrganizer', () => {
    const extract = (vevent: any) => (service as any).extractOrganizer(vevent);

    it('should extract string organizer', () => {
      expect(extract({ organizer: 'mailto:org@test.com' })).toBe('org@test.com');
    });

    it('should extract object organizer with val', () => {
      expect(extract({ organizer: { val: 'mailto:org@test.com' } })).toBe('org@test.com');
    });

    it('should return undefined when no organizer', () => {
      expect(extract({})).toBeUndefined();
    });
  });

  // ─── Credentials ───

  describe('credential management', () => {
    it('should handle store/load when encryption unavailable', () => {
      service.storeCredential('test_key', 'secret');
      // With encryption unavailable, store may fail silently
      const result = (service as any).loadCredential('test_key');
      expect(result).toBeNull();
    });

    it('should clear credentials for connection', async () => {
      (service as any).credentialStore.set('calendar_c1_password', Buffer.from('x'));
      (service as any).credentialStore.set('calendar_c1_token', Buffer.from('y'));
      (service as any).credentialStore.set('calendar_c2_password', Buffer.from('z'));
      (service as any).clearCredentials('c1');
      expect((service as any).credentialStore.has('calendar_c1_password')).toBe(false);
      expect((service as any).credentialStore.has('calendar_c1_token')).toBe(false);
      expect((service as any).credentialStore.has('calendar_c2_password')).toBe(true);
    });
  });

  // ─── fetchEvents ───

  describe('fetchEvents', () => {
    it('should throw for inactive connection', async () => {
      await expect(service.fetchEvents({
        connectionId: 'nonexistent',
        start: new Date().toISOString(),
        end: new Date().toISOString(),
      })).rejects.toThrow();
    });
  });

  // ─── deleteEvent ───

  describe('deleteEvent', () => {
    it('should fail for inactive connection', async () => {
      const result = await service.deleteEvent('nonexistent', '/event.ics');
      expect(result.success).toBe(false);
    });
  });

  // ─── createEvent ───

  describe('createEvent', () => {
    it('should fail for inactive connection', async () => {
      const result = await service.createEvent({
        connectionId: 'nonexistent',
        summary: 'Test',
        start: '2026-03-01T10:00:00Z',
        end: '2026-03-01T11:00:00Z',
      });
      expect(result.success).toBe(false);
    });
  });
});
