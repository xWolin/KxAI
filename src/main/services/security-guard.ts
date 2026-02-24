import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

/**
 * SecurityGuard — warstwa bezpieczeństwa dla wszystkich operacji agenta.
 *
 * Zabezpieczenia:
 * 1. Command injection prevention — blacklist niebezpiecznych komend
 * 2. Path validation — blokada dostępu do krytycznych ścieżek systemowych
 * 3. Rate limiting — limity na automatyczne akcje
 * 4. Audit log — zapis wszystkich destrukcyjnych operacji
 * 5. Input sanitization — walidacja parametrów narzędzi
 */

// Re-export from shared types (canonical source)
export type { AuditEntry } from '../../shared/types/security';
import type { AuditEntry } from '../../shared/types/security';

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

interface SecurityConfig {
  enableAuditLog: boolean;
  maxAuditEntries: number;
  commandRateLimit: number;        // Max shell commands per minute
  fileWriteRateLimit: number;      // Max file writes per minute
  automationRateLimit: number;     // Max automation actions per minute
  browserRateLimit: number;        // Max browser actions per minute
  allowedWritePaths: string[];     // Whitelisted write paths (glob-like)
  blockedCommands: string[];       // Blacklisted command patterns
}

// Commands that should NEVER be executed by an AI agent
const DANGEROUS_COMMANDS = [
  // Destructive
  'rm -rf /',
  'del /f /s /q c:',
  'format c:',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',  // fork bomb
  // Privilege escalation
  'chmod 777 /',
  'chmod -R 777',
  'chown -R',
  // Network exfiltration
  'curl.*|.*bash',
  'wget.*|.*sh',
  'nc -e',
  'ncat -e',
  // Registry destruction (Windows)
  'reg delete.*HKLM',
  'reg delete.*HKCU',
  // PowerShell dangerous
  'Remove-Item.*-Recurse.*-Force.*C:\\\\',
  'Remove-Item.*-Recurse.*-Force.*/',
  'Stop-Computer',
  'Restart-Computer',
  'Clear-RecycleBin',
  // Credential theft
  'mimikatz',
  'procdump.*lsass',
  'sekurlsa',
  // Crypto mining
  'xmrig',
  'minerd',
  'cpuminer',
];

// Paths that should NEVER be written to
const PROTECTED_PATHS_WIN = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData\\Microsoft',
];

const PROTECTED_PATHS_UNIX = [
  '/bin',
  '/sbin',
  '/usr/bin',
  '/usr/sbin',
  '/boot',
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/System',
  '/Library/LaunchDaemons',
];

export class SecurityGuard {
  private config: SecurityConfig;
  private auditLog: AuditEntry[] = [];
  private rateLimits: Map<string, RateLimitBucket> = new Map();
  private auditFilePath: string;

  constructor(config?: Partial<SecurityConfig>) {
    const userDataPath = app.getPath('userData');
    this.auditFilePath = path.join(userDataPath, 'workspace', 'audit-log.json');

    this.config = {
      enableAuditLog: config?.enableAuditLog ?? true,
      maxAuditEntries: config?.maxAuditEntries ?? 5000,
      commandRateLimit: config?.commandRateLimit ?? 10,
      fileWriteRateLimit: config?.fileWriteRateLimit ?? 30,
      automationRateLimit: config?.automationRateLimit ?? 60,
      browserRateLimit: config?.browserRateLimit ?? 20,
      allowedWritePaths: config?.allowedWritePaths ?? [],
      blockedCommands: config?.blockedCommands ?? [],
    };

    this.loadAuditLog();
  }

  // ─── Command Validation ───

  /**
   * Validate a shell command before execution.
   * Returns { allowed, reason } — if not allowed, explains why.
   */
  validateCommand(command: string): { allowed: boolean; reason?: string } {
    const normalized = command.toLowerCase().trim();

    // Check against dangerous command patterns
    const allBlocked = [...DANGEROUS_COMMANDS, ...this.config.blockedCommands];
    for (const pattern of allBlocked) {
      // Guard against ReDoS from user-supplied patterns
      if (!this.isSafeRegexPattern(pattern)) {
        // Fall back to substring match for unsafe/too-long patterns
        if (normalized.includes(pattern.toLowerCase())) {
          this.audit('shell_command', { command }, 'tool', 'blocked', `Zablokowana komenda: zawiera "${pattern}"`);
          return { allowed: false, reason: `Komenda zablokowana ze względów bezpieczeństwa` };
        }
        continue;
      }

      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(normalized)) {
          this.audit('shell_command', { command }, 'tool', 'blocked', `Zablokowana komenda: pasuje do wzorca "${pattern}"`);
          return { allowed: false, reason: `Komenda zablokowana ze względów bezpieczeństwa (wzorzec: ${pattern})` };
        }
      } catch {
        // If pattern isn't valid regex, do exact substring match
        if (normalized.includes(pattern.toLowerCase())) {
          this.audit('shell_command', { command }, 'tool', 'blocked', `Zablokowana komenda: zawiera "${pattern}"`);
          return { allowed: false, reason: `Komenda zablokowana ze względów bezpieczeństwa` };
        }
      }
    }

    // Rate limit check
    if (!this.checkRateLimit('command', this.config.commandRateLimit)) {
      this.audit('shell_command', { command }, 'tool', 'rate-limited', 'Przekroczono limit komend/minutę');
      return { allowed: false, reason: `Zbyt wiele komend w krótkim czasie (limit: ${this.config.commandRateLimit}/min)` };
    }

    this.audit('shell_command', { command: command.slice(0, 200) }, 'tool', 'allowed');
    return { allowed: true };
  }

  // ─── Path Validation ───

  /**
   * Validate a file path before write operations.
   */
  validateWritePath(filePath: string): { allowed: boolean; reason?: string } {
    const resolved = path.resolve(filePath);
    const normalized = resolved.replace(/\\/g, '/').toLowerCase();

    // Check protected system paths
    const protectedPaths = process.platform === 'win32' ? PROTECTED_PATHS_WIN : PROTECTED_PATHS_UNIX;
    for (const pp of protectedPaths) {
      const normalizedPP = pp.replace(/\\/g, '/').toLowerCase();
      if (normalized.startsWith(normalizedPP)) {
        this.audit('file_write', { path: filePath }, 'tool', 'blocked', `Chroniona ścieżka systemowa: ${pp}`);
        return { allowed: false, reason: `Zapis do ${pp} jest zablokowany — chroniona ścieżka systemowa` };
      }
    }

    // Check path traversal attempts
    if (filePath.includes('..')) {
      const workspace = path.join(app.getPath('userData'), 'workspace');
      if (!resolved.startsWith(workspace)) {
        // Allow path traversal outside workspace only to user home and below
        const home = app.getPath('home');
        if (!resolved.startsWith(home)) {
          this.audit('file_write', { path: filePath }, 'tool', 'blocked', 'Path traversal poza katalog domowy');
          return { allowed: false, reason: 'Zapis poza katalogiem domowym jest zablokowany' };
        }
      }
    }

    // Rate limit
    if (!this.checkRateLimit('file_write', this.config.fileWriteRateLimit)) {
      this.audit('file_write', { path: filePath }, 'tool', 'rate-limited');
      return { allowed: false, reason: `Zbyt wiele operacji zapisu (limit: ${this.config.fileWriteRateLimit}/min)` };
    }

    this.audit('file_write', { path: filePath.slice(0, 200) }, 'tool', 'allowed');
    return { allowed: true };
  }

  /**
   * Validate a read path (more permissive than write).
   */
  validateReadPath(filePath: string): { allowed: boolean; reason?: string } {
    const resolved = path.resolve(filePath);

    // Block reading sensitive credential files
    const sensitiveFiles = [
      '/etc/shadow',
      '/etc/sudoers',
      '.ssh/id_rsa',
      '.ssh/id_ed25519',
      '.aws/credentials',
      '.npmrc',
      '.env',
    ];

    for (const sf of sensitiveFiles) {
      if (resolved.replace(/\\/g, '/').endsWith(sf)) {
        this.audit('file_read', { path: filePath }, 'tool', 'blocked', `Plik wrażliwy: ${sf}`);
        return { allowed: false, reason: `Odczyt ${sf} jest zablokowany — plik wrażliwy` };
      }
    }

    return { allowed: true };
  }

  // ─── Automation Validation ───

  /**
   * Rate-limit automation actions.
   */
  validateAutomationAction(action: string, params: Record<string, unknown> = {}): { allowed: boolean; reason?: string } {
    if (!this.checkRateLimit('automation', this.config.automationRateLimit)) {
      this.audit(action, params, 'automation', 'rate-limited');
      return { allowed: false, reason: `Zbyt wiele akcji automatyzacji (limit: ${this.config.automationRateLimit}/min)` };
    }

    this.audit(action, params, 'automation', 'allowed');
    return { allowed: true };
  }

  /**
   * Rate-limit browser actions.
   */
  validateBrowserAction(action: string, params: Record<string, unknown> = {}): { allowed: boolean; reason?: string } {
    if (!this.checkRateLimit('browser', this.config.browserRateLimit)) {
      this.audit(action, params, 'browser', 'rate-limited');
      return { allowed: false, reason: `Zbyt wiele akcji przeglądarki (limit: ${this.config.browserRateLimit}/min)` };
    }

    this.audit(action, params, 'browser', 'allowed');
    return { allowed: true };
  }

  // ─── Input Sanitization ───

  /**
   * Sanitize user-provided input that will be used in shell commands.
   */
  sanitizeForShell(input: string): string {
    // Remove shell metacharacters
    return input.replace(/[;&|`$(){}[\]!#~<>]/g, '');
  }

  /**
   * Validate URL to prevent SSRF-like attacks.
   */
  validateUrl(url: string): { allowed: boolean; reason?: string } {
    try {
      const parsed = new URL(url);

      // Block internal/private IPs
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal'];
      if (blockedHosts.includes(parsed.hostname)) {
        return { allowed: false, reason: 'Dostęp do adresów lokalnych jest zablokowany' };
      }

      // Block private IP ranges
      const ipMatch = parsed.hostname.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
      if (ipMatch) {
        const [, first, second] = ipMatch.map(Number);
        if (first === 10 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168) {
          return { allowed: false, reason: 'Dostęp do sieci prywatnych jest zablokowany' };
        }
      }

      // Only allow http/https protocols
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { allowed: false, reason: `Protokół ${parsed.protocol} nie jest dozwolony` };
      }

      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'Nieprawidłowy URL' };
    }
  }

  // ─── Regex Safety ───

  /**
   * Check if a regex pattern is safe to compile and run (no ReDoS risk).
   * Rejects patterns that are too long or contain known catastrophic constructs.
   */
  private isSafeRegexPattern(pattern: string): boolean {
    // Reject overly long patterns
    if (pattern.length > 200) {
      console.warn(`[SecurityGuard] Rejected regex pattern (too long: ${pattern.length} chars): "${pattern.slice(0, 50)}..."`);
      return false;
    }

    // Detect nested quantifiers and catastrophic backtracking constructs:
    //   (.*)*  (.+)+  (a*)*  (a+)+  (.+)*  (.*)+  (\w+)+  etc.
    //   Also: {n,}){n,}  and similar nested repeats
    const nestedQuantifiers = /(\((?:[^()]*(?:\.\*|\.\+|\w[*+]))[^()]*\))[*+]|\{[0-9]+,?\}[)][*+{]/;
    if (nestedQuantifiers.test(pattern)) {
      console.warn(`[SecurityGuard] Rejected regex pattern (nested quantifiers / ReDoS risk): "${pattern.slice(0, 80)}"`);
      this.audit('regex_rejected', { pattern: pattern.slice(0, 100) }, 'tool', 'blocked', 'Wzorzec regex z zagnieżdżonymi kwantyfikatorami');
      return false;
    }

    // Check it actually compiles (syntax validity)
    try {
      new RegExp(pattern, 'i');
    } catch {
      return false;
    }

    return true;
  }

  // ─── Rate Limiting ───

  private checkRateLimit(bucket: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const existing = this.rateLimits.get(bucket);

    if (!existing || now - existing.windowStart > 60000) {
      this.rateLimits.set(bucket, { count: 1, windowStart: now });
      return true;
    }

    if (existing.count >= maxPerMinute) {
      return false;
    }

    existing.count++;
    return true;
  }

  // ─── Audit Log ───

  private audit(
    action: string,
    params: Record<string, unknown>,
    source: AuditEntry['source'],
    result: AuditEntry['result'],
    reason?: string,
  ): void {
    if (!this.config.enableAuditLog) return;

    const entry: AuditEntry = {
      timestamp: Date.now(),
      action,
      params,
      source,
      result,
      reason,
    };

    this.auditLog.push(entry);

    // Trim log if too large
    if (this.auditLog.length > this.config.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-Math.floor(this.config.maxAuditEntries * 0.8));
    }

    // Async save (non-blocking)
    this.saveAuditLog();
  }

  /**
   * Public audit entry — for external callers (IPC handlers, etc.)
   */
  logAudit(entry: { action: string; params: Record<string, unknown>; source: AuditEntry['source']; result: AuditEntry['result']; reason?: string }): void {
    this.audit(entry.action, entry.params, entry.source, entry.result, entry.reason);
  }

  getAuditLog(limit: number = 100, filter?: { source?: string; result?: string }): AuditEntry[] {
    let entries = this.auditLog;
    if (filter?.source) entries = entries.filter((e) => e.source === filter.source);
    if (filter?.result) entries = entries.filter((e) => e.result === filter.result);
    return entries.slice(-limit);
  }

  getSecurityStats(): {
    totalActions: number;
    blockedActions: number;
    rateLimitedActions: number;
    last24h: { total: number; blocked: number };
  } {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const recent = this.auditLog.filter((e) => e.timestamp > dayAgo);
    return {
      totalActions: this.auditLog.length,
      blockedActions: this.auditLog.filter((e) => e.result === 'blocked').length,
      rateLimitedActions: this.auditLog.filter((e) => e.result === 'rate-limited').length,
      last24h: {
        total: recent.length,
        blocked: recent.filter((e) => e.result === 'blocked').length,
      },
    };
  }

  // ─── Persistence ───

  private loadAuditLog(): void {
    try {
      if (fs.existsSync(this.auditFilePath)) {
        const data = fs.readFileSync(this.auditFilePath, 'utf8');
        this.auditLog = JSON.parse(data);
      }
    } catch {
      this.auditLog = [];
    }
  }

  private saveAuditLog(): void {
    // Fire-and-forget async write — audit log save should not block event loop
    const dir = path.dirname(this.auditFilePath);
    fsp.mkdir(dir, { recursive: true })
      .then(() => fsp.writeFile(this.auditFilePath, JSON.stringify(this.auditLog), 'utf8'))
      .catch((error) => {
        console.error('Failed to save audit log:', error);
      });
  }
}
