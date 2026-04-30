from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)


class TokenBudgetManager:
    """Manages token budgets per agent to optimize API costs."""
    
    # Token budgets for context per agent (approximate)
    AGENT_BUDGETS = {
        "BasicInfoAgent": 800,      # Needs full context for tasks
        "WorkflowIdentifierAgent": 500,
        "DeepDiveAgent": 1200,      # Needs detailed task info
        "ToolsAgent": 300,
        "SkillsAgent": 300,
        "QualificationAgent": 400,
        "JDGeneratorAgent": 2000,   # Needs full context for generation
    }
    
    def __init__(self):
        self.used_tokens = {}
    
    def get_budget(self, agent_name: str) -> int:
        """Get token budget for an agent.
        
        Args:
            agent_name: Name of the agent
            
        Returns:
            Token budget
        """
        return self.AGENT_BUDGETS.get(agent_name, 500)
    
    def estimate_tokens(self, text: str) -> int:
        """Estimate token count from text.
        
        Args:
            text: Input text
            
        Returns:
            Estimated token count
        """
        if not text:
            return 0
        # Rough estimate: 1 token ≈ 4 characters
        return len(text) // 4
    
    def get_optimal_context(self, insights: Dict, agent_name: str, max_tokens: int) -> Dict:
        """Get optimal context for an agent within token budget.
        
        Args:
            insights: Full insights dictionary
            agent_name: Current agent name
            max_tokens: Maximum tokens allowed
            
        Returns:
            Filtered insights within token budget
        """
        if not isinstance(insights, dict):
            return {}
        
        result = {}
        used_tokens = 0
        
        # Priority 1: Always include identity (small, critical)
        for key in ["identity_context", "role", "department"]:
            if key in insights:
                val = insights[key]
                tokens = self.estimate_tokens(str(val))
                if used_tokens + tokens < max_tokens * 0.3:  # 30% for identity
                    result[key] = val
                    used_tokens += tokens
        
        # Priority 2: Current phase data (higher budget)
        phase_data_keys = {
            "BasicInfoAgent": ["purpose", "tasks", "priority_tasks"],
            "WorkflowIdentifierAgent": ["purpose", "tasks", "priority_tasks"],
            "DeepDiveAgent": ["purpose", "tasks", "priority_tasks", "workflows", "visited_tasks"],
            "ToolsAgent": ["tools", "technologies", "workflows"],
            "SkillsAgent": ["skills", "tools"],
            "QualificationAgent": ["qualifications", "skills"],
            "JDGeneratorAgent": ["purpose", "tasks", "priority_tasks", "workflows", "tools", "skills", "qualifications"]
        }
        
        budget_for_phase = max_tokens * 0.6  # 60% for phase data
        keys = phase_data_keys.get(agent_name, [])
        
        for key in keys:
            if key in insights and used_tokens < max_tokens * 0.9:
                val = insights[key]
                tokens = self.estimate_tokens(str(val))
                
                # Truncate if too large
                if used_tokens + tokens > budget_for_phase:
                    if isinstance(val, list) and len(val) > 3:
                        # Truncate list
                        truncated = val[:3]
                        tokens = self.estimate_tokens(str(truncated))
                        if used_tokens + tokens < budget_for_phase:
                            result[key] = truncated
                            result[f"{key}_count"] = len(val)
                            used_tokens += tokens
                    elif isinstance(val, str) and len(val) > 100:
                        # Truncate string
                        truncated = val[:100] + "..."
                        tokens = self.estimate_tokens(truncated)
                        if used_tokens + tokens < budget_for_phase:
                            result[key] = truncated
                            used_tokens += tokens
                    else:
                        if used_tokens + tokens < budget_for_phase:
                            result[key] = val
                            used_tokens += tokens
                else:
                    result[key] = val
                    used_tokens += tokens
        
        # Priority 3: Summary of remaining (10% budget)
        remaining_budget = max_tokens - used_tokens
        if remaining_budget > 50:
            for key in insights:
                if key not in result:
                    val = insights[key]
                    tokens = self.estimate_tokens(str(val))
                    if tokens < remaining_budget:
                        result[key] = val
                        used_tokens += tokens
                        remaining_budget -= tokens
        
        return result
    
    def compress_history(self, history: list, max_tokens: int) -> list:
        """Compress conversation history to fit token budget.
        
        Args:
            history: Full conversation history
            max_tokens: Maximum tokens allowed
            
        Returns:
            Compressed history
        """
        if not history:
            return []
        
        # Always keep last 3 messages
        compressed = history[-3:]
        used_tokens = sum(self.estimate_tokens(str(msg.get("content", ""))) for msg in compressed)
        
        # Add earlier messages if budget allows
        for msg in reversed(history[:-3]):
            tokens = self.estimate_tokens(str(msg.get("content", "")))
            if used_tokens + tokens < max_tokens * 0.8:
                compressed.insert(0, msg)
                used_tokens += tokens
            else:
                break
        
        return compressed


# Global token budget manager
token_budget = TokenBudgetManager()