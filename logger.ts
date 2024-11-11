import { type VestaboardMessage } from "./vesta.ts"

export prettyPrintVestaboard(message: VestaboardMessage): void {
  const TOP_BORDER = "┌─────────────────────────────────────────────┐";
  const BOTTOM_BORDER = "└─────────────────────────────────────────────┘";
  const SIDE_BORDER = "│";
  const SPACE_CHAR = "▢"; // or '·' if you prefer

  console.log("\n" + TOP_BORDER);

  message.forEach((row) => {
    const chars = row.map((code) =>
      code === 0
        ? SPACE_CHAR
        : VestaboardClient.CHARACTER_MAP[code] || SPACE_CHAR
    );
    const displayText = chars.join(" ").padEnd(43, " ");
    console.log(`${SIDE_BORDER} ${displayText} ${SIDE_BORDER}`);
  });

  console.log(BOTTOM_BORDER + "\n");
}
