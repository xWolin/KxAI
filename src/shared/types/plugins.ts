/**
 * Shared plugin types — used by both main process and renderer.
 */

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  toolCount: number;
  tools: string[];
}
