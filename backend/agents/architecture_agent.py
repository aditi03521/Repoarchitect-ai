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


def _build_fallback_architecture(tech_stack: dict, code_analysis: dict, analysis: dict) -> dict:
    """
    Fallback deterministic architecture builder when LLM response is unavailable or empty.
    Categorizes code modules into 5 architectural layers to ensure diagram is NEVER blank.
    """
    modules = code_analysis.get("modules", [])
    
    layer_buckets = {
        "frontend": {
            "id": "frontend_ui",
            "label": "Frontend & UI Component",
            "type": "frontend",
            "files": [],
            "description": "User interface dashboard and client-side web components."
        },
        "service": {
            "id": "api_gateway",
            "label": "API Router & Services",
            "type": "service",
            "files": [],
            "description": "Exposes HTTP endpoints, handles requests, and routes API calls."
        },
        "backend": {
            "id": "core_engine",
            "label": "Backend Engine & Agents",
            "type": "backend",
            "files": [],
            "description": "Core application business logic, workflow controllers, and agent handlers."
        },
        "database": {
            "id": "data_store",
            "label": "Database & Data Layer",
            "type": "database",
            "files": [],
            "description": "Data models, schemas, and persistence operations."
        },
        "external": {
            "id": "external_utils",
            "label": "Utilities & External Tools",
            "type": "external",
            "files": [],
            "description": "Helper functions, external API integrations, and scripts."
        }
    }

    for mod in modules:
        f = mod.get("file", "")
        role = str(mod.get("role", "")).lower()
        f_lower = f.lower()

        if "front" in role or f_lower.endswith((".jsx", ".tsx", ".html", ".css")) or "src/" in f_lower or "frontend" in f_lower or "ui" in f_lower:
            layer_buckets["frontend"]["files"].append(f)
        elif "route" in role or "api" in role or "controller" in role or "router" in f_lower or "endpoint" in f_lower:
            layer_buckets["service"]["files"].append(f)
        elif "model" in role or "db" in role or "data" in role or "schema" in f_lower or "sql" in f_lower or "db" in f_lower:
            layer_buckets["database"]["files"].append(f)
        elif "util" in role or "config" in role or "cloner" in f_lower or "helper" in f_lower or "tool" in f_lower:
            layer_buckets["external"]["files"].append(f)
        else:
            layer_buckets["backend"]["files"].append(f)

    nodes = [bucket for bucket in layer_buckets.values() if len(bucket["files"]) > 0]

    # If modules list was completely empty, create standard default nodes
    if not nodes:
        nodes = [
            {
                "id": "frontend_ui",
                "label": "Client Interface",
                "type": "frontend",
                "files": ["frontend/src/App.jsx"],
                "description": "Client view and interactive interface."
            },
            {
                "id": "api_gateway",
                "label": "API Router / Server",
                "type": "service",
                "files": ["backend/main.py"],
                "description": "Main API entry point and router."
            },
            {
                "id": "core_engine",
                "label": "Backend Application Logic",
                "type": "backend",
                "files": ["backend/agents/architecture_agent.py"],
                "description": "Core processing logic and application handlers."
            }
        ]

    edges = []
    for i in range(len(nodes) - 1):
        edges.append({
            "from": nodes[i]["id"],
            "to": nodes[i + 1]["id"],
            "label": "Interacts with"
        })

    return {"nodes": nodes, "edges": edges}


def build_architecture(tech_stack: dict, code_analysis: dict, analysis: dict) -> dict:
    """
    Combines all prior agent outputs into a single architecture graph:
    a list of components (nodes) and relationships (edges).
    """

    prompt = f"""
You are a software architect. Using the information below, construct a
high-level system architecture graph for this repository.

Tech stack:
{json.dumps(tech_stack, indent=2)}

Code modules:
{json.dumps(code_analysis.get("modules", []), indent=2)}

APIs, database, and dependencies:
{json.dumps(analysis, indent=2)}

Group related files into logical components (e.g. "Frontend UI",
"Auth Service", "User API", "Database Layer") rather than listing every
single file as its own node. Each component should map to one or more
actual source files.

Respond ONLY with valid JSON (no markdown, no backticks, no explanation)
in exactly this format:
{{
  "nodes": [
    {{
      "id": "unique_short_id",
      "label": "Human readable component name",
      "type": "one of: frontend, backend, database, api, service, cache, external",
      "files": ["list of source files belonging to this component"],
      "description": "1-2 sentences describing this component's role"
    }}
  ],
  "edges": [
    {{
      "from": "node_id",
      "to": "node_id",
      "label": "short phrase describing the relationship, e.g. 'sends requests to'"
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
        if parsed and isinstance(parsed, dict) and "nodes" in parsed and len(parsed["nodes"]) > 0:
            return parsed

    # Return deterministic fallback if LLM is unavailable or returned empty nodes
    return _build_fallback_architecture(tech_stack, code_analysis, analysis)