import * as execution from "/mod/_core/admin/views/agent/execution.js";

const EXECUTION_STATUS_LINE_PATTERN = /^execution\s+(.+)$/iu;
const EXECUTION_PRINT_LINE_PATTERN = /^(log|info|warn|error|debug|dir|table|assert):\s*/iu;
const ORDERED_LIST_LINE_PATTERN = /^\d+\.\s+/u;
const STICKY_SCROLL_THRESHOLD = 32;
const ADMIN_AGENT_AVATAR_PATH = "/mod/_core/admin/res/helmet_no_bg_256.webp";

export function summarizeSystemPrompt(systemPrompt) {
  if (!systemPrompt.trim()) {
    return "No system prompt";
  }

  const preview = systemPrompt.trim().replace(/\s+/gu, " ");
  return preview.length > 72 ? `${preview.slice(0, 72)}...` : preview;
}

function summarizeEndpoint(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint || "Not set";
  }
}

export function summarizeLlmConfig(apiEndpoint, model) {
  const provider = summarizeEndpoint(apiEndpoint);
  const normalizedModel = typeof model === "string" ? model.trim() : "";

  if (provider && normalizedModel) {
    return `${provider}/${normalizedModel}`;
  }

  return normalizedModel || provider || "Not set";
}

export function autoResizeTextarea(textarea) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
}

function stripExecuteBlocks(content) {
  if (typeof content !== "string" || !content.trim()) {
    return "";
  }

  let stripped = content;

  execution.extractExecuteBlocks(content).forEach((block) => {
    stripped = stripped.replace(block.raw, "");
  });

  return stripped.replace(/\n{3,}/gu, "\n\n").trim();
}

function normalizeExecuteNarration(content) {
  return stripExecuteBlocks(content);
}

function parseExecuteDisplayContent(content) {
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  const executeBlocks = execution.extractExecuteBlocks(content);

  if (!executeBlocks.length) {
    return null;
  }

  let narration = content;

  executeBlocks.forEach((block) => {
    narration = narration.replace(block.raw, "");
  });

  return {
    blocks: executeBlocks.map((block) => block.code.trimEnd()),
    narration: normalizeExecuteNarration(narration)
  };
}

function parseExecutionOutputMessage(content) {
  if (typeof content !== "string") {
    return null;
  }

  const lines = content.trim().split(/\r?\n/u).map((line) => line.trimEnd());
  const results = [];
  let currentResult = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const statusMatch = line.match(EXECUTION_STATUS_LINE_PATTERN);

    if (statusMatch) {
      currentResult = {
        outputLines: [`execution ${statusMatch[1].trim()}`],
        status: statusMatch[1].trim()
      };
      results.push(currentResult);
      continue;
    }

    if (!currentResult) {
      return null;
    }

    currentResult.outputLines.push(line);
  }

  return results.length ? results : null;
}

function getExecutionOutputResults(message) {
  if (!message || message.role !== "user" || message.kind !== "execution-output") {
    return null;
  }

  return parseExecutionOutputMessage(message.content);
}

function getExecutionOutputLineModifier(line) {
  const trimmed = typeof line === "string" ? line.trim() : "";

  if (!trimmed) {
    return "is-muted";
  }

  if (/^execution\s+/iu.test(trimmed)) {
    return "is-meta";
  }

  if (/^result:\s*/iu.test(trimmed)) {
    return "is-result";
  }

  if (/^warn:\s*/iu.test(trimmed)) {
    return "is-warn";
  }

  if (/^error:\s*/iu.test(trimmed)) {
    return "is-error";
  }

  if (EXECUTION_PRINT_LINE_PATTERN.test(trimmed)) {
    return "is-print";
  }

  return "";
}

function appendTerminalLine(container, text, modifier) {
  const line = document.createElement("div");
  line.className = modifier ? `terminal-line ${modifier}` : "terminal-line";
  line.textContent = text;
  container.append(line);
}

function countCodeLines(text) {
  if (typeof text !== "string" || !text.length) {
    return 0;
  }

  return text.split("\n").length;
}

function getExecuteDisplayLineCount(executeDisplay) {
  if (!executeDisplay || !Array.isArray(executeDisplay.blocks) || !executeDisplay.blocks.length) {
    return 0;
  }

  return executeDisplay.blocks.reduce((total, block) => total + countCodeLines(block), 0);
}

function formatLineCount(lineCount) {
  return `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
}

function createTerminalOutputEntries(results, options = {}) {
  const pendingState = options.pendingState || "";

  if (!Array.isArray(results) || !results.length) {
    return [
      {
        modifier: "is-muted",
        text:
          pendingState === "generating"
            ? "Generating code..."
            : pendingState === "running"
              ? "Running..."
              : "No output yet."
      }
    ];
  }

  const entries = [];

  results.forEach((result, index) => {
    if (index > 0) {
      entries.push({
        type: "divider"
      });
    }

    const lines = Array.isArray(result?.outputLines) ? result.outputLines : [];

    lines.forEach((line) => {
      entries.push({
        modifier: getExecutionOutputLineModifier(line),
        text: line
      });
    });
  });

  return entries;
}

function appendTerminalOutput(container, results, pendingState = "") {
  createTerminalOutputEntries(results, {
    pendingState
  }).forEach((entry) => {
    if (entry.type === "divider") {
      const divider = document.createElement("div");
      divider.className = "terminal-divider";
      divider.setAttribute("aria-hidden", "true");
      container.append(divider);
      return;
    }

    appendTerminalLine(container, entry.text, entry.modifier);
  });
}

export function getTerminalInputText(executeDisplay) {
  if (!executeDisplay || !Array.isArray(executeDisplay.blocks)) {
    return "";
  }

  return executeDisplay.blocks.join("\n\n").trim();
}

export function getTerminalOutputText(results) {
  return createTerminalOutputEntries(results)
    .map((entry) => (entry.type === "divider" ? "" : entry.text))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function appendInlineFormattedText(target, text) {
  const source = String(text || "");
  const pattern = /`([^`]+)`|(https?:\/\/[^\s<]+)/gu;
  let lastIndex = 0;

  source.replace(pattern, (match, codeText, urlText, index) => {
    if (index > lastIndex) {
      target.append(document.createTextNode(source.slice(lastIndex, index)));
    }

    if (codeText) {
      const code = document.createElement("code");
      code.textContent = codeText;
      target.append(code);
    } else if (urlText) {
      const link = document.createElement("a");
      link.href = urlText;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = urlText;
      target.append(link);
    }

    lastIndex = index + match.length;
    return match;
  });

  if (lastIndex < source.length) {
    target.append(document.createTextNode(source.slice(lastIndex)));
  }
}

function appendParagraphLines(element, text) {
  const lines = String(text || "").split("\n");

  lines.forEach((line, index) => {
    if (index > 0) {
      element.append(document.createElement("br"));
    }

    appendInlineFormattedText(element, line);
  });
}

function appendTextSegment(container, text) {
  const blocks = String(text || "")
    .trim()
    .split(/\n\s*\n/gu)
    .map((block) => block.trim())
    .filter(Boolean);

  blocks.forEach((block) => {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const isUnorderedList = lines.every((line) => /^[-*]\s+/u.test(line.trim()));
    const isOrderedList = lines.every((line) => ORDERED_LIST_LINE_PATTERN.test(line.trim()));

    if (isUnorderedList || isOrderedList) {
      const list = document.createElement(isOrderedList ? "ol" : "ul");

      lines.forEach((line) => {
        const item = document.createElement("li");
        const itemText = isOrderedList ? line.trim().replace(ORDERED_LIST_LINE_PATTERN, "") : line.trim().slice(2);
        appendParagraphLines(item, itemText);
        list.append(item);
      });

      container.append(list);
      return;
    }

    const paragraph = document.createElement("p");
    appendParagraphLines(paragraph, block);
    container.append(paragraph);
  });
}

function createFormattedMessageBlock(text, className = "message-content message-markdown") {
  const normalizedText = String(text || "").trim();

  if (!normalizedText) {
    return null;
  }

  const content = document.createElement("div");
  content.className = className;
  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/gu;
  let cursor = 0;
  let match;

  while ((match = fencePattern.exec(normalizedText))) {
    const [rawMatch, language, code] = match;
    const before = normalizedText.slice(cursor, match.index);

    if (before.trim()) {
      appendTextSegment(content, before);
    }

    const pre = document.createElement("pre");
    const codeElement = document.createElement("code");

    if (language && language.trim()) {
      codeElement.className = `language-${language.trim()}`;
    }

    codeElement.textContent = code.trimEnd();
    pre.append(codeElement);
    content.append(pre);
    cursor = match.index + rawMatch.length;
  }

  const trailing = normalizedText.slice(cursor);

  if (trailing.trim()) {
    appendTextSegment(content, trailing);
  }

  return content.childNodes.length ? content : null;
}

function createMessageAvatar(role) {
  const avatar = document.createElement("div");
  avatar.className = role === "assistant" ? "message-avatar message-avatar-agent" : "message-avatar message-avatar-user";
  avatar.setAttribute("aria-hidden", "true");

  if (role === "assistant") {
    const image = document.createElement("img");
    image.src = ADMIN_AGENT_AVATAR_PATH;
    image.alt = "";
    image.loading = "lazy";
    avatar.append(image);
    return avatar;
  }

  const icon = document.createElement("x-icon");
  icon.textContent = "person";
  avatar.append(icon);
  return avatar;
}

function createAssistantMessageActionButton({ action, disabled = false, iconName, messageId, title }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "assistant-message-action";
  button.dataset.messageAction = action;
  button.dataset.messageId = messageId;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = disabled;

  const icon = document.createElement("x-icon");
  icon.textContent = iconName;
  button.append(icon);
  return button;
}

function createMessageAccessory(role) {
  const accessory = document.createElement("div");
  accessory.className = role === "assistant" ? "message-accessory" : "message-accessory message-accessory-user";
  accessory.append(createMessageAvatar(role));
  return accessory;
}

function createMessageRow(role, bubble, extraClassName = "") {
  const row = document.createElement("div");
  row.className = extraClassName ? `message-row ${role} ${extraClassName}` : `message-row ${role}`;
  row.append(createMessageAccessory(role), bubble);
  return row;
}

function formatExecutionSummaryLabel(lineCount, pendingState = "", results = []) {
  const lineLabel = lineCount ? formatLineCount(lineCount) : "code";

  if (pendingState === "generating") {
    return `Writing ${lineLabel} of code`;
  }

  if (pendingState === "running") {
    return `Executing ${lineLabel} of code`;
  }

  if (Array.isArray(results) && results.length) {
    const hasError = results.some((result) => String(result?.status || "").trim().toLowerCase() === "error");
    return `Executed ${lineLabel} of code - ${hasError ? "Error" : "Success"}`;
  }

  return `Executed ${lineLabel}`;
}

function getExecutionSummaryState(results, pendingState = "") {
  if (pendingState === "generating") {
    return {
      iconName: "edit_note",
      tone: "is-writing"
    };
  }

  if (pendingState === "running") {
    return {
      iconName: "sync",
      tone: "is-running"
    };
  }

  const normalizedResults = Array.isArray(results) ? results : [];
  const hasError = normalizedResults.some((result) => String(result?.status || "").trim().toLowerCase() === "error");

  if (hasError) {
    return {
      iconName: "error",
      tone: "is-error"
    };
  }

  if (normalizedResults.length) {
    return {
      iconName: "check_circle",
      tone: "is-success"
    };
  }

  return {
    iconName: "schedule",
      tone: "is-pending"
    };
}

function createAssistantMessageActionRow(message, outputResults = null) {
  const actions = document.createElement("div");
  actions.className = "assistant-message-actions";
  actions.append(
    createAssistantMessageActionButton({
      action: "show-raw",
      disabled: !message.content,
      iconName: "data_object",
      messageId: message.id,
      title: "Show raw output"
    }),
    createAssistantMessageActionButton({
      action: "copy-message",
      disabled: !message.content && (!Array.isArray(outputResults) || !outputResults.length),
      iconName: "content_copy",
      messageId: message.id,
      title: "Copy response or result"
    })
  );
  return actions;
}

function createExecutionPane({ body, label, scrollKey = "" }) {
  const pane = document.createElement("div");
  pane.className = "execution-pane";

  const paneLabel = document.createElement("span");
  paneLabel.className = "execution-pane-label";
  paneLabel.textContent = label;

  const paneBody = document.createElement("div");
  paneBody.className = "execution-pane-scroll";

  if (scrollKey) {
    paneBody.dataset.scrollKey = scrollKey;
  }

  if (body) {
    paneBody.append(body);
  }

  pane.append(paneLabel, paneBody);
  return pane;
}

function createExecutionRerunButton({ disabled = false, isActive = false, messageId }) {
  return createExecutionDetailButton({
    action: "rerun",
    active: isActive,
    disabled,
    iconName: isActive ? "sync" : "replay",
    label: isActive ? "Running" : "Run again",
    messageId
  });
}

function createExecutionDetailButton({ action, active = false, disabled = false, iconName, label, messageId }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "execution-detail-button";
  button.dataset.terminalAction = action;
  button.dataset.terminalMessageId = messageId;
  button.disabled = disabled;

  if (active) {
    button.classList.add("is-active");
  }

  const icon = document.createElement("x-icon");
  icon.textContent = iconName;

  const labelElement = document.createElement("span");
  labelElement.textContent = label;

  button.append(icon, labelElement);
  return button;
}

function createExecutionCard({ executeDisplay, isConversationBusy, isStreaming, messageId, outputResults, rerunningMessageId }) {
  const lineCount = getExecuteDisplayLineCount(executeDisplay);
  const displayOutputResults = rerunningMessageId === messageId ? null : outputResults;
  const pendingState = isStreaming
    ? "generating"
    : rerunningMessageId === messageId || (!displayOutputResults && isConversationBusy)
      ? "running"
      : "";
  const summaryState = getExecutionSummaryState(displayOutputResults, pendingState);
  const terminal = document.createElement("details");
  terminal.className = "execution-card";
  terminal.dataset.executionCard = "true";

  if (messageId) {
    terminal.dataset.executionMessageId = messageId;
  }

  const summary = document.createElement("summary");
  summary.className = "execution-summary";

  const summaryMain = document.createElement("div");
  summaryMain.className = "execution-summary-main";

  const status = document.createElement("span");
  status.className = `execution-status ${summaryState.tone}`;

  const statusIcon = document.createElement("x-icon");
  statusIcon.textContent = summaryState.iconName;
  status.append(statusIcon);

  const summaryText = document.createElement("div");
  summaryText.className = "execution-summary-text";

  const summaryTitle = document.createElement("span");
  summaryTitle.className = "execution-summary-title";
  summaryTitle.textContent = formatExecutionSummaryLabel(lineCount, pendingState, displayOutputResults);

  summaryText.append(summaryTitle);
  summaryMain.append(status, summaryText);

  const summaryChevron = document.createElement("x-icon");
  summaryChevron.className = "execution-summary-chevron";
  summaryChevron.textContent = "chevron_right";

  summary.append(summaryMain, summaryChevron);
  terminal.append(summary);

  const details = document.createElement("div");
  details.className = "execution-details";

  if (executeDisplay) {
    const inputBody = document.createElement("div");
    inputBody.className = "execution-code-list";

    executeDisplay.blocks.forEach((block) => {
      const inputBlock = document.createElement("pre");
      inputBlock.className = "terminal-code";
      inputBlock.textContent = block || (isStreaming ? "" : "[empty]");
      inputBody.append(inputBlock);
    });

    details.append(
      createExecutionPane({
        body: inputBody,
        label: lineCount ? `Input • ${formatLineCount(lineCount)}` : "Input",
        scrollKey: messageId ? `${messageId}:input` : ""
      })
    );
  }

  const outputBody = document.createElement("div");
  outputBody.className = "execution-output-list";
  appendTerminalOutput(outputBody, displayOutputResults || [], pendingState);

  details.append(
    createExecutionPane({
      body: outputBody,
      label: "Output",
      scrollKey: messageId ? `${messageId}:output` : ""
    })
  );

  if (executeDisplay && messageId) {
    const actions = document.createElement("div");
    actions.className = "execution-details-actions";
    actions.append(
      createExecutionDetailButton({
        action: "copy-input",
        disabled: !getTerminalInputText(executeDisplay),
        iconName: "content_copy",
        label: "Input",
        messageId
      }),
      createExecutionDetailButton({
        action: "copy-output",
        disabled: !Array.isArray(displayOutputResults) || !displayOutputResults.length,
        iconName: "content_copy",
        label: "Output",
        messageId
      }),
      createExecutionRerunButton({
        disabled: isConversationBusy || isStreaming || !getTerminalInputText(executeDisplay),
        isActive: rerunningMessageId === messageId,
        messageId
      })
    );
    details.append(actions);
  }

  terminal.append(details);
  return terminal;
}

function createStandardMessageBubble(message) {
  const bubble = document.createElement("article");
  bubble.className = "message-bubble";

  if (message.streaming) {
    bubble.classList.add("is-streaming");
  }

  if (message.role === "assistant") {
    bubble.classList.add("assistant-message-shell");
    const contentBlock = createFormattedMessageBlock(message.content || (message.streaming ? "Streaming..." : ""));

    if (contentBlock) {
      bubble.append(contentBlock);
    }

    bubble.append(createAssistantMessageActionRow(message));
    return bubble;
  }

  const textBlock = document.createElement("p");
  textBlock.className = "message-content";
  textBlock.textContent = message.content || (message.streaming ? "Streaming..." : "");
  bubble.append(textBlock);
  return bubble;
}

function createAssistantSequenceBubble(group, options = {}) {
  const bubble = document.createElement("article");
  bubble.className = "message-bubble";

  if (group.sections.some((section) => Boolean(section.message.streaming))) {
    bubble.classList.add("is-streaming");
  }

  group.sections.forEach((section) => {
    const sectionElement = document.createElement("div");
    sectionElement.className = "assistant-sequence-section assistant-message-shell";

    if (section.type === "execute") {
      if (section.executeDisplay.narration) {
        const narrationBlock = createFormattedMessageBlock(
          section.executeDisplay.narration,
          "message-content message-markdown terminal-note"
        );

        if (narrationBlock) {
          sectionElement.append(narrationBlock);
        }
      }

      sectionElement.append(
        createExecutionCard({
          executeDisplay: section.executeDisplay,
          isConversationBusy: options.isConversationBusy,
          isStreaming: Boolean(section.message.streaming),
          messageId: section.message.id,
          outputResults: section.outputResults,
          rerunningMessageId: options.rerunningMessageId
        })
      );

      sectionElement.append(createAssistantMessageActionRow(section.message, section.outputResults));
    } else {
      sectionElement.classList.add("is-followup");
      const followupBlock = createFormattedMessageBlock(
        section.message.content || (section.message.streaming ? "Streaming..." : ""),
        "message-content message-markdown terminal-followup"
      );

      if (followupBlock) {
        sectionElement.append(followupBlock);
      }

      sectionElement.append(createAssistantMessageActionRow(section.message));
    }

    bubble.append(sectionElement);
  });

  return bubble;
}

function createStandaloneExecutionOutputBubble(outputResults, messageId = "") {
  const bubble = document.createElement("article");
  bubble.className = "message-bubble is-terminal-output";
  bubble.append(
    createExecutionCard({
      executeDisplay: null,
      isConversationBusy: false,
      isStreaming: false,
      messageId,
      outputResults,
      rerunningMessageId: ""
    })
  );
  return bubble;
}

function getDocumentScroller() {
  return document.scrollingElement || document.documentElement;
}

function getMaxScrollTop(element) {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function getMaxScrollLeft(element) {
  return Math.max(0, element.scrollWidth - element.clientWidth);
}

function isNearBottom(element) {
  return getMaxScrollTop(element) - element.scrollTop <= STICKY_SCROLL_THRESHOLD;
}

function createScrollSnapshot(element, options = {}) {
  if (!element) {
    return null;
  }

  return {
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    stickyBottom: options.forcePreserve === true ? false : isNearBottom(element)
  };
}

function restoreScrollSnapshot(element, snapshot, options = {}) {
  if (!element || !snapshot) {
    return;
  }

  element.scrollLeft = Math.min(snapshot.scrollLeft, getMaxScrollLeft(element));

  if (options.forcePreserve === true || !snapshot.stickyBottom) {
    element.scrollTop = Math.min(snapshot.scrollTop, getMaxScrollTop(element));
    return;
  }

  element.scrollTop = getMaxScrollTop(element);
}

function captureThreadScrollSnapshots(thread, options = {}) {
  const scroller = options.scroller || getDocumentScroller();
  const snapshots = {
    document: createScrollSnapshot(scroller, {
      forcePreserve: options.preserveScroll === true
    }),
    openExecutionCards: new Set(),
    nodes: new Map()
  };

  thread.querySelectorAll("[data-scroll-key]").forEach((element) => {
    snapshots.nodes.set(element.dataset.scrollKey, createScrollSnapshot(element));
  });

  thread.querySelectorAll("[data-execution-card][data-execution-message-id][open]").forEach((element) => {
    snapshots.openExecutionCards.add(element.dataset.executionMessageId);
  });

  return snapshots;
}

function restoreThreadScrollSnapshots(thread, snapshots, options = {}) {
  const scroller = options.scroller || getDocumentScroller();

  thread.querySelectorAll("[data-execution-card][data-execution-message-id]").forEach((element) => {
    if (snapshots?.openExecutionCards?.has(element.dataset.executionMessageId)) {
      element.open = true;
    }
  });

  restoreScrollSnapshot(scroller, snapshots?.document, {
    forcePreserve: options.preserveScroll === true
  });

  thread.querySelectorAll("[data-scroll-key]").forEach((element) => {
    restoreScrollSnapshot(element, snapshots?.nodes.get(element.dataset.scrollKey));
  });
}

function buildMessageDisplayGroups(history, options = {}) {
  const groups = [];
  const outputOverrides = options.outputOverrides || {};

  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    const executeDisplay = message.role === "assistant" ? parseExecuteDisplayContent(message.content) : null;
    const standaloneOutputResults = getExecutionOutputResults(message);

    if (executeDisplay) {
      const sections = [];
      let cursor = index;

      while (cursor < history.length) {
        const assistantMessage = history[cursor];

        if (assistantMessage.role !== "assistant") {
          break;
        }

        const assistantExecuteDisplay = parseExecuteDisplayContent(assistantMessage.content);

        if (assistantExecuteDisplay) {
          const nextMessage = history[cursor + 1];
          const outputResults = Array.isArray(outputOverrides[assistantMessage.id])
            ? outputOverrides[assistantMessage.id]
            : nextMessage
              ? getExecutionOutputResults(nextMessage)
              : null;

          sections.push({
            executeDisplay: assistantExecuteDisplay,
            message: assistantMessage,
            outputResults,
            type: "execute"
          });

          cursor += outputResults ? 2 : 1;
          continue;
        }

        sections.push({
          message: assistantMessage,
          type: "text"
        });
        cursor += 1;
        break;
      }

      groups.push({
        sections,
        type: "assistant-sequence"
      });

      index = cursor - 1;
      continue;
    }

    if (standaloneOutputResults) {
      groups.push({
        messageId: message.id,
        outputResults: standaloneOutputResults,
        type: "standalone-output"
      });
      continue;
    }

    groups.push({
      message,
      type: "standard"
    });
  }

  return groups;
}

export function renderMessages(thread, history, options = {}) {
  if (!thread) {
    return;
  }

  const scrollSnapshots = captureThreadScrollSnapshots(thread, options);

  thread.innerHTML = "";
  thread.classList.remove("is-empty");

  if (!history.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "chat-empty";
    emptyState.textContent =
      typeof options.emptyStateText === "string" && options.emptyStateText.trim()
        ? options.emptyStateText
        : "Admin Agent is ready.";
    thread.classList.add("is-empty");
    thread.append(emptyState);
    window.requestAnimationFrame(() => {
      restoreThreadScrollSnapshots(thread, scrollSnapshots, options);
    });
    return;
  }

  buildMessageDisplayGroups(history, options).forEach((group) => {
    if (group.type === "assistant-sequence") {
      thread.append(createMessageRow("assistant", createAssistantSequenceBubble(group, options), "terminal-row"));
    } else if (group.type === "standalone-output") {
      thread.append(
        createMessageRow(
          "assistant",
          createStandaloneExecutionOutputBubble(group.outputResults, group.messageId),
          "terminal-row execution-output-row"
        )
      );
    } else {
      thread.append(createMessageRow(group.message.role, createStandardMessageBubble(group.message)));
    }
  });

  window.requestAnimationFrame(() => {
    restoreThreadScrollSnapshots(thread, scrollSnapshots, options);
  });
}

export async function copyTextToClipboard(text) {
  if (typeof text !== "string" || !text.length) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the temporary textarea copy path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  const copied = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
  textarea.remove();
  return copied;
}

export function findExecuteSection(history, messageId, outputOverrides = {}) {
  const messageIndex = history.findIndex((message) => message.id === messageId && message.role === "assistant");

  if (messageIndex === -1) {
    return null;
  }

  const message = history[messageIndex];
  const executeDisplay = parseExecuteDisplayContent(message.content);

  if (!executeDisplay) {
    return null;
  }

  const nextMessage = history[messageIndex + 1];
  const outputResults = Array.isArray(outputOverrides[messageId])
    ? outputOverrides[messageId]
    : nextMessage
      ? getExecutionOutputResults(nextMessage)
      : null;

  return {
    executeDisplay,
    message,
    outputResults
  };
}

export function getAssistantMessageCopyText(history, messageId, outputOverrides = {}) {
  const executeSection = findExecuteSection(history, messageId, outputOverrides);

  if (executeSection?.outputResults?.length) {
    return {
      kind: "result",
      text: getTerminalOutputText(executeSection.outputResults)
    };
  }

  const message = history.find((entry) => entry.id === messageId && entry.role === "assistant");

  if (!message) {
    return {
      kind: "",
      text: ""
    };
  }

  const text = stripExecuteBlocks(message.content).trim() || String(message.content || "").trim();
  return {
    kind: "response",
    text
  };
}
