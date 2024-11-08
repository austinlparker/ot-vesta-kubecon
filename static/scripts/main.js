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

let currentMode = "text";
let selectedColor = null;

// Create the grid when the page loads
document.addEventListener("DOMContentLoaded", () => {
  createGrid();
  setupEventListeners();
  setMode("text"); // Set initial mode
});

function createGrid() {
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
      grid.appendChild(input);
    }
  }
}

function setupEventListeners() {
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

  vestaboard.addEventListener("click", handleCellClick);
  vestaboard.addEventListener("touchend", handleCellClick);
  vestaboard.addEventListener("input", handleCellInput);
}

function handleCellClick(e) {
  if (
    e.target.classList.contains("cell") &&
    currentMode === "color" &&
    selectedColor
  ) {
    e.preventDefault(); // Prevent zooming on mobile
    e.target.style.backgroundColor = getComputedStyle(
      document.querySelector(`[data-color="${selectedColor}"]`),
    ).backgroundColor;
    e.target.dataset.value = selectedColor;
    e.target.value = ""; // Clear any text
  }
}

function handleCellInput(e) {
  if (e.target.classList.contains("cell") && currentMode === "text") {
    const char = e.target.value.toUpperCase();
    e.target.value = char;
    if (char in CHARACTER_MAP) {
      e.target.dataset.value = CHARACTER_MAP[char];
    } else {
      e.target.dataset.value = "0";
    }
  }
}

function setMode(mode) {
  currentMode = mode;
  document.querySelector(".grid").className = "grid " + mode + "-mode";
  document
    .querySelector(".color-picker")
    .classList.toggle("active", mode === "color");

  // Update UI to reflect current mode
  document.querySelectorAll(".mode-switch button").forEach((btn) => {
    btn.classList.toggle("active", btn.onclick.toString().includes(mode));
  });
}

function sendMessage() {
  const grid = Array(6)
    .fill()
    .map(() => Array(22).fill(0));
  document.querySelectorAll(".cell").forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    grid[row][col] = parseInt(cell.dataset.value) || 0;
  });

  const button = document.querySelector('button[onclick="sendMessage()"]');
  button.disabled = true;
  button.textContent = "Sending...";

  fetch("/custom/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grid }),
  })
    .then((response) => {
      if (response.ok) {
        showNotification("Message sent successfully!", "success");
      } else {
        showNotification("Failed to send message", "error");
      }
    })
    .catch((error) => {
      showNotification("Error: " + error.message, "error");
    })
    .finally(() => {
      button.disabled = false;
      button.textContent = "Send to Vestaboard";
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
