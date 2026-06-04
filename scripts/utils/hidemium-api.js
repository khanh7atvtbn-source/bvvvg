const http = require("http");
const https = require("https");
const config = require("../../config/config");

const HIDEMIUM_API_HELPER_VERSION = "2026-06-02-short-retry-recovery";

function getApiUrls() {
  if (config.hidemium.apiUrl) return [config.hidemium.apiUrl];
  return ["http://127.0.0.1:2222", "http://127.0.0.1:5555"];
}

function requestJson(url, timeout = config.timeouts.default) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(
      parsed,
      { method: "GET", timeout },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let data = body;
          if (body) {
            try {
              data = JSON.parse(body);
            } catch (_) {
              // Keep raw body when Hidemium returns plain text.
            }
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}: ${body}`));
            return;
          }

          resolve(data);
        });
      },
    );

    request.on("timeout", () =>
      request.destroy(new Error(`Timeout khi goi ${url}`)),
    );
    request.on("error", reject);
    request.end();
  });
}

function parseErrorPayload(error) {
  try {
    const jsonPart = String(error.message || "").replace(/^HTTP\s\d+:\s*/, "");
    return JSON.parse(jsonPart);
  } catch (_) {
    return null;
  }
}

async function hidemiumGet(pathName, params = {}) {
  const errors = [];

  for (const apiUrl of getApiUrls()) {
    const url = new URL(pathName, apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    try {
      return { apiUrl, url: url.toString(), data: await requestJson(url.toString()) };
    } catch (error) {
      const parsed = parseErrorPayload(error);
      if (parsed && (parsed.status === "error" || parsed.data)) {
        return { apiUrl, url: url.toString(), data: parsed };
      }
      errors.push(`${apiUrl}: ${error.message}`);
    }
  }

  throw new Error(`Khong goi duoc Hidemium API. Da thu: ${errors.join(" | ")}`);
}

function getUuid(account) {
  return account && (account.hidemiumUuid || account.uuid || account.profileUuid);
}

function getMessage(data) {
  return (
    data &&
    ((data.data && data.data.message) || data.message || data.status || "")
  );
}

function getRemotePort(data) {
  return data && data.data && (data.data.remote_port || data.data.remotePort);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOpeningMessage(message) {
  return String(message || "").toLowerCase().includes("opening");
}

async function getProfileByUuid(uuid, isLocal = true) {
  return hidemiumGet(`v2/browser/get-profile-by-uuid/${uuid}`, {
    is_local: isLocal ? "true" : "false",
  });
}

async function openProfile(account) {
  const uuid = getUuid(account);
  if (!uuid) throw new Error(`Account "${account.name}" chua co UUID Hidemium.`);

  const command = account.hidemiumCommand || config.hidemium.command;
  const proxy = account.hidemiumProxy || "";
  const variants = [
    { uuid, command, proxy },
    { id: uuid, command, proxy },
    { profile_uuid: uuid, command, proxy },
  ];
  const errors = new Set();
  const maxAttempts = Number(config.hidemium.openMaxAttempts || 4);
  const retryDelay = Number(config.hidemium.openRetryDelayMs || 1500);
  const recoveryDelay = Number(config.hidemium.openRecoveryDelayMs || 2500);

  async function tryOpen(params, attempt, phase) {
    const response = await hidemiumGet("openProfile", params);
    const message = getMessage(response.data);
    const remotePort = getRemotePort(response.data);
    const status = String(response.data.status || "").toLowerCase();

    if (remotePort || status === "success") {
      return { ...response, uuid, remotePort, message, attempt, phase };
    }

    if (message) errors.add(message);
    else errors.add(JSON.stringify(response.data));

    return {
      isOpening: isOpeningMessage(message),
      message,
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let shouldRetry = false;

    for (const params of variants) {
      const result = await tryOpen(params, attempt, "normal");
      if (result && result.data) return result;
      if (result.isOpening) {
        shouldRetry = true;
      }
    }

    if (!shouldRetry || attempt === maxAttempts) {
      break;
    }

    await sleep(retryDelay * attempt);
  }

  if ([...errors].some(isOpeningMessage)) {
    let closeError = null;
    await closeProfile(account).catch((error) => {
      closeError = error;
    });

    if (closeError) {
      throw new Error(
        `Hidemium profile ${uuid} dang bi ket o trang thai opening va API closeProfile cung fail. Hay dong profile trong Hidemium hoac restart Hidemium roi bam Open lai. Chi tiet: ${closeError.message}`,
      );
    }

    await sleep(recoveryDelay);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await tryOpen({ id: uuid, command, proxy }, attempt, "recovery");
      if (result && result.data) return result;
      if (!result.isOpening) break;
      await sleep(retryDelay * attempt);
    }
  }

  throw new Error(
    `Khong mo duoc Hidemium profile ${uuid}: ${[...errors].join(" | ")}`,
  );
}

async function closeProfile(account) {
  const uuid = getUuid(account);
  if (!uuid) throw new Error(`Account "${account.name}" chua co UUID Hidemium.`);
  const response = await hidemiumGet("closeProfile", { uuid });
  const message = getMessage(response.data);
  const status = String(response.data.status || response.data.type || "").toLowerCase();
  const isSuccess =
    status === "success" ||
    String(message || "").toLowerCase().includes("success") ||
    String(message || "").toLowerCase().includes("closed");

  if (!isSuccess && String(message || "").toLowerCase().includes("fail")) {
    throw new Error(`Khong dong duoc Hidemium profile ${uuid}: ${message}`);
  }

  return { ...response, uuid, message };
}

async function checkProfile(account) {
  const uuid = getUuid(account);
  if (!uuid) throw new Error(`Account "${account.name}" chua co UUID Hidemium.`);
  const local = await getProfileByUuid(uuid, true).catch((error) => ({
    error: error.message,
  }));
  const remote = await getProfileByUuid(uuid, false).catch((error) => ({
    error: error.message,
  }));
  return { uuid, local, remote };
}

module.exports = {
  HIDEMIUM_API_HELPER_VERSION,
  checkProfile,
  closeProfile,
  getApiUrls,
  getProfileByUuid,
  getRemotePort,
  hidemiumGet,
  openProfile,
};
