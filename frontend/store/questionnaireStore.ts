import { create } from "zustand";

type State = {
  skills: string[];
  addSkill: (skill: string) => void;
};

export const useQuestionnaireStore = create<State>((set) => ({
  skills: [],
  addSkill: (skill) => set((state) => ({ skills: [...state.skills, skill] })),
}));
