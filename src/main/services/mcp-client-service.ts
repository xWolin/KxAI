/**
 * MCP Client Service — connects KxAI to external MCP servers.
 *
 * Supports three transport types:
 * - Streamable HTTP (modern, recommended)
 * - SSE (legacy fallback)
 * - stdio (local process — spawn MCP server as child process)
 *
 * Auto-discovers tools from connected servers and registers them
 * with ToolsService so the AI agent can use them natively.
 *
 * @module mcp-client-service
 * @phase 8.1
 */

import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createLogger } from './logger';
import type {
  McpServerConfig,
  McpServerStatus,
  McpConnectionStatus,
  McpHubStatus,
  McpToolInfo,
  McpRegistryEntry,
  McpCategory,
} from '@shared/types';
import type { ToolDefinition, ToolResult } from '@shared/types';

const log = createLogger('McpClient');

/** Curated registry of popular MCP servers users can one-click install */
const CURATED_REGISTRY: McpRegistryEntry[] = [
  // ─── Featured / Recommended ───
  {
    id: 'github',
    name: 'GitHub',
    description: 'Zarządzanie repozytoriami, issues, pull requests, code search — pełna integracja z GitHub.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    category: 'Developer',
    icon: '🐙',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    setupInstructions:
      'Wygeneruj Personal Access Token na github.com/settings/tokens (classic, z uprawnieniami repo, read:org).',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
    tags: ['git', 'vcs', 'code', 'repo', 'pr', 'issues'],
    featured: true,
  },
  {
    id: 'filesystem',
    name: 'File System',
    description: 'Bezpieczny dostęp do plików i katalogów na dysku — odczyt, zapis, wyszukiwanie.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    category: 'System',
    icon: '📁',
    transport: 'stdio',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
    tags: ['pliki', 'files', 'dysk', 'katalogi', 'folder'],
    featured: true,
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Wyszukiwanie w internecie przez Brave Search API — wyniki, newsy, obrazki.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    category: 'Web',
    icon: '🔍',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['BRAVE_API_KEY'],
    setupInstructions: 'Zarejestruj się na brave.com/search/api i wygeneruj klucz API.',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
    tags: ['search', 'web', 'internet', 'szukaj'],
    featured: true,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Połączenie z bazą PostgreSQL — schema inspection, queries, analiza danych.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    category: 'Bazy danych',
    icon: '🐘',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['POSTGRES_CONNECTION_STRING'],
    setupInstructions: 'Podaj connection string, np. postgresql://user:pass@localhost:5432/dbname',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
    tags: ['sql', 'database', 'baza', 'dane'],
    featured: true,
  },
  {
    id: 'context7',
    name: 'Context7 — Library Docs',
    description: 'Aktualna dokumentacja bibliotek programistycznych dla agenta AI.',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    category: 'Developer',
    icon: '📚',
    transport: 'stdio',
    docsUrl: 'https://github.com/upstash/context7',
    tags: ['docs', 'dokumentacja', 'api', 'library', 'biblioteka'],
    featured: true,
  },

  // ─── Komunikacja ───
  {
    id: 'gmail',
    name: 'Gmail',
    description:
      'Pełna integracja z Gmail — wysyłanie, czytanie, wyszukiwanie emaili, załączniki, etykiety, filtry, operacje batch. OAuth2 auto-auth.',
    command: 'npx',
    args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
    category: 'Komunikacja',
    icon: '📧',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'oauth-google',
    setupInstructions:
      'Wymaga jednorazowej autoryzacji OAuth2 z kontem Google. Kliknij "Autoryzuj" aby otworzyć przeglądarkę i zalogować się do Gmail.',
    docsUrl: 'https://github.com/gongrzhe/server-gmail-autoauth-mcp',
    tags: ['email', 'google', 'poczta', 'mail'],
    featured: true,
  },
  {
    id: 'outlook',
    name: 'Microsoft Outlook',
    description:
      'Email, kalendarz, kontakty, zadania i Teams via Microsoft Graph API — pełna integracja z ekosystemem Microsoft 365.',
    command: 'npx',
    args: ['-y', 'outlook-mcp'],
    category: 'Komunikacja',
    icon: '📬',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'oauth-microsoft',
    setupInstructions:
      'Wymaga autoryzacji OAuth2 z kontem Microsoft 365. Kliknij "Autoryzuj" aby otworzyć przeglądarkę.',
    docsUrl: 'https://github.com/asanstefanski/outlook-mcp',
    tags: ['email', 'microsoft', 'office', 'teams', 'poczta'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Wysyłanie wiadomości, czytanie kanałów, zarządzanie Slack workspace.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    category: 'Komunikacja',
    icon: '💬',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    setupInstructions: 'Utwórz Slack App na api.slack.com/apps, dodaj Bot Token Scopes i zainstaluj w workspace.',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
    tags: ['chat', 'messaging', 'team', 'workspace'],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description:
      'Wyszukiwanie profili, firm, ofert pracy na LinkedIn. Pobieranie danych kontaktowych i sieci połączeń.',
    command: 'npx',
    args: ['-y', 'linkedin-mcp'],
    category: 'Komunikacja',
    icon: '🔗',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['LINKEDIN_EMAIL', 'LINKEDIN_PASSWORD'],
    setupInstructions: 'Podaj dane logowania do LinkedIn.',
    docsUrl: 'https://github.com/gregpr07/linkedin-mcp',
    tags: ['social', 'networking', 'praca', 'kariera', 'hr'],
  },
  {
    id: 'caldav',
    name: 'CalDAV Calendar',
    description:
      'Kalendarz via CalDAV — Google Calendar, Apple iCloud, Nextcloud, ownCloud. CRUD eventów, recurrence, reminders. Uwaga: KxAI ma wbudowaną natywną integrację CalDAV w zakładce Kalendarz.',
    command: 'npx',
    args: ['-y', 'caldav-mcp'],
    category: 'Komunikacja',
    icon: '📅',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['CALDAV_URL', 'CALDAV_USERNAME', 'CALDAV_PASSWORD'],
    setupInstructions:
      'Podaj URL serwera CalDAV, login i hasło. Dla Google Calendar zalecamy użycie natywnej integracji CalDAV w zakładce Kalendarz.',
    docsUrl: 'https://github.com/madbonez/caldav-mcp',
    tags: ['calendar', 'kalendarz', 'google', 'ical', 'spotkania'],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Zarządzanie serwerem Discord — kanały, wiadomości, role, moderacja.',
    command: 'npx',
    args: ['-y', 'mcp-discord'],
    category: 'Komunikacja',
    icon: '🎮',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['DISCORD_TOKEN'],
    setupInstructions: 'Utwórz bota na discord.com/developers/applications i skopiuj Bot Token.',
    docsUrl: 'https://github.com/barryyip0625/mcp-discord',
    tags: ['chat', 'gaming', 'community', 'serwer'],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Wysyłanie i odbieranie wiadomości WhatsApp, zarządzanie kontaktami i grupami przez WhatsApp Web API.',
    command: 'npx',
    args: ['-y', '@anthropic/whatsapp-mcp'],
    category: 'Komunikacja',
    icon: '💚',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'manual',
    setupInstructions:
      'Przy pierwszym uruchomieniu serwer wygeneruje kod QR do zeskanowania w WhatsApp (Ustawienia > Połączone urządzenia).',
    docsUrl: 'https://github.com/anthropics/whatsapp-mcp',
    tags: ['chat', 'wiadomości', 'messenger', 'kontakty', 'grupy', 'whatsapp'],
    featured: true,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Wysyłanie wiadomości, zarządzanie czatami, wyszukiwanie kontaktów i grup przez Telegram Bot API.',
    command: 'npx',
    args: ['-y', 'telegram-mcp'],
    category: 'Komunikacja',
    icon: '✈️',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['TELEGRAM_BOT_TOKEN'],
    setupInstructions:
      'Utwórz bota przez @BotFather na Telegramie, skopiuj token i wpisz tutaj. Dodaj bota do czatów, które ma obsługiwać.',
    docsUrl: 'https://github.com/nicepkg/telegram-mcp',
    tags: ['chat', 'wiadomości', 'bot', 'komunikator', 'telegram'],
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    description: 'Publikowanie tweetów, odczyt timeline, wyszukiwanie, DM-y i zarządzanie kontem X/Twitter.',
    command: 'npx',
    args: ['-y', '@enescinar/twitter-mcp'],
    category: 'Komunikacja',
    icon: '🐦',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_TOKEN_SECRET'],
    setupInstructions:
      'Utwórz Developer App na developer.x.com i skopiuj API Key, API Secret, Access Token i Access Token Secret.',
    docsUrl: 'https://github.com/EnesCinworker/twitter-mcp',
    tags: ['social', 'tweety', 'posty', 'media', 'x'],
  },

  // ─── Produktywność ───
  {
    id: 'notion',
    name: 'Notion',
    description: 'Interakcja z Notion — strony, bazy danych, bloki, wyszukiwanie.',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    category: 'Produktywność',
    icon: '📝',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['NOTION_API_TOKEN'],
    setupInstructions: 'Utwórz integrację na notion.so/my-integrations i skopiuj Internal Integration Token.',
    docsUrl: 'https://github.com/makenotion/notion-mcp-server',
    tags: ['notes', 'notatki', 'wiki', 'baza wiedzy', 'database'],
    featured: true,
  },
  {
    id: 'obsidian',
    name: 'Obsidian Vault',
    description: 'Odczyt/zapis notatek w Obsidian vault — wyszukiwanie, tagi, frontmatter.',
    command: 'npx',
    args: ['-y', 'mcp-obsidian'],
    category: 'Produktywność',
    icon: '💎',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['OBSIDIAN_VAULT_PATH'],
    setupInstructions: 'Podaj pełną ścieżkę do folderu vault Obsidian.',
    docsUrl: 'https://github.com/bitbonsai/mcp-obsidian',
    tags: ['notes', 'notatki', 'vault', 'markdown', 'zettelkasten'],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Zarządzanie projektami w Linear — issues, cykle, roadmap, labele.',
    command: 'npx',
    args: ['-y', '@tacticlaunch/mcp-linear'],
    category: 'Produktywność',
    icon: '📊',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['LINEAR_API_KEY'],
    setupInstructions: 'Wygeneruj API key w Linear: Settings > API > Personal API keys.',
    docsUrl: 'https://github.com/tacticlaunch/mcp-linear',
    tags: ['project', 'issue', 'tracker', 'agile', 'kanban'],
  },
  {
    id: 'jira',
    name: 'Atlassian Jira',
    description: 'Wyszukiwanie i zarządzanie w Jira — projekty, issues, JQL, dev info (commity, PR).',
    command: 'npx',
    args: ['-y', '@aashari/mcp-server-atlassian-jira'],
    category: 'Produktywność',
    icon: '🔵',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['JIRA_URL', 'JIRA_USERNAME', 'JIRA_API_TOKEN'],
    setupInstructions:
      'Podaj URL instancji Jira, email i API token z id.atlassian.com/manage-profile/security/api-tokens.',
    docsUrl: 'https://github.com/aashari/mcp-server-atlassian-jira',
    tags: ['project', 'issue', 'wiki', 'atlassian', 'scrum'],
  },
  {
    id: 'miro',
    name: 'Miro',
    description: 'Miro whiteboard — tworzenie elementów, edycja, bulk operacje.',
    command: 'npx',
    args: ['-y', '@k-jarzyna/mcp-miro'],
    category: 'Produktywność',
    icon: '🖌️',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['MIRO_API_TOKEN'],
    setupInstructions: 'Wygeneruj token API w Miro: Profile > Settings > Your apps.',
    docsUrl: 'https://github.com/k-jarzyna/mcp-miro',
    tags: ['whiteboard', 'tablica', 'diagram', 'brainstorm'],
  },

  // ─── Developer ───
  {
    id: 'docker',
    name: 'Docker',
    description: 'Zarządzanie kontenerami, obrazami, wolumenami i sieciami Docker via Docker Engine API.',
    command: 'npx',
    args: ['-y', 'docker-mcp-server'],
    category: 'Developer',
    icon: '🐳',
    transport: 'stdio',
    docsUrl: 'https://github.com/ckreiling/mcp-server-docker',
    tags: ['container', 'kontener', 'deploy', 'devops'],
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    description: 'Zarządzanie klastrem K8s — pody, deploymenty, serwisy, namespace.',
    command: 'npx',
    args: ['-y', 'mcp-server-kubernetes'],
    category: 'Developer',
    icon: '☸️',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'manual',
    setupInstructions: 'Wymaga skonfigurowanego kubectl z dostępem do klastra (kubeconfig).',
    docsUrl: 'https://github.com/Flux159/mcp-server-kubernetes',
    tags: ['k8s', 'cluster', 'devops', 'pods', 'orchestration'],
  },
  {
    id: 'postman',
    name: 'Postman',
    description: 'Interakcja z Postman API — kolekcje, środowiska, testy API.',
    command: 'npx',
    args: ['-y', 'postman-mcp-server'],
    category: 'Developer',
    icon: '🟧',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['POSTMAN_API_KEY'],
    setupInstructions: 'Wygeneruj API key w Postman: Settings > API Keys.',
    docsUrl: 'https://github.com/delano/postman-mcp-server',
    tags: ['api', 'rest', 'testing', 'http'],
  },
  {
    id: 'npm-registry',
    name: 'Package Registry',
    description: 'Wyszukiwanie pakietów w NPM, PyPI, Cargo, NuGet z aktualnymi wersjami.',
    command: 'npx',
    args: ['-y', 'package-registry-mcp'],
    category: 'Developer',
    icon: '📦',
    transport: 'stdio',
    docsUrl: 'https://github.com/artmann/package-registry-mcp',
    tags: ['npm', 'pypi', 'cargo', 'packages', 'dependencies'],
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Pełna kontrola nad Figma — kształty, tekst, komponenty, style, auto-layout. 80+ narzędzi.',
    command: 'npx',
    args: ['-y', 'figma-use'],
    category: 'Developer',
    icon: '🎨',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['FIGMA_ACCESS_TOKEN'],
    setupInstructions: 'Wygeneruj Personal Access Token w Figma: Settings > Account > Personal access tokens.',
    docsUrl: 'https://github.com/dannote/figma-use',
    tags: ['design', 'ui', 'ux', 'prototyp', 'grafika'],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Cloudflare Workers, KV, R2, D1 — zarządzanie usługami edge.',
    command: 'npx',
    args: ['-y', '@cloudflare/mcp-server-cloudflare'],
    category: 'Developer',
    icon: '☁️',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['CLOUDFLARE_API_TOKEN'],
    setupInstructions: 'Wygeneruj API token na dash.cloudflare.com/profile/api-tokens.',
    docsUrl: 'https://github.com/cloudflare/mcp-server-cloudflare',
    tags: ['cdn', 'workers', 'edge', 'r2', 'cloud'],
  },

  // ─── Bazy danych ───
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Operacje na bazach SQLite — schema exploration, queries, analiza danych z wbudowanymi funkcjami.',
    command: 'npx',
    args: ['-y', 'mcp-sqlite'],
    category: 'Bazy danych',
    icon: '📋',
    transport: 'stdio',
    docsUrl: 'https://github.com/AtelierMizumi/mcp-sqlite',
    tags: ['sql', 'database', 'baza', 'lokalna'],
  },
  {
    id: 'mysql',
    name: 'MySQL',
    description: 'Połączenie z MySQL — schema inspection, konfigurowane uprawnienia, bezpieczne zapytania.',
    command: 'npx',
    args: ['-y', '@benborla29/mcp-server-mysql'],
    category: 'Bazy danych',
    icon: '🐬',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'],
    setupInstructions: 'Podaj dane dostępowe do bazy MySQL.',
    docsUrl: 'https://github.com/benborla/mcp-server-mysql',
    tags: ['sql', 'database', 'baza', 'relacyjna'],
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    description: 'MongoDB — zarządzanie kolekcjami, dokumentami, indeksami, agregacje.',
    command: 'npx',
    args: ['-y', 'mongodb-lens'],
    category: 'Bazy danych',
    icon: '🍃',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['MONGODB_URI'],
    setupInstructions: 'Podaj MongoDB connection string, np. mongodb://localhost:27017/dbname',
    docsUrl: 'https://github.com/furey/mongodb-lens',
    tags: ['nosql', 'database', 'document', 'baza'],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Supabase — zarządzanie tabelami, konfiguracja, zapytania, auth, storage.',
    command: 'npx',
    args: ['-y', '@supabase/mcp-server-supabase'],
    category: 'Bazy danych',
    icon: '⚡',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    setupInstructions: 'Znajdziesz URL i Service Role Key w Supabase Dashboard > Settings > API.',
    docsUrl: 'https://github.com/supabase-community/supabase-mcp',
    tags: ['postgres', 'backend', 'auth', 'realtime', 'baas'],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Integracja z Airtable — schema, odczyt, zapis rekordów.',
    command: 'npx',
    args: ['-y', 'airtable-mcp-server'],
    category: 'Bazy danych',
    icon: '📊',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['AIRTABLE_API_KEY'],
    setupInstructions: 'Wygeneruj Personal Access Token na airtable.com/create/tokens.',
    docsUrl: 'https://github.com/domdomegg/airtable-mcp-server',
    tags: ['spreadsheet', 'database', 'no-code', 'tabela'],
  },

  // ─── Web ───
  {
    id: 'fetch',
    name: 'Web Fetch',
    description: 'Pobieranie treści ze stron internetowych — JSON, tekst, HTML.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    category: 'Web',
    icon: '🌐',
    transport: 'stdio',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
    tags: ['http', 'scraping', 'strona', 'webpage'],
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo Search',
    description: 'Wyszukiwanie w internecie przez DuckDuckGo — bez klucza API.',
    command: 'npx',
    args: ['-y', 'duckduckgo-mcp-server'],
    category: 'Web',
    icon: '🦆',
    transport: 'stdio',
    docsUrl: 'https://github.com/nickclyde/duckduckgo-mcp-server',
    tags: ['search', 'web', 'szukaj', 'free', 'darmowe'],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Pobieranie napisów/transkrypcji z filmów YouTube — automatyczne napisy, wyszukiwanie.',
    command: 'npx',
    args: ['-y', '@anaisbetts/mcp-youtube'],
    category: 'Media',
    icon: '▶️',
    transport: 'stdio',
    docsUrl: 'https://github.com/anaisbetts/mcp-youtube',
    tags: ['video', 'film', 'transkrypcja', 'napisy', 'youtube'],
  },
  {
    id: 'weather',
    name: 'Pogoda (Weather)',
    description: 'Aktualna pogoda i prognoza dla dowolnego miasta — temperatura, wilgotność, wiatr, bez klucza API.',
    command: 'npx',
    args: ['-y', 'weather-mcp-server'],
    category: 'Web',
    icon: '⛅',
    transport: 'stdio',
    docsUrl: 'https://github.com/yagil/weather-mcp-server',
    tags: ['pogoda', 'weather', 'temperatura', 'prognoza', 'free'],
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    description: 'Wyszukiwanie miejsc, trasy, geocoding, pobliskie POI — Google Maps Platform.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-maps'],
    category: 'Web',
    icon: '🗺️',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['GOOGLE_MAPS_API_KEY'],
    setupInstructions: 'Wygeneruj API key na console.cloud.google.com z włączonym Maps API.',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
    tags: ['mapy', 'maps', 'lokalizacja', 'trasa', 'poi'],
    featured: true,
  },
  {
    id: 'exa',
    name: 'Exa AI Search',
    description: 'Zaawansowane wyszukiwanie AI — semantyczne, real-time, z filtrami i pełnym tekstem.',
    command: 'npx',
    args: ['-y', 'exa-mcp-server'],
    category: 'Web',
    icon: '🔎',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['EXA_API_KEY'],
    setupInstructions: 'Zarejestruj się na exa.ai i wygeneruj klucz API.',
    docsUrl: 'https://github.com/exa-labs/exa-mcp-server',
    tags: ['search', 'ai', 'semantic', 'neural'],
  },

  // ─── System ───
  {
    id: 'memory',
    name: 'Knowledge Graph Memory',
    description: 'Persistent memory system oparty na grafie wiedzy — przechowywanie i wyszukiwanie kontekstu.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    category: 'AI',
    icon: '🧠',
    transport: 'stdio',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
    tags: ['memory', 'pamięć', 'kontekst', 'graf', 'knowledge'],
    featured: true,
  },
  {
    id: 'mcp-installer',
    name: 'MCP Installer',
    description: 'Automatyczna instalacja innych serwerów MCP — wyszukaj i zainstaluj jednym kliknięciem.',
    command: 'npx',
    args: ['-y', 'mcp-installer'],
    category: 'System',
    icon: '🔧',
    transport: 'stdio',
    docsUrl: 'https://github.com/anaisbetts/mcp-installer',
    tags: ['install', 'setup', 'auto', 'manager'],
  },

  // ─── AI ───
  {
    id: 'openai-bridge',
    name: 'OpenAI Bridge',
    description: 'Zapytania do modeli OpenAI (GPT-4, DALL-E) bezpośrednio z agenta MCP.',
    command: 'npx',
    args: ['-y', 'mcp-server-openai'],
    category: 'AI',
    icon: '🤖',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['OPENAI_API_KEY'],
    setupInstructions: 'Wygeneruj klucz API na platform.openai.com/api-keys.',
    docsUrl: 'https://github.com/pierrebrunelle/mcp-server-openai',
    tags: ['openai', 'gpt', 'llm', 'model', 'chatgpt'],
  },
  {
    id: 'huggingface',
    name: 'HuggingFace Spaces',
    description: 'Uruchamianie modeli AI z HuggingFace Spaces — generowanie obrazów, tekstu, audio.',
    command: 'npx',
    args: ['-y', '@llmindset/mcp-hfspace'],
    category: 'AI',
    icon: '🤗',
    transport: 'stdio',
    docsUrl: 'https://github.com/evalstate/mcp-hfspace',
    tags: ['ml', 'model', 'image', 'space', 'inference'],
  },

  // ─── Dane & Analityka ───
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Odczyt, zapis i zarządzanie arkuszami Google Sheets.',
    command: 'npx',
    args: ['-y', 'mcp-google-sheets'],
    category: 'Dane',
    icon: '📊',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'oauth-google',
    setupInstructions:
      'Wymaga autoryzacji OAuth2 z kontem Google. Kliknij "Autoryzuj" aby zalogować się do Google Sheets.',
    docsUrl: 'https://github.com/xing5/mcp-google-sheets',
    tags: ['spreadsheet', 'arkusz', 'excel', 'tabela', 'google'],
  },
  {
    id: 'arxiv',
    name: 'ArXiv Papers',
    description: 'Wyszukiwanie i pobieranie artykułów naukowych z ArXiv.',
    command: 'npx',
    args: ['-y', 'arxiv-mcp-server'],
    category: 'Dane',
    icon: '📄',
    transport: 'stdio',
    docsUrl: 'https://github.com/blazickjp/arxiv-mcp-server',
    tags: ['research', 'nauka', 'papers', 'academic', 'artykuły'],
  },

  // ─── Monitoring ───
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Sentry error monitoring — issues, stack traces, release tracking.',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server'],
    category: 'Monitoring',
    icon: '🔥',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['SENTRY_AUTH_TOKEN'],
    setupInstructions: 'Wygeneruj Auth Token na sentry.io: Settings > Auth Tokens.',
    docsUrl: 'https://github.com/getsentry/sentry-mcp',
    tags: ['errors', 'crash', 'monitoring', 'debug', 'tracking'],
  },

  // ─── Produktywność (nowe) ───
  {
    id: 'todoist',
    name: 'Todoist',
    description: 'Zarządzanie zadaniami w Todoist — tworzenie, edycja, projekty, etykiety, filtry, komentarze.',
    command: 'npx',
    args: ['-y', 'todoist-mcp-server'],
    category: 'Produktywność',
    icon: '✔️',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['TODOIST_API_TOKEN'],
    setupInstructions: 'Znajdziesz API token w Todoist: Settings > Integrations > Developer.',
    docsUrl: 'https://github.com/abhiz123/todoist-mcp-server',
    tags: ['todo', 'zadania', 'lista', 'produktywność', 'task manager'],
    featured: true,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Przeglądanie, wyszukiwanie i odczyt plików z Google Drive — Docs, Sheets, PDF, obrazy.',
    command: 'npx',
    args: ['-y', 'mcp-google-drive'],
    category: 'Produktywność',
    icon: '📂',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'oauth-google',
    setupInstructions:
      'Wymaga autoryzacji OAuth2 z kontem Google. Kliknij "Autoryzuj" aby zalogować się do Google Drive.',
    docsUrl: 'https://github.com/isaacphi/mcp-google-drive',
    tags: ['dysk', 'drive', 'google', 'pliki', 'storage'],
  },

  // ─── Finanse ───
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Stripe API — zarządzanie płatnościami, klientami, subskrypcjami, fakturami.',
    command: 'npx',
    args: ['-y', '@stripe/mcp'],
    category: 'Finanse',
    icon: '💳',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['STRIPE_SECRET_KEY'],
    setupInstructions: 'Skopiuj Secret Key z dashboard.stripe.com/apikeys.',
    docsUrl: 'https://github.com/stripe/agent-toolkit',
    tags: ['payments', 'płatności', 'billing', 'invoices', 'subscription'],
  },
  {
    id: 'hubspot',
    name: 'HubSpot CRM',
    description: 'HubSpot CRM — kontakty, firmy, deale, tickety, emaile, raporty sprzedażowe. 30+ narzędzi.',
    command: 'npx',
    args: ['-y', 'hubspot-mcp'],
    category: 'Inne',
    icon: '🧡',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['HUBSPOT_ACCESS_TOKEN'],
    setupInstructions: 'Wygeneruj Private App token na developers.hubspot.com.',
    docsUrl: 'https://github.com/buryhuang/mcp-hubspot',
    tags: ['crm', 'sprzedaż', 'kontakty', 'marketing', 'deals'],
    featured: true,
  },

  // ─── Automatyzacja workflow ───
  {
    id: 'n8n',
    name: 'n8n Workflow Automation',
    description: 'Połącz agenta z n8n — odkrywanie 525+ węzłów, budowanie i zarządzanie automatyzacjami workflow.',
    command: 'npx',
    args: ['-y', 'n8n-mcp'],
    category: 'Inne',
    icon: '🔀',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['N8N_BASE_URL', 'N8N_API_KEY'],
    setupInstructions: 'Podaj URL instancji n8n i klucz API z Settings > API.',
    docsUrl: 'https://github.com/czlonkowski/n8n-mcp',
    tags: ['automation', 'workflow', 'integracja', 'no-code', 'n8n'],
    featured: true,
  },
  {
    id: 'task-master',
    name: 'Task Master AI',
    description:
      'AI-driven zarządzanie zadaniami dla deweloperów — parsowanie PRD, priorytety, śledzenie postępu z Claude.',
    command: 'npx',
    args: ['-y', 'task-master-ai'],
    category: 'Produktywność',
    icon: '🎯',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['ANTHROPIC_API_KEY'],
    setupInstructions: 'Wymaga klucza API Anthropic do zasilania agenta Claude. Wygeneruj na console.anthropic.com.',
    docsUrl: 'https://github.com/eyaltoledano/claude-task-master',
    tags: ['tasks', 'prd', 'development', 'planning', 'agile'],
    featured: true,
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description:
      'Zaawansowane web scraping i ekstrakcja treści stron — crawling, batch processing, deep research. Oficjalny MCP.',
    command: 'npx',
    args: ['-y', 'firecrawl-mcp'],
    category: 'Web',
    icon: '🔥',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['FIRECRAWL_API_KEY'],
    setupInstructions: 'Zarejestruj się na firecrawl.dev i wygeneruj klucz API.',
    docsUrl: 'https://github.com/firecrawl/firecrawl-mcp-server',
    tags: ['scraping', 'crawl', 'web', 'content', 'extract'],
    featured: true,
  },
  {
    id: 'desktop-commander',
    name: 'Desktop Commander',
    description: 'Kontrola terminala, zarządzanie procesami, operacje na plikach i edycja kodu przez MCP.',
    command: 'npx',
    args: ['-y', '@wonderwhy-er/desktop-commander'],
    category: 'System',
    icon: '🖥️',
    transport: 'stdio',
    docsUrl: 'https://github.com/wonderwhy-er/desktopcommandermcp',
    tags: ['terminal', 'files', 'process', 'shell', 'system'],
  },
  {
    id: 'hackmd',
    name: 'HackMD',
    description: 'Notatki HackMD — tworzenie, edycja, wyszukiwanie i udostępnianie collaborative markdown dokumentów.',
    command: 'npx',
    args: ['-y', 'hackmd-mcp'],
    category: 'Produktywność',
    icon: '📓',
    transport: 'stdio',
    requiresSetup: true,
    setupType: 'env',
    requiredEnvVars: ['HACKMD_API_TOKEN'],
    setupInstructions: 'Wygeneruj API token w HackMD: Settings > API.',
    docsUrl: 'https://github.com/yuna0x0/hackmd-mcp',
    tags: ['notes', 'markdown', 'colaboracja', 'dokumenty', 'wiki'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Ustrukturyzowane myślenie krok-po-kroku dla złożonych problemów — rozkłada problem na kolejne myśli.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    category: 'AI',
    icon: '🧩',
    transport: 'stdio',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
    tags: ['thinking', 'reasoning', 'chain-of-thought', 'problem-solving', 'ai'],
    featured: true,
  },
];

/** Active connection state for one MCP server */
/** Reconnect configuration */
const RECONNECT = {
  maxAttempts: 4,
  baseDelayMs: 5_000,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
} as const;

/** Heartbeat configuration */
const HEARTBEAT_INTERVAL_MS = 60_000;

interface McpConnection {
  config: McpServerConfig;
  client: Client;
  transport: Transport;
  status: McpConnectionStatus;
  error?: string;
  tools: McpToolInfo[];
  connectedAt?: number;
  callCount: number;
  registeredToolNames: string[];
  reconnectAttempt: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

export class McpClientService {
  private connections = new Map<string, McpConnection>();
  private configs: McpServerConfig[] = [];
  private toolsService: any = null;
  private configService: any = null;
  private mainWindow: Electron.BrowserWindow | null = null;

  /**
   * Set dependencies after construction (DI wiring phase).
   */
  setDependencies(opts: { toolsService?: any; configService?: any; mainWindow?: Electron.BrowserWindow }): void {
    if (opts.toolsService) this.toolsService = opts.toolsService;
    if (opts.configService) this.configService = opts.configService;
    if (opts.mainWindow) this.mainWindow = opts.mainWindow;
  }

  /**
   * Initialize — load saved configs, register management tools, and auto-connect.
   */
  async initialize(): Promise<void> {
    log.info('Initializing MCP Client Service...');
    await this.loadConfigs();
    this.registerManagementTools();

    // Auto-connect enabled servers
    const autoConnectServers = this.configs.filter((c) => c.autoConnect && c.enabled);
    if (autoConnectServers.length > 0) {
      log.info(`Auto-connecting ${autoConnectServers.length} MCP servers...`);
      for (const config of autoConnectServers) {
        // Don't await — connect in background
        void this.connect(config.id).catch((err) => {
          log.warn(`Auto-connect failed for "${config.name}": ${err.message}`);
        });
      }
    }
  }

  // ─── Server Management ───

  /**
   * Add a new MCP server configuration.
   */
  async addServer(config: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig> {
    const fullConfig: McpServerConfig = { ...config, id: randomUUID() };
    this.configs.push(fullConfig);
    await this.saveConfigs();
    this.pushStatus();
    log.info(`Added MCP server: "${fullConfig.name}" (${fullConfig.transport})`);
    return fullConfig;
  }

  /**
   * Remove an MCP server and disconnect if active.
   */
  async removeServer(id: string): Promise<void> {
    await this.disconnect(id);
    this.configs = this.configs.filter((c) => c.id !== id);
    await this.saveConfigs();
    this.pushStatus();
    log.info(`Removed MCP server: ${id}`);
  }

  /**
   * Get all configured servers.
   */
  listServers(): McpServerConfig[] {
    return [...this.configs];
  }

  // ─── Connection Management ───

  /**
   * Connect to an MCP server by id.
   */
  async connect(id: string): Promise<void> {
    const config = this.configs.find((c) => c.id === id);
    if (!config) throw new Error(`MCP server not found: ${id}`);
    if (!config.enabled) throw new Error(`MCP server "${config.name}" is disabled`);

    // Disconnect existing connection if any
    if (this.connections.has(id)) {
      await this.disconnect(id);
    }

    const conn: McpConnection = {
      config,
      client: null as any,
      transport: null as any,
      status: 'connecting',
      tools: [],
      callCount: 0,
      registeredToolNames: [],
      reconnectAttempt: 0,
    };
    this.connections.set(id, conn);
    this.pushStatus();

    try {
      log.info(`Connecting to MCP server "${config.name}" via ${config.transport}...`);

      const { client, transport } = await this.createConnection(config);
      conn.client = client;
      conn.transport = transport;
      conn.status = 'connected';
      conn.connectedAt = Date.now();

      // Discover tools
      const { tools } = await client.listTools();
      conn.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));

      log.info(
        `Connected to "${config.name}" — discovered ${conn.tools.length} tools: ${conn.tools.map((t) => t.name).join(', ')}`,
      );

      // Register tools with ToolsService
      this.registerMcpTools(conn);

      // Start heartbeat to detect silent disconnections
      this.startHeartbeat(conn);

      // Reset reconnect counter on successful connection
      conn.reconnectAttempt = 0;

      this.pushStatus();
    } catch (err: any) {
      conn.status = 'error';
      conn.error = err.message || String(err);
      log.error(`Failed to connect to "${config.name}": ${conn.error}`);
      this.pushStatus();
      throw err;
    }
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) return;

    // Clear timers
    this.stopHeartbeat(conn);
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = undefined;
    }

    // Unregister tools
    this.unregisterMcpTools(conn);

    // Close transport
    try {
      await conn.transport?.close?.();
    } catch (err: any) {
      log.warn(`Error closing transport for "${conn.config.name}": ${err.message}`);
    }

    try {
      await conn.client?.close?.();
    } catch {
      // Ignore
    }

    this.connections.delete(id);
    this.pushStatus();
    log.info(`Disconnected from "${conn.config.name}"`);
  }

  /**
   * Reconnect to an MCP server (disconnect + connect).
   */
  async reconnect(id: string): Promise<void> {
    await this.disconnect(id);
    await this.connect(id);
  }

  // ─── OAuth Setup ───

  /**
   * Run OAuth setup for a server that requires browser-based authorization.
   * Looks up the server in CURATED_REGISTRY to find the package name,
   * then runs `npx <package> auth` which opens the browser for OAuth consent.
   */
  async runOAuthSetup(id: string): Promise<{ success: boolean; error?: string }> {
    const config = this.configs.find((c) => c.id === id);
    if (!config) return { success: false, error: `Server not found: ${id}` };

    // Find the registry entry to determine the package
    const registryEntry = CURATED_REGISTRY.find((e) => e.name.toLowerCase() === config.name.toLowerCase());
    const setupType = registryEntry?.setupType;

    if (setupType !== 'oauth-google' && setupType !== 'oauth-microsoft') {
      return { success: false, error: 'Ten serwer nie wymaga autoryzacji OAuth' };
    }

    // Determine the package name from args (e.g. ['-y', '@gongrzhe/server-gmail-autoauth-mcp'])
    const packageName = config.args?.[1] || registryEntry?.args?.[1];
    if (!packageName) {
      return { success: false, error: 'Nie można określić pakietu do autoryzacji' };
    }

    log.info(`Running OAuth setup for "${config.name}" (package: ${packageName})...`);

    try {
      const execAsync = promisify(exec);
      const isWindows = process.platform === 'win32';

      // Run the auth subcommand — most MCP OAuth servers support `npx <pkg> auth`
      await execAsync(`npx -y ${packageName} auth`, {
        timeout: 120_000,
        shell: isWindows ? 'cmd.exe' : '/bin/sh',
        env: { ...process.env, ...config.env },
      });

      log.info(`OAuth setup completed for "${config.name}"`);
      return { success: true };
    } catch (err: any) {
      const msg = err.message || String(err);
      log.error(`OAuth setup failed for "${config.name}": ${msg}`);
      return { success: false, error: msg };
    }
  }

  // ─── Tool Execution ───

  /**
   * Call a tool on a specific MCP server.
   */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const conn = this.connections.get(serverId);
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: `MCP server "${serverId}" is not connected` };
    }

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await conn.client.callTool({ name: toolName, arguments: args });
        conn.callCount++;

        // Extract text content from MCP result
        const textContent = (result.content as any[])
          ?.filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');

        return {
          success: !result.isError,
          data: textContent || result.content,
          error: result.isError ? textContent : undefined,
        };
      } catch (err: any) {
        const isTransient = err.message?.includes('timeout') || err.code === 'ECONNRESET';
        const isConnectionDead = err.message?.includes('closed') || err.message?.includes('ECONNREFUSED');

        // Retry on transient errors only
        if (isTransient && attempt < maxRetries) {
          log.warn(
            `[MCP:${conn.config.name}] Tool call "${toolName}" failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`,
          );
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          continue;
        }

        log.error(`MCP tool call failed: ${conn.config.name}/${toolName}: ${err.message}`);

        // If connection lost, mark as error and unregister tools
        if (isConnectionDead) {
          conn.status = 'error';
          conn.error = 'Connection lost';
          this.stopHeartbeat(conn);
          if (this.toolsService) {
            this.toolsService.unregisterByPrefix(`mcp_${conn.config.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_`);
            log.info(`[MCP:${conn.config.name}] Unregistered tools after connection loss`);
          }
          this.pushStatus();
          this.scheduleReconnect(conn);
        }

        return { success: false, error: err.message || String(err) };
      }
    }

    return { success: false, error: `Tool call "${toolName}" exhausted retries` };
  }

  // ─── Status & Registry ───

  /**
   * Get aggregated MCP hub status.
   */
  getStatus(): McpHubStatus {
    const servers: McpServerStatus[] = this.configs.map((config) => {
      const conn = this.connections.get(config.id);
      return {
        id: config.id,
        name: config.name,
        status: conn?.status ?? 'disconnected',
        error: conn?.error,
        tools: conn?.tools ?? [],
        connectedAt: conn?.connectedAt,
        callCount: conn?.callCount ?? 0,
        transport: config.transport,
        icon: config.icon,
      };
    });

    const connectedCount = servers.filter((s) => s.status === 'connected').length;
    const totalTools = servers.reduce((sum, s) => sum + s.tools.length, 0);

    return { servers, totalTools, connectedCount };
  }

  /**
   * Get curated registry of popular MCP servers.
   */
  getRegistry(): McpRegistryEntry[] {
    return CURATED_REGISTRY;
  }

  /**
   * Search & filter registry by query string and/or category.
   * Matches against name, description, tags.
   * Featured servers are returned first.
   */
  searchRegistry(query?: string, category?: McpCategory): McpRegistryEntry[] {
    let results = [...CURATED_REGISTRY];

    if (category) {
      results = results.filter((e) => e.category === category);
    }

    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      results = results.filter((e) => {
        const searchable = [e.name, e.description, e.id, ...(e.tags ?? [])].join(' ').toLowerCase();
        return searchable.includes(q);
      });
    }

    // Featured entries first, then alphabetically by name
    results.sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  /**
   * Get available categories from registry entries.
   */
  getRegistryCategories(): McpCategory[] {
    const cats = new Set<McpCategory>();
    for (const e of CURATED_REGISTRY) cats.add(e.category);
    return [...cats].sort();
  }

  // ─── Shutdown ───

  // ─── Reconnect & Heartbeat ───

  /**
   * Schedule a reconnect with exponential backoff.
   * Attempts: 5s → 10s → 20s → 40s (max 4 attempts).
   */
  private scheduleReconnect(conn: McpConnection): void {
    if (conn.reconnectAttempt >= RECONNECT.maxAttempts) {
      log.error(`[MCP:${conn.config.name}] Max reconnect attempts (${RECONNECT.maxAttempts}) reached — giving up`);
      conn.status = 'error';
      conn.error = `Reconnect failed after ${RECONNECT.maxAttempts} attempts`;
      this.pushStatus();
      return;
    }

    const delay = Math.min(
      RECONNECT.baseDelayMs * Math.pow(RECONNECT.backoffMultiplier, conn.reconnectAttempt),
      RECONNECT.maxDelayMs,
    );
    conn.reconnectAttempt++;
    conn.status = 'reconnecting';
    this.pushStatus();

    log.info(
      `[MCP:${conn.config.name}] Scheduling reconnect attempt ${conn.reconnectAttempt}/${RECONNECT.maxAttempts} in ${delay / 1000}s`,
    );

    conn.reconnectTimer = setTimeout(async () => {
      conn.reconnectTimer = undefined;
      try {
        await this.reconnect(conn.config.id);
        log.info(`[MCP:${conn.config.name}] Reconnect succeeded (attempt ${conn.reconnectAttempt})`);
      } catch (err: any) {
        log.error(`[MCP:${conn.config.name}] Reconnect attempt ${conn.reconnectAttempt} failed: ${err.message}`);
        // Re-fetch conn — reconnect() may have recreated it
        const refreshed = this.connections.get(conn.config.id);
        if (refreshed) {
          refreshed.reconnectAttempt = conn.reconnectAttempt;
          this.scheduleReconnect(refreshed);
        }
      }
    }, delay);
  }

  /**
   * Start periodic heartbeat to detect silent disconnections.
   * Uses listTools() as a lightweight ping — if it fails, triggers reconnect.
   */
  private startHeartbeat(conn: McpConnection): void {
    this.stopHeartbeat(conn);
    conn.heartbeatTimer = setInterval(async () => {
      try {
        await conn.client.listTools();
      } catch {
        log.warn(`[MCP:${conn.config.name}] Heartbeat failed — connection may be dead`);
        conn.status = 'error';
        conn.error = 'Heartbeat failed — connection lost';
        this.stopHeartbeat(conn);
        this.unregisterMcpTools(conn);
        this.pushStatus();
        this.scheduleReconnect(conn);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop heartbeat timer for a connection.
   */
  private stopHeartbeat(conn: McpConnection): void {
    if (conn.heartbeatTimer) {
      clearInterval(conn.heartbeatTimer);
      conn.heartbeatTimer = undefined;
    }
  }

  async shutdown(): Promise<void> {
    log.info('Shutting down MCP Client Service...');
    const ids = [...this.connections.keys()];
    for (const id of ids) {
      await this.disconnect(id).catch(() => {});
    }
    log.info('MCP Client Service shut down');
  }

  // ─── Agent Self-Management Tools ───

  /**
   * Register MCP management tools so the AI agent can autonomously
   * discover, add, connect and manage MCP servers.
   *
   * This is what makes the agent proactive — when user asks about
   * calendar, email, etc., the agent can:
   * 1. Browse the MCP registry
   * 2. Add and connect the right server
   * 3. Use the newly discovered tools
   */
  private registerManagementTools(): void {
    if (!this.toolsService) {
      log.warn('ToolsService not available — MCP management tools will not be registered');
      return;
    }

    // ── 1. Browse MCP registry ──
    this.toolsService.register(
      {
        name: 'mcp_browse_registry',
        description:
          'Przeglądaj rejestr dostępnych serwerów MCP (integracji). Użyj gdy potrzebujesz nowej ' +
          'zdolności — np. dostęp do kalendarza, emaila, bazy danych, Slack, GitHub, Notion itp. ' +
          'Zwraca listę dostępnych serwerów z opisami i wymaganiami. Po znalezieniu odpowiedniego ' +
          'serwera, użyj mcp_add_and_connect żeby go podłączyć.',
        category: 'mcp',
        parameters: {
          category: {
            type: 'string',
            description:
              'Filtruj po kategorii (np. "Komunikacja", "Developer", "Produktywność", "Web", "Bazy danych", "System", "AI", "Media", "Finanse", "Bezpieczeństwo", "Monitoring", "Dane"). Puste = wszystkie.',
            required: false,
          },
        },
      },
      async (params: { category?: string }): Promise<ToolResult> => {
        const registry = this.getRegistry();
        const filtered = params.category
          ? registry.filter((r) => r.category.toLowerCase().includes(params.category!.toLowerCase()))
          : registry;

        if (filtered.length === 0) {
          return {
            success: true,
            data: `Brak serwerów MCP w kategorii "${params.category}". Dostępne kategorie: ${[...new Set(registry.map((r) => r.category))].join(', ')}`,
          };
        }

        const list = filtered
          .map((r) => {
            const setup = r.requiresSetup ? ' ⚠️ wymaga konfiguracji (env vars/API key)' : ' ✅ gotowy do użycia';
            return `• ${r.icon} **${r.name}** [${r.id}] — ${r.description}${setup}`;
          })
          .join('\n');

        return {
          success: true,
          data: `Dostępne serwery MCP (${filtered.length}):\n\n${list}\n\nAby dodać serwer, użyj narzędzia mcp_add_and_connect z parametrem registry_id.`,
        };
      },
    );

    // ── 2. Add and connect MCP server from registry ──
    this.toolsService.register(
      {
        name: 'mcp_add_and_connect',
        description:
          'Dodaj i podłącz serwer MCP z rejestru — automatycznie instaluje i uruchamia serwer, ' +
          'odkrywa jego narzędzia i rejestruje je do użytku. Po podłączeniu nowe narzędzia będą ' +
          'natychmiast dostępne (prefiks mcp_). Użyj po znalezieniu serwera w mcp_browse_registry.',
        category: 'mcp',
        parameters: {
          registry_id: {
            type: 'string',
            description: 'ID serwera z rejestru (np. "caldav", "github", "slack", "notion", "brave-search")',
            required: true,
          },
          env_vars: {
            type: 'string',
            description:
              'Opcjonalne zmienne środowiskowe w formacie JSON: {"KEY": "value"}. Wymagane dla serwerów oznaczonych jako "wymaga konfiguracji".',
            required: false,
          },
        },
      },
      async (params: { registry_id: string; env_vars?: string }): Promise<ToolResult> => {
        const registry = this.getRegistry();
        const entry = registry.find((r) => r.id === params.registry_id);
        if (!entry) {
          return {
            success: false,
            error: `Nie znaleziono serwera "${params.registry_id}" w rejestrze. Użyj mcp_browse_registry żeby zobaczyć dostępne serwery.`,
          };
        }

        // Check if already added
        const existing = this.configs.find((c) => c.name === entry.name);
        if (existing) {
          const conn = this.connections.get(existing.id);
          if (conn?.status === 'connected') {
            return {
              success: true,
              data: `Serwer "${entry.name}" jest już podłączony z ${conn.tools.length} narzędziami: ${conn.tools.map((t) => t.name).join(', ')}`,
            };
          }
          // Reconnect existing
          try {
            await this.connect(existing.id);
            const reconnConn = this.connections.get(existing.id);
            return {
              success: true,
              data: `Ponownie podłączono "${entry.name}" — ${reconnConn?.tools.length ?? 0} narzędzi dostępnych: ${reconnConn?.tools.map((t) => t.name).join(', ') ?? 'brak'}`,
            };
          } catch (err: any) {
            return { success: false, error: `Błąd połączenia z "${entry.name}": ${err.message}` };
          }
        }

        // Parse env vars
        let env: Record<string, string> | undefined;
        if (params.env_vars) {
          try {
            env = JSON.parse(params.env_vars);
          } catch {
            return { success: false, error: 'Nieprawidłowy format env_vars — oczekiwany JSON: {"KEY": "value"}' };
          }
        }

        // Add server
        try {
          const config = {
            name: entry.name,
            transport: entry.transport,
            command: entry.command,
            args: entry.args,
            url: entry.url,
            env: { ...entry.env, ...env },
            autoConnect: true,
            enabled: true,
            icon: entry.icon,
            category: entry.category,
          };
          const server = await this.addServer(config);

          // Connect
          await this.connect(server.id);
          const conn = this.connections.get(server.id);
          const toolNames = conn?.tools.map((t) => t.name) ?? [];

          return {
            success: true,
            data:
              `✅ Serwer "${entry.name}" dodany i podłączony!\n` +
              `Odkryto ${toolNames.length} narzędzi: ${toolNames.join(', ')}\n` +
              `Narzędzia są teraz dostępne z prefiksem mcp_${entry.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_|_$/g, '')}_`,
          };
        } catch (err: any) {
          return {
            success: false,
            error:
              `Błąd dodawania serwera "${entry.name}": ${err.message}. ` +
              (entry.requiresSetup
                ? 'Ten serwer wymaga konfiguracji — upewnij się że podałeś env_vars z wymaganymi kluczami API.'
                : ''),
          };
        }
      },
    );

    // ── 3. Check MCP status ──
    this.toolsService.register(
      {
        name: 'mcp_status',
        description:
          'Sprawdź status podłączonych serwerów MCP i dostępnych narzędzi. Pokaże które serwery ' +
          'są połączone, ile mają narzędzi i ile razy zostały użyte.',
        category: 'mcp',
        parameters: {},
      },
      async (): Promise<ToolResult> => {
        const status = this.getStatus();

        if (status.servers.length === 0) {
          return {
            success: true,
            data: 'Brak skonfigurowanych serwerów MCP. Użyj mcp_browse_registry żeby znaleźć i dodać serwer.',
          };
        }

        const statusLabels: Record<string, string> = {
          connected: '🟢 połączony',
          connecting: '🟡 łączenie...',
          error: '🔴 błąd',
          disconnected: '⚪ rozłączony',
        };

        const list = status.servers
          .map((s) => {
            const state = statusLabels[s.status] || s.status;
            const tools =
              s.tools.length > 0
                ? `(${s.tools.length} tools: ${s.tools.map((t) => t.name).join(', ')})`
                : '(brak narzędzi)';
            const error = s.error ? ` — ${s.error}` : '';
            return `• ${s.icon || '🔌'} ${s.name}: ${state} ${tools}${error}`;
          })
          .join('\n');

        return {
          success: true,
          data: `MCP Hub — ${status.connectedCount}/${status.servers.length} połączonych, ${status.totalTools} narzędzi łącznie:\n\n${list}`,
        };
      },
    );

    // ── 4. Disconnect MCP server ──
    this.toolsService.register(
      {
        name: 'mcp_disconnect_server',
        description: 'Rozłącz serwer MCP. Narzędzia z tego serwera przestaną być dostępne.',
        category: 'mcp',
        parameters: {
          server_name: {
            type: 'string',
            description: 'Nazwa serwera MCP do rozłączenia (np. "CalDAV Calendar", "GitHub")',
            required: true,
          },
        },
      },
      async (params: { server_name: string }): Promise<ToolResult> => {
        const server = this.configs.find((c) => c.name.toLowerCase().includes(params.server_name.toLowerCase()));
        if (!server) {
          return { success: false, error: `Nie znaleziono serwera "${params.server_name}"` };
        }
        await this.disconnect(server.id);
        return { success: true, data: `Rozłączono serwer "${server.name}"` };
      },
    );

    log.info('Registered 4 MCP management tools (browse_registry, add_and_connect, status, disconnect)');
  }

  // ─── Private Methods ───

  /**
   * Create MCP client + transport based on config.
   */
  private async createConnection(config: McpServerConfig): Promise<{ client: Client; transport: Transport }> {
    const timeout = config.timeout ?? 30_000;
    // stdio transports (npx) often need more time for initial package download
    const stdioTimeout = config.timeout ?? 60_000;

    if (config.transport === 'stdio') {
      if (!config.command) throw new Error('stdio transport requires a command');

      const client = new Client({ name: 'kxai', version: '1.0.0' });

      // Build spawn options for StdioClientTransport:
      // 1. shell: true on Windows — required because npx/node are .cmd scripts
      //    that cannot be spawned directly by child_process.spawn()
      // 2. env: merge process.env with server-specific env vars
      //    (without ...process.env the child gets NO env → can't find node/npm)
      // 3. cwd: user's home directory — CRITICAL: in packaged Electron apps,
      //    the default cwd is inside app.asar (read-only). npx needs a writable
      //    directory to cache downloaded packages.
      const isWindows = process.platform === 'win32';
      const mergedEnv = { ...process.env, ...config.env } as Record<string, string>;

      // Use user's home directory as cwd to avoid ASAR/read-only filesystem issues
      const safeCwd = os.homedir();

      const spawnOpts: Record<string, unknown> = {
        env: mergedEnv,
        shell: isWindows,
        cwd: safeCwd,
      };

      log.info(
        `[MCP:${config.name}] Spawning: ${config.command} ${(config.args || []).join(' ')} (cwd=${safeCwd}, shell=${isWindows})`,
      );

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        ...spawnOpts,
      });

      // Listen for stderr output from the child process for diagnostics
      transport.onerror = (err) => {
        log.error(`[MCP:${config.name}] Transport error:`, err.message || err);
      };

      // Capture stderr from child process for better diagnostics
      // StdioClientTransport exposes the child process after start()
      const origStart = transport.start.bind(transport);
      transport.start = async function (...args: Parameters<typeof transport.start>) {
        const result = await origStart(...args);
        // Access the internal child process stderr if available
        const proc = (transport as any)._process;
        if (proc?.stderr) {
          proc.stderr.on('data', (data: Buffer) => {
            const text = data.toString().trim();
            if (text) {
              log.warn(`[MCP:${config.name}] stderr: ${text.slice(0, 500)}`);
            }
          });
        }
        return result;
      };

      // Log when the stdio transport closes (child process exit)
      transport.onclose = () => {
        log.warn(`[MCP:${config.name}] Transport closed (child process exited)`);
        const conn = this.connections.get(config.id);
        if (conn && conn.status === 'connected') {
          conn.status = 'error';
          conn.error = 'Process exited unexpectedly';
          this.stopHeartbeat(conn);
          this.pushStatus();

          // Auto-reconnect with exponential backoff
          this.scheduleReconnect(conn);
        }
      };

      // Race connect against a timeout — stdio has no built-in timeout
      // and npx may hang downloading packages or waiting for auth
      const connectPromise = client.connect(transport);
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                `Timeout po ${stdioTimeout / 1000}s — serwer nie odpowiedział. Sprawdź czy pakiet jest dostępny i czy konfiguracja (env vars / OAuth) jest poprawna.`,
              ),
            ),
          stdioTimeout,
        );
      });

      try {
        await Promise.race([connectPromise, timeoutPromise]);
        clearTimeout(timeoutId!);
      } catch (err) {
        clearTimeout(timeoutId!);
        // Clean up the transport on timeout
        try {
          await transport.close();
        } catch {
          /* ignore */
        }
        throw err;
      }

      return { client, transport };
    }

    if (!config.url) throw new Error('HTTP/SSE transport requires a URL');
    const baseUrl = new URL(config.url);

    if (config.transport === 'streamable-http') {
      // Try Streamable HTTP first, fallback to SSE
      try {
        const client = new Client({ name: 'kxai', version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(baseUrl, {
          requestInit: { signal: AbortSignal.timeout(timeout) },
        });
        await client.connect(transport);
        return { client, transport };
      } catch {
        log.info(`Streamable HTTP failed for "${config.name}", trying SSE fallback...`);
        const client = new Client({ name: 'kxai', version: '1.0.0' });
        const transport = new SSEClientTransport(baseUrl);
        await client.connect(transport);
        return { client, transport };
      }
    }

    // SSE transport
    const client = new Client({ name: 'kxai', version: '1.0.0' });
    const transport = new SSEClientTransport(baseUrl);
    await client.connect(transport);
    return { client, transport };
  }

  /**
   * Register discovered MCP tools with the ToolsService.
   * Tools are prefixed with `mcp_{serverName}_` to avoid name collisions.
   */
  private registerMcpTools(conn: McpConnection): void {
    if (!this.toolsService) {
      log.warn('ToolsService not available — MCP tools will not be registered');
      return;
    }

    const serverSlug = conn.config.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    for (const tool of conn.tools) {
      const toolName = `mcp_${serverSlug}_${tool.name}`;

      // Convert MCP JSON Schema to KxAI parameter format
      const parameters = this.convertMcpParams(tool.inputSchema);

      const definition: ToolDefinition = {
        name: toolName,
        description: `[MCP: ${conn.config.name}] ${tool.description || tool.name}`,
        category: 'mcp',
        parameters,
      };

      const handler = async (params: any): Promise<ToolResult> => {
        return this.callTool(conn.config.id, tool.name, params);
      };

      this.toolsService.register(definition, handler);
      conn.registeredToolNames.push(toolName);
    }

    log.info(`Registered ${conn.registeredToolNames.length} MCP tools from "${conn.config.name}"`);
  }

  /**
   * Unregister MCP tools when disconnecting.
   */
  private unregisterMcpTools(conn: McpConnection): void {
    if (!this.toolsService || conn.registeredToolNames.length === 0) return;

    for (const toolName of conn.registeredToolNames) {
      this.toolsService.unregister(toolName);
    }

    log.info(`Unregistered ${conn.registeredToolNames.length} MCP tools from "${conn.config.name}"`);
    conn.registeredToolNames = [];
  }

  /**
   * Convert MCP JSON Schema to KxAI parameter format.
   */
  private convertMcpParams(
    inputSchema?: Record<string, unknown>,
  ): Record<string, { type: string; description: string; required?: boolean }> {
    if (!inputSchema) return {};

    const properties = (inputSchema.properties ?? {}) as Record<string, any>;
    const required = (inputSchema.required ?? []) as string[];
    const result: Record<string, { type: string; description: string; required?: boolean }> = {};

    for (const [key, schema] of Object.entries(properties)) {
      result[key] = {
        type: schema.type ?? 'string',
        description: schema.description ?? key,
        required: required.includes(key),
      };
    }

    return result;
  }

  /**
   * Push status to renderer via IPC.
   */
  private pushStatus(): void {
    if (!this.mainWindow?.webContents) return;
    try {
      this.mainWindow.webContents.send('mcp:status', this.getStatus());
    } catch {
      // Window may be destroyed
    }
  }

  /**
   * Load saved MCP server configs from app config.
   */
  private async loadConfigs(): Promise<void> {
    try {
      if (this.configService) {
        const mcpServers = this.configService.get('mcpServers');
        this.configs = mcpServers ?? [];
        log.info(`Loaded ${this.configs.length} MCP server configs`);
      }
    } catch (err: any) {
      log.warn(`Failed to load MCP configs: ${err.message}`);
      this.configs = [];
    }
  }

  /**
   * Save MCP server configs to app config.
   */
  private async saveConfigs(): Promise<void> {
    try {
      if (this.configService) {
        this.configService.set('mcpServers', this.configs);
      }
    } catch (err: any) {
      log.warn(`Failed to save MCP configs: ${err.message}`);
    }
  }
}
