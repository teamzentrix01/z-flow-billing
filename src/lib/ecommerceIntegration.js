function integrationConfig() {
  const configuredBaseUrl = String(
    process.env.ECOMMERCE_API_BASE_URL || "",
  ).trim();
  const key = process.env.ECOMMERCE_INTEGRATION_KEY || "";
  if (!configuredBaseUrl || key.length < 24) {
    throw new Error("Ecommerce integration is not configured");
  }
  const urlValue = /^https?:\/\//i.test(configuredBaseUrl)
    ? configuredBaseUrl
    : `https://${configuredBaseUrl}`;
  let baseUrl;
  try {
    const parsedUrl = new URL(urlValue);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
    baseUrl = parsedUrl.toString().replace(/\/$/, "");
  } catch {
    throw new Error("ECOMMERCE_API_BASE_URL must be a valid HTTP(S) URL");
  }
  return { baseUrl, key };
}

export async function callEcommerce(path, options = {}) {
  const config = integrationConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-tbm-integration-key": config.key,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.message || "Ecommerce request failed");
    error.status = response.status;
    throw error;
  }
  return payload.data || payload;
}
