type SpaceExtend = typeof import("./L0/_all/mod/_core/framework/js/extensions.js").extend;
type SpaceCreateStore = typeof import("./L0/_all/mod/_core/framework/js/AlpineStore.js").createStore;
type SpaceYamlParse = typeof import("./L0/_all/mod/_core/framework/js/yaml-lite.js").parseSimpleYaml;
type SpaceYamlParseScalar = typeof import("./L0/_all/mod/_core/framework/js/yaml-lite.js").parseYamlScalar;
type SpaceYamlSerialize = typeof import("./L0/_all/mod/_core/framework/js/yaml-lite.js").serializeSimpleYaml;

type SpaceApiQueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

type SpaceApiCallOptions = {
  method?: string;
  query?: Record<string, SpaceApiQueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

type SpaceFileApiResult = {
  endpoint?: string;
  recursive?: boolean;
  paths?: string[];
  path: string;
  content?: string;
  encoding?: string;
  bytesWritten?: number;
};

type SpaceHealthResult = {
  ok: boolean;
  name: string;
  browserAppUrl: string;
  responsibilities: string[];
};

type SpaceUserSelfInfo = {
  fullName: string;
  groups: string[];
  managedGroups: string[];
  username: string;
};

type SpaceApi = {
  call<T = unknown>(endpointName: string, callOptions?: SpaceApiCallOptions): Promise<T>;
  fileList(path: string, recursive?: boolean): Promise<SpaceFileApiResult>;
  fileRead(path: string, encoding?: string): Promise<SpaceFileApiResult>;
  fileWrite(path: string, content: string, encoding?: string): Promise<SpaceFileApiResult>;
  health(): Promise<SpaceHealthResult>;
  userSelfInfo(): Promise<SpaceUserSelfInfo>;
};

type SpaceFw = {
  createStore: SpaceCreateStore;
};

type SpaceYamlUtils = {
  parse: SpaceYamlParse;
  parseScalar: SpaceYamlParseScalar;
  serialize: SpaceYamlSerialize;
};

type SpaceUtils = {
  yaml?: SpaceYamlUtils;
  [key: string]: any;
};

type SpaceRuntime = {
  api?: SpaceApi;
  extend: SpaceExtend;
  fw?: SpaceFw;
  utils?: SpaceUtils;
  [key: string]: any;
};

declare global {
  var space: SpaceRuntime;

  interface Window {
    space: SpaceRuntime;
  }
}

export {};
