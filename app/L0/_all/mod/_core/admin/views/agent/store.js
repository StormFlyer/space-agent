import * as agentApi from "/mod/_core/admin/views/agent/api.js";
import * as execution from "/mod/_core/admin/views/agent/execution.js";
import * as llmParams from "/mod/_core/admin/views/agent/llm-params.js";
import * as prompt from "/mod/_core/admin/views/agent/prompt.js";
import * as storage from "/mod/_core/admin/views/agent/storage.js";
import * as agentView from "/mod/_core/admin/views/agent/view.js";

function createMessage(role, content, options = {}) {
  return {
    content,
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind: typeof options.kind === "string" ? options.kind : "",
    role
  };
}

function createStreamingAssistantMessage() {
  return {
    ...createMessage("assistant", ""),
    streaming: true
  };
}

function normalizeStoredMessage(message) {
  return {
    content: typeof message?.content === "string" ? message.content : "",
    id: typeof message?.id === "string" ? message.id : `${message?.role || "message"}-${Date.now()}`,
    kind: typeof message?.kind === "string" ? message.kind : "",
    role: message?.role === "assistant" ? "assistant" : "user",
    streaming: message?.streaming === true
  };
}

function openDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    return;
  }

  dialog.setAttribute("open", "open");
}

function closeDialog(dialog) {
  if (!dialog) {
    return;
  }

  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }

  dialog.removeAttribute("open");
}

function findConversationInputMessage(history, assistantMessageId) {
  const assistantMessageIndex = history.findIndex((message) => message.id === assistantMessageId && message.role === "assistant");

  if (assistantMessageIndex === -1) {
    return null;
  }

  for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
    const message = history[index];

    if (message.role !== "user") {
      continue;
    }

    if (isExecutionFollowUpKind(message.kind)) {
      continue;
    }

    return message;
  }

  return null;
}

function formatPromptHistoryText(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return "";
  }

  return messages
    .map((message) => {
      const role = typeof message?.role === "string" ? message.role.toUpperCase() : "UNKNOWN";
      const content = typeof message?.content === "string" ? message.content : "";
      return `${role}:\n${content}`;
    })
    .join("\n\n");
}

const MAX_PROTOCOL_RETRY_COUNT = 2;

function summarizeProtocolMessage(message, maxLength = 280) {
  const normalizedMessage = typeof message === "string" ? message.replace(/\s+/g, " ").trim() : "";

  if (normalizedMessage.length <= maxLength) {
    return normalizedMessage;
  }

  return `${normalizedMessage.slice(0, maxLength - 3)}...`;
}

function isExecutionFollowUpKind(kind) {
  return kind === "execution-output" || kind === "execution-retry";
}

function executionResultHasUsableOutput(result) {
  if (result?.error) {
    return true;
  }

  if (result?.result !== undefined) {
    return true;
  }

  return Array.isArray(result?.logs) && result.logs.length > 0;
}

function executionResultsNeedReturnedValue(results) {
  if (!Array.isArray(results) || !results.length) {
    return false;
  }

  return results.every((result) => !executionResultHasUsableOutput(result));
}

function buildMissingExecutionResultRetryMessage(executionOutputText) {
  const summarizedOutput = summarizeProtocolMessage(executionOutputText);

  return [
    "Protocol correction: the last browser execution finished but returned no result.",
    `Execution output: "${summarizedOutput}"`,
    "Space Agent already runs your JavaScript inside an async function.",
    "Use top-level await directly and end with a top-level return for the value you need.",
    "Do not wrap the whole snippet in an async IIFE like `(async () => { ... })()` unless you also return it.",
    "Execute again now. Do not stop until you have a result or a clear error."
  ].join("\n");
}

function buildEmptyAssistantRetryMessage(executionOutputText) {
  const summarizedOutput = summarizeProtocolMessage(executionOutputText);

  return [
    "Protocol correction: your last reply after browser execution was empty.",
    `Execution output: "${summarizedOutput}"`,
    "Read the execution output and continue.",
    "If another browser step is needed, execute again now.",
    "Do not stop until you provide a user-facing answer or a clear error."
  ].join("\n");
}

const model = {
  defaultSystemPrompt: "",
  draft: "",
  executionContext: null,
  executionOutputOverrides: Object.create(null),
  history: [],
  historyPersistPromise: null,
  initializationPromise: null,
  isInitialized: false,
  isLoadingDefaultSystemPrompt: false,
  isSending: false,
  pendingHistorySnapshot: null,
  promptHistoryMessages: [],
  promptHistoryMode: "text",
  promptHistoryTitle: "Prompt History",
  rawOutputContent: "",
  rawOutputTitle: "Raw LLM Output",
  refs: {
    historyDialog: null,
    input: null,
    rawDialog: null,
    scroller: null,
    settingsDialog: null,
    systemDialog: null,
    thread: null
  },
  rerunningMessageId: "",
  settings: {
    apiEndpoint: "",
    apiKey: "",
    model: "",
    paramsText: ""
  },
  settingsDraft: {
    apiEndpoint: "",
    apiKey: "",
    model: "",
    paramsText: ""
  },
  status: "Loading admin agent...",
  systemPrompt: "",
  systemPromptDraft: "",

  get composerPlaceholder() {
    const statusText = typeof this.status === "string" ? this.status.trim() : "";

    if (!statusText) {
      return "Message Admin agent...";
    }

    return statusText === "Ready." ? "Ready. Message Admin agent..." : statusText;
  },

  get isComposerInputDisabled() {
    return !this.isInitialized;
  },

  get isComposerSubmitDisabled() {
    return !this.isInitialized || this.isSending || this.isLoadingDefaultSystemPrompt || !this.draft.trim();
  },

  get llmSummary() {
    return agentView.summarizeLlmConfig(this.settings.apiEndpoint, this.settings.model);
  },

  get promptSummary() {
    return agentView.summarizeSystemPrompt(this.systemPrompt);
  },

  get promptHistoryContent() {
    if (this.promptHistoryMode === "json") {
      return JSON.stringify(this.promptHistoryMessages, null, 2);
    }

    return formatPromptHistoryText(this.promptHistoryMessages);
  },

  get promptHistorySections() {
    if (!Array.isArray(this.promptHistoryMessages) || !this.promptHistoryMessages.length) {
      return [];
    }

    return this.promptHistoryMessages.map((message) => ({
      content: typeof message?.content === "string" ? message.content : "",
      role: typeof message?.role === "string" ? message.role.toUpperCase() : "UNKNOWN"
    }));
  },

  async init() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      this.executionContext = execution.createExecutionContext({
        targetWindow: window
      });

      try {
        const [config, storedHistory] = await Promise.all([
          storage.loadAdminChatConfig(),
          storage.loadAdminChatHistory()
        ]);

        this.settings = {
          ...config.settings
        };
        this.settingsDraft = {
          ...this.settings
        };
        this.systemPrompt = config.systemPrompt;
        this.systemPromptDraft = config.systemPrompt;
        this.history = storedHistory.map((message) => normalizeStoredMessage(message));

        this.status = this.systemPrompt.trim() ? "Ready." : "Loading default system prompt...";

        if (!this.systemPrompt.trim()) {
          this.isLoadingDefaultSystemPrompt = true;
        }

        await this.ensureDefaultSystemPrompt({
          preserveStatus: Boolean(this.systemPrompt.trim())
        });

        this.isInitialized = true;
        this.render();
        this.focusInput();
      } catch (error) {
        this.status = error.message;
        this.render();
      }
    })();

    return this.initializationPromise;
  },

  mount(refs = {}) {
    this.refs = {
      historyDialog: refs.historyDialog || null,
      input: refs.input || null,
      rawDialog: refs.rawDialog || null,
      scroller: refs.scroller || null,
      settingsDialog: refs.settingsDialog || null,
      systemDialog: refs.systemDialog || null,
      thread: refs.thread || null
    };

    if (this.refs.input) {
      this.refs.input.value = this.draft;
      agentView.autoResizeTextarea(this.refs.input);
    }

    this.render();
    void this.init();
  },

  unmount() {
    this.refs = {
      historyDialog: null,
      input: null,
      rawDialog: null,
      scroller: null,
      settingsDialog: null,
      systemDialog: null,
      thread: null
    };
  },

  async ensureDefaultSystemPrompt(options = {}) {
    const shouldReplaceSystemPrompt = options.replaceCurrent === true;
    const preserveStatus = options.preserveStatus === true;

    if (!this.defaultSystemPrompt || options.forceRefresh === true) {
      this.isLoadingDefaultSystemPrompt = true;

      try {
        this.defaultSystemPrompt = await prompt.fetchDefaultAdminSystemPrompt({
          forceRefresh: options.forceRefresh
        });
      } finally {
        this.isLoadingDefaultSystemPrompt = false;
      }
    }

    if (shouldReplaceSystemPrompt || !this.systemPrompt.trim()) {
      this.systemPrompt = this.defaultSystemPrompt;
      this.systemPromptDraft = this.defaultSystemPrompt;
    }

    if (!preserveStatus) {
      this.status = "Ready.";
    }

    return this.defaultSystemPrompt;
  },

  serializeHistory() {
    return this.history.map((message) => ({
      content: message.content,
      id: message.id,
      kind: message.kind || "",
      role: message.role
    }));
  },

  async flushHistoryPersistence() {
    if (this.historyPersistPromise) {
      return this.historyPersistPromise;
    }

    this.historyPersistPromise = (async () => {
      while (this.pendingHistorySnapshot) {
        const snapshot = this.pendingHistorySnapshot;
        this.pendingHistorySnapshot = null;
        await storage.saveAdminChatHistory(snapshot);
      }
    })()
      .catch((error) => {
        this.status = error.message;
      })
      .finally(() => {
        this.historyPersistPromise = null;

        if (this.pendingHistorySnapshot) {
          void this.flushHistoryPersistence();
        }
      });

    return this.historyPersistPromise;
  },

  async persistHistory(options = {}) {
    this.pendingHistorySnapshot = this.serializeHistory();
    const flushPromise = this.flushHistoryPersistence();

    if (options.immediate === true) {
      await flushPromise;

      if (this.pendingHistorySnapshot) {
        await this.flushHistoryPersistence();
      }
    }
  },

  render(options = {}) {
    agentView.renderMessages(this.refs.thread, this.history, {
      emptyStateText:
        "Admin agent is ready for recovery and repair tasks. Settings persist in ~/conf/admin-chat.yaml and chat history persists in ~/hist/admin-chat.json.",
      isConversationBusy: this.isSending,
      outputOverrides: this.executionOutputOverrides,
      preserveScroll: options.preserveScroll === true,
      rerunningMessageId: this.rerunningMessageId,
      scroller: this.refs.scroller
    });
  },

  focusInput() {
    const input = this.refs.input;

    if (!input || input.disabled) {
      return;
    }

    window.requestAnimationFrame(() => {
      try {
        input.focus({
          preventScroll: true
        });
      } catch {
        input.focus();
      }

      if (typeof input.setSelectionRange === "function") {
        const cursorPosition = input.value.length;
        input.setSelectionRange(cursorPosition, cursorPosition);
      }
    });
  },

  syncDraft(value) {
    this.draft = value;

    if (this.refs.input) {
      agentView.autoResizeTextarea(this.refs.input);
    }
  },

  handleDraftInput(event) {
    this.syncDraft(event.target.value);
  },

  handleComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.submitMessage();
    }
  },

  openSystemDialog() {
    this.systemPromptDraft = this.systemPrompt || this.defaultSystemPrompt;
    openDialog(this.refs.systemDialog);
  },

  closeSystemDialog() {
    closeDialog(this.refs.systemDialog);
  },

  async loadDefaultSystemPromptIntoEditor() {
    this.status = "Loading default system prompt...";

    try {
      const defaultSystemPrompt = await this.ensureDefaultSystemPrompt({
        forceRefresh: true,
        preserveStatus: true,
        replaceCurrent: false
      });
      this.systemPromptDraft = defaultSystemPrompt;
      this.status = "Default system prompt loaded into the editor.";
    } catch (error) {
      this.status = error.message;
    }
  },

  async persistConfig(options = {}) {
    await storage.saveAdminChatConfig({
      defaultSystemPrompt: options.defaultSystemPrompt || this.defaultSystemPrompt,
      settings: this.settings,
      systemPrompt: this.systemPrompt
    });
  },

  async saveSystemPromptFromDialog() {
    const defaultPrompt = typeof this.defaultSystemPrompt === "string" ? this.defaultSystemPrompt.trim() : "";
    const draftPrompt = typeof this.systemPromptDraft === "string" ? this.systemPromptDraft.trim() : "";

    if (!draftPrompt || (defaultPrompt && draftPrompt === defaultPrompt)) {
      this.systemPrompt = this.defaultSystemPrompt;
      this.systemPromptDraft = this.defaultSystemPrompt;

      try {
        await this.persistConfig({
          defaultSystemPrompt: this.defaultSystemPrompt
        });
        this.status = "System prompt reset to default.";
        this.closeSystemDialog();
      } catch (error) {
        this.status = error.message;
      }

      return;
    }

    this.systemPrompt = this.systemPromptDraft;

    try {
      await this.persistConfig();
      this.status = "Custom system prompt updated.";
      this.closeSystemDialog();
    } catch (error) {
      this.status = error.message;
    }
  },

  openSettingsDialog() {
    this.settingsDraft = {
      ...this.settings
    };
    openDialog(this.refs.settingsDialog);
  },

  closeSettingsDialog() {
    closeDialog(this.refs.settingsDialog);
  },

  openRawDialogForMessage(messageId) {
    const message = this.history.find((entry) => entry.id === messageId && entry.role === "assistant");

    if (!message) {
      this.status = "That assistant message is no longer available.";
      return;
    }

    this.rawOutputTitle = "Raw LLM Output";
    this.rawOutputContent = typeof message.content === "string" ? message.content : "";
    openDialog(this.refs.rawDialog);
  },

  closeRawDialog() {
    closeDialog(this.refs.rawDialog);
  },

  openPromptHistoryDialog() {
    this.promptHistoryTitle = "Full Prompt History";
    this.promptHistoryMessages = agentApi.buildAdminAgentPromptMessages(this.systemPrompt, this.history);
    this.promptHistoryMode = "text";
    openDialog(this.refs.historyDialog);
  },

  closePromptHistoryDialog() {
    closeDialog(this.refs.historyDialog);
  },

  setPromptHistoryMode(mode) {
    this.promptHistoryMode = mode === "json" ? "json" : "text";
  },

  async copyPromptHistory() {
    const copied = await agentView.copyTextToClipboard(this.promptHistoryContent || "");
    this.status = copied ? "Prompt history copied." : "Unable to copy prompt history.";
  },

  async saveSettingsFromDialog() {
    const paramsText = typeof this.settingsDraft.paramsText === "string" ? this.settingsDraft.paramsText.trim() : "";

    try {
      llmParams.parseAdminAgentParamsText(paramsText);
    } catch (error) {
      this.status = error.message;
      return;
    }

    this.settings = {
      apiEndpoint: (this.settingsDraft.apiEndpoint || "").trim(),
      apiKey: (this.settingsDraft.apiKey || "").trim(),
      model: (this.settingsDraft.model || "").trim(),
      paramsText
    };

    try {
      await this.persistConfig();
      this.status = "LLM settings updated.";
      this.closeSettingsDialog();
    } catch (error) {
      this.status = error.message;
    }
  },

  async handleClearClick() {
    this.closeRawDialog();
    this.rawOutputContent = "";
    this.history = [];
    this.executionOutputOverrides = Object.create(null);

    await this.persistHistory({
      immediate: true
    });

    if (this.executionContext) {
      this.executionContext.reset();
    }

    this.render();
    this.status = "Admin chat cleared and execution context reset.";
  },

  async streamAssistantResponse(requestMessages, assistantMessage) {
    this.status = "Streaming response...";

    await agentApi.streamAdminAgentCompletion({
      settings: this.settings,
      systemPrompt: this.systemPrompt,
      messages: requestMessages,
      onDelta: (delta) => {
        assistantMessage.content += delta;
        void this.persistHistory();
        this.render();
      }
    });

    assistantMessage.streaming = false;
    await this.persistHistory({
      immediate: true
    });
    this.render();
    return Boolean(assistantMessage.content.trim());
  },

  async executeAssistantBlocks(assistantContent) {
    const executionResults = await this.executionContext.executeFromContent(assistantContent, {
      onBeforeBlock: async ({ index, total }) => {
        if (!total) {
          return;
        }

        this.status =
          total === 1 ? "Executing browser code..." : `Executing browser code (${index + 1}/${total})...`;
      }
    });

    if (!executionResults.length) {
      return null;
    }

    return executionResults;
  },

  async runConversationLoop(initialUserMessage) {
    let nextUserMessage = initialUserMessage;
    let emptyAssistantRetryCount = 0;
    let missingExecutionResultRetryCount = 0;

    while (nextUserMessage) {
      const requestMessages =
        this.history[this.history.length - 1]?.id === nextUserMessage.id
          ? [...this.history]
          : [...this.history, nextUserMessage];
      const assistantMessage = createStreamingAssistantMessage();

      this.history = [...requestMessages, assistantMessage];
      void this.persistHistory();
      this.render();

      try {
        const hasAssistantContent = await this.streamAssistantResponse(requestMessages, assistantMessage);

        if (!hasAssistantContent) {
          if (isExecutionFollowUpKind(nextUserMessage.kind) && emptyAssistantRetryCount < MAX_PROTOCOL_RETRY_COUNT) {
            emptyAssistantRetryCount += 1;
            this.history = requestMessages;
            await this.persistHistory({
              immediate: true
            });
            this.render();
            nextUserMessage = createMessage("user", buildEmptyAssistantRetryMessage(nextUserMessage.content), {
              kind: "execution-retry"
            });
            this.status = "Retrying: assistant reply was empty after execution...";
            continue;
          }

          assistantMessage.content = "[No content returned]";
          await this.persistHistory({
            immediate: true
          });
          this.render();
          return;
        }
      } catch (error) {
        assistantMessage.streaming = false;

        if (!assistantMessage.content.trim()) {
          this.history = requestMessages;
        }

        await this.persistHistory({
          immediate: true
        });
        this.render();
        throw error;
      }

      emptyAssistantRetryCount = 0;
      const executionResults = await this.executeAssistantBlocks(assistantMessage.content);

      if (!executionResults || !executionResults.length) {
        return;
      }

      const executionOutputMessage = createMessage("user", execution.formatExecutionResultsMessage(executionResults), {
        kind: "execution-output"
      });
      this.history = [...this.history, executionOutputMessage];
      await this.persistHistory({
        immediate: true
      });
      this.render();

      if (
        executionResultsNeedReturnedValue(executionResults) &&
        missingExecutionResultRetryCount < MAX_PROTOCOL_RETRY_COUNT
      ) {
        missingExecutionResultRetryCount += 1;
        nextUserMessage = createMessage("user", buildMissingExecutionResultRetryMessage(executionOutputMessage.content), {
          kind: "execution-retry"
        });
        this.status = "Retrying: browser code returned no result...";
        continue;
      }

      missingExecutionResultRetryCount = 0;
      nextUserMessage = executionOutputMessage;
      this.status = "Sending code execution output...";
    }
  },

  async submitMessage() {
    if (this.isSending) {
      return;
    }

    await this.init();

    if (this.isLoadingDefaultSystemPrompt) {
      this.status = "Loading default system prompt...";
      return;
    }

    const messageText = this.draft.trim();

    if (!messageText) {
      return;
    }

    this.isSending = true;
    const userMessage = createMessage("user", messageText);

    this.draft = "";

    if (this.refs.input) {
      this.refs.input.value = "";
      agentView.autoResizeTextarea(this.refs.input);
    }

    try {
      await this.runConversationLoop(userMessage);
      this.status = "Ready.";
    } catch (error) {
      this.status = error.message;
    } finally {
      this.isSending = false;
      this.render();
      this.focusInput();
    }
  },

  async handleThreadClick(event) {
    const messageActionButton = event.target.closest("[data-message-action]");

    if (messageActionButton && this.refs.thread && this.refs.thread.contains(messageActionButton)) {
      const action = messageActionButton.dataset.messageAction;
      const messageId = messageActionButton.dataset.messageId;

      if (action === "show-raw" && messageId) {
        this.openRawDialogForMessage(messageId);
        return;
      }

      if (action === "copy-message" && messageId) {
        const copyPayload = agentView.getAssistantMessageCopyText(this.history, messageId, this.executionOutputOverrides);
        const copied = copyPayload.text ? await agentView.copyTextToClipboard(copyPayload.text) : false;
        this.status = copied
          ? copyPayload.kind === "result"
            ? "Result copied."
            : "Response copied."
          : "Unable to copy response.";
      }

      return;
    }

    const actionButton = event.target.closest("[data-terminal-action]");

    if (!actionButton || !this.refs.thread || !this.refs.thread.contains(actionButton)) {
      return;
    }

    const action = actionButton.dataset.terminalAction;
    const messageId = actionButton.dataset.terminalMessageId;

    if (!action || !messageId) {
      return;
    }

    const section = agentView.findExecuteSection(this.history, messageId, this.executionOutputOverrides);

    if (!section) {
      this.status = "That execution step is no longer available.";
      return;
    }

    if (action === "copy-input") {
      const copied = await agentView.copyTextToClipboard(agentView.getTerminalInputText(section.executeDisplay));
      this.status = copied ? "Input copied." : "Unable to copy input.";
      return;
    }

    if (action === "copy-output") {
      if (!Array.isArray(section.outputResults) || !section.outputResults.length) {
        this.status = "No execution output to copy yet.";
        return;
      }

      const outputText = agentView.getTerminalOutputText(section.outputResults);
      const copied = outputText ? await agentView.copyTextToClipboard(outputText) : false;
      this.status = copied ? "Output copied." : "Unable to copy output.";
      return;
    }

    if (action !== "rerun" || this.isSending) {
      return;
    }

    actionButton.blur?.();
    this.isSending = true;
    this.rerunningMessageId = messageId;

    try {
      const executionResults = await this.executeAssistantBlocks(section.message.content);

      if (!executionResults || !executionResults.length) {
        this.status = "No execution code found to rerun.";
        return;
      }

      this.executionOutputOverrides[messageId] = execution.createExecutionOutputSnapshots(executionResults);
      this.status = "Execution refreshed.";
    } catch (error) {
      this.status = error.message;
    } finally {
      this.isSending = false;
      this.rerunningMessageId = "";
      this.render({
        preserveScroll: true
      });
    }
  }
};

const adminAgent = space.fw.createStore("adminAgent", model);

export { adminAgent };
