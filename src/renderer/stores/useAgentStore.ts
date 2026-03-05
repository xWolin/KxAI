import { create } from 'zustand';
import type { AgentStatus, IndexProgress, ActionApprovalRequest } from '../types';

interface AgentState {
  /** Current agent processing status */
  agentStatus: AgentStatus;
  /** Whether take-control mode is active (Ctrl+Shift+K) */
  controlActive: boolean;
  /** Whether companion (smart monitor) has a suggestion queued */
  hasSuggestion: boolean;
  /** Whether companion wants to speak proactively */
  wantsToSpeak: boolean;
  /** RAG indexing progress — null when not indexing */
  ragProgress: IndexProgress | null;
  /** Whether meeting coach is active */
  meetingActive: boolean;
  /** Pending action approval requests from CortexEngine */
  pendingActionRequests: ActionApprovalRequest[];

  setAgentStatus: (status: AgentStatus) => void;
  setControlActive: (active: boolean) => void;
  setHasSuggestion: (has: boolean) => void;
  setWantsToSpeak: (wants: boolean) => void;
  setRagProgress: (progress: IndexProgress | null) => void;
  setMeetingActive: (active: boolean) => void;
  addActionRequest: (request: ActionApprovalRequest) => void;
  removeActionRequest: (requestId: string) => void;

  /** Clear companion states (called when user opens chat) */
  clearCompanionStates: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agentStatus: { state: 'idle' },
  controlActive: false,
  hasSuggestion: false,
  wantsToSpeak: false,
  ragProgress: null,
  meetingActive: false,
  pendingActionRequests: [],

  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setControlActive: (controlActive) => set({ controlActive }),
  setHasSuggestion: (hasSuggestion) => set({ hasSuggestion }),
  setWantsToSpeak: (wantsToSpeak) => set({ wantsToSpeak }),
  setRagProgress: (ragProgress) => set({ ragProgress }),
  setMeetingActive: (meetingActive) => set({ meetingActive }),
  addActionRequest: (request) => set((state) => ({ pendingActionRequests: [...state.pendingActionRequests, request] })),
  removeActionRequest: (requestId) =>
    set((state) => ({
      pendingActionRequests: state.pendingActionRequests.filter((r) => r.requestId !== requestId),
    })),

  clearCompanionStates: () => set({ hasSuggestion: false, wantsToSpeak: false }),
}));
