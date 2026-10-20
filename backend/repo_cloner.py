import os
import shutil
import git
import uuid

WORKSPACE_DIR = os.path.join(os.path.dirname(__file__), "workspace")


def clone_repo(github_url: str) -> str:
    if not github_url or not github_url.strip():
        raise ValueError("GitHub URL cannot be empty.")
    
    clean_url = github_url.strip()
    # Normalize github URLs (e.g. remove trailing slash or .git suffix if needed)
    if clean_url.endswith("/"):
        clean_url = clean_url[:-1]

    if not (clean_url.startswith("http://") or clean_url.startswith("https://") or clean_url.startswith("git@")):
        raise ValueError(f"Invalid URL schema '{github_url}'. Please provide a valid GitHub repository URL.")

    os.makedirs(WORKSPACE_DIR, exist_ok=True)
    repo_id = str(uuid.uuid4())[:8]
    local_path = os.path.join(WORKSPACE_DIR, repo_id)
    try:
        # Prevent git interactive credential prompts from hanging python execution
        git_env = os.environ.copy()
        git_env["GIT_TERMINAL_PROMPT"] = "0"
        git_env["GIT_ASKPASS"] = "echo"

        git.Repo.clone_from(clean_url, local_path, depth=1, env=git_env)
    except Exception as e:
        if os.path.exists(local_path):
            shutil.rmtree(local_path, ignore_errors=True)
        err_str = str(e)
        if "Authentication failed" in err_str or "terminal prompts disabled" in err_str:
            raise ValueError(f"Could not clone repository '{clean_url}'. Ensure the URL is correct and points to a public repository.")
        raise ValueError(f"Failed to clone repository '{clean_url}': {err_str}")

    return local_path


def get_file_tree(local_path: str, max_files: int = 150):
    ignore_dirs = {".git", "node_modules", "__pycache__", "venv", ".venv", "dist", "build", ".next", "coverage"}
    file_list = []

    for root, dirs, files in os.walk(local_path):
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        for file in files:
            rel_path = os.path.relpath(os.path.join(root, file), local_path)
            file_list.append(rel_path)
            if len(file_list) >= max_files:
                return file_list

    return file_list


def cleanup_repo(local_path: str):
    if os.path.exists(local_path):
        shutil.rmtree(local_path, ignore_errors=True)


def read_file_contents(local_path: str, file_paths: list[str], max_files: int = 25, max_chars_per_file: int = 2500):
    """
    Reads the contents of selected files (capped to avoid huge prompts).
    Skips binary/irrelevant files automatically.
    """
    code_extensions = {
        ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".rb",
        ".php", ".cs", ".cpp", ".c", ".json", ".yaml", ".yml"
    }

    contents = {}
    count = 0

    for rel_path in file_paths:
        if count >= max_files:
            break

        ext = os.path.splitext(rel_path)[1]
        if ext not in code_extensions:
            continue

        full_path = os.path.join(local_path, rel_path)
        try:
            with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read(max_chars_per_file)
                contents[rel_path] = text
                count += 1
        except Exception:
            continue

    return contents