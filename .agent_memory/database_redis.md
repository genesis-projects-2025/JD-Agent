# JD-Agent Database & Caching Specification

This brain file documents the relational database schemas, models, Redis cache structures, and state synchronization policies of the JD-Agent.

---

## Relational Database Models (SQLAlchemy ORM)

All persistence operations utilize PostgreSQL via SQLAlchemy. The models are located in `backend/app/models/`.

### 1. `JDSession`
Represents a single job description creation process.
* **Fields**:
  * `id`: UUID (Primary Key)
  * `employee_id`: String (Foreign identifier)
  * `title`: String (Job Title)
  * `conversation_state`: JSONB (Stores `SessionMemory` state as a dictionary)
  * `insights`: JSONB (Role purpose, daily/weekly tasks, tools, skills, priority tasks)
  * `generated_jd`: Text (Raw Markdown of the generated Job Description)
  * `created_at` / `updated_at`: DateTime

### 2. `ConversationTurn`
Stores the complete history of an interview session, preventing data loss.
* **Fields**:
  * `id`: Integer (Primary Key)
  * `session_id`: UUID (Foreign Key linking to `JDSession.id`)
  * `role`: String (`"user"` or `"assistant"`)
  * `content`: Text (Message payload stringified or plain text)
  * `turn_index`: Integer (Chronological ordering index)
  * `created_at`: DateTime

---

## Redis Caching Strategy

A Redis cache Layer is placed in front of the database to speed up state retrieval.
* **Key Format**: `session:{session_id}`
* **TTL**: 300 seconds
* **Serialized Formats**: The cache serializes the `SessionMemory` properties as a JSON dictionary:
  * `insights`
  * `progress`
  * `current_agent`
  * `generated_jd`
  * `jd_structured` (contains the structured JD format)
  * `full_history` (a list of all turns)

---

## State Sync & Hydration Procedures

### Session Hydration Flow
When a request hits an endpoint (e.g. `/stream` or a confirmation POST):
1. **Cache Read**: Attempts to fetch the key `session:{session_id}` from Redis.
   * If found, deserializes the JSON string using `_session_from_cache_dict`.
2. **DB Fallback**: If missing from cache, queries `JDSession` and `ConversationTurn` from the DB using `hydrate_session_from_db`.
   * **Important**: To prevent permanent conversation truncation, the database loads *all* turns in ascending chronological order (`.order_by(ConversationTurn.turn_index.asc())`).
3. **Session Memory Initialization**: Reconstructs a `SessionMemory` object with the retrieved values, passing `llm_limit=6` to maintain a token-controlled sliding context window during LLM executions.

### DB Synchronization Flow
To persist changes made to a session:
1. Calls `sync_session_to_db` to write the updated `insights`, `progress`, and full `conversation_history` back to the PostgreSQL database.
2. Invalidation: Invalidates related cached detail views using pattern matching `cache:jd_detail:*{session_id}*`.
3. Cache Refresh: Overwrites `session:{session_id}` with the fresh memory layout via `_cache_session`.
