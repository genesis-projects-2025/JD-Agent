"""
File Writer.
Wrapper tool for writing or updating files safely.
"""
class FileWriter:
    def write(self, path: str, content: str):
        with open(path, 'w') as f:
            f.write(content)\n