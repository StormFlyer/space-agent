import { getStore } from "/mod/_core/framework/js/AlpineStore.js";

const COMPACT_DISPLAY_MODE = "compact";
const DISPLAY_MODE_TRANSIENT_HEADING = "chat display mode";
const DISPLAY_MODE_TRANSIENT_KEY = "chat-display-mode";

function buildCompactDisplayModeTransientSection() {
  return {
    content: [
      "chat is in compact mode",
      "keep replies short unless more detail is needed for correctness or the user asks for it"
    ].join("\n"),
    heading: DISPLAY_MODE_TRANSIENT_HEADING,
    key: DISPLAY_MODE_TRANSIENT_KEY,
    order: 0
  };
}

export default async function injectDisplayModeTransientSection(hookContext) {
  const promptContext = hookContext?.result;

  if (!promptContext || !Array.isArray(promptContext.sections)) {
    return;
  }

  const onscreenAgentStore = getStore("onscreenAgent");
  const displayMode = typeof onscreenAgentStore?.displayMode === "string"
    ? onscreenAgentStore.displayMode.trim()
    : "";

  promptContext.sections = promptContext.sections.filter(
    (section) => String(section?.key || "").trim() !== DISPLAY_MODE_TRANSIENT_KEY
  );

  if (displayMode !== COMPACT_DISPLAY_MODE) {
    return;
  }

  promptContext.sections = promptContext.sections.concat(buildCompactDisplayModeTransientSection());
}
