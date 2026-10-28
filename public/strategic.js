/* Strategic humanitarian view for WHO AFRO DHM.
 *
 * Renders the Overview, Crisis Classification and Data Health pages, and adds
 * verified-source panels to Country Profiles, Conflict & Displacement and
 * Attacks on Health Care. Data comes from /api/strategic (OCHA HDX HAPI and FTS,
 * IOM DTM, UNHCR, IPC, INFORM, WHO SSA, WHO grading register) plus the FCV
 * service database already loaded by app.js.
 */
(function () {
  "use strict";

  const state = {
    payload: null,
    dash: null,
    scope: "fcv13",
    mapLayer: "classification",
    loading: null
  };

  const SCOPE_GROUPS = {
    fcv13: ["fcv_prioritized", "fcv_accelerated"],
    fcvall: ["fcv_prioritized", "fcv_accelerated", "fcv_other"],
    withcontext: ["fcv_prioritized", "fcv_accelerated", "fcv_other", "context"]
  };

  const GROUP_LABEL = {
    fcv_prioritized: "Prioritized",
    fcv_accelerated: "Accelerated",
    fcv_other: "Other FCV",
    context: "Context"
  };

  const LEVEL_ORDER = { Major: 3, Severe: 2, Moderate: 1, "Insufficient data": 0 };
  const LEVEL_COLOR = {
    Major: "#8e1b3a",
    Severe: "#d9662b",
    Moderate: "#e9b949",
    "Insufficient data": "#b9c4cf"
  };

  const PLOT_CONFIG = { displayModeBar: false, responsive: true };

  // Plotly draws into a node that may hold an earlier "no data" message.
  function plot(node, traces, layout) {
    if (node.dataset.empty === "1") {
      node.innerHTML = "";
      delete node.dataset.empty;
    }
    Plotly.react(node, traces, layout, PLOT_CONFIG);
  }
  function emptyNote(node, text) {
    if (node.data && typeof Plotly !== "undefined") {
      Plotly.purge(node);
    }
    node.dataset.empty = "1";
    node.innerHTML = `<p class="muted">${text}</p>`;
  }
  const FONT = { family: "Barlow, sans-serif", color: "#0d1f33", size: 13 };

  // ---------- formatting ----------
  // Language: the page language is set by app.js (English or French).
  function isFr() {
    return document.documentElement.lang === "fr";
  }
  // French typography: non-breaking space before : and %, narrow non-breaking
  // space before ; ! ?, and inside guillemets. Only text between tags is changed.
  function frTypoText(t) {
    return t
      .replace(/ :/g, "\u00a0:")
      .replace(/ ([;!?])/g, "\u202f$1")
      .replace(/ %(?!\{)/g, "\u00a0%")
      .replace(/« /g, "«\u00a0")
      .replace(/ »/g, "\u00a0»");
  }
  function frTypo(s) {
    if (typeof s !== "string") return s;
    return s.replace(/(^|>)([^<]*)/g, (m, a, t) => a + frTypoText(t));
  }
  function L(en, fr) {
    return isFr() && fr != null ? frTypo(fr) : en;
  }
  // "n/a" in the page language.
  function na() {
    return L("n/a", "n.d.");
  }
  const NBSP = "\u00a0";
  // Decimal number with the French comma when the page is in French.
  function dec(n, digits) {
    const s = Number(n).toFixed(digits);
    return isFr() ? s.replace(".", ",") : s;
  }
  function locale() {
    return isFr() ? "fr-FR" : "en-GB";
  }
  // Minus sign: typographic minus in French.
  function minus() {
    return L("-", "\u2212");
  }
  // "de" with elision before a vowel or mute h: "d'avril 2026", "de juin 2026".
  function deFr(x) {
    return /^[aeiouyéèêëàâîïôûh]/i.test(String(x)) ? `d'${x}` : `de ${x}`;
  }
  // Quarter labels: "2026-Q1" becomes "T1 2026" in French.
  function qLab(label) {
    if (label == null) return label;
    return L(String(label), String(label).replace(/^(\d{4})-Q([1-4])$/, "T$2 $1"));
  }
  // ISO dates shown to users: "2026-08-31" becomes "31 août 2026" in French.
  function isoDisp(x) {
    return isFr() && /^\d{4}-\d{2}-\d{2}/.test(String(x || "")) ? fmtDate(x) : x;
  }
  // Display names only; the English values stay in use for all logic.
  const LEVEL_FR = { Major: "Majeur", Severe: "Sévère", Moderate: "Modéré", "Insufficient data": "Données insuffisantes" };
  function levelName(level) {
    return L(level, LEVEL_FR[level] || level);
  }
  const GROUP_FR = { fcv_prioritized: "Prioritaire", fcv_accelerated: "Accéléré", fcv_other: "Autre FCV", context: "Contexte" };
  function groupName(group) {
    return L(GROUP_LABEL[group] || group, GROUP_FR[group] || GROUP_LABEL[group] || group);
  }
  // French name and article ("le", "la", "l'", "les" or none) per country.
  const COUNTRY_INFO_FR = {
    Algeria: ["Algérie", "l'"], Angola: ["Angola", "l'"], Benin: ["Bénin", "le"], Botswana: ["Botswana", "le"],
    "Burkina Faso": ["Burkina Faso", "le"], Burundi: ["Burundi", "le"], "Cabo Verde": ["Cabo Verde", "le"],
    Cameroon: ["Cameroun", "le"], "Central African Republic": ["République centrafricaine", "la"], Chad: ["Tchad", "le"],
    Comoros: ["Comores", "les"], Congo: ["Congo", "le"], "Republic of the Congo": ["République du Congo", "la"],
    "Côte d’Ivoire": ["Côte d'Ivoire", "la"], "Côte d'Ivoire": ["Côte d'Ivoire", "la"],
    "Democratic Republic of the Congo": ["République démocratique du Congo", "la"], Djibouti: ["Djibouti", ""],
    Egypt: ["Égypte", "l'"], "Equatorial Guinea": ["Guinée équatoriale", "la"], Eritrea: ["Érythrée", "l'"],
    Eswatini: ["Eswatini", "l'"], Ethiopia: ["Éthiopie", "l'"], Gabon: ["Gabon", "le"], Gambia: ["Gambie", "la"],
    Ghana: ["Ghana", "le"], Guinea: ["Guinée", "la"], "Guinea-Bissau": ["Guinée-Bissau", "la"], Kenya: ["Kenya", "le"],
    Lesotho: ["Lesotho", "le"], Liberia: ["Libéria", "le"], Libya: ["Libye", "la"], Madagascar: ["Madagascar", ""],
    Malawi: ["Malawi", "le"], Mali: ["Mali", "le"], Mauritania: ["Mauritanie", "la"], Mauritius: ["Maurice", ""],
    Mayotte: ["Mayotte", ""], Morocco: ["Maroc", "le"], Mozambique: ["Mozambique", "le"], Namibia: ["Namibie", "la"],
    Niger: ["Niger", "le"], Nigeria: ["Nigéria", "le"], Rwanda: ["Rwanda", "le"], "Réunion": ["La Réunion", ""],
    "Saint Helena": ["Sainte-Hélène", ""], "Sao Tome and Principe": ["Sao Tomé-et-Principe", ""],
    "São Tomé and Príncipe": ["Sao Tomé-et-Principe", ""], Senegal: ["Sénégal", "le"], Seychelles: ["Seychelles", "les"],
    "Sierra Leone": ["Sierra Leone", "la"], Somalia: ["Somalie", "la"], "South Africa": ["Afrique du Sud", "l'"],
    "South Sudan": ["Soudan du Sud", "le"], Sudan: ["Soudan", "le"], Togo: ["Togo", "le"], Tunisia: ["Tunisie", "la"],
    Uganda: ["Ouganda", "l'"], "United Republic of Tanzania": ["République-Unie de Tanzanie", "la"], Tanzania: ["Tanzanie", "la"],
    Zambia: ["Zambie", "la"], Zimbabwe: ["Zimbabwe", "le"], "Canary Islands": ["Îles Canaries", "les"]
  };
  const COUNTRY_FR = Object.fromEntries(Object.entries(COUNTRY_INFO_FR).map(([k, v]) => [k, v[0]]));
  function cname(name) {
    return L(name, COUNTRY_FR[name] || name);
  }
  // French country name with its article, using the short display name:
  // "le Tchad", "l'Éthiopie", "la RD Congo"; kind "de" gives "du Tchad", "de l'Éthiopie".
  function frArt(name, kind = "") {
    const shown = shortName(name);
    const art = (COUNTRY_INFO_FR[name] || [null, ""])[1];
    if (kind === "de") {
      if (art === "le") return `du ${shown}`;
      if (art === "les") return `des ${shown}`;
      if (art === "la") return `de la ${shown}`;
      if (art === "l'") return `de l'${shown}`;
      return deFr(shown);
    }
    return art === "l'" ? `l'${shown}` : art ? `${art} ${shown}` : shown;
  }
  // "le Cameroun (24 %), le Niger (26 %) et le Mozambique (26 %)"; rows or names.
  function frList(items, extra, max) {
    const list = max ? items.slice(0, max) : items;
    const parts = list.map((x) => {
      const name = typeof x === "string" ? x : x.country;
      return `${esc(frArt(name))}${extra ? ` (${extra(x)})` : ""}`;
    });
    if (max && items.length > max) parts.push(`${items.length - max} autre${items.length - max > 1 ? "s" : ""}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}` : parts.join("");
  }
  function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  // "aucun tué", "1 tué", "3 tués" (and the same for injured).
  function killedFr(n) {
    const v = Number(n) || 0;
    return v === 0 ? "aucun tué" : v === 1 ? "1 tué" : `${fmtFull(v)} tués`;
  }
  function injuredFr(n) {
    const v = Number(n) || 0;
    return v === 0 ? "aucun blessé" : v === 1 ? "1 blessé" : `${fmtFull(v)} blessés`;
  }

  // Server-side texts (classification rules, missing indicators, source names):
  // translated on display only.
  const SERVER_FR = {
    "DHM triage tier: a rule-based classification from verified indicators. It is not a WHO grade and does not replace the WHO grading process.":
      "Niveau de triage DHM : une classification fondée sur des règles, à partir d'indicateurs vérifiés. Ce n'est pas un grade OMS et il ne remplace pas le processus de classement par grade de l'OMS.",
    "6 to 8 points": "6 à 8 points",
    "3 to 5 points": "3 à 5 points",
    "0 to 2 points": "0 à 2 points",
    "fewer than 3 of the 4 core indicators are current": "moins de 3 des 4 indicateurs de base sont à jour",
    "INFORM Risk class very high = 1 (EC JRC)": "Classe de risque INFORM très élevée = 1 (CCR de la CE)",
    "People in need of health assistance: 2 million or more = 2, 500,000 or more = 1 (OCHA HNRP). Where a country has no current plan, the last annual plan's figure counts if that plan ended 24 months ago or less (a flash appeal's figure stops counting when the appeal ends); the tier is then marked provisional and the figure is never added to regional totals":
      "Personnes ayant besoin d'une assistance sanitaire : 2 millions ou plus = 2, 500 000 ou plus = 1 (HNRP d'OCHA). Lorsqu'un pays n'a pas de plan en cours, le chiffre du dernier plan annuel est retenu si ce plan s'est terminé il y a 24 mois ou moins (le chiffre d'un appel éclair cesse de compter à la fin de l'appel) ; le niveau est alors marqué comme provisoire et le chiffre n'est jamais ajouté aux totaux régionaux",
    "IPC/CH Phase 3+ share of the analysed population, analysis less than 18 months old: 20% or more = 2, 10% or more = 1":
      "Part de la population analysée en phase 3+ IPC/CH, analyse de moins de 18 mois : 20 % ou plus = 2, 10 % ou plus = 1",
    "IDPs (current figure) + refugees hosted: 1 million or more = 2, 250,000 or more = 1 (IOM DTM, UNHCR)":
      "Déplacés internes (chiffre à jour) + réfugiés accueillis : 1 million ou plus = 2, 250 000 ou plus = 1 (DTM de l'OIM, HCR)",
    "WHO SSA: 10 or more attacks on health care this year, or any deaths = 1 (only where SSA is deployed)":
      "SSA de l'OMS : 10 attaques ou plus contre les soins de santé cette année, ou au moins un décès = 1 (uniquement là où le SSA est déployé)",
    "INFORM Risk class very high": "Classe de risque INFORM très élevée",
    "IPC/CH Phase 3+ 20% or more of the analysed population": "Phase 3+ IPC/CH : 20 % ou plus de la population analysée",
    "IPC/CH Phase 3+ 10% or more of the analysed population": "Phase 3+ IPC/CH : 10 % ou plus de la population analysée",
    "IDPs + refugees hosted 1 million or more": "Déplacés internes + réfugiés accueillis : 1 million ou plus",
    "IDPs + refugees hosted 250,000 or more": "Déplacés internes + réfugiés accueillis : 250 000 ou plus",
    "WHO SSA: 10+ attacks on health care this year or any deaths": "SSA de l'OMS : 10 attaques ou plus contre les soins de santé cette année, ou au moins un décès",
    "no INFORM Risk score": "pas de score de risque INFORM",
    "no humanitarian plan": "pas de plan humanitaire",
    "IPC/CH analysis older than 18 months": "analyse IPC/CH de plus de 18 mois",
    "no IPC/CH analysis": "pas d'analyse IPC/CH",
    "displacement figure outdated": "chiffre de déplacement obsolète",
    "no displacement figure": "pas de chiffre de déplacement",
    "Flash appeal figures are not used once the appeal has ended": "Les chiffres d'un appel éclair ne sont plus utilisés une fois l'appel terminé",
    "OCHA HDX HAPI": "OCHA HDX HAPI",
    "OCHA Financial Tracking Service": "Service de suivi financier (FTS) d'OCHA",
    "OCHA Response Monitoring (HPC)": "Suivi de la réponse d'OCHA (HPC)",
    "WHO Surveillance System for Attacks on Health Care": "Système de surveillance des attaques contre les soins de santé (SSA) de l'OMS",
    "WHO grading decisions (entered by DHM)": "Décisions de classement par grade de l'OMS (saisies par la DHM)",
    "Health Cluster reach reports (entered by DHM)": "Rapports de couverture du Cluster Santé (saisis par la DHM)",
    "FCV country profile workbook (DHM)": "Classeur des profils pays FCV (DHM)",
    "FCV country profile (DHM, from HNRP)": "Profil pays FCV (DHM, d'après le HNRP)",
    "Health Cluster report (entered by DHM)": "Rapport du Cluster Santé (saisi par la DHM)",
    "UNHCR via HDX HAPI": "HCR via HDX HAPI",
    "IOM DTM via HDX HAPI": "DTM de l'OIM via HDX HAPI",
    "OCHA HNRP via HDX HAPI": "HNRP d'OCHA via HDX HAPI",
    "OPD consultations per person per month above 5 (likely a count, not a rate)": "Consultations externes par personne et par mois supérieures à 5 (probablement un nombre, pas un taux)",
    "Mean ANC visits above 12 (likely a count, not a mean)": "Nombre moyen de visites CPN supérieur à 12 (probablement un nombre, pas une moyenne)",
    "Percentage above 100": "Pourcentage supérieur à 100",
    "Coverage above 100% (denominator problem)": "Couverture supérieure à 100 % (problème de dénominateur)"
  };
  const SERVER_FR_PATTERNS = [
    [/^People in need of health assistance 2 million or more(?: \(last plan, (\d{4})\))?$/, (m, y) => `Personnes ayant besoin d'une assistance sanitaire : 2 millions ou plus${y ? ` (dernier plan, ${y})` : ""}`],
    [/^People in need of health assistance 500,000 or more(?: \(last plan, (\d{4})\))?$/, (m, y) => `Personnes ayant besoin d'une assistance sanitaire : 500 000 ou plus${y ? ` (dernier plan, ${y})` : ""}`],
    [/^no humanitarian plan since (\S+)$/, (m, y) => `pas de plan humanitaire depuis ${y}`],
    [/^Annual plan figures count toward the triage tier for up to (\d+) months after the plan ended$/, (m, n) => `Les chiffres d'un plan annuel comptent pour le niveau de triage jusqu'à ${n} mois après la fin du plan`],
    [/^Humanitarian plan (\d{4})$/, (m, y) => `Plan humanitaire ${y}`],
    // French plan titles as published by OCHA: "X Besoins Humanitaires et Plan de Réponse 2026".
    [/^(.+?) Besoins Humanitaires et Plan de Réponse (\d{4})$/, (m, c, y) => `${c} : Besoins humanitaires et plan de réponse ${y}`],
    [/^OCHA Response Monitoring \(HPC\)(.*)$/, (m, rest) => `Suivi de la réponse d'OCHA (HPC)${rest}`],
    [/^HNRP (\d{4}) planning figure \(DHM profile\)$/, (m, y) => `Chiffre de planification du HNRP ${y} (profil DHM)`],
    [/^IOM DTM via HDX HAPI covers part of the country only \((.*)\)$/, (m, x) => `La DTM de l'OIM via HDX HAPI ne couvre qu'une partie du pays (${x})`]
  ];
  function tr(text) {
    if (!isFr() || text == null) return text;
    const s = String(text);
    if (SERVER_FR[s] != null) return frTypo(SERVER_FR[s]);
    for (const [re, fn] of SERVER_FR_PATTERNS) {
      if (re.test(s)) return frTypo(s.replace(re, fn));
    }
    return s;
  }

  function isNum(v) {
    return v != null && Number.isFinite(Number(v));
  }
  function fmtCompact(v) {
    if (!isNum(v)) return na();
    const n = Number(v);
    const abs = Math.abs(n);
    if (isFr()) {
      if (abs >= 1e9) return `${dec(n / 1e9, 2)}${NBSP}Md`;
      if (abs >= 1e6) return `${dec(n / 1e6, abs >= 1e7 ? 1 : 2)}${NBSP}M`;
      if (abs >= 1e4) return `${Math.round(n / 1e3)}${NBSP}k`;
      return Math.round(n).toLocaleString("fr-FR");
    }
    if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
    if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
    return Math.round(n).toLocaleString("en-US");
  }
  function fmtFull(v) {
    return isNum(v) ? Math.round(Number(v)).toLocaleString(isFr() ? "fr-FR" : "en-US") : na();
  }
  function fmtUsd(v) {
    if (!isNum(v)) return na();
    return isFr() ? `${fmtCompact(v)}${NBSP}$${NBSP}US` : `US$${fmtCompact(v)}`;
  }
  function fmtPct(v, digits = 0) {
    if (!isNum(v)) return na();
    return isFr() ? `${dec(Number(v) * 100, digits)}${NBSP}%` : `${(Number(v) * 100).toFixed(digits)}%`;
  }
  function fmtDate(iso) {
    if (!iso) return na();
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(locale(), { day: "numeric", month: isFr() ? "long" : "short", year: "numeric" });
  }
  function fmtMonth(iso) {
    if (!iso) return na();
    if (/^\d{4}$/.test(String(iso))) return L(`${iso} plan`, `plan ${iso}`);
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(locale(), { month: isFr() ? "long" : "short", year: "numeric" });
  }
  // French period "d'avril à juillet 2026" (year once when both ends share it).
  function periodFr(a, b) {
    const da = new Date(a);
    const db = new Date(b);
    if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime()) && da.getFullYear() === db.getFullYear() && !/^\d{4}$/.test(String(a))) {
      return `${deFr(da.toLocaleDateString("fr-FR", { month: "long" }))} à ${fmtMonth(b)}`;
    }
    return `${deFr(fmtMonth(a))} à ${fmtMonth(b)}`;
  }
  // Plotly number separators in French (decimal comma, thin space for thousands).
  function plotLang() {
    return isFr() ? { separators: ", " } : {};
  }
  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function shortName(name) {
    const map = {
      "Democratic Republic of the Congo": "DR Congo",
      "Central African Republic": "CAR",
      "Republic of the Congo": "Congo",
      "São Tomé and Príncipe": "São Tomé & Príncipe"
    };
    const mapFr = {
      "Democratic Republic of the Congo": "RD Congo",
      "Central African Republic": "RCA",
      "Republic of the Congo": "Congo",
      "São Tomé and Príncipe": "Sao Tomé-et-Principe"
    };
    return isFr() ? (mapFr[name] || COUNTRY_FR[name] || name) : (map[name] || name);
  }
  function el(id) {
    return document.getElementById(id);
  }
  function levelTag(level, provisional = false) {
    const color = LEVEL_COLOR[level] || "#b9c4cf";
    const ink = level === "Moderate" || level === "Insufficient data" ? "#0d1f33" : "#fff";
    const title = provisional
      ? L(' title="Provisional: uses the last humanitarian plan\'s figure because the country has no current plan"',
        ' title="Provisoire : utilise le chiffre du dernier plan humanitaire car le pays n\'a pas de plan en cours"')
      : "";
    return `<span class="strat-level${provisional ? " strat-level-provisional" : ""}" style="background:${color};color:${ink}"${title}>${esc(levelName(level))}${provisional ? L(" (provisional)", " (provisoire)") : ""}</span>`;
  }
  function rowTag(r) {
    return levelTag(r.classification.level, Boolean(r.classification.uses_last_plan));
  }
  // Plain-language name for a source string.
  function plainSource(src) {
    if (!src) return "";
    if (/HPC/.test(src)) return L("OCHA Humanitarian Action", "OCHA Humanitarian Action");
    if (/HAPI/.test(src)) return L("OCHA via HDX", "OCHA via HDX");
    if (/profile/i.test(src)) return L("FCV country profile (DHM)", "profil pays FCV (DHM)");
    return src;
  }
  function sourceLine(text) {
    return `<div class="strat-source">${text}</div>`;
  }

  // ---------- data ----------
  function rowsInScope(scope = state.scope) {
    const groups = SCOPE_GROUPS[scope] || SCOPE_GROUPS.fcv13;
    return (state.payload?.countries || []).filter((r) => groups.includes(r.group));
  }
  function sum(rows, getter) {
    return rows.reduce((s, r) => {
      const v = getter(r);
      return isNum(v) ? s + Number(v) : s;
    }, 0);
  }
  function count(rows, getter) {
    return rows.filter((r) => isNum(getter(r))).length;
  }

  function latestServiceQuarter() {
    const rows = state.dash?.service_delivery_quarterly_rows || [];
    const byIso = {};
    rows.forEach((r) => {
      if (!byIso[r.iso3] || Number(r.quarter_sort) > Number(byIso[r.iso3].quarter_sort)) {
        byIso[r.iso3] = r;
      }
    });
    return byIso;
  }

  function median(values) {
    const v = values.filter(isNum).map(Number).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  // ---------- Trends ----------
  // The comparison base is the last monthly snapshot from an earlier month
  // (served by /api/strategic as history.base).
  function baseSnapshot() {
    return state.payload?.history?.base || null;
  }
  function monthLabel(key) {
    if (!key) return "";
    const [y, m] = String(key).split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString(locale(), { month: isFr() ? "long" : "short", year: "numeric", timeZone: "UTC" });
  }
  function nextMonthLabel(key) {
    if (!key) return "";
    const [y, m] = String(key).split("-").map(Number);
    return monthLabel(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`);
  }
  // kind: "pct" (relative change), "pp" (percentage points), "count" (absolute).
  function trendHtml({ cur, prev, kind = "pct", worseWhen = "up", label, unit, prefix }) {
    if (!isNum(cur) || !isNum(prev)) return "";
    let delta;
    let text;
    if (kind === "pp") {
      delta = (cur - prev) * 100;
      text = L(`${Math.abs(delta).toFixed(1)} points`, `${dec(Math.abs(delta), 1)} point${Math.abs(delta) >= 2 ? "s" : ""}`);
    } else if (kind === "count") {
      delta = cur - prev;
      text = fmtFull(Math.abs(delta));
    } else {
      if (!prev) return "";
      delta = ((cur - prev) / prev) * 100;
      text = L(`${Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)}%`, `${dec(Math.abs(delta), Math.abs(delta) < 10 ? 1 : 0)}${NBSP}%`);
    }
    const flat = kind === "count" ? delta === 0 : Math.abs(delta) < 0.5;
    if (flat) return `<span class="strat-trend strat-trend-flat">&#9632; ${esc(prefix || "")}${prefix ? " " : ""}${L("no change", "aucune variation")} ${esc(label)}</span>`;
    const up = delta > 0;
    const bad = worseWhen === "none" ? null : (up === (worseWhen === "up"));
    const cls = bad == null ? "strat-trend-flat" : bad ? "strat-trend-bad" : "strat-trend-good";
    // unit: [singular, plural] in English, optionally [singular, plural, frSingular, frPlural].
    const one = Math.abs(delta) === 1;
    const body = kind === "count" && unit
      ? L(`${text} ${up ? "more" : "fewer"} ${one ? unit[0] : unit[1]}`,
        `${up ? "+" : minus()}${text} ${one ? (unit[2] || unit[0]) : (unit[3] || unit[1])}`)
      : `${esc(prefix || "")}${prefix ? " " : ""}${up ? L("up", "en hausse de") : L("down", "en baisse de")} ${text}`;
    return `<span class="strat-trend ${cls}">${up ? "&#9650;" : "&#9660;"} ${body} ${esc(label)}</span>`;
  }
  // Current and previous totals over the same countries only (those with a value
  // in both months), so a country entering or leaving the data does not move the arrow.
  function pairedSums(rows, field, currentGetter, sameSource = false) {
    const base = baseSnapshot();
    if (!base) return null;
    let cur = 0;
    let prev = 0;
    let n = 0;
    rows.forEach((r) => {
      const b = base.countries?.[r.iso3];
      const c = currentGetter(r);
      if (!b || !isNum(b[field]) || !isNum(c)) return;
      if (sameSource && b.health_in_need_source && b.health_in_need_source !== (r.health_in_need?.plan_code || r.health_in_need?.source)) return;
      cur += Number(c);
      prev += Number(b[field]);
      n += 1;
    });
    return n ? { cur, prev, n } : null;
  }
  function baseSameYear() {
    const base = baseSnapshot();
    return Boolean(base) && String(base.month).slice(0, 4) === String(new Date().getFullYear());
  }
  function sinceLabel() {
    const base = baseSnapshot();
    return base ? L(`since ${monthLabel(base.month)}`, `depuis ${monthLabel(base.month)}`) : "";
  }

  // Latest published Health Cluster reach (OCHA Response Monitoring), grouped
  // by plan year. Past years count only when reporting reached the end of the plan.
  function latestReach(rows) {
    const thisYear = String(new Date().getFullYear());
    const usable = rows.filter((r) => r.health_reach_latest && isNum(r.health_reach_latest.reached)
      && (r.health_reach_latest.full_year || r.health_reach_latest.year === thisYear));
    const partial = rows.filter((r) => r.health_reach_latest && !usable.includes(r));
    const years = [...new Set(usable.map((r) => r.health_reach_latest.year))].sort().reverse();
    if (!years.length) return { year: null, rows: [], partial };
    const year = years[0];
    const inYear = usable.filter((r) => r.health_reach_latest.year === year && isNum(r.health_reach_latest.targeted) && r.health_reach_latest.targeted > 0);
    return {
      year,
      rows: inYear,
      partial,
      reached: sum(inYear, (r) => r.health_reach_latest.reached),
      targeted: sum(inYear, (r) => r.health_reach_latest.targeted),
      lastPeriod: inYear.map((r) => r.health_reach_latest.period_end).sort().pop()
    };
  }

  function computeKpis(rows) {
    const funded = rows.filter((r) => r.health_funding && isNum(r.health_funding.requirements_usd));
    const req = sum(funded, (r) => r.health_funding.requirements_usd);
    const got = sum(funded, (r) => r.health_funding.funding_usd);
    const svc = latestServiceQuarter();
    const svcRows = rows.map((r) => svc[r.iso3]).filter((q) => q && isNum(q.people_reached));
    // The target used is the one the reach was checked against (register or plan).
    const reachTarget = (r) => (isNum(r.health_reached?.targeted) && r.health_reached.targeted > 0 ? r.health_reached.targeted : r.health_targeted?.value);
    const reachRows = rows.filter((r) => isNum(r.health_reached?.value) && isNum(reachTarget(r)) && reachTarget(r) > 0);
    const mhpss = rows
      .map((r) => ({ r, q: svc[r.iso3] }))
      .filter((x) => x.q && isNum(x.q.mental_health_beneficiaries) && isNum(x.r.health_in_need?.value) && x.r.health_in_need.value > 0)
      .map((x) => ({ ...x, rate: (x.q.mental_health_beneficiaries / x.r.health_in_need.value) * 10000 }));
    const core = rows.filter((r) => r.group === "fcv_prioritized" || r.group === "fcv_accelerated");
    return {
      major: rows.filter((r) => r.classification.level === "Major"),
      severe: rows.filter((r) => r.classification.level === "Severe"),
      insufficient: rows.filter((r) => r.classification.level === "Insufficient data"),
      graded: rows.reduce((total, r) => total + (r.who_grades || []).length, 0),
      healthPin: sum(rows, (r) => r.health_in_need?.value),
      healthPinCountries: count(rows, (r) => r.health_in_need?.value),
      healthPinPrevYear: rows.filter((r) => r.health_in_need && String(r.health_in_need.year) !== String(new Date().getFullYear())),
      noHealthPlan: rows.filter((r) => !r.health_in_need),
      lastPlanInTier: rows.filter((r) => r.classification?.uses_last_plan),
      yoyRows: rows.filter((r) => isNum(r.health_in_need?.value) && isNum(r.health_in_need_previous?.value)),
      reachLatest: latestReach(rows),
      pin: sum(rows, (r) => r.people_in_need?.value),
      healthTargeted: sum(rows, (r) => r.health_targeted?.value),
      healthReached: sum(reachRows, (r) => r.health_reached.value),
      healthReachTargeted: sum(reachRows, reachTarget),
      healthReachedCountries: reachRows.length,
      svcReached: sum(svcRows, (q) => q.people_reached),
      svcCountries: svcRows.length,
      svcQuarter: svcRows.map((q) => q.quarter_label).sort().pop() || null,
      req,
      got,
      pct: req ? got / req : null,
      medianPct: median(funded.map((r) => r.health_funding.pct)),
      gap: Math.max(0, req - got),
      fundedPlans: funded.length,
      idps: sum(rows, (r) => (r.idps && !r.idps.stale ? r.idps.value : null)),
      idpsFromPlan: rows.filter((r) => r.idps && !r.idps.stale && /HNRP|profile/i.test(r.idps.source || "")).length,
      refugees: sum(rows, (r) => r.refugees?.value),
      attacks: sum(rows, (r) => r.attacks?.ytd?.attacks),
      deaths: sum(rows, (r) => r.attacks?.ytd?.deaths),
      injuries: sum(rows, (r) => r.attacks?.ytd?.injuries),
      ssaCountries: rows.filter((r) => r.attacks).length,
      notInSsa: rows.filter((r) => !r.attacks),
      mhpss,
      mhpssMedian: median(mhpss.map((x) => x.rate)),
      coverage: {
        total: core.length || rows.length,
        plan: rows.filter((r) => r.health_funding).length,
        ipc: rows.filter((r) => r.ipc && !r.ipc.stale).length,
        displacement: rows.filter((r) => r.idps && !r.idps.stale).length,
        ssa: rows.filter((r) => r.attacks).length,
        n: rows.length
      }
    };
  }

  // ---------- Overview ----------
  function kpiCard({ id, title, value, sub, source, target, tone, trend }) {
    const trends = (Array.isArray(trend) ? trend : [trend]).filter(Boolean);
    return `
      <button type="button" class="strat-kpi ${tone ? `strat-kpi-${tone}` : ""}" data-strat-target="${esc(target || "")}" id="${id}">
        <span class="strat-kpi-title">${title}</span>
        <span class="strat-kpi-value">${value}</span>
        ${trends.length ? `<span class="strat-kpi-trends">${trends.join("")}</span>` : ""}
        <span class="strat-kpi-sub">${sub}</span>
        ${sourceLine(source)}
      </button>`;
  }

  function renderKpis() {
    const grid = el("stratKpiGrid");
    if (!grid) return;
    const rows = rowsInScope();
    const k = computeKpis(rows);
    const src = state.payload.sources;
    const ftsDate = fmtDate(src.fts.fetched_at);
    const hapiDate = fmtDate(src.hapi.fetched_at);
    const ssaDate = fmtDate(src.ssa.fetched_at);
    const hpcDate = src.hpc?.fetched_at ? fmtDate(src.hpc.fetched_at) : null;

    const thisYear = String(new Date().getFullYear());
    const rl = k.reachLatest;
    const plansWithTarget = rows.filter((r) => isNum(r.health_targeted?.value)).length;
    let reachValue;
    let reachSub;
    let reachSource;
    let reachTone = "warn";
    if (k.healthReachedCountries) {
      reachValue = fmtPct(k.healthReached / Math.max(1, k.healthReachTargeted));
      const fromRegister = rows.filter((r) => /Health Cluster report/.test(r.health_reached?.source || ""));
      const latestEnd = rows.map((r) => r.health_reached?.period_end).filter(Boolean).sort().pop();
      const regNames = fromRegister.map((r) => esc(shortName(r.country))).join(", ");
      reachSub = L(
        `${fmtCompact(k.healthReached)} reached of ${fmtCompact(k.healthReachTargeted)} targeted in ${k.healthReachedCountries} countries so far in ${thisYear}${latestEnd ? ` (latest report to ${fmtMonth(latestEnd)})` : ""}.${fromRegister.length ? ` From Health Cluster reports for ${regNames}, until OCHA publishes.` : ""}`,
        `${fmtCompact(k.healthReached)} personnes atteintes sur ${fmtCompact(k.healthReachTargeted)} ciblées dans ${k.healthReachedCountries} pays à ce jour en ${thisYear}${latestEnd ? ` (dernier rapport jusqu'à ${fmtMonth(latestEnd)})` : ""}.${fromRegister.length ? ` Selon les rapports du Cluster Santé pour ${frList(fromRegister)}, en attendant la publication d'OCHA.` : ""}`);
      reachSource = fromRegister.length === k.healthReachedCountries
        ? L(`Health Cluster reports entered by DHM (references on each country card)`, `Rapports du Cluster Santé saisis par la DHM (références sur chaque fiche pays)`)
        : fromRegister.length
          ? L(`OCHA Humanitarian Action and Health Cluster reports entered by DHM, ${hpcDate || "n/a"}`, `OCHA Humanitarian Action et rapports du Cluster Santé saisis par la DHM, ${hpcDate || na()}`)
          : L(`OCHA Humanitarian Action (response monitoring), ${hpcDate || "n/a"}`, `OCHA Humanitarian Action (suivi de la réponse), ${hpcDate || na()}`);
      reachTone = "";
    } else if (rl.year) {
      const rates = rl.rows.map((r) => ({ r, v: r.health_reach_latest.reached / r.health_reach_latest.targeted })).sort((x, y) => x.v - y.v);
      const range = rates.length > 1
        ? L(` Range ${fmtPct(rates[0].v)} (${esc(shortName(rates[0].r.country))}) to ${fmtPct(rates[rates.length - 1].v)} (${esc(shortName(rates[rates.length - 1].r.country))}).`,
          ` De ${fmtPct(rates[0].v)} (${esc(shortName(rates[0].r.country))}) à ${fmtPct(rates[rates.length - 1].v)} (${esc(shortName(rates[rates.length - 1].r.country))}).`)
        : "";
      const partialNames = rl.partial.map((r) => esc(shortName(r.country))).join(", ");
      reachValue = L(`${fmtPct(rl.reached / Math.max(1, rl.targeted))}<small> in ${esc(rl.year)}, ${rl.rows.length} countries</small>`,
        `${fmtPct(rl.reached / Math.max(1, rl.targeted))}<small> en ${esc(rl.year)}, ${rl.rows.length} pays</small>`);
      reachSub = L(
        `No ${thisYear} figures published yet. Final ${esc(rl.year)} results exist for ${rl.rows.length} of ${plansWithTarget} countries with a plan: ${fmtCompact(rl.reached)} reached of ${fmtCompact(rl.targeted)} targeted.${range}${rl.partial.length ? ` No year-end figure published for ${partialNames}.` : ""}`,
        `Aucun chiffre ${thisYear} publié à ce jour. Des résultats définitifs ${esc(rl.year)} existent pour ${rl.rows.length} des ${plansWithTarget} pays dotés d'un plan : ${fmtCompact(rl.reached)} personnes atteintes sur ${fmtCompact(rl.targeted)} ciblées.${range}${rl.partial.length ? ` Aucun chiffre de fin d'année publié pour ${frList(rl.partial)}.` : ""}`);
      reachSource = L(`OCHA Humanitarian Action (response monitoring), ${hpcDate || "n/a"}`, `OCHA Humanitarian Action (suivi de la réponse), ${hpcDate || na()}`);
    } else {
      reachValue = L("Awaiting data", "En attente de données");
      reachSub = L(
        `Plans target ${fmtCompact(k.healthTargeted)} people (${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))} of need). Country office reports in the FCV service database: ${fmtCompact(k.svcReached)} service contacts in ${k.svcCountries} countries.`,
        `Les plans ciblent ${fmtCompact(k.healthTargeted)} personnes (${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))} des besoins). Rapports des bureaux de pays dans la base de données des services FCV : ${fmtCompact(k.svcReached)} contacts de service dans ${k.svcCountries} pays.`);
      reachSource = L("No Health Cluster reach published yet by OCHA", "Aucune couverture du Cluster Santé encore publiée par OCHA");
    }

    // Trends: month on month from the stored snapshots, and year on year where the source carries it.
    const since = sinceLabel();
    const base = baseSnapshot();
    // Compare only countries with a tier in both months: a move to or from
    // "Insufficient data" is a data change, not a change on the ground.
    const tiered = (lvl) => lvl && lvl !== "Insufficient data";
    const bothTiered = base ? rows.filter((r) => tiered(base.countries?.[r.iso3]?.level) && tiered(r.classification.level)) : [];
    const crisesNowPaired = bothTiered.filter((r) => ["Major", "Severe"].includes(r.classification.level)).length;
    const crisesPrev = base ? bothTiered.filter((r) => ["Major", "Severe"].includes(base.countries[r.iso3].level)).length : null;
    const tierMoves = base ? rows.filter((r) => base.countries?.[r.iso3]?.level && base.countries[r.iso3].level !== r.classification.level) : [];
    const moveNote = tierMoves.length
      ? L(`<br>Changed tier ${esc(since)}: ${tierMoves.map((r) => `${esc(shortName(r.country))} (${esc(base.countries[r.iso3].level)} to ${esc(r.classification.level)})`).join(", ")}.`,
        `<br>Changement de niveau ${esc(since)} : ${tierMoves.map((r) => `${esc(shortName(r.country))} (${esc(levelName(base.countries[r.iso3].level))} à ${esc(levelName(r.classification.level))})`).join(", ")}.`)
      : "";
    const yoyCur = sum(k.yoyRows, (r) => r.health_in_need.value);
    const yoyPrev = sum(k.yoyRows, (r) => r.health_in_need_previous.value);
    const yoyTrend = k.yoyRows.length
      ? trendHtml({ cur: yoyCur, prev: yoyPrev, worseWhen: "none", label: L(`vs ${Number(thisYear) - 1} plans (same ${k.yoyRows.length} countries)`, `par rapport aux plans ${Number(thisYear) - 1} (mêmes ${k.yoyRows.length} pays)`) })
      : "";
    // Funding and need are compared month on month only within the same plan year.
    const fundReq = baseSameYear() ? pairedSums(rows, "health_requirements_usd", (r) => r.health_funding?.requirements_usd) : null;
    const fundGot = baseSameYear() ? pairedSums(rows, "health_funding_usd", (r) => (r.health_funding ? r.health_funding.funding_usd : null)) : null;
    const fundTrend = fundReq && fundGot && fundReq.prev > 0 && fundReq.cur > 0
      ? trendHtml({ cur: fundGot.cur / fundReq.cur, prev: fundGot.prev / fundReq.prev, kind: "pp", worseWhen: "down", prefix: L("funding", "financement"), label: since })
      : "";
    const pinPair = baseSameYear() ? pairedSums(rows, "health_in_need", (r) => r.health_in_need?.value, true) : null;
    const dispPair = pairedSums(rows, "displaced", (r) => ((r.idps && !r.idps.stale ? r.idps.value : 0) + (r.refugees?.value || 0)) || null);
    const attacksBaseSameYear = base && String(base.month).slice(0, 4) === thisYear;
    const ssaRows = rows.filter((r) => r.attacks?.prev_ytd);
    const attacksYoy = ssaRows.length
      ? trendHtml({ cur: sum(ssaRows, (r) => r.attacks.ytd.attacks), prev: sum(ssaRows, (r) => r.attacks.prev_ytd.attacks), label: L("vs same period last year", "par rapport à la même période l'an dernier") })
      : "";
    const attPair = attacksBaseSameYear ? pairedSums(rows, "attacks_ytd", (r) => r.attacks?.ytd?.attacks) : null;
    const attacksSince = attPair
      ? `<span class="strat-trend strat-trend-flat">${attPair.cur > attPair.prev
        ? L(`${fmtFull(attPair.cur - attPair.prev)} new attacks recorded`, `${fmtFull(attPair.cur - attPair.prev)} nouvelle${attPair.cur - attPair.prev > 1 ? "s" : ""} attaque${attPair.cur - attPair.prev > 1 ? "s" : ""} enregistrée${attPair.cur - attPair.prev > 1 ? "s" : ""}`)
        : L("no new attacks recorded", "aucune nouvelle attaque enregistrée")} ${esc(since)}</span>`
      : "";

    const prevYearNote = k.healthPinPrevYear.length
      ? L(` Uses the ${Number(thisYear) - 1} plan figure for ${k.healthPinPrevYear.map((r) => esc(shortName(r.country))).join(", ")}.`,
        ` Chiffre du plan ${Number(thisYear) - 1} utilisé pour ${frList(k.healthPinPrevYear)}.`)
      : "";
    const noPlan = k.noHealthPlan.map((r) => `${esc(shortName(r.country))}${r.health_outdated ? L(` (last plan ${esc(r.health_outdated.year)})`, ` (dernier plan ${esc(r.health_outdated.year)})`) : ""}`);
    const noPlanNote = noPlan.length ? L(` No current plan: ${noPlan.join(", ")}; not in the total.`, ` Pas de plan en cours : ${noPlan.join(", ")} ; non inclus dans le total.`) : "";
    const revised = rows.filter((r) => r.health_in_need?.alt);
    const revisedNote = revised.length
      ? L(` Revised plan figures used for ${revised.map((r) => `${esc(shortName(r.country))} (${fmtCompact(r.health_in_need.value)}; earlier version ${fmtCompact(r.health_in_need.alt.value)})`).join(", ")}.`,
        ` Chiffres du plan révisé utilisés pour ${frList(revised, (r) => `${fmtCompact(r.health_in_need.value)} ; version antérieure ${fmtCompact(r.health_in_need.alt.value)}`)}.`)
      : "";
    const pinSources = [...new Set(rows.map((r) => r.health_in_need?.source).filter(Boolean)
      .map(plainSource))];

    grid.innerHTML = [
      kpiCard({
        id: "kpiCrises",
        title: L("Countries in major or severe crisis", "Pays en crise majeure ou sévère"),
        value: L(`${k.major.length + k.severe.length}<small> of ${rows.length}</small>`, `${k.major.length + k.severe.length}<small> sur ${rows.length}</small>`),
        sub: L(
          `Major: ${k.major.map((r) => esc(shortName(r.country))).join(", ") || "none"}. Severe: ${k.severe.length}. Insufficient data: ${k.insufficient.map((r) => esc(shortName(r.country))).join(", ") || "none"}.${k.lastPlanInTier.length ? ` Tier uses the last plan figure for ${k.lastPlanInTier.map((r) => esc(shortName(r.country))).join(", ")}.` : ""}${moveNote}<br>WHO grades: ${k.graded ? `${k.graded} recorded` : "none recorded yet"}.`,
          `Majeur : ${k.major.map((r) => esc(shortName(r.country))).join(", ") || "aucun"}. Sévère : ${k.severe.length}. Données insuffisantes : ${k.insufficient.map((r) => esc(shortName(r.country))).join(", ") || "aucun"}.${k.lastPlanInTier.length ? ` Le niveau utilise le chiffre du dernier plan pour ${frList(k.lastPlanInTier)}.` : ""}${moveNote}<br>Grades OMS : ${k.graded ? `${k.graded} enregistré${k.graded > 1 ? "s" : ""}` : "aucun enregistré à ce jour"}.`),
        source: L("DHM triage tier from verified indicators; not a WHO grade", "Niveau de triage DHM fondé sur des indicateurs vérifiés ; ce n'est pas un grade OMS"),
        target: "gradingPage",
        tone: k.major.length ? "bad" : "",
        trend: base ? trendHtml({ cur: crisesNowPaired, prev: crisesPrev, kind: "count", unit: ["country", "countries", "pays", "pays"], label: since }) : ""
      }),
      kpiCard({
        id: "kpiHealthPin",
        title: L("People in need of health assistance", "Personnes ayant besoin d'une assistance sanitaire"),
        value: fmtCompact(k.healthPin),
        sub: L(`${k.healthPinCountries} countries. All sectors: ${fmtCompact(k.pin)} people in need.${revisedNote}${prevYearNote}${noPlanNote}`,
          `${k.healthPinCountries} pays. Tous secteurs : ${fmtCompact(k.pin)} personnes dans le besoin.${revisedNote}${prevYearNote}${noPlanNote}`),
        source: L(`Humanitarian plans: ${pinSources.join(", ") || "OCHA via HDX"}, ${hpcDate || hapiDate}`, `Plans de réponse humanitaire : ${pinSources.join(", ") || "OCHA via HDX"}, ${hpcDate || hapiDate}`),
        target: "overviewPage#stratTable",
        trend: [pinPair ? trendHtml({ cur: pinPair.cur, prev: pinPair.prev, label: since }) : "", yoyTrend]
      }),
      kpiCard({
        id: "kpiReach",
        title: L("Health reach against target", "Couverture sanitaire par rapport à la cible"),
        value: reachValue,
        sub: reachSub,
        source: reachSource,
        target: "overviewPage#stratCoverageChart",
        tone: reachTone
      }),
      kpiCard({
        id: "kpiFunding",
        title: L("Health funding gap (2026 plans)", "Déficit de financement de la santé (plans 2026)"),
        value: fmtUsd(k.gap),
        sub: L(`${fmtPct(k.pct)} of ${fmtUsd(k.req)} received across ${k.fundedPlans} plans; median country ${fmtPct(k.medianPct)}. Excludes refugee response plans and funding not assigned to a cluster.`,
          `${fmtPct(k.pct)} de ${fmtUsd(k.req)} reçus pour ${k.fundedPlans} plans ; médiane par pays ${fmtPct(k.medianPct)}. Hors plans de réponse pour les réfugiés et financements non affectés à un cluster.`),
        source: L(`OCHA FTS, health cluster requirements and reported funding, ${ftsDate}`, `FTS d'OCHA, besoins du Cluster Santé et financements déclarés, ${ftsDate}`),
        target: "overviewPage#stratFundingChart",
        tone: k.medianPct != null && k.medianPct < 0.5 ? "bad" : "warn",
        trend: fundTrend
      }),
      kpiCard({
        id: "kpiDisplaced",
        title: L("Displaced people", "Personnes déplacées"),
        value: fmtCompact(k.idps + k.refugees),
        sub: L(`${fmtCompact(k.idps)} internally displaced and ${fmtCompact(k.refugees)} refugees and asylum seekers hosted.${k.idpsFromPlan ? ` ${k.idpsFromPlan} countries use the 2026 plan figure where IOM DTM is outdated or partial.` : ""}`,
          `${fmtCompact(k.idps)} déplacés internes et ${fmtCompact(k.refugees)} réfugiés et demandeurs d'asile accueillis.${k.idpsFromPlan ? ` ${k.idpsFromPlan} pays utilisent le chiffre du plan 2026 lorsque la DTM de l'OIM est obsolète ou partielle.` : ""}`),
        source: L(`IOM DTM and UNHCR via HDX HAPI, ${hapiDate}`, `DTM de l'OIM et HCR via HDX HAPI, ${hapiDate}`),
        target: "conflictsDisplacementPage",
        trend: dispPair ? trendHtml({ cur: dispPair.cur, prev: dispPair.prev, label: since }) : ""
      }),
      kpiCard({
        id: "kpiAttacks",
        title: L("Attacks on health care this year", "Attaques contre les soins de santé cette année"),
        value: fmtFull(k.attacks),
        sub: L(`${fmtFull(k.deaths)} health workers and patients killed, ${fmtFull(k.injuries)} injured, in ${k.ssaCountries} countries with WHO surveillance.${k.notInSsa.length ? ` Not covered: ${k.notInSsa.map((r) => esc(shortName(r.country))).join(", ")}.` : ""}`,
          `${k.deaths === 0 ? "Aucun agent de santé ni patient tué" : `${fmtFull(k.deaths)} ${k.deaths === 1 ? "agent de santé ou patient tué" : "agents de santé et patients tués"}`}, ${injuredFr(k.injuries)}, dans ${k.ssaCountries} pays couverts par la surveillance de l'OMS.${k.notInSsa.length ? ` Non couverts : ${k.notInSsa.map((r) => esc(shortName(r.country))).join(", ")}.` : ""}`),
        source: L(`WHO Surveillance System for Attacks on Health Care (SSA), ${ssaDate}`, `Système de surveillance des attaques contre les soins de santé (SSA) de l'OMS, ${ssaDate}`),
        target: "attacksHealthPage",
        tone: k.deaths > 0 ? "bad" : "",
        trend: [attacksYoy, attacksSince]
      }),
      kpiCard({
        id: "kpiMhpss",
        title: L("Mental health and psychosocial support", "Santé mentale et soutien psychosocial"),
        value: k.mhpssMedian != null ? L(`${k.mhpssMedian.toFixed(0)}<small> per 10,000</small>`, `${k.mhpssMedian.toFixed(0)}<small> pour 10${NBSP}000</small>`) : na(),
        sub: k.mhpss.length
          ? L(`Median people reached with MHPSS in the latest quarter per 10,000 people in need of health assistance (${k.mhpss.length} countries). No regional MHPSS target is published, so the gap cannot yet be sized.`,
            `Nombre médian de personnes ayant bénéficié de services de SMSPS au dernier trimestre pour 10${NBSP}000 personnes ayant besoin d'une assistance sanitaire (${k.mhpss.length} pays). Aucune cible régionale de SMSPS n'est publiée ; l'écart ne peut donc pas encore être mesuré.`)
          : L("No MHPSS figures reported for this scope.", "Aucun chiffre de SMSPS déclaré pour ce périmètre."),
        source: L("FCV service database (WHO country offices); OCHA plans for the denominator", "Base de données des services FCV (bureaux de pays de l'OMS) ; plans d'OCHA pour le dénominateur"),
        target: "overviewPage#stratMhpssChart",
        tone: "warn"
      }),
      kpiCard({
        id: "kpiCoverage",
        title: L("Data coverage", "Couverture des données"),
        value: L(`${k.coverage.plan}<small> of ${k.coverage.n} with funded plan data</small>`, `${k.coverage.plan}<small> sur ${k.coverage.n} avec des données de financement du plan</small>`),
        sub: L(`Current IPC/CH analysis: ${k.coverage.ipc}. Current displacement figure: ${k.coverage.displacement}. WHO attack surveillance: ${k.coverage.ssa}.`,
          `Analyse IPC/CH à jour : ${k.coverage.ipc}. Chiffre de déplacement à jour : ${k.coverage.displacement}. Surveillance des attaques par l'OMS : ${k.coverage.ssa}.`),
        source: L("Shows how complete the figures above are", "Indique le degré de complétude des chiffres ci-dessus"),
        target: "dataHealthPage#dataHealthSources"
      })
    ].join("");

    let note = el("stratTrendNote");
    if (!note) {
      note = document.createElement("p");
      note.id = "stratTrendNote";
      note.className = "strat-trend-note muted";
      grid.insertAdjacentElement("afterend", note);
    }
    const hist = state.payload.history || {};
    note.innerHTML = base
      ? L(`Arrows compare with the last snapshot of ${esc(monthLabel(base.month))} (taken ${esc(fmtDate(base.taken_at))}), using only countries with figures in both months. Year-on-year arrows compare with the previous plan or the same period last year. Red means worse, green better, grey shows the change without judging it (plan methods change between years).`,
        `Les flèches comparent avec le dernier instantané ${esc(deFr(monthLabel(base.month)))} (pris le ${esc(fmtDate(base.taken_at))}), en ne retenant que les pays disposant de chiffres pour les deux mois. Les flèches d'une année sur l'autre comparent avec le plan précédent ou la même période de l'année dernière. Le rouge signale une dégradation, le vert une amélioration, le gris une variation sans jugement (les méthodes des plans changent d'une année à l'autre).`)
      : L(`Month-on-month arrows start in ${esc(nextMonthLabel(hist.first_month || new Date().toISOString().slice(0, 7)))}, once a full month of snapshots exists. Year-on-year arrows already compare with the previous plan or the same period last year. Red means worse, green better, grey shows the change without judging it (plan methods change between years).`,
        `Les flèches d'un mois sur l'autre apparaîtront à partir ${esc(deFr(nextMonthLabel(hist.first_month || new Date().toISOString().slice(0, 7))))}, lorsqu'un mois complet d'instantanés sera disponible. Les flèches d'une année sur l'autre comparent déjà avec le plan précédent ou la même période de l'année dernière. Le rouge signale une dégradation, le vert une amélioration, le gris une variation sans jugement (les méthodes des plans changent d'une année à l'autre).`);
  }

  function renderMessages() {
    const list = el("stratMessages");
    if (!list) return;
    list.innerHTML = buildMessages(rowsInScope()).map((m) => `<li>${m}</li>`).join("");
  }

  function buildMessages(rows) {
    const k = computeKpis(rows);
    const messages = [];

    const byPin = rows.filter((r) => isNum(r.health_in_need?.value)).sort((a, b) => b.health_in_need.value - a.health_in_need.value);
    const top3 = byPin.slice(0, 3);
    if (top3.length) {
      const share = sum(top3, (r) => r.health_in_need.value) / Math.max(1, k.healthPin);
      const ipcTop = rows
        .filter((r) => r.ipc && !r.ipc.stale && isNum(r.ipc.fraction))
        .sort((a, b) => b.ipc.fraction - a.ipc.fraction)[0];
      const top3Text = top3.map((r) => `${esc(shortName(r.country))} (${fmtCompact(r.health_in_need.value)})`).join(", ");
      messages.push(L(
        `<strong>Where the burden sits.</strong> ${top3Text} account for ${fmtPct(share)} of people in need of health assistance in this scope.`
        + (ipcTop ? ` The highest share in crisis-level food insecurity or worse (IPC/CH Phase 3+) is in ${esc(shortName(ipcTop.country))}: ${fmtPct(ipcTop.ipc.fraction)} of the population analysed, ${ipcTop.ipc.kind === "current" ? "current analysis" : "projection"} for ${fmtMonth(ipcTop.ipc.period_start)} to ${fmtMonth(ipcTop.ipc.period_end)}.` : ""),
        `<strong>Où se concentre la charge.</strong> ${cap(frList(top3, (r) => fmtCompact(r.health_in_need.value)))} ${top3.length > 1 ? "représentent" : "représente"} ${fmtPct(share)} des personnes ayant besoin d'une assistance sanitaire dans ce périmètre.`
        + (ipcTop ? ` La part la plus élevée en insécurité alimentaire de niveau crise ou pire (phase 3+ IPC/CH) concerne ${esc(frArt(ipcTop.country))} : ${fmtPct(ipcTop.ipc.fraction)} de la population analysée, ${ipcTop.ipc.kind === "current" ? "analyse de la situation actuelle" : "projection"} pour la période ${periodFr(ipcTop.ipc.period_start, ipcTop.ipc.period_end)}.` : "")
      ));
    }

    const rising = rows
      .filter((r) => r.attacks?.prev_ytd)
      .map((r) => ({ r, cur: r.attacks.ytd.attacks, prev: r.attacks.prev_ytd.attacks, deaths: r.attacks.ytd.deaths }))
      .filter((x) => x.cur >= 10 && x.cur > x.prev * 1.25)
      .sort((a, b) => b.cur - a.cur);
    const majors = k.major.map((r) => esc(shortName(r.country)));
    const thisYear = new Date().getFullYear();
    messages.push(L(
      `<strong>What is getting worse.</strong> ${majors.length ? `${majors.join(", ")} ${majors.length === 1 ? "is" : "are"} in the major tier of the DHM triage classification (a status, not a trend). ` : ""}`
      + (rising.length
        ? `Attacks on health care are up on the same period of ${thisYear - 1} in ${rising.map((x) => `${esc(shortName(x.r.country))} (${x.cur} against ${x.prev}${x.deaths ? `, ${x.deaths} people killed` : ""})`).join("; ")}.`
        : `No WHO-monitored country shows a clear rise in attacks on health care (10 or more and at least 25% above the same period of ${thisYear - 1}).`),
      `<strong>Ce qui se dégrade.</strong> ${majors.length ? `${cap(frList(k.major))} ${majors.length === 1 ? "est classé" : "sont classés"} au niveau majeur de la classification de triage DHM (un état, pas une tendance). ` : ""}`
      + (rising.length
        ? `Les attaques contre les soins de santé sont en hausse par rapport à la même période de ${thisYear - 1} dans les pays suivants : ${rising.map((x) => `${esc(shortName(x.r.country))} (${x.cur} contre ${x.prev}${x.deaths ? `, ${fmtFull(x.deaths)} personne${x.deaths > 1 ? "s" : ""} tuée${x.deaths > 1 ? "s" : ""}` : ""})`).join(" ; ")}.`
        : `Aucun pays suivi par l'OMS ne montre de hausse nette des attaques contre les soins de santé (10 ou plus et au moins 25${NBSP}% au-dessus de la même période de ${thisYear - 1}).`)
    ));

    const funded = rows.filter((r) => r.health_funding && isNum(r.health_funding.pct)).sort((a, b) => a.health_funding.pct - b.health_funding.pct);
    if (funded.length) {
      const low = funded.slice(0, 3);
      const biggestGap = funded.slice().sort((a, b) => b.health_funding.gap_usd - a.health_funding.gap_usd)[0];
      const lowText = low.map((r) => `${esc(shortName(r.country))} (${fmtPct(r.health_funding.pct)})`).join(", ");
      messages.push(L(
        `<strong>Funding point for management.</strong> Health funding coverage is lowest in ${lowText}; the median per country is ${fmtPct(k.medianPct)}. The largest unfunded health requirement is ${esc(shortName(biggestGap.country))} (${fmtUsd(biggestGap.health_funding.gap_usd)}). Possible action: raise these in donor briefings and pooled-fund discussions.`,
        `<strong>Point de financement pour la direction.</strong> La couverture du financement de la santé est la plus faible pour ${frList(low, (r) => fmtPct(r.health_funding.pct))} ; la médiane par pays est de ${fmtPct(k.medianPct)}. Le besoin sanitaire non financé le plus important concerne ${esc(frArt(biggestGap.country))} (${fmtUsd(biggestGap.health_funding.gap_usd)}). Action possible : soulever ces points lors des réunions d'information des bailleurs et des discussions sur les fonds communs.`
      ));
    }
    return messages;
  }

  function mapValue(r, layer) {
    switch (layer) {
      case "classification": return LEVEL_ORDER[r.classification.level] ?? null;
      case "health_pin": return r.health_in_need?.value ?? null;
      case "funding_pct": return r.health_funding && isNum(r.health_funding.pct) ? r.health_funding.pct * 100 : null;
      case "displaced": {
        const v = (r.idps && !r.idps.stale ? r.idps.value : 0) + (r.refugees?.value || 0);
        return v || null;
      }
      case "ipc": return r.ipc && !r.ipc.stale && isNum(r.ipc.fraction) ? r.ipc.fraction * 100 : null;
      case "attacks": return r.attacks ? r.attacks.ytd.attacks : null;
      default: return null;
    }
  }

  function mapHover(r) {
    const parts = isFr()
      ? [
        `<b>${cname(r.country)}</b>`,
        `Niveau DHM : ${levelName(r.classification.level)} (${r.classification.score}/${r.classification.max_score})`,
        `Personnes dans le besoin (santé) : ${fmtCompact(r.health_in_need?.value)}`,
        `Santé financée : ${r.health_funding ? fmtPct(r.health_funding.pct) : "pas de données de plan"}`,
        `Déplacés internes : ${fmtCompact(r.idps?.value)} | Réfugiés : ${fmtCompact(r.refugees?.value)}`,
        `IPC 3+ : ${r.ipc && !r.ipc.stale ? fmtPct(r.ipc.fraction) : "pas d'analyse à jour"}`,
        `Attaques cette année : ${r.attacks ? r.attacks.ytd.attacks : "non suivi par le SSA"}`
      ]
      : [
        `<b>${r.country}</b>`,
        `DHM tier: ${r.classification.level} (${r.classification.score}/${r.classification.max_score})`,
        `Health PiN: ${fmtCompact(r.health_in_need?.value)}`,
        `Health funded: ${r.health_funding ? fmtPct(r.health_funding.pct) : "no plan data"}`,
        `IDPs: ${fmtCompact(r.idps?.value)} | Refugees: ${fmtCompact(r.refugees?.value)}`,
        `IPC 3+: ${r.ipc && !r.ipc.stale ? fmtPct(r.ipc.fraction) : "no current analysis"}`,
        `Attacks this year: ${r.attacks ? r.attacks.ytd.attacks : "not monitored by SSA"}`
      ];
    return parts.join("<br>");
  }

  function renderMap() {
    const node = el("stratMap");
    if (!node || typeof Plotly === "undefined") return;
    const rows = rowsInScope();
    const layer = state.mapLayer;
    const withVal = rows.map((r) => ({ r, v: mapValue(r, layer) }));
    const present = withVal.filter((x) => x.v != null);
    const missing = withVal.filter((x) => x.v == null);

    let trace;
    if (layer === "classification") {
      trace = {
        type: "choropleth",
        locationmode: "ISO-3",
        locations: present.map((x) => x.r.iso3),
        z: present.map((x) => x.v),
        zmin: 0,
        zmax: 3,
        colorscale: [
          [0, LEVEL_COLOR["Insufficient data"]], [0.25, LEVEL_COLOR["Insufficient data"]],
          [0.25, LEVEL_COLOR.Moderate], [0.5, LEVEL_COLOR.Moderate],
          [0.5, LEVEL_COLOR.Severe], [0.75, LEVEL_COLOR.Severe],
          [0.75, LEVEL_COLOR.Major], [1, LEVEL_COLOR.Major]
        ],
        colorbar: { tickvals: [0.4, 1.1, 1.9, 2.6], ticktext: isFr() ? ["Pas de données", "Modéré", "Sévère", "Majeur"] : ["No data", "Moderate", "Severe", "Major"], thickness: 12, len: 0.6 },
        text: present.map((x) => mapHover(x.r)),
        hoverinfo: "text",
        marker: { line: { color: "#ffffff", width: 0.8 } }
      };
    } else {
      const reversed = layer === "funding_pct";
      trace = {
        type: "choropleth",
        locationmode: "ISO-3",
        locations: present.map((x) => x.r.iso3),
        z: present.map((x) => x.v),
        colorscale: reversed
          ? [[0, "#8e1b3a"], [0.5, "#f0b45b"], [1, "#2e8b6e"]]
          : [[0, "#fde6c8"], [0.5, "#e8743b"], [1, "#7a1f3d"]],
        zmin: reversed ? 0 : undefined,
        zmax: reversed ? 100 : undefined,
        colorbar: { thickness: 12, len: 0.6, ticksuffix: layer === "funding_pct" || layer === "ipc" ? L("%", " %") : "" },
        text: present.map((x) => mapHover(x.r)),
        hoverinfo: "text",
        marker: { line: { color: "#ffffff", width: 0.8 } }
      };
    }
    const grey = {
      type: "choropleth",
      locationmode: "ISO-3",
      locations: missing.map((x) => x.r.iso3),
      z: missing.map(() => 1),
      colorscale: [[0, "#dfe6ee"], [1, "#dfe6ee"]],
      showscale: false,
      text: missing.map((x) => `${mapHover(x.r)}<br><i>${L("No value for this layer", "Aucune valeur pour cette couche")}</i>`),
      hoverinfo: "text",
      marker: { line: { color: "#ffffff", width: 0.8 } }
    };
    const layout = {
      geo: {
        scope: "africa",
        projection: { type: "mercator" },
        showland: true,
        landcolor: "#f1f5f9",
        showcountries: true,
        countrycolor: "#ffffff",
        showframe: false,
        bgcolor: "rgba(0,0,0,0)",
        lataxis: { range: [-36, 24] },
        lonaxis: { range: [-20, 52] }
      },
      margin: { l: 0, r: 0, t: 0, b: 0 },
      paper_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      height: 430,
      ...plotLang()
    };
    plot(node, [grey, trace, labelTrace(rows, layer)], layout);
    renderMapNote();
  }

  function renderFundingChart() {
    const node = el("stratFundingChart");
    if (!node || typeof Plotly === "undefined") return;
    const rows = rowsInScope().filter((r) => r.health_funding).sort((a, b) => a.health_funding.gap_usd - b.health_funding.gap_usd);
    if (!rows.length) {
      emptyNote(node, L("No health cluster funding data for the selected scope.", "Aucune donnée de financement du Cluster Santé pour le périmètre sélectionné."));
      return;
    }
    const names = rows.map((r) => shortName(r.country));
    const fundedTrace = {
      type: "bar",
      orientation: "h",
      name: L("Funded", "Financé"),
      y: names,
      x: rows.map((r) => r.health_funding.funding_usd / 1e6),
      marker: { color: "#2e8b6e" },
      hovertemplate: L("%{y}<br>Funded: US$%{x:.1f}M<extra></extra>", "%{y}<br>Financé : %{x:.1f} M$ US<extra></extra>")
    };
    const gapTrace = {
      type: "bar",
      orientation: "h",
      name: L("Unfunded", "Non financé"),
      y: names,
      x: rows.map((r) => r.health_funding.gap_usd / 1e6),
      marker: { color: "#e8a33b" },
      text: rows.map((r) => L(`${fmtPct(r.health_funding.pct)} funded`, `${fmtPct(r.health_funding.pct)} financé`)),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: L("%{y}<br>Unfunded: US$%{x:.1f}M<extra></extra>", "%{y}<br>Non financé : %{x:.1f} M$ US<extra></extra>")
    };
    const layout = {
      barmode: "stack",
      margin: { l: 110, r: 80, t: 10, b: 40 },
      height: Math.max(300, 34 * rows.length + 80),
      xaxis: { title: { text: L("Health requirement, US$ million", "Besoins en santé, millions de dollars US") }, gridcolor: "#e6edf5", zeroline: false },
      yaxis: { automargin: true },
      legend: { orientation: "h", y: -0.18 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      ...plotLang()
    };
    plot(node, [fundedTrace, gapTrace], layout);
  }

  function cellStale(text, stale, title) {
    return stale ? `<span class="strat-stale" title="${esc(title || L("Outside the freshness rule; excluded from totals", "Hors de la règle de fraîcheur ; exclu des totaux"))}">${text}</span>` : text;
  }

  function renderTable() {
    const table = el("stratTable");
    if (!table) return;
    const rows = rowsInScope().slice().sort((a, b) =>
      (LEVEL_ORDER[b.classification.level] - LEVEL_ORDER[a.classification.level])
      || (b.classification.score - a.classification.score)
      || ((b.health_in_need?.value || 0) - (a.health_in_need?.value || 0)));
    const anyGrades = rows.some((r) => (r.who_grades || []).length);
    const head = L(`
      <thead><tr>
        <th>Country</th><th>Group</th><th title="DHM triage tier, not a WHO grade">DHM tier</th>${anyGrades ? "<th>WHO grade</th>" : ""}
        <th title="People in need of health assistance (OCHA plans)">Health PiN</th><th title="Health cluster funding received (OCHA FTS)">Funded</th><th title="Unfunded health requirement">Gap (US$)</th>
        <th title="Internally displaced people">IDPs</th><th title="Refugees and asylum seekers hosted (UNHCR)">Refugees</th><th title="IPC/CH Phase 3+, share of the population analysed">IPC/CH 3+</th><th title="Attacks on health care this year (WHO SSA)">Attacks</th><th title="INFORM Risk index (EC JRC), 0 to 10">INFORM</th>
      </tr></thead>`, `
      <thead><tr>
        <th>Pays</th><th>Groupe</th><th title="Niveau de triage DHM, ce n'est pas un grade OMS">Niveau DHM</th>${anyGrades ? "<th>Grade OMS</th>" : ""}
        <th title="Personnes ayant besoin d'une assistance sanitaire (plans d'OCHA)">Personnes dans le besoin (santé)</th><th title="Financement reçu par le Cluster Santé (FTS d'OCHA)">Financé</th><th title="Besoin sanitaire non financé">Déficit ($ US)</th>
        <th title="Personnes déplacées internes">Déplacés internes</th><th title="Réfugiés et demandeurs d'asile accueillis (HCR)">Réfugiés</th><th title="Phase 3+ IPC/CH, part de la population analysée">IPC/CH 3+</th><th title="Attaques contre les soins de santé cette année (SSA de l'OMS)">Attaques</th><th title="Indice de risque INFORM (CCR de la CE), de 0 à 10">INFORM</th>
      </tr></thead>`);
    const body = rows.map((r) => {
      const grade = (r.who_grades || []).map((g) => `${esc(g.grade)}: ${esc(g.event)}`).join("<br>") || `<span class="muted">${L("none", "aucun")}</span>`;
      const hp = r.health_in_need
        ? `<span title="${esc(`${tr(r.health_in_need.source)}, ${r.health_in_need.year}${r.health_in_need.alt ? L(`. Revised plan; HDX HAPI holds ${fmtCompact(r.health_in_need.alt.value)} (earlier version)`, `. Plan révisé ; HDX HAPI indique ${fmtCompact(r.health_in_need.alt.value)} (version antérieure)`) : ""}`)}">${fmtCompact(r.health_in_need.value)}</span>${String(r.health_in_need.year) !== String(new Date().getFullYear()) ? ` <small>${esc(r.health_in_need.year)}</small>` : ""}`
        : r.health_outdated
          ? cellStale(`${fmtCompact(r.health_outdated.value)} <small>(${esc(r.health_outdated.year)})</small>`, true,
            L(`No current humanitarian plan. Last plan: ${r.health_outdated.plan_name || r.health_outdated.year}, ended ${fmtMonth(r.health_outdated.plan_end)}. ${r.health_outdated.counts_for_tier ? "Counts toward the triage tier, which is shown as provisional; not added to totals." : `Not used: ${r.health_outdated.rule || "too old"}.`}`,
              `Pas de plan humanitaire en cours. Dernier plan : ${tr(r.health_outdated.plan_name) || r.health_outdated.year}, terminé en ${fmtMonth(r.health_outdated.plan_end)}. ${r.health_outdated.counts_for_tier ? "Compte pour le niveau de triage, affiché comme provisoire ; non ajouté aux totaux." : `Non utilisé : ${tr(r.health_outdated.rule) || "trop ancien"}.`}`))
          : `<span class="muted">${L("no plan", "pas de plan")}</span>`;
      const fund = r.health_funding ? `${fmtPct(r.health_funding.pct)}` : `<span class="muted">${L("no plan", "pas de plan")}</span>`;
      const gap = r.health_funding ? fmtUsd(r.health_funding.gap_usd).replace("US$", "").replace(`${NBSP}$${NBSP}US`, "") : "";
      const idp = r.idps ? `<span title="${esc(`${tr(r.idps.source)}, ${fmtMonth(r.idps.date)}${r.idps.note ? `. ${tr(r.idps.note)}` : ""}`)}">${cellStale(fmtCompact(r.idps.value), r.idps.stale)}</span>` : `<span class="muted">${na()}</span>`;
      const ref = r.refugees ? `<span title="${esc(L(`${r.refugees.source}, end ${r.refugees.year}`, `${tr(r.refugees.source)}, fin ${r.refugees.year}`))}">${fmtCompact(r.refugees.value)}</span>` : `<span class="muted">${na()}</span>`;
      const ipc = r.ipc
        ? `<span title="${esc(L(`${r.ipc.kind === "current" ? "Current analysis" : "Projection"}, ${fmtMonth(r.ipc.period_start)} to ${fmtMonth(r.ipc.period_end)}${r.ipc.stale ? ". Older than 18 months; not used" : ""}`,
          `${r.ipc.kind === "current" ? "Analyse de la situation actuelle" : "Projection"}, ${periodFr(r.ipc.period_start, r.ipc.period_end)}${r.ipc.stale ? ". Plus de 18 mois ; non utilisée" : ""}`))}">${cellStale(fmtPct(r.ipc.fraction), r.ipc.stale)}${r.ipc.kind === "current" ? "" : " <small>proj.</small>"}</span>`
        : `<span class="muted">${L("no analysis", "pas d'analyse")}</span>`;
      const att = r.attacks
        ? `${fmtFull(r.attacks.ytd.attacks)}${r.attacks.ytd.deaths ? ` <small>(${L(`${fmtFull(r.attacks.ytd.deaths)} killed`, killedFr(r.attacks.ytd.deaths))})</small>` : ""}`
        : `<span class="muted">${L("not in SSA", "hors SSA")}</span>`;
      const inform = r.inform_risk ? `${esc(L(r.inform_risk.overall, String(r.inform_risk.overall).replace(".", ",")))}` : na();
      return `<tr>
        <td><button type="button" class="strat-link" data-strat-country="${r.iso3}">${esc(cname(r.country))}</button></td>
        <td>${esc(groupName(r.group))}</td>
        <td>${rowTag(r)} <small>${r.classification.score}/${r.classification.max_score}</small></td>
        ${anyGrades ? `<td>${grade}</td>` : ""}
        <td class="num">${hp}</td>
        <td class="num">${fund}</td>
        <td class="num">${gap}</td>
        <td class="num">${idp}</td>
        <td class="num">${ref}</td>
        <td class="num">${ipc}</td>
        <td class="num">${att}</td>
        <td class="num">${inform}</td>
      </tr>`;
    }).join("");
    table.innerHTML = `${head}<tbody>${body}</tbody>`;
  }

  function renderCoverageChart() {
    const node = el("stratCoverageChart");
    if (!node || typeof Plotly === "undefined") return;
    const rows = rowsInScope().filter((r) => isNum(r.health_in_need?.value) && isNum(r.health_targeted?.value))
      .map((r) => ({ r, share: r.health_targeted.value / r.health_in_need.value }))
      .sort((a, b) => a.share - b.share);
    if (!rows.length) {
      emptyNote(node, L("No plan targets for the selected scope.", "Aucune cible de plan pour le périmètre sélectionné."));
      return;
    }
    plot(node, [{
      type: "bar",
      orientation: "h",
      y: rows.map((x) => shortName(x.r.country)),
      x: rows.map((x) => x.share * 100),
      marker: { color: rows.map((x) => (x.share < 0.4 ? "#c44242" : x.share < 0.6 ? "#e8a33b" : "#2e8b6e")) },
      text: rows.map((x) => L(`${fmtPct(x.share)} (${fmtCompact(x.r.health_targeted.value)} of ${fmtCompact(x.r.health_in_need.value)})`, `${fmtPct(x.share)} (${fmtCompact(x.r.health_targeted.value)} sur ${fmtCompact(x.r.health_in_need.value)})`)),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: L("%{y}: %{x:.0f}% of health need targeted<extra></extra>", "%{y} : %{x:.0f} % des besoins en santé ciblés<extra></extra>")
    }], {
      margin: { l: 110, r: 150, t: 10, b: 40 },
      height: Math.max(280, 32 * rows.length + 70),
      xaxis: { range: [0, 100], ticksuffix: L("%", " %"), gridcolor: "#e6edf5", title: { text: L("Targeted as % of people in need of health assistance", "Personnes ciblées en % des personnes ayant besoin d'une assistance sanitaire") } },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      showlegend: false,
      ...plotLang()
    });
  }

  function renderMhpssChart() {
    const node = el("stratMhpssChart");
    if (!node || typeof Plotly === "undefined") return;
    const svc = latestServiceQuarter();
    const rows = rowsInScope()
      .map((r) => ({ r, q: svc[r.iso3] }))
      .filter((x) => x.q && isNum(x.q.mental_health_beneficiaries) && isNum(x.r.health_in_need?.value))
      .map((x) => ({ ...x, rate: (x.q.mental_health_beneficiaries / x.r.health_in_need.value) * 10000 }))
      .sort((a, b) => a.rate - b.rate);
    if (!rows.length) {
      emptyNote(node, L("No MHPSS figures reported in the FCV service database for the selected scope.", "Aucun chiffre de SMSPS déclaré dans la base de données des services FCV pour le périmètre sélectionné."));
      return;
    }
    plot(node, [{
      type: "bar",
      orientation: "h",
      y: rows.map((x) => shortName(x.r.country)),
      x: rows.map((x) => x.rate),
      marker: { color: "#4a6fa5" },
      text: rows.map((x) => L(`${x.rate.toFixed(0)} per 10,000 (${fmtFull(x.q.mental_health_beneficiaries)} people, ${x.q.quarter_label})`, `${x.rate.toFixed(0)} pour 10${NBSP}000 (${fmtFull(x.q.mental_health_beneficiaries)} personnes, ${qLab(x.q.quarter_label)})`)),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: L("%{y}: %{x:.1f} per 10,000 in need<extra></extra>", "%{y} : %{x:.1f} pour 10 000 personnes dans le besoin<extra></extra>")
    }], {
      margin: { l: 110, r: 230, t: 10, b: 40 },
      height: Math.max(280, 32 * rows.length + 70),
      xaxis: { gridcolor: "#e6edf5", title: { text: L("People reached with MHPSS per 10,000 in need of health assistance", "Personnes ayant bénéficié de services de SMSPS pour 10 000 personnes ayant besoin d'une assistance sanitaire") } },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      showlegend: false,
      ...plotLang()
    });
  }

  function renderSources() {
    const node = el("stratSources");
    if (!node) return;
    const s = state.payload.sources;
    const links = [
      [L("OCHA HDX HAPI (needs, IDPs, refugees, IPC, INFORM Risk)", "OCHA HDX HAPI (besoins, déplacés internes, réfugiés, IPC, risque INFORM)"), s.hapi.url, s.hapi.fetched_at],
      [L("OCHA Financial Tracking Service (health cluster funding)", "Service de suivi financier (FTS) d'OCHA (financement du Cluster Santé)"), "https://fts.unocha.org", s.fts.fetched_at],
      [L("OCHA Humanitarian Action: plans and response monitoring (health caseloads and reach)", "OCHA Humanitarian Action : plans et suivi de la réponse (populations ciblées et atteintes en santé)"), "https://humanitarianaction.info", s.hpc?.fetched_at],
      [L("WHO Surveillance System for Attacks on Health Care", "Système de surveillance des attaques contre les soins de santé (SSA) de l'OMS"), s.ssa.url, s.ssa.fetched_at],
      [L("IOM Displacement Tracking Matrix", "Matrice de suivi des déplacements (DTM) de l'OIM"), "https://dtm.iom.int", null],
      [L("IPC Integrated Food Security Phase Classification", "Cadre intégré de classification de la sécurité alimentaire (IPC)"), "https://www.ipcinfo.org", null],
      [L("INFORM Risk and Severity (EC JRC)", "INFORM Risque et Sévérité (CCR de la CE)"), "https://drmkc.jrc.ec.europa.eu/inform-index", null],
      [L("HeRAMS (health facility functionality)", "HeRAMS (fonctionnalité des établissements de santé)"), "https://www.who.int/initiatives/herams", null],
      [L("OCHA humanitarian response (plans, coordination)", "Réponse humanitaire d'OCHA (plans, coordination)"), "https://www.unocha.org/africa", null],
      [L("UNDP crisis and disaster response", "Réponse du PNUD aux crises et catastrophes"), "https://www.undp.org/crisis", null]
    ];
    node.innerHTML = `<ul class="strat-link-list">${links.map(([name, url, at]) => `<li><a href="${url}" target="_blank" rel="noopener">${esc(name)}</a>${at ? ` <span class="muted">${L("updated", "mis à jour le")} ${fmtDate(at)}</span>` : ""}</li>`).join("")}</ul>
      <p class="muted">${L("Purpose: this dashboard is informative and strategic. Reactive alerts and incident detail go through the weekly operational update.", "Objet : ce tableau de bord a une vocation informative et stratégique. Les alertes réactives et le détail des incidents passent par la mise à jour opérationnelle hebdomadaire.")}</p>`;
  }

  // ---------- Crisis classification page ----------
  function renderGradingPage() {
    const rows = rowsInScope("withcontext");
    const fcv = rowsInScope("fcv13");
    const summary = el("gradingSummary");
    if (summary) {
      const counts = (list, level) => list.filter((r) => r.classification.level === level).length;
      const gradeCount = (state.payload.grading.rows || []).length;
      const of13 = L("of 13 FCV countries", "sur 13 pays FCV");
      const insuffNames = fcv.filter((r) => r.classification.level === "Insufficient data").map((r) => esc(shortName(r.country))).join(", ");
      summary.innerHTML = [
        [levelName("Major"), counts(fcv, "Major"), of13],
        [levelName("Severe"), counts(fcv, "Severe"), of13],
        [levelName("Moderate"), counts(fcv, "Moderate"), of13],
        [levelName("Insufficient data"), counts(fcv, "Insufficient data"), L(`fewer than 3 of 4 core indicators current${counts(fcv, "Insufficient data") ? `: ${insuffNames}` : ""}`, `moins de 3 des 4 indicateurs de base à jour${counts(fcv, "Insufficient data") ? ` : ${insuffNames}` : ""}`)],
        [L("WHO-graded events", "Urgences classées par l'OMS"), gradeCount, gradeCount ? L(`register updated ${fmtDate(state.payload.grading.updated_at)}`, `registre mis à jour le ${fmtDate(state.payload.grading.updated_at)}`) : L("register not yet filled by DHM", "registre pas encore renseigné par la DHM")]
      ].map(([title, value, sub]) => `
        <div class="strat-kpi strat-kpi-static">
          <span class="strat-kpi-title">${title}</span>
          <span class="strat-kpi-value">${value}</span>
          <span class="strat-kpi-sub">${sub}</span>
        </div>`).join("");
    }

    const table = el("gradingTable");
    if (table) {
      const base = baseSnapshot();
      const anyGrades = rows.some((r) => (r.who_grades || []).length);
      const order = (a, b) => (LEVEL_ORDER[b.classification.level] - LEVEL_ORDER[a.classification.level]) || (b.classification.score - a.classification.score);
      const core = rows.filter((r) => r.group === "fcv_prioritized" || r.group === "fcv_accelerated").sort(order);
      const others = rows.filter((r) => !core.includes(r)).sort(order);
      const cols = 6 + (base ? 1 : 0) + (anyGrades ? 1 : 0);
      // Short chip labels; the full rule is in the tooltip.
      const chipLabel = (p) => {
        const c = p.criterion;
        if (/INFORM/.test(c)) return L("INFORM very high", "INFORM très élevé");
        if (/health assistance/.test(c)) return L(`Health need ${fmtCompact(p.value)}${/last plan/.test(c) ? " (last plan)" : ""}`, `Personnes dans le besoin (santé) ${fmtCompact(p.value)}${/last plan/.test(c) ? " (dernier plan)" : ""}`);
        if (/IPC/.test(c)) return `IPC 3+ ${fmtPct(p.value)}`;
        if (/IDPs/.test(c)) return L(`Displaced ${fmtCompact(p.value)}`, `Déplacés ${fmtCompact(p.value)}`);
        if (/SSA/.test(c)) return L("Attacks on health care", "Attaques contre les soins de santé");
        return tr(c);
      };
      const changeCell = (r) => {
        const prev = base?.countries?.[r.iso3];
        if (!prev?.level) return `<span class="muted">${na()}</span>`;
        if (prev.level === r.classification.level) return `<span class="muted">${L("no change", "aucune variation")}</span>`;
        if (prev.level === "Insufficient data" || r.classification.level === "Insufficient data") {
          return `<span class="strat-trend strat-trend-flat">&#9632; ${L("was", "auparavant")} ${esc(levelName(prev.level))}</span>`;
        }
        const worse = (LEVEL_ORDER[r.classification.level] || 0) > (LEVEL_ORDER[prev.level] || 0);
        return `<span class="strat-trend ${worse ? "strat-trend-bad" : "strat-trend-good"}">${worse ? "&#9650;" : "&#9660;"} ${L("was", "auparavant")} ${esc(levelName(prev.level))}</span>`;
      };
      const rowHtml = (r) => `
          <tr>
            <td><button type="button" class="strat-link" data-strat-country="${r.iso3}">${esc(cname(r.country))}</button><br><small class="muted">${esc(groupName(r.group))}</small></td>
            <td>${rowTag(r)}</td>
            ${base ? `<td>${changeCell(r)}</td>` : ""}
            <td class="num">${r.classification.score}/${r.classification.max_score}</td>
            <td>${r.classification.points.length
              ? `<div class="strat-chips">${r.classification.points.map((p) => `<span class="strat-chip" title="${esc(tr(p.criterion))}">${esc(chipLabel(p))} <b>+${p.score}</b></span>`).join("")}</div>`
              : `<span class="muted">${L("none", "aucun")}</span>`}</td>
            <td class="num">${r.classification.indicators_available ?? na()}/4</td>
            <td>${(r.classification.missing || []).length ? `<small class="muted">${esc(r.classification.missing.map(tr).join(L("; ", " ; ")))}</small>` : `<small class="muted">${L("all current", "tous à jour")}</small>`}</td>
            ${anyGrades ? `<td>${(r.who_grades || []).map((g) => `${esc(g.grade)}: ${esc(g.event)} <small>(${esc(isoDisp(g.date_graded))})</small>`).join("<br>") || `<span class="muted">${L("none", "aucun")}</span>`}</td>` : ""}
          </tr>`;
      table.classList.add("strat-grading-table");
      table.innerHTML = L(`
        <thead><tr><th>Country</th><th>DHM triage tier</th>${base ? `<th>Tier in ${esc(monthLabel(base.month))}</th>` : ""}<th>Points</th><th>Criteria met (points)</th><th title="Core indicators with a current figure: INFORM Risk, health people in need, IPC/CH, displacement">Data</th><th>Missing or outdated</th>${anyGrades ? "<th>WHO grade</th>" : ""}</tr></thead>`, `
        <thead><tr><th>Pays</th><th>Niveau de triage DHM</th>${base ? `<th>Niveau en ${esc(monthLabel(base.month))}</th>` : ""}<th>Points</th><th>Critères remplis (points)</th><th title="Indicateurs de base disposant d'un chiffre à jour : risque INFORM, personnes ayant besoin d'une assistance sanitaire, IPC/CH, déplacement">Données</th><th>Manquant ou obsolète</th>${anyGrades ? "<th>Grade OMS</th>" : ""}</tr></thead>`) + `
        <tbody>${core.map(rowHtml).join("")}
          ${others.length ? `<tr class="strat-group-row"><td colspan="${cols}">${L("Other FCV-classified and cross-border context countries (not counted in the 13-country totals)", "Autres pays classés FCV et pays du contexte transfrontalier (non comptés dans les totaux des 13 pays)")}</td></tr>${others.map(rowHtml).join("")}` : ""}
        </tbody>`;
    }

    const reg = el("gradingRegister");
    if (reg) {
      const g = state.payload.grading.rows || [];
      reg.innerHTML = g.length
        ? `<div class="table-wrap"><table class="strat-table"><thead><tr>${L("<th>Country</th><th>Event</th><th>Grade</th><th>Graded</th><th>Last review</th>", "<th>Pays</th><th>Événement</th><th>Grade</th><th>Date de classement</th><th>Dernier examen</th>")}</tr></thead><tbody>${g.map((x) => `<tr><td>${esc(x.country ? cname(x.country) : x.iso3)}</td><td>${esc(x.event)}</td><td>${esc(x.grade)}</td><td>${esc(isoDisp(x.date_graded))}</td><td>${esc(isoDisp(x.last_reviewed))}</td></tr>`).join("")}</tbody></table></div>`
        : L(`<p><strong>No WHO grades entered yet.</strong> Grades come only from the WHO grading process (Emergency Response Framework); the dashboard never estimates them. The DHM focal point adds one line per graded event (country, event, grade [Grade 1 to 3, or Protracted 1 to 3], date graded, last review, incident management level, reference) to the grading register, and the grade appears here, on the Overview and in the bulletin after the next update.</p>`,
          `<p><strong>Aucun grade OMS saisi à ce jour.</strong> Les grades proviennent uniquement du processus de classement par grade de l'OMS (Cadre d'action d'urgence) ; le tableau de bord ne les estime jamais. Le point focal DHM ajoute une ligne par événement classé (pays, événement, grade [grade 1 à 3, ou urgence prolongée de grade 1 à 3], date de classement, dernier examen, niveau de gestion de l'incident, référence) au registre des grades, et le grade apparaît ici, dans la Vue d'ensemble et dans le bulletin après la mise à jour suivante.</p>`);
    }

    const rules = el("gradingRules");
    if (rules) {
      const cr = state.payload.classification_rules;
      rules.innerHTML = `<p>${esc(tr(cr.note))}</p>
        <ul>${cr.criteria.map((c) => `<li>${esc(tr(c))}</li>`).join("")}</ul>
        <p><strong>${L("Levels:", "Niveaux :")}</strong> ${Object.entries(cr.levels).map(([k, v]) => `${levelTag(k)} ${esc(tr(v))}`).join(" &nbsp; ")}</p>`;
    }
  }

  // ---------- Country profile card ----------
  // French version of the country card lines (same logic as the English list in renderCountryCard).
  function countryCardItemsFr(r, f) {
    const notGrade = "Fondé sur des règles, ce n'est pas un grade OMS";
    return [
      ["Niveau de triage DHM", `${rowTag(r)} ${r.classification.score}/${r.classification.max_score}`, r.classification.uses_last_plan ? `${notGrade}. Provisoire : utilise le chiffre du dernier plan` : r.classification.level === "Insufficient data" ? `${notGrade}. Manquant : ${esc((r.classification.missing || []).map(tr).join(" ; "))}` : notGrade],
      ["Grade OMS", (r.who_grades || []).map((g) => esc(g.grade)).join(", ") || "aucun enregistré", "Registre des grades de l'OMS"],
      ["Plan humanitaire", r.plan && !r.health_outdated && !/^non[ -]?plan$/i.test(r.plan.name || "") ? esc(tr(r.plan.name) || r.plan.code) : "pas de plan en cours",
        f ? "FTS d'OCHA" : r.health_outdated ? `Dernier plan : ${esc(tr(r.health_outdated.plan_name) || r.health_outdated.year)}` : r.plan ? "Profil pays FCV (DHM)" : "HDX HAPI"],
      ["Personnes dans le besoin (tous secteurs)", fmtCompact(r.people_in_need?.value), r.people_in_need ? `${esc(tr(r.people_in_need.source))}, ${esc(r.people_in_need.year)}` : ""],
      ["Personnes ayant besoin d'une assistance sanitaire", r.health_in_need
        ? `${fmtCompact(r.health_in_need.value)}${r.health_in_need_previous ? ` <small>(${esc(r.health_in_need_previous.year)} : ${fmtCompact(r.health_in_need_previous.value)})</small>` : ""}`
        : r.health_outdated ? `${fmtCompact(r.health_outdated.value)} (dernier plan, ${esc(r.health_outdated.year)})` : na(),
        r.health_in_need ? `${esc(plainSource(r.health_in_need.source))}, ${esc(r.health_in_need.plan_code || r.health_in_need.year)}${r.health_in_need.alt ? `. Plan révisé ; version antérieure sur HDX : ${fmtCompact(r.health_in_need.alt.value)}` : ""}`
          : r.health_outdated ? `${esc(tr(r.health_outdated.plan_name || r.health_outdated.source))}, terminé en ${esc(fmtMonth(r.health_outdated.plan_end))}. ${r.health_outdated.counts_for_tier ? "Utilisé uniquement pour le niveau de triage, affiché comme provisoire" : `Non utilisé : ${esc(tr(r.health_outdated.rule || "too old").toLowerCase().replace(/^too old$/, "trop ancien"))}`}` : "Pas de plan humanitaire"],
      ["Personnes ciblées (santé)", fmtCompact(r.health_targeted?.value), r.health_targeted ? `${esc(tr(r.health_targeted.source))}, ${esc(r.health_targeted.year)}` : ""],
      ["Couverture du Cluster Santé", r.health_reached
        ? `${fmtCompact(r.health_reached.value)} personnes atteintes${isNum(r.health_targeted?.value) ? ` sur ${fmtCompact(r.health_targeted.value)} ciblées` : ""}`
        : r.health_reach_latest
          ? `${fmtCompact(r.health_reach_latest.reached)} sur ${fmtCompact(r.health_reach_latest.targeted)} ciblées (${fmtPct(r.health_reach_latest.reached / Math.max(1, r.health_reach_latest.targeted))}) en ${esc(r.health_reach_latest.year)}${r.health_reach_latest.full_year || r.health_reach_latest.year === String(new Date().getFullYear()) ? "" : `, déclaré jusqu'à ${esc(fmtMonth(r.health_reach_latest.period_end))} seulement`}`
          : r.health_reach_excluded
            ? `inutilisable : ${fmtFull(r.health_reach_excluded.reached)} déclarées pour ${fmtCompact(r.health_reach_excluded.targeted)} ciblées dans le ${esc(tr(r.health_reach_excluded.plan_name) || r.health_reach_excluded.year)}, probablement une erreur de déclaration`
            : r.health_in_need ? "pas encore publié" : "pas de plan humanitaire",
        r.health_reached ? `${esc(tr(r.health_reached.source))}${r.health_reached.reference ? ` : ${esc(r.health_reached.reference)}` : ""}${r.health_reached.period_end ? `, jusqu'à ${esc(fmtMonth(r.health_reached.period_end))}` : ""}`
          : r.health_reach_latest ? `OCHA Humanitarian Action, ${esc(tr(r.health_reach_latest.plan_name) || r.health_reach_latest.plan_code || "")}, jusqu'à ${esc(fmtMonth(r.health_reach_latest.period_end))}` : "OCHA Humanitarian Action (suivi de la réponse)"],
      ["Évolution depuis le mois dernier", (() => {
        const prev = baseSnapshot()?.countries?.[r.iso3];
        if (!prev) return baseSnapshot() ? na() : `à partir ${esc(deFr(nextMonthLabel(state.payload.history?.first_month || new Date().toISOString().slice(0, 7))))}`;
        const bits = [];
        if (prev.level && prev.level !== r.classification.level) bits.push(`niveau ${esc(levelName(prev.level))} à ${esc(levelName(r.classification.level))}`);
        if (baseSameYear() && isNum(prev.health_requirements_usd) && prev.health_requirements_usd > 0 && f && Math.abs(prev.health_funding_usd / prev.health_requirements_usd - f.pct) >= 0.005) bits.push(`financement de ${fmtPct(prev.health_funding_usd / prev.health_requirements_usd)} à ${fmtPct(f.pct)}`);
        if (isNum(prev.idps) && r.idps && !r.idps.stale && prev.idps !== r.idps.value) bits.push(`déplacés internes de ${fmtCompact(prev.idps)} à ${fmtCompact(r.idps.value)}`);
        if (isNum(prev.attacks_ytd) && r.attacks && baseSameYear() && r.attacks.ytd.attacks > prev.attacks_ytd) {
          const n = r.attacks.ytd.attacks - prev.attacks_ytd;
          bits.push(`${fmtFull(n)} nouvelle${n > 1 ? "s" : ""} attaque${n > 1 ? "s" : ""} enregistrée${n > 1 ? "s" : ""}`);
        }
        return bits.length ? bits.join(" ; ") : "aucune variation";
      })(), baseSnapshot() ? `Comparé à l'instantané ${esc(deFr(monthLabel(baseSnapshot().month)))}` : "Instantanés mensuels"],
      ["Financement de la santé", f ? `${fmtUsd(f.funding_usd)} sur ${fmtUsd(f.requirements_usd)} (${fmtPct(f.pct)})` : na(), f ? "FTS d'OCHA" : ""],
      ["Déplacés internes", r.idps ? `${fmtCompact(r.idps.value)}${r.idps.stale ? " (obsolète)" : ""}` : na(), r.idps ? `${esc(tr(r.idps.source))}, ${esc(fmtMonth(r.idps.date))}` : ""],
      ["Réfugiés et demandeurs d'asile accueillis", fmtCompact(r.refugees?.value), r.refugees ? `${esc(tr(r.refugees.source))}, ${esc(r.refugees.year)}` : ""],
      ["Phase 3+ IPC/CH (part de la population analysée)", r.ipc ? `${fmtPct(r.ipc.fraction)} (${fmtCompact(r.ipc.population)} personnes)${r.ipc.stale ? ", obsolète" : ""}` : "pas d'analyse", r.ipc ? `IPC, ${periodFr(r.ipc.period_start, r.ipc.period_end)} (${r.ipc.kind === "current" ? "situation actuelle" : "projection"})` : ""],
      ["Attaques contre les soins de santé cette année", r.attacks ? `${fmtFull(r.attacks.ytd.attacks)} attaque${r.attacks.ytd.attacks > 1 ? "s" : ""}, ${killedFr(r.attacks.ytd.deaths)}, ${injuredFr(r.attacks.ytd.injuries)}` : "non suivi par le SSA", r.attacks ? "SSA de l'OMS" : ""],
      ["Risque INFORM (de 0 à 10)", r.inform_risk ? `${esc(String(r.inform_risk.overall).replace(".", ","))} (rang mondial ${esc(r.inform_risk.global_rank)})` : na(), r.inform_risk ? `CCR de la CE, ${esc(r.inform_risk.year)}` : ""]
    ];
  }

  function renderCountryCard() {
    const node = el("stratCountryCard");
    if (!node) return;
    const select = el("countrySelect");
    const iso3 = select ? select.value : null;
    const r = (state.payload?.countries || []).find((c) => c.iso3 === iso3);
    if (!r) {
      node.innerHTML = L(`<div class="panel-header"><h2>Strategic Country Card</h2><p>The selected country is outside the FCV reference list. Strategic indicators are compiled for the 13 FCV countries, other FCV-classified countries, Sudan and Somalia.</p></div>`,
        `<div class="panel-header"><h2>Fiche pays stratégique</h2><p>Le pays sélectionné ne figure pas dans la liste de référence FCV. Les indicateurs stratégiques sont compilés pour les 13 pays FCV, les autres pays classés FCV, le Soudan et la Somalie.</p></div>`);
      return;
    }
    const f = r.health_funding;
    const items = isFr() ? countryCardItemsFr(r, f) : [
      ["DHM triage tier", `${rowTag(r)} ${r.classification.score}/${r.classification.max_score}`, r.classification.uses_last_plan ? "Rule-based, not a WHO grade. Provisional: uses the last plan's figure" : r.classification.level === "Insufficient data" ? `Rule-based, not a WHO grade. Missing: ${esc((r.classification.missing || []).join("; "))}` : "Rule-based, not a WHO grade"],
      ["WHO grade", (r.who_grades || []).map((g) => esc(g.grade)).join(", ") || "none recorded", "WHO grading register"],
      ["Humanitarian plan", r.plan && !r.health_outdated && !/^non[ -]?plan$/i.test(r.plan.name || "") ? esc(r.plan.name || r.plan.code) : "no current plan",
        f ? "OCHA FTS" : r.health_outdated ? `Last plan: ${esc(r.health_outdated.plan_name || r.health_outdated.year)}` : r.plan ? "FCV country profile (DHM)" : "HDX HAPI"],
      ["People in need (all sectors)", fmtCompact(r.people_in_need?.value), r.people_in_need ? `${esc(r.people_in_need.source)}, ${esc(r.people_in_need.year)}` : ""],
      ["People in need of health assistance", r.health_in_need
        ? `${fmtCompact(r.health_in_need.value)}${r.health_in_need_previous ? ` <small>(${esc(r.health_in_need_previous.year)}: ${fmtCompact(r.health_in_need_previous.value)})</small>` : ""}`
        : r.health_outdated ? `${fmtCompact(r.health_outdated.value)} (last plan, ${esc(r.health_outdated.year)})` : "n/a",
        r.health_in_need ? `${esc(plainSource(r.health_in_need.source))}, ${esc(r.health_in_need.plan_code || r.health_in_need.year)}${r.health_in_need.alt ? `. Revised plan; earlier version on HDX: ${fmtCompact(r.health_in_need.alt.value)}` : ""}`
          : r.health_outdated ? `${esc(r.health_outdated.plan_name || r.health_outdated.source)}, ended ${esc(fmtMonth(r.health_outdated.plan_end))}. ${r.health_outdated.counts_for_tier ? "Used for the triage tier only, which is shown as provisional" : `Not used: ${esc((r.health_outdated.rule || "too old").toLowerCase())}`}` : "No humanitarian plan"],
      ["Health targeted", fmtCompact(r.health_targeted?.value), r.health_targeted ? `${esc(r.health_targeted.source)}, ${esc(r.health_targeted.year)}` : ""],
      ["Health Cluster reach", r.health_reached
        ? `${fmtCompact(r.health_reached.value)} reached${isNum(r.health_targeted?.value) ? ` of ${fmtCompact(r.health_targeted.value)} targeted` : ""}`
        : r.health_reach_latest
          ? `${fmtCompact(r.health_reach_latest.reached)} of ${fmtCompact(r.health_reach_latest.targeted)} targeted (${fmtPct(r.health_reach_latest.reached / Math.max(1, r.health_reach_latest.targeted))}) in ${esc(r.health_reach_latest.year)}${r.health_reach_latest.full_year || r.health_reach_latest.year === String(new Date().getFullYear()) ? "" : `, reported to ${esc(fmtMonth(r.health_reach_latest.period_end))} only`}`
          : r.health_reach_excluded
            ? `not usable: ${fmtFull(r.health_reach_excluded.reached)} reported against ${fmtCompact(r.health_reach_excluded.targeted)} targeted in the ${esc(r.health_reach_excluded.plan_name || r.health_reach_excluded.year)}, likely a reporting error`
            : r.health_in_need ? "not yet published" : "no humanitarian plan",
        r.health_reached ? `${esc(r.health_reached.source)}${r.health_reached.reference ? `: ${esc(r.health_reached.reference)}` : ""}${r.health_reached.period_end ? `, to ${esc(fmtMonth(r.health_reached.period_end))}` : ""}`
          : r.health_reach_latest ? `OCHA Humanitarian Action, ${esc(r.health_reach_latest.plan_name || r.health_reach_latest.plan_code || "")}, to ${esc(fmtMonth(r.health_reach_latest.period_end))}` : "OCHA Humanitarian Action (response monitoring)"],
      ["Change since last month", (() => {
        const prev = baseSnapshot()?.countries?.[r.iso3];
        if (!prev) return baseSnapshot() ? "n/a" : `from ${esc(nextMonthLabel(state.payload.history?.first_month || new Date().toISOString().slice(0, 7)))}`;
        const bits = [];
        if (prev.level && prev.level !== r.classification.level) bits.push(`tier ${esc(prev.level)} to ${esc(r.classification.level)}`);
        if (baseSameYear() && isNum(prev.health_requirements_usd) && prev.health_requirements_usd > 0 && f && Math.abs(prev.health_funding_usd / prev.health_requirements_usd - f.pct) >= 0.005) bits.push(`funded ${fmtPct(prev.health_funding_usd / prev.health_requirements_usd)} to ${fmtPct(f.pct)}`);
        if (isNum(prev.idps) && r.idps && !r.idps.stale && prev.idps !== r.idps.value) bits.push(`IDPs ${fmtCompact(prev.idps)} to ${fmtCompact(r.idps.value)}`);
        if (isNum(prev.attacks_ytd) && r.attacks && baseSameYear() && r.attacks.ytd.attacks > prev.attacks_ytd) bits.push(`${fmtFull(r.attacks.ytd.attacks - prev.attacks_ytd)} new attacks recorded`);
        return bits.length ? bits.join("; ") : "no change";
      })(), baseSnapshot() ? `Compared with the ${esc(monthLabel(baseSnapshot().month))} snapshot` : "Monthly snapshots"],
      ["Health funding", f ? `${fmtUsd(f.funding_usd)} of ${fmtUsd(f.requirements_usd)} (${fmtPct(f.pct)})` : "n/a", f ? "OCHA FTS" : ""],
      ["IDPs", r.idps ? `${fmtCompact(r.idps.value)}${r.idps.stale ? " (outdated)" : ""}` : "n/a", r.idps ? `${esc(r.idps.source)}, ${esc(fmtMonth(r.idps.date))}` : ""],
      ["Refugees and asylum seekers hosted", fmtCompact(r.refugees?.value), r.refugees ? `${esc(r.refugees.source)}, ${esc(r.refugees.year)}` : ""],
      ["IPC/CH Phase 3+ (share of the population analysed)", r.ipc ? `${fmtPct(r.ipc.fraction)} (${fmtCompact(r.ipc.population)} people)${r.ipc.stale ? ", outdated" : ""}` : "no analysis", r.ipc ? `IPC, ${fmtMonth(r.ipc.period_start)} to ${fmtMonth(r.ipc.period_end)} (${esc(r.ipc.kind)})` : ""],
      ["Attacks on health care this year", r.attacks ? `${fmtFull(r.attacks.ytd.attacks)} attacks, ${fmtFull(r.attacks.ytd.deaths)} killed, ${fmtFull(r.attacks.ytd.injuries)} injured` : "not monitored by SSA", r.attacks ? "WHO SSA" : ""],
      ["INFORM Risk (0 to 10)", r.inform_risk ? `${esc(r.inform_risk.overall)} (global rank ${esc(r.inform_risk.global_rank)})` : "n/a", r.inform_risk ? `EC JRC, ${esc(r.inform_risk.year)}` : ""]
    ];
    node.innerHTML = `
      ${L(`<div class="panel-header"><h2>Strategic Country Card: ${esc(r.country)}</h2><p>${esc(GROUP_LABEL[r.group] || "")} country. Verified sources only; each line shows its source and date.</p></div>`,
        `<div class="panel-header"><h2>Fiche pays stratégique : ${esc(cname(r.country))}</h2><p>Pays du groupe ${esc(GROUP_FR[r.group] || "")}. Sources vérifiées uniquement ; chaque ligne indique sa source et sa date.</p></div>`)}
      <div class="strat-card-grid">${items.map(([k, v, s]) => `<div class="strat-card-item"><span class="strat-card-label">${k}</span><span class="strat-card-value">${v}</span>${s ? `<span class="strat-source">${s}</span>` : ""}</div>`).join("")}</div>
      ${countryTrendTable(r)}
      ${sourcesBar(["hpc", "hapi", "fts", "dtm", "unhcr", "ipc", "ssa", "inform", "grading"])}`;
    typoNode(node);
  }

  // Month-by-month figures from the stored snapshots; shown once two months exist.
  function countryTrendTable(r) {
    const series = (state.payload?.history?.series || []).filter((m) => m.countries?.[r.iso3]);
    if (series.length < 2) {
      const first = state.payload?.history?.first_month;
      return L(`<p class="muted">A month-by-month trend for this country appears here once two months of figures are stored${first ? ` (first month: ${esc(monthLabel(first))})` : ""}.</p>`,
        `<p class="muted">Une tendance mensuelle pour ce pays apparaîtra ici lorsque deux mois de chiffres seront enregistrés${first ? ` (premier mois : ${esc(monthLabel(first))})` : ""}.</p>`);
    }
    const cell = (v, f) => (isNum(v) ? f(v) : `<span class="muted">${na()}</span>`);
    return `${L(`<h3 class="strat-subhead">Trend by month</h3>`, `<h3 class="strat-subhead">Tendance mensuelle</h3>`)}
      <div class="table-wrap"><table class="strat-table">
        ${L("<thead><tr><th>Month</th><th>DHM tier</th><th>People in need (health)</th><th>Health funded</th><th>Displaced (IDPs + refugees)</th><th>Attacks this year</th></tr></thead>",
          "<thead><tr><th>Mois</th><th>Niveau DHM</th><th>Personnes dans le besoin (santé)</th><th>Santé financée</th><th>Déplacés (déplacés internes + réfugiés)</th><th>Attaques cette année</th></tr></thead>")}
        <tbody>${series.slice().reverse().map((m) => {
          const c = m.countries[r.iso3];
          return `<tr><td>${esc(monthLabel(m.month))}</td><td>${c.level ? levelTag(c.level) : `<span class="muted">${na()}</span>`}</td>
            <td class="num">${cell(c.health_in_need, fmtCompact)}</td><td class="num">${cell(c.funding_pct, (v) => fmtPct(v))}</td>
            <td class="num">${cell(c.displaced, fmtCompact)}</td><td class="num">${cell(c.attacks_ytd, fmtFull)}</td></tr>`;
        }).join("")}</tbody></table></div>
      <p class="muted">${L("Each row is the last figure held in that month. Attacks are counted from 1 January, so they restart each year.", "Chaque ligne correspond au dernier chiffre disponible pour le mois. Les attaques sont comptées à partir du 1er janvier et repartent donc de zéro chaque année.")}</p>`;
  }

  // ---------- Conflict & displacement panel ----------
  function renderDisplacementPanel() {
    const node = el("stratDisplacementPanel");
    if (!node) return;
    const rows = rowsInScope("withcontext").filter((r) => r.idps || r.refugees)
      .sort((a, b) => ((b.idps?.value || 0) + (b.refugees?.value || 0)) - ((a.idps?.value || 0) + (a.refugees?.value || 0)));
    const fcv = rowsInScope("fcv13");
    const idpTotal = fmtCompact(sum(fcv, (r) => (r.idps && !r.idps.stale ? r.idps.value : null)));
    const refTotal = fmtCompact(sum(fcv, (r) => r.refugees?.value));
    node.innerHTML = `
      ${L(`<div class="panel-header"><h2>Verified Displacement Figures</h2>
      <p>IOM DTM internal displacement and UNHCR refugee figures through OCHA HDX HAPI. 13 FCV countries: <strong>${idpTotal}</strong> IDPs and <strong>${refTotal}</strong> refugees and asylum seekers hosted. DTM figures older than 24 months are replaced by the 2026 plan figure where one exists.</p></div>`,
        `<div class="panel-header"><h2>Chiffres de déplacement vérifiés</h2>
      <p>Chiffres des déplacements internes (DTM de l'OIM) et des réfugiés (HCR) via HDX HAPI d'OCHA. 13 pays FCV : <strong>${idpTotal}</strong> déplacés internes et <strong>${refTotal}</strong> réfugiés et demandeurs d'asile accueillis. Les chiffres DTM de plus de 24 mois sont remplacés par le chiffre du plan 2026 lorsqu'il existe.</p></div>`)}
      <div class="table-wrap"><table class="strat-table">
        ${L("<thead><tr><th>Country</th><th>Group</th><th>IDPs</th><th>As of</th><th>IDP source</th><th>Refugees hosted</th><th>Year</th></tr></thead>",
          "<thead><tr><th>Pays</th><th>Groupe</th><th>Déplacés internes</th><th>Date</th><th>Source (déplacés internes)</th><th>Réfugiés accueillis</th><th>Année</th></tr></thead>")}
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(cname(r.country))}</td><td>${esc(groupName(r.group))}</td>
          <td class="num">${r.idps ? cellStale(fmtFull(r.idps.value), r.idps.stale) : na()}</td>
          <td>${r.idps ? esc(/^\d{4}$/.test(String(r.idps.date)) ? L(`${r.idps.date} plan`, `plan ${r.idps.date}`) : isoDisp(r.idps.date)) : ""}</td>
          <td><small>${r.idps ? esc(tr(r.idps.source)) : ""}</small></td>
          <td class="num">${r.refugees ? fmtFull(r.refugees.value) : na()}</td>
          <td>${r.refugees ? esc(r.refugees.year) : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">${L("The source-signal analysis below counts news and report items. Use it to see where displacement is being reported, not to measure it.", "L'analyse des signaux de sources ci-dessous compte les articles et rapports. Elle sert à voir où les déplacements sont signalés, pas à les mesurer.")}</p>`;
  }

  // ---------- Attacks on health care panel ----------
  function renderSsaPanel() {
    const node = el("stratSsaPanel");
    if (!node) return;
    const rows = rowsInScope("withcontext").filter((r) => r.attacks)
      .sort((a, b) => b.attacks.ytd.attacks - a.attacks.ytd.attacks || b.attacks.ytd.deaths - a.attacks.ytd.deaths);
    const fcv = rowsInScope("fcv13").filter((r) => r.attacks);
    const year = new Date().getFullYear();
    const annualCell = (r, y) => {
      const a = (r.attacks.annual || []).find((x) => x.year === y);
      return a ? `${fmtFull(a.attacks)} <small>(${L(`${fmtFull(a.deaths)} killed`, killedFr(a.deaths))})</small>` : `<span class="muted">${L("none recorded", "aucune enregistrée")}</span>`;
    };
    const notMonitored = rowsInScope("fcv13").filter((r) => !r.attacks).map((r) => shortName(r.country));
    const ssaDate = fmtDate(state.payload.sources.ssa.fetched_at);
    node.innerHTML = `
      ${L(`<div class="panel-header"><h2>Verified Attacks on Health Care (WHO SSA)</h2>
      <p>Confirmed and probable attacks recorded in the WHO Surveillance System for Attacks on Health Care, ${year} to date. Updated ${ssaDate}.</p></div>`,
        `<div class="panel-header"><h2>Attaques vérifiées contre les soins de santé (SSA de l'OMS)</h2>
      <p>Attaques confirmées et probables enregistrées dans le Système de surveillance des attaques contre les soins de santé de l'OMS, de janvier ${year} à ce jour. Mis à jour le ${ssaDate}.</p></div>`)}
      <div class="two-col strat-ssa-grid">
        <div class="table-wrap"><table class="strat-table">
          ${L(`<thead><tr><th>Country</th><th>${year} attacks</th><th>Killed</th><th>Injured</th><th>Same period ${year - 1}</th><th>Full year ${year - 1}</th><th>Full year ${year - 2}</th></tr></thead>`,
            `<thead><tr><th>Pays</th><th>Attaques ${year}</th><th>Tués</th><th>Blessés</th><th>Même période ${year - 1}</th><th>Année ${year - 1} complète</th><th>Année ${year - 2} complète</th></tr></thead>`)}
          <tbody>${rows.map((r) => `<tr><td>${esc(cname(r.country))}${r.group === "context" ? L(' <small class="muted">(context)</small>', ' <small class="muted">(contexte)</small>') : ""}</td>
            <td class="num"><strong>${fmtFull(r.attacks.ytd.attacks)}</strong></td><td class="num">${fmtFull(r.attacks.ytd.deaths)}</td><td class="num">${fmtFull(r.attacks.ytd.injuries)}</td>
            <td class="num">${r.attacks.prev_ytd ? fmtFull(r.attacks.prev_ytd.attacks) : na()}</td><td class="num">${annualCell(r, year - 1)}</td><td class="num">${annualCell(r, year - 2)}</td></tr>`).join("")}</tbody></table></div>
        <div id="stratSsaChart" class="chart strat-chart"></div>
      </div>
      ${L(`<p class="muted">Regional totals on the Overview count the 13 FCV countries only; Sudan and Somalia are listed here for context and are not in those totals.</p>
      <p class="muted">Not covered by the WHO attacks surveillance system: ${esc(notMonitored.join(", ") || "none")}. For these countries use Health Cluster and Insecurity Insight reporting. <a href="https://extranet.who.int/ssa/Index.aspx" target="_blank" rel="noopener">Open the SSA portal</a>.</p>
      <p class="muted">The news items further down this page are keyword matches from public reporting. They are context only and are not verified incidents.</p>`,
        `<p class="muted">Les totaux régionaux de la Vue d'ensemble ne comptent que les 13 pays FCV ; le Soudan et la Somalie figurent ici à titre de contexte et ne sont pas inclus dans ces totaux.</p>
      <p class="muted">Non couverts par le système de surveillance des attaques de l'OMS : ${esc(notMonitored.join(", ") || "aucun")}. Pour ces pays, utiliser les rapports du Cluster Santé et d'Insecurity Insight. <a href="https://extranet.who.int/ssa/Index.aspx" target="_blank" rel="noopener">Ouvrir le portail SSA</a>.</p>
      <p class="muted">Les articles plus bas sur cette page sont des correspondances par mots-clés issues de sources publiques. Ils servent uniquement de contexte et ne sont pas des incidents vérifiés.</p>`)}`;
    renderSsaChart(rows);
  }

  function renderSsaChart(rows) {
    const node = el("stratSsaChart");
    if (!node || typeof Plotly === "undefined") return;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // Display labels only; monthNames stays English because it matches the SSA data.
    const monthLabels = isFr() ? ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] : monthNames;
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ y: d.getFullYear(), m: monthNames[d.getMonth()], label: `${monthLabels[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
    }
    const palette = ["#0b4ea2", "#d9662b", "#2e8b6e", "#8e1b3a", "#e9b949", "#4a6fa5", "#7f5a9e", "#1fb7c6", "#9c6b30", "#5b6770"];
    const traces = rows.filter((r) => (r.attacks.monthly || []).length).map((r, i) => ({
      type: "bar",
      name: shortName(r.country),
      x: months.map((mo) => mo.label),
      y: months.map((mo) => (r.attacks.monthly.find((x) => x.year === mo.y && x.month === mo.m) || {}).attacks || 0),
      marker: { color: palette[i % palette.length] },
      hovertemplate: L(`${shortName(r.country)}: %{y} attacks in %{x}<extra></extra>`, `${shortName(r.country)} : %{y} attaque(s) en %{x}<extra></extra>`)
    }));
    if (!traces.length) {
      emptyNote(node, L("No attacks recorded in the last 12 months.", "Aucune attaque enregistrée au cours des 12 derniers mois."));
      return;
    }
    plot(node, traces, {
      barmode: "stack",
      margin: { l: 40, r: 10, t: 10, b: 60 },
      height: 320,
      yaxis: { title: { text: L("Attacks per month", "Attaques par mois") }, gridcolor: "#e6edf5" },
      legend: { orientation: "h", y: -0.25 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      ...plotLang()
    });
  }

  // ---------- Data health ----------
  function renderDataHealth() {
    const node = el("dataHealthSources");
    if (node && state.payload) {
      const s = state.payload.sources;
      const line = (name, src, extra = "") => {
        const st = src.status || {};
        const ok = st.ok != null && st.total != null ? L(`${st.ok}/${st.total} loaded`, `${st.ok}/${st.total} chargés`) : "";
        return `<tr><td>${esc(tr(name))}</td><td>${fmtDate(src.fetched_at || src.updated_at || src.loaded_at)}</td><td>${esc(ok)}</td><td>${extra}</td></tr>`;
      };
      const hist = state.payload.history || {};
      const nMonths = (hist.months || []).length;
      const monthsList = esc((hist.months || []).map(monthLabel).join(", ") || L("none yet", "aucun pour l'instant"));
      node.innerHTML = `<div class="table-wrap"><table class="strat-table">
        ${L("<thead><tr><th>Source</th><th>Last successful update</th><th>Coverage</th><th>Notes</th></tr></thead>", "<thead><tr><th>Source</th><th>Dernière mise à jour réussie</th><th>Couverture</th><th>Remarques</th></tr></thead>")}
        <tbody>
          ${line(s.hapi.name, s.hapi, L("Refreshes every 12 hours; country rows fall back to the last good value.", "Actualisé toutes les 12 heures ; en cas d'échec, chaque pays garde sa dernière valeur valide."))}
          ${line(s.fts.name, s.fts, L(`Plan year ${esc(s.fts.year || "n/a")}.`, `Année du plan ${esc(s.fts.year || na())}.`))}
          ${s.hpc ? line(s.hpc.name, s.hpc, L("Health Cluster people in need, targeted and reached, per plan. Reach appears once OCHA generates the plan's monitoring.", "Personnes dans le besoin, ciblées et atteintes par le Cluster Santé, par plan. La couverture apparaît dès qu'OCHA produit le suivi du plan.")) : ""}
          ${line(L("Monthly KPI snapshots", "Instantanés mensuels des indicateurs clés"), { updated_at: state.payload.history?.latest_taken_at || null }, L(`${nMonths} ${nMonths === 1 ? "month" : "months"} held (${monthsList}). Used for the "since last month" arrows.`, `${nMonths} mois conservé${nMonths > 1 ? "s" : ""} (${monthsList}). Utilisés pour les flèches « depuis le mois dernier ».`))}
          ${line(s.ssa.name, s.ssa, L("Countries with an SSA deployment only.", "Uniquement les pays où le SSA est déployé."))}
          ${line(s.grading.name, { updated_at: s.grading.updated_at }, L(`Grading register maintained by DHM (<code>${esc(s.grading.file)}</code> in GitHub).`, `Registre de gradation tenu par la DHM (<code>${esc(s.grading.file)}</code> dans GitHub).`))}
          ${s.reach_register ? line(s.reach_register.name, { updated_at: s.reach_register.rows ? s.reach_register.updated_at : null }, L(`${s.reach_register.rows} ${s.reach_register.rows === 1 ? "entry" : "entries"}${s.reach_register.rejected ? `; ${s.reach_register.rejected} not used (missing reference, date or figure, or a date outside the plan year)` : ""}. Used only until OCHA publishes reach for the plan; each figure shows its reference.`, `${s.reach_register.rows} entrée${s.reach_register.rows > 1 ? "s" : ""}${s.reach_register.rejected ? ` ; ${s.reach_register.rejected} non utilisée${s.reach_register.rejected > 1 ? "s" : ""} (référence, date ou chiffre manquant, ou date hors de l'année du plan)` : ""}. Ces entrées ne servent que jusqu'à ce qu'OCHA publie la couverture du plan ; chaque chiffre indique sa référence.`)) : ""}
          ${line(s.profile.name, { loaded_at: s.profile.loaded_at }, L("Fallback for plan figures not yet in HDX HAPI.", "Solution de repli pour les chiffres de plan pas encore disponibles dans HDX HAPI."))}
        </tbody></table></div>
        <p class="muted">${L("Oldest source in cache:", "Source la plus ancienne en cache :")} ${isNum(state.payload.cache_age_hours) && Number.isFinite(state.payload.cache_age_hours) ? L(`${Math.max(0, state.payload.cache_age_hours).toFixed(1)} hours`, `${dec(Math.max(0, state.payload.cache_age_hours), 1)} heures`) : na()}.</p>
        ${(() => {
          const rf = s.refresh || {};
          const status = rf.running
            ? L(`Refresh running (step: ${esc(rf.step || "starting")}, started ${fmtDate(rf.started_at)})`, `Actualisation en cours (étape : ${esc(rf.step || "démarrage")}, commencée le ${fmtDate(rf.started_at)})`)
            : rf.finished_at
              ? L(`Last refresh attempt finished ${new Date(rf.finished_at).toLocaleString("en-GB")}`, `Dernière tentative d'actualisation terminée le ${new Date(rf.finished_at).toLocaleString("fr-FR")}`)
              : L("No refresh attempted since the server started", "Aucune actualisation tentée depuis le démarrage du serveur");
          const errs = (rf.errors || []).map((e) => `<li><strong>${esc(e.source)}</strong>: ${esc(e.message)}</li>`).join("");
          return L(`<p><strong>Automatic refresh:</strong> ${status}.</p>${errs ? `<p>Problems in the last attempt (the last good values are kept):</p><ul class="bulletin-list">${errs}</ul>` : ""}`,
            `<p><strong>Actualisation automatique :</strong> ${status}.</p>${errs ? `<p>Problèmes lors de la dernière tentative (les dernières valeurs valides sont conservées) :</p><ul class="bulletin-list">${errs}</ul>` : ""}`);
        })()}`;
    }
    const vnode = el("dataHealthValidation");
    if (vnode) {
      const v = state.dash?.service_delivery_status?.validation?.fields || null;
      if (!v || !Object.keys(v).length) {
        emptyNote(vnode, L("No values were excluded in the latest load.", "Aucune valeur n'a été exclue lors du dernier chargement."));
      } else {
        const label = isFr() ? {
          opd_consultations_per_person_per_month: "Consultations externes par personne et par mois",
          anc_visits_mean: "Nombre moyen de visites CPN",
          deliveries_in_health_institution_pct: "Accouchements en établissement de santé (%)",
          measles_vaccination_coverage_pct: "Couverture rougeole (%)",
          penta_vaccination_coverage_pct: "Couverture PENTA (%)",
          sam_complications_pct: "MAS avec complications (%)",
          sam_complications_managed_pct: "Complications de MAS prises en charge (%)",
          facility_disruption_pct: "Établissements perturbés (%)",
          h3_package_pct: "Établissements avec le paquet H3 (%)"
        } : {
          opd_consultations_per_person_per_month: "OPD consultations per person per month",
          anc_visits_mean: "Mean ANC visits",
          deliveries_in_health_institution_pct: "Institutional deliveries (%)",
          measles_vaccination_coverage_pct: "Measles coverage (%)",
          penta_vaccination_coverage_pct: "PENTA coverage (%)",
          sam_complications_pct: "SAM with complications (%)",
          sam_complications_managed_pct: "SAM complications managed (%)",
          facility_disruption_pct: "Facilities with disruption (%)",
          h3_package_pct: "Facilities with H3 package (%)"
        };
        vnode.innerHTML = `<div class="table-wrap"><table class="strat-table">
          ${L("<thead><tr><th>Indicator</th><th>Rule</th><th>Rows excluded</th><th>By country</th></tr></thead>", "<thead><tr><th>Indicateur</th><th>Règle</th><th>Lignes exclues</th><th>Par pays</th></tr></thead>")}
          <tbody>${Object.entries(v).sort((a, b) => b[1].excluded_rows - a[1].excluded_rows).map(([k, x]) => `<tr>
            <td>${esc(label[k] || k)}</td><td>${esc(tr(x.rule))}</td><td class="num">${fmtFull(x.excluded_rows)}</td>
            <td><small>${Object.entries(x.by_country).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${esc(cname(c))} ${n}`).join(", ")}</small></td></tr>`).join("")}</tbody></table></div>
          <p class="muted">${L("Source file: FCV-Services-Deliveries-Database.csv in the GitHub repository, maintained by the FCV data focal point.", "Fichier source : FCV-Services-Deliveries-Database.csv dans le dépôt GitHub, tenu par le point focal des données FCV.")}</p>`;
      }
    }
  }

  // ---------- Key-figure cards on every page ----------
  const LINKS = {
    hapi: ["OCHA HDX HAPI", "https://hapi.humdata.org"],
    hpc: ["OCHA Humanitarian Action (plans and response monitoring)", "https://humanitarianaction.info"],
    fts: ["OCHA Financial Tracking Service", "https://fts.unocha.org"],
    dtm: ["IOM Displacement Tracking Matrix", "https://dtm.iom.int"],
    unhcr: ["UNHCR Refugee Data Finder", "https://www.unhcr.org/refugee-statistics"],
    acled: ["ACLED Conflict Index", "https://acleddata.com/conflict-index/"],
    ssa: ["WHO Surveillance System for Attacks on Health Care", "https://extranet.who.int/ssa/Index.aspx"],
    ipc: ["Integrated Food Security Phase Classification (IPC)", "https://www.ipcinfo.org"],
    fews: ["FEWS NET", "https://fews.net"],
    gdacs: ["GDACS (UN and European Commission)", "https://www.gdacs.org"],
    glofas: ["Copernicus GloFAS flood forecasts", "https://global-flood.emergency.copernicus.eu"],
    emdat: ["EM-DAT disaster database", "https://www.emdat.be"],
    reliefweb: ["ReliefWeb", "https://reliefweb.int"],
    meteo: ["Météo-France La Réunion (RSMC cyclones)", "https://www.meteofrance.re/fr/cyclone"],
    wmo: ["WMO Severe Weather Information Centre", "https://severeweather.wmo.int"],
    cpc: ["NOAA CPC ENSO advisory", "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"],
    icpac: ["ICPAC climate forecasts", "https://www.icpac.net"],
    grading: ["WHO emergency grading", "https://www.who.int/emergencies/grading"],
    inform: ["INFORM Risk and Severity (EC JRC)", "https://drmkc.jrc.ec.europa.eu/inform-index"],
    herams: ["HeRAMS health facility monitoring", "https://www.who.int/initiatives/herams"],
    fcvdb: ["FCV service database (GitHub)", "https://github.com/Fescosof123/who-afro-dashboard/blob/main/FCV-Services-Deliveries-Database.csv"]
  };

  const LINKS_FR = {
    hpc: "OCHA Humanitarian Action (plans et suivi de la réponse)",
    fts: "Service de suivi financier (FTS) d'OCHA",
    dtm: "Matrice de suivi des déplacements (DTM) de l'OIM",
    unhcr: "Refugee Data Finder du HCR",
    acled: "Indice des conflits ACLED",
    ssa: "Système de surveillance des attaques contre les soins de santé (SSA) de l'OMS",
    ipc: "Cadre intégré de classification de la sécurité alimentaire (IPC)",
    gdacs: "GDACS (ONU et Commission européenne)",
    glofas: "Prévisions d'inondations Copernicus GloFAS",
    emdat: "Base de données sur les catastrophes EM-DAT",
    wmo: "Centre d'information sur les phénomènes météorologiques violents de l'OMM",
    cpc: "Bulletin ENSO du CPC de la NOAA",
    icpac: "Prévisions climatiques de l'ICPAC",
    grading: "Classement des urgences par grade (OMS)",
    inform: "INFORM Risque et Sévérité (CCR de la CE)",
    herams: "Suivi des établissements de santé HeRAMS",
    fcvdb: "Base de données des services FCV (GitHub)",
    meteo: "Météo-France La Réunion (CMRS cyclones)"
  };

  function sourcesBar(keys) {
    return `<p class="strat-sources-bar"><span>${L("Sources:", "Sources :")}</span> ${keys.filter((k) => LINKS[k]).map((k) => `<a href="${LINKS[k][1]}" target="_blank" rel="noopener">${esc(L(LINKS[k][0], LINKS_FR[k] || LINKS[k][0]))}</a>`).join(" &middot; ")}</p>`;
  }

  function ensureStrip(pageId) {
    const page = el(pageId);
    if (!page) return null;
    let strip = el(`strip-${pageId}`);
    if (!strip) {
      strip = document.createElement("section");
      strip.id = `strip-${pageId}`;
      strip.className = "panel strat-page-strip";
      page.insertBefore(strip, page.firstChild);
    }
    return strip;
  }

  function renderStrip(pageId, title, note, cards, sourceKeys) {
    const strip = ensureStrip(pageId);
    if (!strip) return;
    strip.innerHTML = `
      <div class="panel-header"><h2>${title}</h2>${note ? `<p>${note}</p>` : ""}</div>
      <div class="strat-kpi-grid strat-strip-grid">${cards.map(kpiCard).join("")}</div>
      ${sourcesBar(sourceKeys)}`;
  }

  function fcvRows() {
    return rowsInScope("fcv13");
  }

  function names(list, max = 4) {
    const shown = list.slice(0, max).map((r) => esc(shortName(r.country || r)));
    return shown.join(", ") + (list.length > max ? L(` and ${list.length - max} more`, ` et ${list.length - max} autre${list.length - max > 1 ? "s" : ""}`) : "");
  }

  function latestFcvQuarter() {
    const rows = state.dash?.service_delivery_quarterly_rows || [];
    if (!rows.length) return null;
    const maxSort = Math.max(...rows.map((r) => Number(r.quarter_sort) || 0));
    const inQ = rows.filter((r) => Number(r.quarter_sort) === maxSort);
    return { label: inQ[0]?.quarter_label || null, rows: inQ };
  }

  function renderDisplacementStrip() {
    const rows = fcvRows();
    const disp = rows.map((r) => ({ r, v: (r.idps && !r.idps.stale ? r.idps.value : 0) + (r.refugees?.value || 0) }));
    const over1m = disp.filter((x) => x.v >= 1e6).sort((a, b) => b.v - a.v);
    const top = rows.filter((r) => r.refugees).sort((a, b) => b.refugees.value - a.refugees.value)[0];
    const acled = (state.dash?.countries || []).filter((c) => (c.fcv_track || "").startsWith("FCV") && /extreme|high/i.test(c.acled_index?.index_level || ""));
    renderStrip("conflictsDisplacementPage", L("Conflict and Displacement: Key Figures", "Conflits et déplacements : chiffres clés"), L("13 FCV countries. Click a card to go to the detail.", "13 pays FCV. Cliquer sur une carte pour accéder au détail."), [
      { id: "cdIdps", title: L("Internally displaced people", "Personnes déplacées internes"), value: fmtCompact(sum(rows, (r) => (r.idps && !r.idps.stale ? r.idps.value : null))), sub: L("Current IOM DTM figures, or the 2026 plan figure where DTM is outdated or covers only part of the country. Outdated figures are left out.", "Chiffres à jour de la DTM de l'OIM, ou chiffre du plan 2026 lorsque la DTM est obsolète ou ne couvre qu'une partie du pays. Les chiffres obsolètes sont exclus."), source: L("IOM DTM via HDX HAPI", "DTM de l'OIM via HDX HAPI"), target: "conflictsDisplacementPage#stratDisplacementPanel" },
      { id: "cdRef", title: L("Refugees and asylum seekers hosted", "Réfugiés et demandeurs d'asile accueillis"), value: fmtCompact(sum(rows, (r) => r.refugees?.value)), sub: L(`Largest host: ${top ? esc(shortName(top.country)) : "n/a"}.`, `Principal pays d'accueil : ${top ? esc(shortName(top.country)) : na()}.`), source: L("UNHCR via HDX HAPI", "HCR via HDX HAPI"), target: "conflictsDisplacementPage#stratDisplacementPanel" },
      { id: "cdOver1m", title: L("Countries with 1 million or more displaced or hosted", "Pays comptant 1 million ou plus de personnes déplacées ou accueillies"), value: String(over1m.length), sub: names(over1m.map((x) => x.r)) || L("None", "Aucun"), source: L("IOM DTM and UNHCR", "DTM de l'OIM et HCR"), target: "conflictsDisplacementPage#stratDisplacementPanel", tone: over1m.length ? "warn" : "" },
      { id: "cdAcled", title: L("Countries at high or extreme conflict level", "Pays à un niveau de conflit élevé ou extrême"), value: String(acled.length), sub: acled.length ? names(acled) : L("No FCV country in the high or extreme band.", "Aucun pays FCV dans la tranche élevée ou extrême."), source: L("ACLED Conflict Index", "Indice des conflits ACLED"), target: "conflictsDisplacementPage#conflictsDisplacementTable", tone: acled.length ? "bad" : "" }
    ], ["dtm", "unhcr", "acled", "hapi"]);
  }

  function renderAttacksStrip() {
    const rows = fcvRows().filter((r) => r.attacks);
    const year = new Date().getFullYear();
    const rising = rows.filter((r) => r.attacks.prev_ytd && r.attacks.ytd && r.attacks.ytd.attacks >= 10 && r.attacks.ytd.attacks > r.attacks.prev_ytd.attacks * 1.25);
    const notCovered = fcvRows().filter((r) => !r.attacks);
    const ssaWho = L("WHO SSA", "SSA de l'OMS");
    renderStrip("attacksHealthPage", L("Attacks on Health Care: Key Figures", "Attaques contre les soins de santé : chiffres clés"), L(`WHO SSA, 13 FCV countries, ${year} to date. Updated ${fmtDate(state.payload.sources.ssa.fetched_at)}.`, `SSA de l'OMS, 13 pays FCV, de janvier ${year} à ce jour. Mis à jour le ${fmtDate(state.payload.sources.ssa.fetched_at)}.`), [
      { id: "ahAttacks", title: L("Attacks this year", "Attaques cette année"), value: fmtFull(sum(rows, (r) => r.attacks.ytd?.attacks)), sub: L(`Same period ${year - 1}: ${fmtFull(sum(rows, (r) => r.attacks.prev_ytd?.attacks))}.`, `Même période ${year - 1} : ${fmtFull(sum(rows, (r) => r.attacks.prev_ytd?.attacks))}.`), source: ssaWho, target: "attacksHealthPage#stratSsaPanel" },
      { id: "ahKilled", title: L("People killed", "Personnes tuées"), value: fmtFull(sum(rows, (r) => r.attacks.ytd?.deaths)), sub: L(`${fmtFull(sum(rows, (r) => r.attacks.ytd?.injuries))} injured.`, `${cap(injuredFr(sum(rows, (r) => r.attacks.ytd?.injuries)))}.`), source: ssaWho, target: "attacksHealthPage#stratSsaPanel", tone: "bad" },
      { id: "ahRising", title: L("Countries with a clear rise in attacks", "Pays avec une hausse nette des attaques"), value: String(rising.length), sub: rising.length ? names(rising) : L("None", "Aucun"), source: L("WHO SSA: 10 or more and 25% above the same period last year", "SSA de l'OMS : 10 ou plus et 25 % au-dessus de la même période l'an dernier"), target: "attacksHealthPage#stratSsaPanel", tone: rising.length ? "warn" : "" },
      { id: "ahGap", title: L("Not covered by WHO surveillance", "Non couverts par la surveillance de l'OMS"), value: String(notCovered.length), sub: notCovered.length ? L(`${names(notCovered, 5)}. Use Health Cluster reporting for these.`, `${names(notCovered, 5)}. Utiliser les rapports du Cluster Santé pour ces pays.`) : L("All covered", "Tous couverts"), source: L("WHO SSA country coverage", "Couverture pays du SSA de l'OMS"), target: "attacksHealthPage#stratSsaPanel" }
    ], ["ssa", "reliefweb"]);
  }

  function renderFoodStrip() {
    const rows = fcvRows();
    const cur = rows.filter((r) => r.ipc && !r.ipc.stale && isNum(r.ipc.fraction));
    const over20 = cur.filter((r) => r.ipc.fraction >= 0.2).sort((a, b) => b.ipc.fraction - a.ipc.fraction);
    const top = cur.slice().sort((a, b) => b.ipc.fraction - a.ipc.fraction)[0];
    const none = rows.filter((r) => !r.ipc || r.ipc.stale);
    renderStrip("foodSecurityPage", L("Food Security: Key Figures", "Sécurité alimentaire : chiffres clés"), L("IPC and Cadre Harmonisé analyses less than 18 months old, 13 FCV countries. Shares refer to the population analysed.", "Analyses IPC et Cadre Harmonisé de moins de 18 mois, 13 pays FCV. Les parts se rapportent à la population analysée."), [
      { id: "fsPeople", title: L("People in IPC/CH Phase 3 or above", "Personnes en phase 3 ou plus de l'IPC/CH"), value: fmtCompact(sum(cur, (r) => r.ipc.population)), sub: L(`${cur.length} countries with a current analysis or projection.`, `${cur.length} pays disposant d'une analyse ou d'une projection à jour.`), source: "IPC via HDX HAPI", target: "foodSecurityPage#foodSecurityTable" },
      { id: "fsOver20", title: L("Countries with 20% or more in Phase 3+", "Pays avec 20 % ou plus en phase 3+"), value: String(over20.length), sub: names(over20) || L("None", "Aucun"), source: "IPC via HDX HAPI", target: "foodSecurityPage#foodSecurityTable", tone: over20.length ? "bad" : "" },
      { id: "fsTop", title: L("Highest share in Phase 3+", "Part la plus élevée en phase 3+"), value: top ? fmtPct(top.ipc.fraction) : na(), sub: top ? L(`${esc(shortName(top.country))}, ${top.ipc.kind === "current" ? "current" : "projection"} ${fmtMonth(top.ipc.period_start)} to ${fmtMonth(top.ipc.period_end)}.`, `${esc(shortName(top.country))}, ${top.ipc.kind === "current" ? "situation actuelle" : "projection"} ${periodFr(top.ipc.period_start, top.ipc.period_end)}.`) : "", source: "IPC via HDX HAPI", target: "foodSecurityPage#foodSecurityTable" },
      { id: "fsNone", title: L("No current analysis", "Pas d'analyse à jour"), value: String(none.length), sub: none.length ? L(`${names(none, 5)}. Analyses older than 18 months are not used.`, `${names(none, 5)}. Les analyses de plus de 18 mois ne sont pas utilisées.`) : L("All countries covered", "Tous les pays sont couverts"), source: "IPC via HDX HAPI", target: "foodSecurityPage#foodSecurityTable", tone: none.length ? "warn" : "" }
    ], ["ipc", "fews", "hapi"]);
  }

  function renderNutritionStrip() {
    const q = latestServiceQuarter();
    const rows = fcvRows().map((r) => q[r.iso3]).filter(Boolean);
    const screened = rows.filter((x) => isNum(x.children_screened_malnutrition));
    const samRows = fcvRows().map((r) => ({ r, q: q[r.iso3] })).filter((x) => x.q && isNum(x.q.sam_complications_managed_pct))
      .sort((a, b) => a.q.sam_complications_managed_pct - b.q.sam_complications_managed_pct);
    const quarters = [...new Set(rows.map((x) => x.quarter_label).filter(Boolean))].sort();
    const qLabel = quarters.length > 1 ? L(`${quarters[0]} to ${quarters[quarters.length - 1]}`, `du ${qLab(quarters[0])} au ${qLab(quarters[quarters.length - 1])}`) : qLab(quarters[0]) || L("latest quarter", "dernier trimestre");
    const fcvDb = L("FCV service database", "Base de données des services FCV");
    renderStrip("nutritionPage", L("Nutrition: Key Figures", "Nutrition : chiffres clés"), L("Latest reported quarter per country from the FCV service database. Survey-based acute malnutrition (GAM, SAM) should come from SMART surveys or IPC Acute Malnutrition analyses.", "Dernier trimestre déclaré par pays dans la base de données des services FCV. La malnutrition aiguë mesurée par enquête (MAG, MAS) doit provenir des enquêtes SMART ou des analyses IPC de la malnutrition aiguë."), [
      { id: "nuScreened", title: L("Children screened for malnutrition (latest quarter)", "Enfants dépistés pour la malnutrition (dernier trimestre)"), value: fmtCompact(sum(screened, (x) => x.children_screened_malnutrition)), sub: L(`${screened.length} countries, each country's latest reported quarter (${esc(qLabel)}). The FCV Response page also shows the total across all quarters.`, `${screened.length} pays, dernier trimestre déclaré par chaque pays (${esc(qLabel)}). La page Réponse FCV présente aussi le total sur l'ensemble des trimestres.`), source: fcvDb, target: "fcvDataPage" },
      { id: "nuSam", title: L("Complicated SAM cases managed: lowest country", "Cas de MAS compliquée pris en charge : pays le plus bas"), value: samRows.length ? fmtPct(samRows[0].q.sam_complications_managed_pct / 100) : na(), sub: samRows.length ? L(`${esc(shortName(samRows[0].r.country))} (${esc(samRows[0].q.quarter_label || "")}). Range across ${samRows.length} countries: ${fmtPct(samRows[0].q.sam_complications_managed_pct / 100)} to ${fmtPct(samRows[samRows.length - 1].q.sam_complications_managed_pct / 100)}.`, `${esc(shortName(samRows[0].r.country))} (${esc(qLab(samRows[0].q.quarter_label || ""))}). Fourchette sur ${samRows.length} pays : de ${fmtPct(samRows[0].q.sam_complications_managed_pct / 100)} à ${fmtPct(samRows[samRows.length - 1].q.sam_complications_managed_pct / 100)}.`) : L("No country reported this indicator.", "Aucun pays n'a déclaré cet indicateur."), source: fcvDb, target: "fcvDataPage" },
      { id: "nuAmn", title: L("Acute malnutrition analyses", "Analyses de la malnutrition aiguë"), value: L("Open maps", "Ouvrir les cartes"), sub: L("Open the IPC Acute Malnutrition maps for the latest survey-based figures by country.", "Ouvrir les cartes IPC de la malnutrition aiguë pour les derniers chiffres d'enquête par pays."), source: "IPC", target: "https://www.ipcinfo.org/ipc-country-analysis/en/" }
    ], ["fcvdb", "ipc"]);
  }

  function renderHazardStrip() {
    const hz = (state.dash?.hazards || []).filter((h) => (h.countries || []).length);
    const level = (h) => {
      const raw = String(h.alert_level || h.alertlevel || h.title || "").toLowerCase();
      return /^red|\bred\b/.test(raw) ? "red" : /^orange|\borange\b/.test(raw) ? "orange" : "green";
    };
    const hazardFeedEmpty = !(state.dash?.hazards || []).length;
    const redOrange = hz.filter((h) => level(h) !== "green");
    const countries = [...new Set(hz.flatMap((h) => h.countries))];
    const floods = state.dash?.regional_flood_signals || [];
    const enso = state.dash?.enso_advisory;
    const countryNames = countries.slice(0, 6).map((iso) => esc(shortName((state.dash?.countries || []).find((c) => c.iso3 === iso)?.country || iso))).join(", ");
    renderStrip("hazardPage", L("Hazards and Floods: Key Figures", "Aléas et inondations : chiffres clés"), L("Natural hazard alerts linked to African countries in the current refresh.", "Alertes aux aléas naturels liées aux pays africains dans l'actualisation en cours."), [
      { id: "hzAlerts", title: L("GDACS alerts (all levels)", "Alertes GDACS (tous niveaux)"), value: hazardFeedEmpty ? L("No data", "Pas de données") : String(hz.length), sub: L(`${redOrange.length} orange or red; the rest are green (low expected impact).`, `${redOrange.length} orange ou rouge ; les autres sont vertes (faible impact attendu).`), source: "GDACS", target: "hazardPage#gdacsSummary", tone: redOrange.length ? "warn" : "" },
      { id: "hzCountries", title: L("Countries with an active alert", "Pays avec une alerte active"), value: String(countries.length), sub: L(countryNames + (countries.length > 6 ? ` and ${countries.length - 6} more` : "") || "None", countryNames + (countries.length > 6 ? ` et ${countries.length - 6} autre${countries.length - 6 > 1 ? "s" : ""}` : "") || "Aucun"), source: "GDACS", target: "hazardPage#hazardFeed" },
      { id: "hzFloods", title: L("Flood updates", "Informations sur les inondations"), value: floods.length ? String(floods.length) : L("None in feed", "Aucune dans le flux"), sub: L("Flood advisories and situation reports in the current window.", "Avis d'inondation et rapports de situation de la période en cours."), source: "ReliefWeb, GloFAS", target: "hazardPage#floodWatchSummary" },
      { id: "hzEnso", title: L("ENSO status", "État de l'ENSO"), value: enso?.alert_status ? esc(enso.alert_status) : na(), sub: enso?.issued_on ? L(`Issued ${esc(enso.issued_on)}; next update ${esc(enso.next_update || "n/a")}.`, `Publié le ${esc(enso.issued_on)} ; prochaine mise à jour ${esc(enso.next_update || na())}.`) : "", source: "NOAA CPC", target: "forecastPage" }
    ], ["gdacs", "glofas", "reliefweb", "emdat"]);
  }

  function renderCycloneStrip() {
    const c = state.dash?.cyclone_intelligence || {};
    renderStrip("cyclonePage", L("Cyclone Watch: Key Figures", "Vigie cyclonique : chiffres clés"), L("The South-West Indian Ocean cyclone season runs from November to April.", "La saison cyclonique du sud-ouest de l'océan Indien s'étend de novembre à avril."), [
      { id: "cyActive", title: L("Named cyclones, last 21 days", "Cyclones nommés, 21 derniers jours"), value: fmtFull(c.active_cyclone_count || 0), sub: L(`Last ${c.active_window_days || 21} days.`, `${c.active_window_days || 21} derniers jours.`), source: L("Météo-France La Réunion, WMO", "Météo-France La Réunion, OMM"), target: "cyclonePage#activeCyclonesList", tone: c.active_cyclone_count ? "bad" : "" },
      { id: "cyProj", title: L("Forecast tracks and advisories", "Trajectoires prévues et avis"), value: fmtFull(c.projection_signal_count || 0), sub: L("Forecast tracks and advisories in the current refresh.", "Trajectoires prévues et avis dans l'actualisation en cours."), source: L("Météo-France, WMO", "Météo-France, OMM"), target: "cyclonePage#cycloneProjectionFeed" },
      { id: "cyCountries", title: L("Countries with a cyclone signal", "Pays avec un signal cyclonique"), value: fmtFull(c.countries_with_cyclone_signal || 0), sub: L("Mapped from advisories to country names.", "Établi à partir des avis, par nom de pays."), source: "Météo-France, GDACS", target: "cyclonePage#cycloneCountryTable" }
    ], ["meteo", "wmo", "gdacs"]);
  }

  function renderForecastStrip() {
    const enso = state.dash?.enso_advisory;
    const fc = state.dash?.forecasts || [];
    const elevated = fc.filter((f) => f.risk_level && !/watch|low|normal/i.test(f.risk_level));
    renderStrip("forecastPage", L("Climate Forecasts: Key Figures", "Prévisions climatiques : chiffres clés"), L("Seasonal climate outlooks that can change health risk (floods, drought, disease).", "Perspectives climatiques saisonnières susceptibles de modifier le risque sanitaire (inondations, sécheresse, maladies)."), [
      { id: "fcEnso", title: L("ENSO status", "État de l'ENSO"), value: enso?.alert_status ? esc(enso.alert_status) : na(), sub: enso?.synopsis ? esc(enso.synopsis) : "", source: `NOAA CPC${enso?.issued_on ? `, ${esc(enso.issued_on)}` : ""}`, target: enso?.url || LINKS.cpc[1], tone: /el ni|la ni/i.test(enso?.alert_status || "") ? "warn" : "" },
      { id: "fcIcpac", title: L("ICPAC forecast bulletins", "Bulletins de prévision de l'ICPAC"), value: String(fc.length), sub: L("Weekly, monthly and seasonal products for the Greater Horn of Africa.", "Produits hebdomadaires, mensuels et saisonniers pour la Grande Corne de l'Afrique."), source: "ICPAC", target: "forecastPage#icpacFeed" },
      { id: "fcElevated", title: L("Bulletins above watch level", "Bulletins au-dessus du niveau de veille"), value: String(elevated.length), sub: elevated.length ? elevated.slice(0, 2).map((f) => esc(f.title)).join("; ") : L("None above watch level.", "Aucun au-dessus du niveau de veille."), source: "ICPAC", target: "forecastPage#forecastTable" }
    ], ["cpc", "icpac", "fews"]);
  }

  function renderFcvStrip() {
    const q = latestFcvQuarter();
    const fcvIso = new Set(fcvRows().map((r) => r.iso3));
    const rows = (q?.rows || []).filter((r) => fcvIso.has(r.iso3));
    const v = state.dash?.service_delivery_status?.validation?.fields || {};
    const excluded = Object.values(v).reduce((s2, x) => s2 + (x.excluded_rows || 0), 0);
    const fcvDb = L("FCV service database", "Base de données des services FCV");
    const qName = esc(qLab(q?.label) || L("latest quarter", "dernier trimestre"));
    renderStrip("fcvDataPage", L("FCV Response: Key Figures", "Réponse FCV : chiffres clés"), L(`Most recent quarter in the FCV service database: ${esc(q?.label || "n/a")}.`, `Trimestre le plus récent dans la base de données des services FCV : ${esc(qLab(q?.label) || na())}.`), [
      { id: "fvReporting", title: L("Countries reporting", "Pays ayant fait rapport"), value: L(`${rows.length}<small> of 13</small>`, `${rows.length}<small> sur 13</small>`), sub: L(`In ${esc(q?.label || "the latest quarter")}. Reports for the most recent quarter may still be arriving.`, `Pour ${esc(qLab(q?.label) || "le dernier trimestre")}. Les rapports du trimestre le plus récent peuvent encore arriver.`), source: fcvDb, target: "fcvDataPage#fcvRegReportingHeatmap", tone: rows.length < 9 ? "warn" : "" },
      { id: "fvReached", title: L(`Service contacts reported (${qName})`, `Contacts de service déclarés (${qName})`), value: fmtCompact(sum(rows, (r) => r.people_reached)), sub: L("Sum of monthly \"people reached\" reports in the quarter; the same person may be counted more than once.", "Somme des déclarations mensuelles de « personnes atteintes » sur le trimestre ; une même personne peut être comptée plusieurs fois."), source: fcvDb, target: "fcvDataPage#fcvRegVolumeKpiGrid" },
      { id: "fvMhpss", title: L(`People reached with MHPSS (${qName})`, `Personnes ayant bénéficié de services de SMSPS (${qName})`), value: fmtFull(sum(rows, (r) => r.mental_health_beneficiaries)), sub: L(`Covers only countries that reported in this quarter. GBV cases managed: ${fmtFull(sum(rows, (r) => r.gbv_cases_managed))}. Totals across all quarters are under Regional Service Volumes.`, `Ne couvre que les pays ayant fait rapport ce trimestre. Cas de VBG pris en charge : ${fmtFull(sum(rows, (r) => r.gbv_cases_managed))}. Les totaux sur l'ensemble des trimestres figurent sous Volumes de services régionaux.`), source: fcvDb, target: "fcvDataPage#fcvRegVolumeKpiGrid" },
      { id: "fvExcluded", title: L("Values held back for correction", "Valeurs signalées pour correction"), value: fmtFull(excluded), sub: L("Rates and percentages outside plausible limits, left out of all averages until corrected.", "Taux et pourcentages hors des limites plausibles, exclus de toutes les moyennes jusqu'à leur correction."), source: L("Data checks on loading", "Contrôles des données au chargement"), target: "dataHealthPage#dataHealthValidation", tone: excluded ? "warn" : "" }
    ], ["fcvdb", "herams"]);
  }

  function renderGradingStripLinks() {
    const node = el("gradingSummary");
    if (!node) return;
    node.querySelectorAll(".strat-kpi").forEach((card, i) => {
      card.classList.remove("strat-kpi-static");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.dataset.stratTarget = i === 4 ? "gradingPage#gradingRegister" : "gradingPage#gradingTable";
    });
    let bar = el("gradingSources");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "gradingSources";
      node.insertAdjacentElement("afterend", bar);
    }
    bar.innerHTML = sourcesBar(["grading", "inform", "hapi", "ipc", "dtm", "ssa"]);
  }

  function renderDataHealthStrip() {
    const s = state.payload.sources;
    const okSources = ["hapi", "fts", "ssa"].filter((k) => s[k]?.status && s[k].status.ok > 0).length;
    const rows = fcvRows();
    const v = state.dash?.service_delivery_status?.validation?.fields || {};
    const excluded = Object.values(v).reduce((s2, x) => s2 + (x.excluded_rows || 0), 0);
    const oldest = fmtDate([s.hapi.fetched_at, s.fts.fetched_at, s.ssa.fetched_at].filter(Boolean).sort()[0]);
    renderStrip("dataHealthPage", L("Data Health: Key Figures", "Qualité des données : chiffres clés"), "", [
      { id: "dhSources", title: L("Core online sources loaded", "Sources en ligne principales chargées"), value: L(`${okSources}<small> of 3</small>`, `${okSources}<small> sur 3</small>`), sub: L(`Oldest refresh ${oldest}.`, `Actualisation la plus ancienne : ${oldest}.`), source: L("HDX HAPI, OCHA FTS, WHO SSA", "HDX HAPI, FTS d'OCHA, SSA de l'OMS"), target: "dataHealthPage#dataHealthSources", tone: okSources < 3 ? "bad" : "" },
      { id: "dhExcluded", title: L("Service values held back", "Valeurs de services exclues"), value: fmtFull(excluded), sub: L("Listed by indicator and country below.", "Détail par indicateur et par pays ci-dessous."), source: L("FCV service database", "Base de données des services FCV"), target: "dataHealthPage#dataHealthValidation", tone: excluded ? "warn" : "" },
      { id: "dhStale", title: L("Outdated country figures", "Chiffres pays obsolètes"), value: String(rows.filter((r) => (r.idps && r.idps.stale) || (r.ipc && r.ipc.stale) || r.health_outdated).length), sub: L("Countries with displacement, IPC or plan figures older than their update deadline.", "Pays dont les chiffres de déplacement, d'IPC ou de plan dépassent leur délai de mise à jour."), source: L("Freshness rules", "Règles de fraîcheur"), target: "overviewPage#stratTable" }
    ], ["hapi", "fts", "ssa", "fcvdb"]);
  }

  function renderPageStrips() {
    if (!state.payload) return;
    renderDisplacementStrip();
    renderAttacksStrip();
    renderFoodStrip();
    renderGradingStripLinks();
    renderDataHealthStrip();
    if (state.dash) {
      renderNutritionStrip();
      renderHazardStrip();
      renderCycloneStrip();
      renderForecastStrip();
      renderFcvStrip();
    }
  }

  // ---------- Weekly operational update (top of the Operational Bulletin) ----------
  function isoWeekKey(d = new Date()) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / 864e5 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  function noteBox(key, label, placeholder) {
    const storeKey = `who_afro_bulletin_${isoWeekKey()}_${key}`;
    let saved = "";
    try { saved = localStorage.getItem(storeKey) || ""; } catch (e) { saved = ""; }
    return `<div class="bulletin-note">
      <h4>${label}</h4>
      <div class="bulletin-note-box" contenteditable="true" data-note-key="${storeKey}" data-placeholder="${esc(placeholder)}">${esc(saved)}</div>
    </div>`;
  }

  const TABLE_ATTR = 'border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:10pt;"';
  const TH = 'style="background:#0b4ea2;color:#ffffff;text-align:left;padding:5px 7px;"';

  // The bulletin cover leads with the same messages as the Overview, so the cover
  // and Part A never disagree.
  function renderCoverMessages() {
    const list = document.querySelector("#operationalBulletinCover .bulletin-cover-messages");
    if (!list || !state.payload) return;
    const msgs = buildMessages(rowsInScope("fcv13"));
    if (msgs.length) list.innerHTML = msgs.map((m) => `<li>${m}</li>`).join("");
  }

  // "Since last week": compares with the latest snapshot from an earlier ISO week.
  // Only like-for-like changes are reported: same source, same plan year, same
  // calendar year for year-to-date counts, and a new survey round for IPC and DTM.
  function weeklyChanges(rows) {
    const wb = state.payload?.history?.week_base;
    if (!wb) {
      const first = state.payload?.history?.latest_taken_at;
      return L(`<p class="muted">The weekly comparison starts next week${first ? `; figures were first stored on ${esc(fmtDate(first))}` : ""}.</p>`,
        `<p class="muted">La comparaison hebdomadaire commencera la semaine prochaine${first ? ` ; les chiffres ont été enregistrés pour la première fois le ${esc(fmtDate(first))}` : ""}.</p>`);
    }
    const items = [];
    const prev = (r) => wb.countries?.[r.iso3];
    const nowYear = String(state.payload.generated_at || new Date().toISOString()).slice(0, 4);
    const baseYear = String(wb.taken_at || "").slice(0, 4);
    const lc = (t) => String(t || "").toLowerCase();

    // Tier changes, with their cause.
    const moves = rows.filter((r) => prev(r)?.level && prev(r).level !== r.classification.level);
    if (moves.length) {
      items.push(`${L("DHM triage tier changed:", "Changement de niveau de triage DHM :")} ${moves.map((r) => {
        const p = prev(r);
        const cause = p.level === "Insufficient data" ? L("enough current data now available", "suffisamment de données à jour désormais disponibles")
          : r.classification.level === "Insufficient data" ? L("too few current indicators this week", "trop peu d'indicateurs à jour cette semaine")
            : isNum(p.score) && p.score !== r.classification.score ? L(`score ${p.score} to ${r.classification.score} of 8`, `score de ${p.score} à ${r.classification.score} sur 8`)
              : L("data available changed; score unchanged", "données disponibles modifiées ; score inchangé");
        return L(`${esc(shortName(r.country))} (${esc(lc(p.level))} to ${esc(lc(r.classification.level))}; ${cause})`,
          `${esc(shortName(r.country))} (${esc(lc(levelName(p.level)))} à ${esc(lc(levelName(r.classification.level)))} ; ${cause})`);
      }).join(", ")}.`);
    }

    // Attacks added to WHO SSA (year-to-date counts, same calendar year only).
    const att = rows.filter((r) => r.attacks && isNum(prev(r)?.attacks_ytd)
      && (prev(r).attacks_year || baseYear) === String(r.attacks.period?.start || nowYear).slice(0, 4)
      && r.attacks.ytd.attacks > prev(r).attacks_ytd);
    if (att.length) {
      const attText = att.map((r) => {
        const dDeaths = isNum(prev(r).attack_deaths_ytd) ? r.attacks.ytd.deaths - prev(r).attack_deaths_ytd : null;
        return `${esc(shortName(r.country))} +${fmtFull(r.attacks.ytd.attacks - prev(r).attacks_ytd)}${dDeaths != null ? ` (${dDeaths > 0 ? L(`${fmtFull(dDeaths)} more deaths`, `${fmtFull(dDeaths)} décès supplémentaire${dDeaths > 1 ? "s" : ""}`) : L("no further deaths", "aucun décès supplémentaire")})` : ""}`;
      }).join(", ");
      items.push(L(`Attacks on health care added to the WHO Surveillance System for Attacks on Health Care (SSA): ${attText}. Some may have happened earlier and been recorded late.`,
        `Attaques contre les soins de santé ajoutées au Système de surveillance des attaques contre les soins de santé (SSA) de l'OMS : ${attText}. Certaines ont pu se produire plus tôt et être enregistrées tardivement.`));
    }

    // Net change in health funding reported to OCHA FTS (same plan year only).
    if (baseYear === nowYear) {
      const fund = rows.filter((r) => r.health_funding && isNum(prev(r)?.health_funding_usd) && Math.abs(r.health_funding.funding_usd - prev(r).health_funding_usd) >= 1000);
      if (fund.length) {
        items.push(`${L("Health funding reported to OCHA FTS, net change:", "Financement de la santé déclaré au FTS d'OCHA, variation nette :")} ${fund.map((r) => {
          const d = r.health_funding.funding_usd - prev(r).health_funding_usd;
          const pPct = isNum(prev(r).health_requirements_usd) && prev(r).health_requirements_usd > 0 ? prev(r).health_funding_usd / prev(r).health_requirements_usd : null;
          return `${esc(shortName(r.country))} ${d > 0 ? "+" : minus()}${fmtUsd(Math.abs(d))}${pPct != null ? L(` (${fmtPct(pPct)} to ${fmtPct(r.health_funding.pct)} funded)`, ` (financé de ${fmtPct(pPct)} à ${fmtPct(r.health_funding.pct)})`) : ""}`;
        }).join(", ")}.`);
      }
    }

    // Plan figures: a revision within the same plan and source, or a change of source.
    const sameYearPin = rows.filter((r) => isNum(prev(r)?.health_in_need) && prev(r).health_in_need > 0 && isNum(r.health_in_need?.value)
      && String(prev(r).health_in_need_year || "") === String(r.health_in_need.year || ""));
    const revised = sameYearPin.filter((r) => (prev(r).health_in_need_publisher || r.health_in_need.source) === r.health_in_need.source
      && Math.abs(r.health_in_need.value - prev(r).health_in_need) / prev(r).health_in_need >= 0.05);
    if (revised.length) {
      items.push(L(`Plan figures for people in need of health assistance revised by 5% or more: ${revised.map((r) => `${esc(shortName(r.country))} ${fmtCompact(prev(r).health_in_need)} to ${fmtCompact(r.health_in_need.value)}`).join(", ")}.`,
        `Chiffres des plans pour les personnes ayant besoin d'une assistance sanitaire révisés de 5${NBSP}% ou plus : ${revised.map((r) => `${esc(shortName(r.country))} de ${fmtCompact(prev(r).health_in_need)} à ${fmtCompact(r.health_in_need.value)}`).join(", ")}.`));
    }
    const reSourced = sameYearPin.filter((r) => prev(r).health_in_need_publisher && prev(r).health_in_need_publisher !== r.health_in_need.source
      && Math.abs(r.health_in_need.value - prev(r).health_in_need) / prev(r).health_in_need >= 0.05);
    if (reSourced.length) {
      items.push(L(`Source of the people in need figure changed: ${reSourced.map((r) => `${esc(shortName(r.country))} now ${fmtCompact(r.health_in_need.value)} from ${esc(plainSource(r.health_in_need.source))} (last week ${fmtCompact(prev(r).health_in_need)} from ${esc(plainSource(prev(r).health_in_need_publisher))})`).join(", ")}.`,
        `Changement de source du chiffre des personnes dans le besoin : ${reSourced.map((r) => `${esc(shortName(r.country))} désormais ${fmtCompact(r.health_in_need.value)} selon ${esc(plainSource(r.health_in_need.source))} (semaine dernière ${fmtCompact(prev(r).health_in_need)} selon ${esc(plainSource(prev(r).health_in_need_publisher))})`).join(", ")}.`));
    }

    // New IOM DTM round or new IPC/CH analysis.
    const dtm = rows.filter((r) => r.idps && !r.idps.stale && isNum(prev(r)?.idps) && prev(r).idps > 0 && prev(r).idps_date && r.idps.date && prev(r).idps_date !== r.idps.date);
    if (dtm.length) {
      items.push(L(`New internal displacement figures: ${dtm.map((r) => `${esc(shortName(r.country))} ${fmtCompact(prev(r).idps)} to ${fmtCompact(r.idps.value)} (${esc(fmtMonth(r.idps.date))})`).join(", ")}.`,
        `Nouveaux chiffres de déplacement interne : ${dtm.map((r) => `${esc(shortName(r.country))} de ${fmtCompact(prev(r).idps)} à ${fmtCompact(r.idps.value)} (${esc(fmtMonth(r.idps.date))})`).join(", ")}.`));
    }
    const ipc = rows.filter((r) => r.ipc && !r.ipc.stale && prev(r)?.ipc_period_end && r.ipc.period_end && prev(r).ipc_period_end !== r.ipc.period_end);
    if (ipc.length) {
      items.push(L(`New IPC/CH analysis: ${ipc.map((r) => `${esc(shortName(r.country))} ${isNum(prev(r).ipc_fraction) ? `${fmtPct(prev(r).ipc_fraction)} to ` : ""}${fmtPct(r.ipc.fraction)} in Phase 3 or above`).join(", ")}.`,
        `Nouvelle analyse IPC/CH : ${ipc.map((r) => `${esc(shortName(r.country))} ${isNum(prev(r).ipc_fraction) ? `de ${fmtPct(prev(r).ipc_fraction)} à ` : ""}${fmtPct(r.ipc.fraction)} en phase 3 ou plus`).join(", ")}.`));
    }

    const when = L(`figures held on ${esc(fmtDate(wb.taken_at))}`, `les chiffres disponibles le ${esc(fmtDate(wb.taken_at))}`);
    return items.length
      ? `<ul class="bulletin-list">${items.map((t) => `<li>${t}</li>`).join("")}</ul><p class="muted">${L(`Compared with ${when}.`, `Comparaison avec ${when}.`)}</p>`
      : L(`<p>No change in tiers, attacks, funding, plan figures, displacement rounds or IPC analyses since ${when}.</p>`,
        `<p>Aucun changement de niveau, d'attaques, de financement, de chiffres des plans, de cycles de déplacement ou d'analyses IPC depuis ${when}.</p>`);
  }

  function renderBulletinWeekly() {
    setTimeout(renderCoverMessages, 0);
    const node = el("bulletinWeekly");
    if (!node || !state.payload) return;
    const rows = rowsInScope("fcv13");
    const k = computeKpis(rows);
    const src = state.payload.sources;
    const week = isoWeekKey();
    const priority = rows
      .filter((r) => r.classification.level === "Major" || r.classification.level === "Severe")
      .sort((a, b) => (LEVEL_ORDER[b.classification.level] - LEVEL_ORDER[a.classification.level]) || (b.classification.score - a.classification.score));
    const latestByCountry = latestServiceQuarter();
    const qRows = rows.map((r) => latestByCountry[r.iso3]).filter(Boolean);
    const qLabels = [...new Set(qRows.map((r) => r.quarter_label))].sort();
    const hz = (state.dash?.hazards || []).filter((h) => (h.countries || []).some((iso) => rows.some((r) => r.iso3 === iso)));
    const hzRedOrange = hz.filter((h) => /^(red|orange)/i.test(h.title || ""));
    const aliases = { COD: ["democratic republic of the congo", "dr congo", "drc"], CAF: ["central african republic"] };
    const patterns = rows.flatMap((r) => (aliases[r.iso3] || [r.country.toLowerCase()]).map((n) => new RegExp(`(^|[^a-z])${n}([^a-z]|$)`, "i")));
    const outbreaks = (state.dash?.who_don_reports || []).filter((o) => patterns.some((re) => re.test(String(o.title || "")))).slice(0, 5);
    const cyc = state.dash?.cyclone_intelligence || {};
    const floods = state.dash?.regional_flood_signals || [];
    const enso = state.dash?.enso_advisory;
    const lowFunded = rows.filter((r) => r.health_funding && isNum(r.health_funding.pct)).sort((a, b) => a.health_funding.pct - b.health_funding.pct).slice(0, 3);
    const messages = buildMessages(rows).map((m) => `<li>${m}</li>`).join("");

    const kpiRows = isFr() ? [
      ["Pays en crise majeure ou sévère (niveau de triage DHM)", `${k.major.length + k.severe.length} sur ${rows.length} (majeur : ${names(k.major, 5) || "aucun"})`, "Triage interne DHM à partir des indicateurs ci-dessous"],
      ["Urgences classées par l'OMS", k.graded ? String(k.graded) : "Aucune enregistrée dans le registre des grades de la DHM", "Registre des grades de l'OMS (DHM)"],
      ["Personnes ayant besoin d'une assistance sanitaire", fmtCompact(k.healthPin), `Plans de réponse humanitaire (OCHA Humanitarian Action ; OCHA via HDX si nécessaire), actualisés le ${fmtDate(src.hpc?.fetched_at || src.hapi.fetched_at)}`],
      ["Financement de la santé : part reçue et déficit (plans 2026)", `${fmtPct(k.pct)} reçus ; déficit ${fmtUsd(k.gap)}`, `FTS d'OCHA, actualisé le ${fmtDate(src.fts.fetched_at)}`],
      ["Déplacés internes ; réfugiés et demandeurs d'asile accueillis", `${fmtCompact(k.idps)} ; ${fmtCompact(k.refugees)}`, `DTM de l'OIM (dernier cycle par pays) et HCR (fin ${esc(rows.find((r) => r.refugees)?.refugees.year || na())}) via HDX HAPI`],
      ["Attaques contre les soins de santé cette année", `${fmtFull(k.attacks)} attaque${k.attacks > 1 ? "s" : ""}, ${k.deaths === 0 ? "aucune personne tuée" : `${fmtFull(k.deaths)} personne${k.deaths > 1 ? "s" : ""} tuée${k.deaths > 1 ? "s" : ""}`}, ${injuredFr(k.injuries)}`, `SSA de l'OMS, actualisé le ${fmtDate(src.ssa.fetched_at)}`],
      ["Personnes en phase 3 ou plus de l'IPC/CH (analyses de moins de 18 mois)", fmtCompact(sum(rows.filter((r) => r.ipc && !r.ipc.stale), (r) => r.ipc.population)), "IPC via HDX HAPI, dernière analyse par pays"]
    ] : [
      ["Countries in major or severe crisis (DHM triage tier)", `${k.major.length + k.severe.length} of ${rows.length} (major: ${names(k.major, 5) || "none"})`, "DHM internal triage from the indicators below"],
      ["WHO-graded emergencies", k.graded ? String(k.graded) : "None recorded in the DHM grading register", "WHO grading register (DHM)"],
      ["People in need of health assistance", fmtCompact(k.healthPin), `Humanitarian plans (OCHA Humanitarian Action; OCHA via HDX where needed), refreshed ${fmtDate(src.hpc?.fetched_at || src.hapi.fetched_at)}`],
      ["Health funding: share received and gap (2026 plans)", `${fmtPct(k.pct)} received; gap ${fmtUsd(k.gap)}`, `OCHA FTS, refreshed ${fmtDate(src.fts.fetched_at)}`],
      ["Internally displaced; refugees and asylum seekers hosted", `${fmtCompact(k.idps)}; ${fmtCompact(k.refugees)}`, `IOM DTM (latest round per country) and UNHCR (end of ${esc(rows.find((r) => r.refugees)?.refugees.year || "n/a")}) via HDX HAPI`],
      ["Attacks on health care this year", `${fmtFull(k.attacks)} attacks, ${fmtFull(k.deaths)} people killed, ${fmtFull(k.injuries)} injured`, `WHO SSA, refreshed ${fmtDate(src.ssa.fetched_at)}`],
      ["People in IPC/CH Phase 3 or above (analyses under 18 months old)", fmtCompact(sum(rows.filter((r) => r.ipc && !r.ipc.stale), (r) => r.ipc.population)), "IPC via HDX HAPI, latest analysis per country"]
    ];

    node.innerHTML = isFr() ? `
      <div class="panel-header">
        <h2>Partie A : Point stratégique et opérationnel, semaine ${esc(week.slice(-2))} de ${esc(week.slice(0, 4))}</h2>
        <p>Informations destinées à la direction et aux opérations sur les 13 pays FCV : la situation stratégique, la situation opérationnelle, la réponse et les lacunes. Les chiffres proviennent des sources indiquées, chacune avec sa date, et s'actualisent automatiquement ; le niveau de crise est le triage propre à la DHM, fondé sur des règles. Les encadrés de note facultatifs permettent à l'agent de permanence d'ajouter du contexte avant l'impression ou l'export ; les encadrés vides sont omis. Les notes ne sont enregistrées que dans ce navigateur.</p>
      </div>

      <h3 class="bulletin-h3">1. Situation stratégique</h3>
      <table ${TABLE_ATTR}><thead><tr><th ${TH}>Indicateur</th><th ${TH}>Valeur</th><th ${TH}>Source</th></tr></thead>
        <tbody>${kpiRows.map(([a, b, c]) => `<tr><td>${a}</td><td><strong>${b}</strong></td><td>${c}</td></tr>`).join("")}</tbody></table>
      ${messages ? `<ol class="bulletin-messages">${messages}</ol>` : ""}
      <h4 class="bulletin-h4">Ce qui a changé depuis la semaine dernière</h4>
      ${weeklyChanges(rows)}

      <h3 class="bulletin-h3">2. Situation opérationnelle</h3>
      <ul class="bulletin-list">
        <li>Aléas naturels : ${(state.dash?.hazards || []).length ? `${fmtFull(hz.length)} alertes GDACS dans les pays FCV (${fmtFull(hzRedOrange.length)} orange ou rouge)` : "le flux GDACS n'a renvoyé aucune donnée lors de cette actualisation"} ; ${floods.length ? `${fmtFull(floods.length)} informations sur les inondations dans la région` : "aucune information sur les inondations dans le flux"} ; ${!cyc.active_cyclone_count ? "aucun cyclone nommé" : cyc.active_cyclone_count === 1 ? "1 cyclone nommé" : `${fmtFull(cyc.active_cyclone_count)} cyclones nommés`} au cours des ${cyc.active_window_days || 21} derniers jours.</li>
        <li>Perspectives climatiques : ${enso?.alert_status ? `${esc(enso.alert_status)} (NOAA CPC${enso.issued_on ? `, ${esc(enso.issued_on)}` : ""})` : "état de l'ENSO non disponible lors de cette actualisation"}.</li>
        <li>Flambées : ${outbreaks.length ? `Bulletins d'information sur les flambées épidémiques de l'OMS, 30 derniers jours : ${outbreaks.map((o) => esc(o.title || o.summary || "")).filter(Boolean).slice(0, 3).join(" ; ")}` : "aucun bulletin d'information sur les flambées épidémiques de l'OMS pour ces pays au cours des 30 derniers jours"}. Les flambées classées apparaissent dans le registre des grades de l'OMS dès que la DHM les saisit ; le bulletin hebdomadaire de l'OMS AFRO sur les flambées donne la liste complète.</li>
      </ul>
      ${noteBox("risk", "Note facultative : principal risque sanitaire de la semaine", "Principale menace sanitaire de la semaine et où (flambée, vague de déplacements, inondation).")}
      <h4 class="bulletin-h4">Pays prioritaires (niveaux majeur et sévère)</h4>
      <table ${TABLE_ATTR}><thead><tr><th ${TH}>Pays</th><th ${TH}>Niveau DHM</th><th ${TH}>Personnes dans le besoin (santé)</th><th ${TH}>Santé financée</th><th ${TH}>Déplacés internes</th><th ${TH}>IPC/CH 3+</th><th ${TH}>Attaques cette année</th></tr></thead>
        <tbody>${priority.map((r) => `<tr>
          <td><strong>${esc(cname(r.country))}</strong></td><td>${esc(levelName(r.classification.level))}</td>
          <td>${r.health_in_need ? fmtCompact(r.health_in_need.value) : r.health_outdated ? `${fmtCompact(r.health_outdated.value)} (dernier plan, ${esc(r.health_outdated.year)})` : "pas de plan"}</td>
          <td>${r.health_funding ? fmtPct(r.health_funding.pct) : "pas de plan"}</td>
          <td>${r.idps ? `${fmtCompact(r.idps.value)}${r.idps.stale ? ` (obsolète, ${esc(fmtMonth(r.idps.date))})` : ""}` : na()}</td>
          <td>${r.ipc ? `${fmtPct(r.ipc.fraction)}${r.ipc.stale ? ` (obsolète, ${esc(fmtMonth(r.ipc.period_end))})` : ""}` : "pas d'analyse"}</td>
          <td>${r.attacks ? `${fmtFull(r.attacks.ytd.attacks)} (${killedFr(r.attacks.ytd.deaths)})` : "non couvert par le SSA de l'OMS"}</td></tr>`).join("")}</tbody></table>
      ${noteBox("countries", "Note facultative : point par pays", "Une ou deux lignes par pays prioritaire : ce qui a changé et ce que fait l'OMS.")}

      <h3 class="bulletin-h3">3. Réponse</h3>
      <ul class="bulletin-list">
        <li>Financement reçu par le Cluster Santé dans les plans 2026 : <strong>${fmtUsd(k.got)}</strong> sur ${fmtUsd(k.req)} (${fmtPct(k.pct)} ; médiane par pays ${fmtPct(k.medianPct)}).</li>
        <li>Prestation de services FCV, dernier trimestre déclaré par pays (${qRows.length} pays sur 13 ; du ${esc(qLab(qLabels[0]) || na())} au ${esc(qLab(qLabels[qLabels.length - 1]) || na())}) : ${fmtCompact(sum(qRows, (r) => r.people_reached))} contacts de service déclarés (somme des rapports mensuels, une même personne peut donc être comptée plusieurs fois), ${fmtFull(sum(qRows, (r) => r.mental_health_beneficiaries))} personnes ayant bénéficié de services de santé mentale et de soutien psychosocial (SMSPS), ${fmtFull(sum(qRows, (r) => r.gbv_cases_managed))} cas de VBG pris en charge, ${fmtFull(sum(qRows, (r) => r.children_screened_malnutrition))} enfants dépistés pour la malnutrition.</li>
      </ul>
      ${noteBox("response", "Note facultative : faits marquants de la réponse de l'OMS", "Déploiements, fournitures, campagnes, décisions de coordination de la semaine.")}

      <h3 class="bulletin-h3">4. Lacunes</h3>
      <ul class="bulletin-list">
        <li>Déficit de financement de la santé : <strong>${fmtUsd(k.gap)}</strong> ; couverture la plus faible pour ${lowFunded.length ? frList(lowFunded, (r) => fmtPct(r.health_funding.pct)) : na()}.</li>
        <li>Couverture sanitaire : ${k.healthReachedCountries
          ? `${fmtCompact(k.healthReached)} personnes atteintes sur ${fmtCompact(k.healthReachTargeted)} ciblées (${fmtPct(k.healthReached / Math.max(1, k.healthReachTargeted))}) dans ${k.healthReachedCountries} pays depuis le début de l'année`
          : k.reachLatest.year
            ? `OCHA n'a pas encore publié les chiffres ${new Date().getFullYear()} ; le dernier résultat annuel complet (${esc(k.reachLatest.year)}) est de ${fmtCompact(k.reachLatest.reached)} personnes atteintes sur ${fmtCompact(k.reachLatest.targeted)} ciblées (${fmtPct(k.reachLatest.reached / Math.max(1, k.reachLatest.targeted))}) dans ${k.reachLatest.rows.length} pays`
            : "pas encore publiée par OCHA"}. Les plans ciblent ${fmtCompact(k.healthTargeted)} des ${fmtCompact(k.healthPin)} personnes dans le besoin (${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))}).</li>
        <li>SMSPS : médiane de ${k.mhpssMedian != null ? k.mhpssMedian.toFixed(0) : na()} personnes atteintes pour 10${NBSP}000 personnes dans le besoin ; aucune cible régionale de SMSPS n'est publiée.</li>
        <li>Lacunes de surveillance et de données : ${k.notInSsa.length ? `la surveillance des attaques par l'OMS ne couvre pas ${frList(k.notInSsa, null, 6)}` : "la surveillance des attaques par l'OMS couvre tous les pays"} ; ${k.noHealthPlan.length ? `pas de plan humanitaire en cours pour ${frList(k.noHealthPlan, null, 6)}` : "tous les pays ont un plan humanitaire en cours"}.</li>
      </ul>
      ${noteBox("gaps", "Note facultative : décisions attendues de la direction", "Lacunes nécessitant une décision : financement, personnel, fournitures, accès.")}
      ${sourcesBar(["hpc", "hapi", "fts", "dtm", "unhcr", "ipc", "ssa", "fcvdb"])}` : `
      <div class="panel-header">
        <h2>Part A: Strategic and Operational Update, week ${esc(week.slice(-2))} of ${esc(week.slice(0, 4))}</h2>
        <p>Information for management and operations on the 13 FCV countries: the strategic picture, the operational situation, the response and the gaps. Figures come from the sources listed, each with its date, and refresh automatically; the crisis tier is DHM's own rule-based triage. The optional note boxes let the duty officer add context before printing or exporting; empty boxes are left out. Notes are saved only in this browser.</p>
      </div>

      <h3 class="bulletin-h3">1. Strategic picture</h3>
      <table ${TABLE_ATTR}><thead><tr><th ${TH}>Indicator</th><th ${TH}>Value</th><th ${TH}>Source</th></tr></thead>
        <tbody>${kpiRows.map(([a, b, c]) => `<tr><td>${a}</td><td><strong>${b}</strong></td><td>${c}</td></tr>`).join("")}</tbody></table>
      ${messages ? `<ol class="bulletin-messages">${messages}</ol>` : ""}
      <h4 class="bulletin-h4">What changed since last week</h4>
      ${weeklyChanges(rows)}

      <h3 class="bulletin-h3">2. Operational situation</h3>
      <ul class="bulletin-list">
        <li>Natural hazards: ${(state.dash?.hazards || []).length ? `${fmtFull(hz.length)} GDACS alerts in FCV countries (${fmtFull(hzRedOrange.length)} orange or red)` : "GDACS feed returned no data in this refresh"}; ${floods.length ? `${fmtFull(floods.length)} flood updates in the region` : "no flood updates in the feed"}; ${fmtFull(cyc.active_cyclone_count || 0)} named cyclones in the last ${cyc.active_window_days || 21} days.</li>
        <li>Climate outlook: ${enso?.alert_status ? `${esc(enso.alert_status)} (NOAA CPC${enso.issued_on ? `, ${esc(enso.issued_on)}` : ""})` : "ENSO status not available in this refresh"}.</li>
        <li>Outbreaks: ${outbreaks.length ? `WHO Disease Outbreak News, last 30 days: ${outbreaks.map((o) => esc(o.title || o.summary || "")).filter(Boolean).slice(0, 3).join("; ")}` : "no WHO Disease Outbreak News items for these countries in the last 30 days"}. Graded outbreaks appear in the WHO grading register once DHM enters them; the WHO AFRO weekly bulletin on outbreaks has the full list.</li>
      </ul>
      ${noteBox("risk", "Optional note: major health risk this week", "Main health threat this week and where (outbreak, displacement wave, flood).")}
      <h4 class="bulletin-h4">Priority countries (major and severe tiers)</h4>
      <table ${TABLE_ATTR}><thead><tr><th ${TH}>Country</th><th ${TH}>DHM tier</th><th ${TH}>People in need (health)</th><th ${TH}>Health funded</th><th ${TH}>IDPs</th><th ${TH}>IPC/CH 3+</th><th ${TH}>Attacks this year</th></tr></thead>
        <tbody>${priority.map((r) => `<tr>
          <td><strong>${esc(r.country)}</strong></td><td>${esc(r.classification.level)}</td>
          <td>${r.health_in_need ? fmtCompact(r.health_in_need.value) : r.health_outdated ? `${fmtCompact(r.health_outdated.value)} (last plan, ${esc(r.health_outdated.year)})` : "no plan"}</td>
          <td>${r.health_funding ? fmtPct(r.health_funding.pct) : "no plan"}</td>
          <td>${r.idps ? `${fmtCompact(r.idps.value)}${r.idps.stale ? ` (outdated, ${esc(fmtMonth(r.idps.date))})` : ""}` : "n/a"}</td>
          <td>${r.ipc ? `${fmtPct(r.ipc.fraction)}${r.ipc.stale ? ` (outdated, ${esc(fmtMonth(r.ipc.period_end))})` : ""}` : "no analysis"}</td>
          <td>${r.attacks ? `${fmtFull(r.attacks.ytd.attacks)} (${fmtFull(r.attacks.ytd.deaths)} killed)` : "not covered by WHO SSA"}</td></tr>`).join("")}</tbody></table>
      ${noteBox("countries", "Optional note: country updates", "One or two lines per priority country: what changed and what WHO is doing.")}

      <h3 class="bulletin-h3">3. Response</h3>
      <ul class="bulletin-list">
        <li>Health Cluster funding received in 2026 plans: <strong>${fmtUsd(k.got)}</strong> of ${fmtUsd(k.req)} (${fmtPct(k.pct)}; median per country ${fmtPct(k.medianPct)}).</li>
        <li>FCV service delivery, latest reported quarter per country (${qRows.length} of 13 countries; ${esc(qLabels[0] || "n/a")} to ${esc(qLabels[qLabels.length - 1] || "n/a")}): ${fmtCompact(sum(qRows, (r) => r.people_reached))} service contacts reported (monthly reports summed, so people may be counted more than once), ${fmtFull(sum(qRows, (r) => r.mental_health_beneficiaries))} people reached with mental health and psychosocial support (MHPSS), ${fmtFull(sum(qRows, (r) => r.gbv_cases_managed))} GBV cases managed, ${fmtFull(sum(qRows, (r) => r.children_screened_malnutrition))} children screened for malnutrition.</li>
      </ul>
      ${noteBox("response", "Optional note: WHO response highlights", "Deployments, supplies, campaigns, coordination decisions this week.")}

      <h3 class="bulletin-h3">4. Gaps</h3>
      <ul class="bulletin-list">
        <li>Health funding gap: <strong>${fmtUsd(k.gap)}</strong>; lowest coverage in ${lowFunded.map((r) => `${esc(shortName(r.country))} (${fmtPct(r.health_funding.pct)})`).join(", ") || "n/a"}.</li>
        <li>Health reach: ${k.healthReachedCountries
          ? `${fmtCompact(k.healthReached)} reached of ${fmtCompact(k.healthReachTargeted)} targeted (${fmtPct(k.healthReached / Math.max(1, k.healthReachTargeted))}) in ${k.healthReachedCountries} countries so far this year`
          : k.reachLatest.year
            ? `OCHA has not yet published ${new Date().getFullYear()} figures; the latest full-year result (${esc(k.reachLatest.year)}) is ${fmtCompact(k.reachLatest.reached)} reached of ${fmtCompact(k.reachLatest.targeted)} targeted (${fmtPct(k.reachLatest.reached / Math.max(1, k.reachLatest.targeted))}) in ${k.reachLatest.rows.length} countries`
            : "not yet published by OCHA"}. Plans target ${fmtCompact(k.healthTargeted)} of ${fmtCompact(k.healthPin)} people in need (${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))}).</li>
        <li>MHPSS: median ${k.mhpssMedian != null ? k.mhpssMedian.toFixed(0) : "n/a"} people reached per 10,000 in need; no regional MHPSS target is published.</li>
        <li>Surveillance and data gaps: WHO attack surveillance does not cover ${names(k.notInSsa, 6) || "none"}; no current humanitarian plan for ${names(k.noHealthPlan, 6) || "none"}.</li>
      </ul>
      ${noteBox("gaps", "Optional note: decisions needed from management", "Gaps that need a decision: funding, staff, supplies, access.")}
      ${sourcesBar(["hpc", "hapi", "fts", "dtm", "unhcr", "ipc", "ssa", "fcvdb"])}`;

    node.querySelectorAll("[data-note-key]").forEach((box) => {
      box.addEventListener("input", () => {
        try { localStorage.setItem(box.dataset.noteKey, box.innerText); } catch (e) { /* per-browser convenience only */ }
      });
    });
  }

  // ---------- Destination labels for clickable cards ----------
  const PAGE_LABEL = {
    overviewPage: "Overview", gradingPage: "Crisis Classification", fcvDataPage: "FCV Response", countryPage: "Country Profiles",
    conflictsDisplacementPage: "Conflict & Displacement", attacksHealthPage: "Attacks on Health Care", foodSecurityPage: "Food Security",
    nutritionPage: "Nutrition", hazardPage: "Hazards & Floods", cyclonePage: "Cyclone Watch", forecastPage: "Climate Forecasts",
    operationalReportPage: "Operational Bulletin", signalsPage: "Event Signals", dataHealthPage: "Data Health"
  };
  // French page names, the same as the French navigation menu (PHRASE_FR in app.js).
  const PAGE_LABEL_FR = {
    overviewPage: "Vue d'ensemble", gradingPage: "Classification des crises", fcvDataPage: "Réponse FCV", countryPage: "Profils pays",
    conflictsDisplacementPage: "Conflits et déplacements", attacksHealthPage: "Attaques contre les soins de santé", foodSecurityPage: "Sécurité alimentaire",
    nutritionPage: "Nutrition", hazardPage: "Aléas et inondations", cyclonePage: "Vigie cyclonique", forecastPage: "Prévisions climatiques",
    operationalReportPage: "Bulletin opérationnel", signalsPage: "Signaux d'événements", dataHealthPage: "Qualité des données"
  };
  function destinationLabel(target) {
    if (!target) return "";
    if (/^https?:/.test(target)) return L("Opens the source website", "Ouvre le site web de la source");
    const [page, anchor] = String(target).split("#");
    const node = anchor ? el(anchor) : null;
    const panelTitle = node ? (node.closest(".panel")?.querySelector("h2")?.textContent || "").trim() : "";
    const pageName = isFr() ? (PAGE_LABEL_FR[page] || PAGE_LABEL[page] || page) : (PAGE_LABEL[page] || page);
    return panelTitle && !panelTitle.startsWith(pageName) ? L(`${pageName}: ${panelTitle}`, `${pageName} \u2013 ${panelTitle}`) : pageName;
  }
  // French typography on rendered text (spaces before : ; ! ? %, guillemets).
  const TYPO_IDS = ["stratKpiGrid", "stratTrendNote", "stratStatusTable", "stratMessages", "stratMapNote", "stratTable", "stratSources",
    "gradingSummary", "gradingSources", "gradingTable", "gradingRegister", "gradingRules", "stratCountryCard", "stratDisplacementPanel",
    "stratSsaPanel", "dataHealthSources", "dataHealthValidation", "bulletinWeekly", "signalsMapExplain", "forecastBriefing"];
  function typoNode(root) {
    if (!root || !isFr()) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest("svg, script, style, [contenteditable]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    nodes.forEach((n) => {
      const v = frTypoText(n.nodeValue);
      if (v !== n.nodeValue) n.nodeValue = v;
    });
  }
  function typoAll() {
    if (!isFr()) return;
    TYPO_IDS.forEach((id) => typoNode(el(id)));
    document.querySelectorAll(".strat-page-strip").forEach(typoNode);
  }

  function decorateCardDestinations() {
    document.querySelectorAll(".strat-kpi[data-strat-target], .metric-card[data-strat-target]").forEach((card) => {
      const target = card.dataset.stratTarget;
      if (!target) return;
      let more = card.querySelector(".strat-kpi-more");
      if (!more) {
        more = document.createElement("span");
        more.className = "strat-kpi-more";
        card.appendChild(more);
      }
      more.textContent = L(`More detail: ${destinationLabel(target)} ›`, `Plus de détails › ${destinationLabel(target)}`);
      card.title = /^https?:/.test(target) ? L("Open the source website", "Ouvrir le site web de la source") : L(`Open ${destinationLabel(target)}`, `Ouvrir ${destinationLabel(target)}`);
    });
    typoAll();
  }

  // ---------- Strategic KPI status (Overview) ----------
  const STATUS_STYLE = {
    "Act now": ["#8e1b3a", "#fff"],
    Attention: ["#e8a33b", "#0d1f33"],
    "On track": ["#2e8b6e", "#fff"],
    "No data": ["#b9c4cf", "#0d1f33"]
  };
  function statusTag(status) {
    const [bg, fg] = STATUS_STYLE[status] || STATUS_STYLE["No data"];
    const fr = { "Act now": "Agir maintenant", Attention: "Attention", "On track": "Conforme", "No data": "Pas de données" };
    return `<span class="strat-level" style="background:${bg};color:${fg}">${esc(L(status, fr[status] || status))}</span>`;
  }

  function renderStatusTable() {
    const table = el("stratStatusTable");
    if (!table || !state.payload) return;
    const rows = rowsInScope();
    const k = computeKpis(rows);
    const ipcHigh = rows.filter((r) => r.ipc && !r.ipc.stale && r.ipc.fraction >= 0.2);
    const funded = rows.filter((r) => r.health_funding && isNum(r.health_funding.pct));
    const lowFunded = funded.filter((r) => r.health_funding.pct < 0.2 || (k.pct != null && r.health_funding.pct < k.pct / 2));
    const lowCoverage = rows.filter((r) => isNum(r.health_in_need?.value) && isNum(r.health_targeted?.value) && r.health_targeted.value / r.health_in_need.value < 0.4);
    const rising = rows.filter((r) => r.attacks?.prev_ytd && r.attacks.ytd && r.attacks.ytd.attacks >= 10 && r.attacks.ytd.attacks > r.attacks.prev_ytd.attacks * 1.25);
    const deaths = rows.filter((r) => r.attacks?.ytd?.deaths > 0);
    const lowMhpss = k.mhpss.filter((x) => x.rate < 10).map((x) => x.r);
    const bigDisp = rows.filter((r) => ((r.idps && !r.idps.stale ? r.idps.value : 0) + (r.refugees?.value || 0)) >= 1e6);
    const svc = latestServiceQuarter();
    const quarters = (state.dash?.service_delivery_quarterly_rows || []).map((r) => Number(r.quarter_sort) || 0);
    const maxQ = quarters.length ? Math.max(...quarters) : null;
    const notReporting = maxQ == null ? [] : rows.filter((r) => r.group === "fcv_prioritized" || r.group === "fcv_accelerated").filter((r) => !svc[r.iso3] || Number(svc[r.iso3].quarter_sort) < maxQ - 1);
    const hasCoverageData = rows.some((r) => isNum(r.health_in_need?.value) && isNum(r.health_targeted?.value));
    const outdated = rows.filter((r) => (r.idps && r.idps.stale) || (r.ipc && r.ipc.stale) || r.health_outdated || !r.health_in_need);

    const items = [
      { q: "Where is the health burden concentrated?", kpi: `${k.major.length} countries in the major tier; ${fmtCompact(k.healthPin)} people in need of health assistance`, trigger: "Country in the major tier of the DHM triage", flagged: k.major, status: k.major.length ? "Act now" : "On track", decision: "Prioritise staff surge and regional support", link: "gradingPage#gradingTable" },
      { q: "How deep is the food crisis?", kpi: `${ipcHigh.length} countries with 20% or more of the analysed population in IPC/CH Phase 3+`, trigger: "Phase 3+ share of 20% or more (analysis under 18 months old)", flagged: ipcHigh, status: ipcHigh.length ? "Act now" : "On track", decision: "Integrate nutrition and disease surveillance in food-insecure areas", link: "foodSecurityPage#foodSecurityTable" },
      { q: "Is the health response funded?", kpi: `${fmtPct(k.pct)} received across plans; median per country ${fmtPct(k.medianPct)}`, trigger: "Under 20% funded, or under half the FCV average", flagged: lowFunded, status: lowFunded.length ? "Act now" : funded.length ? "On track" : "No data", decision: "Donor briefing; pooled-fund and CERF discussions", link: "overviewPage#stratFundingChart" },
      { q: "Are plans covering health needs?", kpi: `Plans target ${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))} of people in need; ${k.healthReachedCountries ? `${fmtPct(k.healthReached / Math.max(1, k.healthReachTargeted))} of target reached so far` : k.reachLatest.year ? `${new Date().getFullYear()} reach not yet published (${esc(k.reachLatest.year)}: ${fmtPct(k.reachLatest.reached / Math.max(1, k.reachLatest.targeted))} of target reached in the ${k.reachLatest.rows.length} countries with final figures)` : "reach is not yet published"}`, trigger: "Plan targets under 40% of health need. Once reach is reported: under 50% reached by mid-year", flagged: lowCoverage, status: lowCoverage.length ? "Attention" : hasCoverageData ? "On track" : "No data", decision: "Review prioritisation, partners and access", link: "overviewPage#stratCoverageChart" },
      { q: "Is health care under attack?", kpi: `${fmtFull(k.attacks)} attacks and ${fmtFull(k.deaths)} people killed this year`, trigger: "10 or more attacks and 25% above the same period last year; or any deaths", flagged: [...new Map([...rising, ...deaths].map((r) => [r.iso3, r])).values()], status: rising.length ? "Act now" : deaths.length ? "Attention" : "On track", decision: "Protection advocacy; continuity and security review", link: "attacksHealthPage#stratSsaPanel" },
      { q: "Are psychosocial needs being met?", kpi: k.mhpssMedian != null ? `Median ${k.mhpssMedian.toFixed(0)} people reached with MHPSS per 10,000 in need` : "No MHPSS data", trigger: "Fewer than 10 per 10,000 in need (provisional until a target is set)", flagged: lowMhpss, status: !k.mhpss.length ? "No data" : lowMhpss.length ? "Attention" : "On track", decision: "Fund MHPSS partners; integrate MHPSS into primary care", link: "overviewPage#stratMhpssChart" },
      { q: "How large is displacement?", kpi: `${fmtCompact(k.idps)} internally displaced; ${fmtCompact(k.refugees)} refugees hosted`, trigger: "1 million or more displaced or hosted", flagged: bigDisp, status: bigDisp.length ? "Attention" : "On track", decision: "Plan services in camps and host areas; review surge", link: "conflictsDisplacementPage#stratDisplacementPanel" },
      { q: "Can we trust the numbers?", kpi: `${notReporting.length} FCV countries not reporting service data in the last two quarters; ${outdated.length} with outdated or missing plan, displacement or IPC figures`, trigger: "No service report for two quarters, or a figure older than its update deadline", flagged: [...new Map([...notReporting, ...outdated].map((r) => [r.iso3, r])).values()], status: maxQ == null && !outdated.length ? "No data" : notReporting.length || outdated.length ? "Attention" : "On track", decision: "Follow up with country offices before the figures are used", link: "dataHealthPage#dataHealthValidation" }
    ];
    // French display text for the same rows (logic, statuses and links above are unchanged).
    if (isFr()) {
      const reachFr = k.healthReachedCountries
        ? `${fmtPct(k.healthReached / Math.max(1, k.healthReachTargeted))} de la cible atteinte à ce jour`
        : k.reachLatest.year
          ? `couverture ${new Date().getFullYear()} pas encore publiée (${esc(k.reachLatest.year)} : ${fmtPct(k.reachLatest.reached / Math.max(1, k.reachLatest.targeted))} de la cible atteinte dans les ${k.reachLatest.rows.length} pays disposant de chiffres définitifs)`
          : "la couverture n'est pas encore publiée";
      const fr = [
        ["Où se concentre la charge sanitaire ?", `${k.major.length} pays au niveau majeur ; ${fmtCompact(k.healthPin)} personnes ayant besoin d'une assistance sanitaire`, "Pays au niveau majeur du triage DHM", "Prioriser le renfort de personnel et l'appui régional"],
        ["Quelle est la profondeur de la crise alimentaire ?", `${ipcHigh.length} pays avec 20${NBSP}% ou plus de la population analysée en phase 3+ IPC/CH`, "Part en phase 3+ de 20 % ou plus (analyse de moins de 18 mois)", "Intégrer la surveillance nutritionnelle et épidémiologique dans les zones en insécurité alimentaire"],
        ["La réponse sanitaire est-elle financée ?", `${fmtPct(k.pct)} reçus pour l'ensemble des plans ; médiane par pays ${fmtPct(k.medianPct)}`, "Financé à moins de 20 %, ou à moins de la moitié de la moyenne FCV", "Réunion d'information des bailleurs ; discussions sur les fonds communs et le CERF"],
        ["Les plans couvrent-ils les besoins en santé ?", `Les plans ciblent ${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))} des personnes dans le besoin ; ${reachFr}`, "Cibles des plans inférieures à 40 % des besoins en santé. Une fois la couverture déclarée : moins de 50 % atteints à mi-année", "Revoir la priorisation, les partenaires et l'accès"],
        ["Les soins de santé sont-ils attaqués ?", `${fmtFull(k.attacks)} attaques et ${fmtFull(k.deaths)} personnes tuées cette année`, "10 attaques ou plus et 25 % au-dessus de la même période l'an dernier ; ou au moins un décès", "Plaidoyer pour la protection ; examen de la continuité des services et de la sécurité"],
        ["Les besoins psychosociaux sont-ils couverts ?", k.mhpssMedian != null ? `Médiane de ${k.mhpssMedian.toFixed(0)} personnes ayant bénéficié de services de SMSPS pour 10${NBSP}000 personnes dans le besoin` : "Pas de données de SMSPS", "Moins de 10 pour 10 000 personnes dans le besoin (provisoire, en attendant la fixation d'une cible)", "Financer les partenaires de SMSPS ; intégrer la SMSPS dans les soins de santé primaires"],
        ["Quelle est l'ampleur des déplacements ?", `${fmtCompact(k.idps)} déplacés internes ; ${fmtCompact(k.refugees)} réfugiés accueillis`, "1 million ou plus de personnes déplacées ou accueillies", "Planifier les services dans les camps et les zones d'accueil ; revoir le renfort"],
        ["Peut-on se fier aux chiffres ?", `${notReporting.length} pays FCV sans données de services sur les deux derniers trimestres ; ${outdated.length} avec des chiffres de plan, de déplacement ou d'IPC obsolètes ou manquants`, "Aucun rapport de services depuis deux trimestres, ou un chiffre plus ancien que son délai de mise à jour", "Faire le suivi avec les bureaux de pays avant d'utiliser les chiffres"]
      ];
      items.forEach((it, i) => {
        if (!fr[i]) return;
        [it.q, it.kpi, it.trigger, it.decision] = fr[i];
      });
    }
    table.innerHTML = `${L("<thead><tr><th>Management question</th><th>Where we are</th><th>Trigger</th><th>Status</th><th>Countries meeting the trigger</th><th>Decision it informs</th><th></th></tr></thead>",
      "<thead><tr><th>Question de gestion</th><th>Situation actuelle</th><th>Seuil de déclenchement</th><th>Statut</th><th>Pays atteignant le seuil</th><th>Décision éclairée</th><th></th></tr></thead>")}
      <tbody>${items.map((it) => `<tr>
        <td><strong>${esc(it.q)}</strong></td>
        <td>${it.kpi}</td>
        <td><small>${esc(it.trigger)}</small></td>
        <td>${statusTag(it.status)}</td>
        <td>${it.flagged.length ? names(it.flagged, 6) : `<span class="muted">${L("none", "aucun")}</span>`}</td>
        <td><small>${esc(it.decision)}</small></td>
        <td><button type="button" class="strat-link" data-strat-target="${esc(it.link)}">${L("Detail ›", "Détail ›")}</button></td>
      </tr>`).join("")}</tbody>`;
  }

  // ---------- Map labels and explanations ----------
  function centroidFor(iso3) {
    try {
      // COUNTRY_CENTROIDS and COUNTRY_SHORT_LABELS are defined in app.js.
      // eslint-disable-next-line no-undef
      return typeof COUNTRY_CENTROIDS !== "undefined" ? COUNTRY_CENTROIDS[iso3] : null;
    } catch (e) {
      return null;
    }
  }
  function shortCode(iso3) {
    const fr = { COD: "RDC", CAF: "RCA" };
    if (isFr() && fr[iso3]) return fr[iso3];
    try {
      // eslint-disable-next-line no-undef
      return (typeof COUNTRY_SHORT_LABELS !== "undefined" && COUNTRY_SHORT_LABELS[iso3]) || iso3;
    } catch (e) {
      return iso3;
    }
  }
  function mapValueLabel(r, layer) {
    const v = mapValue(r, layer);
    if (v == null) return "";
    switch (layer) {
      case "classification": return levelName(r.classification.level);
      case "funding_pct":
      case "ipc": return L(`${Math.round(v)}%`, `${Math.round(v)}${NBSP}%`);
      case "attacks": return String(v);
      default: return fmtCompact(v);
    }
  }
  const LAYER_NOTE = {
    classification: "Colour shows the DHM triage tier: a rule-based score (0 to 8) from INFORM Risk, people in need of health assistance, IPC/CH Phase 3+ share, displacement and attacks on health care. Major is 6 to 8 points, Severe 3 to 5, Moderate 0 to 2; countries with fewer than 3 current core indicators show as Insufficient data. It is not a WHO grade.",
    health_pin: "People in need of health assistance in the latest humanitarian plan (OCHA, through HDX HAPI).",
    funding_pct: "Share of the Health Cluster requirement received in 2026 plans (OCHA FTS). Red marks the least-funded countries.",
    displaced: "Internally displaced people (IOM DTM, current figures only) plus refugees and asylum seekers hosted (UNHCR).",
    ipc: "Share of the analysed population in IPC/CH Phase 3 or above, from the latest analysis under 18 months old.",
    attacks: "Attacks on health care recorded by WHO SSA this year. Countries without SSA deployment show no value."
  };
  const LAYER_NOTE_FR = {
    classification: "La couleur indique le niveau de triage DHM : un score fondé sur des règles (de 0 à 8) à partir du risque INFORM, des personnes ayant besoin d'une assistance sanitaire, de la part en phase 3+ IPC/CH, des déplacements et des attaques contre les soins de santé. Majeur correspond à 6 à 8 points, Sévère à 3 à 5, Modéré à 0 à 2 ; les pays disposant de moins de 3 indicateurs de base à jour apparaissent en Données insuffisantes. Ce n'est pas un grade OMS.",
    health_pin: "Personnes ayant besoin d'une assistance sanitaire dans le dernier plan de réponse humanitaire (OCHA, via HDX HAPI).",
    funding_pct: "Part des besoins du Cluster Santé reçue dans les plans 2026 (FTS d'OCHA). Le rouge signale les pays les moins financés.",
    displaced: "Déplacés internes (DTM de l'OIM, chiffres à jour uniquement) plus réfugiés et demandeurs d'asile accueillis (HCR).",
    ipc: "Part de la population analysée en phase 3 ou plus de l'IPC/CH, selon la dernière analyse de moins de 18 mois.",
    attacks: "Attaques contre les soins de santé enregistrées par le SSA de l'OMS cette année. Les pays où le SSA n'est pas déployé n'ont pas de valeur."
  };
  function renderMapNote() {
    const node = el("stratMapNote");
    if (!node || !state.payload) return;
    const layer = state.mapLayer;
    const ranked = rowsInScope()
      .map((r) => ({ r, v: mapValue(r, layer) }))
      .filter((x) => x.v != null)
      .sort((a, b) => (layer === "funding_pct" ? a.v - b.v : b.v - a.v))
      .slice(0, 3);
    node.innerHTML = `<p><strong>${L("How to read this map.", "Comment lire cette carte.")}</strong> ${esc(L(LAYER_NOTE[layer] || "", LAYER_NOTE_FR[layer] || LAYER_NOTE[layer] || ""))} ${layer === "classification" ? `<button type="button" class="strat-link" data-strat-target="gradingPage#gradingTable">${L("See the points per country ›", "Voir les points par pays ›")}</button>` : ""}</p>
      ${ranked.length ? `<p><strong>${layer === "funding_pct" ? L("Least funded", "Les moins financés") : L("Highest", "Valeurs les plus élevées")}${L(":", " :")}</strong> ${ranked.map((x) => `<button type="button" class="strat-link" data-strat-country="${x.r.iso3}">${esc(shortName(x.r.country))}</button> (${esc(mapValueLabel(x.r, layer))})`).join(", ")}.</p>` : ""}`;
    typoNode(node);
  }

  function labelTrace(rows, layer) {
    const pts = rows.map((r) => ({ r, c: centroidFor(r.iso3), label: mapValueLabel(r, layer), v: mapValue(r, layer) })).filter((x) => x.c && x.label);
    const vals = pts.map((x) => x.v).filter(isNum);
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 1;
    // White text on the dark end of the colour scale, dark text elsewhere.
    const onDark = (x) => {
      if (layer === "classification") return x.r.classification.level === "Major" || x.r.classification.level === "Severe";
      if (layer === "funding_pct") return x.v <= 35;
      const frac = hi > lo ? (x.v - lo) / (hi - lo) : 0;
      return frac > 0.55;
    };
    return {
      type: "scattergeo",
      mode: "text",
      lat: pts.map((x) => x.c[0]),
      lon: pts.map((x) => x.c[1]),
      text: pts.map((x) => `<b>${shortCode(x.r.iso3)}</b><br>${x.label}`),
      textfont: { size: 10, color: pts.map((x) => (onDark(x) ? "#ffffff" : "#0d1f33")), family: "Barlow, sans-serif" },
      hoverinfo: "skip",
      showlegend: false
    };
  }

  // ---------- Event Signals map explanation ----------
  function renderSignalsExplain() {
    const node = el("signalsMapExplain");
    if (!node || !state.dash) return;
    const countries = (state.dash.countries || []).slice().sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
    const top = countries.slice(0, 5);
    const driver = (c) => {
      const parts = [];
      const ipcPct = c.ipc?.phase3plus_pct;
      if (isNum(ipcPct)) parts.push(L(`IPC/CH Phase 3+ ${fmtPct(ipcPct)}`, `phase 3+ IPC/CH ${fmtPct(ipcPct)}`));
      else if (c.fews_ipc?.ml1_phase || c.fews_ipc?.cs_phase) parts.push(`FEWS NET phase ${c.fews_ipc.ml1_phase || c.fews_ipc.cs_phase}`);
      const cd = (c.conflict_signal_count || 0) + (c.displacement_signal_count || 0);
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      if (cd) parts.push(plural(cd, L("conflict or displacement report", "rapport sur les conflits ou les déplacements"), L("conflict or displacement reports", "rapports sur les conflits ou les déplacements")));
      if (c.hazard_count) parts.push(plural(c.hazard_count, L("hazard alert", "alerte aux aléas"), L("hazard alerts", "alertes aux aléas")));
      if (c.flood_count) parts.push(plural(c.flood_count, L("flood signal", "signal d'inondation"), L("flood signals", "signaux d'inondation")));
      if (c.report_count_30d) parts.push(plural(c.report_count_30d, L("report in 30 days", "rapport en 30 jours"), L("reports in 30 days", "rapports en 30 jours")));
      return parts.join(", ") || L("few signals", "peu de signaux");
    };
    node.innerHTML = isFr() ? `
      <p><strong>Construction du score.</strong> Chaque pays reçoit un score de signal calculé à partir de sources publiques de l'actualisation en cours. Lorsque des données IPC existent : part en phase 3+ IPC/CH (32 points), phase FEWS NET (13) et émaciation de l'enfant selon la dernière enquête disponible (5). Lorsque l'IPC manque : phase FEWS NET (32) et émaciation (23). Puis les rapports sur les conflits et les déplacements (22), les signaux d'inondation (8), d'aléas (6), de sécheresse (4) et de cyclone (4), le volume de rapports des 30 derniers jours (10) et les bulletins de prévision de l'ICPAC (5 ; le même nombre régional pour chaque pays de l'IGAD). Chaque composante est mise à l'échelle entre le pays le plus bas et le plus haut de cette actualisation ; les totaux peuvent donc légèrement dépasser 100.</p>
      <p><strong>Ce que cela signifie.</strong> Le score classe les pays les uns par rapport aux autres cette semaine. Ce n'est pas une mesure de sévérité, et il peut varier lorsque d'autres pays évoluent.</p>
      <p><strong>Bandes :</strong> 1 Faible (0 à 20), 2 À surveiller (21 à 40), 3 Élevé (41 à 60), 4 Haut (61 à 80), 5 Critique (81 et plus). Le bouton « IPC Phase 3+ » affiche sur la carte la seule part en phase 3+ IPC/CH.</p>
      <p><strong>Pays présentant les signaux les plus forts actuellement :</strong></p>
      <ol class="strat-signal-list">${top.map((c) => `<li><button type="button" class="strat-link" data-strat-country="${esc(c.iso3)}">${esc(cname(c.country))}</button> : score ${esc(c.risk_score)} (${esc(bandForRiskLabel(c.risk_score))}) ; ${esc(driver(c))}.</li>`).join("")}</ol>
      <p class="muted">Pour le classement stratégique des crises, utiliser la page <button type="button" class="strat-link" data-strat-target="gradingPage#gradingTable">Classification des crises</button>.</p>` : `
      <p><strong>How the score is built.</strong> Each country gets a signal score from public sources in the current refresh. Where IPC data exist: IPC/CH Phase 3+ share (32 points), FEWS NET phase (13) and child wasting from the latest available survey (5). Where IPC is missing: FEWS NET phase (32) and wasting (23). Then conflict and displacement reports (22), flood (8), hazard (6), drought (4) and cyclone (4) signals, report volume in the last 30 days (10) and ICPAC forecast bulletins (5; the same regional count for every IGAD country). Each part is scaled between the lowest and highest country in this refresh, so totals can slightly exceed 100.</p>
      <p><strong>What it means.</strong> The score ranks countries against each other this week. It is not a severity measure, and it can move when other countries change.</p>
      <p><strong>Bands:</strong> 1 Low (0 to 20), 2 Guarded (21 to 40), 3 Elevated (41 to 60), 4 High (61 to 80), 5 Critical (81 and above). The "IPC Phase 3+" button switches the map to the IPC/CH Phase 3+ share alone.</p>
      <p><strong>Countries with the strongest signals now:</strong></p>
      <ol class="strat-signal-list">${top.map((c) => `<li><button type="button" class="strat-link" data-strat-country="${esc(c.iso3)}">${esc(c.country)}</button>: score ${esc(c.risk_score)} (${esc(bandForRiskLabel(c.risk_score))}); ${esc(driver(c))}.</li>`).join("")}</ol>
      <p class="muted">For the strategic ranking of crises, use the <button type="button" class="strat-link" data-strat-target="gradingPage#gradingTable">Crisis Classification</button> page.</p>`;
  }
  function bandForRiskLabel(score) {
    const v = Number(score || 0);
    if (isFr()) return v >= 81 ? "Bande 5 Critique" : v >= 61 ? "Bande 4 Haut" : v >= 41 ? "Bande 3 Élevé" : v >= 21 ? "Bande 2 À surveiller" : "Bande 1 Faible";
    return v >= 81 ? "Band 5 Critical" : v >= 61 ? "Band 4 High" : v >= 41 ? "Band 3 Elevated" : v >= 21 ? "Band 2 Guarded" : "Band 1 Low";
  }

  // ---------- Climate forecast explanation and summary ----------
  function renderForecastBriefing() {
    const page = el("forecastPage");
    if (!page || !state.dash) return;
    let node = el("forecastBriefing");
    if (!node) {
      node = document.createElement("section");
      node.id = "forecastBriefing";
      node.className = "panel";
      const strip = el("strip-forecastPage");
      if (strip && strip.nextSibling) page.insertBefore(node, strip.nextSibling);
      else page.appendChild(node);
    }
    const enso = state.dash.enso_advisory || null;
    const fc = state.dash.forecasts || [];
    const byHorizon = (h) => fc.filter((f) => String(f.horizon).toLowerCase() === h);
    const levelTagF = (lvl) => {
      const map = { high: ["#8e1b3a", "#fff", L("High", "Élevé")], watch: ["#e8a33b", "#0d1f33", L("Watch", "Veille")], info: ["#b9c4cf", "#0d1f33", "Info"] };
      const [bg, fg, label] = map[String(lvl || "info").toLowerCase()] || map.info;
      return `<span class="strat-level" style="background:${bg};color:${fg}">${label}</span>`;
    };
    const list = (items) => items.length
      ? `<ul class="strat-forecast-list">${items.map((f) => `<li>${levelTagF(f.risk_level)} <a href="${esc(/^https?:\/\//i.test(String(f.url || "")) ? f.url : LINKS.icpac[1])}" target="_blank" rel="noopener">${esc(String(f.title || "").replace(/\s+-\s+IGAD Region$/i, ""))}</a></li>`).join("")}</ul>`
      : `<p class="muted">${L("None in this refresh.", "Aucun dans cette actualisation.")}</p>`;
    const high = byHorizon("weekly").filter((f) => String(f.risk_level).toLowerCase() === "high");
    const isElNino = /el ni/i.test(enso?.alert_status || "");
    const isLaNina = /la ni/i.test(enso?.alert_status || "");
    node.innerHTML = isFr() ? `
      <div class="panel-header"><h2>Synthèse des prévisions et clés de lecture</h2><p>Ce que disent les perspectives actuelles, et comment les niveaux de cette page sont attribués.</p></div>
      <div class="two-col strat-forecast-grid">
        <div>
          <h3 class="bulletin-h3">Synthèse</h3>
          <ul class="bulletin-list">
            <li><strong>ENSO :</strong> ${enso?.alert_status ? `${esc(enso.alert_status)}. ${esc(enso.synopsis || "")} <span class="muted">(NOAA CPC${enso.issued_on ? `, publié le ${esc(enso.issued_on)}` : ""}${enso.next_update ? ` ; prochaine mise à jour ${esc(enso.next_update)}` : ""})</span>` : "Non disponible dans cette actualisation."}</li>
            <li><strong>Grande Corne de l'Afrique, 7 prochains jours (ICPAC) :</strong> ${byHorizon("weekly").length} produits${high.length ? `, dont des perspectives ${high.map((f) => esc(String(f.title || "").split(" - ")[0].toLowerCase())).filter((v, i, a) => a.indexOf(v) === i).join(", ")}` : ""}. Ouvrir chaque produit pour voir les zones concernées.</li>
            <li><strong>Saison à venir (ICPAC) :</strong> ${byHorizon("seasonal").length} produits saisonniers${byHorizon("seasonal")[0]?.date_label ? ` jusqu'à ${esc(byHorizon("seasonal")[0].date_label)}` : ""}${byHorizon("monthly").length ? ` ; ${byHorizon("monthly").length} produits mensuels` : ""}.</li>
            ${isElNino ? `<li><strong>Effets habituels d'El Niño (épisodes passés, pas une prévision) :</strong> petites saisons des pluies plus humides que la normale dans certaines parties de l'Afrique de l'Est, avec un risque accru d'inondations, de choléra, de paludisme et de fièvre de la vallée du Rift, et conditions plus sèches sur une grande partie de l'Afrique australe pendant sa saison des pluies, avec un risque de sécheresse et d'insécurité alimentaire.</li>` : ""}
            ${isLaNina ? `<li><strong>Effets habituels de La Niña (épisodes passés, pas une prévision) :</strong> petites saisons des pluies plus sèches que la normale dans certaines parties de l'Afrique de l'Est, avec un risque de sécheresse et d'insécurité alimentaire, et conditions plus humides dans certaines parties de l'Afrique australe.</li>` : ""}
          </ul>
          <h3 class="bulletin-h3">Produits ICPAC de la semaine</h3>
          ${list(byHorizon("weekly"))}
          <h3 class="bulletin-h3">Produits saisonniers et mensuels</h3>
          ${list(byHorizon("seasonal").concat(byHorizon("monthly")))}
        </div>
        <div>
          <h3 class="bulletin-h3">Attribution des niveaux</h3>
          <ul class="bulletin-list">
            <li>${levelTagF("high")} Le titre du produit mentionne un aléa aux effets sanitaires connus : inondations, fortes pluies, stress thermique ou sécheresse.</li>
            <li>${levelTagF("watch")} Le produit est une perspective ou une carte d'anomalie des précipitations ou des températures pouvant signaler un aléa.</li>
            <li>${levelTagF("info")} Produits de contexte, comme les dates de début de la saison des pluies et la durée des épisodes humides ou secs.</li>
            <li><strong>ENSO</strong> suit le statut de la NOAA : un avertissement (Warning) correspond à Élevé ; une veille (Watch) ou un avis (Advisory) à Veille ; sinon Info.</li>
          </ul>
          <p class="muted">Les niveaux découlent du type de produit indiqué dans le titre, pas du contenu de la carte. Élevé signifie qu'une perspective d'aléa figure parmi les perspectives actuelles ; l'ouvrir pour voir les zones concernées. L'ICPAC ne couvre que les pays de l'IGAD ; pour les autres sous-régions, utiliser les services météorologiques nationaux et les liens de l'OMM sur la page Vigie cyclonique.</p>
        </div>
      </div>` : `
      <div class="panel-header"><h2>Forecast Summary and How to Read It</h2><p>What the current outlooks say, and how the levels on this page are assigned.</p></div>
      <div class="two-col strat-forecast-grid">
        <div>
          <h3 class="bulletin-h3">Summary</h3>
          <ul class="bulletin-list">
            <li><strong>ENSO:</strong> ${enso?.alert_status ? `${esc(enso.alert_status)}. ${esc(enso.synopsis || "")} <span class="muted">(NOAA CPC${enso.issued_on ? `, issued ${esc(enso.issued_on)}` : ""}${enso.next_update ? `; next update ${esc(enso.next_update)}` : ""})</span>` : "Not available in this refresh."}</li>
            <li><strong>Greater Horn of Africa, next 7 days (ICPAC):</strong> ${byHorizon("weekly").length} products${high.length ? `, including ${high.map((f) => esc(String(f.title || "").split(" - ")[0].toLowerCase())).filter((v, i, a) => a.indexOf(v) === i).join(", ")} outlooks` : ""}. Open each product for the affected areas.</li>
            <li><strong>Season ahead (ICPAC):</strong> ${byHorizon("seasonal").length} seasonal products${byHorizon("seasonal")[0]?.date_label ? ` to ${esc(byHorizon("seasonal")[0].date_label)}` : ""}${byHorizon("monthly").length ? `; ${byHorizon("monthly").length} monthly products` : ""}.</li>
            ${isElNino ? `<li><strong>Typical El Niño effects (past events, not a forecast):</strong> wetter than usual short rains in parts of East Africa, with higher flood, cholera, malaria and Rift Valley fever risk, and drier conditions over much of southern Africa during its rainy season, with drought and food-insecurity risk.</li>` : ""}
            ${isLaNina ? `<li><strong>Typical La Niña effects (past events, not a forecast):</strong> drier than usual short rains in parts of East Africa, with drought and food-insecurity risk, and wetter conditions over parts of southern Africa.</li>` : ""}
          </ul>
          <h3 class="bulletin-h3">ICPAC products this week</h3>
          ${list(byHorizon("weekly"))}
          <h3 class="bulletin-h3">Seasonal and monthly products</h3>
          ${list(byHorizon("seasonal").concat(byHorizon("monthly")))}
        </div>
        <div>
          <h3 class="bulletin-h3">How the levels are assigned</h3>
          <ul class="bulletin-list">
            <li>${levelTagF("high")} The product title names a hazard with known health effects: floods, heavy rainfall, heat stress or drought.</li>
            <li>${levelTagF("watch")} The product is a rainfall or temperature outlook or anomaly map that may point to a hazard.</li>
            <li>${levelTagF("info")} Background products such as rainy-season onset dates and wet or dry spell lengths.</li>
            <li><strong>ENSO</strong> follows the NOAA status: a Warning is High; a Watch or Advisory is Watch; otherwise Info.</li>
          </ul>
          <p class="muted">Levels come from the product type in the title, not from the map content. High means a hazard outlook exists in the current outlooks; open it to see the affected areas. ICPAC covers the IGAD countries only; for other subregions, use national meteorological services and the WMO links on the Cyclone Watch page.</p>
        </div>
      </div>`;
  }

  // ---------- orchestration ----------
  function renderAll() {
    if (!state.payload) return;
    renderKpis();
    renderMessages();
    renderMap();
    renderFundingChart();
    renderTable();
    renderCoverageChart();
    renderMhpssChart();
    renderSources();
    renderGradingPage();
    renderCountryCard();
    renderDisplacementPanel();
    renderSsaPanel();
    renderDataHealth();
    renderPageStrips();
    renderBulletinWeekly();
    renderStatusTable();
    renderSignalsExplain();
    renderForecastBriefing();
    decorateCardDestinations();
  }

  function resizeVisible(pageId) {
    if (typeof Plotly === "undefined") return;
    const ids = {
      overviewPage: ["stratMap", "stratFundingChart", "stratCoverageChart", "stratMhpssChart"],
      attacksHealthPage: ["stratSsaChart"]
    }[pageId] || [];
    ids.forEach((id) => {
      const node = el(id);
      if (node && node.data) {
        try { Plotly.Plots.resize(node); } catch (e) { /* ignore */ }
      }
    });
  }

  async function load() {
    if (state.loading) return state.loading;
    state.loading = fetch("/api/strategic", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((payload) => {
        state.payload = payload;
        renderAll();
        if (window.__dashboardRerenderBulletin) window.__dashboardRerenderBulletin();
      })
      .catch((err) => {
        const grid = el("stratKpiGrid");
        if (grid) grid.innerHTML = `<p class="muted">${L("Strategic indicators could not be loaded", "Les indicateurs stratégiques n'ont pas pu être chargés")} (${esc(err.message)}).</p>`;
      })
      .finally(() => {
        state.loading = null;
      });
    return state.loading;
  }


  // ---------- Page layout: shorter pages ----------
  // Detail panels start closed so each page leads with its key information.
  // Matched on the English panel title; a click on the title bar opens them.
  const COLLAPSED_PANELS = {
    overviewPage: ["Sources and Links"],
    gradingPage: ["Classification Rules"],
    fcvDataPage: ["Completeness by Indicator", "PENTA − Measles Gap", "Coverage Map", "SAM Case Severity", "Screening Volume vs. Severity", "GBV & MHPSS Cases Managed"],
    countryPage: ["Country Comparison Table", "FCV Country Profile Data"],
    conflictsDisplacementPage: ["Conflict and Displacement Pressure", "Conflict and Displacement Prioritization", "Evidence Feed"],
    attacksHealthPage: ["Public Reporting Signals (context only)", "Country Prioritization", "WHO SSA Source and Evidence Feed"],
    foodSecurityPage: ["Recent Food Security Reporting"],
    nutritionPage: ["Recent Nutrition Reporting"],
    hazardPage: ["Source Intelligence Summary", "GDACS Hazard Events", "ReliefWeb RSS Situation Reports", "WHO Disease Outbreak News (DON)", "Disease Outbreak Evidence Feed", "Historical Disaster Impact (EM-DAT)", "Largest Disasters by People Affected", "Most Affected Countries (EM-DAT)"],
    cyclonePage: ["Cyclone Source Diagnostics", "Cyclone Projections and Advisories"],
    forecastPage: ["Forecast Outlook", "Forecast Source Summary", "ICPAC Source Summary"],
    operationalReportPage: ["Source Intelligence Detail", "Conflict and Displacement Insert", "Priority Country Annexes", "Forecast and Projection Summary", "Conflicts and Displacements Summary"],
    signalsPage: ["Food Security and Event Pressure Snapshot"],
    dataHealthPage: ["Data Validation Ledger"]
  };
  // Panels that repeat older calculations and contradict the verified figures.
  const HIDDEN_PANELS = {
    countryPage: ["Country Profile Trend", "Country Operational Brief"],
    conflictsDisplacementPage: ["Population Movement: IDP Estimates (IOM DTM)"]
  };

  function panelTitle(panel) {
    const h = panel.querySelector(".panel-header h2, h2");
    return h ? (h.dataset.i18nBaseText || h.textContent || "").trim() : "";
  }
  function panelsOf(pageId) {
    const page = el(pageId);
    return page ? Array.from(page.querySelectorAll(":scope > .panel, :scope > section > .panel, :scope > div > .panel")) : [];
  }
  function setCollapsed(panel, collapsed) {
    panel.classList.toggle("is-collapsed", collapsed);
    const btn = panel.querySelector(".panel-toggle");
    if (btn) {
      const fr = document.documentElement.lang === "fr";
      btn.textContent = collapsed ? (fr ? "Afficher le détail ▾" : "Show detail ▾") : (fr ? "Masquer le détail ▴" : "Hide detail ▴");
      btn.setAttribute("aria-expanded", String(!collapsed));
    }
    if (!collapsed && typeof Plotly !== "undefined") {
      panel.querySelectorAll(".js-plotly-plot").forEach((node) => { try { Plotly.Plots.resize(node); } catch (e) { /* hidden chart */ } });
    }
  }
  function applyPageLayout() {
    Object.entries(HIDDEN_PANELS).forEach(([pageId, titles]) => {
      panelsOf(pageId).forEach((panel) => {
        if (titles.includes(panelTitle(panel))) panel.classList.add("is-retired");
      });
    });
    Object.entries(COLLAPSED_PANELS).forEach(([pageId, titles]) => {
      panelsOf(pageId).forEach((panel) => {
        if (!titles.includes(panelTitle(panel)) || panel.dataset.collapsible) return;
        panel.dataset.collapsible = "1";
        const header = panel.querySelector(".panel-header");
        if (!header) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "panel-toggle";
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          setCollapsed(panel, !panel.classList.contains("is-collapsed"));
        });
        header.appendChild(btn);
        setCollapsed(panel, true);
      });
    });
  }

  // A "Back to top" button on every page.
  function ensureBackToTop() {
    if (el("backToTopBtn")) return;
    const btn = document.createElement("button");
    btn.id = "backToTopBtn";
    btn.type = "button";
    btn.className = "back-to-top";
    btn.textContent = L("▲ Top", "▲ Haut");
    btn.title = L("Back to the top of the page", "Retour en haut de la page");
    btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    document.body.appendChild(btn);
    const update = () => btn.classList.toggle("is-visible", window.scrollY > 500);
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  function goToPage(target) {
    if (/^https?:/.test(target)) {
      window.open(target, "_blank", "noopener");
      return;
    }
    const [pageId, anchor] = String(target).split("#");
    const btn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
    if (btn && !btn.classList.contains("active")) btn.click();
    const focus = anchor ? el(anchor) : el(pageId);
    if (focus) {
      const owner = focus.closest(".panel");
      if (owner && owner.classList.contains("is-collapsed")) setCollapsed(owner, false);
      setTimeout(() => {
        const panel = focus.closest(".panel") || focus;
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
        panel.classList.add("panel-jump-highlight");
        setTimeout(() => panel.classList.remove("panel-jump-highlight"), 2200);
      }, 250);
    }
  }

  function bind() {
    const scope = el("stratScopeSelect");
    if (scope) {
      scope.addEventListener("change", () => {
        state.scope = scope.value;
        renderKpis();
        renderMessages();
        renderMap();
        renderFundingChart();
        renderTable();
        renderCoverageChart();
        renderMhpssChart();
        renderStatusTable();
        decorateCardDestinations();
      });
    }
    const layer = el("stratMapLayer");
    if (layer) {
      layer.addEventListener("change", () => {
        state.mapLayer = layer.value;
        renderMap();
      });
    }
    document.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return;
      const card = ev.target.closest("[data-strat-target]");
      if (card && card.dataset.stratTarget) {
        goToPage(card.dataset.stratTarget);
        return;
      }
      const country = ev.target.closest("[data-strat-country]");
      if (country) {
        const select = el("countrySelect");
        if (select) {
          select.value = country.dataset.stratCountry;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        goToPage("countryPage");
      }
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      const card = ev.target.closest && ev.target.closest("[data-strat-target]");
      if (card && card.tagName !== "BUTTON" && card.dataset.stratTarget) goToPage(card.dataset.stratTarget);
    });
    const select = el("countrySelect");
    if (select) select.addEventListener("change", renderCountryCard);
    // Re-render in the new language after app.js has switched it.
    const lang = el("languageSelect");
    if (lang) {
      lang.addEventListener("change", () => setTimeout(() => {
        renderAll();
        document.querySelectorAll(".panel[data-collapsible]").forEach((panel) => setCollapsed(panel, panel.classList.contains("is-collapsed")));
        const top = el("backToTopBtn");
        if (top) {
          top.textContent = L("▲ Top", "▲ Haut");
          top.title = L("Back to the top of the page", "Retour en haut de la page");
        }
      }, 80));
    }
    // On a phone the menu sits above the content: jump to the page after choosing it.
    document.querySelectorAll(".nav-btn[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.innerWidth > 900) return;
        setTimeout(() => el(btn.dataset.page)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      });
    });
  }

  window.StrategicDashboard = {
    onDashboardData(dash) {
      state.dash = dash;
      if (state.payload) {
        renderMhpssChart();
        renderKpis();
        renderDataHealth();
        renderCountryCard();
        renderPageStrips();
        renderBulletinWeekly();
        renderStatusTable();
        renderSignalsExplain();
        renderForecastBriefing();
        decorateCardDestinations();
      } else {
        load();
      }
    },
    onPage(pageId, opts = {}) {
      if (!state.payload) {
        load();
        return;
      }
      if (opts.resizeOnly) {
        resizeVisible(pageId);
        return;
      }
      if (pageId === "countryPage") renderCountryCard();
      setTimeout(() => resizeVisible(pageId), 60);
    },
    reload: load,
    decorate: decorateCardDestinations,
    renderCover: renderCoverMessages,
    // Major then Severe FCV countries, highest score first (used by the bulletin annexes).
    priorityIso3() {
      if (!state.payload) return [];
      return rowsInScope("fcv13")
        .filter((r) => ["Major", "Severe"].includes(r.classification.level))
        .sort((a, b) => (LEVEL_ORDER[b.classification.level] - LEVEL_ORDER[a.classification.level]) || (b.classification.score - a.classification.score) || ((b.health_in_need?.value || 0) - (a.health_in_need?.value || 0)))
        .map((r) => r.iso3);
    },
    goToPage
  };

  const start = () => { applyPageLayout(); ensureBackToTop(); bind(); load(); };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
