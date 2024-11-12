const CHARACTER_MAP = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  I: 9,
  J: 10,
  K: 11,
  L: 12,
  M: 13,
  N: 14,
  O: 15,
  P: 16,
  Q: 17,
  R: 18,
  S: 19,
  T: 20,
  U: 21,
  V: 22,
  W: 23,
  X: 24,
  Y: 25,
  Z: 26,
  1: 27,
  2: 28,
  3: 29,
  4: 30,
  5: 31,
  6: 32,
  7: 33,
  8: 34,
  9: 35,
  0: 36,
  "!": 37,
  "@": 38,
  "#": 39,
  $: 40,
  "(": 41,
  ")": 42,
  "-": 44,
  "+": 46,
  "&": 47,
  "=": 48,
  ";": 49,
  ":": 50,
  "'": 52,
  '"': 53,
  "%": 54,
  ",": 55,
  ".": 56,
  "/": 59,
  "?": 60,
  "°": 62,
};

const REVERSE_CHARACTER_MAP = {
  0: " ", // Blank
  1: "A",
  2: "B",
  3: "C",
  4: "D",
  5: "E",
  6: "F",
  7: "G",
  8: "H",
  9: "I",
  10: "J",
  11: "K",
  12: "L",
  13: "M",
  14: "N",
  15: "O",
  16: "P",
  17: "Q",
  18: "R",
  19: "S",
  20: "T",
  21: "U",
  22: "V",
  23: "W",
  24: "X",
  25: "Y",
  26: "Z",
  27: "1",
  28: "2",
  29: "3",
  30: "4",
  31: "5",
  32: "6",
  33: "7",
  34: "8",
  35: "9",
  36: "0",
  37: "!",
  38: "@",
  39: "#",
  40: "$",
  41: "(",
  42: ")",
  44: "-",
  46: "+",
  47: "&",
  48: "=",
  49: ";",
  50: ":",
  52: "'",
  53: '"',
  54: "%",
  55: ",",
  56: ".",
  59: "/",
  60: "?",
  62: "°",
  63: "🟥",
  64: "🟧",
  65: "🟨",
  66: "🟩",
  67: "🟦",
  68: "🟪",
  69: "⬜",
  70: "⬛",
};

// State Management
let currentMode = "text";
let selectedColor = null;
let refreshInterval;
let isFrozen = false;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  createDisplayGrid("live-display");
  createDisplayGrid("queue-display");
  createInputGrid();
  setupEventListeners();
  setMode("text");

  // Start refresh cycles
  refreshCurrentState();
  refreshQueueState();

  // Set up auto-refresh with proper cleanup
  const stateInterval = setInterval(refreshCurrentState, 15000);
  const queueInterval = setInterval(refreshQueueState, 5000);

  // Cleanup on page unload
  window.addEventListener("unload", () => {
    clearInterval(stateInterval);
    clearInterval(queueInterval);
  });
});

function createDisplayGrid(elementId) {
  const display = document.getElementById(elementId);
  if (!display) {
    console.error(`Element with id "${elementId}" not found`);
    return;
  }

  display.innerHTML = ""; // Clear any existing content

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 22; col++) {
      const cell = document.createElement("div");
      cell.className = "display-cell";
      cell.dataset.row = row;
      cell.dataset.col = col;
      display.appendChild(cell);
    }
  }
}

function createInputGrid() {
  const grid = document.getElementById("vestaboard");
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 22; col++) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "cell";
      input.maxLength = 1;
      input.dataset.row = row;
      input.dataset.col = col;
      input.dataset.value = "0";
      input.setAttribute("autocomplete", "off");
      input.setAttribute("inputmode", "text");
      grid.appendChild(input);
    }
  }
}

function setupEventListeners() {
  // Color picker buttons
  document.querySelectorAll(".color-btn").forEach((btn) => {
    btn.onclick = () => {
      selectedColor = btn.dataset.color;
      document
        .querySelectorAll(".color-btn")
        .forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    };
  });

  const vestaboard = document.getElementById("vestaboard");

  // Handle cell focus
  vestaboard.addEventListener("focusin", (e) => {
    if (e.target.classList.contains("cell")) {
      e.target.select();
    }
  });

  // Touch handling
  vestaboard.addEventListener("touchend", (e) => {
    if (e.target.classList.contains("cell")) {
      e.preventDefault();
      if (currentMode === "color" && selectedColor) {
        handleColorSelection(e.target);
      } else {
        e.target.focus();
      }
    }
  });

  // Mouse click handling
  vestaboard.addEventListener("click", (e) => {
    if (
      e.target.classList.contains("cell") &&
      currentMode === "color" &&
      selectedColor
    ) {
      handleColorSelection(e.target);
    }
  });

  // Text input handling
  vestaboard.addEventListener("input", (e) => {
    if (e.target.classList.contains("cell") && currentMode === "text") {
      handleTextInput(e.target);
    }
  });

  // Keyboard navigation
  vestaboard.addEventListener("keydown", (e) => {
    if (e.target.classList.contains("cell")) {
      handleKeyboardNavigation(e);
    }
  });
}

// Display Updates
async function refreshCurrentState() {
  try {
    const response = await fetch("/api/board/current");
    if (!response.ok) throw new Error("Failed to fetch board state");

    const data = await response.json();
    if (!data.state) throw new Error("Invalid board state received");

    updateDisplay("live-display", data.grid || createEmptyGrid());

    // Update status and control buttons
    const status = document.getElementById("board-status");
    const lockBtn = document.getElementById("lockBtn");
    const pauseBtn = document.getElementById("pauseBtn");

    if (!status || !lockBtn || !pauseBtn) {
      throw new Error("Required UI elements not found");
    }

    status.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

    // Update lock button state
    if (data.state.locked) {
      lockBtn.innerHTML = '<span class="icon">🔓</span> Unlock Board';
      lockBtn.classList.add("active");
      status.textContent += ` (LOCKED${
        data.state.lockReason ? `: ${data.state.lockReason}` : ""
      })`;
    } else {
      lockBtn.innerHTML = '<span class="icon">🔒</span> Lock Board';
      lockBtn.classList.remove("active");
    }

    // Update pause button state
    if (data.state.queuePaused) {
      pauseBtn.innerHTML = '<span class="icon">▶️</span> Resume Queue';
      pauseBtn.classList.add("active");
      status.textContent += " (QUEUE PAUSED)";
    } else {
      pauseBtn.innerHTML = '<span class="icon">⏸️</span> Pause Queue';
      pauseBtn.classList.remove("active");
    }
  } catch (error) {
    console.error("Board refresh error:", error);
    showNotification(
      "Failed to refresh board state: " + error.message,
      "error",
    );
  }
}

async function refreshQueueState() {
  try {
    const response = await fetch("/api/messages?limit=10");
    if (!response.ok) throw new Error("Failed to fetch queue");

    const messages = await response.json();
    const queuedMessages = messages.filter((msg) => !msg.sent);

    updateQueueDisplay(queuedMessages);
  } catch (error) {
    console.error("Queue refresh error:", error);
    showNotification("Failed to refresh queue", "error");
  }
}

function updateDisplay(elementId, grid) {
  const display = document.getElementById(elementId);
  display.querySelectorAll(".display-cell").forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const value = grid[row]?.[col] ?? 0;

    cell.textContent = "";
    cell.style.backgroundColor = "";

    if (value >= 63 && value <= 70) {
      cell.style.backgroundColor = getColorForCode(value);
    } else {
      const char = REVERSE_CHARACTER_MAP[value] || " ";
      cell.textContent = char;
      cell.style.backgroundColor = "#222";
    }
  });
}

function updateQueueDisplay(messages) {
  const queueDisplay = document.getElementById("queue-display");
  queueDisplay.innerHTML = "";

  if (messages.length === 0) {
    queueDisplay.innerHTML =
      '<div class="empty-queue">No messages in queue</div>';
    return;
  }

  messages.forEach((msg, index) => {
    const messageEl = document.createElement("div");
    messageEl.className = "queued-message";
    messageEl.innerHTML = `
            <div class="queue-info">
                <span class="queue-position">#${index + 1}</span>
                <span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</span>
                <span class="source">${msg.source}</span>
                <div class="message-controls">
                    <button onclick="prioritizeMessage('${msg.id}')" class="control-btn priority" title="Move to front of queue">
                        <span class="icon">⏫</span>
                    </button>
                </div>
            </div>
            <div class="message-preview">
                ${renderMessageGrid(msg.grid)}
            </div>
        `;
    queueDisplay.appendChild(messageEl);
  });
}

function renderMessageGrid(grid) {
  return grid
    .map(
      (row) => `
        <div class="preview-row">
            ${row
              .map(
                (cell) => `
                <div class="preview-cell" style="${getCellStyle(cell)}">
                    ${getCellContent(cell)}
                </div>
            `,
              )
              .join("")}
        </div>
    `,
    )
    .join("");
}

function getCellStyle(value) {
  if (value >= 63 && value <= 70) {
    return `background-color: ${getColorForCode(value)};`;
  }
  return "background-color: #222;";
}

function getCellContent(value) {
  return value >= 63 && value <= 70 ? "" : REVERSE_CHARACTER_MAP[value] || " ";
}

function getColorForCode(code) {
  const colorMap = {
    63: "red",
    64: "orange",
    65: "yellow",
    66: "green",
    67: "blue",
    68: "purple",
    69: "white",
    70: "black",
  };
  return colorMap[code] || "#222";
}

// Input Handling
function handleColorSelection(cell) {
  cell.style.backgroundColor = getColorForCode(selectedColor);
  cell.dataset.value = selectedColor;
  cell.value = "";
}

function handleTextInput(cell) {
  const char = cell.value.toUpperCase();
  cell.value = char;
  cell.dataset.value = CHARACTER_MAP[char] || "0";

  if (char in CHARACTER_MAP) {
    moveToNextCell(cell);
  }
}

function handleKeyboardNavigation(e) {
  const cell = e.target;
  const row = parseInt(cell.dataset.row);
  const col = parseInt(cell.dataset.col);

  let nextCell;
  switch (e.key) {
    case "ArrowRight":
      nextCell = document.querySelector(
        `.cell[data-row="${row}"][data-col="${col + 1}"]`,
      );
      break;
    case "ArrowLeft":
      nextCell = document.querySelector(
        `.cell[data-row="${row}"][data-col="${col - 1}"]`,
      );
      break;
    case "ArrowUp":
      nextCell = document.querySelector(
        `.cell[data-row="${row - 1}"][data-col="${col}"]`,
      );
      break;
    case "ArrowDown":
      nextCell = document.querySelector(
        `.cell[data-row="${row + 1}"][data-col="${col}"]`,
      );
      break;
  }

  if (nextCell) {
    e.preventDefault();
    nextCell.focus();
  }
}

function moveToNextCell(currentCell) {
  const row = parseInt(currentCell.dataset.row);
  const col = parseInt(currentCell.dataset.col);
  const nextCell = document.querySelector(
    `.cell[data-row="${row}"][data-col="${col + 1}"]`,
  );
  if (nextCell) {
    nextCell.focus();
  }
}

function setMode(mode) {
  currentMode = mode;
  document.querySelector(".grid").className = "grid " + mode + "-mode";
  document
    .querySelector(".color-picker")
    .classList.toggle("active", mode === "color");
  document.querySelectorAll(".mode-switch button").forEach((btn) => {
    btn.classList.toggle("active", btn.onclick.toString().includes(mode));
  });
}

// Queue Management
async function queueMessage() {
  const button = document.querySelector(".send-button");
  button.disabled = true;
  button.textContent = "Queueing...";

  try {
    const grid = getGridValues();

    const response = await fetch("/api/board/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grid }),
    });

    if (!response.ok) throw new Error("Failed to queue message");

    const data = await response.json();
    showNotification("Message added to queue", "success");
    refreshQueueState();
    clearGrid();
  } catch (error) {
    console.error("Queue error:", error);
    showNotification("Failed to queue message: " + error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Add to Queue";
  }
}

async function freezeBoard() {
  try {
    const response = await fetch("/api/board/freeze", {
      method: "POST",
    });

    if (!response.ok) throw new Error("Failed to freeze the board");

    showNotification("Board frozen", "success");
  } catch (error) {
    console.error("Freeze board error:", error);
    showNotification("Failed to freeze the board: " + error.message, "error");
  }
}

async function unfreezeBoard() {
  try {
    const response = await fetch("/api/board/unfreeze", {
      method: "POST",
    });

    if (!response.ok) throw new Error("Failed to unfreeze the board");

    showNotification("Board unfrozen", "success");
  } catch (error) {
    console.error("Unfreeze board error:", error);
    showNotification("Failed to unfreeze the board: " + error.message, "error");
  }
}

// Utility Functions
function createEmptyGrid() {
  return Array(6)
    .fill()
    .map(() => Array(22).fill(0));
}

function getGridValues() {
  const grid = createEmptyGrid();
  document.querySelectorAll(".cell").forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    grid[row][col] = parseInt(cell.dataset.value) || 0;
  });
  return grid;
}

function getLockOptions() {
  const lockEnabled = document.getElementById("lockMessage").checked;
  if (!lockEnabled) return undefined;

  return {
    duration: parseInt(document.getElementById("lockDuration").value),
    reason: document.getElementById("lockReason").value,
  };
}

function clearGrid() {
  document.querySelectorAll(".cell").forEach((cell) => {
    cell.value = "";
    cell.dataset.value = "0";
    cell.style.backgroundColor = "";
  });
}

function showNotification(message, type) {
  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add("fade-out");
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

async function toggleBoardLock() {
  try {
    const response = await fetch("/api/board/current");
    if (!response.ok) throw new Error("Failed to fetch board state");

    const data = await response.json();
    const isLocked = data.state.locked;

    if (isLocked) {
      // Unlock
      const response = await fetch("/api/board/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) throw new Error("Failed to unlock board");
    } else {
      // Lock
      const reason = prompt("Enter reason for locking (optional):");
      const response = await fetch("/api/board/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });

      if (!response.ok) throw new Error("Failed to lock board");
    }

    await refreshCurrentState();
    showNotification(
      `Board ${isLocked ? "unlocked" : "locked"} successfully`,
      "success",
    );
  } catch (error) {
    console.error("Lock toggle error:", error);
    showNotification(
      `Failed to ${isLocked ? "unlock" : "lock"} board: ${error.message}`,
      "error",
    );
  }
}

async function toggleQueueProcessing() {
  try {
    const response = await fetch("/api/board/current");
    if (!response.ok) throw new Error("Failed to fetch board state");

    const data = await response.json();
    const isPaused = data.state.queuePaused;

    const toggleResponse = await fetch(
      `/api/board/queue/${isPaused ? "resume" : "pause"}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );

    if (!toggleResponse.ok)
      throw new Error(`Failed to ${isPaused ? "resume" : "pause"} queue`);

    await refreshCurrentState();
    showNotification(
      `Queue ${isPaused ? "resumed" : "paused"} successfully`,
      "success",
    );
  } catch (error) {
    console.error("Queue toggle error:", error);
    showNotification(`Failed to toggle queue state: ${error.message}`, "error");
  }
}

async function prioritizeMessage(messageId) {
  if (!messageId) {
    showNotification("Invalid message ID", "error");
    return;
  }

  try {
    const response = await fetch(`/api/messages/${messageId}/prioritize`, {
      method: "POST",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to prioritize message");
    }

    refreshQueueState();
    showNotification("Message moved to front of queue", "success");
  } catch (error) {
    showNotification(`Failed to prioritize message: ${error.message}`, "error");
  }
}

async function pushTelescope() {
  try {
    const response = await fetch("/api/hello", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error("Failed to queue telescope message");
    }

    const data = await response.json();
    showNotification("Telescope message queued", "success");
    await refreshQueueState();
  } catch (error) {
    console.error("Telescope error:", error);
    showNotification("Failed to queue telescope: " + error.message, "error");
  }
}

// Cleanup
window.addEventListener("unload", () => {
  clearInterval(refreshInterval);
});
