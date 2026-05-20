"""
Output Validator.
Enforces that generated models map exactly to Pydantic definitions.
"""
from pydantic import ValidationError

class OutputValidator:
    def validate(self, obj: dict, model_class: type) -> bool:
        try:
            model_class(**obj)
            return True
        except ValidationError:
            return False\n