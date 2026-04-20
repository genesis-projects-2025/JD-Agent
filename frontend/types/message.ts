export type Message = {
  sender: "agent" | "employee";
  text: string;
  skills?: string[];
  tools?: string[];
  tasks?: Array<{ description: string; frequency?: string; category?: string } | string>;
  isSkillSelection?: boolean;
  isToolSelection?: boolean;
  isPrioritySelection?: boolean;
  isReadySelection?: boolean;
  isRateLimitError?: boolean;
  isStreaming?: boolean;
  currentAgent?: string;
};
