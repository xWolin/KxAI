/**
 * Shared automation types — used by both main process and renderer.
 */

export interface AutomationStatus {
  enabled: boolean;
  safetyLocked: boolean;
  takeControlActive: boolean;
}
