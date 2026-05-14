import type { TaskListItem } from "./jd-agent";

export type Message = {
  sender: "agent" | "employee";
  text: string;
  skills?: string[];
  tools?: string[];
  tasks?: Array<TaskListItem | string>;
  isSkillSelection?: boolean;
  isToolSelection?: boolean;
  isPrioritySelection?: boolean;
  isReadySelection?: boolean;
  isRateLimitError?: boolean;
  isStreaming?: boolean;
  currentAgent?: string;
};
