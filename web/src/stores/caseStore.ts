import { create } from "zustand";

import {
  dataSource,
  type ClinicalCaseDraft,
  type ClinicalCaseRecord,
  type ClinicalCaseStep,
} from "../services/dataSource";

export type CaseSaveStatus = "saved" | "dirty" | "saving" | "save_failed";

interface CaseStoreState {
  activeCase: ClinicalCaseRecord | null;
  cases: ClinicalCaseRecord[];
  saveStatus: CaseSaveStatus;
  lastError: string;
  loadCases: () => void;
  selectCase: (caseId: string) => ClinicalCaseRecord | null;
  createCase: (draft?: ClinicalCaseDraft) => ClinicalCaseRecord | null;
  updateActiveCase: (draft: ClinicalCaseDraft) => ClinicalCaseRecord | null;
  setStep: (step: ClinicalCaseStep) => ClinicalCaseRecord | null;
  markDirty: () => void;
}

export const CASE_STORE_BOUNDARY_NOTE = [
  "Zustand stores case-level UI state, draft save state and structured clinical parameters only.",
  "Patient media payloads, raw camera frames, MediaPipe instances, Three.js objects and per-frame arrays stay outside this store.",
  "Components persist through the BrowserDataSource contract so LocalDataSource can be replaced by an API data source later.",
].join(" ");

function sortCases(cases: ClinicalCaseRecord[]) {
  return [...cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function saveDraft(draft: ClinicalCaseDraft) {
  return dataSource.saveCase(draft);
}

export const useCaseStore = create<CaseStoreState>((set, get) => ({
  activeCase: null,
  cases: [],
  saveStatus: "saved",
  lastError: "",

  loadCases() {
    const cases = sortCases(dataSource.listCases());
    set((state) => ({
      cases,
      activeCase: state.activeCase ? cases.find((item) => item.id === state.activeCase?.id) ?? state.activeCase : null,
    }));
  },

  selectCase(caseId) {
    const record = dataSource.getCase(caseId);
    if (!record) {
      set({ lastError: "未找到病例草稿", saveStatus: "save_failed" });
      return null;
    }
    const cases = sortCases(dataSource.listCases());
    set({ activeCase: record, cases, lastError: "", saveStatus: "saved" });
    return record;
  },

  createCase(draft = {}) {
    set({ saveStatus: "saving", lastError: "" });
    const record = saveDraft({
      title: "新建面部评估",
      currentStep: "evaluate",
      ...draft,
    });
    if (!record) {
      set({ saveStatus: "save_failed", lastError: "本地草稿保存失败" });
      return null;
    }
    const cases = sortCases([record, ...get().cases.filter((item) => item.id !== record.id)]);
    set({ activeCase: record, cases, saveStatus: "saved", lastError: "" });
    return record;
  },

  updateActiveCase(draft) {
    const current = get().activeCase;
    if (!current) {
      set({ saveStatus: "save_failed", lastError: "请先创建或选择病例" });
      return null;
    }
    set({ saveStatus: "saving", lastError: "" });
    const record = saveDraft({
      ...current,
      ...draft,
      id: current.id,
      patientContext: { ...current.patientContext, ...draft.patientContext },
      lesion: { ...current.lesion, ...draft.lesion },
      acquisition: { ...current.acquisition, ...draft.acquisition },
      layers: { ...current.layers, ...draft.layers },
    });
    if (!record) {
      set({ saveStatus: "save_failed", lastError: "病例草稿保存失败" });
      return null;
    }
    const cases = sortCases([record, ...get().cases.filter((item) => item.id !== record.id)]);
    set({ activeCase: record, cases, saveStatus: "saved", lastError: "" });
    return record;
  },

  setStep(step) {
    return get().updateActiveCase({ currentStep: step });
  },

  markDirty() {
    set({ saveStatus: "dirty" });
  },
}));
