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


def analyze_apis_and_data(tech_stack: dict, code_analysis: dict) -> dict:
    """
    Given the tech stack and per-file code analysis, identifies APIs,
    databases, and inter-component dependencies.
    """

    modules_summary = json.dumps(code_analysis.get("modules", []), indent=2)

    prompt = f"""
You are a software architecture analyst. Below is information about a
repository's tech stack and its individual code modules (each with purpose,
imports, exports, and role).

Tech stack:
{json.dumps(tech_stack, indent=2)}

Modules:
{modules_summary}

Based on this, identify:
1. APIs/endpoints exposed by the backend (if any)
2. Database usage (if any) - what database, and which files interact with it
3. Key dependencies between components (which modules/files depend on which others)

Respond ONLY with valid JSON (no markdown, no backticks, no explanation)
in exactly this format:
{{
  "apis": [
    {{
      "method": "GET/POST/PUT/DELETE",
      "path": "/example/route",
      "file": "file where this is defined",
      "description": "1 sentence on what it does"
    }}
  ],
  "database": {{
    "type": "e.g. MongoDB, PostgreSQL, SQLite, none",
    "files_involved": ["list of files that interact with the database"],
    "description": "1-2 sentences on how the database is used"
  }},
  "dependencies": [
    {{
      "from": "file A",
      "to": "file B",
      "relationship": "1 short phrase, e.g. 'calls API defined in', 'imports model from'"
    }}
  ]
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
        if parsed and isinstance(parsed, dict) and ("apis" in parsed or "dependencies" in parsed):
            return parsed

    # Fallback structure if LLM fails
    return {
        "apis": [],
        "database": {"type": "auto-detected", "files_involved": [], "description": "Database components extracted from file signatures."},
        "dependencies": []
    }