import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export class SecurityService {
  private secretsPath: string;
  private encryptionKey: Buffer;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.secretsPath = path.join(userDataPath, '.kxai-secrets');
    this.encryptionKey = this.getOrCreateEncryptionKey();

    // Ensure directory exists
    if (!fs.existsSync(this.secretsPath)) {
      fs.mkdirSync(this.secretsPath, { recursive: true });
    }
  }

  private getOrCreateEncryptionKey(): Buffer {
    const keyPath = path.join(app.getPath('userData'), '.kxai-key');

    if (fs.existsSync(keyPath)) {
      return Buffer.from(fs.readFileSync(keyPath, 'utf8'), 'hex');
    }

    const key = crypto.randomBytes(KEY_LENGTH);
    fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
    return key;
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  async setApiKey(provider: string, apiKey: string): Promise<void> {
    const sanitizedProvider = provider.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(this.secretsPath, `${sanitizedProvider}.enc`);
    const encrypted = this.encrypt(apiKey);
    await fsp.writeFile(filePath, encrypted, { mode: 0o600 });
  }

  async getApiKey(provider: string): Promise<string | null> {
    const sanitizedProvider = provider.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(this.secretsPath, `${sanitizedProvider}.enc`);

    try {
      const encrypted = await fsp.readFile(filePath, 'utf8');
      return this.decrypt(encrypted);
    } catch {
      return null;
    }
  }

  async hasApiKey(provider: string): Promise<boolean> {
    const sanitizedProvider = provider.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(this.secretsPath, `${sanitizedProvider}.enc`);
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteApiKey(provider: string): Promise<void> {
    const sanitizedProvider = provider.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(this.secretsPath, `${sanitizedProvider}.enc`);

    try {
      await fsp.unlink(filePath);
    } catch {
      /* file does not exist, nothing to do */
    }
  }
}
