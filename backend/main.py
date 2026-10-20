from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from repo_cloner import clone_repo, get_file_tree, read_file_contents, cleanup_repo
from agents.repo_agent import detect_tech_stack
from agents.code_agent import analyze_code
from agents.analysis_agent import analyze_apis_and_data
from agents.architecture_agent import build_architecture
from agents.verification_agent import verify_architecture
from agents.qa_agent import ask_architecture

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Server error: {str(exc)}"},
    )


class RepoRequest(BaseModel):
    github_url: str


class AskRequest(BaseModel):
    question: str
    tech_stack: dict
    code_analysis: dict
    analysis: dict
    architecture: dict


@app.get("/")
def read_root():
    return {"message": "RepoArchitect AI backend is running"}


@app.post("/analyze")
def analyze_repo(request: RepoRequest):
    local_path = None
    try:
        local_path = clone_repo(request.github_url)
        file_tree = get_file_tree(local_path)
        if not file_tree:
            raise HTTPException(status_code=400, detail="Repository is empty or contains no readable files.")

        tech_stack = detect_tech_stack(file_tree)
        file_contents = read_file_contents(local_path, file_tree)
        code_analysis = analyze_code(file_contents)
        analysis = analyze_apis_and_data(tech_stack, code_analysis)
        architecture = build_architecture(tech_stack, code_analysis, analysis)
        architecture = verify_architecture(local_path, architecture, code_analysis)

        return {
            "local_path": local_path,
            "file_count": len(file_tree),
            "tech_stack": tech_stack,
            "code_analysis": code_analysis,
            "analysis": analysis,
            "architecture": architecture
        }
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.post("/ask")
def ask_repo_question(request: AskRequest):
    try:
        result = ask_architecture(
            request.question,
            request.tech_stack,
            request.code_analysis,
            request.analysis,
            request.architecture
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process question: {str(e)}")