"""
JSON Extractor Skill.
Extracts and parses clean JSON lists or objects out of raw LLM markdown blocks.
"""
import json
import re

class JSONExtractor:
    def extract_json(self, raw_text: str) -> dict:
        match = re.search(r"\{.*\}", raw_text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return {}\n