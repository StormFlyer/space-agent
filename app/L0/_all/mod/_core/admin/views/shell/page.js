const tabs = [
  { id: "dashboard", icon: "space_dashboard", label: "Dashboard" },
  { id: "agent", icon: "smart_toy", label: "Agent" },
  { id: "documentation", icon: "description", label: "Documentation" }
];

const ACTIVE_TAB_STORAGE_KEY = "space.admin.activeTab";

const quickActions = [
  { id: "open-agent", icon: "smart_toy", label: "Admin agent", targetTab: "agent" },
  { id: "open-documentation", icon: "description", label: "Documentation", targetTab: "documentation" }
];

const arrowKeyOffset = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowDown: 1
};

const pageModel = {
  activeTab: "dashboard",
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
  },

  unmount() {
    this.refs = {};
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
