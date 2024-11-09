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

let currentMode = "text";
let selectedColor = null;
let lastMessageId = null;
let refreshInterval;

document.addEventListener("DOMContentLoaded", () => {
  createDisplayGrid();
  createInputGrid();
  createMessageHistory();
  updateMessageHistory();
  setupEventListeners();
  setMode("text");
  refreshCurrentState();
  startAutoRefresh();
  setInterval(updateMessageHistory, 30000);
  const lockCheckbox = document.getElementById("lockMessage");
  lockCheckbox.addEventListener("change", (e) => {
    const duration = document.getElementById("lockDuration");
    const reason = document.getElementById("lockReason");
    duration.disabled = !e.target.checked;
    reason.disabled = !e.target.checked;
  });
});

async function refreshCurrentState() {
  try {
    const response = await fetch("/api/board/current");
    if (!response.ok) throw new Error("Failed to fetch current state");

    const data = await response.json();

    // Check if we have a valid grid
    if (!data.grid || !Array.isArray(data.grid)) {
      throw new Error("Invalid grid data received");
    }

    updateDisplayGrid(data.grid);

    // Update last known message ID if available
    if (data.lastMessage?.id) {
      lastMessageId = data.lastMessage.id;
    }
  } catch (error) {
    console.error("Refresh error:", error);
    showNotification("Failed to refresh display: " + error.message, "error");
  }
}

// Add message history display
function createMessageHistory() {
  const historyContainer = document.createElement("div");
  historyContainer.className = "message-history";

  const heading = document.createElement("h3");
  heading.textContent = "Recent Messages";
  historyContainer.appendChild(heading);

  const list = document.createElement("ul");
  list.id = "message-list";
  historyContainer.appendChild(list);

  document.querySelector(".container").appendChild(historyContainer);
}

function updateMessageHistory() {
  const list = document.getElementById("message-list");
  if (!list) return;

  fetch("/api/messages?limit=5")
    .then((response) => response.json())
    .then((messages) => {
      list.innerHTML = messages
        .map(
          (msg) => `
                <li class="message-item">
                    <span class="timestamp">
                        ${new Date(msg.timestamp).toLocaleString()}
                    </span>
                    <span class="source">${msg.source}</span>
                    ${
                      msg.locked
                        ? `
                        <span class="lock-indicator" title="Locked until ${new Date(
                          msg.locked.until,
                        ).toLocaleString()}">🔒</span>
                    `
                        : ""
                    }
                    <button onclick="replayMessage('${msg.id}')">Replay</button>
                </li>
            `,
        )
        .join("");
    })
    .catch((error) => console.error("Failed to fetch message history:", error));
}

async function replayMessage(id) {
  try {
    const response = await fetch(`/api/messages/${id}/replay`, {
      method: "POST",
    });

    if (response.ok) {
      showNotification("Message replayed successfully", "success");
      const data = await response.json();
      updateDisplayGrid(data.message.grid);
    } else {
      throw new Error("Failed to replay message");
    }
  } catch (error) {
    showNotification(error.message, "error");
  }
}

function createDisplayGrid() {
  const display = document.getElementById("current-display");
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
      // Add autocomplete off to prevent mobile keyboards from suggesting text
      input.setAttribute("autocomplete", "off");
      // Add mobile keyboard optimization
      input.setAttribute("inputmode", "text");
      grid.appendChild(input);
    }
  }
}

function setupEventListeners() {
  const cleanupFunctions = new Set();
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

  // Handle cell focus for better mobile experience
  vestaboard.addEventListener("focusin", (e) => {
    if (e.target.classList.contains("cell")) {
      e.target.select(); // Select any existing content
    }
  });

  // Improved touch handling
  vestaboard.addEventListener("touchend", (e) => {
    if (e.target.classList.contains("cell")) {
      e.preventDefault(); // Prevent zoom on double-tap
      if (currentMode === "color" && selectedColor) {
        handleColorSelection(e.target);
      } else {
        e.target.focus(); // Focus for text input
      }
    }
  });

  // Mouse click handling
  vestaboard.addEventListener("click", (e) => {
    if (e.target.classList.contains("cell")) {
      if (currentMode === "color" && selectedColor) {
        handleColorSelection(e.target);
      }
    }
  });

  // Text input handling
  vestaboard.addEventListener("input", (e) => {
    if (e.target.classList.contains("cell") && currentMode === "text") {
      handleTextInput(e.target);
    }
  });

  // Handle keyboard navigation
  vestaboard.addEventListener("keydown", (e) => {
    if (e.target.classList.contains("cell")) {
      handleKeyboardNavigation(e);
    }
  });
}

function handleColorSelection(cell) {
  cell.style.backgroundColor = getComputedStyle(
    document.querySelector(`[data-color="${selectedColor}"]`),
  ).backgroundColor;
  cell.dataset.value = selectedColor;
  cell.value = "";
}

function handleTextInput(cell) {
  const char = cell.value.toUpperCase();
  cell.value = char;
  if (char in CHARACTER_MAP) {
    cell.dataset.value = CHARACTER_MAP[char];
    // Optional: Move to next cell after input
    moveToNextCell(cell);
  } else {
    cell.dataset.value = "0";
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

function updateDisplayGrid(grid) {
  // Validate grid data
  if (!grid || !Array.isArray(grid) || grid.length === 0) {
    console.error("Invalid grid data:", grid);
    return;
  }

  document.querySelectorAll(".display-cell").forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);

    // Safety check for accessing grid positions
    const value = grid[row]?.[col] ?? 0;

    // Clear previous styles
    cell.textContent = "";
    cell.style.backgroundColor = "";

    if (value >= 63 && value <= 70) {
      cell.style.backgroundColor = getColorForCode(value);
    } else {
      const char = REVERSE_CHARACTER_MAP[value];
      cell.textContent = char || " ";
      cell.style.backgroundColor = "#222"; // Reset background for text
    }
  });
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

function startAutoRefresh() {
  // Refresh every 15 seconds
  refreshInterval = setInterval(refreshCurrentState, 15000);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}

async function sendMessage(retries = 3) {
  const button = document.querySelector(".send-button");
  button.disabled = true;
  button.textContent = "Sending...";

  try {
    // Get lock options if enabled
    const lockEnabled = document.getElementById("lockMessage").checked;
    const lock = lockEnabled
      ? {
          duration: parseInt(document.getElementById("lockDuration").value),
          reason: document.getElementById("lockReason").value,
        }
      : undefined;

    // Build grid data
    const grid = Array(6)
      .fill()
      .map(() => Array(22).fill(0));
    document.querySelectorAll(".cell").forEach((cell) => {
      const row = parseInt(cell.dataset.row);
      const col = parseInt(cell.dataset.col);
      grid[row][col] = parseInt(cell.dataset.value) || 0;
    });

    // Optimistically update the display
    updateDisplayGrid(grid);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        if (attempt > 0) {
          showNotification(
            `Retry attempt ${attempt + 1}/${retries}`,
            "warning",
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * Math.pow(2, attempt)),
          );
        }

        const response = await fetch("/api/board/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grid, lock }),
        });

        if (response.ok) {
          const data = await response.json();
          lastMessageId = data.id;
          showNotification(
            `Message sent successfully${lock ? " and locked" : ""}!`,
            "success",
          );
          updateMessageHistory();
          return; // Exit on success
        } else {
          throw new Error("Failed to send message");
        }
      } catch (error) {
        if (attempt === retries - 1) {
          throw error; // Rethrow on final attempt
        }
      }
    }
  } catch (error) {
    console.error("Send error:", error);
    await refreshCurrentState();
    showNotification("Error: " + error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Send to Vestaboard";
  }
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

// Clean up on page unload
window.addEventListener("unload", () => {
  stopAutoRefresh();
});
