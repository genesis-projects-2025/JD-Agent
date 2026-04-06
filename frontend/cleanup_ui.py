import os
import re

directories = [
    '/Users/manideekshith/Desktop/JD-Agent/frontend/app',
    '/Users/manideekshith/Desktop/JD-Agent/frontend/components'
]

# Patterns to remove or replace
removals = [
    r'\buppercase\b',
    r'\btracking-widest\b',
    r'\btracking-\[.*?\]\b',
    r'\btracking-tight\b',
    r'\btracking-tighter\b',
    r'\bshadow-premium\b',
    r'\bshadow-2xl\b',
    r'\bshadow-xl\b',
    r'\bshadow-lg\b',
]

replacements = {
    r'\bfont-black\b': 'font-semibold',
    r'\bfont-bold\b': 'font-medium',
    r'\brounded-3xl\b': 'rounded-md',
    r'\brounded-2xl\b': 'rounded-md',
    r'\brounded-\[.*?\]\b': 'rounded-md',
    r'\brounded-xl\b': 'rounded-sm',
    r'\brounded-full\b': 'rounded',
    # Replace colors
    r'\b(?:text|bg|border|ring|shadow|from|via|to)-(blue|emerald|red|purple|amber|indigo|cyan)-(\d+)\b': r'\g<1>-surface-\g<2>',
    # For hover states
    r'\bhover:(?:bg|text|border|border)-(blue|emerald|red|purple|amber|indigo|cyan)-(\d+)\b': r'hover:\g<1>-surface-\g<2>',
}

for root_dir in directories:
    for dirpath, _, filenames in os.walk(root_dir):
        for file in filenames:
            if file.endswith('.tsx'):
                filepath = os.path.join(dirpath, file)
                with open(filepath, 'r') as f:
                    content = f.read()

                original = content
                
                original = content
                
                # Strip modern string tracking and uppercase
                content = re.sub(r'\buppercase\b', '', content)
                content = re.sub(r'\btracking-widest\b', '', content)
                content = re.sub(r'\btracking-\[.*?\]\b', '', content)
                content = re.sub(r'\btracking-tight\b', '', content)
                content = re.sub(r'\btracking-tighter\b', '', content)
                content = re.sub(r'\bshadow-premium\b', 'shadow-md', content)
                content = re.sub(r'\bshadow-2xl\b', 'shadow-md', content)
                content = re.sub(r'\bshadow-xl\b', 'shadow-md', content)
                content = re.sub(r'\bshadow-lg\b', 'shadow-md', content)
                content = re.sub(r'\brounded-3xl\b', 'rounded-md', content)
                content = re.sub(r'\brounded-2xl\b', 'rounded-md', content)
                content = re.sub(r'\brounded-\[.*?\]\b', 'rounded-md', content)
                content = re.sub(r'\brounded-xl\b', 'rounded-md', content)
                content = re.sub(r'\brounded-full\b', 'rounded-md', content)
                content = re.sub(r'\bfont-black\b', 'font-medium', content)
                content = re.sub(r'\bfont-bold\b', 'font-medium', content)

                # Clean up double spaces created by removals in class names
                content = re.sub(r' +', ' ', content)

                if original != content:
                    with open(filepath, 'w') as f:
                        f.write(content)
                    print(f"Updated {filepath}")
