/**
 * Tests for SystemMonitor â€” system state monitoring service.
 * Covers: parseDiskOutput, parseProcessOutput, getMemoryInfo,
 * getNetworkInfo, getSystemInfo, cache, getWarnings, getStatusSummary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  exec: vi.fn((cmd: string, opts: any, cb: Function) => {
    cb(null, '', '');
  }),
}));

// Mock os module so we can control its return values
vi.mock('os', () => ({
  totalmem: vi.fn(() => 16 * 1024 ** 3),
  freemem: vi.fn(() => 4 * 1024 ** 3),
  cpus: vi.fn(() => [
    { model: 'Test CPU', times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } },
  ]),
  loadavg: vi.fn(() => [1.5, 1.2, 1.0]),
  hostname: vi.fn(() => 'test-machine'),
  platform: vi.fn(() => 'win32'),
  release: vi.fn(() => '10.0.19045'),
  arch: vi.fn(() => 'x64'),
  version: vi.fn(() => 'Windows 10 Pro'),
  uptime: vi.fn(() => 3600),
  networkInterfaces: vi.fn(() => ({
    eth0: [
      { address: '192.168.1.100', family: 'IPv4', internal: false, mac: 'aa:bb:cc:dd:ee:ff' },
    ],
  })),
}));

import * as os from 'os';
const osMock = os as any;

import { SystemMonitor } from '@main/services/system-monitor';

// â”€â”€â”€ Tests â”€â”€â”€

describe('SystemMonitor', () => {
  let monitor: SystemMonitor;

  beforeEach(() => {
    monitor = new SystemMonitor();
    // Clear cache between tests
    (monitor as any).cache.clear();
    (monitor as any).previousCpuTimes = null;
  });

  // â”€â”€â”€ parseDiskOutput â”€â”€â”€

  describe('parseDiskOutput (private)', () => {
    const parse = (output: string, unit?: number) =>
      (monitor as any).parseDiskOutput(output, unit ?? 1);

    const isWindows = process.platform === 'win32';

    // Windows-specific: wmic CSV format
    it.runIf(isWindows)('parses Windows CSV output', () => {
      const output = [
        'DeviceId,Caption,FreeSpace,Size',
        'C:,C:,100000000000,500000000000',
        'D:,D:,200000000000,1000000000000',
      ].join('\n');

      const disks = parse(output, 1);
      expect(disks).toHaveLength(2);
      expect(disks[0].mount).toBe('C:');
      expect(disks[0].freeGB).toBeCloseTo(100000000000 / 1024 ** 3, 1);
    });

    // Linux-specific: df format
    it.runIf(!isWindows)('parses Linux df output', () => {
      const output = [
        'Filesystem     1B-blocks      Available Mounted',
        '/dev/sda1      500000000000   100000000000 /',
        '/dev/sdb1      1000000000000  200000000000 /home',
      ].join('\n');

      const disks = parse(output, 1);
      expect(disks).toHaveLength(2);
      expect(disks[0].mount).toBe('/dev/sda1');
      expect(disks[0].freeGB).toBeCloseTo(100000000000 / 1024 ** 3, 1);
    });

    it('handles empty output', () => {
      const disks = parse('');
      expect(disks).toHaveLength(0);
    });

    it.runIf(isWindows)('skips entries with zero size (Windows)', () => {
      const output = [
        'DeviceId,Caption,FreeSpace,Size',
        'X:,X:,0,0',
      ].join('\n');
      const disks = parse(output, 1);
      expect(disks).toHaveLength(0);
    });

    it.runIf(!isWindows)('skips entries not starting with / (Linux)', () => {
      const output = [
        'Filesystem     1B-blocks      Available Mounted',
        'tmpfs          1000000        500000 tmpfs-mount',
      ].join('\n');
      // tmpfs doesn't start with /, but the mount field (parts[0]) does not start with /
      // Actually on Linux the code checks mount.startsWith('/') where mount = parts[0]
      // tmpfs doesn't start with / so it's skipped
      const disks = parse(output, 1);
      expect(disks).toHaveLength(0);
    });
  });

  // â”€â”€â”€ parseProcessOutput â”€â”€â”€

  describe('parseProcessOutput (private)', () => {
    const parseFn = (output: string, limit: number) =>
      (monitor as any).parseProcessOutput(output, limit);

    const isWindows = process.platform === 'win32';

    // Windows-specific: PowerShell CSV format
    it.runIf(isWindows)('parses Windows PowerShell CSV', () => {
      const output = [
        '"Name","Id","CpuPct","MemMB"',
        '"chrome","1234","15.5","512.3"',
        '"code","5678","10.2","1024.1"',
      ].join('\n');

      const procs = parseFn(output, 10);
      expect(procs).toHaveLength(2);
      expect(procs[0].name).toBe('chrome');
      expect(procs[0].pid).toBe(1234);
      expect(procs[0].cpuPercent).toBe(15.5);
      expect(procs[0].memoryMB).toBe(512.3);
      expect(procs[1].name).toBe('code');
    });

    // Linux-specific: ps aux format
    it.runIf(!isWindows)('parses Linux ps aux output', () => {
      // ps aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      const output = [
        'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
        'root         1  0.5  0.1  12345  5120 ?        Ss   Jan01   1:23 /sbin/init',
        'user      1234 15.5  2.3  98765 524288 ?       Sl   10:00   5:00 /usr/bin/chrome',
      ].join('\n');

      const procs = parseFn(output, 10);
      expect(procs).toHaveLength(2);
      expect(procs[0].name).toBe('init');
      expect(procs[0].pid).toBe(1);
      expect(procs[0].cpuPercent).toBe(0.5);
      expect(procs[0].memoryMB).toBeCloseTo(5120 / 1024, 1);
      expect(procs[1].name).toBe('chrome');
    });

    it.runIf(isWindows)('respects limit (Windows)', () => {
      const lines = ['"Name","Id","CpuPct","MemMB"'];
      for (let i = 0; i < 20; i++) {
        lines.push(`"proc${i}","${i}","1.0","100.0"`);
      }
      const procs = parseFn(lines.join('\n'), 5);
      expect(procs).toHaveLength(5);
    });

    it.runIf(!isWindows)('respects limit (Linux)', () => {
      const lines = ['USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND'];
      for (let i = 0; i < 20; i++) {
        lines.push(`user    ${i}  1.0  0.5  1000  ${(i + 1) * 1024} ?  Sl  10:00  0:01 /usr/bin/proc${i}`);
      }
      const procs = parseFn(lines.join('\n'), 5);
      expect(procs).toHaveLength(5);
    });

    it('handles empty output', () => {
      expect(parseFn('', 10)).toHaveLength(0);
    });
  });

  // â”€â”€â”€ getMemoryInfo â”€â”€â”€

  describe('getMemoryInfo', () => {
    it('returns memory info from os module', () => {
      osMock.totalmem.mockReturnValue(16 * 1024 ** 3);
      osMock.freemem.mockReturnValue(4 * 1024 ** 3);

      const info = monitor.getMemoryInfo();
      expect(info.totalGB).toBeCloseTo(16, 0);
      expect(info.freeGB).toBeCloseTo(4, 0);
      expect(info.usedGB).toBeCloseTo(12, 0);
      expect(info.usagePercent).toBeCloseTo(75, 0);
    });

    it('caches result', () => {
      osMock.totalmem.mockReturnValue(16 * 1024 ** 3);
      osMock.freemem.mockReturnValue(4 * 1024 ** 3);

      const first = monitor.getMemoryInfo();
      // Change mock â€” should still return cached value
      osMock.freemem.mockReturnValue(8 * 1024 ** 3);
      const second = monitor.getMemoryInfo();

      expect(second.freeGB).toBe(first.freeGB); // cached
    });
  });

  // â”€â”€â”€ getNetworkInfo â”€â”€â”€

  describe('getNetworkInfo', () => {
    it('detects connected state from external IPv4', () => {
      osMock.networkInterfaces.mockReturnValue({
        eth0: [
          { address: '192.168.1.100', family: 'IPv4', internal: false, mac: 'aa:bb:cc:dd:ee:ff' },
        ],
        lo: [
          { address: '127.0.0.1', family: 'IPv4', internal: true, mac: '00:00:00:00:00:00' },
        ],
      });

      const info = monitor.getNetworkInfo();
      expect(info.connected).toBe(true);
      expect(info.interfaces).toHaveLength(1);
      expect(info.interfaces[0].name).toBe('eth0');
      expect(info.interfaces[0].ip).toBe('192.168.1.100');
    });

    it('returns disconnected when only internal interfaces', () => {
      osMock.networkInterfaces.mockReturnValue({
        lo: [
          { address: '127.0.0.1', family: 'IPv4', internal: true, mac: '00:00:00:00:00:00' },
        ],
      });

      const info = monitor.getNetworkInfo();
      expect(info.connected).toBe(false);
      expect(info.interfaces).toHaveLength(0);
    });
  });

  // â”€â”€â”€ getSystemInfo â”€â”€â”€

  describe('getSystemInfo', () => {
    it('returns system properties', () => {
      osMock.hostname.mockReturnValue('test-machine');
      osMock.platform.mockReturnValue('win32');
      osMock.release.mockReturnValue('10.0.19045');
      osMock.arch.mockReturnValue('x64');
      osMock.uptime.mockReturnValue(3600);
      osMock.version.mockReturnValue('Windows 10 Pro');

      const info = monitor.getSystemInfo();
      expect(info.hostname).toBe('test-machine');
      expect(info.platform).toContain('win32');
      expect(info.arch).toBe('x64');
      expect(info.uptimeHours).toBeCloseTo(1, 1);
      expect(info.nodeVersion).toBe(process.version);
    });
  });

  // â”€â”€â”€ Cache â”€â”€â”€

  describe('cache', () => {
    it('setCache / getFromCache works', () => {
      (monitor as any).setCache('test', { value: 42 });
      expect((monitor as any).getFromCache('test')).toEqual({ value: 42 });
    });

    it('cache expires after TTL', () => {
      (monitor as any).setCache('test', { value: 42 }, 0); // 0ms TTL
      // Immediately expired
      expect((monitor as any).getFromCache('test')).toBeUndefined();
    });

    it('getFromCache returns undefined for missing key', () => {
      expect((monitor as any).getFromCache('nonexistent')).toBeUndefined();
    });
  });

  // â”€â”€â”€ getWarnings â”€â”€â”€

  describe('getWarnings', () => {
    it('returns empty array for healthy system', async () => {
      // Override getSnapshot to return healthy values
      vi.spyOn(monitor, 'getSnapshot').mockResolvedValue({
        timestamp: Date.now(),
        cpu: { model: 'test', cores: 4, usagePercent: 20, loadAvg: [1, 1, 1] },
        memory: { totalGB: 16, usedGB: 8, freeGB: 8, usagePercent: 50 },
        disk: [{ mount: 'C:', totalGB: 500, usedGB: 200, freeGB: 300, usagePercent: 40 }],
        battery: { percent: 80, charging: false, timeRemaining: 'N/A' },
        network: { connected: true, interfaces: [] },
        system: { hostname: 'test', platform: 'win32', arch: 'x64', osVersion: '10', uptimeHours: 1, nodeVersion: 'v20', electronVersion: 'N/A' },
        topProcesses: [],
      });

      const warnings = await monitor.getWarnings();
      expect(warnings).toHaveLength(0);
    });

    it('warns on high CPU', async () => {
      vi.spyOn(monitor, 'getSnapshot').mockResolvedValue({
        timestamp: Date.now(),
        cpu: { model: 'test', cores: 4, usagePercent: 95, loadAvg: [4, 4, 4] },
        memory: { totalGB: 16, usedGB: 8, freeGB: 8, usagePercent: 50 },
        disk: [],
        battery: null,
        network: { connected: true, interfaces: [] },
        system: { hostname: 'test', platform: 'win32', arch: 'x64', osVersion: '10', uptimeHours: 1, nodeVersion: 'v20', electronVersion: 'N/A' },
        topProcesses: [],
      });

      const warnings = await monitor.getWarnings();
      expect(warnings.some((w: string) => w.includes('CPU'))).toBe(true);
    });

    it('warns on high memory', async () => {
      vi.spyOn(monitor, 'getSnapshot').mockResolvedValue({
        timestamp: Date.now(),
        cpu: { model: 'test', cores: 4, usagePercent: 10, loadAvg: [1, 1, 1] },
        memory: { totalGB: 16, usedGB: 14, freeGB: 2, usagePercent: 90 },
        disk: [],
        battery: null,
        network: { connected: true, interfaces: [] },
        system: { hostname: 'test', platform: 'win32', arch: 'x64', osVersion: '10', uptimeHours: 1, nodeVersion: 'v20', electronVersion: 'N/A' },
        topProcesses: [],
      });

      const warnings = await monitor.getWarnings();
      expect(warnings.some((w: string) => w.includes('RAM'))).toBe(true);
    });

    it('warns on disk full', async () => {
      vi.spyOn(monitor, 'getSnapshot').mockResolvedValue({
        timestamp: Date.now(),
        cpu: { model: 'test', cores: 4, usagePercent: 10, loadAvg: [1, 1, 1] },
        memory: { totalGB: 16, usedGB: 8, freeGB: 8, usagePercent: 50 },
        disk: [{ mount: 'C:', totalGB: 500, usedGB: 475, freeGB: 25, usagePercent: 95 }],
        battery: null,
        network: { connected: true, interfaces: [] },
        system: { hostname: 'test', platform: 'win32', arch: 'x64', osVersion: '10', uptimeHours: 1, nodeVersion: 'v20', electronVersion: 'N/A' },
        topProcesses: [],
      });

      const warnings = await monitor.getWarnings();
      expect(warnings.some((w: string) => w.includes('Dysk'))).toBe(true);
    });

    it('warns on low battery', async () => {
      vi.spyOn(monitor, 'getSnapshot').mockResolvedValue({
        timestamp: Date.now(),
        cpu: { model: 'test', cores: 4, usagePercent: 10, loadAvg: [1, 1, 1] },
        memory: { totalGB: 16, usedGB: 8, freeGB: 8, usagePercent: 50 },
        disk: [],
        battery: { percent: 10, charging: false, timeRemaining: 'N/A' },
        network: { connected: true, interfaces: [] },
        system: { hostname: 'test', platform: 'win32', arch: 'x64', osVersion: '10', uptimeHours: 1, nodeVersion: 'v20', electronVersion: 'N/A' },
        topProcesses: [],
      });

      const warnings = await monitor.getWarnings();
      expect(warnings.some((w: string) => w.includes('Bateria'))).toBe(true);
    });

    it('warns on no network', async () => {
      vi.spyOn(monitor, 'getSnapshot').mockResolvedValue({
        timestamp: Date.now(),
        cpu: { model: 'test', cores: 4, usagePercent: 10, loadAvg: [1, 1, 1] },
        memory: { totalGB: 16, usedGB: 8, freeGB: 8, usagePercent: 50 },
        disk: [],
        battery: null,
        network: { connected: false, interfaces: [] },
        system: { hostname: 'test', platform: 'win32', arch: 'x64', osVersion: '10', uptimeHours: 1, nodeVersion: 'v20', electronVersion: 'N/A' },
        topProcesses: [],
      });

      const warnings = await monitor.getWarnings();
      expect(warnings.some((w: string) => w.includes('internet') || w.includes('poÅ‚Ä…czenia'))).toBe(true);
    });

    it('no battery warning when charging', async () => {
      vi.spyOn(monitor, 'getSnapshot').mockResolvedValue({
        timestamp: Date.now(),
        cpu: { model: 'test', cores: 4, usagePercent: 10, loadAvg: [1, 1, 1] },
        memory: { totalGB: 16, usedGB: 8, freeGB: 8, usagePercent: 50 },
        disk: [],
        battery: { percent: 10, charging: true, timeRemaining: 'N/A' },
        network: { connected: true, interfaces: [] },
        system: { hostname: 'test', platform: 'win32', arch: 'x64', osVersion: '10', uptimeHours: 1, nodeVersion: 'v20', electronVersion: 'N/A' },
        topProcesses: [],
      });

      const warnings = await monitor.getWarnings();
      expect(warnings.some((w: string) => w.includes('Bateria'))).toBe(false);
    });
  });

  // â”€â”€â”€ getStatusSummary â”€â”€â”€

  describe('getStatusSummary', () => {
    it('returns formatted status string', async () => {
      vi.spyOn(monitor, 'getSnapshot').mockResolvedValue({
        timestamp: Date.now(),
        cpu: { model: 'test', cores: 8, usagePercent: 30, loadAvg: [2, 2, 2] },
        memory: { totalGB: 32, usedGB: 16, freeGB: 16, usagePercent: 50 },
        disk: [{ mount: 'C:', totalGB: 1000, usedGB: 600, freeGB: 400, usagePercent: 60 }],
        battery: { percent: 75, charging: true, timeRemaining: 'N/A' },
        network: { connected: true, interfaces: [] },
        system: { hostname: 'test', platform: 'win32', arch: 'x64', osVersion: '10', uptimeHours: 5.5, nodeVersion: 'v20', electronVersion: 'N/A' },
        topProcesses: [
          { name: 'chrome', pid: 1, cpuPercent: 15, memoryMB: 500 },
          { name: 'code', pid: 2, cpuPercent: 10, memoryMB: 300 },
          { name: 'node', pid: 3, cpuPercent: 5, memoryMB: 200 },
        ],
      });

      const summary = await monitor.getStatusSummary();
      expect(summary).toContain('CPU: 30%');
      expect(summary).toContain('8 rdzeni');
      expect(summary).toContain('RAM:');
      expect(summary).toContain('400 GB wolne');
      expect(summary).toContain('Bateria: 75%');
      expect(summary).toContain('ładowanie');
      expect(summary).toContain('Sieć: połączono');
      expect(summary).toContain('chrome');
    });

    it('shows disconnected network', async () => {
      vi.spyOn(monitor, 'getSnapshot').mockResolvedValue({
        timestamp: Date.now(),
        cpu: { model: 'test', cores: 4, usagePercent: 10, loadAvg: [1, 1, 1] },
        memory: { totalGB: 16, usedGB: 8, freeGB: 8, usagePercent: 50 },
        disk: [],
        battery: null,
        network: { connected: false, interfaces: [] },
        system: { hostname: 'test', platform: 'win32', arch: 'x64', osVersion: '10', uptimeHours: 1, nodeVersion: 'v20', electronVersion: 'N/A' },
        topProcesses: [],
      });

      const summary = await monitor.getStatusSummary();
      expect(summary).toContain('brak połączenia');
    });
  });
});

