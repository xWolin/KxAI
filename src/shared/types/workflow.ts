/**
 * Shared workflow / activity types — used by both main process and renderer.
 */

export interface ActivityEntry {
  timestamp: number;
  hour: number;
  dayOfWeek: number; // 0=Sun, 6=Sat
  action: string;
  context: string;
  category: string;
}

export interface WorkflowPattern {
  id: string;
  description: string;
  timeRange: { startHour: number; endHour: number };
  daysOfWeek: number[];
  frequency: number; // how many times observed
  lastSeen: number;
  suggestedCron?: string;
  acknowledged: boolean;
}
