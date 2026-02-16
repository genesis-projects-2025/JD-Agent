export type Message = {
  sender: "agent" | "employee";
  text: string;
  skills?: string[];
  isSkillSelection?: boolean;
};
