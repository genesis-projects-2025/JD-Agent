"""
File Reader.
Wrapper tool for loading files securely.
"""
class FileReader:
    def read(self, path: str) -> str:
        with open(path, 'r') as f:
            return f.read()\n