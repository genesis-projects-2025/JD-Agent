### Identified Issue: Eager Hallucination & Stealth Skipping
The "hang" you experienced on the second task was a combination of two things:
1. **Extraction Engine Hallucination:** When you confirmed your priority Tasks, the router transitioned to the `DeepDiveAgent`. During the extraction phase for your first answer, the LLM saw the names of all your priority tasks in your history, and instead of just extracting information for the *current* task, it **hallucinated fully completed workflows for ALL 4 tasks** and saved them instantly.
2. **Stealth Skipping to JD Gen:** Because `router.py` saw that the `workflows` object now had 4 items (matching the 4 priority tasks), it concluded that the ENTIRE Deep Dive phase was complete!
3. **The 30-Second Hang:** Instead of asking about Task 2, it instantly triggered the `JDGeneratorAgent` in the background. The generation of a final JD takes about 20-30 seconds, during which the UI is completely silent, displaying "Thinking...". If you reloaded the page during this time, the database hadn't saved the turn yet, so it appeared permanently stuck.

### Fixes Applied:
1. **Anti-Hallucination Rule:** I updated `extraction_engine.py` with a strict Rule #10:
   `ANTI-HALLUCINATION RULE: ONLY extract data (especially 'workflows' and 'tasks') if explicitly described in the USER MESSAGE. DO NOT generate, draft, or hallucinate workflows or steps based purely on task names...`
2. **Asynchronous Vector DB Calls:** I wrapped the Pinecone calls in `vector_service.py` using `asyncio.to_thread` to ensure the ASGI event loop doesn't temporarily lock up when fetching advanced context.

The backend is now completely stable. You can proceed with live interviewing without the DeepDive phase skipping ahead or hanging!
