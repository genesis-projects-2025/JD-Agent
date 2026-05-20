"""
Prompt Builder Skill.
Dynamically builds prompt text templates injected with dynamic contextual metadata.
"""
class PromptBuilder:
    def build_prompt(self, base_template: str, variables: dict) -> str:
        return base_template.format(**variables)\n