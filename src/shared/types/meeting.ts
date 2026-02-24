/**
 * Shared meeting coach types — used by both main process and renderer.
 */

export interface MeetingSpeakerInfo {
  id: string;
  name: string;
  source: 'system';
  utteranceCount: number;
  lastSeen: number;
  isAutoDetected: boolean;
}

export interface MeetingStateInfo {
  active: boolean;
  meetingId: string | null;
  startTime: number | null;
  duration: number;
  transcriptLineCount: number;
  lastCoachingTip: string | null;
  detectedApp: string | null;
  speakers: MeetingSpeakerInfo[];
  isCoaching: boolean;
  hasBriefing: boolean;
}

export interface MeetingCoachConfig {
  enabled: boolean;
  autoDetect: boolean;
  coachingEnabled: boolean;
  language: string;
  dashboardPort: number;
  captureSystemAudio: boolean;
  captureMicrophone: boolean;
  questionDetectionSensitivity: 'low' | 'medium' | 'high';
  useRAG: boolean;
  streamingCoaching: boolean;
}

export interface MeetingSummaryMeta {
  id: string;
  title: string;
  startTime: number;
  duration: number;
  participants: string[];
}

export interface MeetingSummaryFull extends MeetingSummaryMeta {
  endTime: number;
  transcript: Array<{ timestamp: number; speaker: string; text: string; source: 'mic' | 'system' }>;
  coachingTips: MeetingCoachingTip[];
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  detectedApp?: string;
}

export interface MeetingCoachingTip {
  id: string;
  timestamp: number;
  tip: string;
  category: string;
}

export interface MeetingBriefingParticipant {
  name: string;
  role?: string;
  company?: string;
  notes?: string;
  photoBase64?: string;
}

export interface MeetingBriefingInfo {
  topic: string;
  agenda?: string;
  participants: MeetingBriefingParticipant[];
  notes: string;
  urls: string[];
  projectPaths: string[];
  urlContents?: Array<{ url: string; content: string; error?: string }>;
  ragIndexed?: boolean;
}
