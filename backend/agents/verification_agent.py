import os


def verify_architecture(local_path: str, architecture: dict, code_analysis: dict) -> dict:
    """
    For each node in the architecture graph, checks whether its claimed
    files actually exist and whether the code analysis supports its role.
    Adds a confidence score and evidence list to each node.
    """

    if "nodes" not in architecture:
        return architecture

    # Build a quick lookup of what the Code Agent already knows about each file
    code_modules = {m["file"]: m for m in code_analysis.get("modules", []) if "file" in m}

    verified_nodes = []

    for node in architecture.get("nodes", []):
        evidence = []
        existing_files = []
        missing_files = []

        for file_path in node.get("files", []):
            full_path = os.path.join(local_path, file_path)
            if os.path.exists(full_path):
                existing_files.append(file_path)
                if file_path in code_modules:
                    evidence.append({
                        "file": file_path,
                        "matched_purpose": code_modules[file_path].get("purpose", ""),
                        "matched_role": code_modules[file_path].get("role", "")
                    })
            else:
                missing_files.append(file_path)

        total_files = len(node.get("files", []))
        found_ratio = len(existing_files) / total_files if total_files > 0 else 0

        if found_ratio == 1 and len(evidence) > 0:
            confidence = "High"
            reason = "All referenced files exist and match prior code analysis."
        elif found_ratio >= 0.5:
            confidence = "Medium"
            reason = "Most referenced files exist, but some evidence is incomplete."
        else:
            confidence = "Low"
            reason = "Few or no referenced files could be verified on disk."

        node["confidence"] = confidence
        node["confidence_reason"] = reason
        node["evidence"] = evidence
        node["missing_files"] = missing_files

        verified_nodes.append(node)

    architecture["nodes"] = verified_nodes
    return architecture