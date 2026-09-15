const socket = io({
  transports: ["polling", "websocket"],
  upgrade: true,
  reconnection: true
});

let room = null;
let isAdmin = false;
let playerName = "";
let pendingFile = null;
let activeGame = null;
let noteTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  createHeartsBackground();
  $("loginForm").addEventListener("submit", event => {
    event.preventDefault();
    login();
  });
  $("sharedNote").addEventListener("input", queueNoteUpdate);
});

function createHeartsBackground() {
  const container = document.getElementById("heartsBg");
  if (!container) return;

  const symbols = ["❤️", "💖", "💕", "💗", "💓", "🥜"];
  const heartCount = 18;

  for (let i = 0; i < heartCount; i++) {
    const heart = document.createElement("div");
    heart.classList.add("heart-fall");
    heart.innerText = symbols[Math.floor(Math.random() * symbols.length)];
    heart.style.left = `${Math.random() * 100}%`;
    heart.style.animationDuration = `${5 + Math.random() * 6}s`;
    heart.style.animationDelay = `${Math.random() * 5}s`;
    heart.style.fontSize = `${14 + Math.random() * 18}px`;
    container.appendChild(heart);
  }
}

const $ = (id) => document.getElementById(id);

function showError(message) {
  const errorElement = $("error");
  if (errorElement) {
    errorElement.hidden = false;
    errorElement.textContent = message;
  }
  if ($("gameMessage")) $("gameMessage").textContent = message;
}

function login() {
  const name = $("name").value.trim();
  const password = $("password").value;
  if (!name || !password) {
    showError("Preencha seu nome e sua senha para entrar 💕");
    return;
  }
  socket.emit("authenticate", { name, password });
}

socket.on("login_success", data => {
  room = data.room;
    playerName = data.name;
  isAdmin = data.role === "admin";
  openRoom(data);
});

function openRoom(data) {
  $("loginCard").classList.add("fade-out");
  setTimeout(() => { $("loginCard").hidden = true; }, 350);
  $("mainDashboard").hidden = false;
  renderPlayers(data.players || []);
  (data.chat_messages || []).forEach(renderChatMessage);
  renderNote(data.note || { text: "", can_undo: false });
  if (data.game) {
    renderGame(data.game);
  } else {
    showGamesMenu();
  }
}

socket.on("access_denied", data => {
  showError(data.message);
});

socket.on("login_failed", data => {
  showError(data.message);
});

function renderPlayers(players) {
    const currentPlayer = players.find(player => player.name === playerName);
    if (currentPlayer) isAdmin = currentPlayer.role === "admin";
  const markup = players.map(player => `
    <li><span>${escapeHtml(player.name)}</span><small>${player.score || 0} pts</small></li>
  `).join("");
  $("players").innerHTML = markup || "<li class=\"empty-state\">Esperando seu par...</li>";
  $("onlineCount").textContent = `${players.length}/2`;
  $("waitingNote").hidden = players.length === 2;
  $("gamesMenu").querySelectorAll(".game-option").forEach(button => { button.disabled = players.length !== 2; });
}

socket.on("session_update", data => {
  renderPlayers(data.players || []);
});

function switchTab(tab) {
  if (tab === 'games') {
    $("gamesTabSection").hidden = false;
    $("chatTabSection").hidden = true;
    $("listTabSection").hidden = true;
    $("tabGamesBtn").classList.add("active");
    $("tabChatBtn").classList.remove("active");
    $("tabListBtn").classList.remove("active");
  } else if (tab === 'chat') {
    $("gamesTabSection").hidden = true;
    $("chatTabSection").hidden = false;
    $("listTabSection").hidden = true;
    $("tabChatBtn").classList.add("active");
    $("tabGamesBtn").classList.remove("active");
    $("tabListBtn").classList.remove("active");
    $("chatBadge").hidden = true;
    scrollToBottomChat();
  } else {
    $("gamesTabSection").hidden = true;
    $("chatTabSection").hidden = true;
    $("listTabSection").hidden = false;
    $("tabListBtn").classList.add("active");
    $("tabGamesBtn").classList.remove("active");
    $("tabChatBtn").classList.remove("active");
  }
}

function showGamesMenu() {
  if ($("gamesMenu")) $("gamesMenu").hidden = false;
  if ($("game")) $("game").hidden = true;
  if ($("stopotesGame")) $("stopotesGame").hidden = true;
}

function startGame(game) {
  socket.emit("start_game", { room, game });
}

function leaveGame() {
  socket.emit("leave_game", { room });
  showGamesMenu();
}

socket.on("game_left", showGamesMenu);

function renderNote(note) {
  if (!$('sharedNote')) return;
  $('sharedNote').value = note.text || '';
  $('undoNoteBtn').disabled = !note.can_undo;
  $('noteStatus').textContent = 'Salvo automaticamente';
}

function queueNoteUpdate() {
  $('noteStatus').textContent = 'Salvando...';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => socket.emit('note_update', { text: $('sharedNote').value }), 180);
}

function undoNote() { socket.emit('note_undo'); }

socket.on('note_updated', renderNote);

function renderGame(game) {
  activeGame = game;
  if (game.type === 'questions') {
    $('gamesMenu').hidden = true;
    $('game').hidden = false;
    $('status').textContent = `Rodada ${game.round || 1}`;
    $('question').textContent = game.question || 'Pergunta em andamento';
    $('answerPhase').hidden = game.phase !== 'answering';
    $('guessPhase').hidden = game.phase !== 'guessing';
    $('resultPhase').hidden = game.phase !== 'result';
    return;
  }
  showGamesMenu();
  const panel = $(`${game.type}Game`);
  if (panel) panel.hidden = false;
  if (game.type === 'stopotes') renderStopotes(game);
}

socket.on('game_state', renderGame);

function renderStopotes(game) {
  const categories = [
    ['nome', 'Nome'], ['cep', 'CEP'], ['animal', 'Animal'], ['fruta', 'Fruta'],
    ['objeto', 'Objeto'], ['cor', 'Cor'], ['profissao', 'Profissão'],
    ['sogra', 'Sogro(a)'], ['marca', 'Marca/Empresa famosa'],
    ['filme', 'Filme ou Série'], ['novela', 'Novela/Personagem de TV'],
    ['cantor', 'Cantor/Banda'], ['comida', 'Comida/Prato'],
    ['corpo', 'Parte do corpo'], ['palavrao', 'Palavrão'],
    ['from', 'Personagem de FROM']
  ];
  $('stopLetter').textContent = game.letter || '?';
  $('stopTimer').textContent = game.phase === 'playing' ? `${game.remaining}s restantes` : game.phase === 'results' ? 'Rodada encerrada' : 'Pronto para sortear';
  $('drawLetterBtn').disabled = game.phase === 'playing';
  $('stopBtn').disabled = game.phase !== 'playing';
  $('stopCategories').innerHTML = categories.map(([key, label]) => `
    <label>${label}<input class="stop-input" data-category="${key}" ${game.phase !== 'playing' ? 'disabled' : ''} value="${escapeHtml((game.answers[socket.id] || {})[key] || '')}"></label>
  `).join('');
  document.querySelectorAll('.stop-input').forEach(input => input.oninput = updateStopAnswer);
  $('stopResults').hidden = game.phase !== 'results';
  if (game.phase === 'results') {
    const scores = game.results.scores || {};
    const answers = game.results.answers || {};
    $('stopResults').innerHTML = Object.entries(scores).map(([category, categoryScores]) => `<div><strong>${category}</strong><span>${Object.entries(categoryScores).map(([sid, score]) => `${escapeHtml(sid === socket.id ? 'Você' : 'Par')}: ${escapeHtml(answers[sid]?.[category] || 'em branco')} (${score} pts)`).join(' · ')}</span></div>`).join('');
  }
}

function drawStopLetter() { socket.emit('stop_draw_letter'); }
function finishStopotes() { socket.emit('stop_finish'); }
function updateStopAnswer(event) {
  const input = event.target;
  input.value = input.value.replace(/[^a-zA-ZÀ-ÿ ]/g, '');
  const payload = {};
  document.querySelectorAll('.stop-input').forEach(field => { payload[field.dataset.category] = field.value; });
  socket.emit('stop_answer_update', payload);
}

socket.on("new_question", data => {
  $("gamesMenu").hidden = true;
  $("stopotesGame").hidden = true;
  if ($("room")) $("room").hidden = true;
  if ($("game")) $("game").hidden = false;

  $("status").textContent = `Rodada ${data.round}`;
  $("question").textContent = data.question;

  $("answerPhase").hidden = false;
  $("guessPhase").hidden = true;
  $("resultPhase").hidden = true;

  $("answer").value = "";
  $("guess").value = "";
  $("gameMessage").textContent = "";
});

function submitAnswer() {
  socket.emit("submit_answer", {
    room,
    answer: $("answer").value
  });
}

socket.on("answer_received", data => {
  $("gameMessage").textContent = data.message;
  $("answerPhase").hidden = true;
});

socket.on("start_guessing", () => {
  $("guessPhase").hidden = false;
  $("resultPhase").hidden = true;
  $("gameMessage").textContent = "Ambos responderam! Agora adivinhe a resposta da sua Paçoquinha! 🧠💖";
});

function submitGuess() {
  socket.emit("submit_guess", {
    room,
    guess: $("guess").value
  });
}

socket.on("round_result", data => {
  $("guessPhase").hidden = true;
  $("resultPhase").hidden = false;
  $("results").innerHTML = "";

  data.results.forEach(r => {
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `
      <strong>${escapeHtml(r.name)}</strong>
      <p>Resposta real: <em>"${escapeHtml(r.real_answer_of_partner)}"</em></p>
      <p>Palpite: <em>"${escapeHtml(r.guess)}"</em></p>
      <p style="color: var(--primary); font-weight:700; margin-top:6px;">
        +${r.points} pontos (Total: ${r.total})
      </p>
    `;
    $("results").appendChild(div);
  });

  $("nextBtn").hidden = !isAdmin;
});

function nextRound() {
  socket.emit("next_round", { room });
}

socket.on("error_message", data => {
  showError(data.message);
});

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });
    const data = await response.json();
    if (data.url) {
      pendingFile = data;
      $("filePreviewName").textContent = `📎 ${data.filename}`;
      $("filePreviewContainer").hidden = false;
    }
  } catch (err) {
    showError("Erro ao carregar o arquivo.");
  }
}

function cancelFileUpload() {
  pendingFile = null;
  if ($("filePreviewContainer")) $("filePreviewContainer").hidden = true;
  if ($("chatFileInput")) $("chatFileInput").value = "";
}

function sendChatMessage() {
  const input = $("chatInput");
  const text = input.value.trim();

  if (!text && !pendingFile) return;

  socket.emit("send_chat_message", {
    room,
    text: text,
    file: pendingFile
  });

  input.value = "";
  cancelFileUpload();
}

function renderChatMessage(msg) {
  const container = $("chatMessages");
  const placeholder = container.querySelector(".chat-placeholder");
  if (placeholder) placeholder.remove();

  const isMe = msg.sender_sid === socket.id;
  const msgDiv = document.createElement("div");
  msgDiv.className = `chat-bubble ${isMe ? 'me' : 'partner'}`;
  msgDiv.id = msg.id;

  let fileContent = "";
  if (msg.file) {
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(msg.file.url);
    if (isImage) {
      fileContent = `<div class="chat-media"><img src="${msg.file.url}" alt="Imagem enviada" /></div>`;
    } else {
      fileContent = `<div class="chat-file-link"><a href="${msg.file.url}" target="_blank" download>💾 ${escapeHtml(msg.file.filename)}</a></div>`;
    }
  }

  let editBtnHtml = isMe ? `<button class="btn-edit-msg" onclick="promptEditMessage('${msg.id}')">✏️</button>` : "";

  msgDiv.innerHTML = `
    <div class="chat-sender">${escapeHtml(msg.sender_name)} ${editBtnHtml}</div>
    ${fileContent}
    <div class="chat-text">${escapeHtml(msg.text)}</div>
    <span class="edited-tag" ${msg.edited ? '' : 'hidden'}> (editado)</span>
  `;

  container.appendChild(msgDiv);
  scrollToBottomChat();

  if ($("chatTabSection").hidden) {
    $("chatBadge").hidden = false;
  }
}

socket.on("chat_message_received", renderChatMessage);

function promptEditMessage(msgId) {
  const msgEl = $(msgId);
  if (!msgEl) return;
  const currentText = msgEl.querySelector(".chat-text").innerText;
  const newText = prompt("Edite sua mensagem:", currentText);

  if (newText !== null && newText.trim() !== "") {
    socket.emit("edit_chat_message", {
      room,
      msg_id: msgId,
      text: newText.trim()
    });
  }
}

socket.on("chat_message_edited", data => {
  const msgEl = $(data.id);
  if (msgEl) {
    msgEl.querySelector(".chat-text").innerText = data.text;
    const tag = msgEl.querySelector(".edited-tag");
    if (tag) tag.hidden = false;
  }
});

function scrollToBottomChat() {
  const container = $("chatMessages");
  if (container) container.scrollTop = container.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}