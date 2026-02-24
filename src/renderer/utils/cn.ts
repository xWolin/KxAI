/**
 * Utility for combining CSS Module class names.
 *
 * Usage:
 *   cn(s.chatPanel, isActive && s.chatPanelActive, 'global-class')
 *   cn(s.chatMsg, s[`chatMsg${role}`])
 */
export function cn(...args: (string | false | null | undefined)[]): string {
  return args.filter(Boolean).join(' ');
}
