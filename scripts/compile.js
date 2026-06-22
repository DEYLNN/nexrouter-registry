import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJsonSafe(path) {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[compiler] Failed to load ${path}:`, err.message);
    return {};
  }
}

const PROVIDER_FILES = [
  join(__dirname, "../src/providers/apikey.json"),
  join(__dirname, "../src/providers/oauth.json"),
  join(__dirname, "../src/providers/public.json"),
  join(__dirname, "../src/providers/custom.json"),
];

console.log("🚀 Compiling Provider Registry...");

let rawProviders = {};
for (const file of PROVIDER_FILES) {
  const data = loadJsonSafe(file);
  if (data && typeof data === "object") {
    const count = Object.keys(data).length;
    console.log(`  - Loaded ${count} providers from ${file.split("/").pop()}`);
    Object.assign(rawProviders, data);
  }
}

const rawModels = loadJsonSafe(join(__dirname, "../src/models.json"));
const rawPricing = loadJsonSafe(join(__dirname, "../src/pricing.json"));

const registry = {};

for (const [id, data] of Object.entries(rawProviders)) {
  const provider = { ...data };
  
  // Attach models for this provider if defined
  const alias = data.alias;
  if (rawModels[alias]) {
    provider.models = rawModels[alias];
  } else if (rawModels[id]) {
    provider.models = rawModels[id];
  }

  // Attach pricing if exists
  if (provider.models) {
    provider.models = provider.models.map(model => {
      const priced = { ...model };
      if (rawPricing[model.id]) {
        priced.pricing = rawPricing[model.id];
      }
      return priced;
    });
  }

  registry[id] = provider;
}

const output = {
  version: "1.0.0",
  updated: new Date().toISOString().split("T")[0],
  providers: registry
};

const outputPath = join(__dirname, "../provider-registry.json");
writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

console.log(`\n✅ Compiled successfully! Saved to: ${outputPath}`);
console.log(`   Total providers: ${Object.keys(registry).length}`);
