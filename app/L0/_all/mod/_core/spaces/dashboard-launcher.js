import "/mod/_core/spaces/store.js";

function logDashboardSpacesError(context, error) {
  console.error(`[spaces-dashboard] ${context}`, error);
}

function buildNextSpaceTitle(entries) {
  const baseTitle = "Untitled Space";
  const existingTitles = new Set(
    (Array.isArray(entries) ? entries : []).map((entry) => String(entry?.title || ""))
  );

  if (!existingTitles.has(baseTitle)) {
    return baseTitle;
  }

  let suffix = 2;

  while (existingTitles.has(`${baseTitle} ${suffix}`)) {
    suffix += 1;
  }

  return `${baseTitle} ${suffix}`;
}

globalThis.spacesDashboardLauncher = function spacesDashboardLauncher() {
  return {
    creating: false,
    deletingSpaceId: "",
    entries: [],
    loading: false,
    noticeText: "",
    noticeTone: "info",

    async init() {
      await this.loadSpaces();
    },

    get hasEntries() {
      return this.entries.length > 0;
    },

    async loadSpaces() {
      this.loading = true;

      try {
        this.entries = await globalThis.space.spaces.listSpaces();
      } catch (error) {
        logDashboardSpacesError("loadSpaces failed", error);
        this.noticeText = String(error?.message || "Unable to load spaces.");
        this.noticeTone = "error";
      } finally {
        this.loading = false;
      }
    },

    async createSpace() {
      if (this.creating) {
        return;
      }

      this.creating = true;
      this.noticeText = "";
      this.noticeTone = "info";

      try {
        await globalThis.space.spaces.createSpace({
          title: buildNextSpaceTitle(this.entries)
        });
      } catch (error) {
        logDashboardSpacesError("createSpace failed", error);
        this.noticeText = String(error?.message || "Unable to create a space.");
        this.noticeTone = "error";
      } finally {
        this.creating = false;
      }
    },

    async deleteSpace(spaceId) {
      const normalizedSpaceId = String(spaceId || "").trim();
      const entry = this.entries.find((item) => item?.id === normalizedSpaceId);
      const label = String(entry?.title || normalizedSpaceId || "this space");
      const nextEntries = this.entries.filter((item) => item?.id !== normalizedSpaceId);

      if (!normalizedSpaceId || this.deletingSpaceId === normalizedSpaceId) {
        return;
      }

      if (!globalThis.confirm(`Delete "${label}" (${normalizedSpaceId})? This removes the whole space.`)) {
        return;
      }

      this.deletingSpaceId = normalizedSpaceId;
      this.noticeText = "";
      this.noticeTone = "info";

      try {
        await globalThis.space.spaces.removeSpace(normalizedSpaceId);
        this.entries = nextEntries;
        this.noticeText = `Deleted "${label}".`;
      } catch (error) {
        logDashboardSpacesError("deleteSpace failed", error);
        this.noticeText = String(error?.message || "Unable to delete that space.");
        this.noticeTone = "error";
      } finally {
        this.deletingSpaceId = "";
      }
    },

    async openSpace(spaceId) {
      try {
        await globalThis.space.spaces.openSpace(spaceId);
      } catch (error) {
        logDashboardSpacesError("openSpace failed", error);
        this.noticeText = String(error?.message || "Unable to open that space.");
        this.noticeTone = "error";
      }
    }
  };
};
