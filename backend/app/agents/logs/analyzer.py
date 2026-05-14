import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)

# Use the same base directory as logger.py — this file is inside app/agents/logs/
LOG_DIR = Path(__file__).parent
INTERVIEW_LOG_DIR = LOG_DIR / "interviews"
METRICS_LOG_DIR = LOG_DIR / "agent_metrics"


class AgentImprovementAnalyzer:
    """Analyzes interview logs to identify improvement opportunities."""
    
    @staticmethod
    def analyze_agent_performance(agent_name: str, days: int = 7) -> Dict[str, Any]:
        """Analyze an agent's performance over the specified period.
        
        Args:
            agent_name: Name of the agent to analyze
            days: Number of days to look back
            
        Returns:
            Analysis results with recommendations
        """
        metrics_path = METRICS_LOG_DIR / f"{agent_name}_metrics.jsonl"
        if not metrics_path.exists():
            return {"error": "No metrics found", "agent": agent_name}
        
        metrics = []
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        try:
            with open(metrics_path, "r") as f:
                for line in f:
                    if line.strip():
                        entry = json.loads(line)
                        entry_date = datetime.fromisoformat(entry["date"])
                        if entry_date >= cutoff_date:
                            metrics.append(entry)
        except Exception as e:
            logger.error(f"Failed to read metrics: {e}")
            return {"error": str(e), "agent": agent_name}
        
        if not metrics:
            return {"error": "No recent metrics", "agent": agent_name}
        
        # Aggregate statistics
        total_turns = sum(m["total_turns"] for m in metrics)
        total_successful = sum(m["successful_turns"] for m in metrics)
        avg_response_time = sum(m["avg_response_time_ms"] for m in metrics) / len(metrics)
        avg_tokens = sum(m["avg_tokens_per_turn"] for m in metrics) / len(metrics)
        avg_completion = sum(m["completion_rate"] for m in metrics) / len(metrics)
        avg_loop = sum(m["loop_rate"] for m in metrics) / len(metrics)
        
        # Aggregate validation failures
        all_failures = defaultdict(int)
        for m in metrics:
            for category, count in m.get("validation_failures", {}).items():
                all_failures[category] += count
        
        # Identify issues
        issues = []
        recommendations = []
        
        if avg_completion < 0.85:
            issues.append(f"Low completion rate: {avg_completion:.1%}")
            recommendations.append("Review agent prompts and validation criteria. Consider relaxing thresholds.")
        
        if avg_loop > 0.15:
            issues.append(f"High loop rate: {avg_loop:.1%} (hitting turn limits)")
            recommendations.append("Increase turn limits or adjust completion criteria to be more achievable.")
        
        if avg_response_time > 5000:
            issues.append(f"Slow response time: {avg_response_time:.0f}ms")
            recommendations.append("Optimize prompts and reduce context size. Consider using faster model.")
        
        if all_failures:
            top_failure = max(all_failures.items(), key=lambda x: x[1])
            issues.append(f"Most common validation failure: {top_failure[0]} ({top_failure[1]} times)")
            recommendations.append(f"Review validation logic for '{top_failure[0]}' category. May need threshold adjustment.")
        
        # Suggest threshold adjustments
        threshold_suggestions = AgentImprovementAnalyzer._suggest_threshold_adjustments(agent_name, metrics)
        
        return {
            "agent": agent_name,
            "period_days": days,
            "total_turns": total_turns,
            "metrics": {
                "completion_rate": round(avg_completion, 4),
                "loop_rate": round(avg_loop, 4),
                "avg_response_time_ms": round(avg_response_time, 2),
                "avg_tokens_per_turn": round(avg_tokens, 2),
                "success_rate": round(total_successful / max(total_turns, 1), 4)
            },
            "validation_failures": dict(all_failures),
            "issues": issues,
            "recommendations": recommendations,
            "threshold_suggestions": threshold_suggestions
        }
    
    @staticmethod
    def _suggest_threshold_adjustments(agent_name: str, metrics: List[Dict]) -> Dict[str, Any]:
        """Suggest threshold adjustments based on historical performance.
        
        Args:
            agent_name: Name of the agent
            metrics: List of metric entries
            
        Returns:
            Suggested threshold adjustments
        """
        suggestions = {}
        
        # Analyze loop patterns
        loop_rates = [m["loop_rate"] for m in metrics]
        avg_loop = sum(loop_rates) / len(loop_rates)
        
        if avg_loop > 0.2:
            suggestions["turn_limit"] = {
                "current": AgentImprovementAnalyzer._get_current_threshold(agent_name, "turn_limit"),
                "suggested": "Increase by 1-2 turns",
                "reason": f"Agent hits turn limit {avg_loop:.1%} of the time"
            }
        
        # Analyze validation failures
        all_failures = defaultdict(int)
        for m in metrics:
            for category, count in m.get("validation_failures", {}).items():
                all_failures[category] += count
        
        if all_failures:
            for category, count in all_failures.items():
                if count > 10:  # Significant number of failures
                    current = AgentImprovementAnalyzer._get_current_threshold(agent_name, category)
                    suggestions[category] = {
                        "current": current,
                        "suggested": "Relax validation criteria",
                        "reason": f"{count} validation failures in this category"
                    }
        
        return suggestions
    
    @staticmethod
    def _get_current_threshold(agent_name: str, category: str) -> str:
        """Get current threshold for an agent/category.
        
        Args:
            agent_name: Name of the agent
            category: Category name
            
        Returns:
            Current threshold description
        """
        thresholds = {
            "BasicInfoAgent": {"turn_limit": "5 turns", "tasks": "6 tasks"},
            "WorkflowIdentifierAgent": {"turn_limit": "4 turns", "priority_tasks": "3 tasks"},
            "ToolsAgent": {"turn_limit": "3 turns", "tools": "2 tools"},
            "SkillsAgent": {"turn_limit": "3 turns", "skills": "4 skills"},
            "QualificationAgent": {"turn_limit": "3 turns", "education": "required"}
        }
        
        agent_thresholds = thresholds.get(agent_name, {})
        return agent_thresholds.get(category, "N/A")
    
    @staticmethod
    def analyze_interview_patterns(days: int = 7) -> Dict[str, Any]:
        """Analyze overall interview patterns to identify systemic issues.
        
        Args:
            days: Number of days to look back
            
        Returns:
            Pattern analysis results
        """
        summaries_path = INTERVIEW_LOG_DIR / "session_summaries.jsonl"
        if not summaries_path.exists():
            return {"error": "No session summaries found"}
        
        summaries = []
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        try:
            with open(summaries_path, "r") as f:
                for line in f:
                    if line.strip():
                        entry = json.loads(line)
                        entry_date = datetime.fromisoformat(entry["timestamp"])
                        if entry_date >= cutoff_date:
                            summaries.append(entry)
        except Exception as e:
            logger.error(f"Failed to read summaries: {e}")
            return {"error": str(e)}
        
        if not summaries:
            return {"error": "No recent summaries"}
        
        total_sessions = len(summaries)
        jd_generated = sum(1 for s in summaries if s.get("jd_generated"))
        avg_turns = sum(s.get("total_turns", 0) for s in summaries) / total_sessions
        avg_tokens = sum(s.get("total_tokens", 0) for s in summaries) / total_sessions
        avg_time = sum(s.get("total_time_ms", 0) for s in summaries) / total_sessions
        
        # Quality scores
        quality_scores = [s.get("jd_quality_score") for s in summaries if s.get("jd_quality_score") is not None]
        avg_quality = sum(quality_scores) / len(quality_scores) if quality_scores else None
        
        return {
            "period_days": days,
            "total_sessions": total_sessions,
            "success_rate": round(jd_generated / total_sessions, 4),
            "avg_turns_per_session": round(avg_turns, 2),
            "avg_tokens_per_session": round(avg_tokens, 2),
            "avg_time_per_session_ms": round(avg_time, 2),
            "avg_quality_score": round(avg_quality, 2) if avg_quality else None,
            "token_efficiency": round(avg_tokens / max(avg_turns, 1), 2)
        }
    
    @staticmethod
    def identify_common_failure_patterns(days: int = 7) -> List[Dict[str, Any]]:
        """Identify common patterns in failed or problematic interviews.
        
        Args:
            days: Number of days to look back
            
        Returns:
            List of failure patterns
        """
        summaries_path = INTERVIEW_LOG_DIR / "session_summaries.jsonl"
        if not summaries_path.exists():
            return []
        
        patterns = defaultdict(int)
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        try:
            with open(summaries_path, "r") as f:
                for line in f:
                    if line.strip():
                        entry = json.loads(line)
                        entry_date = datetime.fromisoformat(entry["timestamp"])
                        if entry_date >= cutoff_date:
                            # Identify failure patterns
                            if not entry.get("jd_generated"):
                                final_agent = entry.get("final_agent", "")
                                if final_agent:
                                    patterns[f"Stuck at {final_agent}"] += 1
                                
                                progress = entry.get("final_progress", 0)
                                if progress < 50:
                                    patterns["Low progress (<50%)"] += 1
                                elif progress < 80:
                                    patterns["Medium progress (50-80%)"] += 1
                                
                                turns = entry.get("total_turns", 0)
                                if turns > 20:
                                    patterns["Excessive turns (>20)"] += 1
        except Exception as e:
            logger.error(f"Failed to analyze patterns: {e}")
        
        return [
            {"pattern": pattern, "count": count}
            for pattern, count in sorted(patterns.items(), key=lambda x: x[1], reverse=True)
        ]