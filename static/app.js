let socketUnavailable = typeof window.io !== "function";
let socket;
try {
  socket = socketUnavailable ? null : window.io({
    transports: ["polling", "websocket"],
    upgrade: true,
    reconnection: true
  });
} catch (error) {
  socketUnavailable = true;
  socket = { connected: false, emit() {}, on() {} };
  console.error("[Socket] initialization failed", error);
}
if (!socket) socket = { connected: false, emit() {}, on() {} };

let room = null;
let isAdmin = false;
let playerName = "";
let pendingFile = null;
let chatSendPending = false;
let activeGame = null;
let noteTimer = null;
let listItems = [];
let calendarEvents = [];
let calendarCycle = null;
let calendarDate = new Date();
let selectedCalendarDate = null;
let loginTimeout = null;
let pendingLogin = null;

document.addEventListener("DOMContentLoaded", () => {
  createHeartsBackground();
  const sharedNote = $("sharedNote");
  if (sharedNote) sharedNote.addEventListener("input", queueNoteUpdate);
  const eventForm = $("eventForm");
  if (eventForm) eventForm.addEventListener("submit", saveCalendarEvent);
  const cycleForm = $("cycleForm");
  if (cycleForm) cycleForm.addEventListener("submit", saveCycleSettings);
  const listSearchInput = $("listSearchInput");
  if (listSearchInput) listSearchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); searchListTitle(); }
  });
});

window.handleLoginSubmit = function handleLoginSubmit(event) {
  event.preventDefault();
  event.stopPropagation();
  login();
  return false;
};
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

function resetLoginButton() {
  const submitButton = document.querySelector("#loginForm button[type='submit']");
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.textContent = "Entrar no nosso espaço 💖";
  }
}
function login() {
  const name = $("name").value.trim();
  const password = $("password").value;
  if (!name || !password) {
    showError("Preencha seu nome e sua senha para entrar 💕");
    return;
  }
  if (password !== "euteamoleide") {
    showError("Essa senha não confere. Tente novamente com carinho 💗");
    return;
  }
  if (socketUnavailable) {
    showError("O módulo de conexão não carregou. Atualize a página e tente novamente 💗");
    return;
  }
  if (!socket || !socket.connected) {
    pendingLogin = { name, password };
    showError("Conectando ao nosso espaço... 💗");
    return;
  }
  sendLogin(name, password);
}

function sendLogin(name, password) {
  const submitButton = document.querySelector("#loginForm button[type='submit']");
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Entrando..."; }
  socket.emit("authenticate", { name, password });
  clearTimeout(loginTimeout);
  loginTimeout = setTimeout(() => {
    resetLoginButton();
    showError("A conexão demorou mais que o esperado. Tente entrar novamente 💗");
  }, 10000);
}

socket.on("login_success", data => {
  clearTimeout(loginTimeout);
  room = data.room;
    playerName = data.name;
  isAdmin = data.role === "admin";
  openRoom(data);
});

function openRoom(data) {
  const loginCard = $("loginCard");
  loginCard.classList.add("fade-out");
  loginCard.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    loginCard.hidden = true;
    loginCard.style.display = "none";
  }, 350);
  $("mainDashboard").hidden = false;
  $("mainDashboard").style.display = "block";
  renderPlayers(data.players || []);
  (data.chat_messages || []).forEach(renderChatMessage);
  renderNote(data.note || { text: "", can_undo: false });
  renderListItems(data.list_items || []);
  renderCalendar(data.calendar || { events: [], cycle: null });
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
  clearTimeout(loginTimeout);
  showError(data.message);
  resetLoginButton();
});

socket.on("connect_error", () => showError("Não foi possível conectar agora. Confira sua internet e tente novamente 💗"));
socket.on("connect", () => {
  console.info("[Socket] connected", socket.id);
  const errorElement = $("error");
  if (errorElement && errorElement.textContent.includes("Conectando")) errorElement.hidden = true;
  if (pendingLogin) {
    const credentials = pendingLogin;
    pendingLogin = null;
    sendLogin(credentials.name, credentials.password);
  }
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
    $("calendarTabSection").hidden = true;
    $("tabGamesBtn").classList.add("active");
    $("tabChatBtn").classList.remove("active");
    $("tabCalendarBtn").classList.remove("active");
    $("tabListBtn").classList.remove("active");
    $("tabCalendarBtn").classList.remove("active");
  } else if (tab === 'chat') {
    $("gamesTabSection").hidden = true;
    $("chatTabSection").hidden = false;
    $("listTabSection").hidden = true;
    $("calendarTabSection").hidden = true;
    $("tabChatBtn").classList.add("active");
    $("tabGamesBtn").classList.remove("active");
    $("tabListBtn").classList.remove("active");
    $("chatBadge").hidden = true;
    scrollToBottomChat();
  } else if (tab === 'list') {
    $("gamesTabSection").hidden = true;
    $("chatTabSection").hidden = true;
    $("listTabSection").hidden = false;
    $("tabListBtn").classList.add("active");
    $("tabGamesBtn").classList.remove("active");
    $("tabChatBtn").classList.remove("active");
    $("tabCalendarBtn").classList.remove("active");
    socket.emit("note_request");
  } else {
    $("gamesTabSection").hidden = true;
    $("chatTabSection").hidden = true;
    $("listTabSection").hidden = true;
    $("calendarTabSection").hidden = false;
    $("tabCalendarBtn").classList.add("active");
    $("tabGamesBtn").classList.remove("active");
    $("tabChatBtn").classList.remove("active");
    $("tabListBtn").classList.remove("active");
    socket.emit("calendar_request");
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
socket.on('note_updated', () => console.info('[Supabase] shared note synchronized'));

function searchListTitle() {
  const input = $("listSearchInput");
  const status = $("listSearchStatus");
  const title = input.value.trim();
  if (title.length < 2) {
    status.textContent = "Digite pelo menos 2 caracteres.";
    return;
  }
  status.textContent = "Procurando na OMDb...";
  $("listSearchBtn").disabled = true;
  socket.emit("list_search", { title });
}

socket.on("list_search_result", data => {
  $("listSearchBtn").disabled = false;
  const status = $("listSearchStatus");
  if (!data.ok) {
    status.textContent = data.error || "Não encontramos esse título.";
    return;
  }
  console.info("[OMDb] title found", data.item.imdbID, data.item.title);
  status.textContent = "Título encontrado. Adicione à lista:";
  const item = data.item;
  const preview = document.createElement("article");
  preview.className = "list-result-card";
  preview.innerHTML = listItemMarkup(item) + '<button type="button" class="secondary list-add-btn">Adicionar</button>';
  preview.querySelector(".list-add-btn").addEventListener("click", () => {
    socket.emit("list_add", { item });
    status.textContent = "Salvando na lista compartilhada...";
  });
  $("listItems").prepend(preview);
});

function listItemMarkup(item) {
  const poster = item.poster && item.poster !== "N/A" ? `<img src="${escapeHtml(item.poster)}" alt="Capa de ${escapeHtml(item.title)}" loading="lazy">` : '<div class="poster-placeholder">🎬</div>';
  return `<div class="list-poster">${poster}</div><div class="list-item-content"><button type="button" class="list-title-toggle" aria-expanded="false">${escapeHtml(item.title)}</button><span>${escapeHtml(item.year || "Ano desconhecido")}</span><div class="list-item-details" hidden><p>${escapeHtml(item.plot || "Sinopse não disponível.")}</p></div></div>`;
}

function bindListTitleToggles(container) {
  container.querySelectorAll(".list-title-toggle").forEach(button => button.addEventListener("click", () => {
    const details = button.parentElement.querySelector(".list-item-details");
    const expanded = !details.hidden;
    details.hidden = expanded;
    button.setAttribute("aria-expanded", String(!expanded));
  }));
}

function renderListItems(items) {
  listItems = items || [];
  $("listItems").innerHTML = listItems.length ? listItems.map(item => `<article class="list-result-card saved-list-card" data-id="${escapeHtml(item.imdbID)}">${listItemMarkup(item)}<button type="button" class="remove-list-btn" aria-label="Remover ${escapeHtml(item.title)}">×</button></article>`).join("") : '<p class="empty-list">Sua lista ainda está esperando o primeiro título ✨</p>';
  bindListTitleToggles($("listItems"));
  $("listItems").querySelectorAll(".remove-list-btn").forEach(button => button.addEventListener("click", () => socket.emit("list_remove", { imdbID: button.closest("article").dataset.id })));
}

socket.on("list_updated", data => {
  renderListItems(data.items || []);
  console.info("[Supabase] shared movie list synchronized", data.items?.length || 0);
  $("listSearchStatus").textContent = "Lista sincronizada para vocês dois 💕";
});

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromIso(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function calendarCycleDates() {
  if (!calendarCycle) return null;
  const last = dateFromIso(calendarCycle.last_period);
  const next = addDays(last, calendarCycle.cycle_length);
  return { last, next, periodEnd: addDays(next, 4), fertileStart: addDays(next, -19), fertileEnd: addDays(next, -13) };
}

function renderCalendar(data) {
  if (data.events) calendarEvents = data.events;
  if (Object.prototype.hasOwnProperty.call(data, "cycle")) calendarCycle = data.cycle;
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  $("calendarMonthLabel").textContent = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(calendarDate);
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cycle = calendarCycleDates();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push('<span class="calendar-empty"></span>');
  for (let day = 1; day <= days; day++) {
    const current = new Date(year, month, day);
    const date = isoDate(current);
    const dayEvents = calendarEvents.filter(event => event.date === date);
    const classes = ["calendar-day"];
    if (date === isoDate(new Date())) classes.push("today");
    if (selectedCalendarDate === date) classes.push("selected");
    if (cycle && current >= cycle.next && current <= cycle.periodEnd) classes.push("period-day");
    if (cycle && current >= cycle.fertileStart && current <= cycle.fertileEnd) classes.push("fertile-day");
    cells.push(`<button type="button" class="${classes.join(" ")}" onclick="selectCalendarDate('${date}')"><span>${day}</span>${dayEvents.length ? '<i class="event-dot"></i>' : ''}</button>`);
  }
  $("calendarGrid").innerHTML = cells.join("");
  renderSelectedCalendarDate();
  renderCycleSummary(cycle);
}

function changeCalendarMonth(amount) { calendarDate.setMonth(calendarDate.getMonth() + amount); renderCalendar({}); }

function selectCalendarDate(date) { selectedCalendarDate = date; renderCalendar({}); }

function renderSelectedCalendarDate() {
  const label = $("selectedDateLabel");
  const form = $("eventForm");
  if (!selectedCalendarDate) { label.textContent = "Escolha um dia para marcar um encontro."; form.hidden = true; }
  else { label.textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(dateFromIso(selectedCalendarDate)); form.hidden = false; }
  const events = calendarEvents.filter(event => event.date === selectedCalendarDate);
  $("calendarEvents").innerHTML = events.map(event => `<div class="calendar-event"><span>💕 ${escapeHtml(event.title)}</span><button type="button" aria-label="Remover encontro" onclick="removeCalendarEvent('${event.id}')">×</button></div>`).join("");
}

function saveCalendarEvent(event) {
  event.preventDefault();
  socket.emit("calendar_event_save", { date: selectedCalendarDate, title: $("eventTitle").value.trim() });
  $("eventTitle").value = "";
}

function removeCalendarEvent(id) { socket.emit("calendar_event_remove", { id }); }

function saveCycleSettings(event) {
  event.preventDefault();
  socket.emit("calendar_cycle_save", {
    last_period: $("lastPeriod").value,
    cycle_length: $("cycleLength").value,
    anotacoes_extras: $("cycleNotes").value
  });
}

function renderCycleSummary(cycle) {
  const summary = $("cycleSummary");
  const alert = $("cycleAlert");
  if (!cycle) { summary.textContent = "Seu ciclo fica privado e só aparece depois que você configurar."; alert.hidden = true; return; }
  $("lastPeriod").value = cycle.last_period;
  $("cycleLength").value = cycle.cycle_length;
  $("cycleNotes").value = cycle.notes || "";
  const dates = calendarCycleDates();
  summary.innerHTML = `<strong>Estimativas para você</strong><span>Próxima menstruação: ${formatDate(dates.next)}</span><span>Período previsto: ${formatDate(dates.next)} a ${formatDate(dates.periodEnd)}</span><span>Período fértil estimado: ${formatDate(dates.fertileStart)} a ${formatDate(dates.fertileEnd)}</span>`;
  const delayed = new Date() > dates.next;
  alert.hidden = !delayed;
  alert.textContent = delayed ? "Sua previsão passou sem um novo registro. Ciclos podem variar; cuide-se com carinho e procure orientação profissional se isso trouxer preocupação." : "";
}

function formatDate(date) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date); }

socket.on("calendar_updated", renderCalendar);
socket.on("calendar_updated", data => {
  console.info("[Supabase] calendar synchronized", {
    events: data.events?.length || 0,
    hasPrivateCycle: Boolean(data.cycle)
  });
});

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
      console.info("[Chat] upload ready", data.filename);
    } else {
      showError(data.error || "Não foi possível preparar o arquivo.");
      cancelFileUpload();
    }
  } catch (err) {
    showError("Erro ao carregar o arquivo.");
    console.error("[Chat] upload failed", err);
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

  if (chatSendPending || (!text && !pendingFile)) return;

  chatSendPending = true;

  socket.emit("send_chat_message", {
    room,
    text: text,
    file: pendingFile
  });
  console.info("[Chat] message queued", { hasText: Boolean(text), hasFile: Boolean(pendingFile) });
}

socket.on("chat_send_failed", data => {
  chatSendPending = false;
  showError(data.message || "Não foi possível enviar a mensagem.");
  console.warn("[Chat] send failed", data.message);
});

function renderChatMessage(msg) {
  const container = $("chatMessages");
  const placeholder = container.querySelector(".chat-placeholder");
  if (placeholder) placeholder.remove();

  const isMe = msg.sender_sid === socket.id;
  if (isMe && chatSendPending) {
    $("chatInput").value = "";
    cancelFileUpload();
    chatSendPending = false;
  }
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