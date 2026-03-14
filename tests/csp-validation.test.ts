/**
 * Contract tests for Content Security Policy (CSP) headers in main.ts.
 * 
 * Verifies that the CSP configuration includes necessary permissions for:
 * - AudioWorklets (worker-src blob:)
 * - Inline scripts (unsafe-inline)
 * - Remote AI APIs (openai.com, anthropic.com, deepgram.com)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const MAIN_PATH = path.join(ROOT, 'src/main/main.ts');

describe('CSP — Content Security Policy (fix/meeting-coach-csp)', () => {
  it('main.ts exists', () => {
    expect(fs.existsSync(MAIN_PATH)).toBe(true);
  });

  it('CSP headers are configured in main.ts', () => {
    const content = fs.readFileSync(MAIN_PATH, 'utf-8');
    expect(content).toContain('Content-Security-Policy');
  });

  it('CSP configuration is correct', () => {
    const content = fs.readFileSync(MAIN_PATH, 'utf-8');
    
    // Find all strings in quotes within the CSP block
    const cspMatches = content.match(/"default-src[^"]+"/g);
    expect(cspMatches, 'Could not find CSP strings in main.ts').not.toBeNull();
    
    const devCsp = cspMatches!.find(s => s.includes('unsafe-eval'));
    const prodCsp = cspMatches!.find(s => !s.includes('unsafe-eval'));
    
    expect(devCsp, 'Could not identify dev CSP string').toBeDefined();
    expect(prodCsp, 'Could not identify prod CSP string').toBeDefined();
    
    // Check Dev CSP
    expect(devCsp).toContain('worker-src blob:');
    expect(devCsp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:");
    
    // Check Prod CSP
    expect(prodCsp).toContain('worker-src blob:');
    expect(prodCsp).toContain("script-src 'self' 'unsafe-inline' blob:");
  });

  it('CSP includes required AI API domains', () => {
    const content = fs.readFileSync(MAIN_PATH, 'utf-8');
    expect(content).toContain('https://*.openai.com');
    expect(content).toContain('https://*.anthropic.com');
    expect(content).toContain('wss://*.deepgram.com');
  });
});
