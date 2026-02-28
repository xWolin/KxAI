[electron] npm error 404 Note that you can also install from a
[electron] npm error 404 tarball, folder, http url, or git url.
[electron] npm error A complete log of this run can be found in: C:\Users\xwoli\AppData\Local\npm-cache\_logs\2026-02-27T12_50_16_418Z-debug-0.log
[electron] [McpClient] Failed to connect to "Docker": MCP error -32000: Connection closed
[electron] [McpClient] Auto-connect failed for "Docker": MCP error -32000: Connection closed
[electron] Skip checkForUpdates because application is not packed and dev update config is not forced
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenMonitor] Stopped
[electron] [ScreenMonitor] Started — T0: 2s, T1: 12s, T2 periodic: 3min
[electron] [ProactiveEngine] Stopped proactive engine
[electron] [ProactiveEngine] Started proactive engine (interval: 60s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenMonitor] Periodic T2 — 2 screen(s) captured
[electron] [ScreenMonitor] Periodic T2 vision check — window: KxAI, 2 screen(s)
[electron] [IPC] [Proactive] T2 callback triggered — starting AI analysis (2 screen(s))...
[electron] [AnthropicProvider] Anthropic client initialized
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [RAG] File watcher: 2 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 2 files changed
[electron] [DatabaseService] Upserted 18 RAG chunks
[electron] [EmbeddingService] Batch embedding failed: 429 You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.
[electron] [EmbeddingService] Disabling OpenAI embeddings due to quota/auth error. Using TF-IDF fallback.
[electron] [DatabaseService] Failed to upsert chunk embeddings batch: SqliteError: Dimension mismatch for inserted vector for the "embedding" column. Expected 3072 dimensions but received 256.
[electron]     at E:\Programowanie\KxAI\dist\main\services\database-service.js:924:22
[electron]     at sqliteTransaction (E:\Programowanie\KxAI\node_modules\better-sqlite3\lib\methods\transaction.js:65:24)    
[electron]     at DatabaseService.upsertChunkEmbeddings (E:\Programowanie\KxAI\dist\main\services\database-service.js:928:13)
[electron]     at RAGService.incrementalReindex (E:\Programowanie\KxAI\dist\main\services\rag-service.js:649:40)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\rag-service.js:1306:25) {
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [DatabaseService] Vector search failed: SqliteError: Dimension mismatch for query vector for the "embedding" column. Expected 3072 dimensions but received 256.
[electron]     at DatabaseService.vectorSearch (E:\Programowanie\KxAI\dist\main\services\database-service.js:951:18)        
[electron]     at DatabaseService.hybridSearch (E:\Programowanie\KxAI\dist\main\services\database-service.js:1002:20)       
[electron]     at RAGService.search (E:\Programowanie\KxAI\dist\main\services\rag-service.js:674:46)
[electron]     at async RAGService.buildRAGContext (E:\Programowanie\KxAI\dist\main\services\rag-service.js:697:25)
[electron]     at async AgentLoop._streamWithToolsInner (E:\Programowanie\KxAI\dist\main\services\agent-loop.js:528:30)     
[electron]     at async AgentLoop.streamWithTools (E:\Programowanie\KxAI\dist\main\services\agent-loop.js:451:20)
[electron]     at async E:\Programowanie\KxAI\dist\main\ipc.js:100:13
[electron]     at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:89248) {
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [RAG] File watcher: 1 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 1 files changed
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [AgentLoop] AgentLoop: continueWithToolResults failed: RateLimitError: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your organization's rate limit of 30,000 input tokens per minute (org: 679abe92-92c4-46b0-a952-e528847bd206, model: claude-opus-4-6). For details, refer to: https://docs.claude.com/en/api/rate-limits. You can see the response headers for current usage. Please reduce the prompt length or the maximum tokens requested, or try again later. You may also contact sales at https://www.anthropic.com/contact-sales to discuss your options for a rate limit increase."},"request_id":"req_011CYYc3J1X8TQSFat6bg7VX"}
[electron]     at APIError.generate (E:\Programowanie\KxAI\node_modules\@anthropic-ai\sdk\error.js:59:20)
[electron]     at Anthropic.makeStatusError (E:\Programowanie\KxAI\node_modules\@anthropic-ai\sdk\core.js:292:33)
[electron]     at Anthropic.makeRequest (E:\Programowanie\KxAI\node_modules\@anthropic-ai\sdk\core.js:336:30)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async MessageStream._createMessage (E:\Programowanie\KxAI\node_modules\@anthropic-ai\sdk\lib\MessageStream.js:116:24) {
[electron]   status: 429,
[electron]   headers: {
[electron]     'anthropic-organization-id': '679abe92-92c4-46b0-a952-e528847bd206',
[electron]     'anthropic-ratelimit-input-tokens-limit': '30000',
[electron]     'anthropic-ratelimit-input-tokens-remaining': '0',
[electron]     'anthropic-ratelimit-input-tokens-reset': '2026-02-27T12:53:25Z',
[electron]     'anthropic-ratelimit-output-tokens-limit': '8000',
[electron]     'anthropic-ratelimit-output-tokens-remaining': '8000',
[electron]     'anthropic-ratelimit-output-tokens-reset': '1970-01-01T00:00:00Z',
[electron]     'anthropic-ratelimit-requests-limit': '50',
[electron]     'anthropic-ratelimit-requests-remaining': '50',
[electron]     'anthropic-ratelimit-requests-reset': '2026-02-27T12:52:07Z',
[electron]     'anthropic-ratelimit-tokens-limit': '38000',
[electron]     'anthropic-ratelimit-tokens-remaining': '8000',
[electron]     'anthropic-ratelimit-tokens-reset': '1970-01-01T00:00:00Z',
[electron]     'cf-cache-status': 'DYNAMIC',
[electron]     'cf-ray': '9d47d146ac36eeb7-WAW',
[electron]     connection: 'keep-alive',
[electron]     'content-length': '593',
[electron]     'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
[electron]     'content-type': 'application/json',
[electron]     date: 'Fri, 27 Feb 2026 12:52:07 GMT',
[electron]     'request-id': 'req_011CYYc3J1X8TQSFat6bg7VX',
[electron]     'retry-after': '58',
[electron]     server: 'cloudflare',
[electron]     'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
[electron]     'x-envoy-upstream-service-time': '239',
[electron]     'x-robots-tag': 'none',
[electron]     'x-should-retry': 'true'
[electron]   },
[electron]   request_id: 'req_011CYYc3J1X8TQSFat6bg7VX',
[electron]   error: {
[electron]     type: 'error',
[electron]     error: {
[electron]       type: 'rate_limit_error',
[electron]       message: "This request would exceed your organization's rate limit of 30,000 input tokens per minute (org: 679abe92-92c4-46b0-a952-e528847bd206, model: claude-opus-4-6). For details, refer to: https://docs.claude.com/en/api/rate-limits. You can see the response headers for current usage. Please reduce the prompt length or the maximum tokens requested, or try again later. You may also contact sales at https://www.anthropic.com/contact-sales to discuss your options for a rate limit increase."
[electron]     },
[electron]     request_id: 'req_011CYYc3J1X8TQSFat6bg7VX'
[electron]   }
[electron] }
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenMonitor] Stopped
[electron] [ScreenMonitor] Started — T0: 2s, T1: 12s, T2 periodic: 3min
[electron] [ProactiveEngine] Stopped proactive engine
[electron] [ProactiveEngine] Started proactive engine (interval: 60s)
[electron] [DatabaseService] Vector search failed: SqliteError: Dimension mismatch for query vector for the "embedding" column. Expected 3072 dimensions but received 256.
[electron]     at DatabaseService.vectorSearch (E:\Programowanie\KxAI\dist\main\services\database-service.js:951:18)
[electron]     at DatabaseService.hybridSearch (E:\Programowanie\KxAI\dist\main\services\database-service.js:1002:20)
[electron]     at RAGService.search (E:\Programowanie\KxAI\dist\main\services\rag-service.js:674:46)
[electron]     at async RAGService.buildRAGContext (E:\Programowanie\KxAI\dist\main\services\rag-service.js:697:25)
[electron]     at async AgentLoop._streamWithToolsInner (E:\Programowanie\KxAI\dist\main\services\agent-loop.js:528:30)
[electron]     at async AgentLoop.streamWithTools (E:\Programowanie\KxAI\dist\main\services\agent-loop.js:451:20)
[electron]     at async E:\Programowanie\KxAI\dist\main\ipc.js:100:13
[electron]     at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:89248) {
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [ScreenCapture] Capturing 2 display(s)
[electron]     at async E:\Programowanie\KxAI\dist\main\ipc.js:100:13
[electron]     at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:89248) {
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [ScreenCapture] Capturing 2 display(s)
[electron]     at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:89248) {
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [ScreenCapture] Capturing 2 display(s)
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] }
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenMonitor] Periodic T2 — 2 screen(s) captured
[electron] [ScreenMonitor] Periodic T2 — 2 screen(s) captured
[electron] [ScreenMonitor] Periodic T2 vision check — window: KxAI, 2 screen(s)
[electron] [ScreenMonitor] Periodic T2 vision check — window: KxAI, 2 screen(s)
[electron] [IPC] [Proactive] T2 callback triggered — starting AI analysis (2 screen(s))...
[electron] [IPC] [Proactive] T2 callback triggered — starting AI analysis (2 screen(s))...
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [RAG] File watcher: 2 files changed, incremental reindex
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [RAG] File watcher: 2 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 2 files changed
[electron] [DatabaseService] Upserted 19 RAG chunks
[electron] [RAGService] Incremental reindex: 2 files changed
[electron] [DatabaseService] Upserted 19 RAG chunks
[electron] [DatabaseService] Upserted 19 RAG chunks
[electron] [DatabaseService] Failed to upsert chunk embeddings batch: SqliteError: Dimension mismatch for inserted vector fo[electron] [DatabaseService] Failed to upsert chunk embeddings batch: SqliteError: Dimension mismatch for inserted vector for the "embedding" column. Expected 3072 dimensions but received 256.
[electron]     at E:\Programowanie\KxAI\dist\main\services\database-service.js:924:22
[electron]     at sqliteTransaction (E:\Programowanie\KxAI\node_modules\better-sqlite3\lib\methods\transaction.js:65:24)    
[electron]     at DatabaseService.upsertChunkEmbeddings (E:\Programowanie\KxAI\dist\main\services\database-service.js:928:13)
[electron]     at RAGService.incrementalReindex (E:\Programowanie\KxAI\dist\main\services\rag-service.js:649:40)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\rag-service.js:1306:25) {
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [DatabaseService] Vector search failed: SqliteError: Dimension mismatch for query vector for the "embedding" column. Expected 3072 dimensions but received 256.
[electron]     at DatabaseService.vectorSearch (E:\Programowanie\KxAI\dist\main\services\database-service.js:951:18)        
[electron]     at DatabaseService.hybridSearch (E:\Programowanie\KxAI\dist\main\services\database-service.js:1002:20)       
[electron]     at RAGService.search (E:\Programowanie\KxAI\dist\main\services\rag-service.js:674:46)
[electron]     at async RAGService.buildRAGContext (E:\Programowanie\KxAI\dist\main\services\rag-service.js:697:25)
[electron]     at async AgentLoop._streamWithToolsInner (E:\Programowanie\KxAI\dist\main\services\agent-loop.js:528:30)     
[electron]     at async AgentLoop.streamWithTools (E:\Programowanie\KxAI\dist\main\services\agent-loop.js:451:20)
[electron]     at async E:\Programowanie\KxAI\dist\main\ipc.js:100:13
[electron]     at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:89248) {
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenMonitor] Periodic T2 — 2 screen(s) captured
[electron] [ScreenMonitor] Periodic T2 vision check — window: KxAI, 2 screen(s)
[electron] [IPC] [Proactive] T2 callback triggered — starting AI analysis (2 screen(s))...
[electron] [ScreenCapture] Capturing 2 display(s)
[electron] [ScreenCapture] Captured 2/2 screen(s)
[electron] [ScreenMonitor] Stopped
[electron] [ProactiveEngine] Stopped proactive engine
[electron] [RAG] File watcher: 2 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 2 files changed
[electron] [DatabaseService] Upserted 20 RAG chunks
[electron] [DatabaseService] Failed to upsert chunk embeddings batch: SqliteError: Dimension mismatch for inserted vector for the "embedding" column. Expected 3072 dimensions but received 256.
[electron]     at E:\Programowanie\KxAI\dist\main\services\database-service.js:924:22
[electron]     at sqliteTransaction (E:\Programowanie\KxAI\node_modules\better-sqlite3\lib\methods\transaction.js:65:24)    
[electron]     at DatabaseService.upsertChunkEmbeddings (E:\Programowanie\KxAI\dist\main\services\database-service.js:928:13)
[electron]     at RAGService.incrementalReindex (E:\Programowanie\KxAI\dist\main\services\rag-service.js:649:40)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\rag-service.js:1306:25) {
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [ReflectionEngine] Running reflection cycle: deep
[electron] [RAG] File watcher: 3 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 3 files changed
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 3 RAG chunks
[electron] [DatabaseService] Upserted 3 chunk embeddings
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "memo"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ReflectionEngine] Reflection cycle 'deep' completed (10 insights, 0 cron proposals, 0 MCP proposals)
[electron] [ReflectionEngine] Running reflection cycle: evening
[electron] [RAG] File watcher: 3 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 3 files changed
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 3 RAG chunks
[electron] [DatabaseService] Upserted 3 chunk embeddings
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "memo"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async ReflectionEngine._checkScheduledCycles (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:149:13)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:117:13)
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async ReflectionEngine._checkScheduledCycles (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:149:13)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:117:13)
[electron] [ReflectionEngine] Reflection cycle 'evening' completed (10 insights, 0 cron proposals, 0 MCP proposals)
[electron] Skip checkForUpdates because application is not packed and dev update config is not forced
[electron] [ReflectionEngine] Running reflection cycle: deep
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "memo"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ReflectionEngine] Reflection cycle 'deep' completed (5 insights, 0 cron proposals, 0 MCP proposals)
[electron] [ReflectionEngine] Running reflection cycle: deep
[electron] [RAG] File watcher: 3 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 3 files changed
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 3 RAG chunks
[electron] [DatabaseService] Upserted 3 chunk embeddings
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "memo"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ReflectionEngine] Reflection cycle 'deep' completed (7 insights, 0 cron proposals, 0 MCP proposals)
[electron] Skip checkForUpdates because application is not packed and dev update config is not forced
[electron] [ReflectionEngine] Running reflection cycle: deep
[electron] [RAG] File watcher: 3 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 3 files changed
[electron] [DatabaseService] Upserted 3 RAG chunks
[electron] [DatabaseService] Upserted 3 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ReflectionEngine] Reflection cycle 'deep' completed (0 insights, 0 cron proposals, 0 MCP proposals)
[electron] [ReflectionEngine] Running reflection cycle: deep
[electron] [RAG] File watcher: 3 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 3 files changed
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 3 RAG chunks
[electron] [DatabaseService] Upserted 3 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "memo"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ReflectionEngine] Reflection cycle 'deep' completed (8 insights, 0 cron proposals, 0 MCP proposals)
[electron] Skip checkForUpdates because application is not packed and dev update config is not forced
[electron] [ReflectionEngine] Running reflection cycle: deep
[electron] [RAG] File watcher: 3 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 3 files changed
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 3 RAG chunks
[electron] [DatabaseService] Upserted 3 chunk embeddings
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "memo"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ReflectionEngine] Reflection cycle 'deep' completed (0 insights, 0 cron proposals, 0 MCP proposals)
[electron] [ReflectionEngine] Running reflection cycle: deep
[electron] [RAG] File watcher: 3 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 3 files changed
[electron] [DatabaseService] Upserted 3 RAG chunks
[electron] [DatabaseService] Upserted 3 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "memo"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ReflectionEngine] Reflection cycle 'deep' completed (0 insights, 0 cron proposals, 0 MCP proposals)
[electron] Skip checkForUpdates because application is not packed and dev update config is not forced
[electron] [ReflectionEngine] Running reflection cycle: deep
[electron] [RAG] File watcher: 3 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 3 files changed
[electron] [DatabaseService] Upserted 3 RAG chunks
[electron] [DatabaseService] Upserted 3 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "memo"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ReflectionEngine] Reflection cycle 'deep' completed (0 insights, 0 cron proposals, 0 MCP proposals)
[electron] [ReflectionEngine] Running reflection cycle: deep
[electron] [RAG] File watcher: 3 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 3 files changed
[electron] [DatabaseService] Upserted 3 RAG chunks
[electron] [DatabaseService] Upserted 3 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [ResponseProcessor] Invalid cron suggestion schema: [
[electron]   {
[electron]     "expected": "string",
[electron]     "code": "invalid_type",
[electron]     "path": [
[electron]       "action"
[electron]     ],
[electron]     "message": "Invalid input: expected string, received undefined"
[electron]   }
[electron] ]
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "user"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ResponseProcessor] Failed to parse memory update JSON: SyntaxError: Unexpected token 'i', "file: "memo"... is not valid JSON
[electron]     at JSON.parse (<anonymous>)
[electron]     at ResponseProcessor.processMemoryUpdates (E:\Programowanie\KxAI\dist\main\services\response-processor.js:133:34)
[electron]     at ResponseProcessor.postProcess (E:\Programowanie\KxAI\dist\main\services\response-processor.js:50:50)      
[electron]     at ReflectionEngine._runCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:237:57)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async ReflectionEngine._safeRunCycle (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:178:28)
[electron]     at async Timeout._onTimeout (E:\Programowanie\KxAI\dist\main\services\reflection-engine.js:113:13)
[electron] [ReflectionEngine] Reflection cycle 'deep' completed (0 insights, 0 cron proposals, 0 MCP proposals)
[electron] [DatabaseService] Vector search failed: SqliteError: Dimension mismatch for query vector for the "embedding" column. Expected 3072 dimensions but received 256.
[electron]     at DatabaseService.vectorSearch (E:\Programowanie\KxAI\dist\main\services\database-service.js:951:18)        
[electron]     at DatabaseService.hybridSearch (E:\Programowanie\KxAI\dist\main\services\database-service.js:1002:20)       
[electron]     at RAGService.search (E:\Programowanie\KxAI\dist\main\services\rag-service.js:674:46)
[electron]     at async RAGService.buildRAGContext (E:\Programowanie\KxAI\dist\main\services\rag-service.js:697:25)
[electron]     at async AgentLoop._streamWithToolsInner (E:\Programowanie\KxAI\dist\main\services\agent-loop.js:528:30)     
[electron]     at async AgentLoop.streamWithTools (E:\Programowanie\KxAI\dist\main\services\agent-loop.js:451:20)
[electron]     at async E:\Programowanie\KxAI\dist\main\ipc.js:100:13
[electron]     at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:89248) {
[electron]   code: 'SQLITE_ERROR'
[electron] }
[electron] [RAG] File watcher: 1 files changed, incremental reindex
[electron] [RAGService] Incremental reindex: 1 files changed
[electron] [DatabaseService] Upserted 4 RAG chunks
[electron] [DatabaseService] Upserted 4 chunk embeddings
[electron] [AgentLoop] AgentLoop: continueWithToolResults failed: RateLimitError: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your organization's rate limit of 30,000 input tokens per minute (org: 679abe92-92c4-46b0-a952-e528847bd206, model: claude-sonnet-4-6). For details, refer to: https://docs.claude.com/en/api/rate-limits. You can see the response headers for current usage. Please reduce the prompt length or the maximum tokens requested, or try again later. You may also contact sales at https://www.anthropic.com/contact-sales to discuss your options for a rate limit increase."},"request_id":"req_011CYa5tJuNCBbv7siMAN22V"}
[electron]     at APIError.generate (E:\Programowanie\KxAI\node_modules\@anthropic-ai\sdk\error.js:59:20)
[electron]     at Anthropic.makeStatusError (E:\Programowanie\KxAI\node_modules\@anthropic-ai\sdk\core.js:292:33)
[electron]     at Anthropic.makeRequest (E:\Programowanie\KxAI\node_modules\@anthropic-ai\sdk\core.js:336:30)
[electron]     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
[electron]     at async MessageStream._createMessage (E:\Programowanie\KxAI\node_modules\@anthropic-ai\sdk\lib\MessageStream.js:116:24) {
[electron]   status: 429,
[electron]   headers: {
[electron]     'anthropic-organization-id': '679abe92-92c4-46b0-a952-e528847bd206',
[electron]     'anthropic-ratelimit-input-tokens-limit': '30000',
[electron]     'anthropic-ratelimit-input-tokens-remaining': '0',
[electron]     'anthropic-ratelimit-input-tokens-reset': '2026-02-28T07:39:14Z',
[electron]     'anthropic-ratelimit-output-tokens-limit': '8000',
[electron]     'anthropic-ratelimit-output-tokens-remaining': '8000',
[electron]     'anthropic-ratelimit-output-tokens-reset': '1970-01-01T00:00:00Z',
[electron]     'anthropic-ratelimit-requests-limit': '50',
[electron]     'anthropic-ratelimit-requests-remaining': '50',
[electron]     'anthropic-ratelimit-requests-reset': '2026-02-28T07:37:51Z',
[electron]     'anthropic-ratelimit-tokens-limit': '38000',
[electron]     'anthropic-ratelimit-tokens-remaining': '8000',
[electron]     'anthropic-ratelimit-tokens-reset': '1970-01-01T00:00:00Z',
[electron]     'cf-cache-status': 'DYNAMIC',
[electron]     'cf-ray': '9d4e4251784db6b9-WAW',
[electron]     connection: 'keep-alive',
[electron]     'content-encoding': 'gzip',
[electron]     'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
[electron]     'content-type': 'application/json',
[electron]     date: 'Sat, 28 Feb 2026 07:37:51 GMT',
[electron]     'request-id': 'req_011CYa5tJuNCBbv7siMAN22V',
[electron]     'retry-after': '61',
[electron]     server: 'cloudflare',
[electron]     'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
[electron]     'transfer-encoding': 'chunked',
[electron]     vary: 'Accept-Encoding',
[electron]     'x-envoy-upstream-service-time': '137',
[electron]     'x-robots-tag': 'none',
[electron]     'x-should-retry': 'true'
[electron]   },
[electron]   request_id: 'req_011CYa5tJuNCBbv7siMAN22V',
[electron]   error: {
[electron]     type: 'error',
[electron]     error: {
[electron]       type: 'rate_limit_error',
[electron]       message: "This request would exceed your organization's rate limit of 30,000 input tokens per minute (org: 679abe92-92c4-46b0-a952-e528847bd206, model: claude-sonnet-4-6). For details, refer to: https://docs.claude.com/en/api/rate-limits. You can see the response headers for current usage. Please reduce the prompt length or the maximum tokens requested, or try again later. You may also contact sales at https://www.anthropic.com/contact-sales to discuss your options for a rate limit increase."
[electron]     },
[electron]     request_id: 'req_011CYa5tJuNCBbv7siMAN22V'
[electron]   }
[electron] }




























