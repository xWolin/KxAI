/**
 * Shared system monitor types — used by both main process and renderer.
 */

export interface CpuInfo {
  model: string;
  cores: number;
  usagePercent: number;
  loadAvg: number[];
}

export interface MemoryInfo {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usagePercent: number;
}

export interface DiskInfo {
  mount: string;
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usagePercent: number;
}

export interface BatteryInfo {
  percent: number;
  charging: boolean;
  timeRemaining: string;
}

export interface NetworkInfo {
  connected: boolean;
  interfaces: { name: string; ip: string; mac: string }[];
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  osVersion: string;
  uptimeHours: number;
  nodeVersion: string;
  electronVersion: string;
}

export interface ProcessInfo {
  name: string;
  pid: number;
  cpuPercent: number;
  memoryMB: number;
}

export interface SystemSnapshot {
  timestamp: number;
  cpu: CpuInfo;
  memory: MemoryInfo;
  disk: DiskInfo[];
  battery: BatteryInfo | null;
  network: NetworkInfo;
  system: SystemInfo;
  topProcesses: ProcessInfo[];
}
