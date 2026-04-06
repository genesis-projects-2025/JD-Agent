export type Message = {
  sender: "agent" | "employee";
  text: string;
  skills?: string[];
  tools?: string[];
  isSkillSelection?: boolean;
  isToolSelection?: boolean;
  isReadySelection?: boolean;
  isRateLimitError?: boolean;
  isStreaming?: boolean;
  currentAgent?: string;
};
