const DEFAULT_ALLOWED_ORIGINS = [
  "https://pixelworkdesign.com",
  "https://www.pixelworkdesign.com",
  "https://lepokinternational-spec.github.io"
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    if (url.pathname !== "/api/projects") {
      return json({ error: "Not found" }, 404, request, env);
    }

    if (request.method === "GET") {
      return readProjects(request, env);
    }

    if (request.method === "POST") {
      return writeProjects(request, env);
    }

    return json({ error: "Method not allowed" }, 405, request, env);
  }
};

async function readProjects(request, env) {
  const response = await githubFetch(env, contentsUrl(env));
  if (!response.ok) {
    return json({ error: "Could not read projects.json" }, response.status, request, env);
  }

  const file = await response.json();
  const content = decodeBase64(file.content || "");
  return new Response(content, {
    headers: {
      ...corsHeaders(request, env),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function writeProjects(request, env) {
  const token = getBearerToken(request);
  if (!env.ADMIN_PASSCODE || token !== env.ADMIN_PASSCODE) {
    return json({ error: "Unauthorized" }, 401, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, request, env);
  }

  const clean = sanitizePayload(payload);
  if (!clean.ok) {
    return json({ error: clean.error }, 400, request, env);
  }

  const current = await githubFetch(env, contentsUrl(env));
  if (!current.ok) {
    return json({ error: "Could not read current projects.json" }, current.status, request, env);
  }

  const currentFile = await current.json();
  const content = JSON.stringify(clean.data, null, 2) + "\n";
  const body = {
    message: "Update website projects",
    content: encodeBase64(content),
    sha: currentFile.sha,
    branch: branch(env)
  };

  const update = await githubFetch(env, contentsUrl(env), {
    method: "PUT",
    body: JSON.stringify(body)
  });

  if (!update.ok) {
    const detail = await update.text();
    return json({ error: "GitHub update failed", detail }, update.status, request, env);
  }

  return json({ ok: true, projects: clean.data.projects }, 200, request, env);
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Payload must be an object" };
  }

  const details = payload.details && typeof payload.details === "object" ? payload.details : {};
  const projects = payload.projects && typeof payload.projects === "object" ? payload.projects : {};
  const cleanProjects = {};

  for (const [rawKey, rawProject] of Object.entries(projects)) {
    if (!rawProject || typeof rawProject !== "object") continue;
    const name = text(rawProject.name || rawKey, 80);
    if (!name) continue;
    const key = normalizeKey(name);
    cleanProjects[key] = {
      name,
      category: text(rawProject.category, 120),
      stage: clampStage(rawProject.stage),
      note: text(rawProject.note, 220),
      updated: text(rawProject.updated, 40),
      url: cleanUrl(rawProject.url)
    };
  }

  return {
    ok: true,
    data: {
      details: {
        email: text(details.email, 120) || "info@pixelworkdesign.com",
        phone: text(details.phone, 60),
        city: text(details.city, 80)
      },
      projects: cleanProjects
    }
  };
}

function githubFetch(env, url, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "pixelworkdesign-admin",
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {})
    }
  });
}

function contentsUrl(env) {
  const owner = env.GITHUB_OWNER || "lepokinternational-spec";
  const repo = env.GITHUB_REPO || "Pixelworkdesign";
  const path = env.PROJECTS_PATH || "projects.json";
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch(env)}`;
}

function branch(env) {
  return env.GITHUB_BRANCH || "main";
}

function getBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    "access-control-allow-origin": origin && allowed.includes(origin) ? origin : allowed[0],
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "vary": "Origin"
  };
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function text(value, max) {
  return String(value || "").trim().slice(0, max);
}

function clampStage(value) {
  const stage = Number.parseInt(value, 10);
  if (!Number.isFinite(stage)) return 1;
  return Math.min(4, Math.max(1, stage));
}

function cleanUrl(value) {
  const url = text(value, 300);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(String(value).replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
