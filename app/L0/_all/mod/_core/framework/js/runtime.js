import { createApiClient } from "./api-client.js";
import { createStore } from "./AlpineStore.js";
import { downloadProxiedFile } from "./download.js";
import { installFetchProxy } from "./fetch-proxy.js";
import { buildProxyUrl, isProxyableExternalUrl } from "./proxy-url.js";
import {
  parseSimpleYaml,
  parseYamlScalar,
  serializeSimpleYaml
} from "./yaml-lite.js";

export function initializeRuntime(options = {}) {
  const apiBasePath = options.apiBasePath || "/api";
  const proxyPath = options.proxyPath || "/api/proxy";

  installFetchProxy({ proxyPath });
  const api = createApiClient({ basePath: apiBasePath });
  const previousRuntime = globalThis.space && typeof globalThis.space === "object" ? globalThis.space : {};
  const previousFw =
    previousRuntime.fw && typeof previousRuntime.fw === "object" ? previousRuntime.fw : {};
  const previousUtils =
    previousRuntime.utils && typeof previousRuntime.utils === "object" ? previousRuntime.utils : {};
  const previousYamlUtils =
    previousUtils.yaml && typeof previousUtils.yaml === "object" ? previousUtils.yaml : {};

  const runtime = {
    ...previousRuntime,
    api,
    apiBasePath,
    fw: {
      ...previousFw,
      createStore
    },
    proxyPath,
    utils: {
      ...previousUtils,
      yaml: {
        ...previousYamlUtils,
        parse: parseSimpleYaml,
        parseScalar: parseYamlScalar,
        serialize: serializeSimpleYaml
      }
    },
    fetchExternal(targetUrl, init) {
      return window.fetch(targetUrl, init);
    },
    proxy: {
      isExternal(targetUrl) {
        return isProxyableExternalUrl(targetUrl);
      },
      buildUrl(targetUrl, proxyOptions = {}) {
        return buildProxyUrl(targetUrl, {
          proxyPath,
          ...proxyOptions
        });
      }
    },
    download(targetUrl, downloadOptions = {}) {
      return downloadProxiedFile(targetUrl, {
        proxyPath,
        ...downloadOptions
      });
    }
  };

  globalThis.space = runtime;
  return runtime;
}
