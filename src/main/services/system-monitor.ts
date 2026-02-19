import * as os from 'os';
import { exec } from 'child_process';

/**
 * SystemMonitor — daje agentowi świadomość stanu komputera.
 *
 * Monitoruje:
 * - CPU usage (per-core + total)
 * - RAM usage (used/total/percentage)
 * - Disk space (per-drive)
 * - Battery status (laptopy)
 * - Network connectivity
 * - Running processes (top N by CPU/memory)
 * - System uptime + info
 *
 * Dane są cachowane z TTL żeby nie odpytywać co chwilę.
 */

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

interface CpuInfo {
  model: string;
  cores: number;
  usagePercent: number;
  loadAvg: number[];
}

interface MemoryInfo {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usagePercent: number;
}

interface DiskInfo {
  mount: string;
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usagePercent: number;
}

interface BatteryInfo {
  percent: number;
  charging: boolean;
  timeRemaining: string;
}

interface NetworkInfo {
  connected: boolean;
  interfaces: { name: string; ip: string; mac: string }[];
}

interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  osVersion: string;
  uptimeHours: number;
  nodeVersion: string;
  electronVersion: string;
}

interface ProcessInfo {
  name: string;
  pid: number;
  cpuPercent: number;
  memoryMB: number;
}

// Cache for expensive operations
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class SystemMonitor {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private previousCpuTimes: { idle: number; total: number } | null = null;

  private readonly CACHE_TTL_MS = 5000; // 5s cache for most metrics
  private readonly PROCESS_CACHE_TTL_MS = 10000; // 10s for process list

  /**
   * Get a full system snapshot (cached).
   */
  async getSnapshot(): Promise<SystemSnapshot> {
    const [cpu, memory, disk, battery, network, topProcesses] = await Promise.all([
      this.getCpuInfo(),
      this.getMemoryInfo(),
      this.getDiskInfo(),
      this.getBatteryInfo(),
      this.getNetworkInfo(),
      this.getTopProcesses(10),
    ]);

    return {
      timestamp: Date.now(),
      cpu,
      memory,
      disk,
      battery,
      network,
      system: this.getSystemInfo(),
      topProcesses,
    };
  }

  /**
   * Get a compact status string for AI context injection.
   */
  async getStatusSummary(): Promise<string> {
    const snap = await this.getSnapshot();
    const parts: string[] = [];

    parts.push(`CPU: ${snap.cpu.usagePercent.toFixed(0)}% (${snap.cpu.cores} rdzeni)`);
    parts.push(`RAM: ${snap.memory.usedGB.toFixed(1)}/${snap.memory.totalGB.toFixed(1)} GB (${snap.memory.usagePercent.toFixed(0)}%)`);

    if (snap.disk.length > 0) {
      const mainDisk = snap.disk[0];
      parts.push(`Dysk: ${mainDisk.freeGB.toFixed(0)} GB wolne z ${mainDisk.totalGB.toFixed(0)} GB`);
    }

    if (snap.battery) {
      parts.push(`Bateria: ${snap.battery.percent}%${snap.battery.charging ? ' (ładowanie)' : ''}`);
    }

    parts.push(`Uptime: ${snap.system.uptimeHours.toFixed(1)}h`);
    parts.push(`Sieć: ${snap.network.connected ? 'połączono' : 'brak połączenia'}`);

    if (snap.topProcesses.length > 0) {
      const top3 = snap.topProcesses.slice(0, 3).map((p) => `${p.name}(${p.cpuPercent.toFixed(0)}%)`);
      parts.push(`Top procesy: ${top3.join(', ')}`);
    }

    return parts.join(' | ');
  }

  /**
   * Check for concerning system conditions and return warnings.
   */
  async getWarnings(): Promise<string[]> {
    const snap = await this.getSnapshot();
    const warnings: string[] = [];

    if (snap.cpu.usagePercent > 90) {
      warnings.push(`⚠️ CPU obciążone w ${snap.cpu.usagePercent.toFixed(0)}%`);
    }
    if (snap.memory.usagePercent > 85) {
      warnings.push(`⚠️ RAM: ${snap.memory.usagePercent.toFixed(0)}% użyte (${snap.memory.freeGB.toFixed(1)} GB wolne)`);
    }
    for (const disk of snap.disk) {
      if (disk.usagePercent > 90) {
        warnings.push(`⚠️ Dysk ${disk.mount}: ${disk.usagePercent.toFixed(0)}% pełny (${disk.freeGB.toFixed(1)} GB wolne)`);
      }
    }
    if (snap.battery && snap.battery.percent < 15 && !snap.battery.charging) {
      warnings.push(`🔋 Bateria krytycznie niska: ${snap.battery.percent}%`);
    }
    if (!snap.network.connected) {
      warnings.push('📡 Brak połączenia z internetem');
    }

    return warnings;
  }

  // ─── CPU ───

  async getCpuInfo(): Promise<CpuInfo> {
    const cached = this.getFromCache<CpuInfo>('cpu');
    if (cached) return cached;

    const cpus = os.cpus();
    const usagePercent = await this.measureCpuUsage();

    const result: CpuInfo = {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      usagePercent,
      loadAvg: os.loadavg(),
    };

    this.setCache('cpu', result);
    return result;
  }

  private async measureCpuUsage(): Promise<number> {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }

    if (this.previousCpuTimes) {
      const idleDelta = idle - this.previousCpuTimes.idle;
      const totalDelta = total - this.previousCpuTimes.total;
      this.previousCpuTimes = { idle, total };

      if (totalDelta === 0) return 0;
      return ((1 - idleDelta / totalDelta) * 100);
    }

    this.previousCpuTimes = { idle, total };
    // First call: wait 100ms and measure again
    await new Promise((r) => setTimeout(r, 100));
    return this.measureCpuUsage();
  }

  // ─── Memory ───

  getMemoryInfo(): MemoryInfo {
    const cached = this.getFromCache<MemoryInfo>('memory');
    if (cached) return cached;

    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    const result: MemoryInfo = {
      totalGB: totalBytes / (1024 ** 3),
      usedGB: usedBytes / (1024 ** 3),
      freeGB: freeBytes / (1024 ** 3),
      usagePercent: (usedBytes / totalBytes) * 100,
    };

    this.setCache('memory', result);
    return result;
  }

  // ─── Disk ───

  async getDiskInfo(): Promise<DiskInfo[]> {
    const cached = this.getFromCache<DiskInfo[]>('disk');
    if (cached) return cached;

    try {
      const result = await this.execCommand(
        process.platform === 'win32'
          ? 'wmic logicaldisk get size,freespace,caption /format:csv'
          : 'df -B1 --output=target,size,avail 2>/dev/null || df -k'
      );

      const disks = this.parseDiskOutput(result);
      this.setCache('disk', disks, 30000); // 30s cache for disk
      return disks;
    } catch {
      return [];
    }
  }

  private parseDiskOutput(output: string): DiskInfo[] {
    const disks: DiskInfo[] = [];

    if (process.platform === 'win32') {
      // Parse wmic CSV output
      const lines = output.trim().split('\n').filter((l) => l.trim());
      for (const line of lines.slice(1)) { // Skip header
        const parts = line.trim().split(',');
        if (parts.length >= 3) {
          const mount = parts[1]?.trim();
          const freeSpace = parseInt(parts[2]?.trim() || '0', 10);
          const size = parseInt(parts[3]?.trim() || '0', 10);
          if (mount && size > 0) {
            disks.push({
              mount,
              totalGB: size / (1024 ** 3),
              usedGB: (size - freeSpace) / (1024 ** 3),
              freeGB: freeSpace / (1024 ** 3),
              usagePercent: ((size - freeSpace) / size) * 100,
            });
          }
        }
      }
    } else {
      // Parse df output
      const lines = output.trim().split('\n').filter((l) => l.trim());
      for (const line of lines.slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const mount = parts[0];
          const size = parseInt(parts[1], 10);
          const avail = parseInt(parts[2], 10);
          if (mount && size > 0 && mount.startsWith('/')) {
            const totalBytes = size;
            const freeBytes = avail;
            disks.push({
              mount,
              totalGB: totalBytes / (1024 ** 3),
              usedGB: (totalBytes - freeBytes) / (1024 ** 3),
              freeGB: freeBytes / (1024 ** 3),
              usagePercent: ((totalBytes - freeBytes) / totalBytes) * 100,
            });
          }
        }
      }
    }

    return disks;
  }

  // ─── Battery ───

  async getBatteryInfo(): Promise<BatteryInfo | null> {
    const cached = this.getFromCache<BatteryInfo | null>('battery');
    if (cached !== undefined) return cached;

    try {
      if (process.platform === 'win32') {
        const output = await this.execCommand(
          'WMIC PATH Win32_Battery GET BatteryStatus,EstimatedChargeRemaining /FORMAT:CSV'
        );
        const lines = output.trim().split('\n').filter((l) => l.trim());
        if (lines.length > 1) {
          const parts = lines[1].trim().split(',');
          if (parts.length >= 3) {
            const status = parseInt(parts[1], 10);
            const percent = parseInt(parts[2], 10);
            const result: BatteryInfo = {
              percent,
              charging: status === 2 || status === 6,
              timeRemaining: 'N/A',
            };
            this.setCache('battery', result, 30000);
            return result;
          }
        }
      } else if (process.platform === 'darwin') {
        const output = await this.execCommand('pmset -g batt');
        const percentMatch = output.match(/(\d+)%/);
        const charging = output.includes('AC Power') || output.includes('charging');
        if (percentMatch) {
          const result: BatteryInfo = {
            percent: parseInt(percentMatch[1], 10),
            charging,
            timeRemaining: 'N/A',
          };
          this.setCache('battery', result, 30000);
          return result;
        }
      } else {
        // Linux
        const output = await this.execCommand('cat /sys/class/power_supply/BAT0/capacity 2>/dev/null && cat /sys/class/power_supply/BAT0/status 2>/dev/null');
        const lines = output.trim().split('\n');
        if (lines.length >= 2) {
          const result: BatteryInfo = {
            percent: parseInt(lines[0], 10),
            charging: lines[1].toLowerCase().includes('charging'),
            timeRemaining: 'N/A',
          };
          this.setCache('battery', result, 30000);
          return result;
        }
      }
    } catch {
      // No battery (desktop PC)
    }

    this.setCache('battery', null, 60000);
    return null;
  }

  // ─── Network ───

  getNetworkInfo(): NetworkInfo {
    const cached = this.getFromCache<NetworkInfo>('network');
    if (cached) return cached;

    const interfaces = os.networkInterfaces();
    const active: NetworkInfo['interfaces'] = [];
    let connected = false;

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (!addr.internal && addr.family === 'IPv4') {
          active.push({ name, ip: addr.address, mac: addr.mac });
          connected = true;
        }
      }
    }

    const result: NetworkInfo = { connected, interfaces: active };
    this.setCache('network', result);
    return result;
  }

  // ─── Processes ───

  async getTopProcesses(limit: number = 10): Promise<ProcessInfo[]> {
    const cached = this.getFromCache<ProcessInfo[]>('processes');
    if (cached) return cached;

    try {
      let output: string;
      if (process.platform === 'win32') {
        output = await this.execCommand(
          `powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First ${limit} Name,Id,CPU,@{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Csv -NoTypeInformation"`
        );
      } else {
        output = await this.execCommand(
          `ps aux --sort=-%cpu | head -n ${limit + 1}`
        );
      }

      const processes = this.parseProcessOutput(output, limit);
      this.setCache('processes', processes, this.PROCESS_CACHE_TTL_MS);
      return processes;
    } catch {
      return [];
    }
  }

  private parseProcessOutput(output: string, limit: number): ProcessInfo[] {
    const processes: ProcessInfo[] = [];
    const lines = output.trim().split('\n').filter((l) => l.trim());

    if (process.platform === 'win32') {
      // Parse CSV from PowerShell
      for (const line of lines.slice(1)) { // Skip header
        const match = line.match(/"([^"]*)","(\d+)","([^"]*)","([^"]*)"/);
        if (match) {
          processes.push({
            name: match[1],
            pid: parseInt(match[2], 10),
            cpuPercent: parseFloat(match[3]) || 0,
            memoryMB: parseFloat(match[4]) || 0,
          });
        }
      }
    } else {
      // Parse ps aux
      for (const line of lines.slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          processes.push({
            name: parts[10].split('/').pop() || parts[10],
            pid: parseInt(parts[1], 10),
            cpuPercent: parseFloat(parts[2]) || 0,
            memoryMB: (parseFloat(parts[5]) || 0) / 1024, // RSS in KB → MB
          });
        }
      }
    }

    return processes.slice(0, limit);
  }

  // ─── System Info ───

  getSystemInfo(): SystemInfo {
    return {
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      osVersion: os.version?.() || os.release(),
      uptimeHours: os.uptime() / 3600,
      nodeVersion: process.version,
      electronVersion: process.versions.electron || 'N/A',
    };
  }

  // ─── Cache Helpers ───

  private getFromCache<T>(key: string, ttl?: number): T | undefined {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < (ttl || this.CACHE_TTL_MS)) {
      return entry.data as T;
    }
    return undefined;
  }

  private setCache<T>(key: string, data: T, ttl?: number): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // ─── Exec Helper ───

  private execCommand(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 10000, maxBuffer: 512 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  }
}
