# app/services/token_observability_service.py
"""
Enterprise Token Observability Service — Real-time distributed LLM tracing, latency percentiles, anomalies, and cost metrics.
"""

from typing import Dict, Any, List, Optional
import logging
import asyncio
import io
import csv
from datetime import datetime, timezone, timedelta
from sqlalchemy import text, select, func, desc
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Pricing per 1M tokens
MODEL_PRICING = {
    "gemini-2.5-flash": {"input_usd_per_m": 0.075, "output_usd_per_m": 0.300},
    "gemini-1.5-flash": {"input_usd_per_m": 0.075, "output_usd_per_m": 0.300},
    "gemini-1.5-pro": {"input_usd_per_m": 1.250, "output_usd_per_m": 5.000},
    "models/gemini-embedding-001": {"input_usd_per_m": 0.025, "output_usd_per_m": 0.000},
}
USD_TO_INR = 86.50


def calculate_cost(model_name: str, prompt_tokens: int, completion_tokens: int) -> tuple[float, float]:
    """Calculate cost in USD and INR for a given model and token count."""
    pricing = MODEL_PRICING.get(model_name.lower(), MODEL_PRICING["gemini-2.5-flash"])
    input_cost = (prompt_tokens / 1_000_000) * pricing["input_usd_per_m"]
    output_cost = (completion_tokens / 1_000_000) * pricing["output_usd_per_m"]
    total_usd = input_cost + output_cost
    total_inr = total_usd * USD_TO_INR
    return round(total_usd, 6), round(total_inr, 4)


async def log_llm_call(
    *,
    trace_id: Optional[str] = None,
    session_id: Optional[str] = None,
    employee_id: Optional[str] = None,
    employee_name: Optional[str] = None,
    agent_name: str = "InterviewEngine",
    span_name: str = "question_generation",
    call_type: str = "question_gen",
    model_name: str = "gemini-2.5-flash",
    status: str = "success",
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    latency_ms: float = 0.0,
    user_message_snippet: Optional[str] = None,
    prompt_preview: Optional[str] = None,
    response_preview: Optional[str] = None,
    full_prompt: Optional[str] = None,
    full_response: Optional[str] = None,
    error_message: Optional[str] = None,
) -> None:
    """Asynchronously record an LLM call to PostgreSQL for enterprise token observability."""
    try:
        total_tokens = prompt_tokens + completion_tokens
        cost_usd, cost_inr = calculate_cost(model_name, prompt_tokens, completion_tokens)
        
        # Anomaly Detection Flag: True if turn exceeds 4,000 tokens or latency > 2.5s or error
        is_anomaly = total_tokens > 4000 or latency_ms > 2500 or status != "success"

        async with AsyncSessionLocal() as db:
            async with db.begin_nested():
                sql = text("""
                    INSERT INTO llm_token_logs (
                        id, trace_id, session_id, employee_id, employee_name, agent_name, span_name, call_type, model_name,
                        status, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_inr, latency_ms,
                        is_anomaly, user_message_snippet, prompt_preview, response_preview, full_prompt, full_response, error_message, created_at
                    ) VALUES (
                        gen_random_uuid(), :trace_id, :session_id, :employee_id, :employee_name, :agent_name, :span_name, :call_type, :model_name,
                        :status, :prompt_tokens, :completion_tokens, :total_tokens, :cost_usd, :cost_inr, :latency_ms,
                        :is_anomaly, :user_message_snippet, :prompt_preview, :response_preview, :full_prompt, :full_response, :error_message, NOW()
                    )
                """)
                await db.execute(
                    sql,
                    {
                        "trace_id": str(trace_id) if trace_id else None,
                        "session_id": str(session_id) if session_id else None,
                        "employee_id": str(employee_id) if employee_id else None,
                        "employee_name": employee_name,
                        "agent_name": agent_name,
                        "span_name": span_name,
                        "call_type": call_type,
                        "model_name": model_name,
                        "status": status,
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": total_tokens,
                        "cost_usd": cost_usd,
                        "cost_inr": cost_inr,
                        "latency_ms": round(latency_ms, 2),
                        "is_anomaly": is_anomaly,
                        "user_message_snippet": user_message_snippet[:300] if user_message_snippet else None,
                        "prompt_preview": prompt_preview[:300] if prompt_preview else None,
                        "response_preview": response_preview[:300] if response_preview else None,
                        "full_prompt": full_prompt,
                        "full_response": full_response,
                        "error_message": error_message,
                    },
                )
            await db.commit()
    except Exception as e:
        logger.error(f"[Observability] Failed to log LLM call: {e}")


async def get_observability_stats(db, days: int = 7) -> Dict[str, Any]:
    """Aggregate statistics for the Admin Token Evaluation dashboard."""
    try:
        num_days = int(days)
        async with db.begin_nested():
            # 1. Total tokens and costs overall in period
            res = await db.execute(
                text("""
                SELECT 
                    COALESCE(SUM(prompt_tokens), 0) as total_prompt,
                    COALESCE(SUM(completion_tokens), 0) as total_completion,
                    COALESCE(SUM(total_tokens), 0) as total_tokens,
                    COALESCE(SUM(cost_usd), 0.0) as total_cost_usd,
                    COALESCE(SUM(cost_inr), 0.0) as total_cost_inr,
                    COUNT(*) as total_calls,
                    COALESCE(AVG(latency_ms), 0.0) as avg_latency,
                    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms) as p50_latency,
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency,
                    COALESCE(SUM(CASE WHEN is_anomaly THEN 1 ELSE 0 END), 0) as anomaly_count
                FROM llm_token_logs
                WHERE created_at >= NOW() - (:days * INTERVAL '1 day')
            """),
                {"days": num_days},
            )
            row = res.mappings().first() or {}

            # 2. Stats for Today
            res_today = await db.execute(
                text("""
                SELECT 
                    COALESCE(SUM(total_tokens), 0) as total_tokens_today,
                    COALESCE(SUM(cost_inr), 0.0) as total_cost_inr_today,
                    COUNT(*) as total_calls_today,
                    COALESCE(SUM(CASE WHEN is_anomaly THEN 1 ELSE 0 END), 0) as anomalies_today
                FROM llm_token_logs
                WHERE created_at >= CURRENT_DATE
            """)
            )
            today_row = res_today.mappings().first() or {}

            # 3. Breakdown by Agent
            res_agent = await db.execute(
                text("""
                SELECT agent_name, COUNT(*) as call_count, SUM(total_tokens) as tokens, SUM(cost_inr) as cost_inr, AVG(latency_ms) as avg_latency
                FROM llm_token_logs
                WHERE created_at >= NOW() - (:days * INTERVAL '1 day')
                GROUP BY agent_name
                ORDER BY tokens DESC
            """),
                {"days": num_days},
            )
            by_agent = [dict(r) for r in res_agent.mappings().all()]

            # 4. Breakdown by Call Type
            res_type = await db.execute(
                text("""
                SELECT call_type, COUNT(*) as call_count, SUM(total_tokens) as tokens, SUM(cost_inr) as cost_inr
                FROM llm_token_logs
                WHERE created_at >= NOW() - (:days * INTERVAL '1 day')
                GROUP BY call_type
                ORDER BY tokens DESC
            """),
                {"days": num_days},
            )
            by_call_type = [dict(r) for r in res_type.mappings().all()]

            # 5. Breakdown by Model
            res_model = await db.execute(
                text("""
                SELECT model_name, COUNT(*) as call_count, SUM(total_tokens) as tokens, SUM(cost_inr) as cost_inr
                FROM llm_token_logs
                WHERE created_at >= NOW() - (:days * INTERVAL '1 day')
                GROUP BY model_name
                ORDER BY tokens DESC
            """),
                {"days": num_days},
            )
            by_model = [dict(r) for r in res_model.mappings().all()]

            # 6. Session summary averages
            res_sess = await db.execute(
                text("""
                SELECT COUNT(DISTINCT session_id) as total_sessions
                FROM llm_token_logs
                WHERE session_id IS NOT NULL AND created_at >= NOW() - (:days * INTERVAL '1 day')
            """),
                {"days": num_days},
            )
            total_sessions = (res_sess.mappings().first() or {}).get("total_sessions") or 1
            avg_tokens_per_session = round(row.get("total_tokens", 0) / max(total_sessions, 1), 1)

            return {
                "period_days": num_days,
                "summary": {
                    "total_prompt_tokens": row.get("total_prompt", 0),
                    "total_completion_tokens": row.get("total_completion", 0),
                    "total_tokens": row.get("total_tokens", 0),
                    "total_cost_usd": round(float(row.get("total_cost_usd", 0.0)), 4),
                    "total_cost_inr": round(float(row.get("total_cost_inr", 0.0)), 2),
                    "total_llm_calls": row.get("total_calls", 0),
                    "avg_latency_ms": round(float(row.get("avg_latency", 0.0)), 1),
                    "p50_latency_ms": round(float(row.get("p50_latency") or 0.0), 1),
                    "p95_latency_ms": round(float(row.get("p95_latency") or 0.0), 1),
                    "anomaly_count": row.get("anomaly_count", 0),
                    "total_sessions": total_sessions,
                    "avg_tokens_per_session": avg_tokens_per_session,
                },
                "today": {
                    "total_tokens": today_row.get("total_tokens_today", 0),
                    "total_cost_inr": round(float(today_row.get("total_cost_inr_today", 0.0)), 2),
                    "total_calls": today_row.get("total_calls_today", 0),
                    "anomalies_today": today_row.get("anomalies_today", 0),
                },
                "breakdown_by_agent": by_agent,
                "breakdown_by_call_type": by_call_type,
                "breakdown_by_model": by_model,
            }
    except Exception as e:
        logger.error(f"[Observability] Failed to get stats: {e}")
        return {"error": str(e)}


async def get_observability_logs(
    db,
    limit: int = 50,
    offset: int = 0,
    session_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    agent_name: Optional[str] = None,
    call_type: Optional[str] = None,
    status: Optional[str] = None,
    only_anomalies: bool = False,
) -> Dict[str, Any]:
    """Retrieve paginated LLM token logs with enterprise filtering."""
    try:
        async with db.begin_nested():
            conditions = ["1=1"]
            params = {"limit": limit, "offset": offset}

            if session_id:
                conditions.append("session_id = :session_id")
                params["session_id"] = session_id
            if trace_id:
                conditions.append("trace_id = :trace_id")
                params["trace_id"] = trace_id
            if agent_name:
                conditions.append("agent_name = :agent_name")
                params["agent_name"] = agent_name
            if call_type:
                conditions.append("call_type = :call_type")
                params["call_type"] = call_type
            if status:
                conditions.append("status = :status")
                params["status"] = status
            if only_anomalies:
                conditions.append("is_anomaly = TRUE")

            where_clause = " AND ".join(conditions)

            # Count total
            count_res = await db.execute(
                text(f"SELECT COUNT(*) FROM llm_token_logs WHERE {where_clause}"),
                params,
            )
            total = count_res.scalar() or 0

            # Fetch rows
            res = await db.execute(
                text(f"""
                SELECT id, trace_id, session_id, employee_id, employee_name, agent_name, span_name, call_type, model_name,
                       status, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_inr, latency_ms,
                       is_anomaly, user_message_snippet, prompt_preview, response_preview, full_prompt, full_response, error_message, created_at
                FROM llm_token_logs
                WHERE {where_clause}
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
            """),
                params,
            )

            rows = [dict(r) for r in res.mappings().all()]
            for r in rows:
                r["id"] = str(r["id"])
                r["created_at"] = r["created_at"].isoformat() if r.get("created_at") else None

            return {"total": total, "limit": limit, "offset": offset, "logs": rows}
    except Exception as e:
        logger.error(f"[Observability] Failed to get logs: {e}")
        return {"total": 0, "logs": []}


async def get_session_evaluation_detail(db, session_id: str) -> Dict[str, Any]:
    """Get turn-by-turn trace evaluation breakdown for a single session."""
    try:
        async with db.begin_nested():
            res = await db.execute(
                text("""
                SELECT id, trace_id, session_id, employee_id, employee_name, agent_name, span_name, call_type, model_name,
                       status, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_inr, latency_ms,
                       is_anomaly, user_message_snippet, prompt_preview, response_preview, full_prompt, full_response, error_message, created_at
                FROM llm_token_logs
                WHERE session_id = :session_id
                ORDER BY created_at ASC
            """),
                {"session_id": session_id},
            )

            rows = [dict(r) for r in res.mappings().all()]
            total_prompt = sum(r["prompt_tokens"] for r in rows)
            total_completion = sum(r["completion_tokens"] for r in rows)
            total_tokens = sum(r["total_tokens"] for r in rows)
            total_cost_inr = sum(r["cost_inr"] for r in rows)
            anomalies = sum(1 for r in rows if r["is_anomaly"])

            for r in rows:
                r["id"] = str(r["id"])
                r["created_at"] = r["created_at"].isoformat() if r.get("created_at") else None

            return {
                "session_id": session_id,
                "total_calls": len(rows),
                "total_prompt_tokens": total_prompt,
                "total_completion_tokens": total_completion,
                "total_tokens": total_tokens,
                "total_cost_inr": round(total_cost_inr, 2),
                "anomaly_count": anomalies,
                "llm_calls": rows,
            }
    except Exception as e:
        logger.error(f"[Observability] Failed to get session evaluation: {e}")
        return {"session_id": session_id, "llm_calls": []}


async def export_observability_csv(db, days: int = 7) -> str:
    """Generate a CSV string of all LLM token logs in the period for export."""
    try:
        num_days = int(days)
        async with db.begin_nested():
            res = await db.execute(
                text("""
                SELECT id, trace_id, session_id, employee_id, agent_name, span_name, call_type, model_name,
                       status, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_inr, latency_ms,
                       is_anomaly, created_at
                FROM llm_token_logs
                WHERE created_at >= NOW() - (:days * INTERVAL '1 day')
                ORDER BY created_at DESC
            """),
                {"days": num_days},
            )
            rows = res.mappings().all()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Log ID", "Trace ID", "Session ID", "Employee ID", "Agent Name", "Span Name", "Call Type",
            "Model Name", "Status", "Prompt Tokens", "Completion Tokens", "Total Tokens",
            "Cost (USD)", "Cost (INR)", "Latency (ms)", "Is Anomaly", "Created At"
        ])
        for r in rows:
            writer.writerow([
                str(r["id"]), r["trace_id"], r["session_id"], r["employee_id"], r["agent_name"], r["span_name"],
                r["call_type"], r["model_name"], r["status"], r["prompt_tokens"], r["completion_tokens"],
                r["total_tokens"], r["cost_usd"], r["cost_inr"], r["latency_ms"], r["is_anomaly"],
                r["created_at"].isoformat() if r["created_at"] else ""
            ])
        return output.getvalue()
    except Exception as e:
        logger.error(f"[Observability] Failed to export CSV: {e}")
        return "Log ID,Error\n1,Export failed"
