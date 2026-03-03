#!/bin/bash
# Check if file arguments are passed
if [ $# -eq 0 ]; then
  echo "Usage: ./update.sh <file_path> <search> <replace>"
  exit 1
fi
