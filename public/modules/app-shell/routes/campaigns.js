import { createLegacyPageRoute } from "/modules/app-shell/legacy-page-route.js";

const base = createLegacyPageRoute({
  key: "campaigns",
  htmlPath: "/pages/campaigns/index.html",
});

export default {
  async mount(ctx) {
    if (window.location.pathname.includes("campaignmanager")) {
      const hash = window.location.hash || "#extract";
      history.replaceState(null, "", "/campaigns/" + hash);
    }
    return base.mount(ctx);
  },
};
