export const ONSCREEN_AGENT_CONFIG_PATH = "~/conf/onscreen-agent.yaml";
export const ONSCREEN_AGENT_HISTORY_PATH = "~/hist/onscreen-agent.json";
export const DEFAULT_ONSCREEN_AGENT_MAX_TOKENS = 64_000;

export const DEFAULT_ONSCREEN_AGENT_SETTINGS = {
  apiEndpoint: "https://openrouter.ai/api/v1/chat/completions",
  apiKey: "",
  maxTokens: DEFAULT_ONSCREEN_AGENT_MAX_TOKENS,
  model: "openai/gpt-5.4-mini",
  paramsText: "temperature:0.2"
};

function normalizeOnscreenAgentSettingText(value) {
  return String(value ?? "").trim();
}

export function isDefaultOnscreenAgentLlmSettings(settings) {
  const normalizedSettings = settings && typeof settings === "object" ? settings : {};

  return (
    normalizeOnscreenAgentSettingText(normalizedSettings.apiEndpoint) ===
      normalizeOnscreenAgentSettingText(DEFAULT_ONSCREEN_AGENT_SETTINGS.apiEndpoint) &&
    normalizeOnscreenAgentSettingText(normalizedSettings.model) ===
      normalizeOnscreenAgentSettingText(DEFAULT_ONSCREEN_AGENT_SETTINGS.model) &&
    normalizeOnscreenAgentMaxTokens(normalizedSettings.maxTokens) === DEFAULT_ONSCREEN_AGENT_SETTINGS.maxTokens &&
    normalizeOnscreenAgentSettingText(normalizedSettings.paramsText) ===
      normalizeOnscreenAgentSettingText(DEFAULT_ONSCREEN_AGENT_SETTINGS.paramsText)
  );
}

export function normalizeOnscreenAgentHistoryHeight(value) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.round(parsedValue);
}

function normalizeMaxTokensText(value) {
  return String(value ?? "")
    .trim()
    .replace(/[,_\s]+/gu, "");
}

export function parseOnscreenAgentMaxTokens(value) {
  const normalizedValue = normalizeMaxTokensText(value);

  if (!normalizedValue) {
    return DEFAULT_ONSCREEN_AGENT_MAX_TOKENS;
  }

  if (!/^\d+$/u.test(normalizedValue)) {
    throw new Error("Max tokens must be a positive whole number.");
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    throw new Error("Max tokens must be a positive whole number.");
  }

  return parsedValue;
}

export function normalizeOnscreenAgentMaxTokens(value) {
  try {
    return parseOnscreenAgentMaxTokens(value);
  } catch {
    return DEFAULT_ONSCREEN_AGENT_MAX_TOKENS;
  }
}

export function formatOnscreenAgentTokenCount(tokenCount) {
  const normalizedCount = Number.isFinite(tokenCount) ? Math.max(0, Math.round(tokenCount)) : 0;

  if (normalizedCount > 100_000) {
    return `${Math.round(normalizedCount / 1000)}k`;
  }

  if (normalizedCount > 1000) {
    return `${(normalizedCount / 1000).toFixed(1)}k`;
  }

  return String(normalizedCount);
}
