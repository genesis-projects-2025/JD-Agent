import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
import hashlib

logger = logging.getLogger(__name__)

# Log directories
LOG_DIR = Path(__file__).parent
INTERVIEW_LOG_DIR = LOG_DIR / "interviews"
METRICS_LOG_DIR = LOG_DIR / "agent_metrics"

# Ensure directories exist
INTERVIEW_LOG_DIR.mkdir(parents=True, exist_ok=True)
METRICS_LOG_DIR.mkdir(parents=True, exist_ok=True)


class InterviewLogger:
    """Structured logging for interviews to enable self-improvement analysis."""
    
    @staticmethod
    def _get_log_path(session_id: str) -> Path:
        """Get the log file path for a session."""
        return INTERVIEW_LOG_DIR / f"{session_id}.jsonl"
    
    @staticmethod
    def log_turn(
        session_id: str,
        turn_index: int,
        agent_name: str,
        user_message: str,
        extracted_data: Dict[str, Any],
        validation_results: Dict[str, Any],
        llm_response: str,
        token_usage: Dict[str, int],
        response_time_ms: float,
        success: bool = True,
        error: Optional[str] = None
    ):
        """Log a single interview turn.
        
        Args:
            session_id: Unique session identifier
            turn_index: Turn number in the conversation
            agent_name: Which agent handled this turn
            user_message: Raw user input
            extracted_data: Data extracted from user message
            validation_results: Validation check results
            llm_response: Full LLM response
            token_usage: Token counts (prompt, completion, total)
            response_time_ms: Response time in milliseconds
            success: Whether the turn completed successfully
            error: Error message if failed
        """
        log_entry = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "session_id": session_id,
            "turn_index": turn_index,
            "agent_name": agent_name,
            "user_message": user_message,
            "extracted_data": extracted_data,
            "validation_results": validation_results,
            "llm_response": llm_response,
            "token_usage": token_usage,
            "response_time_ms": round(response_time_ms, 2),
            "success": success,
            "error": error
        }
        
        log_path = InterviewLogger._get_log_path(session_id)
        try:
            with open(log_path, "a") as f:
                f.write(json.dumps(log_entry) + "\n")
        except Exception as e:
            logger.error(f"Failed to write interview log: {e}")
    
    @staticmethod
    def log_session_summary(
        session_id: str,
        total_turns: int,
        final_agent: str,
        final_progress: float,
        total_tokens: int,
        total_time_ms: float,
        jd_generated: bool,
        jd_quality_score: Optional[float] = None,
        user_feedback: Optional[Dict[str, Any]] = None
    ):
        """Log session summary for aggregate analysis.
        
        Args:
            session_id: Unique session identifier
            total_turns: Total number of turns in the session
            final_agent: Last agent before completion
            final_progress: Final progress percentage (0-100)
            total_tokens: Total tokens used in session
            total_time_ms: Total session duration in milliseconds
            jd_generated: Whether a JD was successfully generated
            jd_quality_score: Optional quality score (0-100) if available
            user_feedback: Optional user feedback data
        """
        summary = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "session_id": session_id,
            "total_turns": total_turns,
            "final_agent": final_agent,
            "final_progress": final_progress,
            "total_tokens": total_tokens,
            "total_time_ms": round(total_time_ms, 2),
            "jd_generated": jd_generated,
            "jd_quality_score": jd_quality_score,
            "user_feedback": user_feedback,
            "avg_turn_time_ms": round(total_time_ms / max(total_turns, 1), 2),
            "tokens_per_turn": round(total_tokens / max(total_turns, 1), 2)
        }
        
        summary_path = INTERVIEW_LOG_DIR / "session_summaries.jsonl"
        try:
            with open(summary_path, "a") as f:
                f.write(json.dumps(summary) + "\n")
        except Exception as e:
            logger.error(f"Failed to write session summary: {e}")
    
    @staticmethod
    def get_session_logs(session_id: str) -> list:
        """Retrieve all logs for a session.
        
        Args:
            session_id: Unique session identifier
            
        Returns:
            List of log entries
        """
        log_path = InterviewLogger._get_log_path(session_id)
        if not log_path.exists():
            return []
        
        logs = []
        try:
            with open(log_path, "r") as f:
                for line in f:
                    if line.strip():
                        logs.append(json.loads(line))
        except Exception as e:
            logger.error(f"Failed to read interview log: {e}")
        
        return logs


class AgentMetricsLogger:
    """Track agent performance metrics for improvement analysis."""
    
    @staticmethod
    def log_agent_performance(
        agent_name: str,
        date: str,
        total_turns: int,
        successful_turns: int,
        avg_response_time_ms: float,
        avg_tokens_per_turn: float,
        completion_rate: float,
        loop_rate: float,
        validation_failures: Dict[str, int]
    ):
        """Log daily agent performance metrics.
        
        Args:
            agent_name: Name of the agent
            date: Date in YYYY-MM-DD format
            total_turns: Total turns handled by this agent
            successful_turns: Turns that completed successfully
            avg_response_time_ms: Average response time
            avg_tokens_per_turn: Average tokens per turn
            completion_rate: Rate of successful completions (0-1)
            loop_rate: Rate of hitting turn limits (0-1)
            validation_failures: Count of validation failures by category
        """
        metrics = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "agent_name": agent_name,
            "date": date,
            "total_turns": total_turns,
            "successful_turns": successful_turns,
            "avg_response_time_ms": round(avg_response_time_ms, 2),
            "avg_tokens_per_turn": round(avg_tokens_per_turn, 2),
            "completion_rate": round(completion_rate, 4),
            "loop_rate": round(loop_rate, 4),
            "validation_failures": validation_failures
        }
        
        metrics_path = METRICS_LOG_DIR / f"{agent_name}_metrics.jsonl"
        try:
            with open(metrics_path, "a") as f:
                f.write(json.dumps(metrics) + "\n")
        except Exception as e:
            logger.error(f"Failed to write agent metrics: {e}")
    
    @staticmethod
    def get_agent_metrics(agent_name: str, days: int = 7) -> list:
        """Retrieve recent metrics for an agent.
        
        Args:
            agent_name: Name of the agent
            days: Number of days to look back
            
        Returns:
            List of metric entries
        """
        metrics_path = METRICS_LOG_DIR / f"{agent_name}_metrics.jsonl"
        if not metrics_path.exists():
            return []
        
        metrics = []
        try:
            with open(metrics_path, "r") as f:
                for line in f:
                    if line.strip():
                        metrics.append(json.loads(line))
        except Exception as e:
            logger.error(f"Failed to read agent metrics: {e}")
        
        return metrics[-days:]  # Return last N days


def calculate_turn_hash(user_message: str, insights: Dict[str, Any]) -> str:
    """Calculate a hash for deduplication of similar turns.
    
    Args:
        user_message: User's message
        insights: Current insights state
        
    Returns:
        Hash string
    """
    key = f"{user_message}:{json.dumps(insights, sort_keys=True)}"
    return hashlib.md5(key.encode()).hexdigest()[:16]
