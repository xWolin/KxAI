/**
 * Calendar types — CalDAV integration (Faza 8.2)
 * Obsługuje Google Calendar, iCloud, Nextcloud i inne CalDAV providery.
 */

/** Supported calendar providers */
export type CalendarProvider = 'google' | 'icloud' | 'nextcloud' | 'caldav' | 'ics';

/** Auth method for CalDAV connection */
export type CalendarAuthMethod = 'Basic' | 'OAuth' | 'Bearer';

/** Calendar connection configuration */
export interface CalendarConfig {
  /** Unique ID of this calendar connection */
  id: string;
  /** Display name */
  name: string;
  /** Provider type */
  provider: CalendarProvider;
  /** CalDAV server URL */
  serverUrl: string;
  /** Auth method */
  authMethod: CalendarAuthMethod;
  /** Username (email for Google/iCloud) */
  username: string;
  /** Whether this connection is enabled */
  enabled: boolean;
  /** Selected calendar IDs to sync (empty = all) */
  selectedCalendars?: string[];
  /** Last sync timestamp */
  lastSync?: number;
  /** Google OAuth: client ID */
  googleClientId?: string;
  /** Google OAuth: client secret — stored in safeStorage */
  googleClientSecret?: string;
}

/** Calendar info returned from CalDAV discovery */
export interface CalendarInfo {
  /** Calendar URL (unique identifier) */
  url: string;
  /** Display name */
  displayName: string;
  /** Calendar color (hex) */
  color?: string;
  /** Calendar description */
  description?: string;
  /** Calendar timezone */
  timezone?: string;
  /** ctag for change detection */
  ctag?: string;
  /** sync token for incremental sync */
  syncToken?: string;
}

/** Parsed calendar event */
export interface CalendarEvent {
  /** Event UID (from ICS) */
  uid: string;
  /** Event summary/title */
  summary: string;
  /** Event start time (ISO 8601) */
  start: string;
  /** Event end time (ISO 8601) */
  end: string;
  /** All-day event */
  allDay: boolean;
  /** Event description */
  description?: string;
  /** Event location */
  location?: string;
  /** Attendees */
  attendees?: string[];
  /** Organizer */
  organizer?: string;
  /** Recurrence rule (RRULE) */
  rrule?: string;
  /** Event status */
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** Calendar URL this event belongs to */
  calendarUrl?: string;
  /** Calendar display name */
  calendarName?: string;
  /** Event URL (for update/delete) */
  eventUrl?: string;
  /** ETag (for update/delete) */
  etag?: string;
  /** Raw ICS data */
  rawICS?: string;
}

/** Calendar connection status */
export type CalendarConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'syncing';

/** Calendar service status pushed to renderer */
export interface CalendarStatus {
  /** Per-connection status */
  connections: Array<{
    id: string;
    name: string;
    provider: CalendarProvider;
    serverUrl: string;
    status: CalendarConnectionStatus;
    error?: string;
    lastSync?: number;
    calendarCount?: number;
    eventCount?: number;
  }>;
}

/** Options for fetching events */
export interface FetchEventsOptions {
  /** Connection ID (if omitted, fetch from all) */
  connectionId?: string;
  /** Calendar URL (if omitted, fetch from all calendars) */
  calendarUrl?: string;
  /** Start of time range (ISO 8601) */
  start: string;
  /** End of time range (ISO 8601) */
  end: string;
}

/** Options for creating an event */
export interface CreateEventOptions {
  /** Connection ID to create the event in */
  connectionId: string;
  /** Calendar URL (if omitted, uses first calendar) */
  calendarUrl?: string;
  /** Event summary/title */
  summary: string;
  /** Start time (ISO 8601) */
  start: string;
  /** End time (ISO 8601) */
  end: string;
  /** All-day event */
  allDay?: boolean;
  /** Event description */
  description?: string;
  /** Event location */
  location?: string;
  /** Attendees (email addresses) */
  attendees?: string[];
  /** Recurrence rule (RRULE string, e.g. "FREQ=WEEKLY;COUNT=10") */
  rrule?: string;
}

/** Result of a calendar operation */
export interface CalendarOperationResult {
  success: boolean;
  message: string;
  event?: CalendarEvent;
  connectionId?: string;
}
