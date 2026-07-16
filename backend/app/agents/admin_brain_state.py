# backend/app/agents/admin_brain_state.py
from typing import TypedDict, List, Dict, Any, Optional

class BaseAgentState(TypedDict):
    """
    State representing the execution context of the Admin Brain Agent pipeline.
    """
    user_message: str
    target_scope: str            # "GLOBAL", "DEPARTMENT", or "EMPLOYEE"
    target_name: Optional[str]   # Resolved canonical name
    target_id: Optional[str]     # Resolved employee ID (e.g., code)
    analytical_intent: str       # "LOOKUP", "GAP_ANALYSIS", "AUTOMATION_RANKING", "COMPLIANCE"
    query_type: str              # "POINT_LOOKUP", "AGGREGATE_RANKING", "QUALITATIVE_SUMMARY", "RELATIONSHIP_QUERY", "BOTTLENECK_ANALYSIS"
    query_types: List[str]       # Multiple query types for multi-intent retrieval
    retrieved_memories: List[Dict[str, Any]]  # Containerized vector chunks
    enhanced_query: str          # Refined query for the vector search
    worker_results: Dict[str, Any]  # Stores intermediate results (resolved SQL data, table info)
    is_final: bool               # Termination flag
    final_response: Optional[str]
