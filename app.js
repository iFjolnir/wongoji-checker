// app.js — Step 2: core layout (paper simulation) + tiny verification hooks
// Rules locked with Faye:
// - New paragraph = every newline
// - Paragraph indent = 1 empty used box
// - Spaces count as used boxes (but we do not force leading spaces at start of wrapped lines)
// - 1 box = 1 character, with special rules:
//   - Digits: 2 digits per 1 box (TOPIK rule)
//   - Ellipsis "……" and dash "―" are 2 boxes
//   - After ? and !: leave 1 empty used box (if there's room; if at end of line, that blank starts next line)
//   - Punctuation edge-case: if punctuation would be pushed to a new line because the previous line ended exactly,
//     allow punctuation to "share" the last box (character+punct in one box) to avoid consuming a new box.
//     (We implement this for single-char punctuation like . , ? ! and quotes if needed.)

const DEFAULTS = {
  width: 20,
  indentBoxes: 1,
  countSpaces: true,
  digitsPerBox: 2,
  // punctuation that triggers a required blank after it
  requireBlankAfter: new Set(["?", "!"]),
    forbidTypedSpaceAfter: new Set([".", ",", ":", ";"]),
  // punctuation that can share the last box if it would otherwise wrap
  shareablePunct: new Set([".", ",", "?", "!", ":", ";", "…", ")", "]", "”", "’", "」", "』", "》"]),
  // special 2-box tokens
  twoBoxTokens: new Set(["……", "―"]),
};

function normalizeText(s) {
  return (s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

// Tokenize text into paragraph tokens and character-like units.
// We keep spaces as " " tokens (if countSpaces is true).
// We handle "……" (6 dots) as a single token, and "―" as a token.
// Digits will be packed later into digit-boxes.
function tokenizeParagraph(para) {
  const tokens = [];
  for (let i = 0; i < para.length; i++) {
    // Handle the 6-dot ellipsis token "……"
    if (para.slice(i, i + 6) === "……") {
      tokens.push("……");
      i += 5;
      continue;
    }
    const ch = para[i];
    tokens.push(ch);
  }
  return tokens;
}

// Represent a box on paper.
function makeCell(char = "", used = false) {
  return { char, used };
}

// Packs digit characters into boxes (2 digits per box by default).
// Example: ["2","0","2","6"] -> ["20","26"].
// Non-digits pass through unchanged.
function packDigits(tokens, digitsPerBox = 2) {
  const out = [];
  let digitBuf = "";
  for (const t of tokens) {
    if (/^[0-9]$/.test(t)) {
      digitBuf += t;
      if (digitBuf.length === digitsPerBox) {
        out.push(digitBuf);
        digitBuf = "";
      }
    } else {
      if (digitBuf.length > 0) {
        out.push(digitBuf); // leftover digits share one box
        digitBuf = "";
      }
      out.push(t);
    }
  }
  if (digitBuf.length > 0) out.push(digitBuf);
  return out;
}

// Core: layout tokens into cells in row-major order.
function layout(text, opts = {}) {
  const o = {
    ...DEFAULTS,
    ...opts,
  };
  const width = Number(o.width) || 20;
  const indentBoxes = Math.max(0, Number(o.indentBoxes ?? 1));
  const countSpaces = !!o.countSpaces;

  const norm = normalizeText(text);
  const paras = norm.split("\n");

  const cells = [];
  let col = 0; // current column (0..width-1)

  const pushCell = (cell) => {
    cells.push(cell);
    col = (col + 1) % width;
  };

  const padToLineEnd = () => {
    if (col === 0) return;
    const pad = width - col;
    for (let i = 0; i < pad; i++) pushCell(makeCell("", false)); // unused padding
  };

  // Used blank box (space/indent)
  const pushUsedBlank = () => pushCell(makeCell("", true));

  const atLineStart = () => col === 0;

  // If a token doesn't fit and is shareable punctuation, we can try to attach it to previous used cell
  // ONLY when we are at the start of a new line (i.e., wrap would occur) AND previous cell exists AND previous cell was used.
  const trySharePunctuationWithPreviousBox = (punct) => {
    if (!o.shareablePunct.has(punct)) return false;
    if (!atLineStart()) return false;
    if (cells.length === 0) return false;

    // Find the immediate previous cell (could be unused padding; if so, sharing shouldn't happen).
    const prev = cells[cells.length - 1];
    if (!prev.used) return false;

    // Append punctuation visually inside the same cell.
    // This mimics the TOPIK rule that punctuation can share the last box if it would otherwise start a new line.
    prev.char = `${prev.char}${punct}`;
    return true;
  };

  const placeToken = (token, nextToken) => {
  // Handle spaces
  if (token === " " || token === "\t") {
    if (!countSpaces) return;

    // Do not force a leading space on a wrapped line (we simply skip it)
    if (atLineStart()) return;

    pushUsedBlank();
    return;
  }

  // Handle 2-box tokens
  if (o.twoBoxTokens.has(token)) {
    if (col === width - 1) {
      padToLineEnd();
    }
    pushCell(makeCell(token, true));
    pushCell(makeCell("·", true)); // continuation marker (purely visual)
    return;
  }

  // Single-char punctuation at line start: try share-with-previous-box edge case
 if (o.shareablePunct.has(token) && atLineStart()) {
  if (trySharePunctuationWithPreviousBox(token)) {
    // After ?/!: add the required blank only if paragraph continues
    if (o.requireBlankAfter.has(token) && nextToken !== undefined) {
      pushUsedBlank();
    }
    return;
  }
}


  // Normal token: place in a used cell
  pushCell(makeCell(token, true));

  // After ? or !: ensure exactly ONE blank box,
  // BUT only if there is more content coming in the same paragraph.
  // (tokens are per-paragraph, so nextToken === undefined means end-of-paragraph)
  if (o.requireBlankAfter.has(token)) {
    if (nextToken !== undefined) {
      pushUsedBlank();
    }
  }
};



  // Iterate paragraphs
  for (let p = 0; p < paras.length; p++) {
    const para = paras[p];

    // Paragraph start indent: 1 used blank box (TOPIK)
    if (para.length > 0 && indentBoxes > 0) {
      // If paragraph starts at a fresh line, put indent in first box and start content from second.
      // If not at fresh line, we first pad to end-of-line.
      if (!atLineStart()) padToLineEnd();
      for (let i = 0; i < indentBoxes; i++) pushUsedBlank();
    } else {
      // Even for empty paragraph, we still move to next line (like a blank line)
      if (!atLineStart()) padToLineEnd();
      // If it's truly empty, continue; will force a blank line below.
    }

    // Tokenize + digit-pack
    let tokens = tokenizeParagraph(para);
    tokens = packDigits(tokens, o.digitsPerBox);

for (let i = 0; i < tokens.length; i++) {
  const t = tokens[i];
  const next = tokens[i + 1];

  if (o.requireBlankAfter.has(t) && (next === " " || next === "\t")) {
    placeToken(t, next);
    i += 1;
    continue;
  }

  if (o.forbidTypedSpaceAfter.has(t) && (next === " " || next === "\t")) {
    placeToken(t, next);
    i += 1;
    continue;
  }

  placeToken(t, next);
}


    // After paragraph (except last), we force new line start.
    if (p !== paras.length - 1) {
      padToLineEnd();
    }
  }
// Always render the final line fully (pad unused boxes to end-of-line)
padToLineEnd();

  // Count used boxes (exclude unused padding)
const usedCount = cells.reduce((acc, c) => acc + (c.used ? 1 : 0), 0);

// last used cell index (1-based). 0 if nothing used.
let lastUsedIndex = 0;
for (let k = cells.length - 1; k >= 0; k--) {
  if (cells[k]?.used) {
    lastUsedIndex = k + 1;
    break;
  }
}

// Sheet count = round up to end-of-line marker (20/40/60… or 25/50/75…)
const sheetCount =
  lastUsedIndex === 0 ? 0 : Math.ceil(lastUsedIndex / width) * width;

return { cells, usedCount, sheetCount };

}

// -----------------------
// Tiny verification hooks
// -----------------------
const sample = `러시아에는 지식의 날이라는 기념일이 있다. 이 날은 날씨가 좋지 않은데도 불구하고 매년 9월 1일에 기념된다.
지식의 날은 소비엣 시대에 새로운 학년의 시작을 기념하기 위해 만들어졌다. 그 이전에는 교육을 받을 수 있는 사람이 제한적이었다가, 소비엣 정부가 모든 아이들에게 학교 교육을 의무화했다. 그래서 교육의 중요성을 강조하기 위해 이 날을 기념일로 정했다.`;

function logCounts() {
  const r20 = layout(sample, { width: 20, indentBoxes: 1, countSpaces: true });
  const r25 = layout(sample, { width: 25, indentBoxes: 1, countSpaces: true });
  console.log("Sample used boxes (20):", r20.usedCount);
  console.log("Sample used boxes (25):", r25.usedCount);
}

logCounts();

// Expose for manual console testing
window.WONGOJI = { layout };

// -----------------------
// Step 3: UI wiring + rendering
// -----------------------
const elText = document.getElementById("text");
const elWidth = document.getElementById("width");
const elLimitOn = document.getElementById("limitOn");
const elMinLimit = document.getElementById("minLimit");
const elMaxLimit = document.getElementById("maxLimit");
const elStats = document.getElementById("stats");
const elGrid = document.getElementById("grid");

function render() {
  const text = elText.value || "";
  const width = Number(elWidth.value) || 20;
 elGrid.style.setProperty("--w", String(width));

  const limitEnabled = !!elLimitOn.checked;
const minRaw = (elMinLimit.value || "").trim();
const maxRaw = (elMaxLimit.value || "").trim();

// min is optional: empty = off
const minLimit = minRaw === "" ? null : Math.max(0, Number(minRaw));

// max is optional: empty = off
const maxLimit = maxRaw === "" ? null : Math.max(1, Number(maxRaw));

const { cells, usedCount, sheetCount } = layout(text, {
    width,
    indentBoxes: 1,
    countSpaces: true,
  });

// Stats
if (!limitEnabled) {
  elStats.innerHTML = `
    <div><strong>Boxes used:</strong> ${usedCount}</div>
    <div class="hint">Limit is off. Turn it on to see min/max checks.</div>
  `;
} else {
  // Validate range
  if (minLimit !== null && maxLimit !== null && minLimit > maxLimit) {
    elStats.innerHTML = `
      <div><strong>Boxes used:</strong> ${usedCount}</div>
      <div><span class="badge bad">INVALID</span> Min is greater than Max.</div>
    `;
  } else {
   const underBy = (minLimit !== null && sheetCount < minLimit) ? (minLimit - sheetCount) : 0;
   const overBy  = (maxLimit !== null && sheetCount > maxLimit) ? (sheetCount - maxLimit) : 0;

    let badge = `<span class="badge ok">OK</span>`;
    let line2 = ``;

    if (underBy > 0) {
      badge = `<span class="badge bad">UNDER</span>`;
      line2 = `<div><strong>Need to add:</strong> ${underBy}</div>`;
    } else if (overBy > 0) {
      badge = `<span class="badge bad">OVER</span>`;
      line2 = `<div><strong>Need to cut:</strong> ${overBy}</div>`;
    } else {
      // within range (or only one side is set and satisfied)
      if (minLimit !== null && maxLimit !== null) {
        line2 = `<div><strong>Range:</strong> ${minLimit}–${maxLimit}</div>`;
      } else if (minLimit !== null) {
        line2 = `<div><strong>Minimum:</strong> ${minLimit}</div>`;
      } else if (maxLimit !== null) {
        line2 = `<div><strong>Maximum:</strong> ${maxLimit}</div>`;
      }
    }

    const rangeLabel =
      (minLimit !== null && maxLimit !== null) ? `${minLimit}–${maxLimit}`
      : (minLimit !== null) ? `≥ ${minLimit}`
      : (maxLimit !== null) ? `≤ ${maxLimit}`
      : `(no min/max set)`;

    elStats.innerHTML = `
    <div><strong>Written boxes:</strong> ${usedCount} &nbsp; <strong>On sheet:</strong> ${sheetCount}
      ${line2}
    `;
  }
}


   // Render rows + separator band + fixed right-side grid count (20/40/60… or 25/50/75…)
elGrid.innerHTML = "";

const isPunct = (ch) =>
  /^[\.\,\?\!\:\;…\)\]\”\’」』》]$/.test(ch);

let usedIndex = 0;
let lineNo = 0;

for (let i = 0; i < cells.length; i += width) {
  lineNo++;

  // --- Character row (boxes) ---
  const charRow = document.createElement("div");
  charRow.className = "charRow";

  for (let j = 0; j < width; j++) {
    const c = cells[i + j] ?? { char: "", used: false };

    const box = document.createElement("div");
    box.className = "cell";

    if (!c.used) {
      box.classList.add("unused");
      box.textContent = "";
    } else {
      usedIndex++;

      if (c.char === "") {
        box.classList.add("usedBlank");
        box.textContent = "";
      } else {
        box.textContent = c.char;

        // Punctuation (single char) left-aligned
        if (typeof c.char === "string" && c.char.length === 1 && isPunct(c.char)) {
          box.classList.add("punct");
        }
      }

      // Overflow highlighting uses MAX only
      const pos = i + j + 1; // 1-based sheet position
      if (limitEnabled && maxLimit !== null && pos > maxLimit) {
      box.classList.add("overflow");
}

    }

    charRow.appendChild(box);
  }

// --- Break row (ONE spanning cell inside the grid) ---
const breakRow = document.createElement("div");
breakRow.className = "breakRow";
breakRow.style.width = `calc(var(--box) * ${width})`;

const count = document.createElement("div");
count.className = "breakCount";
const current = lineNo * width;

// Only show every 100 boxes
count.textContent = (current % 100 === 0) ? String(current) : "";
breakRow.appendChild(count);


// If this is the final break row, close the bottom border
const isLast = (i + width) >= cells.length;
if (isLast) breakRow.classList.add("last");
elGrid.appendChild(charRow);
elGrid.appendChild(breakRow);

}




}

// Enable/disable limit input visually (optional nicety)
function syncLimitUI() {
  const on = elLimitOn.checked;
  elMinLimit.disabled = !on;
  elMaxLimit.disabled = !on;
}


elLimitOn.addEventListener("change", () => {
  syncLimitUI();
  render();
});

elWidth.addEventListener("change", render);
elMinLimit.addEventListener("input", render);
elMaxLimit.addEventListener("input", render);
elText.addEventListener("input", render);

// Init
syncLimitUI();
render();
