const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';

function normalizePath(path) {
  return path.startsWith('/') ? path : `/${path}`;
}

function buildUrl(base, path) {
  const normalizedPath = normalizePath(path);
  if (!base) return normalizedPath;
  return `${base.replace(/\/$/, '')}${normalizedPath}`;
}

async function fetchAuthResponse(url, options) {
  return fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
  });
}

export async function fetchAuthEndpoint(path, options = {}) {
  const normalizedPath = normalizePath(path);

  const localResponse = await fetchAuthResponse(normalizedPath, options);
  if (localResponse.status !== 404) {
    return localResponse;
  }

  if (!BACKEND_URL) {
    return localResponse;
  }

  try {
    const backendResponse = await fetchAuthResponse(buildUrl(BACKEND_URL, normalizedPath), options);
    const backendContentType = backendResponse.headers.get('content-type') || '';

    if (backendResponse.status === 404 && !backendContentType.includes('application/json')) {
      return localResponse;
    }

    return backendResponse;
  } catch {
    return localResponse;
  }
}
