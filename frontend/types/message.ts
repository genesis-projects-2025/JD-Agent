export type Message = {
  sender: "agent" | "employee";
  text: string;
  skills?: string[];
  isSkillSelection?: boolean;
  isReadySelection?: boolean;
  isRateLimitError?: boolean;
  isStreaming?: boolean;
};
