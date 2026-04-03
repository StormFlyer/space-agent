export const DEFAULT_ADMIN_SYSTEM_PROMPT_PATH = "/mod/_core/admin/views/agent/system-prompt.md";

let defaultSystemPromptPromise = null;

function normalizeSystemPrompt(systemPrompt = "") {
  return typeof systemPrompt === "string" ? systemPrompt.trim() : "";
}

async function loadDefaultSystemPrompt() {
  const response = await fetch(DEFAULT_ADMIN_SYSTEM_PROMPT_PATH);

  if (!response.ok) {
    throw new Error(`Unable to load the default admin system prompt (${response.status}).`);
  }

  const prompt = normalizeSystemPrompt(await response.text());

  if (!prompt) {
    throw new Error("The default admin system prompt file is empty.");
  }

  return prompt;
}

export async function fetchDefaultAdminSystemPrompt(options = {}) {
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && defaultSystemPromptPromise) {
    return defaultSystemPromptPromise;
  }

  defaultSystemPromptPromise = loadDefaultSystemPrompt().catch((error) => {
    defaultSystemPromptPromise = null;
    throw error;
  });

  return defaultSystemPromptPromise;
}
