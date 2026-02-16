export function useQuestionnaire() {
  return {
    validateResponse: (text: string) => text.length > 10,
  };
}
