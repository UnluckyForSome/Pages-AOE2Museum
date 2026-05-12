(function () {
  const EVENT_NAME = "aoe2museum:locationchange";

  function currentUrl() {
    return new URL(window.location.href);
  }

  function notify() {
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, {
        detail: { href: window.location.href },
      }),
    );
  }

  function getQueryParam(name) {
    return currentUrl().searchParams.get(name);
  }

  function setQueryParam(name, value, opts) {
    const options = opts || {};
    const url = currentUrl();
    if (value == null || value === "" || value === options.removeIf) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value);
    }
    const next = url.pathname + url.search + url.hash;
    if (options.replace === false && history.pushState) {
      history.pushState(null, "", next);
    } else if (history.replaceState) {
      history.replaceState(null, "", next);
    } else {
      window.location.search = url.search;
      return;
    }
    notify();
  }

  function subscribe(handler) {
    function wrapped() {
      handler(currentUrl());
    }
    window.addEventListener("popstate", wrapped);
    window.addEventListener(EVENT_NAME, wrapped);
    return function unsubscribe() {
      window.removeEventListener("popstate", wrapped);
      window.removeEventListener(EVENT_NAME, wrapped);
    };
  }

  window.Aoe2MuseumLocation = {
    EVENT_NAME: EVENT_NAME,
    currentUrl: currentUrl,
    getQueryParam: getQueryParam,
    notify: notify,
    setQueryParam: setQueryParam,
    subscribe: subscribe,
  };
})();
