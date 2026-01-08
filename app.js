// app.js — core layout (paper simulation) + UI rendering
// Rules locked:
// - New paragraph = every newline
// - Paragraph indent = 1 empty used box
// - Spaces count as used boxes (but we do not force leading spaces at start of wrapped lines)
// - 1 box = 1 character, with special rules:
//   - Digits: 2 digits per 1 box (TOPIK rule)
//   - Ellipsis "……" and dash "―" are 2 boxes
//   - After ? and !: leave 1 empty used box (if there's room; if at end of line, that blank starts next line)
//   - Punctuation edge-case: if punctuation would be pushed to a new line because the previous line ended exactly,
//     allow punctuation to "share" the last box (character+punct in one box) to avoid consuming a new box.

const DEFAULTS = {
  width: 20,
  indentBoxes: 1,
  countSpaces: true,
  digitsPerBox: 2,

  requireBlankAfter: new Set(["?", "!"]),
  forbidTypedSpaceAfter: new Set([".", ",", ":", ";"]),

  shareablePunct: new Set([
    ".", ",", "?", "!", ":", ";", "…",
    ")", "]", "”", "’", "」", "』", "》"
  ]),

  twoBoxTokens: new Set(["……", "―"]),
};

function normalizeText(s) {
  return (s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function tokenizeParagraph(para) {
  const tokens = [];
  for (let i = 0; i < para.length; i++) {
    if (para.slice(i, i + 6) === "……") {
      tokens.push("……");
      i += 5;
      continue;
    }
    tokens.push(para[i]);
  }
  return tokens;
}

function makeCell(char = "", used = false) {
  return { char, used };
}

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
        out.push(digitBuf);
        digitBuf = "";
      }
      out.push(t);
    }
  }

  if (digitBuf.length > 0) out.push(digitBuf);
  return out;
}

// --------------------------------------------------
// Core layout engine
// --------------------------------------------------

function layout(text, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const width = Number(o.width) || 20;
  const indentBoxes = Math.max(0, Number(o.indentBoxes ?? 1));
  const countSpaces = !!o.countSpaces;

  const paras = normalizeText(text).split("\n");

  const cells = [];
  let col = 0;

  const pushCell = (cell) => {
    cells.push(cell);
    col = (col + 1) % width;
  };

  const padToLineEnd = () => {
    if (col === 0) return;
    for (let i = 0; i < width - col; i++) {
      pushCell(makeCell("", false));
    }
  };

  const pushUsedBlank = () => pushCell(makeCell("", true));
  const atLineStart = () => col === 0;

  const trySharePunctuationWithPreviousBox = (punct) => {
    if (!o.shareablePunct.has(punct)) return false;
    if (!atLineStart()) return false;
    if (cells.length === 0) return false;

    const prev = cells[cells.length - 1];
    if (!prev.used) return false;

    prev.char = `${prev.char}${punct}`;
    return true;
  };

  const placeToken = (token, nextToken) => {
    if (token === " " || token === "\t") {
      if (!countSpaces || atLineStart()) return;
      pushUsedBlank();
      return;
    }

    if (o.twoBoxTokens.has(token)) {
      if (col === width - 1) padToLineEnd();
      pushCell(makeCell(token, true));
      pushCell(makeCell("·", true));
      return;
    }

    if (o.shareablePunct.has(token) && atLineStart()) {
      if (trySharePunctuationWithPreviousBox(token)) {
        if (o.requireBlankAfter.has(token) && nextToken !== undefined) {
          pushUsedBlank();
        }
        return;
      }
    }

    pushCell(makeCell(token, true));

    if (o.requireBlankAfter.has(token) && nextToken !== undefined) {
      pushUsedBlank();
    }
  };

  for (let p = 0; p < paras.length; p++) {
    const para = paras[p];

    if (para.length > 0 && indentBoxes > 0) {
      if (!atLineStart()) padToLineEnd();
      for (let i = 0; i < indentBoxes; i++) pushUsedBlank();
    } else {
      if (!atLineStart()) padToLineEnd();
    }

    let tokens = packDigits(
      tokenizeParagraph(para),
      o.digitsPerBox
    );

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const next = tokens[i + 1];

      if (
        (o.requireBlankAfter.has(t) || o.forbidTypedSpaceAfter.has(t)) &&
        (next === " " || next === "\t")
      ) {
        placeToken(t, next);
        i++;
        continue;
      }

      placeToken(t, next);
    }

    if (p !== paras.length - 1) padToLineEnd();
  }

  padToLineEnd();

  const usedCount = cells.reduce((a, c) => a + (c.used ? 1 : 0), 0);

  let lastUsedIndex = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i]?.used) {
      lastUsedIndex = i + 1;
      break;
    }
  }

  const sheetCount =
    lastUsedIndex === 0 ? 0 : Math.ceil(lastUsedIndex / width) * width;

  return { cells, usedCount, sheetCount };
}

// Expose for console debugging if ever needed
window.WONGOJI = { layout };

// --------------------------------------------------
// UI wiring + rendering
// --------------------------------------------------

const elText = document.getElementById("text");
const elWidth = document.getElementById("width");
const elLimitOn = document.getElementById("limitOn");
const elMinLimit = document.getElementById("minLimit");
const elMaxLimit = document.getElementById("maxLimit");
const elStats = document.getElementById("stats");
const elGrid = document.getElementById("grid");

function updateBoxSizeForViewport(columns) {
  const panel = document.querySelector(".panel.output");
  if (!panel) return;

  const rect = panel.getBoundingClientRect();

  // horizontal padding applied to panel.output
  const style = getComputedStyle(panel);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;

  const SAFETY = 2;

  const usableWidth =
    rect.width - paddingLeft - paddingRight - SAFETY;

  const boxSize = Math.floor(usableWidth / columns);

  const clamped = Math.max(18, Math.min(boxSize, 32));

  document.documentElement.style.setProperty(
    "--box",
    `${clamped}px`
  );
}



function render() {
  const text = elText.value || "";
  const width = Number(elWidth.value) || 20;

  updateBoxSizeForViewport(width);

  const limitEnabled = elLimitOn.checked;
  const minLimit = elMinLimit.value.trim() === "" ? null : Number(elMinLimit.value);
  const maxLimit = elMaxLimit.value.trim() === "" ? null : Number(elMaxLimit.value);

  const { cells, usedCount, sheetCount } = layout(text, {
    width,
    indentBoxes: 1,
    countSpaces: true,
  });

  if (!limitEnabled) {
    elStats.innerHTML = `
      <div><strong>Boxes used:</strong> ${usedCount}</div>
      <div class="hint">Limit is off.</div>
    `;
  } else if (minLimit !== null && maxLimit !== null && minLimit > maxLimit) {
    elStats.innerHTML = `
      <div><strong>Boxes used:</strong> ${usedCount}</div>
      <div><span class="badge bad">INVALID</span> Min > Max</div>
    `;
  } else {
    const underBy = minLimit !== null && sheetCount < minLimit
      ? minLimit - sheetCount
      : 0;

    const overBy = maxLimit !== null && sheetCount > maxLimit
      ? sheetCount - maxLimit
      : 0;

    let badge = `<span class="badge ok">OK</span>`;
    let note = "";

    if (underBy > 0) {
      badge = `<span class="badge bad">UNDER</span>`;
      note = `<div><strong>Need to add:</strong> ${underBy}</div>`;
    } else if (overBy > 0) {
      badge = `<span class="badge bad">OVER</span>`;
      note = `<div><strong>Need to cut:</strong> ${overBy}</div>`;
    }

    elStats.innerHTML = `
      <div>
        <strong>Written:</strong> ${usedCount}
        &nbsp;
        <strong>On sheet:</strong> ${sheetCount}
        ${badge}
      </div>
      ${note}
    `;
  }

  elGrid.innerHTML = "";

  const isPunct = (ch) =>
    /^[\.\,\?\!\:\;…\)\]\”\’」』》]$/.test(ch);

  let lineNo = 0;

  for (let i = 0; i < cells.length; i += width) {
    lineNo++;

    const row = document.createElement("div");
    row.className = "charRow";

    for (let j = 0; j < width; j++) {
      const c = cells[i + j] ?? { char: "", used: false };
      const box = document.createElement("div");
      box.className = "cell";

      if (!c.used) {
        box.classList.add("unused");
      } else {
        if (c.char === "") {
          box.classList.add("usedBlank");
        } else {
          box.textContent = c.char;
          if (c.char.length === 1 && isPunct(c.char)) {
            box.classList.add("punct");
          }
        }

        const pos = i + j + 1;
        if (limitEnabled && maxLimit !== null && pos > maxLimit) {
          box.classList.add("overflow");
        }
      }

      row.appendChild(box);
    }

    const breakRow = document.createElement("div");
    breakRow.className = "breakRow";
    breakRow.style.width = `calc(var(--box) * ${width})`;

    const count = document.createElement("div");
    count.className = "breakCount";
    const current = lineNo * width;
    count.textContent = current % 100 === 0 ? String(current) : "";
    breakRow.appendChild(count);

    if (i + width >= cells.length) breakRow.classList.add("last");

    elGrid.appendChild(row);
    elGrid.appendChild(breakRow);
  }
}

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

syncLimitUI();
render();

window.addEventListener("resize", () => {
  render();
});

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    render();
  });
}

