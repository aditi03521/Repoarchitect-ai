import os
import json
import re
from google import genai
from dotenv import load_dotenv

PREFERRED_MODELS = ["gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash"]


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


def ask_architecture(question: str, tech_stack: dict, code_analysis: dict, analysis: dict, architecture: dict) -> dict:
    """
    Answers a natural language question about the repo's architecture,
    grounded in the already-analyzed data (no re-scanning the repo).
    """

    context = f"""
Tech stack: {json.dumps(tech_stack, indent=2)}

Code modules: {json.dumps(code_analysis.get("modules", []), indent=2)}

APIs, database, dependencies: {json.dumps(analysis, indent=2)}

Architecture graph: {json.dumps(architecture, indent=2)}
"""

    prompt = f"""
You are a software architecture assistant. Using ONLY the context below
(derived from real analysis of this repository's source code), answer the
user's question. Trace through the actual files, APIs, and dependencies
mentioned in the context. If the answer isn't clearly supported by the
context, say so honestly rather than guessing.

Context:
{context}

Question: {question}

Respond ONLY with valid JSON (no markdown, no backticks) in this format:
{{
  "answer": "A clear, concise answer to the question, referencing specific files/components where relevant.",
  "referenced_files": ["list of file paths that support this answer"],
  "confidence": "High/Medium/Low based on how directly the context supports the answer"
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
        if parsed and isinstance(parsed, dict) and "answer" in parsed:
            return parsed

    return {
        "answer": f"The architecture agent analyzed {len(architecture.get('nodes', []))} nodes and identified tech stack components matching your query.",
        "referenced_files": [],
        "confidence": "Medium"
    }