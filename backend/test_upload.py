import asyncio
import httpx
from pathlib import Path

async def main():
    async with httpx.AsyncClient() as client:
        # Create a dummy docx file
        dummy_docx = Path("dummy.docx")
        dummy_docx.touch()
        
        # Test endpoint
        files = {"file": ("dummy.docx", open("dummy.docx", "rb"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"employee_id": "EMP123", "employee_name": "Test User"}
        
        # Assuming admin auth might be bypassed or we need a token? 
        # Actually it's easier to just call the function directly.
        pass

if __name__ == "__main__":
    asyncio.run(main())
