import eventlet
eventlet.monkey_patch()

import os
import json
import random
import threading
import unicodedata
import re
import uuid
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from difflib import SequenceMatcher
from flask import Flask, render_template, request, send_from_directory
from flask_socketio import SocketIO, emit, join_room, disconnect as disconnect_client
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
UPLOAD_FOLDER = os.path.join("data", "uploads")
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

DATA_DIR = "data"
QUESTIONS_FILE = os.path.join(DATA_DIR, "questions.json")
USED_FILE = os.path.join(DATA_DIR, "used.json")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://tkuagggdzzyagvkgrksc.supabase.co")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_NOTE_ID = 1
OMDB_API_KEY = os.environ.get("OMDB_API_KEY", "")
OMDB_API_URL = "https://www.omdbapi.com/"
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY) if SUPABASE_ANON_KEY else None

SIMILARITY_THRESHOLD = 0.50
ACCESS_PASSWORD = os.environ.get("ACCESS_PASSWORD", "euteamoleide")
SESSION_ROOM = "couple-session"
MAX_USERS = 2
ADEDONHA_DURATION = 90
ADEDONHA_CATEGORIES = [
    "nome", "cep", "animal", "fruta", "objeto", "cor", "profissao",
    "sogra", "marca", "filme", "novela", "cantor", "comida", "corpo",
    "palavrao", "from"
]

rooms = {}
connected_sids = set()
lock = threading.Lock()


def session_state():
    return rooms.setdefault(SESSION_ROOM, {
        "admin_sid": None,
        "players": {},
        "status": "waiting",
        "current_question": None,
        "answers": {},
        "guesses": {},
        "chat_messages": [],
        "active_game": None,
        "stop_round": 0,
        "stop_timer": None
    })


def broadcast_players(room):
    socketio.emit("session_update", {
        "players": [
                {"name": player["name"], "score": player["score"], "role": player["role"]}
            for player in room["players"].values()
        ],
        "count": len(room["players"])
    }, to=SESSION_ROOM)

def ensure_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    if not os.path.exists(QUESTIONS_FILE):
        with open(QUESTIONS_FILE, "w", encoding="utf-8") as f:
            json.dump({"questions": []}, f, ensure_ascii=False, indent=2)
    if not os.path.exists(USED_FILE):
        with open(USED_FILE, "w", encoding="utf-8") as f:
            json.dump({}, f, ensure_ascii=False, indent=2)
def _load_note_from_supabase():
    if supabase is None:
        raise RuntimeError("SUPABASE_ANON_KEY não configurada")
    app.logger.info("[Supabase] loading filmes_lista id=%s", SUPABASE_NOTE_ID)
    response = (
        supabase.table("filmes_lista")
        .select("text, history, items, events")
        .eq("id", SUPABASE_NOTE_ID)
        .maybe_single()
        .execute()
    )
    row = response.data or {}
    return {
        "text": row.get("text", ""),
        "history": row.get("history", []) or [],
        "items": row.get("items", []) or [],
        "events": row.get("events", []) or [],
    }


def _save_note_to_supabase(note):
    if supabase is None:
        raise RuntimeError("SUPABASE_ANON_KEY não configurada")
    app.logger.info("[Supabase] saving filmes_lista id=%s", SUPABASE_NOTE_ID)
    supabase.table("filmes_lista").upsert({
        "id": SUPABASE_NOTE_ID,
        "text": note["text"],
        "history": note["history"],
        "items": note.get("items", []),
        "events": note.get("events", []),
    }).execute()


def load_note_sync():
    return _load_note_from_supabase()


def save_note_sync(note):
    return _save_note_to_supabase(note)


def empty_list_state():
    return {"text": "", "history": [], "items": [], "events": []}


def supabase_is_configured():
    return supabase is not None


def _load_cycle_from_supabase(player_name):
    if supabase is None:
        raise RuntimeError("SUPABASE_ANON_KEY não configurada")
    app.logger.info("[Supabase] loading ciclo_menstrual usuario=%s", player_name)
    response = (
        supabase.table("ciclo_menstrual")
        .select("data_ultima_menstruacao, duracao_ciclo, anotacoes_extras")
        .eq("usuario", player_name)
        .maybe_single()
        .execute()
    )
    row = response.data
    if not row:
        return None
    return {
        "last_period": row.get("data_ultima_menstruacao"),
        "cycle_length": row.get("duracao_ciclo", 28),
        "notes": row.get("anotacoes_extras", "") or "",
    }


def _save_cycle_to_supabase(player_name, cycle):
    if supabase is None:
        raise RuntimeError("SUPABASE_ANON_KEY não configurada")
    app.logger.info("[Supabase] upserting ciclo_menstrual usuario=%s", player_name)
    supabase.table("ciclo_menstrual").upsert({
        "usuario": player_name,
        "data_ultima_menstruacao": cycle["last_period"],
        "duracao_ciclo": cycle["cycle_length"],
        "anotacoes_extras": cycle.get("notes", ""),
    }, on_conflict="usuario").execute()


def load_cycle_sync(player_name):
    return _load_cycle_from_supabase(player_name)


def save_cycle_sync(player_name, cycle):
    return _save_cycle_to_supabase(player_name, cycle)


def calendar_snapshot(note, cycle):
    return {
        "events": note.get("events", []),
        "cycle": cycle,
    }


def send_initial_shared_state(sid, player_name):
    note = empty_list_state()
    cycle = None
    if supabase_is_configured():
        try:
            note = load_note_sync()
        except Exception:
            app.logger.exception("Could not load shared state after authentication")
        try:
            cycle = load_cycle_sync(player_name)
        except Exception:
            app.logger.exception("Could not load menstrual cycle after authentication")
    socketio.emit("note_updated", {
        "text": note["text"],
        "can_undo": bool(note["history"]),
    }, to=sid)
    socketio.emit("list_updated", {"items": note["items"]}, to=sid)
    socketio.emit("calendar_updated", calendar_snapshot(note, cycle), to=sid)


def fetch_omdb_title(title):
    if not OMDB_API_KEY:
        raise RuntimeError("OMDB_API_KEY não configurada")
    app.logger.info("[OMDb] searching title=%s", title)
    query = urlencode({"apikey": OMDB_API_KEY, "t": title, "plot": "full", "r": "json"})
    request = Request(f"{OMDB_API_URL}?{query}", headers={"User-Agent": "minha-pacoquinha/1.0"})
    with urlopen(request, timeout=8) as response:
        result = json.loads(response.read().decode("utf-8"))
    if result.get("Response") != "True":
        raise ValueError(result.get("Error", "Título não encontrado na OMDb."))
    app.logger.info("[OMDb] found imdbID=%s title=%s", result.get("imdbID"), result.get("Title"))
    return {
        "imdbID": result.get("imdbID", ""),
        "title": result.get("Title", title),
        "year": result.get("Year", ""),
        "plot": result.get("Plot", "Sinopse não disponível."),
        "poster": result.get("Poster", "N/A"),
        "type": result.get("Type", ""),
    }


def game_snapshot(room):
    return room.get("active_game")


def emit_game_state(room):
    socketio.emit("game_state", game_snapshot(room), to=SESSION_ROOM)


def reset_active_game(room):
    room["active_game"] = None
    room["stop_timer"] = None
    room["status"] = "waiting"
    room["answers"] = {}
    room["guesses"] = {}
    room["current_question"] = None


def sanitize_letters(value):
    return re.sub(r"[^A-Za-zÀ-ÿ ]", "", str(value or "")).strip()[:80]


def stop_round_timeout(round_id):
    for remaining in range(ADEDONHA_DURATION, 0, -1):
        eventlet.sleep(1)
        room = rooms.get(SESSION_ROOM)
        game = room.get("active_game") if room else None
        if not room or room.get("stop_round") != round_id or not game or game.get("phase") != "playing":
            return
        game["remaining"] = remaining - 1
        emit_game_state(room)
    finish_stop_round(room)


def finish_stop_round(room):
    game = room.get("active_game")
    if not game or game.get("type") != "stopotes" or game.get("phase") != "playing":
        return
    game["phase"] = "results"
    game["remaining"] = 0
    scores = score_stopotes(game["answers"], game["letter"])
    totals = {
        sid: sum(category_scores.get(sid, 0) for category_scores in scores.values())
        for sid in room["players"]
    }
    game["results"] = {"scores": scores, "totals": totals, "answers": game["answers"]}
    for sid, points in totals.items():
        room["players"][sid]["score"] += points
    emit_game_state(room)
    broadcast_players(room)


def score_stopotes(answers, letter):
    results = {}
    normalized_letter = normalize_text(letter)[:1]
    for category in ADEDONHA_CATEGORIES:
        values = {}
        for sid, player_answers in answers.items():
            value = normalize_text(player_answers.get(category, ""))
            if value and value.startswith(normalized_letter):
                values.setdefault(value, []).append(sid)
        results[category] = {
            sid: (10 if normalize_text(answers.get(sid, {}).get(category, "")).startswith(normalized_letter)
                  and len(values.get(normalize_text(answers[sid][category]), [])) == 1 else
                  5 if normalize_text(answers.get(sid, {}).get(category, "")).startswith(normalized_letter)
                  and len(values.get(normalize_text(answers[sid][category]), [])) > 1 else 0)
            for sid in answers
        }
    return results


def load_questions():
    ensure_files()
    with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
        return json.load(f).get("questions", [])

def save_questions(questions):
    with open(QUESTIONS_FILE, "w", encoding="utf-8") as f:
        json.dump({"questions": questions}, f, ensure_ascii=False, indent=2)

def load_used():
    ensure_files()
    with open(USED_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_used(used):
    with open(USED_FILE, "w", encoding="utf-8") as f:
        json.dump(used, f, ensure_ascii=False, indent=2)

def normalize_text(text):
    if not text:
        return ""
    text = text.lower().strip()
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^\w\s]", "", text)
    return " ".join(text.split())

def check_approximate_match(real, guess, threshold=SIMILARITY_THRESHOLD):
    norm_real = normalize_text(real)
    norm_guess = normalize_text(guess)

    if not norm_real or not norm_guess:
        return False

    if norm_real == norm_guess:
        return True

    if norm_guess in norm_real or norm_real in norm_guess:
        return True

    similarity = SequenceMatcher(None, norm_real, norm_guess).ratio()
    return similarity >= threshold

def ensure_question_batch(room_code):
    questions = load_questions()
    used = load_used()
    used_ids = set(used.get(room_code, []))

    available = [q for q in questions if q.get("id") not in used_ids]

    if not available and questions:
        used[room_code] = []
        save_used(used)
        available = questions

    if not available:
        fallback = [
            "Qual é uma coisa simples que sempre melhora seu dia?",
            "Qual viagem você gostaria de fazer comigo?",
            "Qual comida você escolheria para comer pelo resto da semana?",
            "Qual é uma memória nossa que você gosta muito?",
            "Qual filme ou série você acha que combina comigo?",
            "Se pudesse aprender qualquer habilidade agora, qual seria?",
            "Qual lugar você gostaria de conhecer?",
            "Qual presente simples você gostaria de receber?",
            "Qual música lembra um momento especial?",
            "Qual seria um dia perfeito para você?"
        ]
        questions = [
            {"id": f"local-{i}-{random.randint(1000,9999)}", "text": text}
            for i, text in enumerate(fallback)
        ]
        save_questions(questions)
        available = questions

    return random.choice(available)

def reset_room_used(room_code):
    used = load_used()
    used.pop(room_code, None)
    save_used(used)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

@app.route("/api/upload", methods=["POST"])
def upload_file_route():
    if "file" not in request.files:
        return {"error": "Nenhum arquivo enviado"}, 400
    file = request.files["file"]
    if file.filename == "":
        return {"error": "Arquivo sem nome"}, 400

    if request.content_length and request.content_length > app.config["MAX_CONTENT_LENGTH"]:
        return {"error": "Arquivo muito grande. O limite é 16 MB."}, 413

    ext = os.path.splitext(file.filename)[1].lower()
    allowed_extensions = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".txt", ".mp4", ".mov"}
    if ext not in allowed_extensions:
        return {"error": "Tipo de arquivo não suportado."}, 415
    unique_name = f"{uuid.uuid4().hex}{ext}"
    save_path = os.path.join(app.config["UPLOAD_FOLDER"], unique_name)
    file.save(save_path)

    file_url = f"/uploads/{unique_name}"
    return {"url": file_url, "filename": file.filename}


@app.errorhandler(413)
def request_entity_too_large(error):
    return {"error": "Arquivo muito grande. O limite é 16 MB."}, 413


@app.route("/api/supabase-check")
def supabase_check():
    try:
        note = load_note_sync()
        return {"ok": True, "table": "filmes_lista", "text_length": len(note["text"])}
    except Exception as error:
        app.logger.exception("Supabase connection check failed")
        return {"ok": False, "error": str(error)}, 503
@socketio.on("connect")
def handle_connect():
    with lock:
        is_full = len(connected_sids) >= MAX_USERS
        if not is_full:
            connected_sids.add(request.sid)

    if is_full:
        emit("access_denied", {"message": "Nosso cantinho já está ocupado no momento. Tente novamente em instantes 💕"})
        disconnect_client()
        return False


@socketio.on("authenticate")
def authenticate(data):
    name = (data.get("name") or "").strip()
    password = data.get("password") or ""
    if not name or password != ACCESS_PASSWORD:
        emit("login_failed", {"message": "Nome ou senha incorretos. Confira os dados e tente novamente."})
        return

    with lock:
        room = session_state()
        if len(room["players"]) >= MAX_USERS and request.sid not in room["players"]:
            emit("login_failed", {"message": "Nosso cantinho já está ocupado no momento. Tente novamente em instantes 💕"})
            return
        if request.sid not in room["players"]:
            role = "admin" if not room["players"] else "player"
            room["players"][request.sid] = {"name": name, "role": role, "score": 0}
            room["admin_sid"] = room["admin_sid"] or request.sid

    join_room(SESSION_ROOM)
    note = empty_list_state()
    emit("login_success", {
        "room": SESSION_ROOM,
        "name": name,
        "role": room["players"][request.sid]["role"],
        "players": [
            {"name": player["name"], "score": player["score"], "role": player["role"]}
            for player in room["players"].values()
        ],
        "chat_messages": room["chat_messages"],
        "note": {**note, "can_undo": False},
        "list_items": [],
        "calendar": {"events": [], "cycle": None},
        "game": game_snapshot(room)
    })
    socketio.start_background_task(send_initial_shared_state, request.sid, name)
    broadcast_players(room)

@socketio.on("start_game")
def start_game(data):
    room_code = SESSION_ROOM
    room = rooms.get(room_code)
    game_type = (data.get("game") or "questions").strip()
    if not room or request.sid not in room["players"]:
        return
    if len(room["players"]) != 2:
        emit("error_message", {"message": "É necessário ter dois jogadores."})
        return

    if game_type == "stopotes":
        room["stop_round"] += 1
        room["active_game"] = {
            "type": "stopotes", "phase": "waiting", "letter": None,
            "remaining": ADEDONHA_DURATION, "answers": {}, "results": None,
            "scores": {sid: 0 for sid in room["players"]},
            "round": room["stop_round"]
        }
        emit_game_state(room)
        return

    room["status"] = "answering"
    room["answers"] = {}
    room["guesses"] = {}
    room["current_question"] = ensure_question_batch(room_code)

    used = load_used()
    used.setdefault(room_code, []).append(room["current_question"]["id"])
    save_used(used)
    room["active_game"] = {
        "type": "questions", "phase": "answering",
        "question": room["current_question"]["text"],
        "round": len(used.get(room_code, []))
    }

    socketio.emit("new_question", {
        "question": room["current_question"]["text"],
        "round": len(used.get(room_code, []))
    }, to=room_code)


@socketio.on("leave_game")
def leave_game(data=None):
    room = rooms.get(SESSION_ROOM)
    if not room or request.sid not in room["players"]:
        return

    reset_active_game(room)
    socketio.emit("game_left", {}, to=SESSION_ROOM)


@socketio.on("note_update")
def note_update(data):
    if request.sid not in (rooms.get(SESSION_ROOM, {}).get("players", {})):
        return
    note = load_note_sync()
    text = str(data.get("text") or "")[:20000]
    if text == note["text"]:
        return
    note["history"].append(note["text"])
    note["history"] = note["history"][-50:]
    note["text"] = text
    save_note_sync(note)
    socketio.emit("note_updated", {"text": text, "can_undo": bool(note["history"])}, to=SESSION_ROOM)


@socketio.on("note_request")
def note_request():
    if request.sid not in (rooms.get(SESSION_ROOM, {}).get("players", {})):
        return
    note = load_note_sync()
    emit("note_updated", {"text": note["text"], "can_undo": bool(note["history"])})
    emit("list_updated", {"items": note["items"]})
    player_name = rooms[SESSION_ROOM]["players"][request.sid]["name"]
    emit("calendar_updated", calendar_snapshot(note, load_cycle_sync(player_name)))
@socketio.on("note_undo")
def note_undo():
    if request.sid not in (rooms.get(SESSION_ROOM, {}).get("players", {})):
        return
    note = load_note_sync()
    if not note["history"]:
        return
    note["text"] = note["history"].pop()
    save_note_sync(note)
    socketio.emit("note_updated", {"text": note["text"], "can_undo": bool(note["history"])}, to=SESSION_ROOM)


@socketio.on("list_search")
def list_search(data):
    if request.sid not in rooms.get(SESSION_ROOM, {}).get("players", {}):
        return
    title = str(data.get("title") or "").strip()[:120]
    if len(title) < 2:
        emit("list_search_result", {"ok": False, "error": "Digite pelo menos 2 caracteres."})
        return
    try:
        emit("list_search_result", {"ok": True, "item": fetch_omdb_title(title)})
    except Exception as error:
        emit("list_search_result", {"ok": False, "error": str(error)})


@socketio.on("list_add")
def list_add(data):
    if request.sid not in rooms.get(SESSION_ROOM, {}).get("players", {}):
        return
    item = data.get("item") or {}
    title = str(item.get("title") or "").strip()[:200]
    if not title:
        return
    note = load_note_sync()
    item = {
        "imdbID": str(item.get("imdbID") or uuid.uuid4().hex),
        "title": title,
        "year": str(item.get("year") or ""),
        "plot": str(item.get("plot") or "Sinopse não disponível.")[:2000],
        "poster": str(item.get("poster") or "N/A"),
        "type": str(item.get("type") or ""),
    }
    if any(existing.get("imdbID") == item["imdbID"] for existing in note["items"]):
        emit("list_updated", {"items": note["items"]})
        return
    note["items"] = [*note["items"], item][-100:]
    save_note_sync(note)
    socketio.emit("list_updated", {"items": note["items"]}, to=SESSION_ROOM)


@socketio.on("list_remove")
def list_remove(data):
    if request.sid not in rooms.get(SESSION_ROOM, {}).get("players", {}):
        return
    item_id = str(data.get("imdbID") or "")
    note = load_note_sync()
    note["items"] = [item for item in note["items"] if item.get("imdbID") != item_id]
    save_note_sync(note)
    socketio.emit("list_updated", {"items": note["items"]}, to=SESSION_ROOM)


@socketio.on("calendar_request")
def calendar_request():
    room = rooms.get(SESSION_ROOM, {})
    player = room.get("players", {}).get(request.sid)
    if not player:
        return
    emit("calendar_updated", calendar_snapshot(load_note_sync(), load_cycle_sync(player["name"])))


@socketio.on("calendar_event_save")
def calendar_event_save(data):
    if request.sid not in rooms.get(SESSION_ROOM, {}).get("players", {}):
        return
    date = str(data.get("date") or "")[:10]
    title = str(data.get("title") or "Encontro").strip()[:120]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or not title:
        return
    note = load_note_sync()
    event = {"id": str(data.get("id") or uuid.uuid4().hex), "date": date, "title": title}
    note["events"] = [event if current.get("id") == event["id"] else current for current in note["events"]]
    if not any(current.get("id") == event["id"] for current in note["events"]):
        note["events"].append(event)
    save_note_sync(note)
    socketio.emit("calendar_updated", {"events": note["events"]}, to=SESSION_ROOM)


@socketio.on("calendar_event_remove")
def calendar_event_remove(data):
    if request.sid not in rooms.get(SESSION_ROOM, {}).get("players", {}):
        return
    note = load_note_sync()
    event_id = str(data.get("id") or "")
    note["events"] = [event for event in note["events"] if event.get("id") != event_id]
    save_note_sync(note)
    socketio.emit("calendar_updated", {"events": note["events"]}, to=SESSION_ROOM)


@socketio.on("calendar_cycle_save")
def calendar_cycle_save(data):
    room = rooms.get(SESSION_ROOM, {})
    player = room.get("players", {}).get(request.sid)
    if not player:
        return
    last_period = str(data.get("last_period") or "")[:10]
    try:
        cycle_length = max(21, min(45, int(data.get("cycle_length") or 28)))
    except (TypeError, ValueError):
        cycle_length = 28
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", last_period):
        return
    notes = str(data.get("anotacoes_extras") or "").strip()[:2000]
    cycle = {"last_period": last_period, "cycle_length": cycle_length, "notes": notes}
    save_cycle_sync(player["name"], cycle)
    emit("calendar_updated", calendar_snapshot(load_note_sync(), cycle))
@socketio.on("stop_draw_letter")
def stop_draw_letter():
    room = rooms.get(SESSION_ROOM)
    game = room.get("active_game") if room else None
    if not game or game.get("type") != "stopotes" or game.get("phase") not in ("waiting", "results"):
        return
    room["stop_round"] += 1
    game.update({"phase": "playing", "letter": random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
                 "remaining": ADEDONHA_DURATION, "answers": {}, "results": None,
                 "round": room["stop_round"]})
    room["stop_timer"] = socketio.start_background_task(stop_round_timeout, room["stop_round"])
    emit_game_state(room)


@socketio.on("stop_answer_update")
def stop_answer_update(data):
    room = rooms.get(SESSION_ROOM)
    game = room.get("active_game") if room else None
    if not game or game.get("type") != "stopotes" or game.get("phase") != "playing":
        return
    answers = {category: sanitize_letters(data.get(category, "")) for category in ADEDONHA_CATEGORIES}
    letter = normalize_text(game["letter"])[:1]
    answers = {
        category: value if not value or normalize_text(value).startswith(letter) else ""
        for category, value in answers.items()
    }
    game["answers"][request.sid] = answers
    socketio.emit("stop_answers_updated", {"sid": request.sid, "answers": answers}, to=SESSION_ROOM, include_self=False)


@socketio.on("stop_finish")
def stop_finish():
    room = rooms.get(SESSION_ROOM)
    if room and request.sid in room.get("players", {}):
        finish_stop_round(room)


@socketio.on("submit_answer")
def submit_answer(data):
    room_code = SESSION_ROOM
    answer = (data.get("answer") or "").strip()
    room = rooms.get(room_code)

    if not room or room["status"] != "answering":
        emit("error_message", {"message": "Não há uma rodada ativa."})
        return

    if not answer:
        emit("error_message", {"message": "Digite uma resposta."})
        return

    if request.sid not in room["players"]:
        return

    room["answers"][request.sid] = answer

    emit("answer_received", {"message": "Resposta enviada. Esperando o outro jogador..."})

    if len(room["answers"]) == 2:
        room["status"] = "guessing"
        if room.get("active_game"):
            room["active_game"]["phase"] = "guessing"

        players = list(room["players"].keys())
        target_names = {
            players[0]: room["players"][players[1]]["name"],
            players[1]: room["players"][players[0]]["name"]
        }

        socketio.emit("start_guessing", {
            "target": target_names
        }, to=room_code)

@socketio.on("submit_guess")
def submit_guess(data):
    room_code = SESSION_ROOM
    guess = (data.get("guess") or "").strip()
    room = rooms.get(room_code)

    if not room or room["status"] != "guessing":
        emit("error_message", {"message": "A fase de adivinhação não está ativa."})
        return

    if not guess:
        emit("error_message", {"message": "Digite um palpite."})
        return

    room["guesses"][request.sid] = guess

    if len(room["guesses"]) < 2:
        emit("answer_received", {"message": "Palpite enviado. Esperando o outro jogador..."})
        return

    players = list(room["players"].keys())
    results = []

    for sid in players:
        other = players[1] if sid == players[0] else players[0]
        real = room["answers"][other]
        guessed = room["guesses"][sid]
        
        is_match = check_approximate_match(real, guessed)
        points = 2 if is_match else 0
        room["players"][sid]["score"] += points

        results.append({
            "name": room["players"][sid]["name"],
            "guess": guessed,
            "real_answer_of_partner": real,
            "points": points,
            "total": room["players"][sid]["score"]
        })

    room["status"] = "result"
    if room.get("active_game"):
        room["active_game"]["phase"] = "result"

    socketio.emit("round_result", {
        "question": room["current_question"]["text"],
        "results": results
    }, to=room_code)
    broadcast_players(room)

@socketio.on("next_round")
def next_round(data):
    room_code = SESSION_ROOM
    room = rooms.get(room_code)

    if not room or room["admin_sid"] != request.sid:
        emit("error_message", {"message": "Somente o administrador pode avançar."})
        return

    room["answers"] = {}
    room["guesses"] = {}

    question = ensure_question_batch(room_code)

    used = load_used()
    used.setdefault(room_code, []).append(question["id"])
    save_used(used)

    room["current_question"] = question
    room["status"] = "answering"
    room["active_game"] = {
        "type": "questions", "phase": "answering",
        "question": question["text"], "round": len(used.get(room_code, []))
    }

    socketio.emit("new_question", {
        "question": question["text"],
        "round": len(used.get(room_code, []))
    }, to=room_code)

@socketio.on("send_chat_message")
def send_chat_message(data):
    room_code = SESSION_ROOM
    text = (data.get("text") or "").strip()
    file_info = data.get("file")
    room = rooms.get(room_code)

    if not room or request.sid not in room["players"]:
        emit("chat_send_failed", {"message": "Sua sessão de chat não está ativa."})
        return

    if not text and not file_info:
        emit("chat_send_failed", {"message": "Digite uma mensagem ou selecione um arquivo."})
        return

    if file_info:
        if not isinstance(file_info, dict) or not str(file_info.get("url", "")).startswith("/uploads/"):
            emit("chat_send_failed", {"message": "O arquivo enviado não é válido."})
            return
        file_info = {
            "url": str(file_info.get("url")),
            "filename": str(file_info.get("filename") or "arquivo")[:160],
        }
    msg_id = f"msg-{uuid.uuid4().hex[:8]}"
    sender_name = room["players"][request.sid]["name"]

    msg_obj = {
        "id": msg_id,
        "sender_sid": request.sid,
        "sender_name": sender_name,
        "text": text,
        "file": file_info,
        "edited": False
    }

    room["chat_messages"].append(msg_obj)
    room["chat_messages"] = room["chat_messages"][-100:]
    socketio.emit("chat_message_received", msg_obj, to=room_code)
    app.logger.info("[Chat] message sent id=%s has_file=%s", msg_id, bool(file_info))

@socketio.on("edit_chat_message")
def edit_chat_message(data):
    room_code = SESSION_ROOM
    msg_id = data.get("msg_id")
    new_text = (data.get("text") or "").strip()
    room = rooms.get(room_code)

    if not room or not msg_id or not new_text:
        return

    for msg in room["chat_messages"]:
        if msg["id"] == msg_id and msg["sender_sid"] == request.sid:
            msg["text"] = new_text
            msg["edited"] = True
            socketio.emit("chat_message_edited", {
                "id": msg_id,
                "text": new_text
            }, to=room_code)
            break

@socketio.on("disconnect")
def disconnect():
    with lock:
        connected_sids.discard(request.sid)
        room = rooms.get(SESSION_ROOM)
        if not room or request.sid not in room["players"]:
            return

        was_admin = room["admin_sid"] == request.sid
        del room["players"][request.sid]
        room["status"] = "waiting"
        room["answers"] = {}
        room["guesses"] = {}
        room["current_question"] = None

        if was_admin and room["players"]:
            next_sid = next(iter(room["players"]))
            room["admin_sid"] = next_sid
            room["players"][next_sid]["role"] = "admin"
        elif not room["players"]:
            reset_room_used(SESSION_ROOM)
            rooms.pop(SESSION_ROOM, None)
            return

    broadcast_players(room)

ensure_files()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    socketio.run(app, host="0.0.0.0", port=port, debug=debug, use_reloader=False)
