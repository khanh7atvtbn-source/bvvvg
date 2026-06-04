const els = {
  accountInput: document.getElementById("accountInput"),
  checkHidemiumButton: document.getElementById("checkHidemiumButton"),
  clearLogButton: document.getElementById("clearLogButton"),
  closeHidemiumButton: document.getElementById("closeHidemiumButton"),
  descriptionInput: document.getElementById("descriptionInput"),
  hidemiumAccountInput: document.getElementById("hidemiumAccountInput"),
  hidemiumApiUrl: document.getElementById("hidemiumApiUrl"),
  hidemiumOutput: document.getElementById("hidemiumOutput"),
  hidemiumStatusDot: document.getElementById("hidemiumStatusDot"),
  hidemiumUuid: document.getElementById("hidemiumUuid"),
  jobStatus: document.getElementById("jobStatus"),
  logOutput: document.getElementById("logOutput"),
  madeForKidsInput: document.getElementById("madeForKidsInput"),
  metrics: document.getElementById("metrics"),
  openHidemiumButton: document.getElementById("openHidemiumButton"),
  pickFileButton: document.getElementById("pickFileButton"),
  queueBody: document.getElementById("queueBody"),
  queueCount: document.getElementById("queueCount"),
  queueForm: document.getElementById("queueForm"),
  queuePath: document.getElementById("queuePath"),
  reloadButton: document.getElementById("reloadButton"),
  resetFormButton: document.getElementById("resetFormButton"),
  scanAccountInput: document.getElementById("scanAccountInput"),
  scanFolderButton: document.getElementById("scanFolderButton"),
  scanResult: document.getElementById("scanResult"),
  scanVisibilityInput: document.getElementById("scanVisibilityInput"),
  searchInput: document.getElementById("searchInput"),
  sourceInput: document.getElementById("sourceInput"),
  startButton: document.getElementById("startButton"),
  statusFilter: document.getElementById("statusFilter"),
  stopButton: document.getElementById("stopButton"),
  titleInput: document.getElementById("titleInput"),
  toast: document.getElementById("toast"),
  visibilityInput: document.getElementById("visibilityInput"),
};

let state = null;
let editingId = null;

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSourceType() {
  return new FormData(els.queueForm).get("source_type") || "local";
}

function setSourceType(value) {
  const input = els.queueForm.querySelector(
    `input[name="source_type"][value="${value}"]`,
  );
  if (input) input.checked = true;
  els.pickFileButton.disabled = value === "url";
}

function getFormItem() {
  return {
    account: els.accountInput.value,
    source_type: getSourceType(),
    source: els.sourceInput.value,
    title: els.titleInput.value,
    description: els.descriptionInput.value,
    visibility: els.visibilityInput.value,
    madeForKids: els.madeForKidsInput.checked,
  };
}

function resetForm() {
  editingId = null;
  els.queueForm.reset();
  if (state) els.accountInput.value = state.defaultAccount;
  setSourceType("local");
  els.queueForm.querySelector('button[type="submit"]').textContent = "Add";
  els.queueForm.classList.remove("editing");
}

function renderHidemiumAccount() {
  if (!state) return;
  const account = state.accounts.find(
    (item) => item.name === els.hidemiumAccountInput.value,
  );
  els.hidemiumUuid.textContent =
    account && account.hidemiumUuid
      ? account.hidemiumUuid
      : "No UUID configured";
}

function renderAccounts(accounts, defaultAccount) {
  const options = accounts
    .map((account) => {
      const label = account.hasHidemiumUuid
        ? account.name
        : `${account.name} (no uuid)`;
      return `<option value="${escapeHtml(account.name)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  const previousHidemiumAccount = els.hidemiumAccountInput.value;
  els.accountInput.innerHTML = options;
  els.hidemiumAccountInput.innerHTML = options;
  if (els.scanAccountInput) els.scanAccountInput.innerHTML = options;
  els.accountInput.value = defaultAccount;
  els.hidemiumAccountInput.value = previousHidemiumAccount || defaultAccount;
  if (els.scanAccountInput) els.scanAccountInput.value = defaultAccount;
  renderHidemiumAccount();
}

function getStatus(item) {
  if (item.done) return { text: "Done", className: "done" };
  if (item.error) return { text: "Error", className: "error" };
  return { text: "Pending", className: "pending" };
}

function getFilteredQueue(queue) {
  const search = els.searchInput.value.trim().toLowerCase();
  const filter = els.statusFilter.value;

  return queue.filter((item) => {
    const status = getStatus(item).className;
    if (filter !== "all" && status !== filter) return false;
    if (!search) return true;

    return [
      item.id,
      item.title,
      item.source,
      item.account,
      item.visibility,
      item.privacy,
      item.error,
      item.url,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
}

function renderQueue(queue) {
  const filtered = getFilteredQueue(queue);
  els.queueCount.textContent =
    filtered.length === queue.length
      ? `${queue.length} total items`
      : `${filtered.length} of ${queue.length} items shown`;

  if (!filtered.length) {
    els.queueBody.innerHTML =
      '<tr><td class="empty" colspan="6">No matching queue items</td></tr>';
    return;
  }

  els.queueBody.innerHTML = filtered
    .map((item) => {
      const status = getStatus(item);
      const sourceLabel = item.source_type === "url" ? "URL" : "Local";
      const detail = item.error || item.url || item.source || "";
      return `
        <tr>
          <td class="id-cell">#${escapeHtml(item.id)}</td>
          <td>
            <div class="video-title">${escapeHtml(item.title)}</div>
            <div class="video-source">${escapeHtml(sourceLabel)} - ${escapeHtml(detail)}</div>
          </td>
          <td>${escapeHtml(item.account)}</td>
          <td>${escapeHtml(item.visibility || item.privacy || "private")}</td>
          <td><span class="badge ${status.className}">${status.text}</span></td>
          <td class="row-actions">
            <button type="button" data-action="edit" data-id="${escapeHtml(item.id)}">Edit</button>
            <button type="button" data-action="retry" data-id="${escapeHtml(item.id)}">Retry</button>
            <button type="button" data-action="remove" data-id="${escapeHtml(item.id)}">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderMetrics(queue) {
  const total = queue.length;
  const done = queue.filter((item) => item.done).length;
  const error = queue.filter((item) => !item.done && item.error).length;
  const pending = total - done - error;

  els.metrics.innerHTML = [
    ["Pending", pending, "pending"],
    ["Done", done, "done"],
    ["Error", error, "error"],
    ["Total", total, "total"],
  ]
    .map(
      ([label, value, className]) => `
        <div class="stat ${className}">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function render(nextState) {
  state = nextState;
  els.queuePath.textContent = nextState.paths.queuePath;
  els.jobStatus.textContent = nextState.isRunning ? "Running" : "Idle";
  els.jobStatus.classList.toggle("running", nextState.isRunning);
  els.startButton.disabled = nextState.isRunning;
  els.stopButton.disabled = !nextState.isRunning;
  els.hidemiumApiUrl.textContent = `${(nextState.hidemiumApiUrls || []).join(" | ")} - ${nextState.hidemiumApiHelperVersion || "api-helper"}`;
  renderAccounts(nextState.accounts, nextState.defaultAccount);
  renderQueue(nextState.queue);
  renderMetrics(nextState.queue);
}

async function refresh() {
  render(await window.reupApp.getState());
}

function appendLog(text) {
  els.logOutput.textContent += text;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function getDraftSources() {
  return els.sourceInput.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

  async function addDraftVideosToQueue() {
    const item = getFormItem();
    const sources = getDraftSources();

    if (sources.length === 0) {
      throw new Error("Vui long nhap duong dan hoac URL video.");
    }

    let nextState = state || (await window.reupApp.getState());
    for (const src of sources) {
      let title = els.titleInput.value.trim();
      let description = els.descriptionInput.value.trim();

      if (sources.length > 1 || !title) {
        if (item.source_type === "local") {
          const fileName = src.split(/[\\/]/).pop() || "";
          title = fileName.replace(/\.[^.]+$/, "").slice(0, 100);
        } else {
          title = `Reup URL ${src.slice(-15)}`;
        }
      }

      // Auto-generate description if empty: use file name or placeholder
      if (!description) {
        if (item.source_type === "local") {
          const fileName = src.split(/[\\/]/).pop() || "";
          description = `Video file ${fileName.replace(/\.[^.]+$/, "")}`;
        } else {
          description = `Description for URL ${src}`;
        }
      }

      nextState = await window.reupApp.addQueueItem({
        ...item,
        source: src,
        title,
        description,
      });
    }

    render(nextState);
    resetForm();
    showToast(
      sources.length > 1
        ? `Da them ${sources.length} video vao queue`
        : "Added to queue",
    );
    return nextState;
  }

function setHidemiumBusy(isBusy) {
  els.checkHidemiumButton.disabled = isBusy;
  els.openHidemiumButton.disabled = isBusy;
  els.closeHidemiumButton.disabled = isBusy;
  els.hidemiumStatusDot.classList.toggle("busy", isBusy);
}

function setHidemiumResult(result, ok = true) {
  els.hidemiumStatusDot.classList.toggle("ok", ok);
  els.hidemiumStatusDot.classList.toggle("error", !ok);
  els.hidemiumOutput.textContent =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

async function runHidemiumAction(action) {
  const accountName = els.hidemiumAccountInput.value;
  setHidemiumBusy(true);
  setHidemiumResult(`Calling Hidemium API for ${accountName}...`, true);

  try {
    const result = await action(accountName);
    setHidemiumResult(result, true);
    showToast("Hidemium API ok");
  } catch (error) {
    setHidemiumResult(error.message, false);
    showToast(error.message);
  } finally {
    setHidemiumBusy(false);
  }
}

function handleHidemiumEvent(event) {
  const label = `${event.action}:${event.account}`;
  if (event.status === "start") {
    appendLog(`[hidemium] ${label} started uuid=${event.uuid || "none"}\n`);
    return;
  }

  if (event.status === "success") {
    appendLog(`[hidemium] ${label} success\n`);
    setHidemiumResult(event.result, true);
    return;
  }

  if (event.status === "error") {
    appendLog(`[hidemium] ${label} error: ${event.error}\n`);
    setHidemiumResult(event.error, false);
  }
}

async function handleQueueAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || !state) return;

  const id = button.dataset.id;
  const action = button.dataset.action;
  const item = state.queue.find((entry) => String(entry.id) === String(id));
  if (!item) return;

  try {
    if (action === "edit") {
      editingId = id;
      setSourceType(item.source_type || "local");
      els.accountInput.value = item.account || state.defaultAccount;
      els.sourceInput.value = item.source || "";
      els.titleInput.value = item.title || "";
      els.descriptionInput.value = item.description || "";
      els.visibilityInput.value = item.visibility || item.privacy || "private";
      els.madeForKidsInput.checked = Boolean(item.madeForKids);
      els.queueForm.querySelector('button[type="submit"]').textContent = "Save";
      els.queueForm.classList.add("editing");
      els.titleInput.focus();
      return;
    }
    if (action === "retry") {
      render(await window.reupApp.retryQueueItem(id));
      showToast(`Queued #${id}`);
      return;
    }
    if (action === "remove") {
      render(await window.reupApp.removeQueueItem(id));
      showToast(`Deleted #${id}`);
    }
  } catch (error) {
    showToast(error.message);
  }
}

els.queueForm.addEventListener("change", (event) => {
  if (event.target.name === "source_type") setSourceType(event.target.value);
});

els.queueForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const item = getFormItem();
    const wasEditing = Boolean(editingId);

    if (wasEditing) {
      const nextState = await window.reupApp.updateQueueItem(editingId, item);
      render(nextState);
      resetForm();
      showToast("Saved");
    } else {
      await addDraftVideosToQueue();
      return;
      const sources = els.sourceInput.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (sources.length === 0) {
        throw new Error("Vui lòng nhập đường dẫn hoặc URL video.");
      }

      let nextState = state;
      for (const src of sources) {
        let title = els.titleInput.value.trim();

        if (sources.length > 1 || !title) {
          if (item.source_type === "local") {
            const fileName = src.split(/[\\/]/).pop() || "";
            title = fileName.replace(/\.[^.]+$/, "").slice(0, 100);
          } else {
            title = `Reup URL ${src.slice(-15)}`;
          }
        }

        const singleItem = {
          ...item,
          source: src,
          title: title,
        };

        nextState = await window.reupApp.addQueueItem(singleItem);
      }

      render(nextState);
      resetForm();
      showToast(sources.length > 1 ? `Đã thêm ${sources.length} video!` : "Added to queue");
    }
  } catch (error) {
    showToast(error.message);
  }
});

els.pickFileButton.addEventListener("click", async () => {
  const filePaths = await window.reupApp.selectVideo();
  if (!filePaths || filePaths.length === 0) return;

  if (filePaths.length === 1) {
    const filePath = filePaths[0];
    els.sourceInput.value = filePath;
    if (!els.titleInput.value.trim()) {
      const fileName = filePath.split(/[\\/]/).pop() || "";
      els.titleInput.value = fileName.replace(/\.[^.]+$/, "").slice(0, 100);
    }
  } else {
    els.sourceInput.value = filePaths.join("\n");
    els.titleInput.value = "";
    els.titleInput.placeholder = "Tiêu đề sẽ tự động lấy từ tên file";
  }
});

els.queueBody.addEventListener("click", handleQueueAction);
els.reloadButton.addEventListener("click", refresh);
els.resetFormButton.addEventListener("click", resetForm);
els.searchInput.addEventListener("input", () => {
  if (state) renderQueue(state.queue);
});
els.statusFilter.addEventListener("change", () => {
  if (state) renderQueue(state.queue);
});
els.hidemiumAccountInput.addEventListener("change", renderHidemiumAccount);
els.clearLogButton.addEventListener("click", () => {
  els.logOutput.textContent = "";
});

els.checkHidemiumButton.addEventListener("click", () => {
  runHidemiumAction((accountName) => window.reupApp.checkHidemium(accountName));
});

els.openHidemiumButton.addEventListener("click", () => {
  runHidemiumAction((accountName) =>
    window.reupApp.openHidemiumProfile(accountName),
  );
});

els.closeHidemiumButton.addEventListener("click", () => {
  runHidemiumAction((accountName) =>
    window.reupApp.closeHidemiumProfile(accountName),
  );
});

els.startButton.addEventListener("click", async () => {
  try {
    if (!editingId && getDraftSources().length > 0) {
      await addDraftVideosToQueue();
    }
    render(
      await window.reupApp.startJob({
        account: els.scanAccountInput?.value || state?.defaultAccount,
        visibility: els.scanVisibilityInput?.value || "public",
      }),
    );
  } catch (error) {
    showToast(error.message);
  }
});

els.stopButton.addEventListener("click", async () => {
  try {
    render(await window.reupApp.stopJob());
  } catch (error) {
    showToast(error.message);
  }
});

window.reupApp.onState(render);
window.reupApp.onJobLog(appendLog);
window.reupApp.onJobExit(() => refresh());
window.reupApp.onHidemiumEvent(handleHidemiumEvent);

// ── Auto-scan folder ──────────────────────────────────────────────────────────
const scanFolderBtn = document.getElementById("scanFolderButton");
const scanResult   = document.getElementById("scanResult");

if (scanFolderBtn) {
  scanFolderBtn.addEventListener("click", async () => {
    try {
      const folderPath = await window.reupApp.selectFolder();
      if (!folderPath) return;
      scanFolderBtn.disabled = true;
      if (scanResult) scanResult.textContent = "Đang quét thư mục...";
      const account    = document.getElementById("scanAccountInput")?.value || state?.defaultAccount;
      const visibility = document.getElementById("scanVisibilityInput")?.value || "private";
      const res = await window.reupApp.scanFolder({ folderPath, account, visibility });
      render(res.state);
      const msg = res.added > 0
        ? `✅ Đã thêm ${res.added}/${res.total} video vào queue (${folderPath})`
        : `ℹ️ Không có video mới (${res.total} file đã tồn tại trong queue)`;
      if (scanResult) scanResult.textContent = msg;
      showToast(msg);
    } catch (err) {
      if (scanResult) scanResult.textContent = `❌ ${err.message}`;
      showToast(err.message);
    } finally {
      scanFolderBtn.disabled = false;
    }
  });
}

refresh().catch((error) => showToast(error.message));
