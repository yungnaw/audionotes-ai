"""Run script: python run.py"""
import uvicorn
import sys
import os

# Ensure backend package is importable
sys.path.insert(0, os.path.dirname(__file__))

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=3000,
        reload=True,
        reload_dirs=["backend", "frontend"],
    )
