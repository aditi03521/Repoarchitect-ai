import os
import json
import re
from google import genai
from dotenv import load_dotenv

PREFERRED_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"]


def get_client():
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    if os.path.exists(env_path):
        load_dotenv(env_path)
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        return genai.Client(api_key=api_key)
    except Exception:
        return None


def _clean_json(text: str) -> dict:
    if not text:
        return {}
    cleaned = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                pass
    return {}


def detect_tech_stack(file_tree: list[str]) -> dict:
    """
    Given a list of file paths, asks Gemini to identify the
    project's tech stack and high-level structure.
    """

    file_list_text = "\n".join(file_tree[:200])  # cap to avoid huge prompts

    prompt = f"""
You are a software architecture analyst. Below is a list of file paths
from a GitHub repository. Based on ONLY these file paths (file extensions,
folder names, config files like package.json, requirements.txt, etc.),
identify the project's tech stack and structure.

File paths:
{file_list_text}

Respond ONLY with valid JSON (no markdown, no backticks, no explanation)
in exactly this format:
{{
  "languages": ["list of programming languages detected"],
  "frameworks": ["list of frameworks/libraries detected, e.g. React, Express, Flask"],
  "project_type": "one of: frontend-only, backend-only, fullstack, library, unknown",
  "has_database": true or false,
  "database_hint": "name of database technology if detectable, else null",
  "reasoning": "1-2 sentence explanation of how you reached this conclusion"
}}
"""

    client = get_client()
    raw_text = None
    if client:
        for model_name in PREFERRED_MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt
                )
                if response and response.text:
                    raw_text = response.text.strip()
                    break
            except Exception:
                continue

    if raw_text:
        parsed = _clean_json(raw_text)
        if parsed and isinstance(parsed, dict) and "languages" in parsed:
            return parsed

    # Fallback heuristic detect if API fails
    languages = set()
    frameworks = set()
    for f in file_tree:
        ext = os.path.splitext(f)[1].lower()
        if ext in [".py"]: languages.add("Python")
        elif ext in [".js", ".jsx"]: languages.add("JavaScript")
        elif ext in [".ts", ".tsx"]: languages.add("TypeScript")
        elif ext in [".java"]: languages.add("Java")
        elif ext in [".go"]: languages.add("Go")
        if "package.json" in f or "App.jsx" in f or "react" in f.lower(): frameworks.add("React / Node")
        if "requirements.txt" in f or "fastapi" in f.lower() or "flask" in f.lower(): frameworks.add("FastAPI / Python")

    return {
        "languages": list(languages) if languages else ["Python / JavaScript"],
        "frameworks": list(frameworks) if frameworks else ["FastAPI / React"],
        "project_type": "fullstack" if len(languages) > 1 else "backend-only",
        "has_database": any("db" in f.lower() or "sql" in f.lower() for f in file_tree),
        "database_hint": "PostgreSQL / SQLite",
        "reasoning": "Detected based on file extensions and tree structure."
    }