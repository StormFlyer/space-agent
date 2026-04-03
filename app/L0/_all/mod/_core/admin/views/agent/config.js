export const ADMIN_CHAT_CONFIG_PATH = "~/conf/admin-chat.yaml";
export const ADMIN_CHAT_HISTORY_PATH = "~/hist/admin-chat.json";

export const DEFAULT_ADMIN_CHAT_SETTINGS = {
  apiEndpoint: "https://openrouter.ai/api/v1/chat/completions",
  apiKey: "",
  model: "openai/gpt-5.4-mini",
  paramsText: "temperature:0.2"
};
