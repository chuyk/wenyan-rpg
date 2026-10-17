const layer = document.getElementById("quiz-layer");
const elChar = document.getElementById("quiz-char");
const elTag = document.getElementById("quiz-tag");
const elHint = document.getElementById("quiz-hint");
const elQuestion = document.getElementById("quiz-question");
const elOptions = document.getElementById("quiz-options");
const elFeedback = document.getElementById("quiz-feedback");

let ctx = null;
let phase = "question";

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function nextRound() {
  if (!ctx) return;
  ctx.order = shuffle(ctx.source).map((o) => ({ ...o, disabled: false, wrongPick: false }));
  elFeedback.className = "";
  elFeedback.textContent = "";
  phase = "question";
  render();
}

function render() {
  elOptions.innerHTML = "";
  ctx.order.forEach((option, i) => {
    const button = document.createElement("button");
    button.className = "opt";
    button.innerHTML = `<span style="opacity:.5;margin-right:12px">${i + 1}</span>${option.text}`;
    button.disabled = option.disabled === true;

    if (option.disabled && option.wrongPick) button.classList.add("wrong");
    if (phase === "done" && option.correct) button.classList.add("correct");

    button.addEventListener("click", () => {
      if (!ctx || phase !== "question" || button.disabled) return;

      if (option.correct) {
        option.disabled = true;
        phase = "done";
        render();
        elFeedback.className = "";
        elFeedback.innerHTML =
          `答對了。<br>${option.note || ""}` +
          `<br><button class="feedback-btn" style="margin-top:14px;padding:9px 28px;font-size:15px">繼續（Enter）</button>`;
        elFeedback.querySelector(".feedback-btn").addEventListener("click", close);
      } else {
        option.disabled = true;
        option.wrongPick = true;
        const correct = ctx.order.find((o) => o.correct);
        phase = "feedback";
        render();
        elFeedback.className = "bad";
        const charged = ctx.onWrong(correct) !== false;
        elFeedback.innerHTML =
          (charged ? "答錯了，扣 1 顆心。" : "又答錯了——這題不再扣血，但正確率被扣了。") +
          `<br>正確答案是「${correct.text}」——${correct.note || ""}` +
          `<br><button class="feedback-btn" style="margin-top:14px;padding:9px 28px;font-size:15px">再試一次（Enter）</button>`;
        elFeedback.querySelector(".feedback-btn").addEventListener("click", nextRound);
      }
    });

    elOptions.appendChild(button);
  });
}

function close() {
  if (!ctx) return;
  layer.classList.add("hidden");
  document.removeEventListener("keydown", onKey);
  const solved = ctx.onSolved;
  ctx = null;
  solved();
}

function onKey(event) {
  if (!ctx) return;
  if (phase === "question") {
    const index = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(event.code);
    if (index !== -1) {
      const buttons = elOptions.querySelectorAll(".opt");
      if (buttons[index]) buttons[index].click();
    }
  } else if (event.code === "Enter" || event.code === "Space") {
    const button = elFeedback.querySelector(".feedback-btn");
    if (button) button.click();
  }
}

export function openQuiz(stele, { onSolved, onWrong }) {
  ctx = { source: stele.options, order: [], onSolved, onWrong };
  nextRound();

  elChar.textContent = stele.char;
  elTag.textContent = stele.tag;
  elHint.textContent = stele.hint || "";
  elQuestion.textContent = stele.question;

  layer.classList.remove("hidden");
  document.addEventListener("keydown", onKey);
}

export function isQuizOpen() {
  return !layer.classList.contains("hidden");
}

export function forceCloseQuiz() {
  if (!ctx) return;
  layer.classList.add("hidden");
  document.removeEventListener("keydown", onKey);
  ctx = null;
  phase = "question";
}