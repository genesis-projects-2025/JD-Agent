import re
import logging
from typing import Any, Dict, List
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Allowed tables for read-only admin queries
ALLOWED_TABLES = {
    "employees",
    "organogram",
    "jd_sessions",
    "kra_kpi_sessions",
    "uploaded_kra_kpis",
    "skills",
    "tools",
    "employee_skills",
    "employee_tools",
    "reference_jds",
    "feedbacks"
}

# Forbidden SQL keywords to prevent write/alter/DDL operations
FORBIDDEN_KEYWORDS = [
    r"\binsert\b",
    r"\bupdate\b",
    r"\bdelete\b",
    r"\bdrop\b",
    r"\balter\b",
    r"\bcreate\b",
    r"\btruncate\b",
    r"\breplace\b",
    r"\bexecute\b",
    r"\bexec\b",
    r"\bgrant\b",
    r"\brevoke\b",
    r"\bpragma\b",
    r"\battach\b",
    r"\bdetach\b"
]

class SQLQueryError(Exception):
    pass

def validate_sql_query(sql: str) -> None:
    """
    Validate that the SQL query is a read-only SELECT query
    and only accesses allowed tables.
    """
    sql_clean = sql.strip().lower()
    
    # Must start with SELECT (or WITH CTEs)
    if not (sql_clean.startswith("select") or sql_clean.startswith("with")):
        raise SQLQueryError("Query must be a SELECT statement (or start with a WITH clause).")
        
    # Check for forbidden keywords (case-insensitive, whole-word matching)
    for pattern in FORBIDDEN_KEYWORDS:
        if re.search(pattern, sql_clean):
            raise SQLQueryError(f"Security Violation: Query contains forbidden keyword matching pattern '{pattern}'.")

    # Extract all words/potential tables
    # Find tables following FROM or JOIN
    matches = re.findall(r"\b(?:from|join)\s+([a-zA-Z_0-9]+)", sql_clean)
    
    # Also extract potential table names from common CTE definitions or simple selects
    # Let's validate that if any table name is used, it must be in ALLOWED_TABLES.
    # Note: CTE names defined inside the WITH clause are local. We filter them out.
    ctes = set(re.findall(r"([a-zA-Z_0-9]+)\s+as\s*\(", sql_clean))
    
    for table in matches:
        if table in ctes:
            continue  # Skip CTE reference
        if table not in ALLOWED_TABLES:
            raise SQLQueryError(f"Security Violation: Accessing unauthorized table '{table}'.")


async def execute_safe_select(db: AsyncSession, sql: str, params: Dict[str, Any] = None) -> List[Dict[str, Any]]:
    """
    Validates and executes a SELECT query safely.
    Uses savepoints to prevent transaction poisoning from bad SQL.
    Auto-appends LIMIT 50 if no LIMIT clause is present.
    Returns list of dicts.
    """
    validate_sql_query(sql)

    # Auto-append LIMIT to prevent massive result sets
    sql_clean_check = sql.strip().lower()
    if "limit" not in sql_clean_check:
        sql = sql.rstrip().rstrip(";") + " LIMIT 50"

    params = params or {}
    try:
        # Use savepoint (begin_nested) so a bad query doesn't poison the session
        async with db.begin_nested():
            result = await db.execute(text(sql), params)
            # Handle select results
            if result.returns_rows:
                return [dict(row) for row in result.mappings().all()]
            return []
    except Exception as e:
        logger.error(f"SQL execution failed: {e}. Query: {sql}")
        raise SQLQueryError(f"Database error: {str(e)}")
