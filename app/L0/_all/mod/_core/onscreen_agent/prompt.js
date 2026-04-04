import * as skills from "/mod/_core/onscreen_agent/skills.js";

export const DEFAULT_ONSCREEN_AGENT_SYSTEM_PROMPT_PATH = "/mod/_core/onscreen_agent/system-prompt.md";
export const ONSCREEN_AGENT_HISTORY_COMPACT_MODE = Object.freeze({
  AUTOMATIC: "automatic",
  USER: "user"
});
export const ONSCREEN_AGENT_HISTORY_COMPACT_PROMPT_PATH = "/mod/_core/onscreen_agent/compact-prompt.md";
export const ONSCREEN_AGENT_HISTORY_AUTO_COMPACT_PROMPT_PATH =
  "/mod/_core/onscreen_agent/compact-prompt-auto.md";

let defaultSystemPromptPromise = null;
const compactPromptPromises = {
  [ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC]: null,
  [ONSCREEN_AGENT_HISTORY_COMPACT_MODE.USER]: null
};

function normalizeSystemPrompt(systemPrompt = "") {
  return typeof systemPrompt === "string" ? systemPrompt.trim() : "";
}

function formatCustomUserInstructions(systemPrompt = "") {
  const customPrompt = normalizeSystemPrompt(systemPrompt);

  if (!customPrompt) {
    return "";
  }

  return `## User specific instructions\n\n${customPrompt}`;
}

function stripDefaultPromptPrefix(storedPrompt, defaultSystemPrompt) {
  const normalizedStoredPrompt = normalizeSystemPrompt(storedPrompt);
  const normalizedDefaultPrompt = normalizeSystemPrompt(defaultSystemPrompt);

  if (!normalizedStoredPrompt) {
    return "";
  }

  if (!normalizedDefaultPrompt) {
    return normalizedStoredPrompt;
  }

  if (normalizedStoredPrompt === normalizedDefaultPrompt) {
    return "";
  }

  if (!normalizedStoredPrompt.startsWith(normalizedDefaultPrompt)) {
    return normalizedStoredPrompt;
  }

  return normalizedStoredPrompt.slice(normalizedDefaultPrompt.length).replace(/^\s+/u, "").trim();
}

function normalizePromptSections(sections) {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections
    .map((section) => normalizeSystemPrompt(section))
    .filter(Boolean);
}

async function loadPromptFile(promptPath, promptLabel) {
  const response = await fetch(promptPath);

  if (!response.ok) {
    throw new Error(`Unable to load the ${promptLabel} (${response.status}).`);
  }

  const prompt = normalizeSystemPrompt(await response.text());

  if (!prompt) {
    throw new Error(`The ${promptLabel} file is empty.`);
  }

  return prompt;
}

function normalizeHistoryCompactMode(mode = ONSCREEN_AGENT_HISTORY_COMPACT_MODE.USER) {
  return mode === ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
    ? ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC
    : ONSCREEN_AGENT_HISTORY_COMPACT_MODE.USER;
}

function resolveHistoryCompactPromptConfig(mode) {
  if (mode === ONSCREEN_AGENT_HISTORY_COMPACT_MODE.AUTOMATIC) {
    return {
      label: "onscreen agent automatic history compact prompt",
      path: ONSCREEN_AGENT_HISTORY_AUTO_COMPACT_PROMPT_PATH
    };
  }

  return {
    label: "onscreen agent history compact prompt",
    path: ONSCREEN_AGENT_HISTORY_COMPACT_PROMPT_PATH
  };
}

export const fetchDefaultOnscreenAgentSystemPrompt = globalThis.space.extend(
  import.meta,
  async function fetchDefaultOnscreenAgentSystemPrompt(options = {}) {
    const forceRefresh = options.forceRefresh === true;

    if (!forceRefresh && defaultSystemPromptPromise) {
      return defaultSystemPromptPromise;
    }

    defaultSystemPromptPromise = loadPromptFile(
      DEFAULT_ONSCREEN_AGENT_SYSTEM_PROMPT_PATH,
      "default onscreen agent system prompt"
    ).catch((error) => {
      defaultSystemPromptPromise = null;
      throw error;
    });

    return defaultSystemPromptPromise;
  }
);

export const fetchOnscreenAgentHistoryCompactPrompt = globalThis.space.extend(
  import.meta,
  async function fetchOnscreenAgentHistoryCompactPrompt(options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const mode = normalizeHistoryCompactMode(options.mode);

    if (!forceRefresh && compactPromptPromises[mode]) {
      return compactPromptPromises[mode];
    }

    const promptConfig = resolveHistoryCompactPromptConfig(mode);
    compactPromptPromises[mode] = loadPromptFile(promptConfig.path, promptConfig.label).catch((error) => {
      compactPromptPromises[mode] = null;
      throw error;
    });

    return compactPromptPromises[mode];
  }
);

export function extractCustomOnscreenAgentSystemPrompt(storedPrompt = "", defaultSystemPrompt = "") {
  return stripDefaultPromptPrefix(storedPrompt, defaultSystemPrompt);
}

const buildOnscreenAgentSystemPromptSections = globalThis.space.extend(
  import.meta,
  async function buildOnscreenAgentSystemPromptSections(context = {}) {
    const basePrompt = normalizeSystemPrompt(
      context.defaultSystemPrompt || (await fetchDefaultOnscreenAgentSystemPrompt())
    );
    const customPrompt = formatCustomUserInstructions(context.systemPrompt);
    const skillsSection = await skills.buildOnscreenSkillsPromptSection();
    const automaticallyLoadedSkillsSection =
      await skills.buildOnscreenAutomaticallyLoadedSkillsPromptSection();

    return {
      ...context,
      automaticallyLoadedSkillsSection,
      basePrompt,
      customPrompt,
      sections: [basePrompt, customPrompt, skillsSection, automaticallyLoadedSkillsSection].filter(
        Boolean
      ),
      skillsSection
    };
  }
);

export const buildRuntimeOnscreenAgentSystemPrompt = globalThis.space.extend(
  import.meta,
  async function buildRuntimeOnscreenAgentSystemPrompt(systemPrompt = "", options = {}) {
    const promptContext = await buildOnscreenAgentSystemPromptSections({
      defaultSystemPrompt: options.defaultSystemPrompt,
      options,
      systemPrompt
    });

    return normalizePromptSections(promptContext?.sections).join("\n\n");
  }
);
