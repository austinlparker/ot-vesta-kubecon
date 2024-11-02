let currentMode = "text";
let selectedColor = null;

// Create the grid when the page loads
document.addEventListener("DOMContentLoaded", () => {
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
});

function setMode(mode) {
  currentMode = mode;
  document.querySelector(".grid").className = "grid " + mode + "-mode";
  document
    .querySelector(".color-picker")
    .classList.toggle("active", mode === "color");
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".color-btn").forEach((btn) => {
    btn.onclick = () => {
      selectedColor = btn.dataset.color;
    };
  });

  document.getElementById("vestaboard").addEventListener("click", (e) => {
    if (
      e.target.classList.contains("cell") &&
      currentMode === "color" &&
      selectedColor
    ) {
      e.target.style.backgroundColor = getComputedStyle(
        document.querySelector(`[data-color="${selectedColor}"]`),
      ).backgroundColor;
      e.target.dataset.value = selectedColor;
    }
  });

  document.getElementById("vestaboard").addEventListener("keyup", (e) => {
    if (e.target.classList.contains("cell") && currentMode === "text") {
      const char = e.target.value.toUpperCase();
      e.target.value = char;
      // TODO: Add character mapping
    }
  });
});

function sendMessage() {
  const grid = Array(6)
    .fill()
    .map(() => Array(22).fill(0));
  document.querySelectorAll(".cell").forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    grid[row][col] = parseInt(cell.dataset.value) || 0;
  });

  fetch("/custom/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grid }),
  }).then((response) => {
    if (response.ok) {
      alert("Message sent!");
    } else {
      alert("Failed to send message");
    }
  });
}
