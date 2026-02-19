import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { EmbeddingService } from './embedding-service';

/**
 * Chunk — fragment pliku pamięci z metadanymi.
 */
export interface RAGChunk {
  id: string;
  filePath: string;
  fileName: string;
  section: string;
  content: string;
  embedding?: number[];
  charCount: number;
}

export interface RAGSearchResult {
  chunk: RAGChunk;
  score: number;
}

/**
 * RAGService — Retrieval-Augmented Generation pipeline:
 * 1. Indeksuje pliki .md z workspace/memory/ i workspace root
 * 2. Dzieli na chunki po sekcjach (## headers)
 * 3. Generuje embeddingi (OpenAI lub TF-IDF fallback)
 * 4. Semantic search via cosine similarity
 */
export class RAGService {
  private embeddingService: EmbeddingService;
  private workspacePath: string;
  private indexPath: string;
  private chunks: RAGChunk[] = [];
  private indexed = false;
  private indexing = false;

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService;
    const userDataPath = app.getPath('userData');
    this.workspacePath = path.join(userDataPath, 'workspace');
    this.indexPath = path.join(userDataPath, 'workspace', 'rag', 'index.json');
  }

  /**
   * Initialize RAG — load existing index or build new one.
   */
  async initialize(): Promise<void> {
    const loaded = this.loadIndex();
    if (!loaded) {
      await this.reindex();
    }
  }

  /**
   * Full reindex — scan all memory files, chunk, embed.
   */
  async reindex(): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;

    try {
      console.log('RAGService: Reindexing memory files...');

      // Collect all markdown files
      const mdFiles = this.collectMarkdownFiles();
      console.log(`RAGService: Found ${mdFiles.length} markdown files`);

      // Chunk files
      const newChunks: RAGChunk[] = [];
      const allTexts: string[] = [];

      for (const filePath of mdFiles) {
        const fileChunks = this.chunkFile(filePath);
        newChunks.push(...fileChunks);
        allTexts.push(...fileChunks.map((c) => c.content));
      }

      console.log(`RAGService: Created ${newChunks.length} chunks`);

      // Build IDF for TF-IDF fallback
      if (!this.embeddingService.hasOpenAI()) {
        this.embeddingService.buildIDF(allTexts);
      }

      // Generate embeddings in batch
      if (newChunks.length > 0) {
        const embeddings = await this.embeddingService.embedBatch(allTexts);
        for (let i = 0; i < newChunks.length; i++) {
          newChunks[i].embedding = embeddings[i];
        }
      }

      this.chunks = newChunks;
      this.indexed = true;
      this.saveIndex();

      console.log(`RAGService: Indexing complete. ${this.chunks.length} chunks indexed.`);
    } catch (err) {
      console.error('RAGService: Reindex failed:', err);
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Semantic search — find most relevant chunks for a query.
   */
  async search(query: string, topK: number = 5, minScore: number = 0.3): Promise<RAGSearchResult[]> {
    if (!this.indexed || this.chunks.length === 0) {
      await this.reindex();
      if (!this.indexed) {
        throw new Error('RAG service not indexed: reindex failed');
      }
    }

    const queryEmbedding = await this.embeddingService.embed(query);

    const scored: RAGSearchResult[] = [];
    for (const chunk of this.chunks) {
      if (!chunk.embedding) continue;
      const score = this.embeddingService.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= minScore) {
        scored.push({ chunk, score });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Build RAG context for AI — inject relevant memory into system prompt.
   */
  async buildRAGContext(query: string, maxTokens: number = 2000): Promise<string> {
    const results = await this.search(query, 8);
    if (results.length === 0) return '';

    const lines: string[] = ['## Relevantne fragmenty pamięci (RAG)\n'];
    let currentTokens = 0;

    for (const { chunk, score } of results) {
      const chunkText = `### ${chunk.fileName} > ${chunk.section}\n${chunk.content}\n(score: ${score.toFixed(2)})\n`;
      const approxTokens = chunkText.length / 4; // rough estimation

      if (currentTokens + approxTokens > maxTokens) break;

      lines.push(chunkText);
      currentTokens += approxTokens;
    }

    return lines.join('\n');
  }

  /**
   * Get index stats.
   */
  getStats(): { totalChunks: number; totalFiles: number; indexed: boolean; embeddingType: 'openai' | 'tfidf' } {
    const files = new Set(this.chunks.map((c) => c.filePath));
    return {
      totalChunks: this.chunks.length,
      totalFiles: files.size,
      indexed: this.indexed,
      embeddingType: this.embeddingService.hasOpenAI() ? 'openai' : 'tfidf',
    };
  }

  // ─── File Collection ───

  private collectMarkdownFiles(): string[] {
    const files: string[] = [];

    // Root workspace .md files (SOUL.md, USER.md, MEMORY.md)
    this.scanDir(this.workspacePath, files, false);

    // memory/ directory (recursive)
    const memoryDir = path.join(this.workspacePath, 'memory');
    if (fs.existsSync(memoryDir)) {
      this.scanDir(memoryDir, files, true);
    }

    return files;
  }

  private scanDir(dir: string, files: string[], recursive: boolean): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        } else if (entry.isDirectory() && recursive && !entry.name.startsWith('.') && entry.name !== 'rag') {
          this.scanDir(fullPath, files, true);
        }
      }
    } catch { /* ignore unreadable dirs */ }
  }

  // ─── Chunking ───

  private chunkFile(filePath: string): RAGChunk[] {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      return [];
    }

    const relativePath = path.relative(this.workspacePath, filePath);
    const fileName = path.basename(filePath, '.md');
    const chunks: RAGChunk[] = [];

    // Split by ## headers
    const sections = this.splitByHeaders(content);

    for (const section of sections) {
      // Skip very short chunks
      if (section.content.trim().length < 20) continue;

      // If chunk is too large, split into sub-chunks (~500 chars each)
      const subChunks = this.splitLargeChunk(section.content, 1500);

      for (let i = 0; i < subChunks.length; i++) {
        const subSection = subChunks.length > 1
          ? `${section.header} (${i + 1}/${subChunks.length})`
          : section.header;

        chunks.push({
          id: `${relativePath}:${subSection}:${i}`,
          filePath: relativePath,
          fileName,
          section: subSection,
          content: subChunks[i],
          charCount: subChunks[i].length,
        });
      }
    }

    return chunks;
  }

  private splitByHeaders(content: string): Array<{ header: string; content: string }> {
    const lines = content.split('\n');
    const sections: Array<{ header: string; content: string }> = [];
    let currentHeader = 'Intro';
    let currentLines: string[] = [];

    for (const line of lines) {
      const headerMatch = line.match(/^#{1,3}\s+(.+)$/);
      if (headerMatch) {
        // Save previous section
        if (currentLines.length > 0) {
          sections.push({
            header: currentHeader,
            content: currentLines.join('\n').trim(),
          });
        }
        currentHeader = headerMatch[1].trim();
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    // Save last section
    if (currentLines.length > 0) {
      sections.push({
        header: currentHeader,
        content: currentLines.join('\n').trim(),
      });
    }

    return sections;
  }

  private splitLargeChunk(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];

    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/);
    let current = '';

    for (const para of paragraphs) {
      if (current.length + para.length + 2 > maxChars && current.length > 0) {
        chunks.push(current.trim());
        current = '';
      }
      current += para + '\n\n';
    }

    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
  }

  // ─── Index Persistence ───

  private loadIndex(): boolean {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
        if (Array.isArray(data.chunks)) {
          this.chunks = data.chunks;
          this.indexed = true;
          return true;
        }
      }
    } catch {
      /* corrupt index, will rebuild */
    }
    return false;
  }

  private saveIndex(): void {
    try {
      const dir = path.dirname(this.indexPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Save chunks without embeddings (they're cached separately)
      // Actually save with embeddings for faster loading
      fs.writeFileSync(this.indexPath, JSON.stringify({
        timestamp: Date.now(),
        chunks: this.chunks,
      }), 'utf8');
    } catch (err) {
      console.error('RAGService: Failed to save index:', err);
    }
  }
}
