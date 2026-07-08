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

    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        return chatEstimate(request, env);
      }

      return json({ error: "Method not allowed" }, 405, request, env);
    }

    if (url.pathname === "/api/contact") {
      if (request.method === "POST") {
        return sendContactEmail(request, env);
      }

      return json({ error: "Method not allowed" }, 405, request, env);
    }

    if (url.pathname === "/api/admin-check") {
      if (request.method === "POST") {
        return checkAdminPasscode(request, env);
      }

      return json({ error: "Method not allowed" }, 405, request, env);
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

async function sendContactEmail(request, env) {
  if (!env.RESEND_API_KEY) {
    return json({ error: "Email sending is not configured" }, 500, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, request, env);
  }

  const name = text(payload.name, 100);
  const email = text(payload.email, 160);
  const message = text(payload.message, 3000);
  const budget = text(payload.budget, 80) || "Not selected";

  if (!name || !email || !message) {
    return json({ error: "Name, email, and message are required" }, 400, request, env);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid email address" }, 400, request, env);
  }

  const to = env.CONTACT_TO || "pixlworkdesign@gmail.com";
  const from = env.CONTACT_FROM || "PixelWorksDesign <onboarding@resend.dev>";
  const subject = `Website enquiry from ${name}`;
  const body = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Budget: ${budget}`,
    "",
    "Message:",
    message
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: body,
      reply_to: email
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    return json({ error: "Email send failed", detail: text(detail, 1000) }, response.status, request, env);
  }

  return json({ ok: true }, 200, request, env);
}

async function chatEstimate(request, env) {
  if (!env.OPENAI_API_KEY) {
    return json({ error: "OPENAI_API_KEY is not configured" }, 500, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, request, env);
  }

  const message = text(payload.message, 2000);
  if (!message) {
    return json({ error: "Message is required" }, 400, request, env);
  }
  const latest = text(payload.latest, 400);

  const enrichedMessage = await enrichMessageWithExample(formatChatInput(message, latest));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.2",
      instructions: [
        "You are Pixie, the helpful website planning assistant for PixelWorksDesign.",
        "Speak to ordinary business owners, not web designers. Use simple, specific English.",
        "Your job is to help the visitor understand what kind of website they need, what similar websites usually cost, and what PixelWorksDesign can realistically do for their budget.",
        "Always use GBP.",
        "If the user gives a budget at any point, do not ask for the budget again. Move forward.",
        "If the latest user message is only a number such as 5000, 5k, or 12000, treat that as their GBP budget for the earlier website idea.",
        "When a budget is given, estimate the normal UK small-agency market range for that kind of website, then compare the user's budget with that range.",
        "When giving a market range, keep it useful and not absurdly wide. A range such as GBP 8,000-12,000 is useful; GBP 2,000-50,000 is not.",
        "After the market range, explain what can realistically be built for the user's budget, what would be left out, and the likely timeline.",
        "If the user does not give a budget, ask for their budget before giving detailed scope. You may still identify the type of project and explain why it is simple or complex.",
        "If the user gives an example website, infer the likely features from it. If you cannot tell, ask for the budget and the example website URL.",
        "Known example guidance: Givver.ai, CharityExtra, JustGiving, GoFundMe, Givebutter, Crowdfunder, and Donorbox are fundraising or donation platforms, not information websites.",
        "A request like 'I want a website like givver.ai' should be treated as a crowdfunding or donation web app with campaign pages, donation/payment flow, donor records, admin tools, and possibly user accounts.",
        "For complex ideas like crowdfunding, marketplace, booking, memberships, logins, payments, dashboards, or custom platforms, say clearly that this is a custom web app and will cost more than a simple information website.",
        "Never promise a final fixed quote. Say PixelWorksDesign would confirm the final scope after reviewing the details.",
        "Keep replies under 170 words. No headings unless they make the answer clearer. Do not mention APIs, OpenAI, Cloudflare, or internal setup."
      ].join(" "),
      input: enrichedMessage,
      max_output_tokens: 450
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    return json({ error: "AI request failed", detail: text(detail, 1000) }, response.status, request, env);
  }

  const data = await response.json();
  const reply = text(data.output_text || extractOutputText(data), 1800);
  if (!reply) {
    return json({ error: "AI returned an empty reply" }, 502, request, env);
  }

  return json({ ok: true, reply }, 200, request, env);
}

function formatChatInput(message, latest) {
  if (!latest) return message;
  return `Latest user message: ${latest}\n\nFull user message history:\n${message}`;
}

async function enrichMessageWithExample(message) {
  const exampleUrl = firstUrl(message);
  if (!exampleUrl) return message;

  try {
    const response = await fetch(exampleUrl, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "PixelWorksDesign Pixie estimator"
      }
    });
    if (!response.ok) return message;

    const html = text(await response.text(), 50000);
    const title = extractTag(html, "title");
    const description = extractMetaDescription(html);
    const body = stripHtml(html).slice(0, 1200);
    const context = [
      "Example website found by Pixie:",
      `URL: ${exampleUrl}`,
      title ? `Title: ${title}` : "",
      description ? `Description: ${description}` : "",
      body ? `Visible page text sample: ${body}` : ""
    ].filter(Boolean).join("\n");

    return `${message}\n\n${context}`;
  } catch {
    return message;
  }
}

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

async function checkAdminPasscode(request, env) {
  const token = getBearerToken(request);
  if (!env.ADMIN_PASSCODE || token !== env.ADMIN_PASSCODE) {
    return json({ error: "Unauthorized" }, 401, request, env);
  }

  return json({ ok: true }, 200, request, env);
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
    const services = Array.isArray(rawProject.services)
      ? rawProject.services.map((item) => text(item, 80)).filter(Boolean).slice(0, 8)
      : [];
    cleanProjects[key] = {
      name,
      category: text(rawProject.category, 120),
      services,
      stage: clampStage(rawProject.stage),
      note: text(rawProject.note, 220),
      updated: text(rawProject.updated, 40),
      url: cleanUrl(rawProject.url),
      image: cleanImage(rawProject.image)
    };
  }

  return {
    ok: true,
    data: {
      details: {
        email: text(details.email, 120) || "pixlworkdesign@gmail.com",
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

function cleanImage(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(raw)) {
    return raw.length <= 700000 ? raw : "";
  }
  return cleanUrl(raw);
}

function firstUrl(value) {
  const raw = String(value || "");
  const match = raw.match(/\bhttps?:\/\/[^\s<>"']+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"']*)?/i);
  if (!match) return "";
  let url = match[0].replace(/[),.;!?]+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function extractTag(html, tag) {
  const match = String(html || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeHtml(stripHtml(match[1])).slice(0, 200) : "";
}

function extractMetaDescription(html) {
  const match = String(html || "").match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    || String(html || "").match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
  return match ? decodeHtml(match[1]).slice(0, 300) : "";
}

function stripHtml(html) {
  return decodeHtml(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractOutputText(data) {
  const parts = [];
  for (const item of data && data.output ? data.output : []) {
    for (const content of item && item.content ? item.content : []) {
      if (content && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
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
