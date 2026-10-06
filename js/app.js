import {
  dateKey,
  dayItems,
  habitStats,
  monthGrid,
  normalize,
  statusOf,
  streakCount,
  weekday,
  weekStats,
} from "./logic.js";

const STORAGE_KEY = "taskcoach-state-v1";
const TOKEN_KEY = "taskcoach-token";
const SCREENS = ["hoy", "plan", "historial", "estadisticas"];
const OWNER = "victorch2023";
const REPO = "Taskcoach";
const BRANCH = "main";
const FILE_PATH = "data/estado.json";
const FILE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DOW = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const CHECK = `<span class="check" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.2 6.4 11.2 12.5 4.8"/></svg></span>`;

const view = document.querySelector("#view");
const backdrop = document.querySelector("#backdrop");
const habitForm = document.querySelector("#habit-form");
const githubForm = document.querySelector("#github-form");
const habitName = document.querySelector("#habit-name");
const habitTime = document.querySelector("#habit-time");
const habitError = document.querySelector("#habit-error");
const habitTitle = document.querySelector("#habit-title");
const pauseButton = document.querySelector("#pause-habit");
const deleteButton = document.querySelector("#delete-habit");
const weeklyFields = document.querySelector("#weekly-fields");
const intervalFields = document.querySelector("#interval-fields");
const intervalValue = document.querySelector("#interval-value");
const githubToken = document.querySelector("#github-token");
const githubStatus = document.querySelector("#github-status");
const disconnectButton = document.querySelector("#github-disconnect");
const syncButton = document.querySelector("#sync");

let state = normalize(null);
let token = "";
let screen = "hoy";
let today = dateKey();
let selectedDay = today;
let visibleMonth = monthOf(today);
let editingId = null;
let habitMode = "daily";
let selectedDays = new Set();
let interval = 2;
let syncing = false;
let syncError = "";
let lastSyncedAt = null;
let pushTimer = 0;
let pushing = false;
let pushAgain = false;

function monthOf(key) {
  const [year, month] = key.split("-").map(Number);
  return { year, month };
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // El navegador puede bloquear el almacenamiento; la sesión sigue en memoria.
  }
}

function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function commit(next) {
  state = { ...next, updatedAt: new Date().toISOString() };
  saveLocal();
  schedulePush();
  render();
}

function frequencyLabel(habit) {
  let label = "Cada día";
  if (habit.mode === "weekly") {
    label = [1, 2, 3, 4, 5, 6, 0]
      .filter((day) => habit.days.includes(day))
      .map((day) => SHORT[day])
      .join(" ");
  } else if (habit.mode === "interval" && habit.interval > 1) {
    label = `Cada ${habit.interval} días`;
  }
  if (habit.time) label += ` · ${habit.time}`;
  if (habit.archivedOn) label = `En pausa · ${label}`;
  return label;
}

function sortHabits(list) {
  return list.slice().sort((a, b) => {
    const paused = (a.archivedOn ? 1 : 0) - (b.archivedOn ? 1 : 0);
    if (paused) return paused;
    const time = (a.time || "99:99").localeCompare(b.time || "99:99");
    if (time) return time;
    return a.name.localeCompare(b.name, "es");
  });
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function dayTitle(key) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekdayName = WEEKDAYS[date.getDay()];
  return `${weekdayName} ${day}`;
}

function renderTasks(items, key, { recordTime = false } = {}) {
  if (!items.length) return `<p class="empty">Nada previsto</p>`;
  const future = key > today;
  const rows = items.map((item) => {
    const done = item.done;
    const when = recordTime && done && item.at ? clock(item.at) : item.time;
    return `<button class="task${done ? " is-done" : ""}" type="button" data-check="${esc(item.id)}" data-date="${esc(key)}" aria-pressed="${done}" ${future ? "disabled" : ""}>
      ${CHECK}
      <span class="when">${esc(when)}</span>
      <span class="what">${esc(item.name)}</span>
    </button>`;
  }).join("");
  return `<div class="timeline${items.length > 1 ? " linked" : ""}">${rows}</div>`;
}

function renderHoy() {
  const items = dayItems(state, today, today);
  const done = items.filter((item) => item.done).length;
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const progress = items.length
    ? `<div class="subline"><p>${MONTHS[date.getMonth()]}</p><p class="frac" aria-label="${done} de ${items.length}">${done}/${items.length}</p></div>`
    : `<div class="subline"><p>${MONTHS[date.getMonth()]}</p></div>`;
  return `<section>
    <h1><span class="weekday">${WEEKDAYS[date.getDay()]}</span><span class="daynum">${day}</span></h1>
    ${progress}
    ${items.length ? renderTasks(items, today) : `<p class="empty">Nada previsto</p><button class="ghost" type="button" data-new>Nueva</button>`}
  </section>`;
}

function renderPlan() {
  const habits = sortHabits(state.habits.filter((habit) => !habit.deleted));
  const rows = habits.map((habit) => `<button class="plan-row${habit.archivedOn ? " is-paused" : ""}" type="button" data-edit="${esc(habit.id)}">
      <span class="name">${esc(habit.name)}</span>
      <span class="meta">${esc(frequencyLabel(habit))}</span>
    </button>`).join("");
  return `<section>
    <div class="screen-head"><button type="button" data-new>Nueva</button></div>
    ${habits.length ? `<div class="plan-list">${rows}</div>` : `<p class="empty">Sin hábitos</p>`}
  </section>`;
}

function renderHistorial() {
  const cells = monthGrid(visibleMonth.year, visibleMonth.month);
  const marks = cells.map((cell) => {
    if (!cell.inMonth) return `<span></span>`;
    const status = statusOf(state, cell.key, today);
    const mark = ["complete", "partial", "missed", "open"].includes(status) ? `<i class="mark ${status}"></i>` : "";
    const classes = [
      "daybtn",
      cell.key === today ? "today" : "",
      cell.key === selectedDay ? "selected" : "",
    ].filter(Boolean).join(" ");
    return `<button class="${classes}" type="button" data-day="${cell.key}">${Number(cell.key.slice(-2))}${mark}</button>`;
  }).join("");
  const items = dayItems(state, selectedDay, today);
  return `<section>
    <div class="monthbar">
      <button type="button" data-shift="-1" aria-label="Mes anterior">‹</button>
      <p>${MONTHS[visibleMonth.month - 1]} ${visibleMonth.year}</p>
      <button type="button" data-shift="1" aria-label="Mes siguiente">›</button>
    </div>
    <div class="cal">
      ${DOW.map((name) => `<span class="dow">${name}</span>`).join("")}
      ${marks}
    </div>
    <h2 class="day-heading">${dayTitle(selectedDay)}</h2>
    ${renderTasks(items, selectedDay, { recordTime: true })}
  </section>`;
}

function percent(ratio) {
  if (ratio == null) return "—";
  return `${Math.round(ratio * 100)}%`;
}

function renderStats() {
  if (!state.habits.length) return `<p class="empty">Sin hábitos</p>`;
  const week = weekStats(state, today);
  const streak = streakCount(state, today);
  const rows = habitStats(state, today);
  const streakLabel = streak === 1 ? "1 día" : `${streak} días`;
  const list = rows.map((row) => `<div class="stat">
      <div class="stat-line"><span>${esc(row.name)}</span><span>${percent(row.ratio)}</span></div>
      <div class="bar"><span style="width:${Math.round((row.ratio || 0) * 100)}%"></span></div>
    </div>`).join("");
  return `<section>
    <div class="block">
      <p class="label">Esta semana</p>
      <p class="hero">${percent(week.ratio)}</p>
    </div>
    <div class="block">
      <p class="label">Racha</p>
      <p class="figure">${streakLabel}</p>
    </div>
    ${rows.length ? `<div class="block"><p class="label">28 días</p>${list}</div>` : ""}
  </section>`;
}

function render() {
  today = dateKey();
  document.querySelectorAll(".nav button").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.screen === screen ? "page" : "false");
  });
  const pages = { hoy: renderHoy, plan: renderPlan, historial: renderHistorial, estadisticas: renderStats };
  view.innerHTML = pages[screen]();
  paintSync();
}

function go(next) {
  if (!SCREENS.includes(next)) return;
  screen = next;
  if (location.hash !== `#${next}`) history.replaceState(null, "", `#${next}`);
  render();
}

function closeSheets() {
  habitForm.hidden = true;
  githubForm.hidden = true;
  backdrop.hidden = true;
  document.body.classList.remove("locked");
}

function openHabit(id) {
  editingId = id;
  const habit = id ? state.habits.find((item) => item.id === id) : null;
  habitError.textContent = "";
  habitTitle.textContent = habit ? "Editar" : "Nueva";
  habitName.value = habit?.name || "";
  habitTime.value = habit?.time || "";
  interval = habit?.mode === "interval" ? habit.interval : 2;
  intervalValue.textContent = String(interval);
  selectedDays = new Set(habit?.mode === "weekly" ? habit.days : []);
  setMode(habit?.mode || "daily");
  paintDays();
  const editing = !!habit;
  pauseButton.hidden = !editing;
  deleteButton.hidden = !editing;
  if (habit) pauseButton.textContent = habit.archivedOn ? "Reanudar" : "Pausar";
  backdrop.hidden = false;
  habitForm.hidden = false;
  document.body.classList.add("locked");
  habitName.focus();
}

function setMode(mode) {
  habitMode = mode;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  });
  weeklyFields.hidden = mode !== "weekly";
  intervalFields.hidden = mode !== "interval";
  if (mode === "weekly" && selectedDays.size === 0) {
    selectedDays.add(weekday(today));
    paintDays();
  }
}

function paintDays() {
  weeklyFields.querySelectorAll("[data-dow]").forEach((button) => {
    button.setAttribute("aria-pressed", String(selectedDays.has(Number(button.dataset.dow))));
  });
}

function saveHabit(event) {
  event.preventDefault();
  const name = habitName.value.trim();
  if (!name) return;
  if (habitMode === "weekly" && selectedDays.size === 0) {
    habitError.textContent = "Elige un día";
    return;
  }
  const fields = {
    name,
    mode: habitMode,
    days: habitMode === "weekly" ? [...selectedDays] : [],
    interval: habitMode === "interval" ? interval : 1,
    time: habitTime.value || "",
  };
  const habits = state.habits.slice();
  if (editingId) {
    const index = habits.findIndex((habit) => habit.id === editingId);
    if (index === -1) return;
    habits[index] = { ...habits[index], ...fields };
  } else {
    habits.push({
      id: crypto.randomUUID(),
      createdOn: today,
      archivedOn: null,
      deleted: false,
      ...fields,
    });
  }
  closeSheets();
  commit({ ...state, habits });
}

function pauseHabit() {
  const habits = state.habits.map((habit) => {
    if (habit.id !== editingId) return habit;
    return { ...habit, archivedOn: habit.archivedOn ? null : today };
  });
  closeSheets();
  commit({ ...state, habits });
}

function deleteHabit() {
  const habits = state.habits.map((habit) => {
    if (habit.id !== editingId) return habit;
    return { ...habit, deleted: true, archivedOn: habit.archivedOn || today };
  });
  closeSheets();
  commit({ ...state, habits });
}

function toggleCheck(key, id) {
  if (key > today) return;
  const habit = state.habits.find((item) => item.id === id);
  const current = state.checks[key]?.[id];
  const done = !current?.done;
  const checks = {
    ...state.checks,
    [key]: {
      ...(state.checks[key] || {}),
      [id]: {
        done,
        at: done ? new Date().toISOString() : null,
        name: habit?.name || current?.name || "",
      },
    },
  };
  commit({ ...state, checks });
}

function shiftMonth(delta) {
  let { year, month } = visibleMonth;
  month += delta;
  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }
  visibleMonth = { year, month };
  const inMonth = selectedDay.startsWith(`${year}-${String(month).padStart(2, "0")}`);
  if (!inMonth) selectedDay = `${year}-${String(month).padStart(2, "0")}-01`;
  render();
}

function onViewClick(event) {
  const check = event.target.closest("[data-check]");
  if (check) {
    toggleCheck(check.dataset.date, check.dataset.check);
    return;
  }
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    openHabit(edit.dataset.edit);
    return;
  }
  if (event.target.closest("[data-new]")) {
    openHabit(null);
    return;
  }
  const day = event.target.closest("[data-day]");
  if (day) {
    selectedDay = day.dataset.day;
    render();
    return;
  }
  const shift = event.target.closest("[data-shift]");
  if (shift) shiftMonth(Number(shift.dataset.shift));
}

function openGithub() {
  githubToken.value = "";
  disconnectButton.hidden = !token;
  habitForm.hidden = true;
  backdrop.hidden = false;
  githubForm.hidden = false;
  document.body.classList.add("locked");
  paintSync();
  githubToken.focus();
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(content) {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function ghHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function errorText(error) {
  const status = error?.status;
  if (status === 401) return "Token inválido";
  if (status === 403) return "Sin permiso de escritura";
  if (status === 404) return "No se encontró el repositorio";
  if (status) return "No se pudo guardar";
  return "Sin conexión";
}

function isNewer(left, right) {
  if (!left) return false;
  if (!right) return true;
  return left > right;
}

async function fetchRemote() {
  const response = await fetch(`${FILE_URL}?ref=${BRANCH}`, { headers: ghHeaders(), cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw response;
  const body = await response.json();
  return normalize(JSON.parse(decodeBase64(body.content || "")));
}

async function currentSha() {
  const response = await fetch(`${FILE_URL}?ref=${BRANCH}`, { headers: ghHeaders(), cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw response;
  const body = await response.json();
  return body.sha;
}

async function put(payload) {
  let sha = await currentSha();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const body = {
      message: "Registrar avance",
      content: encodeBase64(`${JSON.stringify(payload, null, 2)}\n`),
      branch: BRANCH,
    };
    if (sha) body.sha = sha;
    const response = await fetch(FILE_URL, {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 409 && attempt === 0) {
      sha = await currentSha();
      continue;
    }
    if (!response.ok) throw response;
    return;
  }
}

async function pull() {
  const remote = await fetchRemote();
  syncError = "";
  if (!remote) {
    if (state.updatedAt) schedulePush();
    else paintSync();
    return;
  }
  if (isNewer(remote.updatedAt, state.updatedAt)) {
    state = remote;
    saveLocal();
    lastSyncedAt = state.updatedAt;
    render();
    return;
  }
  if (isNewer(state.updatedAt, remote.updatedAt)) {
    schedulePush();
    return;
  }
  lastSyncedAt = state.updatedAt;
  paintSync();
}

async function pullPublic() {
  try {
    const response = await fetch(FILE_PATH, { cache: "no-store" });
    if (!response.ok) return;
    const remote = normalize(await response.json());
    if (isNewer(remote.updatedAt, state.updatedAt)) {
      state = remote;
      saveLocal();
    }
  } catch {
    // Sin archivo público la app sigue con lo guardado en el navegador.
  }
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void runPush(); }, 600);
}

async function runPush() {
  if (!token) return;
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  syncing = true;
  paintSync();
  try {
    do {
      pushAgain = false;
      const payload = structuredClone(state);
      await put(payload);
      if (state.updatedAt !== payload.updatedAt) pushAgain = true;
      else {
        lastSyncedAt = payload.updatedAt;
        syncError = "";
      }
    } while (pushAgain);
  } catch (error) {
    syncError = errorText(error);
  } finally {
    pushing = false;
    syncing = false;
    paintSync();
  }
}

function flush() {
  clearTimeout(pushTimer);
  void runPush();
}

function syncMessage() {
  if (syncError) return syncError;
  if (syncing) return "Guardando";
  if (token && state.updatedAt && lastSyncedAt === state.updatedAt) return "Al día";
  if (token) return "Conectado";
  return "";
}

function paintSync() {
  syncButton.className = "sync";
  if (!token) syncButton.title = "GitHub";
  else if (syncing) {
    syncButton.classList.add("syncing");
    syncButton.title = "Guardando";
  } else if (syncError) {
    syncButton.classList.add("error");
    syncButton.title = syncError;
  } else if (state.updatedAt && lastSyncedAt === state.updatedAt) {
    syncButton.classList.add("synced");
    syncButton.title = "Al día";
  } else syncButton.title = token ? "Pendiente" : "GitHub";
  if (!githubForm.hidden) {
    githubStatus.textContent = syncMessage();
    githubStatus.classList.toggle("error", !!syncError);
  }
}

async function saveToken(event) {
  event.preventDefault();
  const value = githubToken.value.trim();
  if (!value) {
    githubStatus.textContent = "Falta el token";
    githubStatus.classList.add("error");
    return;
  }
  token = value;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Si el navegador no guarda el token, vale para esta visita.
  }
  githubToken.value = "";
  disconnectButton.hidden = false;
  syncError = "";
  try {
    await pull();
    if (!syncError) closeSheets();
  } catch (error) {
    syncError = errorText(error);
    paintSync();
  }
}

function disconnect() {
  token = "";
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nada que borrar si el almacenamiento no está disponible.
  }
  lastSyncedAt = null;
  syncError = "";
  closeSheets();
  paintSync();
}

function bind() {
  document.querySelector(".nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-screen]");
    if (button) go(button.dataset.screen);
  });
  view.addEventListener("click", onViewClick);
  syncButton.addEventListener("click", openGithub);
  backdrop.addEventListener("click", closeSheets);
  habitForm.addEventListener("submit", saveHabit);
  pauseButton.addEventListener("click", pauseHabit);
  deleteButton.addEventListener("click", deleteHabit);
  githubForm.addEventListener("submit", saveToken);
  disconnectButton.addEventListener("click", disconnect);
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  weeklyFields.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dow]");
    if (!button) return;
    const day = Number(button.dataset.dow);
    if (selectedDays.has(day)) selectedDays.delete(day);
    else selectedDays.add(day);
    paintDays();
  });
  intervalFields.addEventListener("click", (event) => {
    const button = event.target.closest("[data-step]");
    if (!button) return;
    interval = Math.min(30, Math.max(1, interval + Number(button.dataset.step)));
    intervalValue.textContent = String(interval);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheets();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("hashchange", () => {
    const next = location.hash.slice(1);
    if (SCREENS.includes(next) && next !== screen) {
      screen = next;
      render();
    }
  });
}

async function init() {
  const initial = location.hash.slice(1);
  if (SCREENS.includes(initial)) screen = initial;
  state = loadLocal() || normalize(null);
  token = loadToken();
  bind();
  render();
  if (token) {
    try {
      await pull();
    } catch (error) {
      syncError = errorText(error);
      paintSync();
    }
  } else {
    await pullPublic();
    render();
  }
}

void init();
