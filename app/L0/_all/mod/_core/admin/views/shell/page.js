const ADMIN_AGENT_AVATAR_PATH = "/mod/_core/admin/res/helmet_no_bg_256.webp";
const ADMIN_GROUP_ID = "_admin";

const tabs = [
  { id: "dashboard", icon: "space_dashboard", label: "Dashboard" },
  { id: "agent", avatarPath: ADMIN_AGENT_AVATAR_PATH, label: "Agent" },
  { id: "files", icon: "folder_open", label: "Files" },
  { id: "time_travel", icon: "history", label: "Time Travel" },
  { id: "modules", icon: "package_2", label: "Modules" }
];

const ACTIVE_TAB_STORAGE_KEY = "space.admin.activeTab";

const quickActions = [
  { id: "open-agent", avatarPath: ADMIN_AGENT_AVATAR_PATH, label: "Admin agent", targetTab: "agent" },
  { id: "open-files", icon: "folder_open", label: "Files", targetTab: "files" },
  { id: "open-time-travel", icon: "history", label: "Time Travel", targetTab: "time_travel" },
  { id: "open-modules", icon: "package_2", label: "Modules", targetTab: "modules" }
];

const arrowKeyOffset = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowDown: 1
};

const pageModel = {
  activeTab: "dashboard",
  userSelfInfo: null,
  userSelfInfoLoaded: false,
  userSelfInfoPromise: null,
  refs: {},
  quickActions,
  tabs,

  init() {
    this.restoreActiveTab();

    if (!this.isKnownTab(this.activeTab)) {
      this.activeTab = tabs[0].id;
    }
  },

  mount(refs = {}) {
    this.refs = refs;
    void this.loadUserSelfInfo();
  },

  unmount() {
    this.refs = {};
  },

  get isCurrentUserAdmin() {
    return (
      Array.isArray(this.userSelfInfo?.groups) &&
      this.userSelfInfo.groups.includes(ADMIN_GROUP_ID)
    );
  },

  isKnownTab(tabId) {
    return this.tabs.some((tab) => tab.id === tabId);
  },

  isTabActive(tabId) {
    return this.activeTab === tabId;
  },

  restoreActiveTab() {
    try {
      const storedTab = globalThis.sessionStorage?.getItem(ACTIVE_TAB_STORAGE_KEY);

      if (storedTab && this.isKnownTab(storedTab)) {
        this.activeTab = storedTab;
      }
    } catch {
      // Ignore storage access failures and keep the default tab.
    }
  },

  persistActiveTab() {
    try {
      globalThis.sessionStorage?.setItem(ACTIVE_TAB_STORAGE_KEY, this.activeTab);
    } catch {
      // Ignore storage access failures.
    }
  },

  async loadUserSelfInfo(options = {}) {
    const forceRefresh = options.forceRefresh === true;

    if (!forceRefresh && this.userSelfInfoLoaded) {
      return this.userSelfInfo;
    }

    if (!forceRefresh && this.userSelfInfoPromise) {
      return this.userSelfInfoPromise;
    }

    this.userSelfInfoPromise = (async () => {
      try {
        const snapshot = await space.api.userSelfInfo();
        this.userSelfInfo =
          snapshot && typeof snapshot === "object"
            ? snapshot
            : null;
        this.userSelfInfoLoaded = true;
        return this.userSelfInfo;
      } catch {
        this.userSelfInfo = null;
        this.userSelfInfoLoaded = false;
        return null;
      } finally {
        this.userSelfInfoPromise = null;
      }
    })();

    return this.userSelfInfoPromise;
  },

  selectTab(tabId) {
    if (!this.isKnownTab(tabId)) {
      return;
    }

    this.activeTab = tabId;
    this.persistActiveTab();
  },

  focusTab(tabId) {
    this.refs.tabBar?.querySelector(`[data-tab-id="${tabId}"]`)?.focus();
  },

  selectRelativeTab(tabId, offset) {
    const currentIndex = this.tabs.findIndex((tab) => tab.id === tabId);

    if (currentIndex === -1) {
      return;
    }

    const nextIndex = (currentIndex + offset + this.tabs.length) % this.tabs.length;
    const nextTabId = this.tabs[nextIndex]?.id;

    if (!nextTabId) {
      return;
    }

    this.selectTab(nextTabId);
    requestAnimationFrame(() => this.focusTab(nextTabId));
  },

  handleTabKeydown(event, tabId) {
    if (event.key in arrowKeyOffset) {
      event.preventDefault();
      this.selectRelativeTab(tabId, arrowKeyOffset[event.key]);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      this.selectTab(this.tabs[0].id);
      requestAnimationFrame(() => this.focusTab(this.tabs[0].id));
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const lastTabId = this.tabs[this.tabs.length - 1]?.id;

      if (!lastTabId) {
        return;
      }

      this.selectTab(lastTabId);
      requestAnimationFrame(() => this.focusTab(lastTabId));
    }
  }
};

const adminPage = space.fw.createStore("adminPage", pageModel);

export { adminPage };
