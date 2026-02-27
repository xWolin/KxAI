#!/usr/bin/env node
/**
 * notarize.js — macOS notarization via Apple notarytool.
 *
 * Called by electron-builder as "afterSign" hook.
 * Requires environment variables:
 *   APPLE_ID           — Apple Developer account email
 *   APPLE_ID_PASSWORD  — App-specific password (NOT your Apple ID password)
 *   APPLE_TEAM_ID      — Apple Developer Team ID (10-char alphanumeric)
 *
 * Skip notarization:
 *   - On non-macOS platforms (Windows/Linux CI)
 *   - When Apple credentials are not set (local dev builds)
 *   - When CSC_LINK is not set (unsigned builds)
 */

const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS builds
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization — not macOS');
    return;
  }

  // Skip if no credentials configured
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log('Skipping notarization — APPLE_ID / APPLE_ID_PASSWORD / APPLE_TEAM_ID not set');
    return;
  }

  // Skip if no signing certificate was provided (unsigned build)
  if (!process.env.CSC_LINK) {
    console.log('Skipping notarization — no signing certificate provided (CSC_LINK not set)');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete.');
};
