declare module 'node-edge-tts' {
  export class EdgeTTS {
    constructor(options?: {
      voice?: string;
      lang?: string;
      outputFormat?: string;
      saveSubtitles?: boolean;
      proxy?: string;
      rate?: string;
      pitch?: string;
      volume?: string;
      timeout?: number;
    });
    ttsPromise(text: string, outputPath: string): Promise<void>;
  }
}
