/**
 * @nexrouter/provider-registry
 * 
 * Single source of truth for all provider metadata.
 * Used by both frontend (UI/icons/labels) and backend (routing/config).
 * 
 * Error isolation: if one provider entry is malformed, it gets skipped
 * with a warning — the rest of the registry loads fine.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load raw JSON with error isolation per-provider ──────────────────

function loadJsonSafe(filename) {
  try {
    const raw = readFileSync(join(__dirname, filename), "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[registry] Failed to load ${filename}:`, err.message);
    return {};
  }
}

// ── Load providers from split files with error isolation ────────────
// Structure: providers/apikey.json, providers/oauth.json, providers/public.json, providers/custom.json

const PROVIDER_FILES = [
  "providers/apikey.json",    // API key providers (majority)
  "providers/oauth.json",     // OAuth device flow providers
  "providers/public.json",    // Public/free providers (no auth)
  "providers/custom.json",    // Custom auth providers
];

let rawProviders = {};
for (const file of PROVIDER_FILES) {
  const data = loadJsonSafe(file);
  if (data && typeof data === "object") {
    const count = Object.keys(data).length;
    if (count > 0) {
      console.log(`[registry] 📄 ${file}: ${count} provider(s)`);
    }
    Object.assign(rawProviders, data);
  }
}
const rawModels     = loadJsonSafe("models.json");
const rawPricing   = loadJsonSafe("pricing.json");

// ── Validate individual provider entries ────────────────────────────

const VALID_TYPES = ["api-key", "oauth", "public", "cookie", "custom"];
const VALID_FORMATS = [
  "openai", "claude", "gemini", "gemini-cli", "openai-responses",
  "kiro", "cursor", "antigravity", "ollama", "vertex",
  "commandcode", "grok-web", "perplexity-web"
];

function validateProvider(id, data) {
  const errors = [];

  if (!data.id || typeof data.id !== "string")
    errors.push("missing or invalid 'id'");
  if (!data.name || typeof data.name !== "string")
    errors.push("missing or invalid 'name'");
  if (!data.alias || typeof data.alias !== "string")
    errors.push("missing or invalid 'alias'");
  if (!data.type || !VALID_TYPES.includes(data.type))
    errors.push(`invalid type '${data.type}' (expected one of: ${VALID_TYPES.join(", ")})`);
  if (!data.format || !VALID_FORMATS.includes(data.format))
    errors.push(`invalid format '${data.format}'`);
  if (data.type !== "public" && !data.baseUrl)
    errors.push("missing 'baseUrl' (required for non-public providers)");

  // OAuth must have oauth config
  if (data.type === "oauth") {
    if (!data.oauth?.clientId)
      errors.push("OAuth provider missing 'oauth.clientId'");
    if (!data.oauth?.tokenUrl)
      errors.push("OAuth provider missing 'oauth.tokenUrl'");
  }

  return errors;
}

// ── Build validated registry with error isolation ───────────────────

const providers = {};
const models    = {};
const pricing   = rawPricing;  // pricing is flat model→price, no provider validation needed
const errors    = [];
const warnings  = [];

for (const [id, data] of Object.entries(rawProviders)) {
  try {
    const validationErrors = validateProvider(id, data);
    
    if (validationErrors.length > 0) {
      errors.push({ provider: id, errors: validationErrors });
      console.warn(`[registry] ⚠️  Provider '${id}' skipped: ${validationErrors.join(", ")}`);
      continue;  // Skip this provider, don't crash
    }

    providers[id] = data;

    // Load models for this provider (by alias)
    const alias = data.alias;
    if (rawModels[alias]) {
      models[alias] = rawModels[alias];
    } else if (rawModels[id]) {
      models[id] = rawModels[id];
    } else {
      warnings.push(`Provider '${id}' (alias: ${alias}) has no models defined`);
    }

  } catch (err) {
    errors.push({ provider: id, errors: [err.message] });
    console.warn(`[registry] ⚠️  Provider '${id}' crashed during load:`, err.message);
  }
}

// ── Summary ─────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.warn(`[registry] ${errors.length} provider(s) failed validation`);
}
if (warnings.length > 0) {
  console.warn(`[registry] ${warnings.length} warning(s): ${warnings.join("; ")}`);
}

const loaded = Object.keys(providers).length;
const total = Object.keys(rawProviders).length;
console.log(`[registry] ✅ ${loaded}/${total} providers loaded`);

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get all validated providers
 */
export function getProviders() {
  return { ...providers };
}

/**
 * Get a single provider by ID. Returns undefined if not found or invalid.
 */
export function getProvider(id) {
  return providers[id];
}

/**
 * Get all models for a provider alias
 */
export function getModels(alias) {
  return models[alias] || [];
}

/**
 * Get all models (all providers)
 */
export function getAllModels() {
  return { ...models };
}

/**
 * Get pricing for a specific model ID
 */
export function getPricing(modelId) {
  return pricing[modelId] || null;
}

/**
 * Get all pricing data
 */
export function getAllPricing() {
  return { ...pricing };
}

/**
 * Get validation errors from the last load
 */
export function getErrors() {
  return [...errors];
}

/**
 * Get backend-compatible provider config (baseUrl, format, headers, etc.)
 * This is what the Hono server needs for routing.
 */
export function getBackendConfig(id) {
  const p = providers[id];
  if (!p) return null;

  const config = {
    baseUrl: p.baseUrl,
    format: p.format,
  };

  if (p.headers) config.headers = { ...p.headers };
  if (p.noAuth) config.noAuth = true;
  if (p.oauth) {
    config.clientId = p.oauth.clientId;
    config.tokenUrl = p.oauth.tokenUrl;
    if (p.oauth.clientSecret) config.clientSecret = p.oauth.clientSecret;
    if (p.oauth.authUrl) config.authUrl = p.oauth.authUrl;
  }
  if (p.retry) config.retry = p.retry;
  if (p.baseUrls) config.baseUrls = p.baseUrls;

  return config;
}

/**
 * Get frontend-compatible provider config (UI display data)
 * This is what the Next.js frontend needs for rendering.
 */
export function getFrontendConfig(id) {
  const p = providers[id];
  if (!p) return null;

  return {
    id: p.id,
    alias: p.alias,
    name: p.name,
    icon: p.icon,
    iconPath: p.iconPath,
    color: p.color,
    textIcon: p.textIcon,
    website: p.website,
    noAuth: p.noAuth || false,
    notice: p.notice,
    serviceKinds: p.serviceKinds || ["llm"],
    thinkingConfig: p.thinkingConfig,
    passthroughModels: p.passthroughModels,
    modelsFetcher: p.modelsFetcher,
    ttsConfig: p.ttsConfig,
    sttConfig: p.sttConfig,
    embeddingConfig: p.embeddingConfig,
    searchConfig: p.searchConfig,
    imageConfig: p.imageConfig,
    searchViaChat: p.searchViaChat,
  };
}

// ── Default export (convenience) ────────────────────────────────────

export default {
  providers,
  models,
  pricing,
  errors,
  getProviders,
  getProvider,
  getModels,
  getAllModels,
  getPricing,
  getAllPricing,
  getErrors,
  getBackendConfig,
  getFrontendConfig,
};
