(() => {
  "use strict";

  const content = document.querySelector("#app-content");
  const answerToast = document.querySelector("#answer-toast");
  const pageButtons = [...document.querySelectorAll("[data-page]")];
  let answerToastTimeout;
  const state = {
    items: [],
    beforeChoices: [],
    afterChoices: [],
    page: "study",
    index: 0,
    selectedBefore: [],
    selectedAfter: [],
    checked: false,
    correct: false,
    evaluation: null,
    repaired: { before: false, after: false }
  };

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  const choiceLabels = new Map([
    ["Vます bỏ ます", "Vます（ますを取る）"],
    ["(thể bị động)", "（受身形）"]
  ]);

  function displayChoice(value) {
    return choiceLabels.get(value) ?? value;
  }

  function toOptions(value, field, itemId) {
    if (value === undefined || value === null) return [];
    const options = Array.isArray(value) ? value : [value];
    if (!options.every((option) => typeof option === "string")) {
      const fieldLabels = {
        grammar: "文法",
        before: "前接要素",
        grammarCore: "文法の中心",
        after: "後接要素"
      };
      throw new Error(`項目 ${itemId}: ${fieldLabels[field] ?? field} は文字列または文字列の配列である必要があります。`);
    }
    return [...options];
  }

  function normalizeData(data) {
    if (!Array.isArray(data)) {
      throw new Error("データは文法項目の配列である必要があります。");
    }

    return data.map((item, index) => {
      if (!item || typeof item !== "object" || !Array.isArray(item.variants)) {
        throw new Error(`${index + 1} 番目の項目に有効な構文候補一覧がありません。`);
      }

      return {
        id: item.id ?? String(index + 1),
        grammar: toOptions(item.grammar, "grammar", item.id ?? index + 1),
        meaningVietnamese: typeof item.meaningVietnamese === "string" ? item.meaningVietnamese : "",
        variants: item.variants.map((variant, variantIndex) => {
          if (!variant || typeof variant !== "object") {
            throw new Error(`項目 ${item.id ?? index + 1}: 構文候補 ${variantIndex + 1} が無効です。`);
          }
          return {
            before: toOptions(variant.before, "before", item.id ?? index + 1),
            grammarCore: toOptions(variant.grammarCore, "grammarCore", item.id ?? index + 1),
            after: toOptions(variant.after, "after", item.id ?? index + 1),
            meaningVietnamese: typeof variant.meaningVietnamese === "string"
              ? variant.meaningVietnamese
              : null
          };
        })
      };
    });
  }

  function uniqueChoices(items, field) {
    const seen = new Set();
    const choices = [];
    for (const item of items) {
      for (const variant of item.variants) {
        for (const value of variant[field]) {
          if (value === "" || seen.has(value)) continue;
          seen.add(value);
          choices.push(value);
        }
      }
    }
    const categoryOrder = (value) => {
      if (/^N(?:$|[\s+]|で)/u.test(value)) return 0;
      if (/^(?:V|たとえ\s*\+\s*V)/u.test(value) || ["言う", "思う", "(thể bị động)"].includes(value)) return 1;
      if (/^(?:いA|なA)(?:$|[\s+]|く|け|で)/u.test(value)) return 2;
      return 3;
    };
    return choices
      .map((value, index) => ({ value, index, category: categoryOrder(value) }))
      .sort((a, b) => a.category - b.category || a.index - b.index)
      .map(({ value }) => value);
  }

  function currentItem() {
    return state.items[state.index];
  }

  function resetPractice() {
    state.selectedBefore = [];
    state.selectedAfter = [];
    state.checked = false;
    state.correct = false;
    state.evaluation = null;
    state.repaired = { before: false, after: false };
  }

  function hideAnswerToast() {
    window.clearTimeout(answerToastTimeout);
    answerToast.hidden = true;
    answerToast.replaceChildren();
    answerToast.classList.remove("alert-success", "alert-warning", "answer-toast-visible");
  }

  function showAnswerToast(correct) {
    window.clearTimeout(answerToastTimeout);
    answerToast.classList.remove("alert-success", "alert-warning", "answer-toast-visible");
    answerToast.classList.add(correct ? "alert-success" : "alert-warning");

    if (correct) {
      answerToast.textContent = "正解です！正しい構文を選びました。";
    } else {
      answerToast.innerHTML = `
        <strong>不正解です。修正が必要な箇所を確認してください。</strong>
        <div class="small mt-1">Space キーで間違いを修正できます。</div>`;
    }

    answerToast.hidden = false;
    requestAnimationFrame(() => answerToast.classList.add("answer-toast-visible"));
    answerToastTimeout = window.setTimeout(hideAnswerToast, 1000);
  }

  function setPage(page) {
    hideAnswerToast();
    state.page = page;
    pageButtons.forEach((button) => {
      const active = button.dataset.page === page;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    render();
  }

  function navigate(delta) {
    const nextIndex = state.index + delta;
    if (nextIndex < 0 || nextIndex >= state.items.length) return;
    hideAnswerToast();
    state.index = nextIndex;
    resetPractice();
    render();
  }

  function renderNavigation() {
    const atStart = state.index === 0;
    const atEnd = state.index === state.items.length - 1;
    return `
      <div class="d-flex align-items-center justify-content-between gap-3 mt-4">
        <button class="btn btn-outline-secondary rounded-pill px-3" type="button" data-action="previous" ${atStart ? "disabled" : ""}>
          <span aria-hidden="true">←</span><span class="ms-2">前へ</span>
        </button>
        <span class="small fw-semibold text-secondary text-nowrap">${state.index + 1} / ${state.items.length}</span>
        <button class="btn btn-primary rounded-pill px-3" type="button" data-action="next" ${atEnd ? "disabled" : ""}>
          <span class="me-2">次へ</span><span aria-hidden="true">→</span>
        </button>
      </div>`;
  }

  function badges(values, emptyLabel) {
    const visible = values.filter((value) => value !== "");
    if (visible.length === 0) return `<span class="text-secondary small">${escapeHtml(emptyLabel)}</span>`;
    return visible.map((value) => `<span class="choice-badge">${escapeHtml(displayChoice(value))}</span>`).join(" ");
  }

  function renderStudy() {
    const item = currentItem();
    const grammar = item.grammar.length
      ? item.grammar.map((value) => `<span class="grammar-chip">${escapeHtml(value)}</span>`).join(" ")
      : `<span class="grammar-chip">文法データがありません</span>`;
    const variants = item.variants.map((variant, index) => `
      <div class="variant-row">
        <p class="small fw-semibold text-secondary mb-2">構文 ${index + 1}</p>
        <div class="d-flex flex-wrap align-items-center gap-2">
          ${badges(variant.before, "前接要素なし")}
          ${variant.grammarCore.length ? `<span class="text-secondary" aria-label="接続">+</span>${badges(variant.grammarCore, " ")}` : ""}
          ${variant.after.some((value) => value !== "")
            ? `<span class="text-secondary" aria-label="接続">+</span>${badges(variant.after, "")}`
            : ""}
        </div>
      </div>`).join("");

    return `
      <article class="card lesson-card">
        <div class="card-body">
          <div class="d-flex align-items-center justify-content-between gap-3 mb-4">
            <span class="small text-secondary">項目 ${escapeHtml(item.id)}</span>
          </div>
          <section aria-label="文法">
            <h2 class="h6 text-secondary mb-3">表記</h2>
            <div class="d-flex flex-wrap gap-2">${grammar}</div>
          </section>
          <section class="mt-4" aria-label="意味">
            <h2 class="h6 text-secondary mb-2">意味（ベトナム語）</h2>
            <div class="meaning-box">${item.meaningVietnamese ? escapeHtml(item.meaningVietnamese) : "ベトナム語の意味がありません。"}</div>
          </section>
          <section class="mt-4" aria-label="使用可能な構文">
            <h2 class="h6 text-secondary mb-3">使用可能な構文</h2>
            <div class="d-grid gap-2">${variants}</div>
          </section>
          ${renderNavigation()}
        </div>
      </article>`;
  }

  function renderSelectedChoices(field, choices, selected, validChoices, repaired) {
    const isAfter = field === "after";
    const selectedChoices = selected;
    if (selectedChoices.length === 0) {
      return isAfter ? "" : `<span class="text-secondary small">前接要素を選択してください</span>`;
    }

    return selectedChoices.map((value) => {
      const isValid = !state.checked || (value === ""
        ? validChoices.length === 0
        : validChoices.includes(value));
      const statusClass = state.checked ? (isValid ? "btn-success" : "btn-danger") : "btn-primary";
      const action = isAfter ? "remove-after" : "remove-before";
      const index = value === "" ? -1 : choices.indexOf(value);
      const disabled = state.checked ? "disabled" : "";
      const repairClass = repaired ? "repair-highlight" : "";
      return `<button type="button" class="btn choice-button ${statusClass} is-selected ${repairClass}" data-action="${action}" data-value="${index}" aria-pressed="true" ${disabled}>${escapeHtml(displayChoice(value))}${!state.checked ? `<span class="ms-2" aria-hidden="true">×</span>` : ""}</button>`;
    }).join("");
  }

  function renderChoiceList(field, choices, selected) {
    const isAfter = field === "after";
    const selectedSet = new Set(selected);
    const available = choices.filter((value) => !selectedSet.has(value));
    const buttons = available.map((value) => {
      const action = isAfter ? "choose-after" : "choose-before";
      const index = choices.indexOf(value);
      return `<button type="button" class="btn choice-button btn-outline-secondary" data-action="${action}" data-value="${index}" aria-pressed="false" ${state.checked ? "disabled" : ""}>${escapeHtml(displayChoice(value))}</button>`;
    }).join("");
    const emptyMessage = !buttons
      ? `<span class="text-secondary small">${isAfter && choices.length === 0 ? "後接要素の選択肢がありません。" : "すべて選択済みです。"}</span>`
      : "";
    return `${buttons}${emptyMessage}`;
  }

  function renderPractice() {
    const item = currentItem();
    const variant = state.evaluation?.variant;
    const validBefore = variant?.before.filter((value) => value !== "") ?? [];
    const validAfter = variant?.after.filter((value) => value !== "") ?? [];
    const beforeStatus = state.evaluation?.beforeCorrect ?? false;
    const afterStatus = state.evaluation?.afterCorrect ?? false;
    const beforeSelected = renderSelectedChoices("before", state.beforeChoices, state.selectedBefore, validBefore, state.repaired.before);
    const beforeChoices = renderChoiceList("before", state.beforeChoices, state.selectedBefore);
    const afterSelected = renderSelectedChoices("after", state.afterChoices, state.selectedAfter, validAfter, state.repaired.after);
    const afterChoices = renderChoiceList("after", state.afterChoices, state.selectedAfter);
    const grammar = item.grammar.length
      ? item.grammar.map((value) => `<span class="grammar-chip">${escapeHtml(value)}</span>`).join("")
      : `<span class="grammar-chip">文法データがありません</span>`;
    const meaning = state.checked
      ? (state.evaluation?.variant?.meaningVietnamese ?? item.meaningVietnamese ?? "ベトナム語の意味がありません。")
      : "";

    return `
      <article class="card lesson-card practice-card">
        <div class="card-body">
          <div class="d-flex align-items-center justify-content-between gap-3 mb-3">

            <span class="small text-secondary">項目 ${escapeHtml(item.id)} · ${state.index + 1} / ${state.items.length}</span>
          </div>
          
          <div class="row g-3 practice-columns">
            <section class="col-12 col-lg-4" aria-label="前接要素の選択">
              <div class="practice-column h-100">
                <div class="d-flex align-items-center justify-content-between gap-2 mb-3">
                  <h3 class="h6 fw-bold mb-0">前接要素 <span class="text-danger">*</span></h3>
                  ${state.checked ? `<span class="small ${beforeStatus ? "text-success" : "text-danger"}">${beforeStatus ? "正解" : state.selectedBefore.length === 0 ? "未選択" : "不一致"}</span>` : ""}
                </div>
                <div class="selected-area choice-area mb-3" aria-label="選択済みの前接要素">${beforeSelected}</div>
              </div>
            </section>

            <section class="col-12 col-lg-4" aria-label="現在の文法">
              <div class="practice-column grammar-column h-100">
                <h3 class="h6 fw-bold mb-3">文法</h3>
                <div class="grammar-choice-list">${grammar}</div>
              </div>
            </section>

            <section class="col-12 col-lg-4" aria-label="後接要素の選択">
              <div class="practice-column h-100">
                <div class="d-flex align-items-center justify-content-between gap-2 mb-3">
                  <h3 class="h6 fw-bold mb-0">後接要素</h3>
                  ${state.checked ? `<span class="small ${afterStatus ? "text-success" : "text-danger"}">${afterStatus ? "正解" : state.selectedAfter.length === 0 ? "未選択" : "不一致"}</span>` : ""}
                </div>
                <div class="selected-area choice-area mb-3" aria-label="選択済みの後接要素">${afterSelected}</div>
              </div>
            </section>
          </div>

          <div class="d-grid gap-3 mt-3 practice-lists">
            <section class="practice-list-panel" aria-label="前接要素一覧">
              <div class="d-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-2">
                <h3 class="h6 fw-bold mb-0">前接要素一覧</h3>
                <span class="small text-secondary">複数選択可</span>
              </div>
              <div class="choice-area choice-list">${beforeChoices}</div>
            </section>
            <section class="practice-list-panel" aria-label="後接要素一覧">
              <div class="d-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-2">
                <h3 class="h6 fw-bold mb-0">後接要素一覧</h3>
                <span class="small text-secondary">複数選択可</span>
              </div>
              <div class="choice-area choice-list">${afterChoices}</div>
            </section>
          </div>

          ${state.checked ? `<div class="meaning-box mt-3"><span class="fw-semibold">意味（ベトナム語）:</span> ${escapeHtml(meaning)}</div>` : ""}
          <div class="d-flex flex-wrap align-items-center gap-2 mt-4">
            <button class="btn btn-primary rounded-pill px-4" type="button" data-action="check" ${state.checked ? "disabled" : ""}>答え合わせ <span class="ms-1">↵</span></button>
            ${state.checked && !state.correct ? `<button class="btn btn-outline-primary rounded-pill px-4" type="button" data-action="repair">答えを修正 <span class="ms-1">Space</span></button>` : ""}
          </div>
          ${renderNavigation()}
        </div>
      </article>`;
  }

  function render() {
    if (state.items.length === 0) return;
    content.innerHTML = state.page === "study" ? renderStudy() : renderPractice();
  }

  function checkAnswer() {
    if (state.checked) return;
    const item = currentItem();
    const matchesBefore = (variant) => state.selectedBefore.length > 0
      && state.selectedBefore.every((value) => variant.before.includes(value));
    const matchesAfter = (variant) => state.selectedAfter.length === 0
      ? variant.after.every((value) => value === "")
      : state.selectedAfter.length > 0
        && state.selectedAfter.every((value) => variant.after.includes(value))
        && variant.after.some((value) => value !== "");
    const exactVariant = item.variants.find((variant) => matchesBefore(variant) && matchesAfter(variant));

    if (exactVariant) {
      state.correct = true;
      state.evaluation = { variant: exactVariant, beforeCorrect: true, afterCorrect: true, pairMismatch: false };
    } else {
      let best = null;
      let bestScore = -1;
      for (const variant of item.variants) {
        const validBefore = variant.before.filter((value) => value !== "");
        const validAfter = variant.after.filter((value) => value !== "");
        const matchingBefore = state.selectedBefore.filter((value) => validBefore.includes(value));
        const matchingAfter = state.selectedAfter.filter((value) => validAfter.includes(value));
        const beforeCorrect = state.selectedBefore.length > 0
          && matchingBefore.length === state.selectedBefore.length;
        const afterCorrect = state.selectedAfter.length === 0
          ? validAfter.length === 0
          : state.selectedAfter.length > 0
            && matchingAfter.length === state.selectedAfter.length
            && validAfter.length > 0;
        const score = matchingBefore.length + matchingAfter.length
          + Number(state.selectedAfter.length === 0 && validAfter.length === 0);
        if (score > bestScore) {
          best = { variant, beforeCorrect, afterCorrect };
          bestScore = score;
        }
      }
      state.correct = false;
      state.evaluation = {
        ...best,
        pairMismatch: Boolean(best?.beforeCorrect && best?.afterCorrect) === false
          && item.variants.some((variant) => matchesBefore(variant))
          && item.variants.some((variant) => matchesAfter(variant))
      };
    }

    state.checked = true;
    render();
    showAnswerToast(state.correct);
  }

  function repairAnswer() {
    if (!state.checked || state.correct || !state.evaluation?.variant) return;
    const variant = state.evaluation.variant;
    const beforeValues = variant.before.filter((value) => value !== "");
    const afterValues = variant.after.filter((value) => value !== "");
    const beforeNeedsRepair = beforeValues.length !== state.selectedBefore.length
      || beforeValues.some((value) => !state.selectedBefore.includes(value))
      || state.selectedBefore.some((value) => !beforeValues.includes(value));
    const afterNeedsRepair = afterValues.length !== state.selectedAfter.length
      || afterValues.some((value) => !state.selectedAfter.includes(value))
      || state.selectedAfter.some((value) => !afterValues.includes(value));

    state.repaired = {
      before: beforeNeedsRepair,
      after: afterNeedsRepair
    };
    state.selectedBefore = [...beforeValues];
    state.selectedAfter = [...afterValues];
    state.correct = state.selectedBefore.length > 0
      && state.selectedBefore.every((value) => variant.before.includes(value))
      && (afterValues.length === 0
        ? state.selectedAfter.length === 0
        : state.selectedAfter.length > 0 && state.selectedAfter.every((value) => afterValues.includes(value)));
    state.evaluation = {
      variant,
      beforeCorrect: state.selectedBefore.length > 0 && state.selectedBefore.every((value) => variant.before.includes(value)),
      afterCorrect: afterValues.length === 0
        ? state.selectedAfter.length === 0
        : state.selectedAfter.length > 0 && state.selectedAfter.every((value) => afterValues.includes(value)),
      pairMismatch: false
    };
    render();
    showAnswerToast(state.correct);
    window.setTimeout(() => {
      state.repaired = { before: false, after: false };
      content.querySelectorAll(".repair-highlight").forEach((button) => button.classList.remove("repair-highlight"));
    }, 500);
  }

  function handleClick(event) {
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      setPage(pageButton.dataset.page);
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const { action } = button.dataset;
    if (action === "previous") navigate(-1);
    else if (action === "next") navigate(1);
    else if (action === "check") checkAnswer();
    else if (action === "repair") repairAnswer();
    else if ((action === "choose-before" || action === "choose-after") && !state.checked) {
      const isBefore = action === "choose-before";
      const selected = isBefore ? state.selectedBefore : state.selectedAfter;
      const choices = isBefore ? state.beforeChoices : state.afterChoices;
      const index = Number(button.dataset.value);
      const value = choices[index];
      if (isBefore) {
        state.selectedBefore = selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value];
      } else {
        state.selectedAfter = selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value];
      }
      render();
    } else if ((action === "remove-before" || action === "remove-after") && !state.checked) {
      const isBefore = action === "remove-before";
      const selected = isBefore ? state.selectedBefore : state.selectedAfter;
      const choices = isBefore ? state.beforeChoices : state.afterChoices;
      const index = Number(button.dataset.value);
      if (isBefore) {
        state.selectedBefore = selected.filter((value) => value !== choices[index]);
      } else {
        state.selectedAfter = selected.filter((value) => value !== choices[index]);
      }
      render();
    }
  }

  function handleKeydown(event) {
    const target = event.target;
    const isEditable = target instanceof HTMLElement
      && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (isEditable || event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "ArrowRight") {
      if (state.index < state.items.length - 1) {
        event.preventDefault();
        navigate(1);
      }
    } else if (event.key === "ArrowLeft") {
      if (state.index > 0) {
        event.preventDefault();
        navigate(-1);
      }
    } else if (state.page === "practice" && event.key === "Enter") {
      if (!state.checked) {
        event.preventDefault();
        checkAnswer();
      }
    } else if (state.page === "practice" && event.code === "Space" && state.checked && !state.correct) {
      event.preventDefault();
      repairAnswer();
    }
  }

  async function loadData() {
    try {
      const response = await fetch("./grammar-data.json");
      if (!response.ok) throw new Error(`サーバーからエラーが返されました（${response.status}）。`);
      state.items = normalizeData(await response.json());
      if (state.items.length === 0) throw new Error("文法項目がありません。");
      state.beforeChoices = uniqueChoices(state.items, "before");
      state.afterChoices = uniqueChoices(state.items, "after");
      render();
    } catch (error) {
      console.error("文法データを読み込めません:", error);
      content.innerHTML = `
        <div class="alert alert-danger w-100" role="alert">
          <h2 class="h5">文法データを読み込めません</h2>
          <p class="mb-2">${escapeHtml(error instanceof Error ? error.message : "不明なエラーが発生しました。")}</p>
          <p class="mb-0">プロジェクトフォルダーで静的ファイルサーバーを起動してください。例:
            <code>python3 -m http.server 8000</code> を実行し、<code>http://localhost:8000</code> を開きます。</p>
        </div>`;
    }
  }

  content.addEventListener("click", handleClick);
  pageButtons.forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });
  document.addEventListener("keydown", handleKeydown);
  loadData();
})();
