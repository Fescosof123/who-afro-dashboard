/* "Reset view" button for every chart and map.
 *
 * Users can zoom and pan charts, scroll-zoom maps and hide series from the legend,
 * but the dashboard hides Plotly's toolbar, so there was no way back except
 * reloading the page. This file wraps Plotly.newPlot / Plotly.react: each render
 * keeps a copy of the layout as drawn and which series were visible. When the
 * user changes the view, a small "Reset view" button appears on the chart; it
 * redraws the chart exactly as it was first shown.
 */
(function () {
  "use strict";
  if (typeof window.Plotly === "undefined") return;

  const P = window.Plotly;
  // Layout changes caused by resizing, not by the user changing the view.
  const SIZE_KEYS = /^(autosize|width|height|margin)/;

  function isFr() {
    const sel = document.getElementById("languageSelect");
    return (sel ? sel.value : document.documentElement.lang) === "fr";
  }
  // null when the layout cannot be copied: the chart then simply gets no button.
  function clone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj || {}));
    } catch (e) {
      return null;
    }
  }
  function resolve(gd) {
    return typeof gd === "string" ? document.getElementById(gd) : gd;
  }

  function ensureButton(gd) {
    let btn = gd.querySelector(":scope > .chart-reset-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chart-reset-btn";
      btn.hidden = true;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        resetChart(gd);
      });
      gd.appendChild(btn);
    }
    setLabel(btn);
    return btn;
  }
  function setLabel(btn) {
    const text = isFr() ? "Réinitialiser la vue" : "Reset view";
    btn.innerHTML = `<span aria-hidden="true">↺</span> ${text}`;
    btn.setAttribute("aria-label", text);
    btn.title = isFr() ? "Revenir à la vue d'origine du graphique" : "Return the chart to its original view";
  }
  function showButton(gd, show) {
    const btn = gd.querySelector(":scope > .chart-reset-btn");
    if (!btn) return;
    if (show && !(gd.__resetHome && gd.__resetHome.layout)) return;
    setLabel(btn);
    btn.hidden = !show;
    // Room above the plot while the button shows, so it never covers data or legends.
    gd.classList.toggle("has-chart-reset", show);
  }

  function remember(gd, data, layout, config) {
    gd.__resetHome = {
      layout: clone(layout),
      config: config ? Object.assign({}, config) : undefined,
      visible: (Array.isArray(data) ? data : []).map((t) => (t && t.visible !== undefined ? t.visible : true))
    };
    if (window.getComputedStyle(gd).position === "static") gd.style.position = "relative";
    ensureButton(gd);
    showButton(gd, false);
    // Plotly.newPlot drops event listeners, so attach them again after every render
    // (removing ours first so they never run twice).
    if (typeof gd.on === "function") {
      if (!gd.__resetHandlers) {
        gd.__resetHandlers = {
          relayout: (ev) => {
            if (gd.__resetting) return;
            const keys = Object.keys(ev || {}).filter((k) => !SIZE_KEYS.test(k));
            // A double-click sends "autorange: true", which is already the original view.
            const onlyAutorange = keys.length && keys.every((k) => /\.autorange$/.test(k) && ev[k] === true);
            if (keys.length && !onlyAutorange) showButton(gd, true);
          },
          restyle: () => {
            if (!gd.__resetting) showButton(gd, true);
          }
        };
      }
      if (typeof gd.removeListener === "function") {
        gd.removeListener("plotly_relayout", gd.__resetHandlers.relayout);
        gd.removeListener("plotly_restyle", gd.__resetHandlers.restyle);
      }
      gd.on("plotly_relayout", gd.__resetHandlers.relayout);
      gd.on("plotly_restyle", gd.__resetHandlers.restyle);
    }
  }

  function resetChart(gd) {
    const home = gd.__resetHome;
    if (!home || !home.layout || !gd.data) return;
    const btn = gd.querySelector(":scope > .chart-reset-btn");
    const hadFocus = btn && document.activeElement === btn;
    gd.__resetting = true;
    const data = gd.data.map((t, i) => Object.assign(t, { visible: home.visible[i] !== undefined ? home.visible[i] : true }));
    // A fresh copy of the original layout: Plotly writes zoom ranges into the layout it is given.
    const layout = clone(home.layout);
    if (layout.uirevision !== undefined) layout.uirevision = `reset-${Date.now()}`;
    origReact(gd, data, layout, home.config)
      .then(() => {
        gd.__resetting = false;
        showButton(gd, false);
        // Keep keyboard focus on the chart instead of losing it with the hidden button.
        if (hadFocus) {
          if (!gd.hasAttribute("tabindex")) gd.setAttribute("tabindex", "-1");
          gd.focus({ preventScroll: true });
        }
      })
      .catch(() => { gd.__resetting = false; });
  }

  function wrap(fn) {
    return function (gdArg, data, layout, config) {
      const gd = resolve(gdArg);
      // Object form: Plotly.newPlot(gd, { data, layout, config }).
      let d = data;
      let l = layout;
      let c = config;
      if (data && !Array.isArray(data) && typeof data === "object" && (data.data || data.layout)) {
        d = data.data;
        l = data.layout;
        c = data.config;
      }
      const result = fn.apply(this, arguments);
      // Never let the reset feature break a chart that drew correctly.
      const after = () => {
        try {
          if (gd && gd.data) remember(gd, d || gd.data, l || {}, c);
        } catch (e) { /* chart stays without a reset button */ }
      };
      if (result && typeof result.then === "function") {
        return result.then((out) => { after(); return out; });
      }
      after();
      return result;
    };
  }

  const origReact = P.react.bind(P);
  P.newPlot = wrap(P.newPlot.bind(P));
  P.react = wrap(origReact);

  // Keep the button label in the selected language.
  document.addEventListener("change", (ev) => {
    if (ev.target && ev.target.id === "languageSelect") {
      setTimeout(() => document.querySelectorAll(".chart-reset-btn").forEach(setLabel), 100);
    }
  });
})();
