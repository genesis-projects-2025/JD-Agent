"""
Pinecone Manager.
Handles semantic searching, custom index namespaces, and metadata upserts.
"""
class PineconeManager:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def upsert_vectors(self, vectors: list, namespace: str):
        print(f"[Pinecone] Upserting {len(vectors)} items into namespace {namespace}")\n