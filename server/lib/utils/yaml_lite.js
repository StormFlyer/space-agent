function stripInlineComment(rawLine) {
  let quote = "";

  for (let index = 0; index < rawLine.length; index += 1) {
    const char = rawLine[index];

    if (quote) {
      if (char === quote && rawLine[index - 1] !== "\\") {
        quote = "";
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "#") {
      return rawLine.slice(0, index);
    }
  }

  return rawLine;
}

function splitInlineList(sourceText) {
  const parts = [];
  let current = "";
  let quote = "";

  for (let index = 0; index < sourceText.length; index += 1) {
    const char = sourceText[index];

    if (quote) {
      current += char;

      if (char === quote && sourceText[index - 1] !== "\\") {
        quote = "";
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ",") {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
}

function parseYamlScalar(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();

    if (!inner) {
      return [];
    }

    return splitInlineList(inner)
      .map((part) => parseYamlScalar(part))
      .filter((part) => part !== "");
  }

  return trimmed;
}

function parseSimpleYaml(sourceText) {
  const result = {};
  let currentKey = null;

  String(sourceText || "")
    .split(/\r?\n/u)
    .forEach((rawLine) => {
      const withoutComment = stripInlineComment(rawLine);
      const trimmedLine = withoutComment.trimEnd();
      const indent = withoutComment.match(/^\s*/u)?.[0].length || 0;

      if (!trimmedLine.trim()) {
        return;
      }

      const topLevelKeyMatch =
        indent === 0 ? trimmedLine.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/u) : null;

      if (topLevelKeyMatch) {
        const [, key, value] = topLevelKeyMatch;
        currentKey = null;

        if (value === undefined || value === "") {
          result[key] = null;
          currentKey = key;
          return;
        }

        result[key] = parseYamlScalar(value);
        return;
      }

      if (!currentKey || indent === 0) {
        return;
      }

      const nestedLine = trimmedLine.trimStart();
      const nestedKeyMatch = nestedLine.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/u);

      if (nestedKeyMatch) {
        const [, key, value] = nestedKeyMatch;

        if (!result[currentKey] || typeof result[currentKey] !== "object" || Array.isArray(result[currentKey])) {
          result[currentKey] = {};
        }

        result[currentKey][key] = value === undefined || value === "" ? [] : parseYamlScalar(value);
        return;
      }

      const listMatch = nestedLine.match(/^-\s+(.*)$/u);
      if (listMatch) {
        if (!Array.isArray(result[currentKey])) {
          result[currentKey] = [];
        }

        const parsedValue = parseYamlScalar(listMatch[1]);

        if (Array.isArray(parsedValue)) {
          result[currentKey].push(...parsedValue);
          return;
        }

        result[currentKey].push(parsedValue);
      }
    });

  return result;
}

function formatYamlScalar(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);

  if (!text) {
    return '""';
  }

  if (/^[A-Za-z0-9._/@:+-]+$/u.test(text)) {
    return text;
  }

  return JSON.stringify(text);
}

function serializeSimpleYaml(source) {
  const lines = [];

  function writeValue(key, rawValue, indent = 0) {
    const prefix = " ".repeat(indent);

    if (!key) {
      return;
    }

    if (Array.isArray(rawValue)) {
      if (rawValue.length === 0) {
        lines.push(`${prefix}${key}: []`);
        return;
      }

      lines.push(`${prefix}${key}:`);
      rawValue.forEach((item) => {
        lines.push(`${prefix}  - ${formatYamlScalar(item)}`);
      });
      return;
    }

    if (rawValue && typeof rawValue === "object") {
      const entries = Object.entries(rawValue);

      if (entries.length === 0) {
        lines.push(`${prefix}${key}: {}`);
        return;
      }

      lines.push(`${prefix}${key}:`);
      entries.forEach(([nestedKey, nestedValue]) => {
        writeValue(nestedKey, nestedValue, indent + 2);
      });
      return;
    }

    lines.push(`${prefix}${key}: ${formatYamlScalar(rawValue)}`);
  }

  Object.entries(source || {}).forEach(([key, rawValue]) => {
    writeValue(key, rawValue, 0);
  });

  return `${lines.join("\n")}\n`;
}

export { parseSimpleYaml, parseYamlScalar, serializeSimpleYaml };
