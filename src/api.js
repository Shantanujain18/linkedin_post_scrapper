import { API_BASE_URL } from "./config.js";
import { getValidAccessToken, refreshStoredSession } from "./auth.js";
import { getExtensionVersion } from "./version.js";

function extensionHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "X-ReachPod-Extension-Version": getExtensionVersion(),
    ...extra
  };
}

function unreachableError(networkError) {
  const isLocal = /localhost|127\.0\.0\.1/.test(API_BASE_URL);
  const err = new Error(
    isLocal
      ? `Cannot reach ReachPod at ${API_BASE_URL}. Start the web app (npm run dev -- -p 3002), then reload the extension.`
      : `Cannot reach ReachPod at ${API_BASE_URL}. Check that the site is up and try again.`
  );
  err.status = 0;
  err.cause = networkError;
  return err;
}

function versionErrorFromBody(body, status) {
  if (
    status !== 426 &&
    body?.code !== "EXTENSION_VERSION_MISMATCH" &&
    body?.code !== "EXTENSION_VERSION_REQUIRED"
  ) {
    return null;
  }
  const err = new Error(
    body?.message ||
      body?.error ||
      `Update ReachPod to version ${body?.required_version || "latest"} to continue.`
  );
  err.status = status || 426;
  err.code = body?.code || "EXTENSION_VERSION_MISMATCH";
  err.body = body;
  err.required_version = body?.required_version || "";
  err.update_url = body?.update_url || "";
  err.installed_version = body?.installed_version || getExtensionVersion();
  return err;
}

async function apiFetch(path, options = {}) {
  const token = await getValidAccessToken();
  if (!token) {
    const err = new Error("Sign in required.");
    err.status = 401;
    throw err;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: extensionHeaders({
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      })
    });
  } catch (networkError) {
    throw unreachableError(networkError);
  }

  if (response.status === 401) {
    const refreshed = await refreshStoredSession();
    if (refreshed?.access_token) {
      let retry;
      try {
        retry = await fetch(`${API_BASE_URL}${path}`, {
          ...options,
          headers: extensionHeaders({
            Authorization: `Bearer ${refreshed.access_token}`,
            ...(options.headers || {})
          })
        });
      } catch (networkError) {
        throw unreachableError(networkError);
      }
      const retryBody = await retry.json().catch(() => ({}));
      const versionErr = versionErrorFromBody(retryBody, retry.status);
      if (versionErr) throw versionErr;
      if (!retry.ok) {
        const err = new Error(retryBody.error || `Request failed (${retry.status})`);
        err.status = retry.status;
        err.body = retryBody;
        throw err;
      }
      return retryBody;
    }
  }

  const body = await response.json().catch(() => ({}));
  const versionErr = versionErrorFromBody(body, response.status);
  if (versionErr) throw versionErr;
  if (!response.ok) {
    const err = new Error(body.error || `Request failed (${response.status})`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Public — no auth. Used to show update UI even before sign-in. */
export async function fetchRequiredExtensionVersion() {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/extension/version`, {
      headers: extensionHeaders()
    });
  } catch (networkError) {
    throw unreachableError(networkError);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.error || `Request failed (${response.status})`);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  const installed = getExtensionVersion().replace(/^v/i, "");
  const required = String(body.required_version || "")
    .trim()
    .replace(/^v/i, "");
  const upToDate = Boolean(required) && installed === required;

  return {
    ...body,
    installed_version: installed,
    required_version: required || body.required_version,
    up_to_date: upToDate,
    api_base_url: API_BASE_URL
  };
}

export async function fetchQuota() {
  return apiFetch("/api/scrape/quota");
}

export async function reserveQuota(requested) {
  return apiFetch("/api/scrape/reserve", {
    method: "POST",
    body: JSON.stringify({ action: "reserve", requested })
  });
}

export async function refundQuota(unused) {
  if (!unused) return null;
  return apiFetch("/api/scrape/reserve", {
    method: "POST",
    body: JSON.stringify({ action: "refund", unused })
  });
}
