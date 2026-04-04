const router = globalThis.space?.router;

if (router) {
  const params = {};
  const currentId = String(router.getParam("id", "") || "").trim();
  const currentMode = String(router.getParam("mode", "") || "").trim().toLowerCase();

  if (currentMode === "new") {
    params.new = "1";
  } else if (currentId) {
    params.id = currentId;
  }

  void router.replaceTo("spaces", Object.keys(params).length ? { params } : {});
}
