import { create } from 'zustand';
import { Topic, EvidenceSpan, PaperDiff } from '@/types';

interface WorkspaceState {
  selectedTopic: Topic | null;
  setSelectedTopic: (topic: Topic | null) => void;
  
  selectedGapId: string | null;
  setSelectedGapId: (id: string | null) => void;
  
  // 选中的连线 (Pair Diff)
  selectedEdge: { a: string, b: string } | null;
  setSelectedEdge: (edge: { a: string, b: string } | null) => void;

  // 选中的节点 (Paper Anatomy)
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  
  activeDiff: PaperDiff | null;
  setActiveDiff: (diff: PaperDiff | null) => void;

  evidence: EvidenceSpan[] | null;
  setEvidence: (spans: EvidenceSpan[] | null) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  showEvidence: (spans: EvidenceSpan[]) => void;
}

export const useAppStore = create<WorkspaceState>((set) => ({
  selectedTopic: null,
  setSelectedTopic: (topic) => set({ selectedTopic: topic, selectedEdge: null, selectedNodeId: null, activeDiff: null }),
  
  selectedGapId: null,
  setSelectedGapId: (selectedGapId) => set({ selectedGapId }),
  
  selectedEdge: null,
  setSelectedEdge: (selectedEdge) => set({ selectedEdge, selectedNodeId: null }),

  selectedNodeId: null,
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId, selectedEdge: null }),
  
  activeDiff: null,
  setActiveDiff: (activeDiff) => set({ activeDiff }),
  
  evidence: null,
  setEvidence: (evidence) => set({ evidence }),
  drawerOpen: false,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  showEvidence: (spans) => set({ evidence: spans, drawerOpen: true }),
}));
