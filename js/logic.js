export function blankState() {
  return { updatedAt: null, habits: [], checks: {} };
}

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(key, n) {
  const date = parseKey(key);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export function diffDays(from, to) {
  return Math.round((parseKey(to) - parseKey(from)) / 86400000);
}

export function weekday(key) {
  return parseKey(key).getUTCDay();
}

export function startOfWeek(key) {
  const day = weekday(key);
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(key, delta);
}

export function monthGrid(year, month) {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const start = startOfWeek(first);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const key = addDays(start, i);
    const [y, m] = key.split("-").map(Number);
    cells.push({ key, inMonth: y === year && m === month });
  }
  while (cells.length > 28 && cells.slice(-7).every((cell) => !cell.inMonth)) {
    cells.splice(-7, 7);
  }
  return cells;
}

function validKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeHabit(habit) {
  if (!habit || typeof habit !== "object") return null;
  if (typeof habit.id !== "string" || !habit.id) return null;
  if (typeof habit.name !== "string" || !habit.name.trim()) return null;
  if (!validKey(habit.createdOn)) return null;
  const mode = ["daily", "weekly", "interval"].includes(habit.mode) ? habit.mode : "daily";
  const days = Array.isArray(habit.days)
    ? [...new Set(habit.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
  const interval = Math.min(30, Math.max(1, Math.round(Number(habit.interval) || 1)));
  const time = typeof habit.time === "string" && /^\d{2}:\d{2}/.test(habit.time) ? habit.time.slice(0, 5) : "";
  return {
    id: habit.id,
    name: habit.name.trim(),
    mode,
    days,
    interval,
    time,
    createdOn: habit.createdOn,
    archivedOn: validKey(habit.archivedOn) ? habit.archivedOn : null,
    deleted: !!habit.deleted,
  };
}

export function normalize(raw) {
  const state = blankState();
  if (!raw || typeof raw !== "object") return state;
  state.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;
  state.habits = Array.isArray(raw.habits) ? raw.habits.map(normalizeHabit).filter(Boolean) : [];
  if (!raw.checks || typeof raw.checks !== "object") return state;
  for (const [day, items] of Object.entries(raw.checks)) {
    if (!validKey(day) || !items || typeof items !== "object") continue;
    const bucket = {};
    for (const [id, item] of Object.entries(items)) {
      if (!item || typeof item !== "object") continue;
      bucket[id] = {
        done: !!item.done,
        at: typeof item.at === "string" ? item.at : null,
        name: typeof item.name === "string" ? item.name : "",
      };
    }
    state.checks[day] = bucket;
  }
  return state;
}

export function isScheduled(habit, key) {
  if (diffDays(habit.createdOn, key) < 0) return false;
  if (habit.archivedOn && diffDays(habit.archivedOn, key) >= 0) return false;
  if (habit.mode === "weekly") return habit.days.includes(weekday(key));
  if (habit.mode === "interval") return diffDays(habit.createdOn, key) % habit.interval === 0;
  return true;
}

function appearsOn(state, habit, key, today) {
  if (isScheduled(habit, key)) return true;
  return diffDays(today, key) <= 0 && !!state.checks[key]?.[habit.id];
}

function compareItems(a, b) {
  const time = (a.time || "99:99").localeCompare(b.time || "99:99");
  if (time) return time;
  return a.name.localeCompare(b.name, "es");
}

export function dayItems(state, key, today) {
  const recorded = state.checks[key] || {};
  const ids = new Set();
  for (const habit of state.habits) {
    if (appearsOn(state, habit, key, today)) ids.add(habit.id);
  }
  if (diffDays(today, key) <= 0) {
    for (const id of Object.keys(recorded)) ids.add(id);
  }
  return [...ids]
    .map((id) => {
      const habit = state.habits.find((item) => item.id === id);
      const check = recorded[id];
      return {
        id,
        name: habit?.name || check?.name || "Tarea",
        time: habit?.time || "",
        done: !!check?.done,
        at: check?.at || null,
      };
    })
    .sort(compareItems);
}

export function statusOf(state, key, today) {
  const items = dayItems(state, key, today);
  if (!items.length) return "empty";
  const done = items.filter((item) => item.done).length;
  if (done === items.length) return "complete";
  if (diffDays(today, key) > 0) return "future";
  if (key === today) return done > 0 ? "partial" : "open";
  return done > 0 ? "partial" : "missed";
}

export function streakCount(state, today) {
  const dates = state.habits.map((habit) => habit.createdOn).sort();
  if (!dates.length) return 0;
  const earliest = dates[0];
  let count = 0;
  let key = today;
  for (let guard = 0; guard < 5000; guard += 1) {
    if (diffDays(earliest, key) < 0) break;
    const status = statusOf(state, key, today);
    if (status === "complete") count += 1;
    else if (key === today && (status === "open" || status === "partial" || status === "empty")) {
      // El día en curso todavía puede completarse.
    } else if (status === "empty") {
      // Un día sin tareas no corta la racha.
    } else break;
    key = addDays(key, -1);
  }
  return count;
}

export function weekStats(state, today) {
  const start = startOfWeek(today);
  let total = 0;
  let done = 0;
  for (let key = start; diffDays(key, today) >= 0; key = addDays(key, 1)) {
    for (const item of dayItems(state, key, today)) {
      total += 1;
      if (item.done) done += 1;
    }
  }
  return { total, done, ratio: total ? done / total : null };
}

export function habitStats(state, today) {
  const start = addDays(today, -27);
  return state.habits
    .map((habit) => {
      let total = 0;
      let done = 0;
      for (let key = start; diffDays(key, today) >= 0; key = addDays(key, 1)) {
        if (!appearsOn(state, habit, key, today)) continue;
        total += 1;
        if (state.checks[key]?.[habit.id]?.done) done += 1;
      }
      return {
        id: habit.id,
        name: habit.name,
        time: habit.time,
        deleted: habit.deleted,
        total,
        done,
        ratio: total ? done / total : null,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => {
      if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
      return compareItems(a, b);
    });
}
