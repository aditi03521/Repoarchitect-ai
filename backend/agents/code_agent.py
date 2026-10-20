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


def analyze_code(file_contents: dict[str, str]) -> dict:
    """
    Given a dict of {file_path: file_content}, asks Gemini to identify
    each file's purpose and its dependencies (imports/relationships).
    """

    # Build a compact representation of files for the prompt
    files_text = ""
    for path, content in file_contents.items():
        files_text += f"\n--- FILE: {path} ---\n{content[:2000]}\n"

    prompt = f"""
You are a software architecture analyst. Below are contents of several
source code files from a repository. For each file, identify its purpose
and what it depends on (imports, calls to other modules, etc.).

{files_text}

Respond ONLY with valid JSON (no markdown, no backticks, no explanation)
in exactly this format:
{{
  "modules": [
    {{
      "file": "path/to/file",
      "purpose": "1 sentence describing what this file does",
      "imports": ["list of imported modules/files/packages"],
      "exports": ["list of key functions/classes/components defined here"],
      "role": "one of: frontend-component, backend-route, model, service, utility, config, database, test, other"
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
        if parsed and isinstance(parsed, dict) and "modules" in parsed and len(parsed["modules"]) > 0:
            return parsed

    # Heuristic fallback module analysis if LLM fails or is rate-limited
    modules = []
    for path, content in file_contents.items():
        lower_path = path.lower()
        role = "other"
        if "component" in lower_path or lower_path.endswith((".jsx", ".tsx", ".vue")):
            role = "frontend-component"
        elif "route" in lower_path or "api" in lower_path or "controller" in lower_path or "main.py" in lower_path:
            role = "backend-route"
        elif "model" in lower_path or "schema" in lower_path or "db" in lower_path:
            role = "model"
        elif "service" in lower_path or "agent" in lower_path:
            role = "service"
        elif "util" in lower_path or "helper" in lower_path or "tool" in lower_path:
            role = "utility"
        elif "config" in lower_path or "setting" in lower_path:
            role = "config"

        imports = []
        for line in content.splitlines()[:30]:
            line_str = line.strip()
            if line_str.startswith("import ") or line_str.startswith("from ") or "require(" in line_str:
                imports.append(line_str[:50])

        modules.append({
            "file": path,
            "purpose": f"Module implementation file for {os.path.basename(path)}.",
            "imports": imports[:5],
            "exports": [],
            "role": role
        })

    return {"modules": modules}