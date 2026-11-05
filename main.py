import asyncio
import base64
import json
import random
import string
import time
import uuid
import hashlib
import hmac as _hmac
import re
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai
from qcm_storage import QCMStorageError, list_qcm_files, read_qcm, write_qcm

load_dotenv()
try:
    genai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
except Exception:
    genai_client = None
    print("ATTENTION: GEMINI_API_KEY non configurée ou invalide.")

_DEFAULT_DEV_KEY = "MonodAdmin2024"
_IS_HOSTED = bool(os.getenv("VERCEL") or os.getenv("RENDER"))
if _IS_HOSTED and (not os.getenv("QCM_PROF_KEY") or not os.getenv("SESSION_SECRET")):
    raise RuntimeError("QCM_PROF_KEY et SESSION_SECRET doivent être configurées en production.")
if _IS_HOSTED and not os.getenv("HF_REPO_ID"):
    raise RuntimeError("HF_REPO_ID doit être configurée en production pour le stockage persistant.")
_prof_plain = os.getenv("QCM_PROF_KEY", _DEFAULT_DEV_KEY)
secret_key_access: str = hashlib.sha256(_prof_plain.encode()).hexdigest()
del _prof_plain

_SIGNING_KEY = os.getenv("SESSION_SECRET", "MonodQuizDevSecret2026").encode()

def _sign_role(role: str) -> str:
    sig = _hmac.new(_SIGNING_KEY, role.encode(), "sha256").hexdigest()
    return f"{role}|{sig}"

def _verify_role(cookie_value: str) -> Optional[str]:
    if not cookie_value or "|" not in cookie_value:
        return None
    role, sig = cookie_value.split("|", 1)
    if role not in ("prof", "eleve"):
        return None
    expected = _hmac.new(_SIGNING_KEY, role.encode(), "sha256").hexdigest()
    if not _hmac.compare_digest(sig, expected):
        return None
    return role

def get_role(request: Request) -> Optional[str]:
    return _verify_role(request.cookies.get("session_role", ""))

def is_authenticated(request: Request) -> bool:
    return get_role(request) is not None

def is_prof(request: Request) -> bool:
    return get_role(request) == "prof"

def _login_redirect() -> RedirectResponse:
    return RedirectResponse("/", status_code=302)

def require_login_redirect(request: Request) -> Optional[RedirectResponse]:
    if not is_authenticated(request):
        return _login_redirect()
    return None

def require_prof_redirect(request: Request) -> Optional[RedirectResponse]:
    if redirect := require_login_redirect(request):
        return redirect
    if not is_prof(request):
        return RedirectResponse("/eleve_dashboard.html", status_code=302)
    return None

def require_eleve_redirect(request: Request) -> Optional[RedirectResponse]:
    if redirect := require_login_redirect(request):
        return redirect
    if is_prof(request):
        return RedirectResponse("/dashboard_prof", status_code=302)
    return None

def require_auth_api(request: Request) -> str:
    role = get_role(request)
    if role is None:
        raise HTTPException(status_code=401, detail="Non authentifié. Veuillez vous connecter.")
    return role

def require_prof_api(request: Request) -> None:
    if require_auth_api(request) != "prof":
        raise HTTPException(status_code=403, detail="Réservé au professeur")

def _make_session_cookie(role: str) -> str:
    return _sign_role(role)

def _issue_live_token(role: str, lifetime_seconds: int = 300) -> str:
    payload = f"{role}|{int(time.time()) + lifetime_seconds}|{uuid.uuid4().hex}".encode()
    signature = _hmac.new(_SIGNING_KEY, payload, "sha256").digest()
    encoded_payload = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    encoded_signature = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{encoded_payload}.{encoded_signature}"

def _verify_live_token(token: str) -> Optional[str]:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        payload = base64.urlsafe_b64decode(encoded_payload + "=" * (-len(encoded_payload) % 4))
        signature = base64.urlsafe_b64decode(encoded_signature + "=" * (-len(encoded_signature) % 4))
        expected = _hmac.new(_SIGNING_KEY, payload, "sha256").digest()
        if not _hmac.compare_digest(signature, expected):
            return None
        role, expires_at, _nonce = payload.decode().split("|", 2)
        if role not in ("prof", "eleve") or int(expires_at) < int(time.time()):
            return None
        return role
    except (ValueError, UnicodeDecodeError):
        return None

def _request_live_role(request: Request) -> Optional[str]:
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        return _verify_live_token(authorization[7:].strip())
    return get_role(request)

def require_prof_live_api(request: Request) -> None:
    if _request_live_role(request) != "prof":
        raise HTTPException(status_code=403, detail="Réservé au professeur")

def _hash_input(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

app = FastAPI()
_frontend_origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontend_origins or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
QCM_HTML_PATH = TEMPLATES_DIR / "create_QCM.html"
QCM_DATA_DIR = BASE_DIR / "QCM_data_base"
HF_STORAGE_ENABLED = bool(os.getenv("HF_REPO_ID", "").strip())
UPLOADS_DIR = Path(os.getenv(
    "UPLOADS_DIR",
    "/tmp/monodquiz/uploads" if HF_STORAGE_ENABLED else str(BASE_DIR / "uploads"),
))

_sp_path = BASE_DIR / "system_prompt.md"
SYSTEM_PROMPT = _sp_path.read_text(encoding="utf-8") if _sp_path.exists() else (
    "Tu es un générateur de QCM. Retourne uniquement un JSON avec une clé 'questions' contenant des objets {text, answers:[{letter,text,correct}]}."
)
NATIVE_DOCUMENT_EXT = {".pdf", ".txt", ".md"}
NATIVE_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"}

PUBLIC_DATA_DIR = QCM_DATA_DIR / "public_data_base"
PRIVATE_DATA_DIR = QCM_DATA_DIR / "private_data_base"
if not HF_STORAGE_ENABLED:
    QCM_DATA_DIR.mkdir(exist_ok=True)
    PUBLIC_DATA_DIR.mkdir(exist_ok=True)
    PRIVATE_DATA_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

if not os.getenv("VERCEL"):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_PROF_ONLY_PAGES = {"create_QCM", "prof_dashboard", "room", "home_prof"}
_ELEVE_ONLY_PAGES = {"use_qcm", "eleve_dashboard"}

QUESTION_DURATION = 30
REVEAL_DELAY = 3
LEADERBOARD_DELAY = 5
DISCONNECT_GRACE_PERIOD = 1.0

rooms: Dict[str, dict] = {}
GAME_IN_PROGRESS_PHASES = ("question", "reveal", "leaderboard")

class QCMSavePayload(BaseModel):
    qcm_name: str = Field(min_length=1)
    auteur: str = Field(min_length=1)
    theme: str = Field(min_length=1)
    visibilite: bool
    level: str = Field(min_length=1)
    questions: list
    source_file: str = None

class LoginPayload(BaseModel):
    pseudo: str = Field(min_length=1)

class CreateRoomPayload(BaseModel):
    qcm_file: str

def extract_docx_text(path: str) -> str:
    from docx import Document
    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())

def build_file_block(path: str) -> dict:
    ext = Path(path).suffix.lower()
    if ext in NATIVE_IMAGE_EXT:
        uploaded = genai_client.files.upload(file=path)
        return {"type": "image", "uri": uploaded.uri, "mime_type": uploaded.mime_type}
    if ext in NATIVE_DOCUMENT_EXT:
        uploaded = genai_client.files.upload(file=path)
        return {"type": "document", "uri": uploaded.uri, "mime_type": uploaded.mime_type}
    if ext == ".docx":
        text = extract_docx_text(path)
        return {"type": "text", "text": f"[Contenu extrait de {Path(path).name}]\n{text}"}
    raise ValueError(f"Extension non supportée : {ext}")

def generate_qcm_with_ai(user_prompt: str, file_paths: list[str] | None = None) -> str:
    if not genai_client:
        raise HTTPException(status_code=500, detail="L'IA n'est pas configurée sur le serveur.")
    input_blocks = []
    if file_paths:
        for path in file_paths:
            input_blocks.append(build_file_block(path))
    input_blocks.append({"type": "text", "text": user_prompt})
    interaction = genai_client.interactions.create(
        model="gemini-3.1-flash-lite",
        system_instruction=SYSTEM_PROMPT,
        input=input_blocks,
    )
    return interaction.output_text

def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower())
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug or "qcm"

def save_qcm(payload: QCMSavePayload) -> dict:
    if not payload.questions:
        raise HTTPException(status_code=400, detail="Aucune question à sauvegarder")
    data = {
        "qcm_name": payload.qcm_name, "auteur": payload.auteur, "theme": payload.theme,
        "visibilite": payload.visibilite, "level": payload.level, "questions": payload.questions,
    }
    if payload.source_file:
        try:
            read_qcm(payload.source_file, BASE_DIR)
            write_qcm(payload.source_file, data, BASE_DIR, f"Mettre à jour {Path(payload.source_file).name}")
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Fichier QCM introuvable") from exc
        except QCMStorageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        source = Path(payload.source_file)
        return {"message": "QCM mis à jour", "filename": source.name, "directory": str(source.parent)}

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{slugify(payload.theme)}_{slugify(payload.auteur)}_{timestamp}.json"
    visibility_dir = "public_data_base" if payload.visibilite else "private_data_base"
    relative_path = f"QCM_data_base/{visibility_dir}/{slugify(payload.theme)}/{filename}"
    try:
        write_qcm(relative_path, data, BASE_DIR, f"Ajouter {filename}")
    except QCMStorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"message": "QCM sauvegardé", "filename": filename, "directory": str(Path(relative_path).parent)}

def format_qcm_for_classroom(raw_questions: list) -> list:
    """Traduit le format JSON de l'IA vers le format attendu par classroom.html"""
    formatted = []
    for q in raw_questions:
        q_text = q.get("text", "Question sans texte")
        ans_list = q.get("answers", [])
        ans_texts = [a.get("text", "") for a in ans_list]
        correct_indices = [i for i, answer in enumerate(ans_list) if answer.get("correct", False)]
        if not correct_indices:
            correct_indices = [0]
        formatted.append({
            "question": q_text,
            "answers": ans_texts,
            "correct": correct_indices[0],
            "correct_indices": correct_indices,
            "multiple": bool(q.get("multiple", False)),
        })
    return formatted

@app.post("/api/login")
def login(payload: LoginPayload):
    if _hmac.compare_digest(_hash_input(payload.pseudo).encode(), secret_key_access.encode()):
        role = "prof"
    else:
        role = "eleve"
    resp = JSONResponse({"role": role})
    resp.set_cookie(key="session_role", value=_make_session_cookie(role), httponly=True, samesite="lax", max_age=86400 * 7)
    return resp

@app.get("/api/check-role")
def check_role(request: Request):
    role = get_role(request)
    return JSONResponse({"role": role, "authenticated": role is not None})

@app.get("/api/live-token")
def live_token(request: Request):
    role = require_auth_api(request)
    return JSONResponse({"token": _issue_live_token(role), "expires_in": 300})

@app.get("/health")
def health():
    return JSONResponse({"status": "ok"})

@app.post("/api/logout")
def logout():
    resp = RedirectResponse("/", status_code=302)
    resp.delete_cookie("session_role")
    return resp

@app.get("/api/logout")
def logout_get():
    resp = RedirectResponse("/", status_code=302)
    resp.delete_cookie("session_role")
    return resp

@app.post("/api/generate-qcm")
async def generate_qcm_endpoint(request: Request, user_prompt: str = Form(...), files: list[UploadFile] = File(default=[])):
    require_prof_api(request)
    if not user_prompt or not user_prompt.strip(): raise HTTPException(status_code=400, detail="Le prompt utilisateur est vide")
    file_paths = []
    try:
        for file in files:
            if file and file.filename:
                file_path = UPLOADS_DIR / f"{uuid.uuid4().hex}_{Path(file.filename).name}"
                content = await file.read()
                file_path.write_bytes(content)
                file_paths.append(str(file_path))
        ai_output = generate_qcm_with_ai(user_prompt, file_paths if file_paths else None)
        try:
            qcm_data = json.loads(ai_output)
        except json.JSONDecodeError:
            json_match = re.search(r'\{[\s\S]*\}', ai_output)
            if json_match: qcm_data = json.loads(json_match.group())
            else: raise HTTPException(status_code=400, detail="L'IA n'a pas retourné un JSON valide")
        return JSONResponse(qcm_data)
    finally:
        for path in file_paths:
            try: Path(path).unlink()
            except Exception: pass

@app.post("/api/qcm/save")
def qcm_save_endpoint(request: Request, payload: QCMSavePayload):
    require_prof_api(request)
    return JSONResponse(save_qcm(payload))

@app.get("/api/qcm/list")
def qcm_list(request: Request):
    role = require_auth_api(request)
    qcms = []
    try:
        file_paths = list_qcm_files(PUBLIC_DATA_DIR, PRIVATE_DATA_DIR, BASE_DIR)
        for file_path in file_paths:
            try:
                data = read_qcm(file_path, BASE_DIR)
                if role != "prof" and not data.get("visibilite", False):
                    continue
                path = Path(file_path)
                qcms.append({
                    "filename": path.name,
                    "theme_dir": str(path.parent),
                    "full_path": file_path,
                    "qcm_name": data.get("qcm_name", ""),
                    "auteur": data.get("auteur", "Inconnu"),
                    "theme": data.get("theme", ""),
                    "visibilite": data.get("visibilite", False),
                    "level": data.get("level", ""),
                    "nb_questions": len(data.get("questions", [])),
                })
            except (json.JSONDecodeError, KeyError, FileNotFoundError):
                continue
    except QCMStorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(qcms)

@app.get("/api/qcm/read/{file_path:path}")
def qcm_read(request: Request, file_path: str):
    role = require_auth_api(request)
    try:
        data = read_qcm(file_path, BASE_DIR)
        if role != "prof" and not data.get("visibilite", False):
            raise HTTPException(status_code=404, detail="QCM introuvable")
        data["_source_file"] = file_path
        return JSONResponse(data)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="QCM introuvable") from exc
    except QCMStorageError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Fichier JSON invalide") from exc

@app.post("/api/create_room")
def create_room(payload: CreateRoomPayload, request: Request):
    require_prof_live_api(request)
    try:
        qcm_data = read_qcm(payload.qcm_file, BASE_DIR)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="QCM introuvable sur le serveur")
    except QCMStorageError as exc:
        raise HTTPException(status_code=502, detail="Le stockage des QCM est temporairement indisponible") from exc

    room_id = str(uuid.uuid4())
    code = generate_code()
    rooms[code] = {
        "id": room_id, 
        "prof_ws": None, 
        "students": {}, 
        "quiz": None,
        "qcm_data": qcm_data
    }
    return JSONResponse({"room_id": room_id, "code": code})

def generate_code(length: int = 4) -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choices(alphabet, k=length))
        if code not in rooms: return code

async def send_to(ws, payload: dict) -> None:
    if ws is None: return
    try: await ws.send_text(json.dumps(payload))
    except Exception: pass

async def broadcast_student_list(code: str) -> None:
    room = rooms.get(code)
    if not room: return
    await send_to(room.get("prof_ws"), {"type": "student_list", "students": list(room["students"].keys())})

async def broadcast_to_room(code: str, payload: dict) -> None:
    room = rooms.get(code)
    if not room: return
    await send_to(room.get("prof_ws"), payload)
    for ws in list(room["students"].values()): await send_to(ws, payload)

async def start_question(code: str) -> None:
    room = rooms.get(code)
    if not room or not room.get("quiz"): return

    quiz = room["quiz"]
    idx = quiz["current_index"]
    
    qcm_data = room.get("qcm_data", {})
    formatted_questions = format_qcm_for_classroom(qcm_data.get("questions", []))
    
    if idx >= len(formatted_questions): return

    question = formatted_questions[idx]

    quiz["phase"] = "question"
    quiz["answers"] = {}
    quiz["phase_ends_at"] = time.monotonic() + QUESTION_DURATION
    quiz["current_question_payload"] = {
        "type": "question", "index": idx, "total": len(formatted_questions),
        "question": question["question"], "answers": question["answers"],
        "multiple": question["multiple"],
        "full_duration": QUESTION_DURATION,
    }

    await broadcast_to_room(code, {**quiz["current_question_payload"], "duration": QUESTION_DURATION})
    quiz["timer_task"] = asyncio.create_task(question_timer(code, idx, len(formatted_questions)))

async def question_timer(code: str, index: int, total_q: int) -> None:
    try:
        await asyncio.sleep(QUESTION_DURATION)
        await end_question(code, index, total_q)
    except asyncio.CancelledError: pass

async def end_question(code: str, index: int, total_q: int) -> None:
    room = rooms.get(code)
    if not room or not room.get("quiz"): return
    quiz = room["quiz"]
    if quiz["current_index"] != index or quiz["phase"] != "question": return

    quiz["phase"] = "reveal"
    
    qcm_data = room.get("qcm_data", {})
    formatted_questions = format_qcm_for_classroom(qcm_data.get("questions", []))
    question = formatted_questions[index]
    correct_indices = question["correct_indices"]
    correct_index = correct_indices[0]

    counts = [0, 0, 0, 0]
    correct_order = []
    correct_set = set(correct_indices)
    for student_name, answer_value in quiz["answers"].items():
        selected_indices = answer_value if isinstance(answer_value, list) else [answer_value]
        for answer_index in selected_indices:
            if isinstance(answer_index, int) and 0 <= answer_index < 4: counts[answer_index] += 1
        if set(selected_indices) == correct_set:
            quiz["scores"][student_name] = quiz["scores"].get(student_name, 0) + 1
            correct_order.append(student_name)

    for rank, student_name in enumerate(correct_order, start=1):
        pts = 150 if rank == 1 else max(0, 150 - 20 - rank)
        quiz["points"][student_name] = quiz["points"].get(student_name, 0) + pts

    total_respondents = len(quiz["answers"])
    percents = [round((c / total_respondents) * 100) if total_respondents > 0 else 0 for c in counts]
    is_last = index == total_q - 1

    quiz["phase_ends_at"] = time.monotonic() + REVEAL_DELAY
    quiz["current_reveal_payload"] = {
        "type": "reveal", "index": index, "total": total_q, "correct_index": correct_index,
        "correct_indices": correct_indices, "multiple": question["multiple"],
        "answers": question["answers"], "counts": counts, "percents": percents, "is_last": is_last,
    }

    await broadcast_to_room(code, {**quiz["current_reveal_payload"], "next_delay": REVEAL_DELAY})
    await asyncio.sleep(REVEAL_DELAY)

    room = rooms.get(code)
    if not room or not room.get("quiz") or room["quiz"] is not quiz: return

    quiz["phase"] = "leaderboard"
    ranking = [{"name": n, "points": quiz["points"].get(n, 0)} for n in quiz["participants"]]
    ranking.sort(key=lambda r: r["points"], reverse=True)

    quiz["phase_ends_at"] = time.monotonic() + LEADERBOARD_DELAY
    quiz["current_leaderboard_payload"] = {
        "type": "leaderboard", "index": index, "total": total_q, "ranking": ranking, "is_last": is_last,
    }

    await broadcast_to_room(code, {**quiz["current_leaderboard_payload"], "next_delay": LEADERBOARD_DELAY})
    await asyncio.sleep(LEADERBOARD_DELAY)

    room = rooms.get(code)
    if not room or not room.get("quiz") or room["quiz"] is not quiz: return

    if not is_last:
        quiz["current_index"] = index + 1
        await start_question(code)
    else:
        quiz["phase"] = "finished"
        quiz["phase_ends_at"] = None
        await send_quiz_finished(code, room, quiz, total_q)

async def send_quiz_finished(code: str, room: dict, quiz: dict, total_q: int) -> None:
    full_points = {n: quiz["points"].get(n, 0) for n in quiz["participants"]}
    ranking = [{"name": n, "points": p} for n, p in full_points.items()]
    ranking.sort(key=lambda r: r["points"], reverse=True)
    participants = len(quiz.get("participants") or room["students"])

    for student_name, ws in list(room["students"].items()):
        score = quiz["scores"].get(student_name, 0)
        await send_to(ws, {"type": "quiz_finished", "score": score, "total": total_q, "ranking": ranking, "participants": participants})

    await send_to(room.get("prof_ws"), {
        "type": "quiz_finished_prof", "scores": quiz["scores"], "points": full_points,
        "participants": participants, "total": total_q,
    })

def build_resync_message(room: dict, role: str, name: str, total_q: int) -> Optional[dict]:
    quiz = room.get("quiz")
    if not quiz: return None
    phase = quiz.get("phase")
    ends_at = quiz.get("phase_ends_at")
    remaining = max(1, round(ends_at - time.monotonic())) if ends_at else 0

    if phase == "question":
        payload = quiz.get("current_question_payload")
        return {**payload, "duration": remaining} if payload else None
    if phase == "reveal":
        payload = quiz.get("current_reveal_payload")
        return {**payload, "next_delay": remaining} if payload else None
    if phase == "leaderboard":
        payload = quiz.get("current_leaderboard_payload")
        return {**payload, "next_delay": remaining} if payload else None
    if phase == "finished":
        full_points = {n: quiz["points"].get(n, 0) for n in quiz["participants"]}
        ranking = [{"name": n, "points": p} for n, p in full_points.items()]
        ranking.sort(key=lambda r: r["points"], reverse=True)
        participants = len(quiz.get("participants") or room["students"])
        if role == "prof":
            return {"type": "quiz_finished_prof", "scores": quiz["scores"], "points": full_points, "participants": participants, "total": total_q}
        return {"type": "quiz_finished", "score": quiz["scores"].get(name, 0), "total": total_q, "ranking": ranking, "participants": participants}
    return None

def cancel_quiz_timer(quiz: dict) -> None:
    task = quiz.get("timer_task")
    if task and not task.done(): task.cancel()

async def handle_prof_disconnect(code: str):
    await asyncio.sleep(DISCONNECT_GRACE_PERIOD)
    room = rooms.get(code)
    if room and room.get("prof_ws") is None:
        await broadcast_to_room(code, {"type": "error", "message": "Le professeur a fermé la salle. La session est terminée."})
        for ws in list(room["students"].values()):
            try: await ws.close()
            except Exception: pass
        quiz = room.get("quiz")
        if quiz:
            cancel_quiz_timer(quiz)
        rooms.pop(code, None)

async def handle_room_empty(code: str):
    room = rooms.get(code)
    if not room or room["students"]:
        return
    prof_ws = room.get("prof_ws")
    if prof_ws:
        await send_to(prof_ws, {
            "type": "room_empty",
            "message": "Tous les élèves ont quitté la salle. La session a été fermée car il n'y avait plus aucun joueur connecté.",
        })
        try:
            await prof_ws.close()
        except Exception:
            pass
        room["prof_ws"] = None
    quiz = room.get("quiz")
    if quiz:
        cancel_quiz_timer(quiz)
    rooms.pop(code, None)

async def handle_student_disconnect(code: str, name: str, old_ws: WebSocket):
    await asyncio.sleep(DISCONNECT_GRACE_PERIOD)
    room = rooms.get(code)
    if room and room["students"].get(name) is old_ws:
        room["students"].pop(name, None)
        await broadcast_student_list(code)
        quiz = room.get("quiz")
        game_in_progress = bool(quiz) and quiz.get("phase") in GAME_IN_PROGRESS_PHASES
        if not room["students"] and game_in_progress:
            await handle_room_empty(code)
            return
        if quiz and quiz["phase"] == "question":
            await send_to(room.get("prof_ws"), {"type": "responses_update", "received": len(quiz["answers"]), "total": len(room["students"])})

@app.websocket("/ws/{code}")
async def websocket_endpoint(websocket: WebSocket, code: str, role: str = "eleve", name: str = "Élève"):
    code = code.upper()

    ticket = websocket.query_params.get("ticket", "")
    actual_role = _verify_live_token(ticket) if ticket else _verify_role(websocket.cookies.get("session_role", ""))
    if actual_role is None or actual_role != role:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    room = rooms.get(code)
    if room is None:
        await send_to(websocket, {"type": "error", "message": "Salle introuvable"})
        await websocket.close()
        return

    qcm_data = room.get("qcm_data", {})
    total_q = len(qcm_data.get("questions", []))

    if role == "prof":
        room["prof_ws"] = websocket
        await broadcast_student_list(code)
    else:
        quiz = room.get("quiz")
        game_in_progress = bool(quiz) and quiz.get("phase") in GAME_IN_PROGRESS_PHASES
        already_playing = bool(quiz) and name in quiz.get("participants", set())
        if game_in_progress and not already_playing:
            await send_to(websocket, {"type": "error", "message": "La partie a déjà commencé, impossible de rejoindre pour le moment."})
            await websocket.close()
            return
        room["students"][name] = websocket
        await send_to(websocket, {"type": "joined", "code": code, "name": name})
        await broadcast_student_list(code)

    resync_msg = build_resync_message(room, role, name, total_q)
    if resync_msg: await send_to(websocket, resync_msg)

    try:
        while True:
            raw = await websocket.receive_text()
            try: data = json.loads(raw)
            except json.JSONDecodeError: continue

            action = data.get("action")
            if role == "prof" and action == "start_quiz":
                if len(room["students"]) < 1:
                    await send_to(websocket, {"type": "error", "message": "Il faut au minimum 1 élève connecté pour démarrer le quiz."})
                else:
                    old_quiz = room.get("quiz")
                    if old_quiz: cancel_quiz_timer(old_quiz)
                    room["quiz"] = {
                        "current_index": 0, "phase": "question", "answers": {}, "scores": {},
                        "points": {}, "participants": set(room["students"].keys()), "timer_task": None,
                    }
                    await start_question(code)

            elif role == "prof" and action == "validate_question":
                quiz = room.get("quiz")
                if quiz and quiz["phase"] == "question":
                    cancel_quiz_timer(quiz)
                    asyncio.create_task(end_question(code, quiz["current_index"], total_q))

            elif role != "prof" and action == "answer":
                quiz = room.get("quiz")
                if quiz and quiz["phase"] == "question" and name not in quiz["answers"]:
                    answer_value = data.get("answer_index")
                    is_multiple = quiz["current_question_payload"].get("multiple", False)
                    if is_multiple and isinstance(answer_value, list):
                        answer_value = sorted(set(index for index in answer_value if isinstance(index, int) and 0 <= index < 4))
                    elif isinstance(answer_value, int) and 0 <= answer_value < 4:
                        answer_value = answer_value
                    else:
                        answer_value = None
                    if answer_value is not None and (not is_multiple or answer_value):
                        quiz["answers"][name] = answer_value
                        await send_to(websocket, {"type": "answer_locked", "answer_index": answer_value})
                        await send_to(room.get("prof_ws"), {"type": "responses_update", "received": len(quiz["answers"]), "total": len(room["students"])})
                        if room["students"] and len(quiz["answers"]) >= len(room["students"]):
                            cancel_quiz_timer(quiz)
                            asyncio.create_task(end_question(code, quiz["current_index"], total_q))

    except WebSocketDisconnect:
        if role == "prof":
            if room.get("prof_ws") is websocket:
                room["prof_ws"] = None
                asyncio.create_task(handle_prof_disconnect(code))
        else:
            asyncio.create_task(handle_student_disconnect(code, name, websocket))

@app.get("/", response_class=HTMLResponse)
def get_login():
    path = TEMPLATES_DIR / "login.html"
    if not path.exists(): raise HTTPException(status_code=404, detail=f"Fichier cherché ici : {path}")
    return path.read_text(encoding="utf-8")

@app.get("/dashboard_prof", response_class=HTMLResponse)
def get_dashboard_prof(request: Request):
    if redirect := require_prof_redirect(request):
        return redirect
    path = TEMPLATES_DIR / "prof_dashboard.html"
    if not path.exists(): raise HTTPException(status_code=404, detail="prof_dashboard.html introuvable")
    return path.read_text(encoding="utf-8")

@app.get("/prof_dashboard.html", response_class=HTMLResponse)
def get_prof_dashboard_html(request: Request):
    if redirect := require_prof_redirect(request):
        return redirect
    path = TEMPLATES_DIR / "prof_dashboard.html"
    if not path.exists(): raise HTTPException(status_code=404, detail="prof_dashboard.html introuvable")
    return path.read_text(encoding="utf-8")

@app.get("/qcm", response_class=HTMLResponse)
def qcm_page(request: Request):
    if redirect := require_prof_redirect(request):
        return redirect
    if not QCM_HTML_PATH.exists(): raise HTTPException(status_code=404, detail="create_QCM.html introuvable")
    return QCM_HTML_PATH.read_text(encoding="utf-8")

@app.get("/eleve_dashboard.html", response_class=HTMLResponse)
def get_eleve_dashboard(request: Request):
    if redirect := require_eleve_redirect(request):
        return redirect
    path = TEMPLATES_DIR / "eleve_dashboard.html"
    if not path.exists(): raise HTTPException(status_code=404, detail="eleve_dashboard.html introuvable")
    return path.read_text(encoding="utf-8")

@app.get("/use_qcm.html", response_class=HTMLResponse)
def get_use_qcm(request: Request):
    if redirect := require_eleve_redirect(request):
        return redirect
    path = TEMPLATES_DIR / "use_qcm.html"
    if not path.exists(): raise HTTPException(status_code=404, detail="use_qcm.html introuvable")
    return path.read_text(encoding="utf-8")

@app.get("/room.html", response_class=HTMLResponse)
def get_room_html(request: Request):
    if redirect := require_prof_redirect(request):
        return redirect
    path = TEMPLATES_DIR / "room.html"
    if not path.exists(): raise HTTPException(status_code=404, detail="room.html introuvable")
    html = path.read_text(encoding="utf-8")
    return html.replace("{{CLASS_CODE}}", generate_code())

@app.get("/home_prof.html", response_class=HTMLResponse)
def get_home_prof_html(request: Request):
    if redirect := require_prof_redirect(request):
        return redirect
    path = TEMPLATES_DIR / "home_prof.html"
    if not path.exists(): raise HTTPException(status_code=404, detail="home_prof.html introuvable")
    return path.read_text(encoding="utf-8")

@app.get("/classroom.html", response_class=HTMLResponse)
def get_classroom_html(request: Request):
    if redirect := require_login_redirect(request):
        return redirect
    path = TEMPLATES_DIR / "classroom.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="classroom.html introuvable")
    return path.read_text(encoding="utf-8")

@app.get("/{page_name}.html", response_class=HTMLResponse)
def get_html_page(page_name: str, request: Request):
    if redirect := require_login_redirect(request):
        return redirect
    if page_name in _PROF_ONLY_PAGES and not is_prof(request):
        return RedirectResponse("/eleve_dashboard.html", status_code=302)
    if page_name in _ELEVE_ONLY_PAGES and is_prof(request):
        return RedirectResponse("/dashboard_prof", status_code=302)

    path = TEMPLATES_DIR / f"{page_name}.html"
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"{page_name}.html introuvable")
    return path.read_text(encoding="utf-8")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
