let dashboardState = null;
let autoRotateTimer = null;
let autoDataRefreshTimer = null;
let isPresentationMode = false;
let mapMode = "risk";
let rotatingCountryIndex = 0;
let countrySortState = { key: "fcv_track", direction: "asc" };
let aiRecommendations = null;
let pendingPrintRestorePage = null;
let printRestoreTimer = null;
let acapsModeToastTimer = null;
let printVisibilityGuardNodes = [];
let exportStatusTimer = null;
let hasAutoStarted = false;
let autoRotateEnabled = false;
let currentLanguage = localStorage.getItem("who_afro_dashboard_lang") || "en";
let showOriginalSourceExcerpts = false;

const DASHBOARD_CACHE_KEY = "who_afro_dashboard_cache_v1";
const AUTO_DATA_REFRESH_MS = 10 * 60 * 1000;
const DATA_STALE_WARN_MS = 20 * 60 * 1000;
const LANGUAGE_CACHE_KEY = "who_afro_dashboard_lang";
const SOURCE_EXCERPTS_CACHE_KEY = "who_afro_show_original_excerpts";
const SOURCE_EXCERPT_MAX_CHARS = 1200;

const PRINT_MODE_CLASS = "printing-bulletin";
const PRINT_REPORT_PAGE_ID = "operationalReportPage";

const PAGE_ROTATION_MULTIPLIER = {
  overviewPage: 1.35,
  foodSecurityPage: 1.3,
  nutritionPage: 1,
  conflictsDisplacementPage: 1.1,
  hazardPage: 1,
  cyclonePage: 1,
  forecastPage: 1.1,
  countryPage: 0.95,
  operationalReportPage: 1.1
};

const PAGE_ORDER = ["overviewPage", "foodSecurityPage", "nutritionPage", "conflictsDisplacementPage", "hazardPage", "cyclonePage", "forecastPage", "countryPage", "operationalReportPage"];

const PAGE_CAVEATS = {
  en: {
    overviewPage: "Overview caveat: scores prioritize humanitarian events and food security burden signals. Validate with country operations channels before action.",
    countryPage: "Country explorer caveat: this page is a supporting profile. Decision priority remains food security and humanitarian event pressure.",
    foodSecurityPage: "Food security caveat: this is the primary decision lens. IPC and FEWS values are source snapshots and require date-validity checks.",
    nutritionPage: "Nutrition context caveat: this page is a supporting layer and should not override food security or event-driven triggers.",
    forecastPage: "Forecast caveat: this page is source-only (IPC, ICPAC, and source-derived drought/cyclone signals). No internally generated trend projections are displayed.",
    cyclonePage: "Cyclone caveat: event signals indicate pressure and readiness needs, but operational actions require country-level validation.",
    hazardPage: "Hazard caveat: GDACS and linked sources provide event context; critical decisions require triangulation with validated country and partner updates.",
    conflictsDisplacementPage: "Conflicts and displacements caveat: this page reflects source-reported conflict and displacement signals from online reporting, not verified event totals or population counts.",
    operationalReportPage: "Operational report caveat: this bulletin is refresh-driven and reflects currently loaded source signals; country decisions still require final validation."
  },
  fr: {
    overviewPage: "Note vue d'ensemble: les scores priorisent les evenements humanitaires et la charge de securite alimentaire. Valider avec les canaux operationnels pays avant action.",
    countryPage: "Note profil pays: cette page est un profil d'appui. La priorite decisionnelle reste la securite alimentaire et la pression des evenements.",
    foodSecurityPage: "Note securite alimentaire: c'est la grille principale de decision. Les valeurs IPC et FEWS sont des instantanes source et exigent une verification de date.",
    nutritionPage: "Note nutrition: cette page est une couche d'appui et ne doit pas remplacer les declencheurs de securite alimentaire ou d'evenements.",
    forecastPage: "Note previsions: cette page est basee uniquement sur les sources (IPC, ICPAC et signaux derives secheresse/cyclone). Aucune projection interne de tendance n'est affichee.",
    cyclonePage: "Note cyclone: les signaux d'evenement indiquent une pression et des besoins de preparation, mais les actions exigent une validation niveau pays.",
    hazardPage: "Note aleas: GDACS et les sources liees donnent le contexte evenementiel. Les decisions critiques exigent une triangulation avec des mises a jour pays et partenaires validees.",
    conflictsDisplacementPage: "Note conflits et deplacements: cette page reflete des signaux de conflits/deplacements rapportes en ligne, et non des totaux verifies d'evenements ou de population.",
    operationalReportPage: "Note bulletin operationnel: ce bulletin depend du cycle de rafraichissement et reflete les signaux actuellement charges; les decisions pays exigent une validation finale."
  }
};

const RISK_BANDS = [
  { min: 0, max: 20, labels: { en: "Band 1 Low", fr: "Bande 1 Faible" }, color: "#7bc8ff" },
  { min: 21, max: 40, labels: { en: "Band 2 Guarded", fr: "Bande 2 A surveiller" }, color: "#37a2df" },
  { min: 41, max: 60, labels: { en: "Band 3 Elevated", fr: "Bande 3 Eleve" }, color: "#f5b255" },
  { min: 61, max: 80, labels: { en: "Band 4 High", fr: "Bande 4 Haut" }, color: "#ef7f37" },
  { min: 81, max: 100, labels: { en: "Band 5 Critical", fr: "Bande 5 Critique" }, color: "#cf3c3c" }
];

const COUNTRY_CENTROIDS = {
  BFA:[12.3,-1.5],CAF:[6.6,20.9],TCD:[15.4,18.7],COD:[-4.0,21.8],ETH:[9.1,40.5],
  MLI:[17.6,-4.0],MOZ:[-18.7,35.5],NER:[17.6,8.1],SSD:[6.9,31.3],CMR:[7.4,12.4],
  ERI:[15.2,39.8],NGA:[9.1,8.7],ZWE:[-20.0,30.0],AGO:[-11.2,17.9],BEN:[9.3,2.3],
  BWA:[-22.3,24.7],BDI:[-3.4,29.9],CPV:[16.0,-24.0],COM:[-11.9,43.9],COG:[-0.2,15.8],
  CIV:[7.5,-5.5],GNQ:[1.7,10.3],SWZ:[-26.5,31.5],GAB:[-0.8,11.6],GMB:[13.4,-15.3],
  GHA:[7.9,-1.0],GIN:[9.9,-12.0],GNB:[12.0,-15.2],KEN:[-0.0,38.0],LSO:[-29.6,28.2],
  LBR:[6.4,-9.4],MDG:[-18.8,47.0],MWI:[-13.3,34.3],MRT:[21.0,-10.9],MUS:[-20.3,57.6],
  NAM:[-22.6,17.1],RWA:[-1.9,29.9],STP:[0.2,6.6],SEN:[14.5,-14.5],SYC:[-4.7,55.5],
  SLE:[8.5,-11.8],SOM:[5.2,46.2],ZAF:[-30.6,22.9],TZA:[-6.4,34.9],TGO:[8.6,1.2],
  UGA:[1.4,32.3],ZMB:[-13.1,27.8],SDN:[12.9,30.2]
};

const COUNTRY_SHORT_LABELS = {
  BFA:"BFA",CAF:"CAR",TCD:"TCD",COD:"DRC",ETH:"ETH",MLI:"MLI",MOZ:"MOZ",NER:"NER",
  SSD:"SSD",CMR:"CMR",ERI:"ERI",NGA:"NGA",ZWE:"ZWE",AGO:"AGO",BEN:"BEN",BWA:"BWA",
  BDI:"BDI",CPV:"CPV",COM:"COM",COG:"COG",CIV:"CIV",GNQ:"GNQ",SWZ:"SWZ",GAB:"GAB",
  GMB:"GMB",GHA:"GHA",GIN:"GIN",GNB:"GNB",KEN:"KEN",LSO:"LSO",LBR:"LBR",MDG:"MDG",
  MWI:"MWI",MRT:"MRT",MUS:"MUS",NAM:"NAM",RWA:"RWA",STP:"STP",SEN:"SEN",SYC:"SYC",
  SLE:"SLE",SOM:"SOM",ZAF:"ZAF",TZA:"TZA",TGO:"TGO",UGA:"UGA",ZMB:"ZMB",SDN:"SDN"
};

const UI_COPY = {
  en: {
    datePrefix: "Date",
    languageLabel: "Language",
    countryFocusLabel: "Country Focus",
    rotateEvery: "Rotate Every",
    startAutoDisplay: "Start Auto Display",
    stopAutoDisplay: "Stop Auto Display",
    enablePresentationMode: "Enable Presentation Mode",
    disablePresentationMode: "Disable Presentation Mode",
    autoDisplayOff: "Auto display is off.",
    autoDisplayPaused: "Auto display paused: {reason}",
    autoDisplayOn: "Auto display is on ({seconds} sec base, page-aware timing).",
    updateDashboard: "Update Dashboard",
    updating: "Updating...",
    preparingExport: "Preparing export...",
    exportingWord: "Exporting Word...",
    exporting: "Exporting...",
    loadError: "Load Error",
    staleBanner: "Lenient mode active: Nutrition values older than {years} years are shown with a Stale label. Use for context only, not operational planning.",
    staleDataAgeBanner: "Data age warning: Last successful refresh is {minutes} minutes old. Click Update Dashboard if this persists.",
    dataAgeUnknown: "Data age: waiting for first refresh.",
    dataAgeFresh: "Data age: {age} since last refresh.",
    dataAgeAging: "Data age: {age} since last refresh.",
    dataAgeStale: "Data age alert: {age} since last refresh.",
    fallbackSnapshotStatus: "Live sources were slow; loaded latest server snapshot to keep the dashboard responsive.",
    cachedDataStatus: "Showing cached data from {cachedAt}; retry refresh for latest live pull.",
    recCritical: "CRITICAL",
    recHigh: "HIGH",
    recWatch: "WATCH",
    noRecommendations: "No recommendations are available for this refresh.",
    noCycloneRecommendations: "No cyclone recommendations can be generated from the current refresh.",
    noIcpacProducts: "No ICPAC products were available during this pull.",
    noWhoDonAlerts: "No AFRO-mapped WHO DON outbreak alert was found in the current 30-day window.",
    noSourceNarrative: "Source title and metadata are available; no parsed narrative excerpt.",
    sourceExcerptDifferentLanguage: "Source excerpt appears to be in {lang}. Open the source link for full text."
    ,showOriginalExcerptsLabel: "Show original source excerpts"
  },
  fr: {
    datePrefix: "Date",
    languageLabel: "Langue",
    countryFocusLabel: "Focus pays",
    rotateEvery: "Rotation toutes les",
    startAutoDisplay: "Demarrer affichage auto",
    stopAutoDisplay: "Arreter affichage auto",
    enablePresentationMode: "Activer mode presentation",
    disablePresentationMode: "Desactiver mode presentation",
    autoDisplayOff: "Affichage auto inactif.",
    autoDisplayPaused: "Affichage auto en pause: {reason}",
    autoDisplayOn: "Affichage auto actif ({seconds} sec base, tempo selon page).",
    updateDashboard: "Mettre a jour le tableau",
    updating: "Mise a jour...",
    preparingExport: "Preparation export...",
    exportingWord: "Export Word...",
    exporting: "Export...",
    loadError: "Erreur de chargement",
    staleBanner: "Mode souple actif: les valeurs nutrition plus anciennes que {years} ans sont affichees avec l'etiquette Stale. Usage contextuel uniquement, pas pour planification operationnelle.",
    staleDataAgeBanner: "Alerte anciennete: la derniere actualisation reussie date de {minutes} minutes. Cliquer sur Mettre a jour le tableau si cela persiste.",
    dataAgeUnknown: "Anciennete des donnees: en attente de la premiere mise a jour.",
    dataAgeFresh: "Anciennete des donnees: {age} depuis la derniere mise a jour.",
    dataAgeAging: "Anciennete des donnees: {age} depuis la derniere mise a jour.",
    dataAgeStale: "Alerte anciennete des donnees: {age} depuis la derniere mise a jour.",
    fallbackSnapshotStatus: "Les sources en direct etaient lentes; le dernier instantane serveur a ete charge pour garder le tableau reactif.",
    cachedDataStatus: "Affichage des donnees en cache de {cachedAt}; relancer la mise a jour pour le dernier chargement en direct.",
    recCritical: "CRITIQUE",
    recHigh: "ELEVE",
    recWatch: "SURVEILLANCE",
    noRecommendations: "Aucune recommandation n'est disponible pour ce cycle.",
    noCycloneRecommendations: "Aucune recommandation cyclone ne peut etre produite pour ce cycle.",
    noIcpacProducts: "Aucun produit ICPAC n'etait disponible lors de ce chargement.",
    noWhoDonAlerts: "Aucune alerte OMS DON cartographiee AFRO n'a ete detectee sur la fenetre de 30 jours.",
    noSourceNarrative: "Le titre source et les metadonnees sont disponibles; aucun extrait narratif n'a ete analyse.",
    sourceExcerptDifferentLanguage: "L'extrait source semble etre en {lang}. Ouvrir le lien source pour le texte complet."
    ,showOriginalExcerptsLabel: "Afficher les extraits source originaux"
  }
};

const PHRASE_FR = {
  "Primary Priorities": "Priorites principales",
  "Overview": "Vue d'ensemble",
  "Food Security Priority": "Priorite securite alimentaire",
  "Nutrition Context": "Contexte nutritionnel",
  "Event Monitoring": "Suivi des evenements",
  "Conflicts & Displacements": "Conflits et deplacements",
  "Hazard & Flood Monitor": "Suivi aleas et inondations",
  "Cyclone Watch": "Vigie cyclonique",
  "Decision Support": "Appui a la decision",
  "Forecast Studio": "Atelier previsions",
  "Country Profiles": "Profils pays",
  "Operational Report": "Rapport operationnel",
  "Export Bulletin (Print)": "Exporter bulletin (impression)",
  "Export Bulletin (Word)": "Exporter bulletin (Word)",
  "Export Bulletin": "Exporter bulletin",
  "Print / Save as PDF": "Imprimer / Enregistrer en PDF",
  "Export to Word": "Exporter en Word",
  "Export Validation Snapshot": "Exporter instantane validation",
  "Validation snapshot downloads to the default browser downloads folder.": "L'instantane validation est telecharge dans le dossier telechargements du navigateur.",
  "Humanitarian Events Decision Dashboard": "Tableau de decision des evenements humanitaires",
  "Data Validation Ledger": "Registre de validation des donnees",
  "Audit trail for high-priority country metrics in the current refresh.": "Piste d'audit des indicateurs pays prioritaires pour le cycle courant.",
  "FCV Risk Map": "Carte risque FCV",
  "Composite Risk": "Risque composite",
  "Food Security And Event Pressure Snapshot": "Synthese securite alimentaire et pression evenementielle",
  "Top Alerts": "Alertes prioritaires",
  "Country Profile Trend": "Tendance profil pays",
  "Country Operational Brief": "Brief operationnel pays",
  "Country Comparison Table": "Table comparative pays",
  "IPC Food Security Snapshot": "Synthese IPC securite alimentaire",
  "Recommendations: Food Security": "Recommandations: securite alimentaire",
  "Nutrition Context (Supporting Layer)": "Contexte nutritionnel (couche d'appui)",
  "Current Indicator Table": "Tableau des indicateurs actuels",
  "Recommendations: Nutrition": "Recommandations: nutrition",
  "Forecast Outlook": "Perspective des previsions",
  "Forecast Insights": "Points saillants previsions",
  "Forecast Source Summary": "Synthese des sources de prevision",
  "ICPAC Forecast Bulletins": "Bulletins de prevision ICPAC",
  "ICPAC Source Summary": "Synthese source ICPAC",
  "Recommendations: Forecasts": "Recommandations: previsions",
  "Source Intelligence Summary": "Synthese intelligence sources",
  "Flood Watch": "Vigie inondations",
  "Recent Flood Events": "Evenements inondation recents",
  "GDACS Hazard Events": "Evenements aleas GDACS",
  "ReliefWeb RSS Situation Reports": "Rapports de situation RSS ReliefWeb",
  "WHO Disease Outbreak News (DON)": "Nouvelles OMS flambes (DON)",
  "Recommendations: Hazards": "Recommandations: aleas",
  "Conflict And Displacement Pressure": "Pression conflits et deplacements",
  "Conflict And Displacement Prioritization": "Priorisation conflits et deplacements",
  "Recommendations: Conflicts & Displacements": "Recommandations: conflits et deplacements",
  "Evidence Feed": "Flux de preuves",
  "Cyclone Leadership Snapshot": "Synthese cyclonique",
  "Cyclone-Affected Country Prioritization": "Priorisation pays affectes par cyclone",
  "Recommendations: Cyclone": "Recommandations: cyclone",
  "Cyclone Projections And Advisories": "Projections et avis cycloniques",
  "Cyclone Source Diagnostics": "Diagnostic sources cyclone",
  "Documented Active Cyclones": "Cyclones actifs documentes",
  "Operational Situation Bulletin": "Bulletin de situation operationnelle",
  "All-Events Summary": "Synthese tous evenements",
  "Forecast and Projection Summary": "Synthese previsions et projections",
  "Conflicts and Displacements Summary": "Synthese conflits et deplacements",
  "Priority Countries": "Pays prioritaires",
  "Recommendations (All Issues)": "Recommandations (toutes thematiques)",
  "Source Intelligence Detail": "Detail intelligence sources",
  "Decision Protocol": "Protocole decisionnel",
  "Conflict and Displacement Insert": "Encart conflits et deplacements",
  "Priority Country Annexes": "Annexes pays prioritaires"
};

const DYNAMIC_PHRASE_FR = {
  "Rule-based actions.": "Actions basees sur des regles.",
  "Current source summary.": "Synthese source actuelle.",
  "Current values only. Stale values are excluded.": "Valeurs actuelles uniquement. Les valeurs obsoletes sont exclues.",
  "Current loaded values.": "Valeurs actuellement chargees.",
  "Country indicators and trend.": "Indicateurs pays et tendance.",
  "Country comparison.": "Comparaison pays.",
  "Recent source items.": "Elements source recents.",
  "Source status.": "Statut des sources.",
  "Current bulletin summary.": "Synthese du bulletin courant.",
  "Forecast interpretation.": "Interpretation des previsions.",
  "Current events and source counts.": "Evenements actuels et volumes par source.",
  "Top countries by risk.": "Pays prioritaires selon le risque.",
  "Source items in this cycle.": "Elements source dans ce cycle.",
  "Country annex pages.": "Pages annexes pays.",
  "Cross-issue report.": "Rapport transversal.",
  "Date / Horizon": "Date / Horizon",
  "Method": "Methode",
  "Source": "Source",
  "Country": "Pays",
  "Group": "Groupe",
  "Risk": "Risque",
  "Hazards": "Aleas",
  "Cyclones": "Cyclones",
  "Analysis Date": "Date d'analyse",
  "Projection Date": "Date de projection",
  "Crisis Level": "Niveau de crise",
  "Current Value / Signal": "Valeur / signal actuel",
  "Forecast / Projection Signal": "Signal prevision / projection",
  "Year": "Annee",
  "Issue Number": "Numero d'edition",
  "Issue Date": "Date d'edition",
  "Coverage": "Couverture",
  "Data Quality Status": "Statut qualite des donnees",
  "Filter Integrity": "Integrite des filtres",
  "Key Messages": "Messages cles",
  "Priority watchlist": "Liste de priorite",
  "Top alerts by composite risk": "Principales alertes par risque composite",
  "Purpose": "Objet",
  "Operational Focus": "Priorite operationnelle",
  "Forecast Outlook": "Perspective previsionnelle",
  "Source Signal Status": "Statut des signaux source",
  "Conflict And Displacement": "Conflits et deplacements",
  "Flood Exposure": "Exposition aux inondations",
  "Current vs projection lens": "Lecture situation actuelle vs projection",
  "Current event situation": "Situation evenementielle actuelle",
  "Projection outlook": "Perspective de projection",
  "Verified cyclone activity now": "Activite cyclonique verifiee actuelle",
  "Hydrological flood-source posture": "Posture des sources hydrologiques inondation",
  "Change since previous refresh": "Evolution depuis le cycle precedent",
  "Recent flood events": "Evenements inondation recents",
  "Protocol note": "Note protocole",
  "Recommended Action": "Action recommandee",
  "Current Status": "Statut actuel",
  "Threshold": "Seuil",
  "Trigger": "Declencheur",
  "State": "Etat",
  "Use note": "Note d'usage",
  "Prepared from public sources": "Prepare a partir de sources publiques",
  "No linked conflict or displacement source item is visible in the current refresh.": "Aucun element source lie aux conflits ou deplacements n'est visible dans ce cycle.",
  "Operational Reading": "Lecture operationnelle",
  "Linked Source Evidence": "Elements sources lies",
  "Operational Considerations": "Considerations operationnelles",
  "Profile Snapshot": "Instantane du profil",
  "Forecast References": "References previsionnelles",
  "Country-Linked Hazard Items": "Elements aleas lies au pays",
  "Country-Linked Reports": "Rapports lies au pays",
  "Immediate Decision Focus": "Focus decisionnel immediat",
  "Composite Risk": "Risque composite",
  "Drought Signals": "Signaux secheresse",
  "Reports 30d": "Rapports 30j",
  "Conflict": "Conflit",
  "Displacement": "Deplacement",
  "Signal Level": "Niveau de signal",
  "Conflict And Displacement Watch": "Vigie conflits et deplacements"
};

const textNodeOriginalValues = new WeakMap();
const titleAttrOriginalValues = new WeakMap();
let isLocalizingTree = false;
let localizationObserver = null;
let localizationObserverTimer = null;

const INDICATOR_META = {
  wasting_u5_pct: { label: "Child Wasting (%)", color: "#d1562f" },
  stunting_u5_pct: { label: "Child Stunting (%)", color: "#0f79c8" },
  pregnant_anemia_pct: { label: "Pregnant Women Anemia (%)", color: "#3f8a4f" }
};

const NUTRITION_OPERATIONAL_MAX_AGE_YEARS = 1;

const els = {
  sideNav: document.getElementById("sideNav"),
  navBtns: Array.from(document.querySelectorAll(".nav-btn")),
  pages: Array.from(document.querySelectorAll(".page")),
  presentationModeBtn: document.getElementById("presentationModeBtn"),
  autoRotateBtn: document.getElementById("autoRotateBtn"),
  rotateIntervalSelect: document.getElementById("rotateIntervalSelect"),
  autoStatus: document.getElementById("autoStatus"),
  showOriginalExcerptsToggle: document.getElementById("showOriginalExcerptsToggle"),
  showOriginalExcerptsLabel: document.getElementById("showOriginalExcerptsLabel"),
  languageSelect: document.getElementById("languageSelect"),
  languageLabel: document.getElementById("languageLabel"),
  countryFocusLabel: document.getElementById("countryFocusLabel"),
  rotateEveryLabel: document.getElementById("rotateEveryLabel"),
  exportDropdown: document.getElementById("exportDropdown"),
  exportDropdownBtn: document.getElementById("exportDropdownBtn"),
  exportDropdownMenu: document.getElementById("exportDropdownMenu"),
  confidenceLegend: document.getElementById("confidenceLegend"),
  exportStatus: document.getElementById("exportStatus"),
  refreshBtn: document.getElementById("refreshBtn"),
  dataAgeStatus: document.getElementById("dataAgeStatus"),
  briefingStrip: document.getElementById("briefingStrip"),
  countrySelect: document.getElementById("countrySelect"),
  currentDate: document.getElementById("currentDate"),
  metricGrid: document.getElementById("metricGrid"),
  dataValidationSummary: document.getElementById("dataValidationSummary"),
  bandLegend: document.getElementById("bandLegend"),
  overviewInsightBox: document.getElementById("overviewInsightBox"),
  topAlerts: document.getElementById("topAlerts"),
  summaryBox: document.getElementById("summaryBox"),
  serviceDeliverySummary: document.getElementById("serviceDeliverySummary"),
  serviceDeliveryTableBody: document.querySelector("#serviceDeliveryTable tbody"),
  fcvCountryProfileSummary: document.getElementById("fcvCountryProfileSummary"),
  fcvCountryProfileTableBody: document.querySelector("#fcvCountryProfileTable tbody"),
  foodSecurityTableBody: document.querySelector("#foodSecurityTable tbody"),
  foodSecurityRecommendations: document.getElementById("foodSecurityRecommendations"),
  foodSecurityFeed: document.getElementById("foodSecurityFeed"),
  nutritionSummary: document.getElementById("nutritionSummary"),
  nutritionCurrentStamp: document.getElementById("nutritionCurrentStamp"),
  nutritionTableBody: document.querySelector("#nutritionTable tbody"),
  nutritionRecommendations: document.getElementById("nutritionRecommendations"),
  nutritionFeed: document.getElementById("nutritionFeed"),
  countryTableHead: document.querySelector("#countryTable thead"),
  countryTableBody: document.querySelector("#countryTable tbody"),
  forecastTableBody: document.querySelector("#forecastTable tbody"),
  forecastRecommendations: document.getElementById("forecastRecommendations"),
  forecastInsights: document.getElementById("forecastInsights"),
  icpacFeed: document.getElementById("icpacFeed"),
  icpacSummary: document.getElementById("icpacSummary"),
  cycloneSummary: document.getElementById("cycloneSummary"),
  cycloneSourceAlert: document.getElementById("cycloneSourceAlert"),
  cycloneProjectionFeed: document.getElementById("cycloneProjectionFeed"),
  cycloneSourceTableBody: document.querySelector("#cycloneSourceTable tbody"),
  activeCyclonesList: document.getElementById("activeCyclonesList"),
  cycloneCountryTableBody: document.querySelector("#cycloneCountryTable tbody"),
  cycloneRecommendations: document.getElementById("cycloneRecommendations"),
  gdacsSummary: document.getElementById("gdacsSummary"),
  reliefwebSummary: document.getElementById("reliefwebSummary"),
  whoDonSummary: document.getElementById("whoDonSummary"),
  hazardFeed: document.getElementById("hazardFeed"),
  floodWatchSummary: document.getElementById("floodWatchSummary"),
  floodFeed: document.getElementById("floodFeed"),
  reportFeed: document.getElementById("reportFeed"),
  whoDonFeed: document.getElementById("whoDonFeed"),
  diseaseOutbreakFeed: document.getElementById("diseaseOutbreakFeed"),
  hazardRecommendations: document.getElementById("hazardRecommendations"),
  conflictsDisplacementSummary: document.getElementById("conflictsDisplacementSummary"),
  conflictsDisplacementSourceStatus: document.getElementById("conflictsDisplacementSourceStatus"),
  conflictsDisplacementTableBody: document.querySelector("#conflictsDisplacementTable tbody"),
  conflictsDisplacementRecommendations: document.getElementById("conflictsDisplacementRecommendations"),
  conflictsDisplacementFeed: document.getElementById("conflictsDisplacementFeed"),
  dtmDisplacementSummary: document.getElementById("dtmDisplacementSummary"),
  dtmDisplacementTableBody: document.querySelector("#dtmDisplacementTable tbody"),
  briefingHighlights: document.getElementById("briefingHighlights"),
  caveatLine: document.getElementById("caveatLine"),
  metaLine: document.getElementById("metaLine"),
  mapModeRisk: document.getElementById("mapModeRisk"),
  mapModeIpc: document.getElementById("mapModeIpc"),
  operationalReportHeader: document.getElementById("operationalReportHeader"),
  operationalBulletinCover: document.getElementById("operationalBulletinCover"),
  operationalEventSummary: document.getElementById("operationalEventSummary"),
  operationalForecastSummary: document.getElementById("operationalForecastSummary"),
  operationalConflictDisplacementSummary: document.getElementById("operationalConflictDisplacementSummary"),
  operationalPriorityTableBody: document.querySelector("#operationalPriorityTable tbody"),
  operationalRecommendations: document.getElementById("operationalRecommendations"),
  operationalSourceDetail: document.getElementById("operationalSourceDetail"),
  operationalBulletinGovernance: document.getElementById("operationalBulletinGovernance"),
  operationalBulletinApproval: document.getElementById("operationalBulletinApproval"),
  operationalDecisionProtocol: document.getElementById("operationalDecisionProtocol"),
  operationalBulletinFooter: document.getElementById("operationalBulletinFooter"),
  operationalConflictDisplacementInsert: document.getElementById("operationalConflictDisplacementInsert"),
  operationalCountryAnnexes: document.getElementById("operationalCountryAnnexes"),
  sourceStrip: document.getElementById("sourceStrip"),
  staleBanner: document.getElementById("staleBanner"),
  acapsModeToast: document.getElementById("acapsModeToast")
};

let freshnessMode = "strict";

function t(key, vars = {}) {
  const value = (UI_COPY[currentLanguage] && UI_COPY[currentLanguage][key]) || (UI_COPY.en && UI_COPY.en[key]) || "";
  return value.replace(/\{(\w+)\}/g, (_, token) => (vars[token] != null ? String(vars[token]) : ""));
}

function translatePhrase(baseText) {
  if (!baseText) {
    return baseText;
  }
  if (currentLanguage === "en") {
    return baseText;
  }
  return PHRASE_FR[baseText] || baseText;
}

function translateAnyPhrase(baseText) {
  if (!baseText) {
    return baseText;
  }
  if (currentLanguage === "en") {
    return baseText;
  }
  return DYNAMIC_PHRASE_FR[baseText] || PHRASE_FR[baseText] || baseText;
}

function preserveSpacing(source, translatedCore) {
  const leading = source.match(/^\s*/)?.[0] || "";
  const trailing = source.match(/\s*$/)?.[0] || "";
  return `${leading}${translatedCore}${trailing}`;
}

function localizePageTextTree(root) {
  if (!root) {
    return;
  }

  if (isLocalizingTree) {
    return;
  }

  isLocalizingTree = true;

  try {

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node || !node.parentElement) {
        return NodeFilter.FILTER_REJECT;
      }
      const parentTag = node.parentElement.tagName;
      if (parentTag === "SCRIPT" || parentTag === "STYLE") {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current);
    current = walker.nextNode();
  }

  textNodes.forEach((node) => {
    if (!textNodeOriginalValues.has(node)) {
      textNodeOriginalValues.set(node, node.nodeValue);
    }
    const original = textNodeOriginalValues.get(node);
    if (currentLanguage === "en") {
      node.nodeValue = original;
      return;
    }
    const trimmedOriginal = original.trim();
    let translated = translateAnyPhrase(trimmedOriginal);
    if (translated === trimmedOriginal) {
      // Try in-string substitution for longer narrative text nodes.
      translated = trimmedOriginal;
      const entries = Object.entries(DYNAMIC_PHRASE_FR).sort((a, b) => b[0].length - a[0].length);
      entries.forEach(([en, fr]) => {
        translated = translated.split(en).join(fr);
      });
    }
    if (translated !== trimmedOriginal) {
      node.nodeValue = preserveSpacing(original, translated);
    }
  });

  const titledElements = Array.from(root.querySelectorAll("[title]"));
  titledElements.forEach((el) => {
    if (!titleAttrOriginalValues.has(el)) {
      titleAttrOriginalValues.set(el, el.getAttribute("title") || "");
    }
    const originalTitle = titleAttrOriginalValues.get(el) || "";
    if (currentLanguage === "en") {
      el.setAttribute("title", originalTitle);
      return;
    }
    el.setAttribute("title", translateAnyPhrase(originalTitle));
  });
  } finally {
    isLocalizingTree = false;
  }
}

function startLocalizationObserver() {
  if (localizationObserver || typeof MutationObserver === "undefined" || !document.body) {
    return;
  }

  localizationObserver = new MutationObserver(() => {
    if (localizationObserverTimer) {
      clearTimeout(localizationObserverTimer);
    }
    localizationObserverTimer = setTimeout(() => {
      localizePageTextTree(document.body);
    }, 60);
  });

  localizationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function setTextPreserveChildren(node, text) {
  if (!node) {
    return;
  }
  const existingTextNode = Array.from(node.childNodes).find((child) => child.nodeType === Node.TEXT_NODE);
  if (existingTextNode) {
    existingTextNode.nodeValue = text;
  } else {
    node.insertBefore(document.createTextNode(text), node.firstChild || null);
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function translateHtmlPhrases(html) {
  if (currentLanguage !== "fr" || !html) {
    return html;
  }
  let out = html;
  const entries = Object.entries(DYNAMIC_PHRASE_FR).sort((a, b) => b[0].length - a[0].length);
  entries.forEach(([en, fr]) => {
    const rx = new RegExp(escapeRegex(en), "g");
    out = out.replace(rx, fr);
  });
  return out;
}

function localizeDynamicBlocks() {
  if (currentLanguage !== "fr") {
    return;
  }
  const blocks = [
    els.metricGrid,
    els.dataValidationSummary,
    els.overviewInsightBox,
    els.topAlerts,
    els.summaryBox,
    els.foodSecurityRecommendations,
    els.foodSecurityFeed,
    els.nutritionSummary,
    els.nutritionRecommendations,
    els.nutritionFeed,
    els.forecastInsights,
    els.forecastRecommendations,
    els.icpacSummary,
    els.cycloneSummary,
    els.cycloneProjectionFeed,
    els.cycloneRecommendations,
    els.gdacsSummary,
    els.reliefwebSummary,
    els.whoDonSummary,
    els.diseaseOutbreakFeed,
    els.hazardRecommendations,
    els.conflictsDisplacementSummary,
    els.conflictsDisplacementRecommendations,
    els.conflictsDisplacementFeed,
    els.operationalReportHeader,
    els.operationalEventSummary,
    els.operationalForecastSummary,
    els.operationalConflictDisplacementSummary,
    els.operationalRecommendations,
    els.operationalSourceDetail,
    els.operationalDecisionProtocol,
    els.operationalBulletinFooter,
    els.operationalConflictDisplacementInsert,
    els.operationalCountryAnnexes
  ].filter(Boolean);

  blocks.forEach((node) => {
    if (!node.innerHTML) {
      return;
    }
    node.innerHTML = translateHtmlPhrases(node.innerHTML);
  });
}

function applyStaticLanguage() {
  document.documentElement.lang = currentLanguage;

  const staticNodes = Array.from(document.querySelectorAll(".brand-sub, #sideNav .nav-group-label, #sideNav .nav-btn, .page .panel-header h2, .page .panel-header p, #trendChartAxisCaption, #forecastChartAxisCaption, #nutritionCurrentStamp, .topbar h1, #mapModeRisk, #mapModeIpc"));
  staticNodes.forEach((node) => {
    if (!node.dataset.i18nBaseText) {
      node.dataset.i18nBaseText = node.textContent.trim();
    }
    const translated = translatePhrase(node.dataset.i18nBaseText);
    setTextPreserveChildren(node, translated);
  });

  const titleNodes = Array.from(document.querySelectorAll("th[title]"));
  titleNodes.forEach((node) => {
    if (!node.dataset.i18nBaseTitle) {
      node.dataset.i18nBaseTitle = node.getAttribute("title") || "";
    }
    const translatedTitle = translatePhrase(node.dataset.i18nBaseTitle);
    node.setAttribute("title", translatedTitle);
  });

  if (els.rotateEveryLabel) {
    els.rotateEveryLabel.textContent = t("rotateEvery");
  }
  if (els.countryFocusLabel) {
    els.countryFocusLabel.textContent = t("countryFocusLabel");
  }
  if (els.languageLabel) {
    els.languageLabel.textContent = t("languageLabel");
  }

  const secLabels = els.rotateIntervalSelect ? Array.from(els.rotateIntervalSelect.options) : [];
  secLabels.forEach((opt) => {
    const sec = Math.round(Number(opt.value || 0) / 1000);
    opt.textContent = currentLanguage === "fr" ? `${sec} s` : `${sec} sec`;
  });
}

function applyLanguage() {
  applyStaticLanguage();
  if (els.languageSelect && els.languageSelect.value !== currentLanguage) {
    els.languageSelect.value = currentLanguage;
  }
  if (els.languageSelect && els.languageSelect.options.length >= 2) {
    els.languageSelect.options[0].textContent = currentLanguage === "fr" ? "Anglais" : "English";
    els.languageSelect.options[1].textContent = "Francais";
  }
  if (els.presentationModeBtn) {
    els.presentationModeBtn.textContent = isPresentationMode ? t("disablePresentationMode") : t("enablePresentationMode");
  }
  if (els.autoRotateBtn) {
    els.autoRotateBtn.textContent = autoRotateEnabled ? t("stopAutoDisplay") : t("startAutoDisplay");
  }
  if (autoRotateEnabled) {
    const interval = Number(els.rotateIntervalSelect?.value || 20000);
    setAutoStatus(t("autoDisplayOn", { seconds: Math.round(interval / 1000) }));
  } else {
    setAutoStatus(t("autoDisplayOff"));
  }
  if (els.refreshBtn && !els.refreshBtn.disabled) {
    els.refreshBtn.textContent = t("updateDashboard");
  }
  if (els.showOriginalExcerptsLabel) {
    els.showOriginalExcerptsLabel.textContent = t("showOriginalExcerptsLabel");
  }
  if (els.showOriginalExcerptsToggle) {
    els.showOriginalExcerptsToggle.checked = showOriginalSourceExcerpts;
  }
  setCurrentDate();
  renderDataAgeStatus();
  renderCaveat(activePageId());
  buildBandLegend();
  localizePageTextTree(document.body);
}

function setChartRenderState(chartId, status, detail = {}) {
  if (typeof window === "undefined" || !chartId) {
    return;
  }
  const nowIso = new Date().toISOString();
  if (!window.__dashboardChartRenderState) {
    window.__dashboardChartRenderState = {};
  }
  window.__dashboardChartRenderState[chartId] = {
    chartId,
    status,
    at: nowIso,
    ...detail
  };

  try {
    window.dispatchEvent(new CustomEvent("dashboard:chart-ready", {
      detail: window.__dashboardChartRenderState[chartId]
    }));
  } catch (_) {}
}

function renderPlotWithSentinel(chartId, traces, layout, config, detail = {}) {
  setChartRenderState(chartId, "pending", detail);
  return Plotly.newPlot(chartId, traces, layout, config)
    .then(() => {
      setChartRenderState(chartId, "ready", detail);
    })
    .catch((error) => {
      setChartRenderState(chartId, "error", {
        ...detail,
        error: error?.message || String(error)
      });
    });
}

function chartReadyState(chartId) {
  return window.__dashboardChartRenderState?.[chartId]?.status || "unknown";
}

function areChartsReady(chartIds = []) {
  if (!Array.isArray(chartIds) || !chartIds.length) {
    return false;
  }
  return chartIds.every((id) => chartReadyState(id) === "ready");
}

function waitForChartSentinels(chartIds, options = {}) {
  const ids = Array.isArray(chartIds) ? chartIds.filter(Boolean) : [];
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;

  if (!ids.length) {
    return Promise.resolve({ ok: false, reason: "no-charts" });
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const finish = (ok, reason) => {
      window.removeEventListener("dashboard:chart-ready", onReadyEvent);
      clearTimeout(timeoutHandle);
      resolve({
        ok,
        reason,
        elapsedMs: Date.now() - startedAt,
        state: ids.reduce((acc, id) => {
          acc[id] = window.__dashboardChartRenderState?.[id] || null;
          return acc;
        }, {})
      });
    };

    const check = () => {
      if (areChartsReady(ids)) {
        finish(true, "ready");
      }
    };

    const onReadyEvent = () => {
      check();
    };

    window.addEventListener("dashboard:chart-ready", onReadyEvent);

    const timeoutHandle = setTimeout(() => {
      finish(false, "timeout");
    }, timeoutMs);

    check();
  });
}

// Exposed for deterministic QA and export checks in browser automation.
window.__dashboardWaitForChartsReady = waitForChartSentinels;

function formatNum(value, digits = 1) {
  if (value == null || Number.isNaN(value)) {
    return "n/a";
  }
  return Number(value).toFixed(digits);
}

function formatDate(value) {
  if (!value) {
    return "n/a";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value;
  }
  return d.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) {
    return "n/a";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value;
  }
  return d.toLocaleString(currentLanguage === "fr" ? "fr-FR" : "en-GB");
}

function formatCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return Math.round(numeric).toLocaleString(currentLanguage === "fr" ? "fr-FR" : "en-GB");
}

function formatSignedDelta(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "n/a";
  }
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric}`;
}

function countryTrackRank(track) {
  switch (String(track || "")) {
    case "FCV Prioritized":
      return 1;
    case "FCV Accelerated":
      return 2;
    case "AFRO":
      return 3;
    case "Other Africa":
      return 4;
    default:
      return 99;
  }
}

function scopeCoverageLabel() {
  const scope = dashboardState?.scope || {};
  const afroCount = scope.afro_country_count || 0;
  const otherCount = scope.other_africa_country_count || 0;
  if (afroCount && otherCount) {
    return `${afroCount} WHO AFRO countries + ${otherCount} other African ${otherCount === 1 ? "country" : "countries"}`;
  }
  if (afroCount) {
    return `${afroCount} WHO AFRO countries`;
  }
  return `${scope.country_count || (dashboardState?.countries || []).length} monitored countries`;
}

function getSourceTrustMeta(source) {
  const normalized = String(source || "GDACS").trim();
  if (!normalized) {
    return null;
  }
  if (/unhcr population data/i.test(normalized)) {
    return {
      label: "Structural",
      className: "structural",
      description: "Verified structural baseline source"
    };
  }
  if (/who\s*don|who disease outbreak/i.test(normalized)) {
    return {
      label: "Official",
      className: "official",
      description: "Official WHO outbreak alert source"
    };
  }
  if (/gdacs|reliefweb|ocha|idmc|unhcr|iom|dtm/i.test(normalized)) {
    return {
      label: "Verified",
      className: "verified",
      description: "Verified humanitarian source"
    };
  }
  if (/fews\s*net/i.test(normalized)) {
    return {
      label: "Verified",
      className: "verified",
      description: "FEWS NET — USAID famine early warning system"
    };
  }
  return null;
}

function isApprovedVisibleEventSource(source) {
  return Boolean(getSourceTrustMeta(source));
}

function renderSourceTrustBadge(source) {
  const meta = getSourceTrustMeta(source);
  if (!meta) {
    return '<span class="source-trust-badge unapproved" title="Unapproved source">Unapproved</span>';
  }
  return `<span class="source-trust-badge ${meta.className}" title="${meta.description}">${meta.label}</span>`;
}

function formatIssueCode(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    return "WHO-AFRO-DHM-UNKNOWN";
  }
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `WHO-AFRO-DHM-${year}${month}${day}`;
}

function detectLikelyLanguage(text) {
  const sample = String(text || "").toLowerCase();
  if (!sample.trim()) {
    return "unknown";
  }

  const esScore =
    (sample.match(/\b(el|la|los|las|de|del|para|con|sin|una|uno|que|en|por|sobre|como|desde)\b/g) || []).length +
    (sample.match(/[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00bf\u00a1]/g) || []).length;
  const frScore =
    (sample.match(/\b(le|la|les|des|du|de|pour|avec|sans|une|un|que|dans|sur|comme|depuis)\b/g) || []).length +
    (sample.match(/[\u00e0\u00e2\u00e7\u00e8\u00e9\u00ea\u00eb\u00ee\u00ef\u00f4\u00fb\u00f9\u0153]/g) || []).length;
  const enScore =
    (sample.match(/\b(the|and|for|with|without|from|in|on|to|of|by|as|that|this|is|are)\b/g) || []).length;

  const best = Math.max(esScore, frScore, enScore);
  if (best < 2) {
    return "unknown";
  }
  if (best === esScore) {
    return "es";
  }
  if (best === frScore) {
    return "fr";
  }
  return "en";
}

function renderMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/#{1,6} ([^\n#]+)/g, "<strong>$1</strong>");
}

function summarizeSourceExcerpt(rawText, maxChars = SOURCE_EXCERPT_MAX_CHARS) {
  const summary = String(rawText || "").replace(/\s+/g, " ").trim();
  if (!summary) {
    return t("noSourceNarrative");
  }

  if (showOriginalSourceExcerpts) {
    return renderMarkdown(`${summary.slice(0, maxChars)}${summary.length > maxChars ? "..." : ""}`);
  }

  const lang = detectLikelyLanguage(summary);
  if (currentLanguage === "en" && (lang === "es" || lang === "fr")) {
    return t("sourceExcerptDifferentLanguage", { lang: lang.toUpperCase() });
  }
  if (currentLanguage === "fr" && lang === "es") {
    return t("sourceExcerptDifferentLanguage", { lang: "ES" });
  }

  return renderMarkdown(`${summary.slice(0, maxChars)}${summary.length > maxChars ? "..." : ""}`);
}

function buildFeedAutoSummary(item, hazardLabel = "Event") {
  const countries = (item?.countries || []).length ? item.countries.join(", ") : "AFRO regional";
  const source = item?.source || "Source n/a";
  const dateLabel = item?.pubDate || item?.created || item?.date_label || null;
  const dateText = dateLabel ? formatDateTime(dateLabel) : "date n/a";
  const base = `${hazardLabel} | ${countries} | ${source} | ${dateText}`;
  const excerpt = summarizeSourceExcerpt(item?.summary || item?.content || "", SOURCE_EXCERPT_MAX_CHARS);
  return `${base}. ${excerpt}`;
}

function renderCurrentProjectionConfidence(currentText, projectionText, confidenceText, level = "warn") {
  const statusClass = level === "good" ? "good" : level === "bad" ? "bad" : "warn";
  const statusLabel = level === "good" ? "High" : level === "bad" ? "Low" : "Moderate";
  return `
    <div class="cpc-strip">
      <article class="cpc-card">
        <p class="cpc-label">Current</p>
        <p class="cpc-value">${currentText}</p>
      </article>
      <article class="cpc-card">
        <p class="cpc-label">Projection</p>
        <p class="cpc-value">${projectionText}</p>
      </article>
      <article class="cpc-card cpc-card-${statusClass}">
        <p class="cpc-label">Confidence</p>
        <p class="cpc-value">${statusLabel}</p>
        <p class="cpc-note">${confidenceText}</p>
      </article>
    </div>
  `;
}

async function exportOperationalBulletinWord() {
  if (!dashboardState) {
    showExportStatus("Word export skipped: dashboard data is not loaded yet.", "error", 5000);
    return;
  }

  // Ensure the operational report page is rendered with latest data
  renderOperationalReportPage();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const stamp = (dashboardState.generated_at || new Date().toISOString()).replace(/[:.]/g, "-");
  const issueCode = formatIssueCode(dashboardState.generated_at);
  const fileName = `operational-bulletin-${issueCode}-${stamp}.doc`;

  function sectionHtml(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return "";
    const clone = el.cloneNode(true);
    // Remove plotly charts, they cannot render in Word
    clone.querySelectorAll(".js-plotly-plot, .plotly, svg, canvas").forEach((n) => n.remove());
    // Strip class attributes (they reference web-only CSS)
    clone.querySelectorAll("*").forEach((n) => n.removeAttribute("class"));
    return clone.innerHTML || "";
  }

  function cleanTable(tableEl) {
    if (!tableEl) return "";
    const clone = tableEl.cloneNode(true);
    clone.querySelectorAll("*").forEach((n) => n.removeAttribute("class"));
    clone.setAttribute("border", "1");
    clone.setAttribute("cellpadding", "4");
    clone.setAttribute("cellspacing", "0");
    clone.style.cssText = "border-collapse:collapse;width:100%;font-size:9pt;";
    clone.querySelectorAll("th").forEach((th) => {
      th.style.cssText = "background:#004990;color:#fff;padding:6px 8px;text-align:left;font-size:9pt;";
    });
    clone.querySelectorAll("td").forEach((td) => {
      td.style.cssText = "padding:4px 8px;border:1px solid #ccc;font-size:9pt;";
    });
    return clone.outerHTML;
  }

  try {
    const countries = dashboardState.countries || [];
    const top = countries.slice(0, 10);
    const sourceSummaries = dashboardState.source_summaries || {};
    const forecasts = dashboardState.forecasts || [];
    const cycloneSourceStatus = dashboardState.cyclone_source_status || {};
    const cemsFloodStatus = dashboardState.cems_flood_source_status || {};
    const combinedRecommendations = aiRecommendations?.combined || [];

    // Priority table
    const priorityTableHtml = cleanTable(document.getElementById("operationalPriorityTable"));

    // Decision protocol table: extract from rendered DOM
    const decisionProtoEl = document.getElementById("operationalDecisionProtocol");
    const decisionTable = decisionProtoEl ? decisionProtoEl.querySelector("table") : null;
    const decisionTableHtml = cleanTable(decisionTable);

    // Recommendations list
    const recsHtml = combinedRecommendations.length
      ? "<ol>" + combinedRecommendations.map((rec) =>
          `<li><strong style="color:${rec.priority === "critical" ? "#c0392b" : rec.priority === "high" ? "#e67e22" : "#2980b9"}">[${(rec.priority || "info").toUpperCase()}]</strong> ${rec.text || rec.summary || "No detail available."}</li>`
        ).join("") + "</ol>"
      : "<p>No recommendations are available for this refresh.</p>";

    const wordStyles = `
      body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #222; line-height: 1.5; margin: 2cm; }
      h1 { font-size: 18pt; color: #004990; border-bottom: 2px solid #004990; padding-bottom: 4pt; margin-top: 24pt; }
      h2 { font-size: 14pt; color: #004990; margin-top: 18pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; }
      h3 { font-size: 12pt; color: #333; margin-top: 14pt; }
      table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9pt; }
      th { background: #004990; color: #fff; padding: 6px 8px; text-align: left; }
      td { padding: 4px 8px; border: 1px solid #ccc; }
      li { margin-bottom: 4pt; }
      .meta-box { background: #f0f4f8; border: 1px solid #ccc; padding: 10pt; margin: 8pt 0; }
      .meta-label { font-size: 9pt; color: #666; text-transform: uppercase; }
      .tag-critical { color: #c0392b; font-weight: bold; }
      .tag-high { color: #e67e22; font-weight: bold; }
      .tag-watch { color: #2980b9; font-weight: bold; }
      p { margin: 4pt 0; }
      a { color: #004990; }
      @page { size: A4; margin: 2cm; }
    `;

    const htmlContent = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<style>${wordStyles}</style>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
</head>
<body>

<div style="text-align:center;margin-bottom:20pt;">
  <h1 style="border-bottom:none;text-align:center;">WHO AFRO</h1>
  <h1 style="border-bottom:2px solid #004990;text-align:center;font-size:22pt;">Humanitarian Operational Situation Bulletin</h1>
  <p style="font-size:10pt;color:#555;">Regional Africa decision brief synthesizing public hazard, forecast, nutrition, and food-security signals</p>
  <p style="font-size:10pt;"><strong>Issue:</strong> ${issueCode} | <strong>Date:</strong> ${formatDateTime(dashboardState.generated_at)} | <strong>Coverage:</strong> ${scopeCoverageLabel()}</p>
  <p style="font-size:10pt;"><strong>Source basis:</strong> GDACS ${sourceSummaries.gdacs?.total_events ?? 0} events, ReliefWeb ${sourceSummaries.reliefweb?.total_reports_30d ?? 0} reports, ICPAC ${forecasts.length} bulletins, ${cycloneSourceStatus.checked_count ?? 0} cyclone checks, Copernicus flood ${cemsFloodStatus.overall || "unknown"}</p>
</div>

<h2>1. Key Messages</h2>
${sectionHtml("operationalBulletinCover").includes("<ol") ? sectionHtml("operationalBulletinCover").match(/<ol[\s\S]*?<\/ol>/i)?.[0] || "<p>See dashboard for details.</p>" : "<p>See dashboard for details.</p>"}

<h2>2. Operational Situation Summary</h2>
<h3>2.1 Bulletin Highlights</h3>
${sectionHtml("operationalReportHeader")}

<h3>2.2 All-Events Summary</h3>
${sectionHtml("operationalEventSummary")}

<h3>2.3 Forecast and Projection Summary</h3>
${sectionHtml("operationalForecastSummary")}

<h2>3. Conflicts and Displacements</h2>
${sectionHtml("operationalConflictDisplacementSummary")}

<h2>4. Priority Countries</h2>
${priorityTableHtml}

<h2>5. Recommendations</h2>
${recsHtml}

<h2>6. Source Intelligence Detail</h2>
${sectionHtml("operationalSourceDetail")}

<h2>7. Decision Protocol</h2>
${decisionTableHtml || sectionHtml("operationalDecisionProtocol")}

<h2>8. Conflict and Displacement Country Watch</h2>
${sectionHtml("operationalConflictDisplacementInsert")}

<h2>9. Priority Country Annexes</h2>
${sectionHtml("operationalCountryAnnexes")}

<hr>
<h2>Governance and Approval</h2>
${sectionHtml("operationalBulletinGovernance")}
${sectionHtml("operationalBulletinApproval")}

<hr>
<p style="font-size:9pt;color:#666;text-align:center;">
  <strong>Issue:</strong> ${issueCode} |
  <strong>Issued:</strong> ${formatDateTime(dashboardState.generated_at)} |
  Prepared from public sources: GDACS, ReliefWeb, WHO DON, IPC/HDX, FEWS, ICPAC, World Bank, ACAPS, ACLED, and dedicated cyclone-source monitoring.
  This bulletin supports rapid management review and does not replace official country validation.
</p>

</body>
</html>`;

    const blob = new Blob(["\ufeff" + htmlContent], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showExportStatus(`Word exported: ${fileName}`, "success", 4500);
  } catch (err) {
    showExportStatus(`Word export failed: ${err?.message || "unknown error"}`, "error", 7000);
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleMentionsCountry(title, countryName) {
  if (!title || !countryName) {
    return false;
  }
  const rx = new RegExp(`\\b${escapeRegExp(countryName)}\\b`, "i");
  return rx.test(String(title));
}

function cycloneSignalLocationText(signal, countries, sourceStatus) {
  if (signal?.geo_labels?.length) {
    return signal.geo_labels.join(", ");
  }

  if (signal?.region_scope) {
    return signal.region_scope;
  }

  const title = String(signal?.title || "");
  const countryMatches = (countries || []).filter((c) => {
    const rx = new RegExp(`\\b${escapeRegExp(c.country)}\\b`, "i");
    return rx.test(title);
  }).map((c) => c.country);

  if (countryMatches.length) {
    return countryMatches.join(", ");
  }

  const sourceMeta = (sourceStatus || []).find((s) => s.source === signal?.source);
  if (sourceMeta?.region_scope) {
    return sourceMeta.region_scope;
  }

  return "location not explicitly stated in source title";
}

function summarizeActiveCycloneLocations(activeCyclones) {
  const values = [...new Set((activeCyclones || []).flatMap((cyclone) => [
    ...(cyclone?.geo_labels || []),
    ...(cyclone?.countries || [])
  ].filter(Boolean)))];
  return values.length ? values.join(", ") : "location not explicitly stated in current source data";
}

function ageDays(value) {
  if (!value) {
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function bandForRisk(score) {
  const v = Number(score || 0);
  return RISK_BANDS.find((b) => v >= b.min && v <= b.max) || RISK_BANDS[0];
}

function qualityTag(country) {
  if (country.data_quality === "good") {
    return '<span class="tag good">Good coverage</span>';
  }
  if (country.data_quality === "limited") {
    return '<span class="tag warn">Limited coverage</span>';
  }
  return '<span class="tag bad">Low coverage</span>';
}

function compactTrackLabel(track) {
  return track || "n/a";
}

function getCountryByIso3(iso3) {
  return dashboardState?.countries?.find((c) => c.iso3 === iso3) || null;
}

function toDateTime(value) {
  if (!value) {
    return null;
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function countrySortValue(country, key) {
  switch (key) {
    case "country":
      return country.country || "";
    case "fcv_track":
      return countryTrackRank(country.fcv_track || "");
    case "risk_score":
      return country.risk_score;
    case "ipc_phase3_pct":
      return country.ipc?.phase3plus_pct;
    case "ipc_phase45_number":
      return (country.ipc?.phase4_number || 0) + (country.ipc?.phase5_number || 0);
    case "ipc_date":
      return toDateTime(country.ipc?.analysis_date);
    case "wasting":
      return country.indicators?.wasting_u5_pct?.latest?.value;
    case "stunting":
      return country.indicators?.stunting_u5_pct?.latest?.value;
    case "hazards":
      return country.hazard_count;
    case "cyclones":
      return country.cyclone_count;
    case "reports_30d":
      return country.report_count_30d;
    default:
      return country.risk_score;
  }
}

function sortCountries(rows, sortState) {
  const directionFactor = sortState.direction === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const va = countrySortValue(a, sortState.key);
    const vb = countrySortValue(b, sortState.key);

    if (va == null && vb == null) {
      return a.country.localeCompare(b.country);
    }
    if (va == null) {
      return 1;
    }
    if (vb == null) {
      return -1;
    }

    if (typeof va === "string" || typeof vb === "string") {
      const cmp = String(va).localeCompare(String(vb));
      if (cmp !== 0) {
        return cmp * directionFactor;
      }
      return a.country.localeCompare(b.country);
    }

    const diff = Number(va) - Number(vb);
    if (diff !== 0) {
      return diff * directionFactor;
    }
    return a.country.localeCompare(b.country);
  });

  return sorted;
}

function updateCountrySortHeaders() {
  if (!els.countryTableHead) {
    return;
  }

  Array.from(els.countryTableHead.querySelectorAll("th[data-sort-key]")).forEach((th) => {
    const key = th.getAttribute("data-sort-key");
    const isActive = key === countrySortState.key;
    th.classList.add("sortable");
    th.classList.toggle("sorted-asc", isActive && countrySortState.direction === "asc");
    th.classList.toggle("sorted-desc", isActive && countrySortState.direction === "desc");
  });
}

function activePageId() {
  const btn = els.navBtns.find((b) => b.classList.contains("active"));
  return btn ? btn.dataset.page : PAGE_ORDER[0];
}

function renderCaveat(pageId) {
  if (!els.caveatLine) {
    return;
  }
  const localized = PAGE_CAVEATS[currentLanguage] || PAGE_CAVEATS.en;
  els.caveatLine.textContent = localized[pageId] || "";
}

function updateBriefingStripVisibility(pageId) {
  if (!els.briefingStrip) {
    return;
  }
  els.briefingStrip.classList.toggle("briefing-strip-hidden", pageId === "overviewPage");
  if (pageId === "overviewPage") {
    hideAcapsModeToast();
  }
}

function hideAcapsModeToast() {
  if (!els.acapsModeToast) {
    return;
  }
  els.acapsModeToast.classList.remove("is-visible");
  els.acapsModeToast.setAttribute("aria-hidden", "true");
  if (acapsModeToastTimer) {
    clearTimeout(acapsModeToastTimer);
    acapsModeToastTimer = null;
  }
}

function showAcapsModeToast(message) {
  if (!els.acapsModeToast || !message) {
    return;
  }
  els.acapsModeToast.textContent = message;
  els.acapsModeToast.classList.add("is-visible");
  els.acapsModeToast.setAttribute("aria-hidden", "false");
  if (acapsModeToastTimer) {
    clearTimeout(acapsModeToastTimer);
  }
  acapsModeToastTimer = setTimeout(() => {
    hideAcapsModeToast();
  }, 4200);
}

function hasAnyProjection(country) {
  return Boolean(
    country?.ipc?.projection_phase3plus_pct != null ||
      country?.ipc?.phase3plus_pct != null ||
      (country?.drought_signal_count || 0) > 0 ||
      (country?.icpac_forecast_count || 0) > 0
  );
}

function preferredForecastCountryIso3(currentIso3) {
  const countries = dashboardState?.countries || [];
  const current = countries.find((c) => c.iso3 === currentIso3);
  if (hasAnyProjection(current)) {
    return currentIso3;
  }
  const fallback = countries.find((c) => hasAnyProjection(c));
  return fallback?.iso3 || currentIso3;
}

function setActivePage(pageId) {
  els.pages.forEach((p) => p.classList.toggle("active", p.id === pageId));
  els.navBtns.forEach((b) => b.classList.toggle("active", b.dataset.page === pageId));
  renderCaveat(pageId);
  updateBriefingStripVisibility(pageId);

  if (!dashboardState) {
    return;
  }

  if (pageId === "overviewPage") {
    renderMap();
  }
  if (pageId === "countryPage") {
    renderTrend(els.countrySelect.value);
  }
  if (pageId === "foodSecurityPage") {
    renderFoodSecurityPage();
  }
  if (pageId === "nutritionPage") {
    renderNutritionPage();
  }
  if (pageId === "forecastPage") {
    const preferredIso3 = preferredForecastCountryIso3(els.countrySelect.value);
    if (preferredIso3 && preferredIso3 !== els.countrySelect.value) {
      els.countrySelect.value = preferredIso3;
    }
    renderForecast(preferredIso3 || els.countrySelect.value);
  }
  if (pageId === "cyclonePage") {
    renderCyclonePage();
  }
  if (pageId === "hazardPage") {
    renderHazardSourceSummaries();
  }
  if (pageId === "conflictsDisplacementPage") {
    renderConflictsDisplacementPage();
  }
  if (pageId === "operationalReportPage") {
    renderOperationalReportPage();
  }

  scheduleActivePageVisualRefresh(pageId);
}

function conflictsDisplacementSignalLabel(country) {
  const conflict = country.conflict_signal_count || 0;
  const displacement = country.displacement_signal_count || 0;
  const reports = country.report_count_30d || 0;

  if (conflict >= 3 || displacement >= 3 || (conflict >= 2 && displacement >= 1)) {
    return { label: "Critical pressure", className: "bad" };
  }
  if (conflict + displacement >= 2 || reports >= 3) {
    return { label: "High concern", className: "warn" };
  }
  return { label: "Watch", className: "good" };
}

function conflictSignalSourceSummary(signals) {
  const counts = {};
  (signals || []).forEach((item) => {
    const key = item?.source || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  });
  const pairs = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return pairs.length ? pairs.map(([name, count]) => `${name} (${count})`).join(", ") : "n/a";
}

function renderConflictsDisplacementPage() {
  if (!dashboardState || !els.conflictsDisplacementSummary || !els.conflictsDisplacementSourceStatus || !els.conflictsDisplacementTableBody || !els.conflictsDisplacementFeed) {
    return;
  }

  const countries = dashboardState.countries || [];
  const signals = dashboardState.conflict_displacement_signals || [];
  const sourceStatus = dashboardState.conflict_displacement_source_status || {};
  const sourceHistory = dashboardState.conflict_displacement_source_status_history || [];
  const acledStatus = dashboardState.acled_source_status || {};
  const acledContextEntries = dashboardState.acled_context_entries || [];
  const candidate = sourceStatus.candidate_items_current || sourceStatus.candidate_items_30d || {};
  const candidateReporting30d = sourceStatus.candidate_items_reporting_30d || {};
  const candidateStructural = sourceStatus.candidate_items_structural || {};
  const matchedBySource = sourceStatus.matched_signal_items || {};
  const focusCountries = [...countries]
    .filter((country) => (country.conflict_signal_count || 0) > 0 || (country.displacement_signal_count || 0) > 0)
    .sort((a, b) => {
      const aScore = ((a.conflict_signal_count || 0) * 3) + ((a.displacement_signal_count || 0) * 3) + (a.report_count_30d || 0) + ((a.risk_score || 0) / 20);
      const bScore = ((b.conflict_signal_count || 0) * 3) + ((b.displacement_signal_count || 0) * 3) + (b.report_count_30d || 0) + ((b.risk_score || 0) / 20);
      return bScore - aScore;
    });
  const topCountries = focusCountries.slice(0, 8);
  const conflictCountries = focusCountries.filter((country) => (country.conflict_signal_count || 0) > 0);
  const displacementCountries = focusCountries.filter((country) => (country.displacement_signal_count || 0) > 0);
  const conflictHotspots = conflictCountries.slice(0, 4).map((country) => `${country.country} (${country.conflict_signal_count})`).join(", ") || "n/a";
  const displacementHotspots = displacementCountries.slice(0, 4).map((country) => `${country.country} (${country.displacement_signal_count})`).join(", ") || "n/a";
  const overlapCountries = focusCountries.filter((country) => (country.conflict_signal_count || 0) > 0 && (country.displacement_signal_count || 0) > 0).length;
  const sourceMix = conflictSignalSourceSummary(signals);
  const acledContextCountries = [...countries]
    .filter((country) => country.acled_index?.rank != null)
    .sort((a, b) => (a.acled_index.rank || Number.MAX_SAFE_INTEGER) - (b.acled_index.rank || Number.MAX_SAFE_INTEGER));
  const acledTopContext = acledContextCountries
    .slice(0, 4)
    .map((country) => `${country.country} (#${country.acled_index.rank}, ${country.acled_index.index_level || "Unknown"})`)
    .join(", ") || "n/a";
  const projectionCountries = [...countries]
    .filter((country) => (country.ipc?.projection_phase3plus_pct || 0) >= 0.2)
    .sort((a, b) => (b.ipc?.projection_phase3plus_pct || 0) - (a.ipc?.projection_phase3plus_pct || 0));
  const projectionHotspots = projectionCountries
    .slice(0, 4)
    .map((country) => `${country.country} (${formatNum((country.ipc?.projection_phase3plus_pct || 0) * 100, 1)}%)`)
    .join(", ") || "n/a";
  const projectionOverlap = focusCountries.filter((country) => (country.ipc?.projection_phase3plus_pct || 0) >= 0.2).length;
  const currentText = `${signals.length} matched conflict/displacement items across ${focusCountries.length} countries`;
  const projectionText = `${projectionOverlap} active countries with IPC projection >= 20%`;
  const confidenceLevel = signals.length > 0 && acledContextCountries.length > 0 ? "good" : signals.length > 0 ? "warn" : "bad";
  const confidenceText = confidenceLevel === "good"
    ? "Reporting and structural context are both present in this refresh."
    : confidenceLevel === "warn"
      ? "Current reporting exists, but structural context is partial."
      : "Very limited current source confirmation in this refresh.";

  els.conflictsDisplacementSummary.innerHTML = `
    ${renderCurrentProjectionConfidence(currentText, projectionText, confidenceText, confidenceLevel)}
    <p><strong>Countries with active signals:</strong> ${focusCountries.length} countries currently show conflict-related or displacement-related reporting signals in the current refresh window.</p>
    <p><strong>Conflict hotspots:</strong> ${conflictHotspots}.</p>
    <p><strong>Displacement hotspots:</strong> ${displacementHotspots}.</p>
    <p><strong>Overlap profiles:</strong> ${overlapCountries} countries show both conflict and displacement reporting signals in the same refresh cycle.</p>
    <p><strong>Current evidence volume:</strong> ${signals.length} linked source items matched conflict or displacement signal rules across reporting and structural-source inputs.</p>
    <p><strong>Projection outlook (food-security burden):</strong> ${projectionOverlap} conflict/displacement-active countries also have IPC Phase 3+ projection >= 20%; top projected burden countries are ${projectionHotspots}.</p>
    <p><strong>Source mix:</strong> ${sourceMix}.</p>
    <p><strong>ACLED structural context:</strong> ${acledStatus.mapped_countries || acledContextCountries.length} mapped countries in the Conflict Index. Highest ranked mapped entries: ${acledTopContext}.</p>
    <p><span class="tag warn">Interpretation</span> These are source-derived online reporting signals intended for leadership triage and follow-up, not validated incident or displacement caseload estimates.</p>
  `;

  const sourceRows = [
    {
      label: "ReliefWeb",
      candidate: candidate.reliefweb || 0,
      reportingCandidate: candidateReporting30d.reliefweb || 0,
      structuralCandidate: 0,
      matched: matchedBySource["reliefweb rss"] || 0,
      tooltip: `ReliefWeb RSS source. C=${candidate.reliefweb || 0}, M=${matchedBySource["reliefweb rss"] || 0}`,
      detail: "Direct RSS"
    },
    {
      label: "OCHA",
      candidate: candidate.unocha || 0,
      reportingCandidate: candidateReporting30d.unocha || 0,
      structuralCandidate: 0,
      matched: matchedBySource["ocha rss"] || 0,
      tooltip: `OCHA RSS source. C=${candidate.unocha || 0}, M=${matchedBySource["ocha rss"] || 0}`,
      detail: "Direct RSS"
    },
    {
      label: "IDMC",
      candidate: candidate.idmc || 0,
      reportingCandidate: candidateReporting30d.idmc || 0,
      structuralCandidate: 0,
      matched: matchedBySource["idmc rss"] || 0,
      tooltip: `IDMC RSS source. C=${candidate.idmc || 0}, M=${matchedBySource["idmc rss"] || 0}`,
      detail: "Direct RSS"
    },
    {
      label: "IOM DTM",
      candidate: candidate.iom_dtm || 0,
      reportingCandidate: candidateReporting30d.iom_dtm || 0,
      structuralCandidate: 0,
      matched: matchedBySource["iom dtm event tracking"] || 0,
      tooltip: `IOM DTM event-tracking source. C=${candidate.iom_dtm || 0}, M=${matchedBySource["iom dtm event tracking"] || 0}`,
      detail: "Event Tracking reports"
    },
    {
      label: "UNHCR",
      candidate: candidate.unhcr || 0,
      reportingCandidate: candidateReporting30d.unhcr || 0,
      structuralCandidate: candidateStructural.unhcr_population_data || 0,
      matched: (matchedBySource["unhcr rss"] || 0) + (matchedBySource["unhcr via reliefweb"] || 0) + (matchedBySource["unhcr population data"] || 0),
      tooltip: `UNHCR source. C=${candidate.unhcr || 0}, M=${(matchedBySource["unhcr rss"] || 0) + (matchedBySource["unhcr via reliefweb"] || 0) + (matchedBySource["unhcr population data"] || 0)} (direct=${matchedBySource["unhcr rss"] || 0}, ReliefWeb fallback=${matchedBySource["unhcr via reliefweb"] || 0}, stats fallback=${matchedBySource["unhcr population data"] || 0})`,
      detail: `Direct ${matchedBySource["unhcr rss"] || 0} | ReliefWeb ${matchedBySource["unhcr via reliefweb"] || 0} | Stats ${matchedBySource["unhcr population data"] || 0} | Reporting candidates ${candidateReporting30d.unhcr || 0} | Structural candidates ${candidateStructural.unhcr_population_data || 0}`
    }
  ];

  const sourceCards = sourceRows.map((row) => {
    const statusClass = row.matched > 0 ? "good" : row.candidate > 0 ? "warn" : "bad";
    const statusLabel = row.matched > 0 ? "Contributing" : row.candidate > 0 ? "No current signal match" : "No current candidates";
    const directMatched =
      row.label === "UNHCR"
        ? Number(matchedBySource["unhcr rss"] || 0)
        : row.label === "ReliefWeb"
          ? Number(matchedBySource["reliefweb rss"] || 0)
          : row.label === "OCHA"
            ? Number(matchedBySource["ocha rss"] || 0)
            : row.label === "IDMC"
              ? Number(matchedBySource["idmc rss"] || 0)
              : row.label === "IOM DTM"
                ? Number(matchedBySource["iom dtm event tracking"] || 0)
              : 0;
    const fallbackMatched = Math.max(0, Number(row.matched || 0) - directMatched);
    const confidence = (() => {
      if (Number(row.structuralCandidate || 0) > 0 && Number(row.reportingCandidate || 0) === 0) {
        return {
          label: "Structural-only",
          className: "warn",
          detail: "Only structural baseline context is available; no active reporting feed matched in this refresh."
        };
      }
      if (Number(row.matched || 0) > 0 && fallbackMatched > 0 && directMatched === 0) {
        return {
          label: "Fallback-only",
          className: "warn",
          detail: "Matched through fallback pathways; no direct primary source match in this refresh."
        };
      }
      if (Number(row.matched || 0) > 0 && Number(row.reportingCandidate || 0) > 0) {
        return {
          label: "Fresh",
          className: "good",
          detail: "Direct reporting candidates are active and currently contributing matched signal items."
        };
      }
      if (Number(row.candidate || 0) > 0 && Number(row.matched || 0) === 0) {
        return {
          label: "Delayed",
          className: "warn",
          detail: "Candidates are present, but none currently match conflict/displacement signal rules."
        };
      }
      return {
        label: "No current feed",
        className: "bad",
        detail: "No relevant source candidates were detected in this refresh."
      };
    })();
    const splitTotal = Math.max(0, Number(row.reportingCandidate || 0) + Number(row.structuralCandidate || 0));
    const reportingPct = splitTotal > 0 ? Math.round((Number(row.reportingCandidate || 0) / splitTotal) * 100) : 0;
    const structuralPct = splitTotal > 0 ? Math.max(0, 100 - reportingPct) : 0;
    return `
      <article class="conflict-source-card">
        <div class="conflict-source-card-head">
          <strong title="${row.tooltip}">${row.label}</strong>
          <span class="tag ${statusClass}">${statusLabel}</span>
        </div>
        <div class="conflict-source-metrics">
          <span><strong>Candidates (current refresh):</strong> ${row.candidate}</span>
          <span><strong>Matched items:</strong> ${row.matched}</span>
          <span><strong>Confidence:</strong> <span class="tag ${confidence.className}" title="${confidence.detail}">${confidence.label}</span></span>
        </div>
        <div class="conflict-source-split" title="Reporting=${row.reportingCandidate || 0}, Structural=${row.structuralCandidate || 0}">
          <div class="conflict-source-split-bar">
            <span class="conflict-source-split-segment reporting" style="width:${reportingPct}%"></span>
            <span class="conflict-source-split-segment structural" style="width:${structuralPct}%"></span>
          </div>
          <div class="conflict-source-split-meta">Reporting ${row.reportingCandidate || 0} | Structural ${row.structuralCandidate || 0}</div>
        </div>
        <div class="signal-summary">${row.detail}</div>
      </article>
    `;
  }).join("");

  const unhcrCandidateCount = Number(candidate.unhcr || 0);
  const unhcrNote = unhcrCandidateCount === 0
    ? '<p class="conflict-source-note"><span class="tag warn">UNHCR note</span> UNHCR candidate items are zero in this refresh. This can reflect endpoint access constraints in the current runtime, not necessarily absence of displacement reporting.</p>'
    : "";

  const historyRows = [...sourceHistory].slice(-5).reverse().map((entry) => {
    const c = entry.candidate_items_current || entry.candidate_items_30d || {};
    const m = entry.matched_signal_items || {};
    const matchedTotal = Number(entry.matched_total || 0);
    const markerClass = matchedTotal > 0 ? "good" : "warn";
    return `
      <div class="conflict-source-history-row">
        <span class="conflict-source-history-time" title="${entry.generated_at || "n/a"}">${formatDateTime(entry.generated_at)}</span>
        <span class="conflict-source-history-stat">RW ${c.reliefweb || 0}/${m["reliefweb rss"] || 0}</span>
        <span class="conflict-source-history-stat">OCHA ${c.unocha || 0}/${m["ocha rss"] || 0}</span>
        <span class="conflict-source-history-stat">IDMC ${c.idmc || 0}/${m["idmc rss"] || 0}</span>
        <span class="conflict-source-history-stat">IOM ${c.iom_dtm || 0}/${m["iom dtm event tracking"] || 0}</span>
        <span class="conflict-source-history-stat">UNHCR ${c.unhcr || 0}/${m["unhcr total"] || ((m["unhcr rss"] || 0) + (m["unhcr via reliefweb"] || 0))}</span>
        <span class="tag ${markerClass}">Total matched ${matchedTotal}</span>
      </div>
    `;
  }).join("");

  const historyPanel = historyRows
    ? `
      <div class="conflict-source-history">
        <div class="conflict-source-history-head"><strong>Last ${Math.min(5, sourceHistory.length)} refreshes</strong><span>format: candidates (current refresh)/matched</span></div>
        ${historyRows}
      </div>
    `
    : "";

  const sourceLegend = `
    <div class="conflict-source-legend" aria-label="Source composition legend">
      <span class="conflict-source-legend-item">
        <span class="conflict-source-legend-dot reporting"></span>
        Reporting: source reports and alerts used for operational conflict/displacement signal matching.
      </span>
      <span class="conflict-source-legend-item">
        <span class="conflict-source-legend-dot structural"></span>
        Structural: baseline burden datasets (for example annual displacement estimates), not incident updates.
      </span>
    </div>
  `;

  els.conflictsDisplacementSourceStatus.innerHTML = `
    <div class="conflict-source-status-header">
      <p><strong>Source health:</strong> candidate and matched conflict/displacement items by source for the current refresh.</p>
      <p><strong>Checked at:</strong> <span title="${sourceStatus.generated_at || "n/a"}">${formatDateTime(sourceStatus.generated_at)}</span></p>
      <p><strong>Source timestamp:</strong> <span title="${sourceStatus.generated_at || "n/a"}">${formatDateTime(sourceStatus.generated_at)}</span></p>
    </div>
    ${sourceLegend}
    <div class="conflict-source-grid">${sourceCards}</div>
    <p class="conflict-source-exec-note"><span class="tag warn">Executive caveat</span> Structural entries indicate burden context and planning pressure, not real-time incident progression. Use reporting-signal trends for immediate escalation decisions.</p>
    <p class="conflict-source-note"><span class="tag good">ACLED context</span> ${acledContextEntries.length} ACLED Conflict Index entries were mapped this refresh across ${acledStatus.mapped_countries || acledContextCountries.length} countries. These rows provide structural conflict context and are not counted as matched conflict/displacement reporting items.</p>
    ${historyPanel}
    ${unhcrNote}
  `;

  els.conflictsDisplacementTableBody.innerHTML = topCountries.map((country) => {
    const signal = conflictsDisplacementSignalLabel(country);
    return `
      <tr>
        <td><strong>${country.country}</strong><br>${compactTrackLabel(country.fcv_track)}</td>
        <td>${country.risk_score}</td>
        <td>${country.conflict_signal_count || 0}</td>
        <td>${country.displacement_signal_count || 0}</td>
        <td>${country.report_count_30d || 0}</td>
        <td>${country.ipc?.phase3plus_pct != null ? `${formatNum(country.ipc.phase3plus_pct * 100, 1)}%` : "n/a"}</td>
        <td><span class="tag ${signal.className}">${signal.label}</span></td>
      </tr>
    `;
  }).join("");

  const evidenceItems = topCountries.slice(0, 5).map((country) => {
    const countrySignals = signals
      .filter((item) => (item.countries || []).includes(country.iso3) && isApprovedVisibleEventSource(item.source || ""))
      .slice(0, 3);
    const signalMarkup = countrySignals.length
      ? countrySignals.map((item) => `
          <div class="feed-item conflict-feed-item">
            <div class="conflict-feed-header">
              <a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled report"}</a>
              <div class="signal-chip-row">
                ${(item.signal_tags || []).map((tag) => `<span class="signal-chip ${tag.toLowerCase()}">${tag}</span>`).join("")}
              </div>
            </div>
            <div class="feed-meta-row">${renderSourceTrustBadge(item.source || "ReliefWeb")}<span>${item.source || "ReliefWeb"} | <span title="${item.date_label || "n/a"}">${formatDateTime(item.date_label)}</span></span></div>
            <div class="signal-summary">${summarizeSourceExcerpt(item.summary || item.content || "", SOURCE_EXCERPT_MAX_CHARS)}</div>
          </div>
        `).join("")
      : '<div class="feed-item conflict-feed-item"><div>No linked conflict or displacement source item was detected for this country in the current refresh.</div></div>';

    return `
      <div class="conflict-country-block">
        <div class="conflict-country-header">
          <strong>${country.country}</strong>
          <span class="tag ${conflictsDisplacementSignalLabel(country).className}">${conflictsDisplacementSignalLabel(country).label}</span>
        </div>
        ${signalMarkup}
      </div>
    `;
  });

  els.conflictsDisplacementFeed.innerHTML = evidenceItems.join("") || "No conflict or displacement evidence items are available in this refresh.";

  renderDtmDisplacementTable();

  renderRecommendationList(
    els.conflictsDisplacementRecommendations,
    aiRecommendations?.byIssue?.conflictsDisplacement,
    "No conflict or displacement recommendations were triggered in the current refresh."
  );
}

function clearPrintRestoreTimer() {
  if (printRestoreTimer) {
    clearTimeout(printRestoreTimer);
    printRestoreTimer = null;
  }
}

function jumpToServiceDeliveryPanel() {
  stopAutoRotate("service delivery snapshot");
  setActivePage("countryPage");
  window.requestAnimationFrame(() => {
    const panel = document.getElementById("serviceDeliveryPanel");
    if (!panel) {
      return;
    }
    panel.classList.add("panel-jump-highlight");
    panel.setAttribute("tabindex", "-1");
    panel.focus({ preventScroll: true });
    window.setTimeout(() => {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      if (window.location.hash !== "#serviceDeliveryPanel") {
        window.history.replaceState(null, "", "#serviceDeliveryPanel");
      }
    }, 80);
    window.setTimeout(() => {
      panel.classList.remove("panel-jump-highlight");
    }, 2200);
  });
}

function jumpToForecastPanel() {
  stopAutoRotate("forecast studio");
  setActivePage("forecastPage");
  window.requestAnimationFrame(() => {
    const insights = document.getElementById("forecastInsights");
    const panel = insights?.closest(".panel") || document.getElementById("forecastPage");
    if (!panel) {
      return;
    }
    panel.classList.add("panel-jump-highlight");
    panel.setAttribute("tabindex", "-1");
    panel.focus({ preventScroll: true });
    window.setTimeout(() => {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      if (window.location.hash !== "#forecastPage") {
        window.history.replaceState(null, "", "#forecastPage");
      }
    }, 80);
    window.setTimeout(() => {
      panel.classList.remove("panel-jump-highlight");
    }, 2200);
  });
}

function showExportStatus(message, tone = "info", timeoutMs = 5000) {
  if (!els.exportStatus) {
    return;
  }
  if (exportStatusTimer) {
    clearTimeout(exportStatusTimer);
    exportStatusTimer = null;
  }
  els.exportStatus.textContent = message || "";
  els.exportStatus.classList.add("is-visible");
  els.exportStatus.classList.toggle("is-error", tone === "error");
  els.exportStatus.classList.toggle("is-success", tone === "success");
  if (timeoutMs > 0) {
    exportStatusTimer = setTimeout(() => {
      els.exportStatus.classList.remove("is-visible", "is-error", "is-success");
      els.exportStatus.textContent = "";
      exportStatusTimer = null;
    }, timeoutMs);
  }
}

function applyPrintVisibilityGuard() {
  clearPrintVisibilityGuard();
  const nodes = Array.from(document.querySelectorAll(".page, #operationalReportPage, #operationalReportPage .panel"));
  printVisibilityGuardNodes = nodes.map((node) => {
    const previous = {
      animation: node.style.animation,
      opacity: node.style.opacity,
      transform: node.style.transform
    };
    node.style.animation = "none";
    node.style.opacity = "1";
    node.style.transform = "none";
    return { node, previous };
  });
}

function clearPrintVisibilityGuard() {
  if (!printVisibilityGuardNodes.length) {
    return;
  }
  printVisibilityGuardNodes.forEach(({ node, previous }) => {
    if (!node) {
      return;
    }
    node.style.animation = previous.animation;
    node.style.opacity = previous.opacity;
    node.style.transform = previous.transform;
  });
  printVisibilityGuardNodes = [];
}

function prepareOperationalBulletinPrint() {
  clearPrintRestoreTimer();
  if (!document.body.classList.contains(PRINT_MODE_CLASS)) {
    pendingPrintRestorePage = activePageId();
  }
  document.body.classList.add(PRINT_MODE_CLASS);
  applyPrintVisibilityGuard();
  setActivePage(PRINT_REPORT_PAGE_ID);
  renderOperationalReportPage();
}

function restoreOperationalBulletinPrint() {
  clearPrintRestoreTimer();
  if (!document.body.classList.contains(PRINT_MODE_CLASS)) {
    return;
  }

  document.body.classList.remove(PRINT_MODE_CLASS);
  clearPrintVisibilityGuard();
  const restorePage = pendingPrintRestorePage;
  pendingPrintRestorePage = null;

  if (restorePage) {
    setActivePage(restorePage);
  }
}

function latestAvailableIndicatorValue(indicator) {
  const latest = indicator?.latest_any || indicator?.latest;
  if (!latest || latest.year == null) {
    return null;
  }
  return latest;
}

function isOperationallyCurrentYear(year, referenceYear) {
  if (year == null) {
    return false;
  }
  const ageYears = referenceYear - Number(year);
  if (Number.isNaN(ageYears) || ageYears < 0 || ageYears > NUTRITION_OPERATIONAL_MAX_AGE_YEARS) {
    return false;
  }
  return true;
}

function nutritionCell(latest, referenceYear, isAnemia = false) {
  if (!latest) {
    return "n/a";
  }
  const currentTag = isOperationallyCurrentYear(latest.year, referenceYear)
    ? '<span class="tag good">Current</span>'
    : '<span class="tag warn">Older</span>';
  const sourceIsHdx = latest.source && latest.source.toLowerCase().includes("hdx");
  const sourceTag = sourceIsHdx
    ? '<span class="tag warn">HDX proxy</span>'
    : '<span class="tag good">WB</span>';
  const methodHint = latest.method ? ` (${latest.method})` : "";
  const sourceHint = sourceIsHdx
    ? `HDX acute malnutrition proxy${methodHint}`
    : `World Bank indicator${methodHint}`;
  const anemiaNote = isAnemia ? ' <small title="Anemia prevalence (SH.ANM.PREG.ZS), not an acute malnutrition indicator" style="color:#888;white-space:nowrap">&#9888; anemia only</small>' : "";
  return `<strong>${formatNum(latest.value)}</strong> <span class="nutrition-year">(${latest.year})</span> <span title="${sourceHint}">${sourceTag}</span> ${currentTag}${anemiaNote}`;
}

function minutesAgoFromIso(value) {
  if (!value) {
    return null;
  }
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

function humanAgeFromIso(value) {
  const mins = minutesAgoFromIso(value);
  if (mins == null) {
    return "n/a";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

function renderNutritionPage() {
  if (!dashboardState || !els.nutritionTableBody || !els.nutritionSummary || !els.nutritionCurrentStamp) {
    return;
  }

  const referenceYear = Number(new Date(dashboardState.generated_at || Date.now()).getUTCFullYear());

  const rows = (dashboardState.countries || []).map((c) => {
    const wasting = latestAvailableIndicatorValue(c.indicators?.wasting_u5_pct);
    const stunting = latestAvailableIndicatorValue(c.indicators?.stunting_u5_pct);
    const anemia = latestAvailableIndicatorValue(c.indicators?.pregnant_anemia_pct);
    const latestAnyYears = [
      c.indicators?.wasting_u5_pct?.latest_any?.year,
      c.indicators?.stunting_u5_pct?.latest_any?.year,
      c.indicators?.pregnant_anemia_pct?.latest_any?.year
    ].filter((y) => y != null);
    return {
      country: c.country,
      fcv_track: c.fcv_track,
      wasting,
      stunting,
      anemia,
      score: [wasting, stunting, anemia].filter(Boolean).length,
      latestAnyYear: latestAnyYears.length ? Math.max(...latestAnyYears) : null
    };
  });

  const visibleRows = rows
    .filter((r) => r.score > 0)
    .sort((a, b) => countryTrackRank(a.fcv_track) - countryTrackRank(b.fcv_track) || b.score - a.score || a.country.localeCompare(b.country));

  const counts = {
    wasting: rows.filter((r) => r.wasting != null).length,
    stunting: rows.filter((r) => r.stunting != null).length,
    anemia: rows.filter((r) => r.anemia != null).length
  };

  const allYears = (dashboardState.countries || [])
    .flatMap((c) => [
      c.indicators?.wasting_u5_pct?.latest_any?.year,
      c.indicators?.stunting_u5_pct?.latest_any?.year,
      c.indicators?.pregnant_anemia_pct?.latest_any?.year
    ])
    .filter((y) => y != null)
    .sort((a, b) => a - b);
  const minYear = allYears.length ? allYears[0] : null;
  const maxYear = allYears.length ? allYears[allYears.length - 1] : null;

  const wbFetchedAt = dashboardState.source_freshness?.world_bank;
  const wbFreshness = humanAgeFromIso(wbFetchedAt);
  const wbStatus = dashboardState.nutrition_source_status?.overall || "unknown";
  const hdxNutritionStatus = dashboardState.nutrition_hdx_status || {};
  const hdxAppliedCountries = (dashboardState.countries || [])
    .filter((c) => c.indicators?.wasting_u5_pct?.latest?.source?.toLowerCase?.().includes("hdx"))
    .map((c) => c.country);

  els.nutritionCurrentStamp.textContent = `Most recent available values are shown. "Current" means ${referenceYear - NUTRITION_OPERATIONAL_MAX_AGE_YEARS} to ${referenceYear}; older values are labeled "Older".`;

  if (!visibleRows.length) {
    const countriesByLatest = rows
      .filter((r) => r.latestAnyYear != null)
      .sort((a, b) => (b.latestAnyYear - a.latestAnyYear) || a.country.localeCompare(b.country))
      .slice(0, 5)
      .map((r) => `${r.country} (${r.latestAnyYear})`)
      .join(", ");
    els.nutritionSummary.innerHTML = `
      <p><span class='tag warn'>No nutrition values available</span> No under-5 or pregnant-women values were returned for this refresh.</p>
      <p><strong>Latest available years in source:</strong> ${minYear && maxYear ? `${minYear} to ${maxYear}` : "n/a"}.</p>
      <p><strong>Most recent countries in source:</strong> ${countriesByLatest || "n/a"}.</p>
      <p><strong>Expected update cadence:</strong> World Bank nutrition indicators are generally annual and can lag by one or more years depending on reporting pipelines.</p>
    `;
    els.nutritionTableBody.innerHTML = "";
    return;
  }

  els.nutritionSummary.innerHTML = `
    <p><strong>Coverage (latest available):</strong> Child Wasting ${counts.wasting}/${rows.length}, Child Stunting ${counts.stunting}/${rows.length}, Pregnant Women Anemia ${counts.anemia}/${rows.length}.</p>
    <p><strong>Source status:</strong> World Bank feed ${wbStatus} and checked ${wbFreshness} (<span title="${wbFetchedAt || "n/a"}">${formatDateTime(wbFetchedAt)}</span>).</p>
    <p><strong>HDX fallback status:</strong> ${hdxNutritionStatus.overall || "unknown"}; applied in ${hdxNutritionStatus.applied_country_count ?? 0} pilot country profiles when World Bank values were stale or missing.</p>
    <p><strong>Fallback countries this refresh:</strong> ${hdxAppliedCountries.length ? hdxAppliedCountries.join(", ") : "none"}.</p>
    <p><strong>Indicator definition note:</strong> Pregnant women values represent anemia prevalence (World Bank SH.ANM.PREG.ZS), not acute malnutrition. HDX fallback currently applies only to under-5 acute malnutrition proxy values (wasting context).</p>
    <p><strong>Latest available years in source:</strong> ${minYear && maxYear ? `${minYear} to ${maxYear}` : "n/a"}.</p>
    <p><strong>Data gap note:</strong> Eritrea (ERI) has no IPC or HDX acute malnutrition source configured; it is absent from this table. This is a known data access constraint.</p>
    <p><strong>Expected update cadence:</strong> World Bank nutrition indicators are generally annual. Dashboard checks run each refresh, but values update only when a new year is published upstream.</p>
  `;

  els.nutritionTableBody.innerHTML = visibleRows
    .map((r) => `
      <tr>
        <td><strong>${r.country}</strong></td>
        <td>${compactTrackLabel(r.fcv_track)}</td>
        <td>${nutritionCell(r.wasting, referenceYear)}</td>
        <td>${nutritionCell(r.stunting, referenceYear)}</td>
        <td>${nutritionCell(r.anemia, referenceYear, true)}</td>
      </tr>
    `)
    .join("");

  if (els.nutritionFeed) {
    const signals = dashboardState.nutrition_signals || [];
    const countries = dashboardState.countries || [];
    const focusCountries = [...countries]
      .filter((c) => (c.nutrition_signal_count || 0) > 0)
      .sort((a, b) => {
        const aScore = ((a.nutrition_signal_count || 0) * 3) + (a.report_count_30d || 0);
        const bScore = ((b.nutrition_signal_count || 0) * 3) + (b.report_count_30d || 0);
        return bScore - aScore;
      })
      .slice(0, 5);

    if (!focusCountries.length) {
      els.nutritionFeed.innerHTML = "No nutrition reporting items matched verified source criteria in the current 30-day window.";
    } else {
      els.nutritionFeed.innerHTML = focusCountries.map((country) => {
        const countrySignals = signals
          .filter((item) => (item.countries || []).includes(country.iso3) && isApprovedVisibleEventSource(item.source || ""))
          .slice(0, 3);
        const wastingVal = country.indicators?.wasting_u5_pct?.latest?.value;
        const nutritionLabel = wastingVal != null
          ? `Wasting ${formatNum(wastingVal, 1)}%`
          : "No wasting data";
        const nutritionClass = wastingVal == null ? "warn" : wastingVal >= 15 ? "bad" : wastingVal >= 10 ? "warn" : "good";
        const signalMarkup = countrySignals.length
          ? countrySignals.map((item) => `
              <div class="feed-item conflict-feed-item">
                <div class="conflict-feed-header">
                  <a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled report"}</a>
                  <div class="signal-chip-row">
                    ${(item.signal_tags || []).map((tag) => `<span class="signal-chip ${tag.toLowerCase().replace(/\s+/g, "-")}">${tag}</span>`).join("")}
                  </div>
                </div>
                <div class="feed-meta-row">${renderSourceTrustBadge(item.source || "ReliefWeb")}<span>${item.source || "ReliefWeb"} | <span title="${item.date_label || "n/a"}">${formatDateTime(item.date_label)}</span></span></div>
                <div class="signal-summary">${summarizeSourceExcerpt(item.summary || item.content || "", SOURCE_EXCERPT_MAX_CHARS)}</div>
              </div>
            `).join("")
          : '<div class="feed-item conflict-feed-item"><div>No linked nutrition source item was detected for this country in the current refresh.</div></div>';
        return `
          <div class="conflict-country-block">
            <div class="conflict-country-header">
              <strong>${country.country}</strong>
              <span class="tag ${nutritionClass}">${nutritionLabel}</span>
            </div>
            ${signalMarkup}
          </div>
        `;
      }).join("");
    }
  }
}

function riskLabelFromPct(pct) {
  if (pct == null) {
    return "unknown";
  }
  if (pct >= 0.30) {
    return "critical";
  }
  if (pct >= 0.20) {
    return "high";
  }
  return "watch";
}

function recommendationCard(rec) {
  const priorityMap = {
    critical: t("recCritical"),
    high: t("recHigh"),
    watch: t("recWatch")
  };
  const priorityLabel = priorityMap[rec.priority] || String(rec.priority || "").toUpperCase();
  return `
    <div class="rec-item rec-${rec.priority}">
      <div class="rec-priority-label">${priorityLabel}</div>
      <div class="rec-title">${rec.title}</div>
      <div class="rec-body">${rec.body}</div>
    </div>
  `;
}

function renderRecommendationList(el, recs, emptyText) {
  if (!el) {
    return;
  }
  if (!recs || !recs.length) {
    el.innerHTML = `<p class="rec-empty">${translateHtmlPhrases(emptyText)}</p>`;
    return;
  }
  el.innerHTML = recs.map(recommendationCard).join("");
}

// Parse a "Mon YYYY" formatted IPC analysis date and return months elapsed since that date.
function ipcAnalysisAgeMonths(dateStr) {
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const m = (dateStr || "").trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) { return null; }
  const mon = MONTHS[m[1]];
  if (mon == null) { return null; }
  const then = new Date(parseInt(m[2], 10), mon, 1);
  const now = new Date();
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

function staleIpcEntries(countries) {
  return (countries || [])
    .map((c) => ({
      country: c.country,
      iso3: c.iso3,
      ageMonths: ipcAnalysisAgeMonths(c.ipc?.analysis_date)
    }))
    .filter((c) => c.ageMonths != null && c.ageMonths >= 36);
}

function formatStaleIpcList(entries, options = {}) {
  const {
    labelMode = "iso3",
    maxItems = 4,
    moreFormat = "plus",
    includeAge = true
  } = options;
  const visible = entries.slice(0, maxItems).map((entry) => {
    const label = labelMode === "country" ? entry.country : (entry.iso3 || entry.country);
    return includeAge ? `${label} (${entry.ageMonths}m)` : label;
  }).join(", ");
  const remaining = Math.max(0, entries.length - maxItems);
  if (!remaining) {
    return visible;
  }
  return moreFormat === "compact" ? `${visible} +${remaining}` : `${visible} plus ${remaining} more`;
}

function refreshActivePageVisuals(pageId = activePageId()) {
  if (!dashboardState) {
    return;
  }
  if (pageId === "overviewPage") {
    renderMap();
  }
  if (pageId === "countryPage") {
    renderTrend(els.countrySelect.value);
  }
  if (pageId === "forecastPage") {
    const preferredIso3 = preferredForecastCountryIso3(els.countrySelect.value);
    renderForecast(preferredIso3 || els.countrySelect.value);
  }
}

function scheduleActivePageVisualRefresh(pageId = activePageId()) {
  [80, 240].forEach((delay) => {
    setTimeout(() => {
      if (pageId !== activePageId()) {
        return;
      }
      refreshActivePageVisuals(pageId);
    }, delay);
  });
}

function renderFoodSecurityPage() {
  if (!dashboardState || !els.foodSecurityTableBody) {
    return;
  }

  const rows = [...(dashboardState.countries || [])]
    .filter((c) => c.ipc || c.fews_ipc)
    .sort((a, b) => (b.ipc?.phase3plus_pct || 0) - (a.ipc?.phase3plus_pct || 0));

  els.foodSecurityTableBody.innerHTML = rows
    .map((c) => {
      const ipc = c.ipc || null;
      const level = riskLabelFromPct(ipc?.phase3plus_pct);
      const levelClass = level === "critical" ? "bad" : level === "high" ? "warn" : "good";
      const projectedPct = ipc?.projection_phase3plus_pct;
      const projectedTag = projectedPct == null
        ? '<span class="tag warn">No projection</span>'
        : `<span class="tag ${projectedPct >= 0.3 ? "bad" : projectedPct >= 0.2 ? "warn" : "good"}">${formatNum(projectedPct * 100, 1)}%</span>`;
      const ipcAgeMos = ipcAnalysisAgeMonths(ipc?.analysis_date);
      const ipcStaleTag = ipcAgeMos != null && ipcAgeMos >= 36
        ? ` <span class="tag bad" title="${ipcAgeMos} months old — IPC classification is very stale; verify with the latest IPC cycle before using this for decisions">Very stale</span>`
        : ipcAgeMos != null && ipcAgeMos >= 18
          ? ` <span class="tag warn" title="${ipcAgeMos} months old — IPC classification is older than 18 months">Stale</span>`
          : "";
      const fews = c.fews_ipc;
      const fewsPhaseClass = (phase) => phase >= 4 ? "bad" : phase >= 3 ? "warn" : phase >= 1 ? "good" : "";
      const fewsCSCell = fews?.cs_phase != null
        ? `<span class="tag ${fewsPhaseClass(fews.cs_phase)}" title="${fews.cs_description || ""} — projection end: ${fews.cs_projection_end || "n/a"}">Phase ${fews.cs_phase}</span>`
        : fews == null
          ? '<span class="tag">No FEWS coverage</span>'
          : '<span class="tag warn">n/a</span>';
      const fewsML1Cell = fews?.ml1_phase != null
        ? `<span class="tag ${fewsPhaseClass(fews.ml1_phase)}" title="${fews.ml1_description || ""} — projection end: ${fews.ml1_projection_end || "n/a"}">Phase ${fews.ml1_phase}</span>`
        : fews == null
          ? '<span class="tag">No FEWS coverage</span>'
          : '<span class="tag warn">n/a</span>';
      return `
        <tr>
          <td><strong>${c.country}</strong></td>
          <td>${ipc ? `${formatNum((ipc.phase3plus_pct || 0) * 100, 1)}%` : "n/a"}</td>
          <td>${ipc ? projectedTag : "n/a"}</td>
          <td>${ipc ? (ipc.phase3plus_number || 0).toLocaleString() : "n/a"}</td>
          <td>${ipc ? ((ipc.phase4_number || 0) + (ipc.phase5_number || 0)).toLocaleString() : "n/a"}</td>
          <td>${ipc ? `<span class="tag ${levelClass}">${(ipc.ipc_crisis_level || "n/a").toUpperCase()}</span>` : "n/a"}</td>
          <td>${ipc ? `${ipc.analysis_date || "n/a"}${ipcStaleTag}` : "n/a"}</td>
          <td>${ipc ? (ipc.projection_date || "n/a") : "n/a"}</td>
          <td>${fewsCSCell}</td>
          <td>${fewsML1Cell}</td>
        </tr>
      `;
    })
    .join("");

  renderRecommendationList(
    els.foodSecurityRecommendations,
    aiRecommendations?.byIssue?.foodSecurity,
    "No food-security recommendations can be generated from the current refresh."
  );

  if (els.foodSecurityFeed) {
    const signals = dashboardState.food_security_signals || [];
    const countries = dashboardState.countries || [];
    const focusCountries = [...countries]
      .filter((c) => (c.food_security_signal_count || 0) > 0)
      .sort((a, b) => {
        const aScore = ((a.food_security_signal_count || 0) * 3) + ((a.ipc?.phase3plus_pct || 0) * 10) + (a.report_count_30d || 0);
        const bScore = ((b.food_security_signal_count || 0) * 3) + ((b.ipc?.phase3plus_pct || 0) * 10) + (b.report_count_30d || 0);
        return bScore - aScore;
      })
      .slice(0, 5);

    if (!focusCountries.length) {
      els.foodSecurityFeed.innerHTML = "No food security reporting items matched verified source criteria in the current 30-day window.";
    } else {
      els.foodSecurityFeed.innerHTML = focusCountries.map((country) => {
        const countrySignals = signals
          .filter((item) => (item.countries || []).includes(country.iso3) && isApprovedVisibleEventSource(item.source || ""))
          .slice(0, 3);
        const ipcLabel = country.ipc?.phase3plus_pct != null
          ? `IPC P3+ ${formatNum((country.ipc.phase3plus_pct || 0) * 100, 1)}%`
          : "No IPC";
        const ipcClass = (country.ipc?.phase3plus_pct || 0) >= 0.3 ? "bad" : (country.ipc?.phase3plus_pct || 0) >= 0.2 ? "warn" : "good";
        const signalMarkup = countrySignals.length
          ? countrySignals.map((item) => `
              <div class="feed-item conflict-feed-item">
                <div class="conflict-feed-header">
                  <a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled report"}</a>
                  <div class="signal-chip-row">
                    ${(item.signal_tags || []).map((tag) => `<span class="signal-chip ${tag.toLowerCase().replace(/\s+/g, "-")}">${tag}</span>`).join("")}
                  </div>
                </div>
                <div class="feed-meta-row">${renderSourceTrustBadge(item.source || "ReliefWeb")}<span>${item.source || "ReliefWeb"} | <span title="${item.date_label || "n/a"}">${formatDateTime(item.date_label)}</span></span></div>
                <div class="signal-summary">${summarizeSourceExcerpt(item.summary || item.content || "", SOURCE_EXCERPT_MAX_CHARS)}</div>
              </div>
            `).join("")
          : '<div class="feed-item conflict-feed-item"><div>No linked food security source item was detected for this country in the current refresh.</div></div>';
        return `
          <div class="conflict-country-block">
            <div class="conflict-country-header">
              <strong>${country.country}</strong>
              <span class="tag ${ipcClass}">${ipcLabel}</span>
            </div>
            ${signalMarkup}
          </div>
        `;
      }).join("");
    }
  }
}

function rotateToNextPage() {
  const current = activePageId();
  const idx = PAGE_ORDER.indexOf(current);
  const next = PAGE_ORDER[(idx + 1) % PAGE_ORDER.length];
  setActivePage(next);

  const countries = dashboardState.countries || [];
  const topCountries = countries.slice(0, 5);
  if (topCountries.length > 0) {
    rotatingCountryIndex = (rotatingCountryIndex + 1) % topCountries.length;
    const nextCountryIso = topCountries[rotatingCountryIndex].iso3;
    els.countrySelect.value = nextCountryIso;
    renderTrend(nextCountryIso);
    renderSummary(nextCountryIso);
    renderForecast(nextCountryIso);
  }
}

function confidenceFromPoints(values) {
  const points = values?.[0]?.based_on_points ?? 0;
  if (points >= 6) {
    return { label: "Higher confidence", className: "good" };
  }
  if (points >= 4) {
    return { label: "Moderate confidence", className: "warn" };
  }
  return { label: "Low confidence", className: "bad" };
}

function backtestTag(backtest) {
  if (!backtest || backtest.mape_pct == null) {
    return { className: "warn", label: "Insufficient" };
  }
  if (backtest.mape_pct <= 10) {
    return { className: "good", label: "Tracked" };
  }
  if (backtest.mape_pct <= 20) {
    return { className: "warn", label: "Watch" };
  }
  return { className: "bad", label: "Weak fit" };
}

function setAutoStatus(text) {
  if (els.autoStatus) {
    els.autoStatus.textContent = text;
  }
}

function stopAutoRotate(reason = "") {
  if (!autoRotateEnabled && !autoRotateTimer) {
    return;
  }
  autoRotateEnabled = false;
  clearTimeout(autoRotateTimer);
  autoRotateTimer = null;
  els.autoRotateBtn.textContent = t("startAutoDisplay");
  setAutoStatus(reason ? t("autoDisplayPaused", { reason }) : t("autoDisplayOff"));
}

function rotateDelayForPage(pageId) {
  const baseInterval = Number(els.rotateIntervalSelect?.value || 20000);
  const multiplier = PAGE_ROTATION_MULTIPLIER[pageId] || 1;
  return Math.round(baseInterval * multiplier);
}

function queueNextAutoRotate() {
  if (!autoRotateEnabled) {
    return;
  }
  const pageId = activePageId();
  const delay = rotateDelayForPage(pageId);
  autoRotateTimer = setTimeout(() => {
    autoRotateTimer = null;
    try {
      rotateToNextPage();
    } catch (err) {
      console.error("Auto-rotate page render failed", err);
    }
    if (autoRotateEnabled) {
      queueNextAutoRotate();
    }
  }, delay);
}

function startAutoRotate() {
  if (autoRotateTimer) {
    clearTimeout(autoRotateTimer);
    autoRotateTimer = null;
  }
  autoRotateEnabled = true;
  queueNextAutoRotate();
  const interval = Number(els.rotateIntervalSelect?.value || 20000);
  els.autoRotateBtn.textContent = t("stopAutoDisplay");
  setAutoStatus(t("autoDisplayOn", { seconds: Math.round(interval / 1000) }));
}

function setCurrentDate() {
  const now = new Date();
  const opts = { weekday: "short", year: "numeric", month: "short", day: "numeric" };
  const locale = currentLanguage === "fr" ? "fr-FR" : "en-GB";
  els.currentDate.textContent = `${t("datePrefix")}: ${now.toLocaleDateString(locale, opts)}`;
}

function buildBandLegend() {
  els.bandLegend.innerHTML = RISK_BANDS.map((b) => `<div class="band-item" style="background:${b.color}">${(b.labels && b.labels[currentLanguage]) || (b.labels && b.labels.en) || ""}</div>`).join("");
}

function getFloodContext() {
  const countries = dashboardState.countries || [];
  const hazards = dashboardState.hazards || [];
  const reportFallbackFloodSignals = (dashboardState.reports || [])
    .filter((r) => {
      const txt = `${r.title || ""} ${r.summary || ""} ${r.content || ""}`;
      return /\bflood\b|flooding|flash\s+flood|inundation|overflow|heavy\s+rain/i.test(txt);
    })
    .map((r) => ({
      title: r.title || "Untitled flood update",
      summary: r.summary || null,
      pubDate: r.created || null,
      link: r.url || null,
      source: r.source || "ReliefWeb RSS",
      countries: r.countries || [],
      hazard_type: "Flood",
      linkage_scope: (r.countries || []).length ? "fcv-linked" : "afro-regional"
    }));

  const regionalFloodSignals = (dashboardState.regional_flood_signals && dashboardState.regional_flood_signals.length)
    ? dashboardState.regional_flood_signals
    : reportFallbackFloodSignals;

  const gdacsFloodEvents = hazards.filter((h) => (h.hazard_type === "Flood") || /\bflood\b|flooding|flash\s+flood|inundation|overflow/i.test(`${h.title || ""} ${h.summary || ""}`));
  const floodEvents = [...gdacsFloodEvents, ...regionalFloodSignals].filter((item, index, arr) => {
    const key = `${item.link || ""}|${item.title || ""}`;
    return arr.findIndex((x) => `${x.link || ""}|${x.title || ""}` === key) === index;
  });

  const afroContextRegex = /africa|mozambique|kenya|malawi|zambia|zimbabwe|tanzania|somalia|ethiopia|uganda|madagascar|rwanda|burundi|south\s+sudan|democratic\s+republic\s+of\s+the\s+congo|\bdrc\b|congo|cameroon|chad|niger|nigeria|ghana|mali|burkina|senegal|sudan|angola|namibia|botswana|south\s+africa|eritrea|djibouti|central\s+african|caf|togo|benin|guinea|sierra\s+leone|liberia|lesotho|eswatini|comoros|mauritius|seychelles/i;
  const afroFloodEvents = floodEvents.filter((item) => {
    if ((item.countries || []).length > 0) {
      return true;
    }
    const txt = `${item.title || ""} ${item.summary || ""}`;
    return afroContextRegex.test(txt);
  });

  const mappedFloodEvents = afroFloodEvents.filter((x) => (x.countries || []).length > 0);
  const unmappedFloodEvents = afroFloodEvents.filter((x) => (x.countries || []).length === 0);
  const topFloodCountries = [...countries]
    .filter((c) => (c.flood_count || 0) > 0)
    .sort((a, b) => ((b.flood_count || 0) - (a.flood_count || 0)) || (b.risk_score - a.risk_score))
    .slice(0, 6);

  const highestFlood = topFloodCountries[0] || null;
  const totalFloodSignals = topFloodCountries.reduce((sum, c) => sum + (c.flood_count || 0), 0);
  const overlapCountries = topFloodCountries.filter((c) => (c.ipc?.phase3plus_pct || 0) >= 0.2);
  const severityLabel = !highestFlood || (highestFlood.flood_count || 0) === 0
    ? "No active flood pressure"
    : (highestFlood.flood_count || 0) >= 3
      ? "High flood pressure"
      : (highestFlood.flood_count || 0) >= 2
        ? "Elevated flood pressure"
        : "Watch flood pressure";

  return {
    countries,
    hazards,
    afroFloodEvents,
    mappedFloodEvents,
    unmappedFloodEvents,
    topFloodCountries,
    highestFlood,
    totalFloodSignals,
    overlapCountries,
    severityLabel
  };
}

function mappedCycloneSignalIso3Set() {
  const set = new Set();
  (dashboardState?.countries || []).forEach((country) => {
    if ((country.cyclone_count || 0) > 0) {
      set.add(country.iso3);
    }
  });
  (dashboardState?.cyclone_intelligence?.projection_signals || []).forEach((signal) => {
    (signal?.countries || []).forEach((iso3) => {
      if (iso3) {
        set.add(iso3);
      }
    });
  });
  return set;
}

function buildMetrics() {
  const countries = dashboardState.countries || [];
  const floodCtx = getFloodContext();
  const ledgerMetrics = dashboardState.metric_ledger?.metrics || {};
  const ensoAdvisory = dashboardState.enso_advisory || null;
  const serviceDeliveryStatus = dashboardState.service_delivery_status || null;
  const serviceDeliveryRows = dashboardState.service_delivery_by_country || [];
  const serviceDeliverySummary = serviceDeliverySummaryParts(serviceDeliveryRows, serviceDeliveryStatus);
  const highRisk = Number(ledgerMetrics.priority_escalation_countries?.count ?? countries.filter((c) => c.risk_score >= 65).length);
  const maxRisk = countries.reduce((max, c) => Math.max(max, Number(c.risk_score || 0)), 0);
  const ipcCrisis = countries.filter((c) => (c.ipc?.phase3plus_pct || 0) >= 0.3).length;
  const conflictDisplacementCountries = countries.filter((c) => (c.conflict_signal_count || 0) > 0 || (c.displacement_signal_count || 0) > 0).length;
  const hazardCountries = countries.filter((c) => c.hazard_count > 0).length;
  const cycloneActiveCountries = Number(ledgerMetrics.cyclone_active_countries?.count ?? mappedCycloneSignalIso3Set().size);
  const droughtActiveCountries = Number(ledgerMetrics.drought_active_countries?.count ?? countries.filter((c) => (c.drought_signal_count || 0) > 0).length);
  const foodSecurityCoverage = countries.filter((c) => c.ipc != null || c.fews_ipc != null).length;
  const ensoStatusLabel = ensoAdvisory?.alert_status || "No ENSO watch loaded";
  const ensoStatusShort = ensoStatusLabel.length > 18 ? ensoStatusLabel.slice(0, 16).trim() + "…" : ensoStatusLabel;
  const ensoOutlook = deriveEnsoOutlookSummary(ensoAdvisory);
  const ensoNote = ensoAdvisory
    ? `${ensoOutlook} Issued ${ensoAdvisory.issued_on || "n/a"}${ensoAdvisory.next_update ? ` | Next update ${ensoAdvisory.next_update}` : ""}`
    : "CPC ENSO advisory not available in this refresh";

  const cards = [
    { title: "Priority Escalation Countries", value: highRisk, note: `Humanitarian risk score >= 65 (current max: ${maxRisk})` },
    { title: "IPC Crisis Countries", value: ipcCrisis, note: "IPC Phase 3+ >= 30%" },
    { title: "Conflict/Displacement Active", value: conflictDisplacementCountries, note: "Source-linked pressure signals" },
    { title: "Countries With Active Hazards", value: hazardCountries, note: "GDACS-linked hazard events" },
    { title: "Cyclone-Active Countries", value: cycloneActiveCountries, note: "Mapped cyclone event or advisory signals" },
    {
      title: "ENSO Climate Watch",
      value: ensoAdvisory ? ensoStatusShort : "n/a",
      note: ensoNote,
      actionLabel: "Open forecast",
      action: "open-forecast"
    },
    { title: "Drought-Active Countries", value: droughtActiveCountries, note: "Mapped drought source signals" },
    { title: "Regional Flood Updates", value: floodCtx.afroFloodEvents.length, note: `Mapped AFRO countries: ${floodCtx.topFloodCountries.length}` },
    {
      title: "FCV Service Delivery Feed",
      value: serviceDeliveryStatus ? `${serviceDeliveryStatus.country_count}/${countries.length}` : "0",
      note: serviceDeliveryStatus
        ? `${serviceDeliverySummary.cardNote}. Latest feed month: ${serviceDeliveryStatus.latest_month || "n/a"}`
        : "No FCV service-delivery feed loaded",
      actionLabel: serviceDeliveryStatus ? "Open snapshot" : null,
      action: serviceDeliveryStatus ? "open-service-delivery" : null
    },
    { title: "Food Security Coverage", value: `${foodSecurityCoverage}/${countries.length}`, note: "IPC and/or FEWS coverage" },
    {
      title: "ICPAC Forecast Bulletins",
      value: (dashboardState.forecasts || []).length,
      note: "Weekly, monthly, and seasonal products"
    }
  ];

  els.metricGrid.innerHTML = cards
    .map(
      (c) => `
      <article class="metric-card">
        <h3>${c.title}</h3>
        <div class="metric-value">${c.value}</div>
        <div class="metric-note">${c.note}</div>
        ${c.actionLabel ? `<button class="metric-action-btn" type="button" data-action="${c.action}">${c.actionLabel}</button>` : ""}
      </article>
    `
    )
    .join("");
}

function renderDataValidationPanel() {
  if (!els.dataValidationSummary) {
    return;
  }

  const ledger = dashboardState?.metric_ledger;
  const metrics = ledger?.metrics || {};
  const priority = metrics.priority_escalation_countries || { count: 0, countries: [] };
  const cyclone = metrics.cyclone_active_countries || { count: 0, countries: [], source_summary: {} };
  const drought = metrics.drought_active_countries || { count: 0, countries: [], source_summary: {} };

  const topList = (rows = [], selector = (row) => row.country, maxItems = 4) => {
    const list = (rows || []).slice(0, maxItems).map(selector).filter(Boolean);
    return list.length ? list.join(", ") : "none";
  };

  const priorityTop = topList(priority.countries, (row) => `${row.country} (${row.risk_score})`);
  const cycloneTop = topList(cyclone.countries, (row) => `${row.country} (events ${row.cyclone_event_count || 0}, advisories ${row.projection_signal_count || 0})`);
  const droughtTop = topList(drought.countries, (row) => `${row.country} (country ${row.drought_country_signal_count || 0}, source ${row.drought_source_item_count || 0})`);
  const apiPath = "/api/metric-ledger";
  const ruleVersion = ledger?.rule_version || "metric-ledger-v1";

  els.dataValidationSummary.innerHTML = `
    <div class="data-validation-grid">
      <article class="data-validation-card">
        <h3>Priority Escalation</h3>
        <p class="data-validation-count">${Number(priority.count || 0)}</p>
        <p class="data-validation-note">Rule: risk score >= 65.</p>
      </article>
      <article class="data-validation-card">
        <h3>Cyclone-Active Countries</h3>
        <p class="data-validation-count">${Number(cyclone.count || 0)}</p>
        <p class="data-validation-note">Rule: mapped cyclone events or mapped cyclone advisories.</p>
      </article>
      <article class="data-validation-card">
        <h3>Drought-Active Countries</h3>
        <p class="data-validation-count">${Number(drought.count || 0)}</p>
        <p class="data-validation-note">Rule: mapped drought country counters or mapped drought source signals.</p>
      </article>
    </div>
    <p><strong>Priority evidence:</strong> ${priorityTop}</p>
    <p><strong>Cyclone evidence:</strong> ${cycloneTop}</p>
    <p><strong>Drought evidence:</strong> ${droughtTop}</p>
    <ul class="data-validation-list">
      <li><strong>Cyclone source summary:</strong> ${Number(cyclone.source_summary?.cyclone_projection_signals_total || 0)} advisory items; ${Number(cyclone.source_summary?.cyclone_projection_signals_with_country_mapping || 0)} with explicit country mapping; ${Number(cyclone.source_summary?.gdacs_or_country_cyclone_event_countries || 0)} countries with cyclone-event counters.</li>
      <li><strong>Drought source summary:</strong> ${Number(drought.source_summary?.drought_signals_total || 0)} drought items; ${Number(drought.source_summary?.drought_signals_with_country_mapping || 0)} with explicit country mapping; ${Number(drought.source_summary?.country_drought_counter_positive || 0)} countries with drought counters.</li>
    </ul>
    <p class="data-validation-footnote">Verification endpoint: ${apiPath}. Rule version: ${ruleVersion}. Refresh dashboard data first to update ledger values.</p>
  `;
}

function renderConfidenceLegend() {
  if (!els.confidenceLegend) {
    return;
  }

  const reliefStatus = String(dashboardState?.reliefweb_api_status?.overall || "unknown").toLowerCase();
  const cycloneAvailable = Number(dashboardState?.cyclone_source_status?.available_count || 0);
  const cycloneChecked = Number(dashboardState?.cyclone_source_status?.checked_count || 0);
  const whoDonStatus = String(dashboardState?.who_don_source_status?.overall || "unknown").toLowerCase();
  const cemsFloodStatus = dashboardState?.cems_flood_source_status || {};
  const cemsOverall = String(cemsFloodStatus.overall || "unknown").toLowerCase();
  const cemsAutomationLimited = !!cemsFloodStatus.live_portal_requires_login;

  let overall = "Moderate";
  if (reliefStatus === "active" && cycloneChecked > 0 && cycloneAvailable === cycloneChecked && (whoDonStatus === "available" || whoDonStatus === "fallback") && (cemsOverall === "available" || cemsOverall === "partial")) {
    overall = "High";
  } else if (reliefStatus === "error" || (cycloneChecked > 0 && cycloneAvailable === 0) || cemsOverall === "error") {
    overall = "Low";
  }

  const cemsNote = cemsOverall === "partial" && cemsAutomationLimited
    ? " Copernicus flood documentation is reachable, but live portal access remains credentialed."
    : cemsOverall === "available"
      ? " Copernicus flood public access pathways are documented in this refresh."
      : cemsOverall === "error"
        ? " Copernicus flood source posture could not be verified in this refresh."
        : "";

  els.confidenceLegend.textContent = `Confidence legend: High = multiple verified current + projection sources active; Moderate = partial source availability; Low = major source outage or fallback-only evidence. Current dashboard confidence: ${overall}.${cemsNote}`;
}

function renderBriefingStrip() {
  const countries = dashboardState.countries || [];
  const ensoAdvisory = dashboardState.enso_advisory || null;
  const top = countries[0];
  const crisisCountries = countries.filter((c) => c.ipc && c.ipc.phase3plus_pct >= 0.30).length;
  const ipcLoaded = countries.filter((c) => c.ipc != null).length;
  const ipcVeryStaleList = staleIpcEntries(countries);
  const ipcVeryStaleCount = ipcVeryStaleList.length;
  const stripStaleVisibleCount = window.innerWidth <= 980 ? 2 : window.innerWidth <= 1280 ? 3 : 4;
  const alertCount = (dashboardState.top_alerts || []).length;
  const refreshLabel = formatDateTime(dashboardState.generated_at);
  const ensoRisk = String(ensoAdvisory?.risk_level || "info").toLowerCase();
  const ensoCardClass = ensoRisk === "high"
    ? "strip-card strip-card-bad"
    : ensoRisk === "watch"
      ? "strip-card strip-card-warn"
      : "strip-card strip-card-ok";
  const ensoStatusLabel = ensoAdvisory?.alert_status || "No ENSO watch loaded";
  const ensoOutlook = deriveEnsoOutlookSummary(ensoAdvisory);
  const ensoStatusNote = ensoAdvisory
    ? `${ensoOutlook} Issued ${ensoAdvisory.issued_on || "n/a"}${ensoAdvisory.next_update ? ` | Next ${ensoAdvisory.next_update}` : ""}`
    : "CPC ENSO advisory not available in this refresh";
  const acapsStatus = dashboardState.acaps_source_status || {};
  const acapsWarning = acapsStatus.pagination_warning || null;
  const conflictStatus = dashboardState.conflict_displacement_source_status || {};
  const matchedBySource = conflictStatus.matched_signal_items || {};
  const acapsPagesLabel = acapsStatus.pages_scanned != null
    ? `${acapsStatus.pages_scanned}/${acapsStatus.pages_cap || "?"}`
    : "n/a";
  const acapsMode = String(acapsStatus.crawl_mode || "deep").toLowerCase();
  const acapsModeLabel = acapsMode === "fast" ? "FAST" : "DEEP";
  const acapsCardClass = acapsWarning ? "strip-card strip-card-warn" : "strip-card strip-card-ok";
  const acapsCardTitle = acapsWarning ? "ACAPS Crawl Warning" : "ACAPS Crawl Status";
  const acapsCardValue = acapsWarning ? "Warning" : acapsPagesLabel;
  const acapsModeTooltip = "FAST prioritizes briefing speed with reduced crawl depth; DEEP prioritizes source coverage with deeper crawl depth.";
  const acapsCapStreak = acapsStatus.pagination_cap_reached_streak != null ? Number(acapsStatus.pagination_cap_reached_streak) : null;
  const acapsStreakLabel = acapsCapStreak != null && acapsCapStreak > 0 ? `cap hit ${acapsCapStreak} consecutive refresh${acapsCapStreak === 1 ? "" : "es"}` : null;
  const acapsCardNote = acapsWarning
    ? `mode ${acapsModeLabel} | pages ${acapsPagesLabel} | ${acapsStreakLabel || acapsWarning}`
    : `mode ${acapsModeLabel} | pages ${acapsPagesLabel} | ${acapsStatus.pagination_stopped_reason || "n/a"}`;
  const unhcrFallbackOnly = Number(matchedBySource["unhcr total"] || 0) > 0 && Number(matchedBySource["unhcr rss"] || 0) === 0;
  const qualitySignals = [];
  const qualitySignalsFull = [];
  if (ipcVeryStaleCount > 0) {
    const stripStaleList = formatStaleIpcList(ipcVeryStaleList, {
      labelMode: "iso3",
      maxItems: stripStaleVisibleCount,
      moreFormat: "compact",
      includeAge: true
    });
    const stripStaleFullList = formatStaleIpcList(ipcVeryStaleList, {
      labelMode: "iso3",
      maxItems: ipcVeryStaleList.length,
      moreFormat: "compact",
      includeAge: true
    });
    qualitySignals.push(`${ipcVeryStaleCount} very stale IPC: ${stripStaleList}`);
    qualitySignalsFull.push(`${ipcVeryStaleCount} very stale IPC: ${stripStaleFullList}`);
  }
  if (acapsWarning) {
    qualitySignals.push("ACAPS cap pressure");
    qualitySignalsFull.push("ACAPS cap pressure");
  }
  if (unhcrFallbackOnly) {
    qualitySignals.push("UNHCR fallback-only");
    qualitySignalsFull.push("UNHCR fallback-only");
  }
  const qualitySeverity = qualitySignals.length >= 2 ? "bad" : qualitySignals.length === 1 ? "warn" : "ok";
  const qualityCardClass = qualitySeverity === "bad"
    ? "strip-card strip-card-bad"
    : qualitySeverity === "warn"
      ? "strip-card strip-card-warn"
      : "strip-card strip-card-ok";
  const qualityLabel = qualitySeverity === "bad" ? "Action needed" : qualitySeverity === "warn" ? "Monitor" : "Good";
  const qualityNote = qualitySignals.length
    ? qualitySignals.join(" | ")
    : "No major data quality flags in this refresh.";
  const qualityNoteFull = qualitySignalsFull.length
    ? qualitySignalsFull.join(" | ")
    : qualityNote;
  const qualityLegendMarkup = ipcVeryStaleCount > 0
    ? '<div id="briefingStripDataQualityLegend" class="strip-note strip-note-legend">m = months since latest IPC analysis.</div>'
    : "";

  els.briefingStrip.innerHTML = `
    <article class="strip-card">
      <h3>Current Highest Risk</h3>
      <p>${top ? `${top.country} (${top.risk_score})` : "n/a"}</p>
    </article>
    <article class="strip-card">
      <h3>IPC Crisis Countries</h3>
      <p>${crisisCountries}</p>
    </article>
    <article class="strip-card">
      <h3>IPC Coverage</h3>
      <p>${ipcLoaded} / ${dashboardState.scope.country_count}</p>
    </article>
    <article class="strip-card">
      <h3>Top Alerts Active</h3>
      <p>${alertCount}</p>
    </article>
    <article class="${ensoCardClass}">
      <h3>ENSO Watch</h3>
      <p title="${ensoStatusLabel}">${ensoStatusLabel}</p>
      <div class="strip-note">${ensoStatusNote}</div>
    </article>
    <article class="${qualityCardClass}">
      <h3>Data Quality</h3>
      <p title="${qualityNoteFull}" aria-describedby="briefingStripDataQualityNote${ipcVeryStaleCount > 0 ? ' briefingStripDataQualityLegend' : ''}">${qualityLabel}</p>
      <div id="briefingStripDataQualityNote" class="strip-note" title="${qualityNoteFull}">${qualityNote}</div>
      ${qualityLegendMarkup}
    </article>
    <article class="strip-card">
      <h3>Last Refresh</h3>
      <p title="${dashboardState.generated_at || "n/a"}">${refreshLabel}</p>
    </article>
    <article class="strip-card">
      <h3>ACAPS Crawl Mode <span class="strip-info-badge" tabindex="0" role="note" aria-label="ACAPS mode guidance" title="${acapsModeTooltip}" data-toast-message="${acapsModeTooltip}">i</span></h3>
      <p title="${acapsModeTooltip}">${acapsModeLabel}</p>
      <div class="strip-note">Use FAST for low-latency briefings; DEEP for higher coverage.</div>
    </article>
    <article class="${acapsCardClass}">
      <h3>${acapsCardTitle}</h3>
      <p title="${acapsModeTooltip} ${acapsCardNote}">${acapsCardValue}${acapsCapStreak != null && acapsCapStreak > 0 && acapsWarning ? ` <span class="strip-cap-streak-badge" title="Cap hit ${acapsCapStreak} consecutive refresh${acapsCapStreak === 1 ? '' : 'es'}">${acapsCapStreak}&times;</span>` : ""}</p>
      <div class="strip-note">${acapsCardNote}</div>
    </article>
  `;
}

function burdenTag(value, mediumThreshold, highThreshold) {
  if (value == null || Number.isNaN(value)) {
    return { className: "warn", label: "Data gap" };
  }
  if (value >= highThreshold) {
    return { className: "bad", label: "High" };
  }
  if (value >= mediumThreshold) {
    return { className: "warn", label: "Elevated" };
  }
  return { className: "good", label: "Lower" };
}

function renderOverviewInsights() {
  if (!els.overviewInsightBox) {
    return;
  }

  const floodCtx = getFloodContext();
  const countries = floodCtx.countries;
  const forecasts = dashboardState.forecasts || [];
  const highestIpc = [...countries]
    .filter((c) => c.ipc?.phase3plus_pct != null)
    .sort((a, b) => b.ipc.phase3plus_pct - a.ipc.phase3plus_pct)[0];
  const highestConflictDisplacement = [...countries]
    .sort((a, b) => (((b.conflict_signal_count || 0) + (b.displacement_signal_count || 0)) - ((a.conflict_signal_count || 0) + (a.displacement_signal_count || 0))) || (b.risk_score - a.risk_score))[0];
  const highestHazard = [...countries]
    .sort((a, b) => ((b.hazard_count || 0) - (a.hazard_count || 0) || (b.risk_score - a.risk_score)))[0];
  const highestFlood = floodCtx.highestFlood;
  const highestCyclone = [...countries]
    .sort((a, b) => ((b.cyclone_count || 0) - (a.cyclone_count || 0) || (b.risk_score - a.risk_score)))[0];
  const hazards = dashboardState.hazards || [];
  const ensoAdvisory = dashboardState.enso_advisory || null;
  const overviewRegionalFloodSignals = floodCtx.afroFloodEvents;
  const cycloneMappedIso3 = mappedCycloneSignalIso3Set();
  const cycloneCountries = countries
    .filter((c) => cycloneMappedIso3.has(c.iso3))
    .sort((a, b) => (b.cyclone_count - a.cyclone_count) || (b.risk_score - a.risk_score));
  const droughtCountries = countries.filter((c) => (c.drought_signal_count || 0) > 0);
  const cycloneText = cycloneCountries.length
    ? `${cycloneCountries.slice(0, 3).map((c) => `${c.country} (${c.cyclone_count})`).join(", ")}.`
    : "No current cyclone-linked public signal is present in the latest loaded window.";
  const ensoText = ensoAdvisory?.alert_status
    ? `${ensoAdvisory.alert_status}${ensoAdvisory.issued_on ? ` | Issued ${ensoAdvisory.issued_on}` : ""}${ensoAdvisory.next_update ? ` | Next ${ensoAdvisory.next_update}` : ""}`
    : "No ENSO watch or advisory was available in the latest CPC refresh.";
  const ensoOutlook = deriveEnsoOutlookSummary(ensoAdvisory);

  const hazardCountBy = (pattern) => hazards.filter((h) => pattern.test(`${h.hazard_type || ""} ${h.title || ""}`)).length;
  const hazardWatch = [
    { label: "Cyclone", value: cycloneCountries.length, className: cycloneCountries.length ? "bad" : "good" },
    { label: "Flood", value: overviewRegionalFloodSignals.length, className: overviewRegionalFloodSignals.length ? "warn" : "good" },
    { label: "Drought", value: droughtCountries.length, className: droughtCountries.length ? "warn" : "good" },
    { label: "Heat", value: hazardCountBy(/heat|temperature/i), className: hazardCountBy(/heat|temperature/i) ? "warn" : "good" }
  ];

  const latestForecasts = ["weekly", "monthly", "seasonal"]
    .map((horizon) => forecasts.find((f) => f.horizon === horizon))
    .filter(Boolean);

  els.overviewInsightBox.innerHTML = `
    <div class="overview-snapshot-grid">
      <div class="overview-snapshot-item">
        <div class="overview-snapshot-label">Highest IPC Phase 3+</div>
        <div class="overview-snapshot-value">${highestIpc ? `${highestIpc.country} ${formatNum(highestIpc.ipc.phase3plus_pct * 100, 1)}%` : "n/a"}</div>
        <div><span class="tag ${highestIpc?.ipc?.ipc_crisis_level === "crisis" ? "bad" : highestIpc?.ipc?.ipc_crisis_level === "stress" ? "warn" : "good"}">${highestIpc ? highestIpc.ipc.ipc_crisis_level.toUpperCase() : "No IPC"}</span></div>
      </div>
      <div class="overview-snapshot-item">
        <div class="overview-snapshot-label">Top Conflict/Displacement Pressure</div>
        <div class="overview-snapshot-value">${highestConflictDisplacement ? `${highestConflictDisplacement.country} ${((highestConflictDisplacement.conflict_signal_count || 0) + (highestConflictDisplacement.displacement_signal_count || 0))}` : "n/a"}</div>
        <div><span class="tag ${(highestConflictDisplacement && ((highestConflictDisplacement.conflict_signal_count || 0) + (highestConflictDisplacement.displacement_signal_count || 0)) >= 3) ? "bad" : "warn"}">Signals</span></div>
      </div>
      <div class="overview-snapshot-item">
        <div class="overview-snapshot-label">Top Multi-Hazard Country</div>
        <div class="overview-snapshot-value">${highestHazard ? `${highestHazard.country} ${highestHazard.hazard_count || 0}` : "n/a"}</div>
        <div><span class="tag ${(highestHazard?.hazard_count || 0) >= 2 ? "bad" : (highestHazard?.hazard_count || 0) >= 1 ? "warn" : "good"}">Hazards</span></div>
      </div>
      <div class="overview-snapshot-item">
        <div class="overview-snapshot-label">Top Flood Exposure</div>
        <div class="overview-snapshot-value">${highestFlood ? `${highestFlood.country} ${highestFlood.flood_count || 0}` : "n/a"}</div>
        <div><span class="tag ${(highestFlood?.flood_count || 0) >= 1 ? "warn" : "good"}">Flood</span></div>
      </div>
    </div>
    <div class="overview-hazard-watch">
      ${hazardWatch.map((item) => `<div class="hazard-watch-pill ${item.className}"><span>${item.label}:</span><strong> ${item.value}</strong></div>`).join("")}
    </div>
    <div class="overview-forecast-box">
      <div class="overview-snapshot-label">Forecast Watch</div>
      ${latestForecasts.length
        ? latestForecasts.map((item) => `<p><strong>${item.horizon}:</strong> ${item.title}</p>`).join("")
        : "<p>No ICPAC forecast products are currently available.</p>"}
      <p><strong>ENSO:</strong> ${ensoText}</p>
    </div>
    <p><strong>Cyclone watch:</strong> ${cycloneText}</p>
    <p><strong>ENSO watch:</strong> ${ensoText}</p>
    <p><strong>ENSO outlook:</strong> ${ensoOutlook}</p>
    <p><strong>Flood watch:</strong> ${overviewRegionalFloodSignals.length
      ? `${overviewRegionalFloodSignals.length} regional flood update(s) detected in the current window${highestFlood && (highestFlood.flood_count || 0) > 0 ? `; highest mapped AFRO country is ${highestFlood.country} (${highestFlood.flood_count || 0}).` : "; no AFRO country mapping in this refresh."}`
      : "No regional flood update is visible in this refresh window."}</p>
    <p><span class="tag warn">Interpretation</span> This dashboard is event-first: food security, conflict-displacement, and hazard pressure are primary decision drivers; nutrition remains a supporting burden layer.</p>
    <p><span class="tag good">Africa grouping</span> Countries are grouped as FCV Prioritized, FCV Accelerated, AFRO, then Other Africa for operational review.</p>
  `;
}

function buildCountryLabelsTrace(countries, fontSize) {
  const lats = [], lons = [], labels = [];
  countries.forEach((c) => {
    const coords = COUNTRY_CENTROIDS[c.iso3];
    if (coords) {
      lats.push(coords[0]);
      lons.push(coords[1]);
      labels.push(COUNTRY_SHORT_LABELS[c.iso3] || c.iso3);
    }
  });
  return {
    type: "scattergeo",
    lat: lats,
    lon: lons,
    text: labels,
    mode: "text",
    textfont: { size: fontSize || 8, color: "#222", family: "Inter, sans-serif" },
    textposition: "middle center",
    showlegend: false,
    hoverinfo: "skip"
  };
}

function getMapGeoLayout() {
  return {
    scope: "world",
    projection: { type: "natural earth", rotation: { lon: 20, lat: 0 } },
    center: { lon: 20, lat: 0 },
    lonaxis: { range: [-30, 60] },
    lataxis: { range: [-40, 42] },
    showland: true,
    landcolor: "#e8e8e8",
    showocean: true,
    oceancolor: "#d4eaf7",
    showcountries: true,
    countrycolor: "#cccccc",
    showframe: false,
    showcoastlines: true,
    coastlinecolor: "#999999",
    bgcolor: "rgba(0,0,0,0)"
  };
}

function openFullscreenMap() {
  if (!dashboardState) return;
  const countries = dashboardState.countries || [];
  const overlay = document.createElement("div");
  overlay.className = "map-fullscreen-overlay";
  overlay.innerHTML = '<div class="map-fullscreen-inner"><button class="map-fs-close" title="Close">&times;</button><div id="mapChartFS" style="width:100%;height:100%;border-radius:12px;"></div></div>';
  document.body.appendChild(overlay);

  const closeOverlay = () => { overlay.remove(); };
  overlay.querySelector(".map-fs-close").addEventListener("click", (e) => { e.stopPropagation(); closeOverlay(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") { closeOverlay(); document.removeEventListener("keydown", escHandler); }
  });

  const fsLabels = buildCountryLabelsTrace(countries, 11);
  const geo = getMapGeoLayout();

  let traces;
  if (mapMode === "ipc") {
    const IPC_CS = [
      [0,"#ffffff"],[0.10,"#c8e6f5"],[0.10,"#ffe57f"],[0.20,"#ffe57f"],
      [0.20,"#e67e22"],[0.35,"#e67e22"],[0.35,"#c0392b"],[0.60,"#c0392b"],
      [0.60,"#7b0000"],[1,"#7b0000"]
    ];
    const vals = countries.map((c) => (c.ipc ? c.ipc.phase3plus_pct * 100 : null));
    const hoverText = countries.map((c) =>
      c.ipc
        ? `${c.country}<br>IPC Phase 3+: ${(c.ipc.phase3plus_pct * 100).toFixed(1)}%`
        : `${c.country}<br>IPC data not available`
    );
    traces = [{
      type: "choropleth", locationmode: "ISO-3",
      locations: countries.map((c) => c.iso3),
      z: vals.map((v) => (v !== null ? v : -1)),
      zmin: 0, zmax: 60,
      text: hoverText, hovertemplate: "%{text}<extra></extra>",
      colorscale: IPC_CS,
      marker: { line: { color: "#ffffff", width: 1 } },
      colorbar: { tickvals: [0,10,20,35,50], ticktext: ["P1","P2","P3","P4","P5"], title: "IPC Phase 3+%", len: 0.7 }
    }, fsLabels];
  } else {
    const bands = countries.map((c) => {
      const idx = RISK_BANDS.findIndex((b) => c.risk_score >= b.min && c.risk_score <= b.max);
      return idx + 1;
    });
    const colorscale = [
      [0, RISK_BANDS[0].color],[0.2, RISK_BANDS[0].color],[0.2, RISK_BANDS[1].color],[0.4, RISK_BANDS[1].color],
      [0.4, RISK_BANDS[2].color],[0.6, RISK_BANDS[2].color],[0.6, RISK_BANDS[3].color],[0.8, RISK_BANDS[3].color],
      [0.8, RISK_BANDS[4].color],[1, RISK_BANDS[4].color]
    ];
    const hoverText = countries.map((c) => {
      const b = bandForRisk(c.risk_score);
      return `${c.country}<br>Risk: ${c.risk_score}<br>${b.label}`;
    });
    traces = [{
      type: "choropleth", locationmode: "ISO-3",
      locations: countries.map((c) => c.iso3), z: bands, zmin: 1, zmax: 5,
      text: hoverText, hovertemplate: "%{text}<extra></extra>", colorscale,
      marker: { line: { color: "#ffffff", width: 1 } },
      colorbar: { tickvals: [1,2,3,4,5], ticktext: ["B1","B2","B3","B4","B5"], title: "Bands" }
    }, fsLabels];
  }

  setTimeout(() => {
    Plotly.newPlot("mapChartFS", traces, {
      margin: { l: 0, r: 0, t: 0, b: 0 },
      showlegend: false,
      geo,
      paper_bgcolor: "#fff",
      plot_bgcolor: "#fff"
    }, { displayModeBar: false, responsive: true });
  }, 50);
}

function renderMap() {
  const countries = dashboardState.countries || [];
  const labelsTrace = buildCountryLabelsTrace(countries);

  if (mapMode === "ipc") {
    // IPC Phase 3+ coloring: 0-100% scale using canonical IPC colours
    const IPC_CS = [
      [0,    "#ffffff"],
      [0.10, "#c8e6f5"],
      [0.10, "#ffe57f"],
      [0.20, "#ffe57f"],
      [0.20, "#e67e22"],
      [0.35, "#e67e22"],
      [0.35, "#c0392b"],
      [0.60, "#c0392b"],
      [0.60, "#7b0000"],
      [1,    "#7b0000"]
    ];
    const vals = countries.map((c) => (c.ipc ? c.ipc.phase3plus_pct * 100 : null));
    const hoverText = countries.map((c) =>
      c.ipc
        ? `${c.country}<br>IPC Phase 3+: ${(c.ipc.phase3plus_pct * 100).toFixed(1)}%<br>Phase 4/5: ${((c.ipc.phase4_number || 0) + (c.ipc.phase5_number || 0)).toLocaleString()}<br>${c.ipc.ipc_crisis_level.toUpperCase()}<br>Analysis: ${c.ipc.analysis_date}`
        : `${c.country}<br>IPC data not available`
    );
    // Countries without IPC data get a grey fill via a separate trace
    const noIpcIso = countries.filter((c) => !c.ipc).map((c) => c.iso3);
    const traces = [
      {
        type: "choropleth",
        locationmode: "ISO-3",
        locations: countries.map((c) => c.iso3),
        z: vals.map((v) => (v !== null ? v : -1)),
        zmin: 0,
        zmax: 60,
        text: hoverText,
        hovertemplate: "%{text}<extra></extra>",
        colorscale: IPC_CS,
        marker: { line: { color: "#ffffff", width: 1 } },
        colorbar: {
          tickvals: [0, 10, 20, 35, 50],
          ticktext: ["P1 Minimal", "P2 Stressed", "P3 Crisis", "P4 Emergency", "P5"],
          title: "IPC Phase 3+%",
          len: 0.7
        }
      }
    ];
    if (noIpcIso.length) {
      traces.push({
        type: "choropleth",
        locationmode: "ISO-3",
        locations: noIpcIso,
        z: noIpcIso.map(() => 0),
        zmin: 0,
        zmax: 1,
        showscale: false,
        colorscale: [[0, "#d0d0d0"], [1, "#d0d0d0"]],
        marker: { line: { color: "#ffffff", width: 1 } },
        hovertemplate: "%{location}: no IPC data<extra></extra>"
      });
    }
    traces.push(labelsTrace);
    renderPlotWithSentinel(
      "mapChart",
      traces,
      {
        margin: { l: 8, r: 8, t: 8, b: 8 },
        showlegend: false,
        geo: getMapGeoLayout(),
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)"
      },
      { displayModeBar: false, responsive: true },
      { pageId: activePageId(), mapMode, countryCount: countries.length }
    );
    return;
  }

  // Default: composite risk band colouring
  const bands = countries.map((c) => {
    const idx = RISK_BANDS.findIndex((b) => c.risk_score >= b.min && c.risk_score <= b.max);
    return idx + 1;
  });

  const colorscale = [
    [0, RISK_BANDS[0].color],
    [0.2, RISK_BANDS[0].color],
    [0.2, RISK_BANDS[1].color],
    [0.4, RISK_BANDS[1].color],
    [0.4, RISK_BANDS[2].color],
    [0.6, RISK_BANDS[2].color],
    [0.6, RISK_BANDS[3].color],
    [0.8, RISK_BANDS[3].color],
    [0.8, RISK_BANDS[4].color],
    [1, RISK_BANDS[4].color]
  ];

  const hoverText = countries.map((c) => {
    const b = bandForRisk(c.risk_score);
    return `${c.country}<br>Risk score: ${c.risk_score}<br>${b.label}<br>Hazards: ${c.hazard_count}<br>Floods: ${c.flood_count || 0}<br>Cyclones: ${c.cyclone_count}`;
  });

  renderPlotWithSentinel(
    "mapChart",
    [
      {
        type: "choropleth",
        locationmode: "ISO-3",
        locations: countries.map((c) => c.iso3),
        z: bands,
        zmin: 1,
        zmax: 5,
        text: hoverText,
        hovertemplate: "%{text}<extra></extra>",
        colorscale,
        marker: { line: { color: "#ffffff", width: 1 } },
        colorbar: {
          tickvals: [1, 2, 3, 4, 5],
          ticktext: ["B1", "B2", "B3", "B4", "B5"],
          title: "Bands"
        }
      },
      labelsTrace
    ],
    {
      margin: { l: 8, r: 8, t: 8, b: 8 },
      geo: getMapGeoLayout(),
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)"
    },
    { displayModeBar: false, responsive: true },
    { pageId: activePageId(), mapMode, countryCount: countries.length }
  );
}

function renderTopAlerts() {
  const alerts = dashboardState.top_alerts || [];
  if (!alerts.length) {
    els.topAlerts.innerHTML = "No alert signals found in current source window.";
    return;
  }

  els.topAlerts.innerHTML = alerts
    .map((a) => {
      const b = bandForRisk(a.risk_score);
      return `
      <div class="alert-item" title="Hover to inspect risk context">
        <strong>${a.country}</strong>
        <div><span class="tag" style="background:${b.color}; color:#fff">${b.label}</span></div>
        <div>Risk ${a.risk_score} | Hazards ${a.hazard_count} | Floods ${a.flood_count || 0} | Cyclones ${a.cyclone_count} | Reports ${a.report_count_30d}</div>
      </div>
    `;
    })
    .join("");
}

function renderCountryTable() {
  const rows = sortCountries(dashboardState.countries || [], countrySortState);
  els.countryTableBody.innerHTML = rows
    .map((c) => {
      const wastingInd = c.indicators?.wasting_u5_pct;
      const stuntingInd = c.indicators?.stunting_u5_pct;
      const wasting = wastingInd?.latest?.value;
      const stunting = stuntingInd?.latest?.value;
      const staleTag = '<span class="tag stale">Stale</span>';
      const b = bandForRisk(c.risk_score);
      const wastingCell = wasting != null ? `${formatNum(wasting)}${wastingInd.stale_warning ? " " + staleTag : ""}` : "n/a";
      const stuntingCell = stunting != null ? `${formatNum(stunting)}${stuntingInd.stale_warning ? " " + staleTag : ""}` : "n/a";
      return `
        <tr data-iso3="${c.iso3}" title="Click row to focus country">
          <td><strong>${c.country}</strong><br>${qualityTag(c)}</td>
          <td>${compactTrackLabel(c.fcv_track)}</td>
          <td><span class="tag" style="background:${b.color}; color:#fff">${c.risk_score}</span></td>
          <td>${c.ipc ? `<strong>${formatNum(c.ipc.phase3plus_pct * 100, 1)}%</strong> <span class="tag ${c.ipc.ipc_crisis_level === 'crisis' ? 'bad' : c.ipc.ipc_crisis_level === 'stress' ? 'warn' : 'good'}">${c.ipc.ipc_crisis_level}</span>` : 'n/a'}</td>
          <td>${c.ipc ? formatNum((c.ipc.phase4_number || 0) + (c.ipc.phase5_number || 0), 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : 'n/a'}</td>
          <td>${c.ipc ? c.ipc.analysis_date : 'n/a'}</td>
          <td>${wastingCell}</td>
          <td>${stuntingCell}</td>
          <td>${c.hazard_count}</td>
          <td>${c.cyclone_count}</td>
          <td>${c.report_count_30d}</td>
        </tr>
      `;
    })
    .join("");

  updateCountrySortHeaders();

  Array.from(els.countryTableBody.querySelectorAll("tr")).forEach((tr) => {
    tr.addEventListener("click", () => {
      const iso3 = tr.getAttribute("data-iso3");
      els.countrySelect.value = iso3;
      renderTrend(iso3);
      renderSummary(iso3);
      renderForecast(iso3);
      setActivePage("countryPage");
    });
  });
}

function serviceValue(value, decimals = 0) {
  if (value == null || value === "") {
    return "n/a";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return formatNum(numeric, decimals);
}

function serviceDeliveryLeader(rows = [], metricKey) {
  return rows
    .map((entry) => ({
      country: entry?.country || entry?.service_delivery?.latest?.country || entry?.iso3,
      value: Number(entry?.service_delivery?.latest?.[metricKey])
    }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => b.value - a.value)[0] || null;
}

function parseNumericOrNull(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || /^na$/i.test(trimmed) || /^n\/a$/i.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveEnsoOutlookSummary(advisory) {
  const synopsis = String(advisory?.synopsis || "").replace(/\s+/g, " ").trim();
  if (!synopsis) {
    return "Outlook not available in this refresh.";
  }

  const chanceMatch = synopsis.match(/(\d{1,3})%\s*chance/i);
  const likelyTransitionMatch = synopsis.match(/In\s+([A-Za-z]+-[A-Za-z]+\s+\d{4}),\s*(El Niño|La Niña|ENSO-neutral)\s+is\s+likely\s+to\s+([A-Za-z-]+)(?:\s*\((\d{1,3})%\s*chance\))?/i);
  if (likelyTransitionMatch) {
    const windowLabel = likelyTransitionMatch[1];
    const phaseLabel = likelyTransitionMatch[2];
    const transitionVerb = likelyTransitionMatch[3];
    const sentenceChance = likelyTransitionMatch[4] || chanceMatch?.[1] || null;
    const chanceText = sentenceChance ? ` (${sentenceChance}% chance)` : "";
    return `${phaseLabel} likely to ${transitionVerb} in ${windowLabel}${chanceText}.`;
  }

  const favoredMatch = synopsis.match(/(ENSO-neutral|El Niño|La Niña)\s+favored\s+through\s+([A-Za-z]+-[A-Za-z]+\s+\d{4})\s*\((\d{1,3})%\s*chance\)/i);
  if (favoredMatch) {
    return `${favoredMatch[1]} favored through ${favoredMatch[2]} (${favoredMatch[3]}% chance).`;
  }

  const firstSentence = synopsis.split(/(?<=[.!?])\s+/)[0]?.trim();
  return firstSentence || synopsis;
}

function serviceDeliverySummaryParts(rows = [], status = null) {
  const coverageCount = rows.length;
  const monthCount = Number(status?.month_count || 0);
  const latestMonthLabel = status?.latest_month || "n/a";
  const topPeopleReached = serviceDeliveryLeader(rows, "people_reached");
  const topChildrenScreened = serviceDeliveryLeader(rows, "children_screened_malnutrition");
  const topMentalHealth = serviceDeliveryLeader(rows, "mental_health_beneficiaries");

  return {
    cardNote: `Coverage: ${coverageCount} FCV countries across ${monthCount || "n/a"} months`,
    coverageLine: `Coverage: ${coverageCount} FCV countries represented across ${monthCount || "n/a"} reporting months. Latest feed month: ${latestMonthLabel}.`,
    leadersLine: `Current table leaders: People reached ${topPeopleReached ? `${topPeopleReached.country} (${formatCount(topPeopleReached.value)})` : "n/a"}; children screened ${topChildrenScreened ? `${topChildrenScreened.country} (${formatCount(topChildrenScreened.value)})` : "n/a"}; mental health support ${topMentalHealth ? `${topMentalHealth.country} (${formatCount(topMentalHealth.value)})` : "n/a"}.`
  };
}

function renderServiceDeliveryPanel() {
  if (!els.serviceDeliverySummary || !els.serviceDeliveryTableBody) {
    return;
  }

  const status = dashboardState?.service_delivery_status || null;
  const rows = dashboardState?.service_delivery_by_country || [];
  if (!status || !rows.length) {
    els.serviceDeliverySummary.innerHTML = "No FCV service-delivery feed has been ingested yet.";
    els.serviceDeliveryTableBody.innerHTML = "";
    return;
  }

  const summary = serviceDeliverySummaryParts(rows, status);
  els.serviceDeliverySummary.innerHTML = `
    <p><strong>Feed status:</strong> ${status.source || "service feed"}. Values shown below are FCV country-level summaries for each country's latest month in the feed.</p>
    <p><strong>${summary.coverageLine}</strong></p>
    <p>${summary.leadersLine}</p>
  `;

  const sumMetric = (list, metricKey) => {
    const values = list
      .map((entry) => parseNumericOrNull(entry?.service_delivery?.latest?.[metricKey]))
      .filter((value) => value != null);
    if (!values.length) {
      return null;
    }
    return values.reduce((acc, value) => acc + value, 0);
  };

  const avgMetric = (list, metricKey) => {
    const values = list
      .map((entry) => parseNumericOrNull(entry?.service_delivery?.latest?.[metricKey]))
      .filter((value) => value != null);
    if (!values.length) {
      return null;
    }
    return values.reduce((acc, value) => acc + value, 0) / values.length;
  };

  const totals = {
    reporting_rows: sumMetric(rows, "reporting_rows"),
    mental_health_beneficiaries: sumMetric(rows, "mental_health_beneficiaries"),
    gbv_cases_managed: sumMetric(rows, "gbv_cases_managed"),
    people_reached: sumMetric(rows, "people_reached"),
    children_screened_malnutrition: sumMetric(rows, "children_screened_malnutrition"),
    opd_consultations_per_person_per_month: avgMetric(rows, "opd_consultations_per_person_per_month"),
    anc_visits_mean: avgMetric(rows, "anc_visits_mean"),
    measles_vaccination_coverage_pct: avgMetric(rows, "measles_vaccination_coverage_pct"),
    penta_vaccination_coverage_pct: avgMetric(rows, "penta_vaccination_coverage_pct")
  };

  const bodyRows = rows
    .map((entry) => {
      const latest = entry?.service_delivery?.latest || {};
      return `
        <tr>
          <td><strong>${entry.country || latest.country || entry.iso3}</strong></td>
          <td>${latest.month_label || latest.iso_month || "n/a"}</td>
          <td>${serviceValue(latest.reporting_rows, 0)}</td>
          <td>${serviceValue(latest.mental_health_beneficiaries, 0)}</td>
          <td>${serviceValue(latest.gbv_cases_managed, 0)}</td>
          <td>${serviceValue(latest.people_reached, 0)}</td>
          <td>${serviceValue(latest.children_screened_malnutrition, 0)}</td>
          <td>${serviceValue(latest.opd_consultations_per_person_per_month, 2)}</td>
          <td>${serviceValue(latest.anc_visits_mean, 2)}</td>
          <td>${serviceValue(latest.measles_vaccination_coverage_pct, 2)}</td>
          <td>${serviceValue(latest.penta_vaccination_coverage_pct, 2)}</td>
        </tr>
      `;
    })
    .join("");

  const totalRow = `
    <tr class="service-delivery-total-row">
      <td><strong>Total / Mean</strong></td>
      <td>Latest by country</td>
      <td><strong>${serviceValue(totals.reporting_rows, 0)}</strong></td>
      <td><strong>${serviceValue(totals.mental_health_beneficiaries, 0)}</strong></td>
      <td><strong>${serviceValue(totals.gbv_cases_managed, 0)}</strong></td>
      <td><strong>${serviceValue(totals.people_reached, 0)}</strong></td>
      <td><strong>${serviceValue(totals.children_screened_malnutrition, 0)}</strong></td>
      <td><strong>${serviceValue(totals.opd_consultations_per_person_per_month, 2)}</strong></td>
      <td><strong>${serviceValue(totals.anc_visits_mean, 2)}</strong></td>
      <td><strong>${serviceValue(totals.measles_vaccination_coverage_pct, 2)}</strong></td>
      <td><strong>${serviceValue(totals.penta_vaccination_coverage_pct, 2)}</strong></td>
    </tr>
  `;

  els.serviceDeliveryTableBody.innerHTML = `${bodyRows}${totalRow}`;
}

function renderFcvCountryProfile() {
  if (!els.fcvCountryProfileSummary || !els.fcvCountryProfileTableBody) {
    return;
  }

  const profile = dashboardState?.fcv_country_profile || null;
  const rows = profile?.rows || [];
  if (!profile || !rows.length) {
    els.fcvCountryProfileSummary.innerHTML = "FCV Country Profile Data file is not loaded. Place FCV-Country-Profile-Data.xlsx in the dashboard-app directory.";
    els.fcvCountryProfileTableBody.innerHTML = "";
    return;
  }

  const fmt = (val, decimals = 0) => {
    if (val == null) return "n/a";
    if (decimals === 0) return Number(val).toLocaleString();
    return (Number(val) * 100).toFixed(1) + "%";
  };

  const fmtUSD = (val) => {
    if (val == null) return "n/a";
    const m = val / 1e6;
    return "$" + m.toFixed(1) + "M";
  };

  const withPlan = rows.filter((r) => r.plan_type && r.plan_type.toUpperCase() !== "NON PLAN");
  const totalFunding = rows.reduce((acc, r) => acc + (r.funding_usd || 0), 0);
  const totalReqs = rows.reduce((acc, r) => acc + (r.requirements_usd || 0), 0);
  const overallFunded = totalReqs > 0 ? (totalFunding / totalReqs * 100).toFixed(1) + "%" : "n/a";

  els.fcvCountryProfileSummary.innerHTML = `
    <p><strong>Source:</strong> FCV Country Profile Data (loaded ${profile.loaded_at ? new Date(profile.loaded_at).toLocaleDateString() : "unknown"}). ${rows.length} countries. ${withPlan.length} with active humanitarian plans.</p>
    <p><strong>Overall funding:</strong> ${fmtUSD(totalFunding)} received of ${fmtUSD(totalReqs)} required across all countries (${overallFunded} funded).</p>
  `;

  const bodyRows = rows.map((r) => `
    <tr>
      <td><strong>${r.country}</strong></td>
      <td>${r.plan_type || "n/a"}</td>
      <td>${r.fcv ? "Yes" : "No"}</td>
      <td>${r.hcc ? "Yes" : "No"}</td>
      <td>${fmt(r.people_in_need)}</td>
      <td>${fmt(r.people_targeted)}</td>
      <td>${fmt(r.people_prioritized)}</td>
      <td>${fmt(r.people_reached_hrp)}</td>
      <td>${fmt(r.health_people_in_need)}</td>
      <td>${fmt(r.health_people_targeted)}</td>
      <td>${fmt(r.refugees_asylum_seekers)}</td>
      <td>${fmt(r.idps)}</td>
      <td>${fmtUSD(r.requirements_usd)}</td>
      <td>${fmtUSD(r.funding_usd)}</td>
      <td>${r.pct_funded != null ? (r.pct_funded * 100).toFixed(1) + "%" : "n/a"}</td>
    </tr>
  `).join("");

  els.fcvCountryProfileTableBody.innerHTML = bodyRows;
}

function renderTrend(countryIso3) {
  const c = getCountryByIso3(countryIso3);
  if (!c) {
    return;
  }

  const wastingSeries = c.indicators?.wasting_u5_pct?.series || [];
  const stuntingSeries = c.indicators?.stunting_u5_pct?.series || [];
  const wastingProj = c.projections?.wasting_u5_pct || [];

  renderPlotWithSentinel(
    "trendChart",
    [
      {
        x: wastingSeries.map((d) => d.year),
        y: wastingSeries.map((d) => d.value),
        name: "Observed Wasting %",
        mode: "lines+markers",
        line: { color: INDICATOR_META.wasting_u5_pct.color, width: 3 }
      },
      {
        x: stuntingSeries.map((d) => d.year),
        y: stuntingSeries.map((d) => d.value),
        name: "Observed Stunting %",
        mode: "lines+markers",
        line: { color: INDICATOR_META.stunting_u5_pct.color, width: 3 }
      },
      {
        x: wastingProj.map((d) => d.year),
        y: wastingProj.map((d) => d.value),
        name: "Projected Wasting %",
        mode: "lines+markers",
        line: { color: "#7a2d2d", width: 2, dash: "dash" }
      }
    ],
    {
      margin: { l: 44, r: 12, t: 8, b: 58 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      xaxis: { title: "" },
      yaxis: { title: "Percent" },
      legend: { orientation: "h" }
    },
    { displayModeBar: false, responsive: true },
    { pageId: activePageId(), countryIso3 }
  );
}

function renderSummary(countryIso3) {
  const c = getCountryByIso3(countryIso3);
  if (!c) {
    return;
  }

  const b = bandForRisk(c.risk_score);
  const wasting = c.indicators?.wasting_u5_pct?.latest;
  const stunting = c.indicators?.stunting_u5_pct?.latest;
  const pregnant = c.indicators?.pregnant_anemia_pct?.latest;
  const wastingStale = c.indicators?.wasting_u5_pct?.stale_warning;
  const stuntingStale = c.indicators?.stunting_u5_pct?.stale_warning;
  const pregnantStale = c.indicators?.pregnant_anemia_pct?.stale_warning;
  const staleTag = '<span class="tag stale">Stale</span>';
  const proj = c.projections?.wasting_u5_pct || [];
  const serviceDelivery = c.service_delivery?.latest || null;
  const serviceDeliveryMeta = serviceDelivery
    ? `${serviceValue(serviceDelivery.reporting_rows, 0)} reporting rows across ${serviceValue(serviceDelivery.admin1_count, 0)} admin1 areas, ${serviceValue(serviceDelivery.admin2_count, 0)} admin2 areas, and ${serviceValue(serviceDelivery.respondent_count, 0)} respondent records.`
    : "";
  const serviceDeliveryCoverage = serviceDelivery
    ? `OPD per person <strong>${serviceValue(serviceDelivery.opd_consultations_per_person_per_month, 2)}</strong>, ANC mean <strong>${serviceValue(serviceDelivery.anc_visits_mean, 2)}</strong>, institutional deliveries <strong>${serviceValue(serviceDelivery.deliveries_in_health_institution_pct, 2)}</strong>.`
    : "";

  const ipcBlock = c.ipc
    ? `<p><strong>IPC Phase Classification (${c.ipc.analysis_date}):</strong> Phase 3+ population <strong>${formatNum(c.ipc.phase3plus_pct * 100, 1)}%</strong> (${(c.ipc.phase3plus_number || 0).toLocaleString()} people) — <span class="tag ${c.ipc.ipc_crisis_level === 'crisis' ? 'bad' : c.ipc.ipc_crisis_level === 'stress' ? 'warn' : 'good'}">${c.ipc.ipc_crisis_level.toUpperCase()}</span>. Phase 4/5 emergency: <strong>${((c.ipc.phase4_number || 0) + (c.ipc.phase5_number || 0)).toLocaleString()}</strong> people. Source: IPC via HDX open data.</p>`
    : `<p><span class="tag bad">IPC data not available</span> No IPC phase classification found for this country in HDX open datasets.${c.iso3 === "ERI" ? " <strong>Eritrea data gap:</strong> No IPC or HDX acute malnutrition source is currently configured for Eritrea. This is a known data access constraint." : ""}</p>`;

  els.summaryBox.innerHTML = `
    <p><strong>${c.country}</strong> has a current composite risk score of <strong>${c.risk_score}</strong> in <strong>${b.label}</strong>.</p>
    ${ipcBlock}
    <p>Supplementary nutrition: Wasting <strong>${formatNum(wasting?.value)}</strong> (${wasting?.year || "n/a"})${wastingStale ? " " + staleTag : ""}, Stunting <strong>${formatNum(stunting?.value)}</strong> (${stunting?.year || "n/a"})${stuntingStale ? " " + staleTag : ""}, Pregnant Anemia <strong>${formatNum(pregnant?.value)}</strong> (${pregnant?.year || "n/a"})${pregnantStale ? " " + staleTag : ""}.</p>
      <p><small><em>Pregnant Anemia is anemia prevalence (SH.ANM.PREG.ZS), not an acute malnutrition indicator.</em></small></p>
    <p>Signal pressure: <strong>${c.hazard_count}</strong> hazard events, <strong>${c.flood_count || 0}</strong> flood signals, <strong>${c.cyclone_count}</strong> cyclone signals, and <strong>${c.report_count_30d}</strong> related reports in the latest 30-day window.</p>
    ${serviceDelivery ? `<p>FCV service delivery (${serviceDelivery.month_label || serviceDelivery.iso_month}): Mental health <strong>${serviceValue(serviceDelivery.mental_health_beneficiaries, 0)}</strong>, GBV managed <strong>${serviceValue(serviceDelivery.gbv_cases_managed, 0)}</strong>, People reached <strong>${serviceValue(serviceDelivery.people_reached, 0)}</strong>, Children screened <strong>${serviceValue(serviceDelivery.children_screened_malnutrition, 0)}</strong>.</p>` : ""}
    ${serviceDelivery ? `<p>Service delivery footprint: ${serviceDeliveryMeta}</p>` : ""}
    ${serviceDelivery ? `<p>Service delivery operations: ${serviceDeliveryCoverage}</p>` : ""}
    <p>Forecast horizon (wasting): ${proj.length ? proj.map((p) => `${p.year}: ${formatNum(p.value)}`).join(" | ") : "insufficient data for transparent trend projection"}.</p>
    <p><span class="tag warn">Method Note</span> IPC phase values are the primary food security signal. Wasting trend is supplementary context.</p>
  `;
}

function forecastRows(country) {
  return [
    {
      key: "wasting_u5_pct",
      name: "Child Wasting (%)",
      values: country.projections?.wasting_u5_pct || []
    },
    {
      key: "stunting_u5_pct",
      name: "Child Stunting (%)",
      values: country.projections?.stunting_u5_pct || []
    },
    {
      key: "pregnant_anemia_pct",
      name: "Pregnant Women Anemia (%)",
      values: country.projections?.pregnant_anemia_pct || []
    }
  ];
}

function renderDtmDisplacementTable() {
  if (!els.dtmDisplacementTableBody || !els.dtmDisplacementSummary) return;
  const rows = (dashboardState && dashboardState.dtm_displacement) || [];
  const status = (dashboardState && dashboardState.dtm_displacement_status) || {};

  if (!rows.length) {
    els.dtmDisplacementSummary.innerHTML = `<p class="tag warn">DTM displacement data not yet loaded. Data is fetched once per day from IOM/HDX.</p>`;
    els.dtmDisplacementTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#888;">No data available</td></tr>`;
    return;
  }

  const totalIdps = rows.reduce((s, r) => s + (r.idp_count || 0), 0);
  const topCountry = rows[0];
  const savedAt = status.saved_at ? new Date(status.saved_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "unknown";

  els.dtmDisplacementSummary.innerHTML = `
    <p><strong>Total IDPs tracked:</strong> ${totalIdps.toLocaleString()} across ${rows.length} countries (IOM DTM, as of ${savedAt}).</p>
    <p><strong>Highest displacement:</strong> ${topCountry.country} with ${(topCountry.idp_count || 0).toLocaleString()} IDPs (${topCountry.displacement_reason || "unspecified"}, reported ${topCountry.reporting_date || "unknown"}).</p>
    <p><span class="tag warn">Note</span> IDP figures reflect DTM assessments at available reporting dates — recency varies by country. Some figures may predate the current humanitarian situation.</p>
  `;

  const reasonColor = (reason) => {
    if (!reason) return "#888";
    const r = reason.toLowerCase();
    if (r.includes("conflict") || r.includes("violence")) return "#cf3c3c";
    if (r.includes("natural") || r.includes("disaster") || r.includes("flood") || r.includes("cyclone")) return "#e67300";
    return "#506579";
  };

  const scaleBar = (count, max) => {
    const pct = Math.max(4, Math.round((count / max) * 100));
    return `<span style="display:inline-block;width:${pct}px;height:8px;background:#0b4ea2;border-radius:2px;vertical-align:middle;margin-right:6px;"></span>`;
  };
  const maxIdp = rows[0].idp_count || 1;

  els.dtmDisplacementTableBody.innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${r.country}</strong></td>
      <td style="white-space:nowrap;">
        ${scaleBar(r.idp_count || 0, maxIdp)}
        ${(r.idp_count || 0).toLocaleString()}
      </td>
      <td><span style="color:${reasonColor(r.displacement_reason)};font-weight:600;">${r.displacement_reason || "Not specified"}</span></td>
      <td style="color:#506579;">${r.reporting_date || "—"}</td>
    </tr>
  `).join("");
}

function renderForecast(countryIso3) {
  const c = getCountryByIso3(countryIso3);
  if (!c) {
    return;
  }

  const forecasts = dashboardState.forecasts || [];
  const ensoAdvisory = dashboardState.enso_advisory || null;
  const ensoOutlook = deriveEnsoOutlookSummary(ensoAdvisory);
  const droughtSignals = dashboardState.drought_signals || [];
  const cycloneSignals = dashboardState.cyclone_intelligence?.projection_signals || [];
  const ipcCurrentPct = c.ipc?.phase3plus_pct;
  const ipcProjectedPct = c.ipc?.projection_phase3plus_pct;
  const ipcDate = c.ipc?.analysis_date || "n/a";
  const ipcProjectionDate = c.ipc?.projection_date || "n/a";
  const countryDroughtCount = c.drought_signal_count || 0;
  const countryIcpacCount = c.icpac_forecast_count || 0;
  const wastingLatest = latestAvailableIndicatorValue(c.indicators?.wasting_u5_pct);
  const stuntingLatest = latestAvailableIndicatorValue(c.indicators?.stunting_u5_pct);
  const anemiaLatest = latestAvailableIndicatorValue(c.indicators?.pregnant_anemia_pct);

  const sourceValueLabel = (latest) => {
    if (!latest) {
      return "n/a";
    }
    return `${formatNum(latest.value)} (${latest.year || "n/a"})`;
  };

  const sourceMetaLabel = (latest) => {
    if (!latest) {
      return "No current source value available";
    }
    const source = latest.source || "source n/a";
    return `${source}${latest.method ? ` | ${latest.method}` : ""}`;
  };

  const icpacByLevel = forecasts.reduce(
    (acc, f) => {
      if (f.risk_level === "high") {
        acc.high += 1;
      } else if (f.risk_level === "watch") {
        acc.watch += 1;
      } else {
        acc.info += 1;
      }
      return acc;
    },
    { high: 0, watch: 0, info: 0 }
  );

  const chartBars = [
    { label: "IPC Current Phase 3+ (%)", value: ipcCurrentPct == null ? 0 : Number((ipcCurrentPct * 100).toFixed(1)) },
    { label: "IPC Projected Phase 3+ (%)", value: ipcProjectedPct == null ? 0 : Number((ipcProjectedPct * 100).toFixed(1)) },
    { label: "Flood Signals", value: c.flood_count || 0 },
    { label: "Drought Signals", value: countryDroughtCount },
    { label: "Cyclone Signals", value: c.cyclone_count || 0 }
  ];
  renderPlotWithSentinel(
    "forecastChart",
    [
      {
        type: "bar",
        x: chartBars.map((x) => x.label),
        y: chartBars.map((x) => x.value),
        marker: { color: ["#b75f39", "#9c3d2a", "#2d6ea3", "#3f6f8a", "#5f7f4a"] }
      }
    ],
    {
      margin: { l: 46, r: 16, t: 10, b: 66 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      xaxis: { title: "", automargin: true, tickangle: -25 },
      yaxis: { title: "Value / Count" },
      showlegend: false
    },
    { displayModeBar: false, responsive: true },
    { pageId: activePageId(), countryIso3 }
  );

  els.forecastTableBody.innerHTML = `
    <tr>
      <td>Under-5 Wasting (%)</td>
      <td>${sourceValueLabel(wastingLatest)}</td>
      <td>No validated country-level forward forecast in connected sources</td>
      <td>${wastingLatest?.year || "n/a"}</td>
      <td>${sourceMetaLabel(wastingLatest)}</td>
    </tr>
    <tr>
      <td>Under-5 Stunting (%)</td>
      <td>${sourceValueLabel(stuntingLatest)}</td>
      <td>No validated country-level forward forecast in connected sources</td>
      <td>${stuntingLatest?.year || "n/a"}</td>
      <td>${sourceMetaLabel(stuntingLatest)}</td>
    </tr>
    <tr>
      <td>Pregnant Women Anemia (%)</td>
      <td>${sourceValueLabel(anemiaLatest)}</td>
      <td>No validated country-level forward forecast in connected sources</td>
      <td>${anemiaLatest?.year || "n/a"}</td>
      <td>${sourceMetaLabel(anemiaLatest)} | SH.ANM.PREG.ZS (anemia prevalence)</td>
    </tr>
    <tr>
      <td>IPC (HDX)</td>
      <td>${ipcCurrentPct == null ? "n/a" : `${formatNum(ipcCurrentPct * 100, 1)}% (Phase 3+)`}</td>
      <td>${ipcProjectedPct == null ? "n/a" : `${formatNum(ipcProjectedPct * 100, 1)}% (Phase 3+)`}</td>
      <td>${ipcDate}${ipcProjectionDate !== "n/a" ? ` | Projection: ${ipcProjectionDate}` : ""}</td>
      <td>Official IPC snapshot and validity projection rows from HDX</td>
    </tr>
    <tr>
      <td>ICPAC Bulletins</td>
      <td>${forecasts.length} bulletins loaded (${countryIcpacCount} tagged to ${c.country} focus logic)</td>
      <td>High ${icpacByLevel.high}, Watch ${icpacByLevel.watch}, Info ${icpacByLevel.info}</td>
      <td>${forecasts[0]?.date_label || "n/a"}</td>
      <td>Public ICPAC weekly, monthly, seasonal products (title/date/risk parsing)</td>
    </tr>
    <tr>
      <td>ENSO Watch / Advisory</td>
      <td>${ensoAdvisory?.alert_status || "n/a"}</td>
      <td>${ensoOutlook}</td>
      <td>${ensoAdvisory?.issued_on || "n/a"}${ensoAdvisory?.next_update ? ` | Next: ${ensoAdvisory.next_update}` : ""}</td>
      <td>NOAA CPC ENSO Diagnostic Discussion regional climate watch</td>
    </tr>
    <tr>
      <td>Drought Signals (source-derived)</td>
      <td>${countryDroughtCount} linked to ${c.country}</td>
      <td>${droughtSignals.length} total source-derived drought signals this refresh</td>
      <td>${droughtSignals[0]?.date_label || "n/a"}</td>
      <td>Derived from source report titles (ICPAC and ReliefWeb), country-linked via explicit mentions</td>
    </tr>
    <tr>
      <td>Cyclone Projection Signals</td>
      <td>${c.cyclone_count || 0} country-linked cyclone event signals</td>
      <td>${cycloneSignals.length} regional cyclone projection/advisory signals</td>
      <td>${cycloneSignals[0]?.date_label || "n/a"}</td>
      <td>Source-monitored from ICPAC/ReliefWeb plus dedicated cyclone source monitoring</td>
    </tr>
  `;

  els.forecastInsights.innerHTML = `
    <p><strong>Source-only forecast mode:</strong> This page shows only source-extracted values and forecast signals (IPC, ICPAC, and source-derived drought/cyclone intelligence).</p>
    <p><strong>Country nutrition baseline (${c.country}):</strong> Under-5 wasting ${sourceValueLabel(wastingLatest)}, under-5 stunting ${sourceValueLabel(stuntingLatest)}, pregnant women anemia ${sourceValueLabel(anemiaLatest)}.</p>
    <p><strong>Forecast availability note:</strong> Connected sources currently provide country-level forward forecast values for IPC food security burden, but not for under-5 wasting/stunting or pregnant anemia.</p>
    <p><strong>Country source forecast view (${c.country}):</strong> IPC projected Phase 3+ ${ipcProjectedPct == null ? "not available" : `${formatNum(ipcProjectedPct * 100, 1)}%`} | Drought signals ${countryDroughtCount} | ICPAC focus-linked bulletins ${countryIcpacCount}.</p>
    <p><strong>ENSO regional climate watch:</strong> ${ensoAdvisory?.alert_status || "n/a"}${ensoAdvisory?.issued_on ? ` | Issued ${ensoAdvisory.issued_on}` : ""}${ensoAdvisory?.next_update ? ` | Next ${ensoAdvisory.next_update}` : ""}.</p>
    <p><strong>ENSO outlook:</strong> ${ensoOutlook}</p>
    <p><strong>ENSO synopsis:</strong> ${ensoAdvisory?.synopsis || "No CPC ENSO synopsis was available in this refresh."}</p>
    <p><strong>Regional source load:</strong> ICPAC bulletins ${forecasts.length}, drought signals ${droughtSignals.length}, cyclone projection signals ${cycloneSignals.length}, ENSO status ${ensoAdvisory?.alert_status ? "loaded" : "not loaded"}.</p>
    <p><span class="tag good">Method Note</span> No internally generated numeric trend forecast is shown on this page.</p>
  `;
}

function renderHazards() {
  const hazards = (dashboardState.hazards || []).filter((h) => isApprovedVisibleEventSource(h.source || "GDACS"));
  els.hazardFeed.innerHTML = [...hazards]
    .sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    })
    .slice(0, 25)
    .map(
      (h) => `
      <div class="feed-item">
        <a href="${h.link || "#"}" target="_blank" rel="noreferrer">${h.title || "Untitled event"}</a>
        <div class="feed-meta-row">${renderSourceTrustBadge(h.source || "GDACS")}<span>${h.hazard_type} | <span title="${h.pubDate || "n/a"}">${formatDateTime(h.pubDate)}</span> | ${h.countries.length ? h.countries.join(", ") : "AFRO regional"} | ${h.source || "GDACS"}</span></div>
      </div>
    `
    )
    .join("");

  renderFloodWatch();
}

function renderFloodWatch() {
  if (!els.floodWatchSummary || !els.floodFeed) {
    return;
  }

  const floodCtx = getFloodContext();
  const afroFloodEvents = floodCtx.afroFloodEvents.filter((item) => isApprovedVisibleEventSource(item.source || "GDACS"));
  const mappedFloodEvents = floodCtx.mappedFloodEvents;
  const unmappedFloodEvents = floodCtx.unmappedFloodEvents;
  const topFloodCountries = floodCtx.topFloodCountries;
  const highestFlood = floodCtx.highestFlood;
  const totalFloodSignals = floodCtx.totalFloodSignals;
  const overlapCountries = floodCtx.overlapCountries;
  const severityLabel = floodCtx.severityLabel;
  const floodWindowDays = Number(dashboardState.flood_signal_window_days || 180);
  const droughtProjectionSignals = (dashboardState.drought_signals || []).length;
  const cycloneProjectionSignals = (dashboardState.cyclone_intelligence?.projection_signals || []).length;
  const cemsFloodStatus = dashboardState.cems_flood_source_status || {};
  const cemsOverall = String(cemsFloodStatus.overall || "unknown").toLowerCase();
  const cemsAccessText = cemsOverall === "available"
    ? "Copernicus CEMS Flood / GloFAS public flood-access pathways are documented in this refresh."
    : cemsOverall === "partial"
      ? "Copernicus CEMS Flood / GloFAS documentation is reachable, but live portal access is credentialed, so direct automated extraction is not currently claimed."
      : cemsOverall === "error"
        ? "Copernicus CEMS Flood / GloFAS posture could not be verified in this refresh."
        : "Copernicus CEMS Flood / GloFAS posture remains advisory in this refresh.";
  const currentText = `${afroFloodEvents.length} flood updates in ${floodWindowDays}-day window`;
  const projectionText = `${droughtProjectionSignals} drought + ${cycloneProjectionSignals} cyclone outlook signals`;
  const confidenceLevel = mappedFloodEvents.length > 0 && (cemsOverall === "available" || cemsOverall === "partial")
    ? "good"
    : afroFloodEvents.length > 0 || cemsOverall === "partial"
      ? "warn"
      : "bad";
  const confidenceText = confidenceLevel === "good"
    ? `Most events include explicit country mapping from verified sources. ${cemsAccessText}`
    : confidenceLevel === "warn"
      ? `Regional event updates exist, but country mapping or hydrological-source automation remains partial. ${cemsAccessText}`
      : `No current flood evidence in monitored verified feeds. ${cemsAccessText}`;

  els.floodWatchSummary.innerHTML = `
    ${renderCurrentProjectionConfidence(currentText, projectionText, confidenceText, confidenceLevel)}
    <p><strong>Current flood situation (${floodWindowDays}-day source window):</strong> ${afroFloodEvents.length} regional flood updates, ${mappedFloodEvents.length} mapped to monitored countries.</p>
    <p><strong>Countries with mapped flood signals:</strong> ${topFloodCountries.length ? topFloodCountries.map((c) => `<strong>${c.country}</strong> (${c.flood_count})`).join(", ") : "None"}</p>
    <p><strong>Flood severity tier:</strong> ${severityLabel}</p>
    <p><strong>Flood-food security overlap:</strong> ${overlapCountries.length ? overlapCountries.map((c) => `${c.country} (${formatNum((c.ipc?.phase3plus_pct || 0) * 100, 1)}%)`).join(", ") : "No overlap countries at IPC Phase 3+ >= 20%"}</p>
    <p><strong>Forward outlook:</strong> ${droughtProjectionSignals} drought and ${cycloneProjectionSignals} cyclone projection/advisory signals tracked.</p>
    <p><strong>Data sources:</strong> GDACS flood events plus ReliefWeb Africa updates, prioritized by FCV and AFRO regional status.</p>
    <p><strong>Hydrological coverage:</strong> ${cemsAccessText}</p>
  `;

  const sortedFloodEvents = [...afroFloodEvents].sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });
  els.floodFeed.innerHTML = sortedFloodEvents.length
    ? sortedFloodEvents.slice(0, 20).map((h) => `
      <div class="feed-item">
        <a href="${h.link || "#"}" target="_blank" rel="noreferrer">${h.title || "Untitled flood event"}</a>
        <div class="feed-meta-row">${renderSourceTrustBadge(h.source || "GDACS")}<span>Flood | <span title="${h.pubDate || "n/a"}">${formatDateTime(h.pubDate)}</span> | ${(h.countries || []).join(", ") || "AFRO regional"} | ${h.source || "GDACS"}</span></div>
        <div>${buildFeedAutoSummary(h, "Flood")}</div>
      </div>
    `).join("")
    : "No flood event is visible in the current AFRO monitoring window.";
}

function renderReports() {
  const reports = (dashboardState.reports || []).filter((r) => r.in30Days && isApprovedVisibleEventSource(r.source || "")).slice(0, 25);
  if (!reports.length) {
    const reliefwebApiStatus = dashboardState.reliefweb_api_status || {};
    const apiSignalCount = Number(reliefwebApiStatus.matching_signals || 0);
    const appnameConfigured = Boolean(reliefwebApiStatus.appname_configured);
    const apiStatusLabel = reliefwebApiStatus.overall || "unknown";
    els.reportFeed.innerHTML = `
      <div class="feed-item">
        <strong>No ReliefWeb RSS reports were loaded in this refresh.</strong>
        <div class="feed-meta-row"><span>RELIEFWEB_APPNAME: ${appnameConfigured ? "configured" : "not configured"} | ReliefWeb API status: ${apiStatusLabel} | API flood signals: ${apiSignalCount}</span></div>
        <div>This RSS panel can be empty either because no reports matched the 30-day window or because the RSS endpoint is temporarily unavailable. Flood updates may still appear in Flood Watch through GDACS and ReliefWeb API enrichment.</div>
      </div>
    `;
    return;
  }

  els.reportFeed.innerHTML = reports
    .map(
      (r) => `
      <div class="feed-item">
        <a href="${r.url || "#"}" target="_blank" rel="noreferrer">${r.title}</a>
        <div class="feed-meta-row">${renderSourceTrustBadge(r.source || "ReliefWeb RSS")}<span>${r.source} | <span title="${r.created || "n/a"}">${formatDateTime(r.created)}</span> | ${r.countries.join(", ")}</span></div>
        <div>${buildFeedAutoSummary(r, "Report")}</div>
      </div>
    `
    )
    .join("");
}

function renderWhoDonAlerts() {
  if (!els.whoDonFeed) {
    return;
  }
  const items = (dashboardState.who_don_reports || []).filter((r) => r.in30Days && isApprovedVisibleEventSource(r.source || "WHO DON RSS")).slice(0, 25);
  els.whoDonFeed.innerHTML = items.length
    ? items.map((r) => {
      const disease = r.disease || "Disease outbreak";
      return `
      <div class="feed-item">
        <a href="${r.url || "#"}" target="_blank" rel="noreferrer">${r.title || "WHO DON outbreak alert"}</a>
        <div class="feed-meta-row">${renderSourceTrustBadge(r.source || "WHO DON RSS")}<span>${r.source || "WHO DON RSS"} | ${disease} | <span title="${r.created || "n/a"}">${formatDateTime(r.created)}</span> | ${(r.countries || []).join(", ") || "country n/a"}</span></div>
        <div>${buildFeedAutoSummary(r, disease)}</div>
      </div>
    `;
    }).join("")
    : t("noWhoDonAlerts");
}

function renderDiseaseOutbreakFeed() {
  if (!els.diseaseOutbreakFeed) {
    return;
  }
  const signals = dashboardState.disease_outbreak_signals || [];
  const countries = dashboardState.countries || [];
  const focusCountries = [...countries]
    .filter((c) => (c.disease_outbreak_signal_count || 0) > 0)
    .sort((a, b) => (b.disease_outbreak_signal_count || 0) - (a.disease_outbreak_signal_count || 0))
    .slice(0, 5);

  if (!focusCountries.length) {
    els.diseaseOutbreakFeed.innerHTML = "No disease outbreak items matched verified source criteria in the current 30-day window.";
    return;
  }

  els.diseaseOutbreakFeed.innerHTML = focusCountries.map((country) => {
    const countrySignals = signals
      .filter((item) => (item.countries || []).includes(country.iso3) && isApprovedVisibleEventSource(item.source || ""))
      .slice(0, 3);
    const signalMarkup = countrySignals.length
      ? countrySignals.map((item) => `
          <div class="feed-item conflict-feed-item">
            <div class="conflict-feed-header">
              <a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled report"}</a>
              <div class="signal-chip-row">
                ${(item.signal_tags || []).map((tag) => `<span class="signal-chip ${tag.toLowerCase().replace(/\s+/g, "-")}">${tag}</span>`).join("")}
              </div>
            </div>
            <div class="feed-meta-row">${renderSourceTrustBadge(item.source || "ReliefWeb")}<span>${item.source || "ReliefWeb"} | <span title="${item.date_label || "n/a"}">${formatDateTime(item.date_label)}</span></span></div>
            <div class="signal-summary">${summarizeSourceExcerpt(item.summary || item.content || "", SOURCE_EXCERPT_MAX_CHARS)}</div>
          </div>
        `).join("")
      : '<div class="feed-item conflict-feed-item"><div>No linked disease outbreak source item was detected for this country in the current refresh.</div></div>';
    return `
      <div class="conflict-country-block">
        <div class="conflict-country-header">
          <strong>${country.country}</strong>
          <span class="tag warn">${country.disease_outbreak_signal_count} signal${country.disease_outbreak_signal_count !== 1 ? "s" : ""}</span>
        </div>
        ${signalMarkup}
      </div>
    `;
  }).join("");
}

function renderHazardSourceSummaries() {
  const summaries = dashboardState.source_summaries || {};
  const gdacs = summaries.gdacs || {};
  const relief = summaries.reliefweb || {};
  const fews = summaries.fews_net || {};
  const acaps = summaries.acaps || {};
  const whoDon = summaries.who_don || {};
  const cemsFloodStatus = dashboardState.cems_flood_source_status || {};
  const afroCycloneEvents = (dashboardState.hazards || []).filter((h) => /cyclone/i.test(`${h.hazard_type || ""} ${h.title || ""}`) && h.afro_context !== false).length;
  const acapsStatus = dashboardState.acaps_source_status || {};
  const reliefwebApiStatus = dashboardState.reliefweb_api_status || {};
  const whoDonStatus = dashboardState.who_don_source_status || {};
  const delta = summaries.delta || {};
  const diseaseSignals = dashboardState.disease_outbreak_signals || [];
  const floodCtx = getFloodContext();
  const floodEvents = floodCtx.afroFloodEvents.length;
  const floodWindowDays = Number(dashboardState.flood_signal_window_days || 180);
  const droughtProjectionSignals = (dashboardState.drought_signals || []).length;
  const cycloneProjectionSignals = (dashboardState.cyclone_intelligence?.projection_signals || []).length;
  const cemsFloodText = cemsFloodStatus.overall === "available"
    ? `Copernicus flood docs verified (${cemsFloodStatus.public_docs_available || 0}/${cemsFloodStatus.public_docs_checked || 0}); public access pathways documented.`
    : cemsFloodStatus.overall === "partial"
      ? `Copernicus flood docs verified (${cemsFloodStatus.public_docs_available || 0}/${cemsFloodStatus.public_docs_checked || 0}); live portal remains credentialed.`
      : cemsFloodStatus.overall === "error"
        ? "Copernicus flood posture could not be verified in this refresh."
        : "Copernicus flood posture is not yet fully established in this refresh.";
  const deltaText = (n) => {
    if (n == null) {
      return "n/a (first refresh baseline)";
    }
    if (n > 0) {
      return `+${n}`;
    }
    return `${n}`;
  };

  if (els.gdacsSummary) {
    const cycloneEvents = afroCycloneEvents;
    const fcvLinkedEvents = gdacs.total_fcv_linked_events ?? 0;
    const topCountries = (gdacs.top_countries || []).map((x) => `${x.country} (${x.count}${x.rank_delta == null ? "" : x.rank_delta > 0 ? `, rank +${x.rank_delta}` : x.rank_delta < 0 ? `, rank ${x.rank_delta}` : ", rank stable"})`).join(", ") || "n/a";
    const latest = (gdacs.latest_items || []).slice(0, 3).map((x) => `<li><a href="${x.url || "#"}" target="_blank" rel="noreferrer">${x.title || "Untitled"}</a> (${x.hazard_type || "Other"})</li>`).join("");
    els.gdacsSummary.innerHTML = `
      <p><strong>GDACS</strong></p>
      <p>Total GDACS items ingested in feed window: <strong>${gdacs.total_events ?? 0}</strong></p>
      <p>AFRO-linked mapped events: <strong>${fcvLinkedEvents}</strong></p>
      <p>Flood events (verified ${floodWindowDays}-day window): <strong>${floodEvents}</strong> | AFRO-relevant cyclone events: <strong>${cycloneEvents}</strong></p>
      <p>Projection outlook: <strong>${droughtProjectionSignals}</strong> drought projection signals | <strong>${cycloneProjectionSignals}</strong> cyclone projection/advisory signals.</p>
      <p>Hydrological flood-source posture: <strong>${cemsFloodStatus.overall || "unknown"}</strong>. ${cemsFloodText}</p>
      <p>Change since previous refresh: <strong>${deltaText(delta.gdacs_total_events_delta)}</strong></p>
      <p>Top mapped countries: ${topCountries}</p>
      <p>Latest items:</p>
      <ul>${latest || "<li>n/a</li>"}</ul>
    `;
  }

  if (els.reliefwebSummary) {
    const topCountries = (relief.top_countries || []).map((x) => `${x.country} (${x.count}${x.rank_delta == null ? "" : x.rank_delta > 0 ? `, rank +${x.rank_delta}` : x.rank_delta < 0 ? `, rank ${x.rank_delta}` : ", rank stable"})`).join(", ") || "n/a";
    const latest = (relief.latest_items || []).slice(0, 3).map((x) => `<li><a href="${x.url || "#"}" target="_blank" rel="noreferrer">${x.title || "Untitled"}</a></li>`).join("");
    const fewsTopCountries = (fews.top_countries || []).map((x) => `${x.country} (${x.count}${x.rank_delta == null ? "" : x.rank_delta > 0 ? `, rank +${x.rank_delta}` : x.rank_delta < 0 ? `, rank ${x.rank_delta}` : ", rank stable"})`).join(", ") || "n/a";
    const acapsTopCountries = (acaps.top_countries || []).map((x) => `${x.country} (${x.count}${x.rank_delta == null ? "" : x.rank_delta > 0 ? `, rank +${x.rank_delta}` : x.rank_delta < 0 ? `, rank ${x.rank_delta}` : ", rank stable"})`).join(", ") || "n/a";
    const acapsLatest = (acaps.latest_items || []).slice(0, 2).map((x) => `<li><a href="${x.url || "#"}" target="_blank" rel="noreferrer">${x.title || "Untitled"}</a> (${x.source || "ACAPS"})</li>`).join("");
    const acapsCrawlTelemetry = acapsStatus.pages_scanned != null
      ? `${acapsStatus.pages_scanned}/${acapsStatus.pages_cap || "?"} pages scanned`
      : "n/a";
    const acapsStopReason = acapsStatus.pagination_stopped_reason || "n/a";
    const rwApiDroppedScope = reliefwebApiStatus.dropped_scope_filtered ?? 0;
    const rwApiDroppedUnmapped = reliefwebApiStatus.dropped_unmapped_country ?? 0;
    const rwApiDroppedDup = reliefwebApiStatus.dropped_duplicate ?? 0;
    const acapsWarning = acapsStatus.pagination_warning
      ? `<p><span class="tag warn">ACAPS crawl warning</span> ${acapsStatus.pagination_warning}. Consider increasing ACAPS_MAX_ARCHIVE_PAGES or reviewing crawl strategy.</p>`
      : "";
    els.reliefwebSummary.innerHTML = `
      <p><strong>ReliefWeb (30-day window)</strong></p>
      <p>Total AFRO-linked reports: <strong>${relief.total_reports_30d ?? 0}</strong></p>
      <p><strong>ReliefWeb API scope filter:</strong> dropped ${rwApiDroppedScope} off-scope + ${rwApiDroppedUnmapped} unmapped; deduped ${rwApiDroppedDup} duplicates.</p>
      <p>Disease outbreak signals (ReliefWeb-derived): <strong>${diseaseSignals.length}</strong></p>
      <p>Change since previous refresh: <strong>${deltaText(delta.reliefweb_total_reports_30d_delta)}</strong></p>
      <p>Top countries: ${topCountries}</p>
      <p><strong>FEWS NET references/assets detected:</strong> ${fews.total_items ?? 0}</p>
      <p><strong>FEWS change since previous refresh:</strong> ${deltaText(delta.fews_total_items_delta)}</p>
      <p><strong>FEWS top mapped countries:</strong> ${fewsTopCountries}</p>
      <p><span class="tag warn">FEWS note</span> FEWS NET is currently used as a reference and downloadable-asset discovery source only. No country classification value is extracted into the forecast table.</p>
      <p><strong>ACAPS context items detected:</strong> ${acaps.total_items ?? 0}</p>
      <p><strong>ACAPS change since previous refresh:</strong> ${deltaText(delta.acaps_total_items_delta)}</p>
      <p><strong>ACAPS top mapped countries:</strong> ${acapsTopCountries}</p>
      <p><strong>ACAPS crawl telemetry:</strong> ${acapsCrawlTelemetry} | stop reason: ${acapsStopReason}</p>
      <p><span class="tag good">ACAPS note</span> ACAPS items are shown as humanitarian context and analysis updates, not as direct event counts.</p>
      ${acapsWarning}
      <p>Latest linked items:</p>
      <ul>${latest || "<li>n/a</li>"}</ul>
      <p>Latest ACAPS items:</p>
      <ul>${acapsLatest || "<li>n/a</li>"}</ul>
    `;
  }

  if (els.whoDonSummary) {
    const topCountries = (whoDon.top_countries || []).map((x) => `${x.country} (${x.count}${x.rank_delta == null ? "" : x.rank_delta > 0 ? `, rank +${x.rank_delta}` : x.rank_delta < 0 ? `, rank ${x.rank_delta}` : ", rank stable"})`).join(", ") || "n/a";
    const latest = (whoDon.latest_items || []).slice(0, 3).map((x) => `<li><a href="${x.url || "#"}" target="_blank" rel="noreferrer">${x.title || "Untitled"}</a>${x.disease ? ` (${x.disease})` : ""}</li>`).join("");
    const statusText = `${whoDonStatus.overall || "unknown"}`;
    const statusTag = whoDonStatus.overall === "available"
      ? '<span class="tag good">AVAILABLE</span>'
      : whoDonStatus.overall === "partial"
        ? '<span class="tag warn">PARTIAL</span>'
        : '<span class="tag bad">UNAVAILABLE</span>';
    const scanned = whoDonStatus.total_items_scanned ?? 0;
    const mapped = whoDonStatus.mapped_countries ?? 0;
    els.whoDonSummary.innerHTML = `
      <p><strong>WHO DON (30-day window)</strong></p>
      <p>Total AFRO-linked outbreak alerts: <strong>${whoDon.total_reports_30d ?? 0}</strong></p>
      <p>Change since previous refresh: <strong>${deltaText(delta.who_don_total_reports_30d_delta)}</strong></p>
      <p>Source status: ${statusTag} (${statusText})</p>
      <p>Feed scan telemetry: scanned ${scanned} items; mapped countries ${mapped}.</p>
      <p>Top countries: ${topCountries}</p>
      <p>Latest linked items:</p>
      <ul>${latest || "<li>n/a</li>"}</ul>
    `;
  }
}

function renderIcpacForecasts() {
  const forecasts = dashboardState.forecasts || [];
  if (!forecasts.length) {
    els.icpacFeed.innerHTML = t("noIcpacProducts");
    return;
  }

  els.icpacFeed.innerHTML = forecasts
    .slice(0, 30)
    .map((f) => {
      const tagClass = f.risk_level === "high" ? "bad" : f.risk_level === "watch" ? "warn" : "good";
      const level = (f.risk_level || "info").toUpperCase();
      return `
      <div class="feed-item">
        <a href="${f.url || "#"}" target="_blank" rel="noreferrer">${f.title || "ICPAC forecast product"}</a>
        <div>${(f.horizon || "unknown").toUpperCase()} | ${f.date_label || "date n/a"} | <span class="tag ${tagClass}">${level}</span></div>
      </div>
    `;
    })
    .join("");

  if (els.icpacSummary) {
    const byHorizon = forecasts.reduce((acc, f) => {
      const key = f.horizon || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const highSignals = forecasts.filter((f) => f.risk_level === "high").length;
    const watchSignals = forecasts.filter((f) => f.risk_level === "watch").length;
    const latestItems = forecasts.slice(0, 3).map((f) => `${(f.horizon || "unknown").toUpperCase()}: ${f.title || "Untitled"}`).join(" | ");
    els.icpacSummary.innerHTML = `
      <p><strong>Total bulletins loaded:</strong> ${forecasts.length}</p>
      <p><strong>By horizon:</strong> Weekly ${byHorizon.weekly || 0}, Monthly ${byHorizon.monthly || 0}, Seasonal ${byHorizon.seasonal || 0}</p>
      <p><strong>Signal profile:</strong> High ${highSignals}, Watch ${watchSignals}, Informational ${Math.max(0, forecasts.length - highSignals - watchSignals)}</p>
      <p><strong>Latest products:</strong> ${latestItems || "n/a"}</p>
    `;
  }
}

function renderOperationalReportPage() {
  if (!dashboardState || !els.operationalBulletinCover || !els.operationalReportHeader || !els.operationalEventSummary || !els.operationalForecastSummary || !els.operationalConflictDisplacementSummary || !els.operationalPriorityTableBody || !els.operationalRecommendations || !els.operationalSourceDetail || !els.operationalBulletinGovernance || !els.operationalBulletinApproval || !els.operationalDecisionProtocol || !els.operationalBulletinFooter || !els.operationalConflictDisplacementInsert || !els.operationalCountryAnnexes) {
    return;
  }

  const countries = dashboardState.countries || [];
  const isFr = currentLanguage === "fr";
  const tr = (enText, frText) => (isFr ? frText : enText);
  const top = countries.slice(0, 10);
  const withIpc = countries.filter((c) => c.ipc != null);
  const projectedHigh = countries.filter((c) => (c.ipc?.projection_phase3plus_pct || 0) >= 0.3).length;
  const fewsMl1High = countries.filter((c) => (c.fews_ipc?.ml1_phase || 0) >= 3).length;
  const fewsCsHigh = countries.filter((c) => (c.fews_ipc?.cs_phase || 0) >= 3).length;
  const hazards = dashboardState.hazards || [];
  const reports30d = (dashboardState.reports || []).filter((r) => r.in30Days);
  const droughtSignals = dashboardState.drought_signals || [];
  const conflictDisplacementSignals = dashboardState.conflict_displacement_signals || [];
  const forecasts = dashboardState.forecasts || [];
  const cycloneIntel = dashboardState.cyclone_intelligence || {};
  const cycloneSourceStatus = dashboardState.cyclone_source_status || {};
  const cemsFloodStatus = dashboardState.cems_flood_source_status || {};
  const sourceSummaries = dashboardState.source_summaries || {};
  const reliefwebApiStatus = dashboardState.reliefweb_api_status || {};
  const delta = sourceSummaries.delta || {};
  const combinedRecommendations = aiRecommendations?.combined || [];
  const criticalRecommendationCount = combinedRecommendations.filter((rec) => rec.priority === "critical").length;
  const highRecommendationCount = combinedRecommendations.filter((rec) => rec.priority === "high").length;
  const priorityWatchlist = top.slice(0, 5).map((c) => `${c.country} (${c.risk_score})`).join(", ") || "n/a";
  const gdacsTopCountries = (sourceSummaries.gdacs?.top_countries || []).slice(0, 3).map((x) => `${x.country} (${x.count})`).join(", ") || "n/a";
  const reliefTopCountries = (sourceSummaries.reliefweb?.top_countries || []).slice(0, 3).map((x) => `${x.country} (${x.count})`).join(", ") || "n/a";
  const latestForecastTitles = forecasts.slice(0, 3).map((item) => `<li>${(item.horizon || "unknown").toUpperCase()}: ${item.title || "Untitled"}</li>`).join("");
  const highestRiskCountry = top[0]?.country || "n/a";
  const topAlertList = (dashboardState.top_alerts || []).slice(0, 5).map((x) => `${x.country} (${x.risk_score})`).join(", ") || "n/a";
  const conflictCountries = countries.filter((c) => (c.conflict_signal_count || 0) > 0);
  const displacementCountries = countries.filter((c) => (c.displacement_signal_count || 0) > 0);
  const overlapCountries = countries.filter((c) => (c.conflict_signal_count || 0) > 0 && (c.displacement_signal_count || 0) > 0);
  const conflictTopCountries = conflictCountries.slice(0, 4).map((c) => `${c.country} (${c.conflict_signal_count})`).join(", ") || "n/a";
  // Use displacement leaders when conflict leaders are unavailable but displacement signals exist
  const leadingSignalCountries = conflictCountries.length > 0 ? conflictTopCountries : (displacementCountries.length > 0 ? displacementTopCountries : "n/a");
  const displacementTopCountries = displacementCountries.slice(0, 4).map((c) => `${c.country} (${c.displacement_signal_count})`).join(", ") || "n/a";
  const floodCountries = countries.filter((c) => (c.flood_count || 0) > 0);
  const floodTopCountries = floodCountries.slice(0, 4).map((c) => `${c.country} (${c.flood_count || 0})`).join(", ") || "n/a";
  const floodOverlapCountries = countries.filter((c) => (c.flood_count || 0) > 0 && (c.ipc?.phase3plus_pct || 0) >= 0.2);
  const latestConflictItems = conflictDisplacementSignals.slice(0, 4).map((item) => `<li><a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled"}</a> (${(item.signal_tags || []).join(" / ") || "Signal"})</li>`).join("");
  const conflictInsertCountries = countries
    .filter((c) => (c.conflict_signal_count || 0) > 0 || (c.displacement_signal_count || 0) > 0)
    .sort((a, b) => (((b.conflict_signal_count || 0) + (b.displacement_signal_count || 0)) - ((a.conflict_signal_count || 0) + (a.displacement_signal_count || 0))) || (b.risk_score - a.risk_score))
    .slice(0, 6);
  const issueCode = formatIssueCode(dashboardState.generated_at);
  const nextUpdate = humanAgeFromIso(dashboardState.generated_at) === "n/a"
    ? tr("next refresh cycle", "prochain cycle de rafraichissement")
    : tr("next automated refresh cycle", "prochain cycle de rafraichissement automatique");
  const annexCountries = [...countries]
    .sort((a, b) => {
      const scoreA = ((a.conflict_signal_count || 0) * 6) + ((a.displacement_signal_count || 0) * 6) + ((a.report_count_30d || 0) * 2) + (a.hazard_count || 0) + (a.drought_signal_count || 0) + ((a.risk_score || 0) / 10);
      const scoreB = ((b.conflict_signal_count || 0) * 6) + ((b.displacement_signal_count || 0) * 6) + ((b.report_count_30d || 0) * 2) + (b.hazard_count || 0) + (b.drought_signal_count || 0) + ((b.risk_score || 0) / 10);
      return scoreB - scoreA;
    })
    .slice(0, 3);
  const conflictSourceMix = conflictSignalSourceSummary(conflictDisplacementSignals);
  const acapsStatus = dashboardState.acaps_source_status || {};
  const iomDtmStatus = dashboardState.iom_dtm_source_status || {};
  const conflictStatus = dashboardState.conflict_displacement_source_status || {};
  const conflictCandidatesCurrent = conflictStatus.candidate_items_current || conflictStatus.candidate_items_30d || {};
  const conflictMatched = conflictStatus.matched_signal_items || {};
  const unhcrMatchedTotal = Number(conflictMatched["unhcr total"] || 0);
  const acapsWarning = acapsStatus.pagination_warning || null;
  const projectedShare = countries.length ? (projectedHigh / countries.length) : 0;
  const ipcVeryStaleCountries = staleIpcEntries(countries);
  const unhcrFallbackOnly = unhcrMatchedTotal > 0 && Number(conflictMatched["unhcr rss"] || 0) === 0;
  const coverQualitySignals = [];
  if (ipcVeryStaleCountries.length > 0) {
    const coverStaleNames = ipcVeryStaleCountries
      .slice(0, 4)
      .map((c) => `${c.country} (${c.ageMonths}m)`)
      .join(", ");
    const coverStaleMore = ipcVeryStaleCountries.length > 4 ? ` plus ${ipcVeryStaleCountries.length - 4} more` : "";
    coverQualitySignals.push(`${ipcVeryStaleCountries.length} very stale IPC: ${coverStaleNames}${coverStaleMore}`);
  }
  if (acapsWarning) {
    coverQualitySignals.push("ACAPS cap pressure");
  }
  if (unhcrFallbackOnly) {
    coverQualitySignals.push("UNHCR fallback-only");
  }
  const coverQualitySeverity = coverQualitySignals.length >= 2 ? "bad" : coverQualitySignals.length === 1 ? "warn" : "ok";
  const coverQualityLabel = coverQualitySeverity === "bad"
    ? tr("Action needed", "Action requise")
    : coverQualitySeverity === "warn"
      ? tr("Monitor", "Surveiller")
      : tr("Good", "Bon");
  const coverQualityNote = coverQualitySignals.length ? coverQualitySignals.join(" | ") : "No major data quality flags in this refresh.";
  const coverQualityInterpretation = coverQualitySeverity === "bad"
    ? tr(
      "Action needed indicates at least two active governance risks; leadership decisions should include explicit validation language before operational action.",
      "Action requise indique au moins deux risques de gouvernance actifs; les decisions de direction doivent inclure une mention explicite de validation avant action operationnelle."
    )
    : coverQualitySeverity === "warn"
      ? tr(
        "Monitor indicates one active governance risk; decisions should note the affected source limitation and confirm the latest available validation.",
        "Surveiller indique un risque de gouvernance actif; les decisions doivent noter la limitation de source concernee et confirmer la derniere validation disponible."
      )
      : tr(
        "Good indicates no major governance risks are active in this refresh, though routine country validation still applies.",
        "Bon indique qu'aucun risque majeur de gouvernance n'est actif dans ce cycle, mais la validation pays de routine reste necessaire."
      );
  const coverQualityLegendMarkup = ipcVeryStaleCountries.length
    ? '<p id="bulletinCoverQualityLegend" class="bulletin-cover-quality-legend"><strong>Legend:</strong> m = months since latest IPC analysis.</p>'
    : "";
  const rwDroppedScope = Number(reliefwebApiStatus.dropped_scope_filtered || 0);
  const rwDroppedUnmapped = Number(reliefwebApiStatus.dropped_unmapped_country || 0);
  const rwDroppedDup = Number(reliefwebApiStatus.dropped_duplicate || 0);
  const filterIntegrityPolicy = dashboardState.filter_integrity_policy || {};
  const filterIntegrityWarnThreshold = Number.isFinite(Number(filterIntegrityPolicy.warn_threshold))
    ? Number(filterIntegrityPolicy.warn_threshold)
    : 1;
  const filterIntegrityBadThresholdRaw = Number.isFinite(Number(filterIntegrityPolicy.bad_threshold))
    ? Number(filterIntegrityPolicy.bad_threshold)
    : 25;
  const filterIntegrityBadThreshold = Math.max(filterIntegrityWarnThreshold, filterIntegrityBadThresholdRaw);
  const filterIntegrityTotalDropped = rwDroppedScope + rwDroppedUnmapped;
  const filterIntegritySeverity = filterIntegrityTotalDropped >= filterIntegrityBadThreshold
    ? "bad"
    : filterIntegrityTotalDropped >= filterIntegrityWarnThreshold
      ? "warn"
      : "ok";
  const filterIntegrityLabel = filterIntegritySeverity === "bad"
    ? tr("Escalate review", "Escalader la revue")
    : filterIntegritySeverity === "warn"
      ? tr("Filtering active", "Filtrage actif")
      : tr("No scope drops", "Aucune exclusion de perimetre");
  const filterIntegrityDetail = `ReliefWeb API dropped ${rwDroppedScope} off-scope + ${rwDroppedUnmapped} unmapped (total ${filterIntegrityTotalDropped}); deduped ${rwDroppedDup} duplicates. Thresholds warn>=${filterIntegrityWarnThreshold}, bad>=${filterIntegrityBadThreshold}.`;
  const coverMessages = [
    tr(
      `Top operational attention remains centered on ${highestRiskCountry} and the current watchlist of ${priorityWatchlist}.`,
      `L'attention operationnelle prioritaire reste concentree sur ${highestRiskCountry} et la liste de surveillance actuelle ${priorityWatchlist}.`
    ),
    tr(
      `${projectedHigh} countries currently show projected IPC Phase 3+ burden at or above 30%, requiring close follow-up on food-security deterioration.`,
      `${projectedHigh} pays montrent actuellement une charge IPC Phase 3+ projetee egale ou superieure a 30%, necessitant un suivi etroit de la deterioration de la securite alimentaire.`
    ),
    tr(
      `${fewsMl1High} countries currently show FEWS near-term phase 3+ conditions, adding forward-looking food-security stress context.`,
      `${fewsMl1High} pays montrent actuellement des conditions FEWS a court terme phase 3+, ajoutant un contexte de stress alimentaire prospectif.`
    ),
    tr(
      `${cycloneIntel.projection_signal_count || 0} cyclone projection or advisory signals, ${droughtSignals.length} drought signals, and ${floodCountries.length} countries with mapped flood signals were captured in this refresh.`,
      `${cycloneIntel.projection_signal_count || 0} signaux de projection/avis cyclone, ${droughtSignals.length} signaux secheresse et ${floodCountries.length} pays avec signaux inondation cartographies ont ete captures dans ce cycle.`
    ),
    tr(
      `${conflictDisplacementSignals.length} conflict or displacement reporting signals were matched from online source items (${conflictSourceMix}), led by ${leadingSignalCountries}.`,
      `${conflictDisplacementSignals.length} signaux de rapportage conflit/deplacement ont ete identifies a partir d'elements source en ligne (${conflictSourceMix}), menes par ${leadingSignalCountries}.`
    )
  ];
  const activeCycloneLocations = summarizeActiveCycloneLocations(cycloneIntel.active_cyclones || []);
  const operationalCurrentText = `${hazards.length} hazards, ${reports30d.length} reports, ${conflictDisplacementSignals.length} conflict/displacement matches`;
  const operationalProjectionText = `${cycloneIntel.projection_signal_count || 0} cyclone advisories, ${droughtSignals.length} drought signals, ${projectedHigh} countries with IPC projected burden >= 30%`;
  const operationalConfidenceLevel = (Number(cycloneSourceStatus.available_count || 0) > 0 && Number(reliefwebApiStatus.matching_signals || 0) > 0 && Number(reports30d.length || 0) > 0)
    ? "good"
    : (Number(reliefwebApiStatus.matching_signals || 0) > 0 || Number(cycloneSourceStatus.available_count || 0) > 0)
      ? "warn"
      : "bad";
  const operationalConfidenceText = operationalConfidenceLevel === "good"
    ? tr("Multiple verified event and projection channels are active in this refresh.", "Plusieurs canaux verifies d'evenements et de projections sont actifs dans ce cycle.")
    : operationalConfidenceLevel === "warn"
      ? tr("Partial source coverage is active; verify priority calls with country teams.", "Une couverture partielle des sources est active; verifier les priorites avec les equipes pays.")
      : tr("Low source coverage in this cycle; defer high-stakes interpretation until next refresh.", "Couverture source faible dans ce cycle; reporter les interpretations a fort enjeu jusqu'au prochain cycle.");
  const bulletinHighlights = [
    {
      title: tr("Operational Focus", "Focus operationnel"),
      body: tr(
        `Highest immediate composite pressure is concentrated in ${highestRiskCountry}, with the current priority watchlist covering ${priorityWatchlist}.`,
        `La pression composite immediate la plus elevee est concentree sur ${highestRiskCountry}, avec une liste de priorite couvrant ${priorityWatchlist}.`
      )
    },
    {
      title: tr("Forecast Outlook", "Perspective previsionnelle"),
      body: tr(
        `${forecasts.length} ICPAC bulletins are loaded; IPC projected Phase 3+ is >=30% in ${projectedHigh} countries, and FEWS near-term phase 3+ appears in ${fewsMl1High} countries.`,
        `${forecasts.length} bulletins ICPAC sont charges; l'IPC phase 3+ projetee est >=30% dans ${projectedHigh} pays, et FEWS court terme phase 3+ apparait dans ${fewsMl1High} pays.`
      )
    },
    {
      title: tr("Source Signal Status", "Statut des signaux source"),
      body: tr(
        `This bulletin draws on GDACS, ReliefWeb, IPC, ICPAC, FEWS Data Warehouse, ${cycloneSourceStatus.checked_count ?? 0} dedicated cyclone-source checks, and Copernicus flood-source posture checks in the current refresh cycle.`,
        `Ce bulletin s'appuie sur GDACS, ReliefWeb, IPC, ICPAC, FEWS Data Warehouse, ${cycloneSourceStatus.checked_count ?? 0} verifications de sources cyclone dediees, et les verifications de posture source inondation Copernicus dans ce cycle.`
      )
    },
    {
      title: tr("Conflict And Displacement", "Conflits et deplacements"),
      body: tr(
        `${conflictCountries.length} countries show conflict-related reporting signals and ${displacementCountries.length} show displacement-related reporting signals in the current source window.`,
        `${conflictCountries.length} pays montrent des signaux de rapportage lies aux conflits et ${displacementCountries.length} montrent des signaux lies aux deplacements dans la fenetre source actuelle.`
      )
    },
    {
      title: tr("Flood Exposure", "Exposition aux inondations"),
      body: tr(
        `${floodCountries.length} countries show mapped flood signals from current GDACS and ReliefWeb evidence, led by ${floodTopCountries}. Copernicus flood posture is ${cemsFloodStatus.overall || "unknown"}.`,
        `${floodCountries.length} pays montrent des signaux d'inondation cartographies a partir des evidences GDACS et ReliefWeb actuelles, menes par ${floodTopCountries}. La posture inondation Copernicus est ${cemsFloodStatus.overall || "unknown"}.`
      )
    }
  ];

  els.operationalBulletinCover.innerHTML = `
    <div class="bulletin-cover-shell">
      <div class="bulletin-cover-header">
        <img
          class="bulletin-cover-logo"
          src="https://www.who.int/ResourcePackages/WHO/assets/dist/images/logos/en/h-logo-blue.svg"
          alt="World Health Organization"
        />
        <div>
          <p class="bulletin-cover-kicker">World Health Organization Regional Office for Africa</p>
          <h2 class="bulletin-cover-title">Humanitarian Operational Situation Bulletin</h2>
          <p class="bulletin-cover-subtitle">Regional Africa decision brief synthesizing public hazard, forecast, nutrition, and food-security signals with FCV, AFRO, and other-Africa grouping.</p>
        </div>
      </div>
      <div class="bulletin-cover-grid">
        <div class="bulletin-cover-card bulletin-cover-card-primary">
          <span class="bulletin-meta-label">Issue Number</span>
          <strong>${issueCode}</strong>
          <p><strong>Issue date:</strong> <span title="${dashboardState.generated_at || "n/a"}">${formatDateTime(dashboardState.generated_at)}</span></p>
          <p><strong>Coverage:</strong> ${scopeCoverageLabel()}.</p>
        </div>
        <div class="bulletin-cover-card">
          <span class="bulletin-meta-label">Reporting Basis</span>
          <strong>Refresh-driven public-source synthesis</strong>
          <p>GDACS ${sourceSummaries.gdacs?.total_events ?? 0}, ReliefWeb ${sourceSummaries.reliefweb?.total_reports_30d ?? 0}, ICPAC ${forecasts.length}, cyclone checks ${cycloneSourceStatus.checked_count ?? 0}, Copernicus flood posture ${cemsFloodStatus.overall || "unknown"}.</p>
        </div>
        <div class="bulletin-cover-card bulletin-cover-quality-card bulletin-cover-quality-${coverQualitySeverity}" aria-describedby="bulletinCoverQualityNote bulletinCoverQualityInterpretation${ipcVeryStaleCountries.length ? ' bulletinCoverQualityLegend' : ''}">
          <span class="bulletin-meta-label">Data Quality Status</span>
          <strong>${coverQualityLabel}</strong>
          <p id="bulletinCoverQualityNote">${coverQualityNote}</p>
          <p id="bulletinCoverQualityInterpretation" class="bulletin-cover-quality-interpretation">${coverQualityInterpretation}</p>
          ${coverQualityLegendMarkup}
        </div>
        <div class="bulletin-cover-card bulletin-cover-quality-card bulletin-cover-quality-${filterIntegritySeverity}">
          <span class="bulletin-meta-label">Filter Integrity</span>
          <strong>${filterIntegrityLabel}</strong>
          <p>${filterIntegrityDetail}</p>
        </div>
      </div>
      <div class="bulletin-cover-message-box">
        <h3>Key Messages</h3>
        <ol class="bulletin-cover-messages">
          ${coverMessages.map((item) => `<li>${item}</li>`).join("")}
        </ol>
      </div>
    </div>
  `;

  els.operationalReportHeader.innerHTML = `
    <div class="bulletin-masthead">
      <div>
        <p class="bulletin-kicker">World Health Organization Regional Office for Africa</p>
        <h3 class="bulletin-title">Humanitarian Operational Situation Bulletin</h3>
        <p class="bulletin-subtitle">Multi-hazard, nutrition, and forecast intelligence brief for AFRO regional leadership review.</p>
      </div>
      <div class="bulletin-stamp">
        <span class="bulletin-stamp-label">Issue Date</span>
        <strong title="${dashboardState.generated_at || "n/a"}">${formatDateTime(dashboardState.generated_at)}</strong>
        <span>Public-source daily issue</span>
      </div>
    </div>
    <div class="bulletin-meta-grid">
      <div class="bulletin-meta-card">
        <span class="bulletin-meta-label">Coverage</span>
        <strong>${scopeCoverageLabel()}</strong>
        <span>${freshnessMode === "strict" ? "Strict current data" : "Lenient nutrition view enabled"}</span>
      </div>
      <div class="bulletin-meta-card">
        <span class="bulletin-meta-label">Recommendation Load</span>
        <strong>${combinedRecommendations.length}</strong>
        <span>${criticalRecommendationCount} critical, ${highRecommendationCount} high</span>
      </div>
      <div class="bulletin-meta-card">
        <span class="bulletin-meta-label">Source Basis</span>
        <strong>${sourceSummaries.gdacs?.total_events ?? 0} GDACS | ${sourceSummaries.reliefweb?.total_reports_30d ?? 0} RW</strong>
        <span>${forecasts.length} ICPAC bulletins, FEWS IPC phases, ${cycloneSourceStatus.checked_count ?? 0} cyclone checks, Copernicus flood ${cemsFloodStatus.overall || "unknown"}</span>
      </div>
    </div>
    <div class="bulletin-lead-box">
      <p><strong>Priority watchlist:</strong> ${priorityWatchlist}</p>
      <p><strong>Top alerts by composite risk:</strong> ${topAlertList}.</p>
      <p><strong>Purpose:</strong> Multi-source operational decision brief integrating hazards, reports, forecasts, projections, and recommendations for leadership review.</p>
    </div>
    <div class="bulletin-highlight-grid">
      ${bulletinHighlights.map((item) => `
        <article class="bulletin-highlight-card">
          <h4>${item.title}</h4>
          <p>${item.body}</p>
        </article>
      `).join("")}
    </div>
  `;

  els.operationalEventSummary.innerHTML = `
    ${renderCurrentProjectionConfidence(operationalCurrentText, operationalProjectionText, operationalConfidenceText, operationalConfidenceLevel)}
    <p><strong>Current vs projection lens:</strong> current events are drawn from verified GDACS and ReliefWeb source updates; projection outlook is drawn from IPC projections and monitored drought/cyclone advisories.</p>
    <ul class="bulletin-list">
      <li><strong>Current event situation:</strong> ${hazards.length} GDACS hazard feed items; ${floodCountries.length} flood-linked countries; ${reports30d.length} ReliefWeb reports (30d); ${conflictDisplacementSignals.length} conflict/displacement matches across ${overlapCountries.length} overlap countries.</li>
      <li><strong>Projection outlook:</strong> ${cycloneIntel.projection_signal_count || 0} cyclone projection/advisory signals and ${droughtSignals.length} drought projection signals; IPC projected burden remains available per country in forecast and country views.</li>
      <li><strong>Verified cyclone activity now:</strong> ${cycloneIntel.active_cyclone_count || 0} active named cyclones${(cycloneIntel.active_cyclone_count || 0) ? ` across ${activeCycloneLocations}` : ", no active named cyclone currently in window"}.</li>
      <li><strong>Hydrological flood-source posture:</strong> Copernicus CEMS Flood / GloFAS is ${cemsFloodStatus.overall || "unknown"}${cemsFloodStatus.live_portal_requires_login ? "; live portal access is credentialed, so no direct real-time extraction is claimed" : ""}.</li>
      <li><strong>Top alerts by composite risk:</strong> ${topAlertList}.</li>
      <li><strong>Change since previous refresh:</strong> GDACS ${formatSignedDelta(delta.gdacs_total_events_delta ?? 0)}, ReliefWeb ${formatSignedDelta(delta.reliefweb_total_reports_30d_delta ?? 0)}.</li>
    </ul>
    ${(() => {
      const _floodEvts = getFloodContext().afroFloodEvents;
      const recentFlood = [..._floodEvts]
        .filter((item) => isApprovedVisibleEventSource(item.source || "GDACS"))
        .sort((a, b) => {
          const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
          const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
          return db - da;
        })
        .slice(0, 8);
      if (!recentFlood.length) {
        return '<p><strong>Recent flood events:</strong> <span class="tag warn">No GDACS or ReliefWeb flood events found in the current feed window.</span></p>';
      }
      const itemsHtml = recentFlood.map((h) => {
        const cLabel = (h.countries || []).join(", ") || "AFRO regional";
        const src = h.source || "GDACS";
        return '<li><a href="' + (h.link || "#") + '" target="_blank" rel="noreferrer">' + (h.title || "Untitled flood event") + '</a><br><span class="bulletin-source-badge-wrap">' + renderSourceTrustBadge(src) + '</span><em>' + cLabel + ' | <span title="' + (h.pubDate || "n/a") + '">' + formatDateTime(h.pubDate) + '</span> | ' + src + '</em></li>';
      }).join("");
      return '<p><strong>Recent flood events <span class="tag good">GDACS + ReliefWeb verified</span></strong></p><ul class="bulletin-list bulletin-sublist">' + itemsHtml + '</ul>';
    })()}
    <p class="exec-caveat"><span class="tag warn">Source standard</span> Event listings draw exclusively from GDACS (EC/World Bank) and ReliefWeb (OCHA). News websites are not monitored. Items update automatically on each dashboard refresh.</p>
  `;

  els.operationalForecastSummary.innerHTML = `
    <ul class="bulletin-list">
      <li><strong>ICPAC bulletins loaded:</strong> ${forecasts.length}, spanning weekly, monthly, and seasonal horizons.</li>
      <li><strong>Countries with IPC current data:</strong> ${withIpc.length}; projected IPC Phase 3+ burden is at or above 30% in ${projectedHigh} countries.</li>
      <li><strong>FEWS stress posture:</strong> Current Situation phase 3+ in ${fewsCsHigh} countries; Near-Term (ML1) phase 3+ in ${fewsMl1High} countries.</li>
      <li><strong>Drought forecast signals:</strong> ${droughtSignals.length} country-linked source signals in the current refresh.</li>
      <li><strong>Flood-food security overlap:</strong> ${floodOverlapCountries.length ? floodOverlapCountries.map((c) => c.country).join(", ") : "n/a"}.</li>
      <li><strong>Cyclone source posture:</strong> ${cycloneSourceStatus.with_signal_count ?? 0} of ${cycloneSourceStatus.checked_count ?? 0} dedicated cyclone sources returned actionable signals.</li>
      <li><strong>Latest forecast products:</strong></li>
    </ul>
    <ul class="bulletin-list bulletin-sublist">${latestForecastTitles || "<li>n/a</li>"}</ul>
    <p><strong>Forecast note:</strong> source-driven outlook is primary; numeric trend projections remain fallback analytics when official country-level numbers are absent.</p>
  `;

  els.operationalConflictDisplacementSummary.innerHTML = `
    <ul class="bulletin-list">
      <li><strong>Countries with conflict-related reporting:</strong> ${conflictCountries.length}, led by ${conflictTopCountries}.</li>
      <li><strong>Countries with displacement-related reporting:</strong> ${displacementCountries.length}, led by ${displacementTopCountries}.</li>
      <li><strong>Conflict-displacement overlap:</strong> ${overlapCountries.length} countries currently show both signal types.</li>
      <li><strong>Source basis:</strong> ${conflictDisplacementSignals.length} online source items matched transparent conflict and displacement signal rules in this refresh (${conflictSourceMix}).</li>
    </ul>
    <ul class="bulletin-list bulletin-sublist">${latestConflictItems || "<li>n/a</li>"}</ul>
    <p><strong>Interpretation note:</strong> these are source-derived reporting signals for leadership triage and follow-up validation, not verified incident or displacement caseload totals.</p>
  `;

  els.operationalPriorityTableBody.innerHTML = top.map((c) => `
    <tr>
      <td><strong>${c.country}</strong></td>
      <td>${c.risk_score}</td>
      <td>${c.ipc?.phase3plus_pct != null ? `${formatNum(c.ipc.phase3plus_pct * 100, 1)}%` : "n/a"}</td>
      <td>${c.ipc?.projection_phase3plus_pct != null ? `${formatNum(c.ipc.projection_phase3plus_pct * 100, 1)}%` : "n/a"}</td>
      <td>${c.hazard_count}</td>
      <td>${c.flood_count || 0}</td>
      <td>${c.conflict_signal_count || 0}</td>
      <td>${c.displacement_signal_count || 0}</td>
      <td>${c.cyclone_count}</td>
      <td>${c.report_count_30d}</td>
    </tr>
  `).join("");

  renderRecommendationList(
    els.operationalRecommendations,
    combinedRecommendations,
    t("noRecommendations")
  );

  if (ipcVeryStaleCountries.length) {
    const countryList = ipcVeryStaleCountries.slice(0, 5).map((c) => `${c.country} (${c.ageMonths}m)`).join(", ");
    const moreCount = ipcVeryStaleCountries.length > 5 ? `, plus ${ipcVeryStaleCountries.length - 5} more` : "";
    els.operationalRecommendations.insertAdjacentHTML(
      "beforeend",
      `<p class="executive-caveat"><span class="tag bad">Governance rule</span> IPC analysis is very stale (36+ months) for ${countryList}${moreCount}. Any recommendation using IPC burden must include a country-validation disclaimer before leadership action.</p>`
    );
  }

  const gdacsLatest = (sourceSummaries.gdacs?.latest_items || []).slice(0, 4).map((x) => `<li><a href="${x.url || "#"}" target="_blank" rel="noreferrer">${x.title || "Untitled"}</a></li>`).join("");
  const reliefLatest = (sourceSummaries.reliefweb?.latest_items || []).slice(0, 4).map((x) => `<li><a href="${x.url || "#"}" target="_blank" rel="noreferrer">${x.title || "Untitled"}</a></li>`).join("");
  const acapsMode = String(acapsStatus.crawl_mode || "deep").toLowerCase();
  const acapsModeLabel = acapsMode === "fast" ? "FAST" : "DEEP";
  const acapsCapStreak = acapsStatus.pagination_cap_reached_streak != null ? Number(acapsStatus.pagination_cap_reached_streak) : null;
  const rwApiDroppedScope = reliefwebApiStatus.dropped_scope_filtered ?? 0;
  const rwApiDroppedUnmapped = reliefwebApiStatus.dropped_unmapped_country ?? 0;
  const rwApiDroppedDup = reliefwebApiStatus.dropped_duplicate ?? 0;
  const iomLatest = (dashboardState.iom_dtm_reports || [])
    .slice(0, 4)
    .map((item) => `<li><a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled"}</a></li>`)
    .join("");
  const iomStatusLabel = String(iomDtmStatus.overall || "unavailable");
  const iomStatusDetail = `status ${iomStatusLabel}; scanned ${iomDtmStatus.total_items_scanned ?? 0}; mapped 30d ${iomDtmStatus.fcv_items_30d ?? 0}; countries ${iomDtmStatus.mapped_countries ?? 0}`;
  const iomStatusError = iomDtmStatus.error ? ` (${iomDtmStatus.error})` : "";
  const acapsCoverageNote = acapsWarning
    ? `cap pressure active — page cap reached in ${acapsCapStreak != null && acapsCapStreak > 0 ? `${acapsCapStreak} consecutive refresh${acapsCapStreak === 1 ? "" : "es"}` : "consecutive refreshes"}; some archive items may be missed.`
    : "no cap-pressure warning in this cycle.";
  els.operationalSourceDetail.innerHTML = `
    <p><strong>GDACS summary:</strong> ${(sourceSummaries.gdacs?.total_events ?? 0)} events (delta ${sourceSummaries.delta?.gdacs_total_events_delta ?? "n/a"}). Top countries: ${gdacsTopCountries}.</p>
    <ul>${gdacsLatest || "<li>n/a</li>"}</ul>
    <p><strong>ReliefWeb summary:</strong> ${(sourceSummaries.reliefweb?.total_reports_30d ?? 0)} reports in 30d window (delta ${sourceSummaries.delta?.reliefweb_total_reports_30d_delta ?? "n/a"}). Top countries: ${reliefTopCountries}.</p>
    <p><strong>ReliefWeb API scope control:</strong> ${rwApiDroppedScope} off-scope + ${rwApiDroppedUnmapped} unmapped items dropped; ${rwApiDroppedDup} duplicates removed in this cycle.</p>
    <ul>${reliefLatest || "<li>n/a</li>"}</ul>
    <p><strong>ACAPS crawl posture:</strong> mode ${acapsModeLabel}; scanned ${acapsStatus.pages_scanned ?? 0}/${acapsStatus.pages_cap ?? "n/a"} archive pages; captured ${acapsStatus.total_items ?? 0} AFRO-linked items; ${acapsCoverageNote}</p>
    <p><strong>IOM DTM displacement feed:</strong> ${iomStatusDetail}${iomStatusError}. Current connector is metadata-first and does not extract full caseload tables from DTM documents.</p>
    <ul>${iomLatest || "<li>No IOM DTM links mapped in this refresh.</li>"}</ul>
    <p><strong>Conflict and displacement signal summary:</strong> ${conflictDisplacementSignals.length} matched items from ${conflictSourceMix}. Conflict hotspots: ${conflictTopCountries}. Displacement hotspots: ${displacementTopCountries}.</p>
    <p><strong>Flood signal summary:</strong> ${floodCountries.length} countries with mapped flood signals. Priority overlap with IPC >=20%: ${floodOverlapCountries.length ? floodOverlapCountries.map((c) => `${c.country} (${formatNum((c.ipc?.phase3plus_pct || 0) * 100, 1)}%)`).join(", ") : "n/a"}.</p>
  `;

  els.operationalBulletinGovernance.innerHTML = `
    <div class="bulletin-governance-grid">
      <div class="bulletin-governance-card">
        <span class="bulletin-meta-label">Issue Number</span>
        <strong>${issueCode}</strong>
        <p>Prepared from the current public-source dashboard refresh dated <span title="${dashboardState.generated_at || "n/a"}">${formatDateTime(dashboardState.generated_at)}</span>.</p>
      </div>
      <div class="bulletin-governance-card">
        <span class="bulletin-meta-label">Prepared By</span>
        <strong>WHO AFRO FCV Public-Source Monitoring</strong>
        <p>Automated synthesis of public online humanitarian, forecast, and hazard sources for leadership briefing.</p>
      </div>
      <div class="bulletin-governance-card">
        <span class="bulletin-meta-label">Distribution</span>
        <strong>Regional leadership and technical focal points</strong>
        <p>For operational orientation, prioritization, and follow-up validation with country and partner channels.</p>
      </div>
    </div>
  `;

  els.operationalBulletinApproval.innerHTML = `
    <div class="bulletin-approval-grid">
      <div class="bulletin-approval-card">
        <span class="bulletin-meta-label">Prepared By</span>
        <strong>WHO AFRO FCV Public-Source Monitoring Cell</strong>
        <p>Analytical synthesis for daily leadership orientation.</p>
      </div>
      <div class="bulletin-approval-card">
        <span class="bulletin-meta-label">Cleared For Circulation</span>
        <strong>Regional FCV coordination review</strong>
        <p>Placeholder for internal review or delegated clearance workflow.</p>
      </div>
      <div class="bulletin-approval-card">
        <span class="bulletin-meta-label">Contact Line</span>
        <strong>WHO AFRO FCV humanitarian monitoring desk</strong>
        <p>Use the linked source detail and country validation channels for follow-up action.</p>
      </div>
    </div>
  `;

  const triggerRows = [
    {
      trigger: tr("Food Security Deterioration", "Deterioration securite alimentaire"),
      threshold: tr("IPC projected Phase 3+ >= 30% in >= 3 countries OR FEWS ML1 phase >= 3 in >= 4 countries", "IPC phase 3+ projetee >= 30% dans >= 3 pays OU FEWS ML1 phase >= 3 dans >= 4 pays"),
      current: `IPC ${projectedHigh} countries (${formatNum(projectedShare * 100, 1)}%); FEWS ML1 ${fewsMl1High} countries`,
      status: projectedHigh >= 3 || fewsMl1High >= 4 ? "active" : "watch",
      action: tr("Convene food-security technical review within 24h; validate with country office and cluster leads.", "Convoquer une revue technique securite alimentaire sous 24h; valider avec les bureaux pays et les clusters.")
    },
    {
      trigger: tr("Conflict/Displacement Escalation", "Escalade conflit/deplacement"),
      threshold: tr("UNHCR matched displacement signals >= 5 in current refresh", "Signaux de deplacement UNHCR identifies >= 5 dans ce cycle"),
      current: tr(`${unhcrMatchedTotal} matched`, `${unhcrMatchedTotal} identifies`),
      status: unhcrMatchedTotal >= 5 ? "active" : "watch",
      action: tr("Initiate displacement access and service continuity check for top affected countries.", "Initier une verification de l'acces deplacement et de la continuite des services pour les principaux pays affectes.")
    },
    {
      trigger: tr("Source Coverage Pressure", "Pression couverture source"),
      threshold: tr("ACAPS crawl cap warning streak >= 3", "Serie d'alerte cap ACAPS >= 3"),
      current: acapsWarning || tr("none", "aucun"),
      status: acapsWarning ? "active" : "watch",
      action: tr("Review crawl depth configuration and source retrieval strategy before next leadership briefing.", "Revoir la configuration de profondeur de crawl et la strategie de recuperation source avant le prochain briefing de direction.")
    },
    {
      trigger: tr("Multi-signal Country Priority", "Priorite pays multi-signaux"),
      threshold: tr("Risk >= 70 with both conflict and displacement signals", "Risque >= 70 avec signaux conflit et deplacement"),
      current: `${countries.filter((c) => (c.risk_score || 0) >= 70 && (c.conflict_signal_count || 0) > 0 && (c.displacement_signal_count || 0) > 0).length} countries`,
      status: countries.some((c) => (c.risk_score || 0) >= 70 && (c.conflict_signal_count || 0) > 0 && (c.displacement_signal_count || 0) > 0) ? "active" : "watch",
      action: tr("Escalate integrated country support review (health, nutrition, and emergency operations).", "Escalader la revue integree d'appui pays (sante, nutrition et operations d'urgence).")
    },
    {
      trigger: tr("Flood-Food Security Overlap", "Chevauchement inondation-securite alimentaire"),
      threshold: tr("Flood signals > 0 with IPC Phase 3+ >= 20%", "Signaux inondation > 0 avec IPC phase 3+ >= 20%"),
      current: `${countries.filter((c) => (c.flood_count || 0) > 0 && (c.ipc?.phase3plus_pct || 0) >= 0.2).length} countries`,
      status: countries.some((c) => (c.flood_count || 0) > 0 && (c.ipc?.phase3plus_pct || 0) >= 0.2) ? "active" : "watch",
      action: tr("Validate access disruption, pre-position food and nutrition stocks, and confirm district-level exposure before leadership escalation.", "Valider les ruptures d'acces, prepositionner les stocks alimentaires et nutritionnels, et confirmer l'exposition au niveau district avant escalation a la direction.")
    }
  ];

  const triggerRowsMarkup = triggerRows.map((row) => `
    <tr>
      <td><strong>${row.trigger}</strong></td>
      <td>${row.threshold}</td>
      <td>${row.current}</td>
      <td><span class="tag ${row.status === "active" ? "bad" : "warn"}">${row.status === "active" ? tr("Active", "Actif") : tr("Watch", "Surveillance")}</span></td>
      <td>${row.action}</td>
    </tr>
  `).join("");

  els.operationalDecisionProtocol.innerHTML = `
    <p><strong>${tr("Use", "Usage")}:</strong> ${tr("This matrix links current signal states to recommended leadership actions. Trigger status is refresh-driven and must be validated with country and partner channels before formal activation.", "Cette matrice relie les etats de signaux actuels aux actions recommandees pour la direction. Le statut des declencheurs depend du cycle de rafraichissement et doit etre valide avec les canaux pays et partenaires avant activation formelle.")}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>${tr("Trigger", "Declencheur")}</th>
            <th>${tr("Threshold", "Seuil")}</th>
            <th>${tr("Current Status", "Statut actuel")}</th>
            <th>${tr("State", "Etat")}</th>
            <th>${tr("Recommended Action", "Action recommandee")}</th>
          </tr>
        </thead>
        <tbody>${triggerRowsMarkup}</tbody>
      </table>
    </div>
    <p><span class="tag warn">${tr("Protocol note", "Note protocole")}</span> ${tr("If any trigger is Active for two consecutive refresh cycles, escalate to same-day regional leadership review and issue a country validation request.", "Si un declencheur est Actif pendant deux cycles consecutifs, escalader vers une revue regionale le jour meme et emettre une demande de validation pays.")}</p>
  `;

  els.operationalBulletinFooter.innerHTML = `
    <div class="bulletin-footer-shell">
      <div>
        <p><strong>Prepared from public sources:</strong> GDACS, ReliefWeb, WHO DON, IPC/HDX, FEWS Data Warehouse, ICPAC, World Bank, ACAPS, ACLED Conflict Index, and dedicated cyclone-source monitoring integrated in this dashboard.</p>
        <p><strong>Use note:</strong> This bulletin supports rapid management review and does not replace official country validation, incident management processes, or field verification.</p>
        <p class="bulletin-footer-governance-note bulletin-footer-governance-${coverQualitySeverity}"><strong>Data quality (${coverQualityLabel}):</strong> ${coverQualityInterpretation}</p>
      </div>
      <div class="bulletin-footer-meta">
        <span><strong>Issue:</strong> ${issueCode}</span>
        <span><strong>Issued:</strong> <span title="${dashboardState.generated_at || "n/a"}">${formatDateTime(dashboardState.generated_at)}</span></span>
        <span><strong>Next update:</strong> ${nextUpdate}</span>
      </div>
    </div>
  `;

  els.operationalConflictDisplacementInsert.innerHTML = conflictInsertCountries.map((country) => {
    const countrySignals = conflictDisplacementSignals
      .filter((item) => (item.countries || []).includes(country.iso3))
      .slice(0, 3);
    const signal = conflictsDisplacementSignalLabel(country);
    const sourceItems = countrySignals.length
      ? countrySignals.map((item) => `<li><a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled"}</a> (${(item.signal_tags || []).join(" / ") || "Signal"}; <span title="${item.date_label || "n/a"}">${formatDateTime(item.date_label)}</span>)</li>`).join("")
      : "<li>No linked conflict or displacement source item is visible in the current refresh.</li>";

    return `
      <article class="bulletin-conflict-insert-card">
        <div class="bulletin-conflict-insert-header">
          <div>
            <p class="bulletin-annex-kicker">Conflict And Displacement Watch</p>
            <h3>${country.country}</h3>
            <p>${compactTrackLabel(country.fcv_track)}</p>
          </div>
          <div class="bulletin-annex-scorecard">
            <span class="bulletin-meta-label">Signal Level</span>
            <strong>${signal.label}</strong>
            <span>Risk ${country.risk_score}</span>
          </div>
        </div>
        <div class="bulletin-annex-metrics bulletin-conflict-insert-metrics">
          <div class="annex-metric-card"><span>Conflict</span><strong>${country.conflict_signal_count || 0}</strong></div>
          <div class="annex-metric-card"><span>Displacement</span><strong>${country.displacement_signal_count || 0}</strong></div>
          <div class="annex-metric-card"><span>Reports 30d</span><strong>${country.report_count_30d || 0}</strong></div>
          <div class="annex-metric-card"><span>IPC 3+ Current</span><strong>${country.ipc?.phase3plus_pct != null ? `${formatNum(country.ipc.phase3plus_pct * 100, 1)}%` : "n/a"}</strong></div>
        </div>
        <div class="bulletin-annex-grid">
          <div class="bulletin-annex-block">
            <h4>Operational Reading</h4>
            <ul class="bulletin-list">
              <li>${country.conflict_signal_count || 0} conflict-related reporting signal(s) were matched in the current source window.</li>
              <li>${country.displacement_signal_count || 0} displacement-related reporting signal(s) were matched in the current source window.</li>
              <li>${country.report_count_30d || 0} total ReliefWeb reports were linked to this country in the last 30 days.</li>
            </ul>
          </div>
          <div class="bulletin-annex-block">
            <h4>Linked Source Evidence</h4>
            <ul class="bulletin-list">${sourceItems}</ul>
          </div>
        </div>
      </article>
    `;
  }).join("") || tr("No conflict or displacement insert content is available in this refresh.", "Aucun contenu d'encart conflit/deplacement n'est disponible dans ce cycle.");

  els.operationalCountryAnnexes.innerHTML = annexCountries.map((country, index) => {
    const wasting = latestAvailableIndicatorValue(country.indicators?.wasting_u5_pct);
    const stunting = latestAvailableIndicatorValue(country.indicators?.stunting_u5_pct);
    const anemia = latestAvailableIndicatorValue(country.indicators?.pregnant_anemia_pct);
    const countryHazards = (dashboardState.hazards || []).filter((item) => (item.countries || []).includes(country.iso3)).slice(0, 3);
    const countryReports = (dashboardState.reports || []).filter((item) => item.in30Days && (item.countries || []).includes(country.iso3)).slice(0, 3);
    const countryForecasts = (dashboardState.forecasts || []).filter((item) => titleMentionsCountry(item.title, country.country)).slice(0, 3);
    const annexActions = [];

    if ((country.ipc?.projection_phase3plus_pct || 0) >= 0.3) {
      annexActions.push(`Projected IPC Phase 3+ burden is ${formatNum((country.ipc?.projection_phase3plus_pct || 0) * 100, 1)}%; prioritize food-security and health contingency review.`);
    }
    if ((country.hazard_count || 0) > 0) {
      annexActions.push(`${country.hazard_count} hazard signal(s) are active in the current refresh and should be cross-checked with country operations updates.`);
    }
    if ((country.cyclone_count || 0) > 0) {
      annexActions.push(`${country.cyclone_count} cyclone-linked signal(s) are associated with this country profile; keep logistics and readiness assumptions under review.`);
    }
    if ((country.report_count_30d || 0) >= 3) {
      annexActions.push(`${country.report_count_30d} ReliefWeb reports were linked in the last 30 days, indicating sustained reporting pressure and information flow.`);
    }
    if ((country.conflict_signal_count || 0) > 0) {
      annexActions.push(`${country.conflict_signal_count} conflict-related reporting signal(s) were captured for this country in the current source window.`);
    }
    if ((country.displacement_signal_count || 0) > 0) {
      annexActions.push(`${country.displacement_signal_count} displacement-related reporting signal(s) were captured for this country in the current source window.`);
    }
    if ((country.drought_signal_count || 0) > 0) {
      annexActions.push(`${country.drought_signal_count} drought-related source signal(s) were captured in the current source window.`);
    }
    if (!annexActions.length) {
      annexActions.push("Maintain routine monitoring and validate this country profile against the latest country office and partner updates.");
    }

    let decisionText = "Maintain enhanced monitoring and validate operational implications with the latest country office and partner updates.";
    if ((country.ipc?.projection_phase3plus_pct || 0) >= 0.3 && (country.hazard_count || 0) > 0) {
      decisionText = "Escalate joint review of food-security and hazard readiness assumptions, with immediate verification of operational constraints and response triggers.";
    } else if ((country.conflict_signal_count || 0) > 0 && (country.displacement_signal_count || 0) > 0) {
      decisionText = "Escalate validation of access, protection, and service continuity implications because both conflict and displacement reporting signals are active for this country profile.";
    } else if ((country.cyclone_count || 0) > 0) {
      decisionText = "Maintain cyclone readiness posture and verify logistics continuity, access constraints, and exposure updates with country teams.";
    } else if ((country.report_count_30d || 0) >= 3) {
      decisionText = "Sustain close information monitoring and validate whether repeated reporting signals indicate worsening humanitarian conditions requiring management attention.";
    }

    const dataNotes = [
      `AFRO track: ${compactTrackLabel(country.fcv_track)}.`,
      `Data quality: ${country.data_quality || "n/a"}.`,
      `Current IPC Phase 3+ burden: ${country.ipc?.phase3plus_pct != null ? `${formatNum(country.ipc.phase3plus_pct * 100, 1)}%` : "n/a"}.`,
      `Conflict signals: ${country.conflict_signal_count || 0}; displacement signals: ${country.displacement_signal_count || 0}.`,
      `Under-5 wasting: ${wasting?.value != null ? `${formatNum(wasting.value)}% (${wasting.year || "n/a"})` : "n/a"}.`,
      `Under-5 stunting: ${stunting?.value != null ? `${formatNum(stunting.value)}% (${stunting.year || "n/a"})` : "n/a"}.`,
      `Pregnant women anemia: ${anemia?.value != null ? `${formatNum(anemia.value)}% (${anemia.year || "n/a"})` : "n/a"}.`
    ];

    const hazardItems = countryHazards.length
      ? countryHazards.map((item) => `<li><a href="${item.link || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled hazard event"}</a> (${item.hazard_type || "Other"}; <span title="${item.pubDate || "n/a"}">${formatDateTime(item.pubDate)}</span>)</li>`).join("")
      : "<li>No country-linked GDACS hazard item is visible in the current refresh.</li>";
    const reportItems = countryReports.length
      ? countryReports.map((item) => `<li><a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled report"}</a> (${item.source || "ReliefWeb"}; <span title="${item.created || "n/a"}">${formatDateTime(item.created)}</span>)</li>`).join("")
      : "<li>No country-linked ReliefWeb report is visible in the current 30-day window.</li>";
    const forecastItems = countryForecasts.length
      ? countryForecasts.map((item) => `<li><a href="${item.url || "#"}" target="_blank" rel="noreferrer">${item.title || "Untitled forecast product"}</a> (${(item.horizon || "unknown").toUpperCase()}; ${item.date_label || "date n/a"})</li>`).join("")
      : `<li>No country-named ICPAC product was detected in the current bulletin titles. Use the regional forecast summary and country validation channels for interpretation.</li>`;

    return `
      <article class="bulletin-annex-article">
        <div class="bulletin-annex-header">
          <div>
            <p class="bulletin-annex-kicker">Country Annex ${index + 1}</p>
            <h3>${country.country}</h3>
            <p>${qualityTag(country)} <span class="annex-track-tag">${compactTrackLabel(country.fcv_track)}</span></p>
          </div>
          <div class="bulletin-annex-scorecard">
            <span class="bulletin-meta-label">Composite Risk</span>
            <strong>${country.risk_score}</strong>
            <span>Issue ${issueCode}</span>
          </div>
        </div>
        <div class="bulletin-annex-decision-box">
          <span class="bulletin-meta-label">Immediate Decision Focus</span>
          <p>${decisionText}</p>
        </div>
        <div class="bulletin-annex-metrics">
          <div class="annex-metric-card"><span>IPC 3+ Current</span><strong>${country.ipc?.phase3plus_pct != null ? `${formatNum(country.ipc.phase3plus_pct * 100, 1)}%` : "n/a"}</strong></div>
          <div class="annex-metric-card"><span>IPC 3+ Projected</span><strong>${country.ipc?.projection_phase3plus_pct != null ? `${formatNum(country.ipc.projection_phase3plus_pct * 100, 1)}%` : "n/a"}</strong></div>
          <div class="annex-metric-card"><span>Hazards</span><strong>${country.hazard_count || 0}</strong></div>
          <div class="annex-metric-card"><span>Cyclones</span><strong>${country.cyclone_count || 0}</strong></div>
          <div class="annex-metric-card"><span>Reports 30d</span><strong>${country.report_count_30d || 0}</strong></div>
          <div class="annex-metric-card"><span>Drought Signals</span><strong>${country.drought_signal_count || 0}</strong></div>
        </div>
        <div class="bulletin-annex-grid">
          <div class="bulletin-annex-block">
            <h4>Operational Considerations</h4>
            <ul class="bulletin-list">
              ${annexActions.map((item) => `<li>${item}</li>`).join("")}
            </ul>
          </div>
          <div class="bulletin-annex-block">
            <h4>Profile Snapshot</h4>
            <ul class="bulletin-list">
              ${dataNotes.map((item) => `<li>${item}</li>`).join("")}
            </ul>
          </div>
        </div>
        <div class="bulletin-annex-grid bulletin-annex-grid-sources">
          <div class="bulletin-annex-block">
            <h4>Country-Linked Hazard Items</h4>
            <ul class="bulletin-list">${hazardItems}</ul>
          </div>
          <div class="bulletin-annex-block">
            <h4>Country-Linked Reports</h4>
            <ul class="bulletin-list">${reportItems}</ul>
          </div>
        </div>
        <div class="bulletin-annex-block bulletin-annex-forecast-block">
          <h4>Forecast References</h4>
          <ul class="bulletin-list">${forecastItems}</ul>
        </div>
      </article>
    `;
  }).join("");
}

function renderCyclonePage() {
  if (!dashboardState || !els.cycloneSummary || !els.cycloneProjectionFeed || !els.cycloneCountryTableBody || !els.activeCyclonesList || !els.cycloneSourceTableBody || !els.cycloneSourceAlert) {
    return;
  }

  const hazards = dashboardState.hazards || [];
  const cycloneIntel = dashboardState.cyclone_intelligence || {};
  const cycloneSourceStatus = dashboardState.cyclone_source_status || cycloneIntel.dedicated_source_status || {};
  const cycloneEvents = hazards.filter((h) => /cyclone/i.test(`${h.hazard_type || ""} ${h.title || ""}`) && h.afro_context !== false);
  const projectionSignals = cycloneIntel.projection_signals || [];
  const activeCyclones = cycloneIntel.active_cyclones || [];
  const historicalCyclones = cycloneIntel.historical_cyclones || activeCyclones;
  const recentWindowDays = Number(cycloneIntel.recent_window_days || 180);
  const projectionMappedIso3 = new Set((projectionSignals || []).flatMap((signal) => signal?.countries || []).filter(Boolean));
  const countries = [...(dashboardState.countries || [])]
    .filter((c) => c.cyclone_count > 0 || projectionMappedIso3.has(c.iso3))
    .sort((a, b) => (b.cyclone_count - a.cyclone_count) || (b.risk_score - a.risk_score));
  const highest = countries[0] || null;
  const atRiskIpc = countries.filter((c) => c.ipc && c.ipc.phase3plus_pct >= 0.2).length;
  const sourceChecked = cycloneSourceStatus.checked_count || 0;
  const sourceAvailable = cycloneSourceStatus.available_count || 0;
  const sourceWithSignals = cycloneSourceStatus.with_signal_count || 0;
  const sourceState = cycloneSourceStatus.overall || "unknown";
  const sourceNames = (cycloneSourceStatus.sources || []).map((s) => s.source).join(", ") || "n/a";
  const hasDedicatedChecks = sourceChecked > 0;
  const allDedicatedFailed = hasDedicatedChecks && sourceAvailable === 0;
  const activeCycloneLocations = summarizeActiveCycloneLocations(activeCyclones);
  const currentText = `${historicalCyclones.length} verified cyclone systems in ${recentWindowDays}-day history`;
  const projectionText = `${projectionSignals.length} cyclone projection/advisory signals`;
  const confidenceLevel = sourceAvailable === sourceChecked && sourceChecked > 0 ? "good" : sourceAvailable > 0 ? "warn" : "bad";
  const confidenceText = confidenceLevel === "good"
    ? "All monitored cyclone sources are currently available."
    : confidenceLevel === "warn"
      ? "Some cyclone sources are available; maintain triangulation."
      : "Dedicated cyclone sources are unavailable this cycle; interpret with caution.";

  els.cycloneSourceAlert.style.display = allDedicatedFailed ? "block" : "none";
  if (allDedicatedFailed) {
    els.cycloneSourceAlert.innerHTML = `<strong>Cyclone Source Alert:</strong> All dedicated cyclone websites failed in this refresh cycle (${sourceChecked} checked, 0 available). Treat zero-signal outputs as connectivity-constrained until sources recover.`;
  } else {
    els.cycloneSourceAlert.innerHTML = "";
  }

  els.cycloneSummary.innerHTML = `
    ${renderCurrentProjectionConfidence(currentText, projectionText, confidenceText, confidenceLevel)}
    <p><strong>Cyclone-active countries:</strong> ${countries.length} out of ${dashboardState.scope.country_count} grouped Africa countries have cyclone-linked signals in the current refresh.</p>
    <p><strong>AFRO-relevant cyclone events in feed:</strong> ${cycloneEvents.length}.</p>
    <p><strong>Verified cyclone history:</strong> ${historicalCyclones.length} named or unnamed systems in the last ${recentWindowDays} days.</p>
    <p><strong>Projection signals:</strong> ${projectionSignals.length} projection/advisory items detected across monitored sources${projectionSignals.length && !historicalCyclones.length ? ", with no verified AFRO cyclone event currently documented" : ""}.</p>
    <p><strong>Projection signals with explicit country mapping:</strong> ${(dashboardState.cyclone_intelligence?.countries_with_projection_signal ?? projectionMappedIso3.size)}${(dashboardState.cyclone_intelligence?.projection_signal_countries || []).length ? ` (${(dashboardState.cyclone_intelligence?.projection_signal_countries || []).join(", ")})` : ""}.</p>
    <p><strong>Active named cyclones:</strong> ${activeCyclones.length} in the ${cycloneIntel.active_window_days || 21}-day active window${activeCyclones.length ? `, covering ${activeCycloneLocations}` : ""}.</p>
    <p><strong>Dedicated cyclone websites:</strong> ${sourceAvailable}/${sourceChecked} available, ${sourceWithSignals} with current signals, status ${sourceState}.</p>
    <p><strong>Dedicated source list:</strong> ${sourceNames}.</p>
    <p><strong>Highest cyclone pressure:</strong> ${highest ? `${highest.country} (${highest.cyclone_count} signals, risk ${highest.risk_score})` : "n/a"}.</p>
    <p><strong>IPC overlap:</strong> ${atRiskIpc} cyclone-active countries are also at IPC stress or crisis levels (Phase 3+ >= 20%).</p>
  `;

  els.cycloneCountryTableBody.innerHTML = countries.length
    ? countries.map((c) => `
      <tr>
        <td><strong>${c.country}</strong></td>
        <td>${c.cyclone_count}</td>
        <td>${c.hazard_count}</td>
        <td>${c.risk_score}</td>
        <td>${c.ipc ? `${formatNum(c.ipc.phase3plus_pct * 100, 1)}%` : "n/a"}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="5">No cyclone-linked countries in this refresh.</td></tr>';

  els.cycloneProjectionFeed.innerHTML = projectionSignals.length
    ? projectionSignals.slice(0, 30).map((p) => `
      <div class="feed-item">
        <a href="${p.url || "#"}" target="_blank" rel="noreferrer">${p.title || "Cyclone projection/advisory signal"}</a>
        <div>${p.source || "Source n/a"} | ${(p.horizon || "advisory").toUpperCase()} | ${cycloneSignalLocationText(p, countries, cycloneSourceStatus.sources || [])} | ${p.date_label ? `<span title="${p.date_label}">${formatDateTime(p.date_label)}</span>` : "date n/a"}</div>
        <div>${buildFeedAutoSummary(p, "Cyclone projection")}</div>
      </div>
    `).join("")
    : `No cyclone projection or advisory signals were detected in this refresh. Dedicated source status: ${sourceState} (${sourceAvailable}/${sourceChecked} available).`;

  els.cycloneSourceTableBody.innerHTML = (cycloneSourceStatus.sources || []).length
    ? (cycloneSourceStatus.sources || []).map((s) => {
      const statusTag = s.status === "available"
        ? '<span class="tag good">AVAILABLE</span>'
        : '<span class="tag bad">FAILED</span>';
      return `
      <tr>
        <td><strong>${s.source || "Source n/a"}</strong><br><a href="${s.url || "#"}" target="_blank" rel="noreferrer">${s.region_scope || "scope n/a"}</a></td>
        <td>${statusTag}</td>
        <td>${s.signal_count ?? 0}</td>
        <td>${s.http_status ?? "n/a"}</td>
        <td><span title="${s.checked_at || "n/a"}">${formatDateTime(s.checked_at)}</span></td>
      </tr>
    `;
    }).join("")
    : '<tr><td colspan="5">No dedicated cyclone source diagnostics were returned in this refresh.</td></tr>';

  els.activeCyclonesList.innerHTML = historicalCyclones.length
    ? historicalCyclones.map((c) => {
      const link = c.references?.[0]?.url || "#";
      const title = c.references?.[0]?.title || `${c.name} event reference`;
      const locationText = c.geo_labels?.join(", ") || c.countries?.join(", ") || "n/a";
      const sourceList = [...new Set((c.references || []).map((ref) => ref.source).filter(Boolean))].slice(0, 3).join(", ") || "Source n/a";
      return `
        <div class="alert-item">
          <strong>${c.name}</strong>
          <div>Events: ${c.event_count} | Latest update: <span title="${c.latest_update || "n/a"}">${formatDateTime(c.latest_update)}</span> | Locations: ${locationText}</div>
          <div>Verified sources: ${sourceList}</div>
          <div><a href="${link}" target="_blank" rel="noreferrer">${title}</a></div>
        </div>
      `;
    }).join("")
    : `No verified cyclone systems were detected in the last ${recentWindowDays} days from monitored sources.`;

  renderRecommendationList(
    els.cycloneRecommendations,
    aiRecommendations?.byIssue?.cyclone,
    t("noCycloneRecommendations")
  );
}

function buildAiRecommendations() {
  const countries = dashboardState.countries || [];
  const forecasts = dashboardState.forecasts || [];

  const byIssue = {
    conflictsDisplacement: [],
    foodSecurity: [],
    nutrition: [],
    forecast: [],
    cyclone: [],
    hazard: []
  };

  const crisisCountries = countries.filter((c) => c.ipc && c.ipc.phase3plus_pct >= 0.30);
  const conflictHotspots = countries.filter((c) => (c.conflict_signal_count || 0) >= 2);
  if (conflictHotspots.length) {
    byIssue.conflictsDisplacement.push({
      priority: "high",
      title: "Escalate Countries With Repeated Conflict Reporting",
      body: `${conflictHotspots.map((c) => `${c.country} (${c.conflict_signal_count})`).join(", ")} show repeated conflict-related reporting signals in the current 30-day source window. Validate protection, access, health-service continuity, and security constraints with country operations.`
    });
  }

  const displacementHotspots = countries.filter((c) => (c.displacement_signal_count || 0) >= 1 && (c.report_count_30d || 0) >= 2);
  if (displacementHotspots.length) {
    byIssue.conflictsDisplacement.push({
      priority: "high",
      title: "Prepare For Population Movement Pressure",
      body: `${displacementHotspots.map((c) => `${c.country} (displacement ${c.displacement_signal_count}, reports ${c.report_count_30d})`).join("; ")} show displacement-linked reporting pressure. Review service continuity, mobile response capacity, and partner access assumptions in likely receiving areas.`
    });
  }

  const conflictFoodSecurityOverlap = countries.filter((c) => (c.conflict_signal_count || 0) > 0 && ((c.ipc?.phase3plus_pct || 0) >= 0.2 || (c.ipc?.projection_phase3plus_pct || 0) >= 0.3));
  if (conflictFoodSecurityOverlap.length) {
    byIssue.conflictsDisplacement.push({
      priority: "critical",
      title: "Treat Conflict And Food-Security Overlap As Leadership Priority",
      body: `${conflictFoodSecurityOverlap.map((c) => `${c.country} (IPC current ${c.ipc?.phase3plus_pct != null ? `${formatNum((c.ipc.phase3plus_pct || 0) * 100, 1)}%` : "n/a"})`).join(", ")} combine conflict-related reporting with current or projected IPC burden. Use this overlap to prioritize inter-cluster decision review and operational access validation.`
    });
  }

  if (crisisCountries.length) {
    byIssue.foodSecurity.push({
      priority: "critical",
      title: "Escalate Phase 3+ Countries To Immediate Response",
      body: `${crisisCountries.map((c) => c.country).join(", ")} exceed the IPC Phase 3+ threshold of 30%. Prioritize emergency food access, therapeutic nutrition surge planning, and district-level referral pathways within the next operational cycle.`
    });
  }

  const phase45High = countries.filter((c) => c.ipc && ((c.ipc.phase4_number || 0) + (c.ipc.phase5_number || 0)) > 500000);
  if (phase45High.length) {
    byIssue.foodSecurity.push({
      priority: "high",
      title: "Protect Populations In IPC Phase 4/5",
      body: `${phase45High.map((c) => `${c.country} (${((c.ipc.phase4_number || 0) + (c.ipc.phase5_number || 0)).toLocaleString()})`).join("; ")} have very high emergency or catastrophe caseloads. Reinforce last-mile delivery capacity and triage partners to Phase 4/5 hotspots.`
    });
  }

  const noIpcWithRisk = countries.filter((c) => !c.ipc && c.risk_score >= 55);
  if (noIpcWithRisk.length) {
    byIssue.foodSecurity.push({
      priority: "medium",
      title: "Close IPC Coverage Gaps In High-Risk Countries",
      body: `${noIpcWithRisk.map((c) => c.country).join(", ")} show elevated composite risk without IPC coverage. Commission rapid assessments and preserve explicit uncertainty labels until food security classifications are updated.`
    });
  }

  const projectedIpcHigh = countries.filter((c) => c.ipc && c.ipc.projection_phase3plus_pct != null && c.ipc.projection_phase3plus_pct >= 0.3);
  if (projectedIpcHigh.length) {
    byIssue.foodSecurity.push({
      priority: "high",
      title: "Use IPC Projected Burden For Early Surge Planning",
      body: `${projectedIpcHigh.map((c) => `${c.country} (${formatNum((c.ipc.projection_phase3plus_pct || 0) * 100, 1)}%)`).join(", ")} show projected IPC Phase 3+ burden at or above 30%. Pre-position food-security and nutrition surge support before the projected window.`
    });
  }

  const highWasting = countries
    .filter((c) => c.indicators?.wasting_u5_pct?.latest?.value != null && c.indicators.wasting_u5_pct.latest.value >= 15)
    .sort((a, b) => b.indicators.wasting_u5_pct.latest.value - a.indicators.wasting_u5_pct.latest.value);
  if (highWasting.length) {
    byIssue.nutrition.push({
      priority: "high",
      title: "Prioritize Under-5 Wasting Hotspots",
      body: `${highWasting.slice(0, 5).map((c) => `${c.country} (${formatNum(c.indicators.wasting_u5_pct.latest.value)}%)`).join(", ")} exceed high burden thresholds. Intensify screening throughput, OTP readiness, and continuity of treatment in these countries.`
    });
  }

  const highAnemia = countries
    .filter((c) => c.indicators?.pregnant_anemia_pct?.latest?.value != null && c.indicators.pregnant_anemia_pct.latest.value >= 45)
    .sort((a, b) => b.indicators.pregnant_anemia_pct.latest.value - a.indicators.pregnant_anemia_pct.latest.value);
  if (highAnemia.length) {
    byIssue.nutrition.push({
      priority: "medium",
      title: "Strengthen Maternal Nutrition And Iron-Folate Coverage",
      body: `${highAnemia.slice(0, 5).map((c) => `${c.country} (${formatNum(c.indicators.pregnant_anemia_pct.latest.value)}%)`).join(", ")} indicate high maternal anemia burden. Emphasize ANC-linked supplementation and targeted follow-up in underserved districts.`
    });
  }

  const staleNutrition = countries.filter((c) => {
    const inds = [c.indicators?.wasting_u5_pct, c.indicators?.stunting_u5_pct, c.indicators?.pregnant_anemia_pct].filter(Boolean);
    return inds.some((i) => i.stale_warning);
  });
  if (staleNutrition.length >= 5) {
    byIssue.nutrition.push({
      priority: "medium",
      title: "Mitigate Nutrition Recency Risk",
      body: `${staleNutrition.length} countries rely on older nutrition snapshots. Prioritize data refresh pipelines and field verification to avoid mis-targeting based on lagging annual indicators.`
    });
  }

  const seasonalItems = forecasts.filter((f) => f.horizon === "seasonal");
  if (seasonalItems.length) {
    byIssue.forecast.push({
      priority: "high",
      title: "Use Seasonal Outlooks For Pre-Positioning",
      body: `${seasonalItems.length} seasonal ICPAC products are loaded. Link pre-positioning decisions to forecast windows and monitor districts where hazard exposure overlaps with IPC crisis burden.`
    });
  }

  const lowHistory = countries.filter((c) => (c.indicators?.wasting_u5_pct?.series || []).length < 4);
  if (lowHistory.length >= 4) {
    byIssue.forecast.push({
      priority: "medium",
      title: "Treat Numeric Projections As Low Confidence In Data-Sparse Countries",
      body: `${lowHistory.length} countries have short historical series for trend fallback. Keep these projections advisory only and elevate source bulletins over model outputs in operational briefings.`
    });
  }

  const droughtSignalCountries = countries.filter((c) => (c.drought_signal_count || 0) > 0);
  if (droughtSignalCountries.length) {
    byIssue.forecast.push({
      priority: "high",
      title: "Prioritize Countries With Source-Based Drought Signals",
      body: `${droughtSignalCountries.map((c) => `${c.country} (${c.drought_signal_count})`).join(", ")} have active drought-oriented forecast signals from ICPAC sources. Link water, food, and health contingency triggers to these forecasted stress windows.`
    });
  }

  const cycloneExposed = countries.filter((c) => c.cyclone_count >= 2);
  if (cycloneExposed.length) {
    byIssue.cyclone.push({
      priority: "high",
      title: "Activate Cyclone Contingency Logistics",
      body: `${cycloneExposed.map((c) => `${c.country} (${c.cyclone_count})`).join(", ")} show repeated cyclone-linked signals. Confirm route redundancy, stock mobility, and rapid damage reporting lines before access constraints escalate.`
    });
  }

  const cycloneWithIpc = countries.filter((c) => c.cyclone_count > 0 && c.ipc && c.ipc.phase3plus_pct >= 0.2);
  if (cycloneWithIpc.length) {
    byIssue.cyclone.push({
      priority: "medium",
      title: "Protect Food-Insecure Areas During Cyclone Exposure",
      body: `${cycloneWithIpc.map((c) => c.country).join(", ")} show cyclone signals with IPC stress or crisis burden. Prioritize continuity plans for nutrition supplies, access routes, and referral services in exposed districts.`
    });
  }

  const cycloneSignals = dashboardState.cyclone_intelligence?.projection_signals || [];
  const cycloneProjectionSignals = cycloneSignals.length;
  if (cycloneProjectionSignals > 0) {
    const cycloneSourceStatus = dashboardState.cyclone_source_status?.sources || [];
    const signalWhere = cycloneSignals
      .slice(0, 3)
      .map((s) => `${s.source || "source n/a"} (${cycloneSignalLocationText(s, countries, cycloneSourceStatus)})`)
      .join("; ");

    byIssue.cyclone.push({
      priority: "high",
      title: "Pre-Activation Based On Cyclone Projections",
      body: `${cycloneProjectionSignals} cyclone projection/advisory signals are active across monitored sources. Current signal locations: ${signalWhere}. Prepare standby logistics and pre-alert country offices in these geographies where access constraints are likely.`
    });
  }

  const highHazard = countries.filter((c) => c.hazard_count >= 3);
  if (highHazard.length) {
    byIssue.hazard.push({
      priority: "medium",
      title: "Focus Multi-Hazard Monitoring On Persistent Hotspots",
      body: `${highHazard.map((c) => `${c.country} (${c.hazard_count})`).join(", ")} have sustained hazard pressure. Increase event verification cadence and align inter-cluster triggers to hazard recurrence patterns.`
    });
  }

  const highFlood = countries.filter((c) => (c.flood_count || 0) >= 2);
  if (highFlood.length) {
    byIssue.hazard.push({
      priority: "high",
      title: "Escalate Flood-Exposed Food Security Corridors",
      body: `${highFlood.map((c) => `${c.country} (${c.flood_count || 0})`).join(", ")} show repeated flood signals. Validate access constraints, pre-position supplies, and prioritize IPC hotspot districts where flood exposure and food insecurity overlap.`
    });
  }

  const noIssueRecs = Object.values(byIssue).every((arr) => arr.length === 0);
  if (noIssueRecs) {
    byIssue.hazard.push({
      priority: "medium",
      title: "Maintain Baseline Readiness",
      body: "No high-priority thresholds were triggered in the current refresh. Keep surveillance active and reassess recommendations on the next data cycle."
    });
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2 };
  Object.keys(byIssue).forEach((k) => {
    byIssue[k].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  });

  const combined = [
    ...byIssue.conflictsDisplacement,
    ...byIssue.foodSecurity,
    ...byIssue.nutrition,
    ...byIssue.forecast,
    ...byIssue.cyclone,
    ...byIssue.hazard
  ].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    generatedAt: new Date().toISOString(),
    engine: "threshold-rule-engine-v1",
    byIssue,
    combined
  };
}

function renderRecommendations() {
  renderRecommendationList(
    els.recommendationsPanel,
    aiRecommendations?.combined,
    "No threshold-triggering recommendations are available for this refresh."
  );
  renderRecommendationList(
    els.nutritionRecommendations,
    aiRecommendations?.byIssue?.nutrition,
    "No nutrition recommendations can be generated from the current refresh."
  );
  renderRecommendationList(
    els.forecastRecommendations,
    aiRecommendations?.byIssue?.forecast,
    "No forecast recommendations can be generated from the current refresh."
  );
  renderRecommendationList(
    els.hazardRecommendations,
    aiRecommendations?.byIssue?.hazard,
    "No hazard recommendations can be generated from the current refresh."
  );
  renderRecommendationList(
    els.conflictsDisplacementRecommendations,
    aiRecommendations?.byIssue?.conflictsDisplacement,
    "No conflict or displacement recommendations were triggered in the current refresh."
  );
  renderRecommendationList(
    els.cycloneRecommendations,
    aiRecommendations?.byIssue?.cyclone,
    t("noCycloneRecommendations")
  );
  renderRecommendationList(
    els.foodSecurityRecommendations,
    aiRecommendations?.byIssue?.foodSecurity,
    "No food-security recommendations can be generated from the current refresh."
  );
}

function renderBriefingHighlights() {
  if (!els.briefingHighlights) {
    return;
  }
  const countries = dashboardState.countries || [];
  const top = countries.slice(0, 3);
  const highestCyclone = [...countries].sort((a, b) => b.cyclone_count - a.cyclone_count)[0];
  const highestWasting = [...countries]
    .filter((c) => c.indicators?.wasting_u5_pct?.latest?.value != null)
    .sort((a, b) => b.indicators.wasting_u5_pct.latest.value - a.indicators.wasting_u5_pct.latest.value)[0];
  const highestAcled = [...countries]
    .filter((c) => c.acled_index?.rank != null)
    .sort((a, b) => (a.acled_index.rank || Number.MAX_SAFE_INTEGER) - (b.acled_index.rank || Number.MAX_SAFE_INTEGER))[0];
  const acledStatus = dashboardState.acled_source_status || {};

  els.briefingHighlights.innerHTML = `
    <p><strong>Daily Snapshot</strong>: Generated at <span title="${dashboardState.generated_at || "n/a"}">${formatDateTime(dashboardState.generated_at)}</span> for ${scopeCoverageLabel()}.</p>
    <p><strong>Top risk countries</strong>: ${top.map((c) => `${c.country} (${c.risk_score})`).join(", ")}.</p>
    <p><strong>Highest cyclone signal</strong>: ${highestCyclone ? `${highestCyclone.country} (${highestCyclone.cyclone_count} mentions)` : "n/a"}.</p>
    <p><strong>Highest wasting signal</strong>: ${highestWasting ? `${highestWasting.country} (${formatNum(highestWasting.indicators.wasting_u5_pct.latest.value)}%)` : "n/a"}.</p>
    <p><strong>ACLED context loaded</strong>: ${acledStatus.fcv_rows || 0} AFRO rows this refresh${highestAcled ? `; highest ranked mapped country: ${highestAcled.country} (#${highestAcled.acled_index.rank}, ${highestAcled.acled_index.index_level || "Unknown"})` : ""}.</p>
    <p><strong>ICPAC bulletin stream</strong>: ${(dashboardState.forecasts || []).length} products loaded for forecast context.</p>
    <p><strong>IPC Phase Classification</strong>: ${(dashboardState.countries || []).filter(c => c.ipc).length} of ${dashboardState.scope.country_count} grouped Africa countries loaded from HDX.</p>
    <p>Use the sidebar pages or auto-display mode for guided briefing transitions.</p>
  `;
}

function renderSourceFreshness() {
  if (!els.sourceStrip) return;
  const sf = dashboardState.source_freshness || {};
  const cs = dashboardState.conflict_displacement_source_status || {};
  const acapsStatus = dashboardState.acaps_source_status || {};
  const acledStatus = dashboardState.acled_source_status || {};
  const reliefwebApiStatus = dashboardState.reliefweb_api_status || {};
  const c = cs.candidate_items_current || cs.candidate_items_30d || {};
  const m = cs.matched_signal_items || {};
  const unhcrMatched = (m["unhcr rss"] || 0) + (m["unhcr via reliefweb"] || 0) + (m["unhcr population data"] || 0);
  const sourceHealthClass = (candidateCount, matchedCount) => {
    if ((matchedCount || 0) > 0) {
      return "good";
    }
    if ((candidateCount || 0) > 0) {
      return "warn";
    }
    return "bad";
  };
  const items = [
    { label: "World Bank", key: "world_bank" },
    { label: "Nutrition/HDX", key: "nutrition_hdx" },
    { label: "GDACS", key: "gdacs" },
    { label: "ReliefWeb", key: "reliefweb" },
    { label: "WHO DON", key: "who_don" },
    { label: "ACAPS", key: "acaps" },
    { label: "ACLED", key: "acled" },
    { label: "FEWS NET", key: "fews_net" },
    { label: "ICPAC", key: "icpac" },
    { label: "Cyclone Sites", key: "cyclone_dedicated" },
    { label: "IPC/HDX", key: "ipc_hdx" }
  ];
  const now = Date.now();
  const age = (iso) => {
    if (!iso) return "n/a";
    const diff = Math.round((now - new Date(iso).getTime()) / 60000);
    if (diff < 60) return `${diff}m ago`;
    return `${Math.round(diff / 60)}h ago`;
  };
  const freshnessMarkup = items
    .map(item => `<span class="freshness-pill"><strong>${item.label}:</strong> ${age(sf[item.key])}</span>`)
    .join("");
  const idmcCandidate = Number(c.idmc || 0);
  const idmcMatched = Number(m["idmc rss"] || 0);
  const ochaCandidate = Number(c.unocha || 0);
  const ochaMatched = Number(m["ocha rss"] || 0);
  const unhcrCandidate = Number(c.unhcr || 0);
  const unhcrDirectMatched = Number(m["unhcr rss"] || 0);
  const unhcrFallbackMatched = Number(m["unhcr via reliefweb"] || 0);
  const unhcrPopulationMatched = Number(m["unhcr population data"] || 0);
  const reliefwebApiOverall = String(reliefwebApiStatus.overall || "disabled").toLowerCase();
  const reliefwebApiClass = reliefwebApiOverall === "active"
    ? "good"
    : reliefwebApiOverall === "configured_no_matches"
      ? "warn"
      : reliefwebApiOverall === "disabled"
        ? "warn"
        : "bad";
  const reliefwebApiConfiguredLabel = reliefwebApiStatus.appname_configured ? "configured" : "not configured";
  const reliefwebApiError = reliefwebApiStatus.error ? ` | error ${reliefwebApiStatus.error}` : "";
  const acapsWarningPill = acapsStatus.pagination_warning
    ? `<span class="freshness-pill"><span class="tag warn" title="ACAPS crawl pressure indicator">ACAPS crawl warning: ${acapsStatus.pagination_warning}</span></span>`
    : "";
  const conflictWidgetMarkup = `
    <span class="freshness-pill"><strong>ReliefWeb API:</strong> <span class="tag ${reliefwebApiClass}" title="ReliefWeb Reports API direct flood enrichment. Appname ${reliefwebApiConfiguredLabel}; ${reliefwebApiStatus.reports_returned || 0} reports returned; ${reliefwebApiStatus.matching_signals || 0} final API-tagged regional flood signals; dropped ${reliefwebApiStatus.dropped_scope_filtered || 0} off-scope + ${reliefwebApiStatus.dropped_unmapped_country || 0} unmapped; deduped ${reliefwebApiStatus.dropped_duplicate || 0}${reliefwebApiError}">${reliefwebApiOverall} ${(reliefwebApiStatus.matching_signals || 0)}/${(reliefwebApiStatus.reports_returned || 0)}</span></span>
    <span class="freshness-pill"><strong>Conflict Sources:</strong>
      <span class="conflict-pill-legend">(C/M = candidate/matched reporting)</span>
      <span class="tag ${sourceHealthClass(unhcrCandidate, unhcrMatched)}" title="UNHCR - C=${unhcrCandidate}, M=${unhcrMatched} (direct=${unhcrDirectMatched}, fallback via ReliefWeb=${unhcrFallbackMatched}, population stats=${unhcrPopulationMatched})">UNHCR ${unhcrCandidate}/${unhcrMatched}</span>
      <span class="tag ${sourceHealthClass(idmcCandidate, idmcMatched)}" title="IDMC RSS - C=${idmcCandidate}, M=${idmcMatched}">IDMC ${idmcCandidate}/${idmcMatched}</span>
      <span class="tag ${sourceHealthClass(ochaCandidate, ochaMatched)}" title="OCHA RSS - C=${ochaCandidate}, M=${ochaMatched}">OCHA ${ochaCandidate}/${ochaMatched}</span>
      <span class="conflict-pill-legend">updated ${age(cs.generated_at)}</span>
    </span>
    <span class="freshness-pill"><strong>ACLED Context:</strong> <span class="tag ${acledStatus.overall === "available" ? "good" : acledStatus.overall === "partial" ? "warn" : "bad"}" title="ACLED Conflict Index context rows mapped to AFRO countries">${acledStatus.fcv_rows || 0} rows / ${acledStatus.mapped_countries || 0} countries</span></span>
    ${acapsWarningPill}
  `;
  els.sourceStrip.innerHTML = `${freshnessMarkup}${conflictWidgetMarkup}`;
}

function renderMeta() {
  const ipc = dashboardState.ipc_source_status || {};
  const nutrition = dashboardState.nutrition_source_status || {};
  const nutritionHdx = dashboardState.nutrition_hdx_status || {};
  const cycloneSource = dashboardState.cyclone_source_status || {};
  const cemsFloodSource = dashboardState.cems_flood_source_status || {};
  const policy = dashboardState.freshness_policy || {};
  const ipcCount = (dashboardState.countries || []).filter((c) => c.ipc != null).length;
  const ipcLabel = ipc.status === "available" ? `IPC/HDX: ${ipcCount} countries loaded` : `IPC/HDX: ${ipc.status || "unknown"}` ;
  const wastingDisplayCoverage = nutrition.coverage?.wasting_u5_pct?.latest_display;
  const nutritionLabel = `Nutrition/WB: ${nutrition.overall || "unknown"}${wastingDisplayCoverage != null ? ` (wasting ${wastingDisplayCoverage}/${dashboardState.scope.country_count} shown)` : ""}`;
  const nutritionHdxLabel = `Nutrition/HDX fallback: ${nutritionHdx.overall || "unknown"}${nutritionHdx.applied_country_count != null ? ` (${nutritionHdx.applied_country_count} applied)` : ""}`;
  const cycloneLabel = `Cyclone sites: ${cycloneSource.overall || "unknown"}${cycloneSource.available_count != null ? ` (${cycloneSource.available_count}/${cycloneSource.checked_count} available)` : ""}`;
  const acledStatus = dashboardState.acled_source_status || {};
  const acapsStatus = dashboardState.acaps_source_status || {};
  const fewsStatus = dashboardState.fews_source_status || {};
  const reliefwebApiStatus = dashboardState.reliefweb_api_status || {};
  const acapsWarningLabel = acapsStatus.pagination_warning ? `, warning ${acapsStatus.pagination_warning}` : "";
  const acapsLabel = `ACAPS context: ${acapsStatus.overall || "unknown"}${acapsStatus.total_items != null ? ` (${acapsStatus.total_items} items` : ""}${acapsStatus.pages_scanned != null ? `, pages ${acapsStatus.pages_scanned}/${acapsStatus.pages_cap || "?"}` : ""}${acapsStatus.total_items != null ? ")" : ""}${acapsWarningLabel}`;
  const acledLabel = `ACLED context: ${acledStatus.overall || "unknown"}${acledStatus.fcv_rows != null ? ` (${acledStatus.fcv_rows} AFRO rows)` : ""}`;
  const fewsLabel = `FEWS references: ${fewsStatus.overall || "unknown"}${fewsStatus.country_hits != null ? ` (${fewsStatus.country_hits} country hits)` : ""}`;
  const reliefwebApiLabel = `ReliefWeb API: ${reliefwebApiStatus.overall || "unknown"}${reliefwebApiStatus.matching_signals != null ? ` (${reliefwebApiStatus.matching_signals}/${reliefwebApiStatus.reports_returned || 0} flood matches)` : ""}`;
  const cemsFloodLabel = `Copernicus flood: ${cemsFloodSource.overall || "unknown"}${cemsFloodSource.public_docs_available != null ? ` (${cemsFloodSource.public_docs_available}/${cemsFloodSource.public_docs_checked || 0} docs reachable${cemsFloodSource.live_portal_requires_login ? ", portal credentialed" : ""})` : ""}`;
  const freshnessLabel = policy.mode === "strict"
    ? `Freshness: strict (${policy.nutrition_max_age_years ?? "?"}y nutrition)`
    : "Freshness: advisory";
  els.metaLine.textContent = `Last refresh: ${formatDateTime(dashboardState.generated_at)} | Sources: World Bank API + HDX nutrition fallback, GDACS RSS, ReliefWeb RSS + ReliefWeb Reports API, Copernicus CEMS Flood / GloFAS posture checks, ACAPS public context cards, ACLED Conflict Index context, FEWS NET reference discovery, ICPAC, Meteo-France La Reunion, Cyclocane, WMO Severe Weather Information Centre, IPC via HDX | ${nutritionLabel} | ${nutritionHdxLabel} | ${cycloneLabel} | ${reliefwebApiLabel} | ${cemsFloodLabel} | ${acapsLabel} | ${acledLabel} | ${fewsLabel} | ${ipcLabel} | ${freshnessLabel} | Scope: ${scopeCoverageLabel()} grouped as FCV Prioritized, FCV Accelerated, AFRO, then Other Africa.`;
}

function updateNavBadges() {
  const countries = dashboardState.countries || [];
  const crisisSignal = countries.some(c =>
    (c.ipc && c.ipc.phase3plus_pct >= 0.30) || c.hazard_count > 3
  );
  const hazardSignal = countries.some(c => c.hazard_count > 3);
  const cycloneSignal = countries.some(c => c.cyclone_count >= 2);

  els.navBtns.forEach(btn => {
    const existing = btn.querySelector(".nav-badge");
    if (existing) existing.remove();

    const page = btn.dataset.page;
    let badge = null;

    if (page === "overviewPage" && crisisSignal) {
      badge = document.createElement("span");
      badge.className = "nav-badge badge-crisis";
      badge.textContent = "!";
    } else if (page === "cyclonePage" && cycloneSignal) {
      badge = document.createElement("span");
      badge.className = "nav-badge badge-info";
      badge.textContent = "!";
    } else if (page === "hazardPage" && hazardSignal) {
      badge = document.createElement("span");
      badge.className = "nav-badge badge-warn";
      badge.textContent = "!";
    } else if (page === "forecastPage" && cycloneSignal) {
      badge = document.createElement("span");
      badge.className = "nav-badge badge-info";
      badge.textContent = "i";
    }

    if (badge) btn.appendChild(badge);
  });
}

function populateCountrySelect() {
  els.countrySelect.innerHTML = (dashboardState.countries || [])
    .map((c) => `<option value="${c.iso3}">${c.country}</option>`)
    .join("");
}

async function waitForExportChartsReady(timeoutMs = 15000) {
  if (!dashboardState) {
    return { ok: false, reason: "no-dashboard-state" };
  }

  const selectedIso3 = els.countrySelect?.value || dashboardState.countries?.[0]?.iso3;

  // Ensure required charts are actively rendered before waiting on sentinel state.
  renderMap();
  if (selectedIso3) {
    renderTrend(selectedIso3);
    renderForecast(selectedIso3);
  }

  const waitFn = window.__dashboardWaitForChartsReady || waitForChartSentinels;
  return waitFn(["mapChart", "trendChart", "forecastChart"], { timeoutMs });
}

function bindEvents() {
  els.presentationModeBtn?.addEventListener("click", () => {
    isPresentationMode = !isPresentationMode;
    document.body.classList.toggle("presentation-mode", isPresentationMode);
    els.presentationModeBtn.textContent = isPresentationMode ? t("disablePresentationMode") : t("enablePresentationMode");
    if (isPresentationMode) {
      stopAutoRotate("presentation mode toggled");
    }
  });

  els.languageSelect?.addEventListener("change", (e) => {
    const nextLanguage = e.target.value === "fr" ? "fr" : "en";
    if (nextLanguage === currentLanguage) {
      return;
    }
    currentLanguage = nextLanguage;
    localStorage.setItem(LANGUAGE_CACHE_KEY, currentLanguage);
    applyLanguage();
    if (dashboardState) {
      buildBandLegend();
      buildMetrics();
      renderOverviewInsights();
      renderTopAlerts();
      renderCountryTable();
      renderServiceDeliveryPanel();
      renderFoodSecurityPage();
      renderNutritionPage();
      renderHazards();
      renderCyclonePage();
      renderReports();
      renderWhoDonAlerts();
      renderDiseaseOutbreakFeed();
      renderHazardSourceSummaries();
      renderConflictsDisplacementPage();
      renderIcpacForecasts();
      renderRecommendations();
      renderMeta();
      renderConfidenceLegend();
      renderBriefingHighlights();
      renderBriefingStrip();
      renderSourceFreshness();
      renderOperationalReportPage();
      renderDataValidationPanel();
      updateNavBadges();
      const selectedIso3 = els.countrySelect?.value || dashboardState.countries?.[0]?.iso3;
      if (selectedIso3) {
        renderTrend(selectedIso3);
        renderSummary(selectedIso3);
        renderForecast(selectedIso3);
      }
      renderMap();
      localizeDynamicBlocks();
      localizePageTextTree(document.body);
    }
  });

  els.showOriginalExcerptsToggle?.addEventListener("change", (e) => {
    showOriginalSourceExcerpts = Boolean(e.target.checked);
    localStorage.setItem(SOURCE_EXCERPTS_CACHE_KEY, showOriginalSourceExcerpts ? "1" : "0");
    if (!dashboardState) {
      return;
    }
    renderHazards();
    renderReports();
    renderWhoDonAlerts();
    renderDiseaseOutbreakFeed();
    renderConflictsDisplacementPage();
    renderCyclonePage();
    renderOperationalReportPage();
    localizeDynamicBlocks();
    localizePageTextTree(document.body);
  });

  els.sideNav.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-page]");
    if (!btn) {
      return;
    }
    setActivePage(btn.dataset.page);
  });

  els.metricGrid?.addEventListener("click", (e) => {
    const actionButton = e.target.closest("button[data-action]");
    if (!actionButton) {
      return;
    }
    if (actionButton.dataset.action === "open-service-delivery") {
      jumpToServiceDeliveryPanel();
      return;
    }
    if (actionButton.dataset.action === "open-forecast") {
      jumpToForecastPanel();
    }
  });

  els.autoRotateBtn.addEventListener("click", () => {
    if (autoRotateTimer) {
      stopAutoRotate();
      return;
    }

    startAutoRotate();
  });

  els.rotateIntervalSelect?.addEventListener("change", () => {
    if (autoRotateTimer) {
      stopAutoRotate("interval changed");
      startAutoRotate();
    }
  });

  let acapsBadgeLongPressTimer = null;
  let acapsBadgeLongPressTriggered = false;
  let acapsBadgePressed = null;
  let viewportRefreshTimer = null;
  const clearAcapsBadgeLongPress = () => {
    if (acapsBadgeLongPressTimer) {
      clearTimeout(acapsBadgeLongPressTimer);
      acapsBadgeLongPressTimer = null;
    }
    if (acapsBadgePressed) {
      acapsBadgePressed.classList.remove("is-pressing");
      acapsBadgePressed = null;
    }
  };

  window.addEventListener("resize", () => {
    if (viewportRefreshTimer) {
      clearTimeout(viewportRefreshTimer);
    }
    viewportRefreshTimer = setTimeout(() => {
      if (!dashboardState) {
        return;
      }
      renderBriefingStrip();
      if (activePageId() === "operationalReportPage") {
        renderOperationalReportPage();
      }
      refreshActivePageVisuals();
    }, 140);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !dashboardState) {
      return;
    }
    const generatedAt = dashboardState.generated_at ? new Date(dashboardState.generated_at).getTime() : 0;
    const ageMs = generatedAt > 0 ? (Date.now() - generatedAt) : Number.MAX_SAFE_INTEGER;
    if (!autoDataRefreshTimer || ageMs >= AUTO_DATA_REFRESH_MS) {
      loadDashboard({ forceRefresh: false });
    }
  });

  window.addEventListener("online", () => {
    loadDashboard({ forceRefresh: false });
  });

  els.refreshBtn.addEventListener("click", () => {
    stopAutoRotate("manual refresh");
    if (autoDataRefreshTimer) {
      clearTimeout(autoDataRefreshTimer);
      autoDataRefreshTimer = null;
    }
    loadDashboard({ forceRefresh: true });
  });

  els.exportDropdownBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    els.exportDropdown?.classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    if (els.exportDropdown && !els.exportDropdown.contains(e.target)) {
      els.exportDropdown.classList.remove("open");
    }
  });

  els.exportDropdownMenu?.addEventListener("click", async (e) => {
    const action = e.target.closest("button[data-export]")?.dataset?.export;
    if (!action) return;
    els.exportDropdown?.classList.remove("open");
    const originalLabel = els.exportDropdownBtn.textContent;
    els.exportDropdownBtn.disabled = true;

    if (action === "print") {
      stopAutoRotate("snapshot export");
      els.exportDropdownBtn.textContent = t("preparingExport");
      showExportStatus("Preparing export. Choose Print or Save as PDF in the dialog...", "info", 0);
      const readiness = await waitForExportChartsReady(15000);
      if (!readiness?.ok) {
        const reason = readiness?.reason || "unknown";
        els.exportDropdownBtn.disabled = false;
        els.exportDropdownBtn.textContent = originalLabel;
        showExportStatus(`Export skipped: charts were not ready (${reason}). Please wait and try again.`, "error", 6500);
        return;
      }
      prepareOperationalBulletinPrint();
      requestAnimationFrame(() => {
        window.print();
        printRestoreTimer = setTimeout(() => { restoreOperationalBulletinPrint(); }, 750);
        els.exportDropdownBtn.disabled = false;
        els.exportDropdownBtn.textContent = originalLabel;
        showExportStatus("Print dialog opened. Use 'Save as PDF' to export a PDF.", "success", 4500);
      });
    } else if (action === "word") {
      stopAutoRotate("word export");
      els.exportDropdownBtn.textContent = t("exportingWord");
      showExportStatus("Preparing Word bulletin export...", "info", 0);
      try { await exportOperationalBulletinWord(); }
      finally { els.exportDropdownBtn.disabled = false; els.exportDropdownBtn.textContent = originalLabel; }
    }
  });

  window.addEventListener("afterprint", () => {
    restoreOperationalBulletinPrint();
  });

  els.countrySelect.addEventListener("change", (e) => {
    stopAutoRotate("country focus changed");
    let iso3 = e.target.value;
    if (activePageId() === "forecastPage") {
      const preferredIso3 = preferredForecastCountryIso3(iso3);
      if (preferredIso3 && preferredIso3 !== iso3) {
        iso3 = preferredIso3;
        els.countrySelect.value = iso3;
      }
    }
    renderTrend(iso3);
    renderSummary(iso3);
    renderForecast(iso3);
  });

  els.countryTableHead?.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort-key]");
    if (!th) {
      return;
    }
    stopAutoRotate("table sort");
    const key = th.getAttribute("data-sort-key");
    const isSame = countrySortState.key === key;
    if (isSame) {
      countrySortState.direction = countrySortState.direction === "asc" ? "desc" : "asc";
    } else {
      const textSortColumns = ["country", "fcv_track"];
      countrySortState = {
        key,
        direction: textSortColumns.includes(key) ? "asc" : "desc"
      };
    }
    renderCountryTable();
  });

  els.sideNav.addEventListener("pointerdown", () => {
    stopAutoRotate("manual page navigation");
  });

  els.mapModeRisk?.addEventListener("click", () => {
    mapMode = "risk";
    els.mapModeRisk.classList.add("active");
    els.mapModeIpc.classList.remove("active");
    if (dashboardState) renderMap();
  });

  els.mapModeIpc?.addEventListener("click", () => {
    mapMode = "ipc";
    els.mapModeIpc.classList.add("active");
    els.mapModeRisk.classList.remove("active");
    if (dashboardState) renderMap();
  });

  // Fullscreen map expand
  const mapExpandBtn = document.getElementById("mapExpandBtn");
  if (mapExpandBtn) {
    mapExpandBtn.addEventListener("click", () => {
      openFullscreenMap();
    });
  }

  els.briefingStrip?.addEventListener("click", (e) => {
    const badge = e.target.closest(".strip-info-badge");
    if (!badge) {
      return;
    }
    if (acapsBadgeLongPressTriggered) {
      acapsBadgeLongPressTriggered = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const message = badge.getAttribute("data-toast-message") || badge.getAttribute("title") || "";
    if (!message) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    showAcapsModeToast(message);
  });

  els.briefingStrip?.addEventListener("pointerdown", (e) => {
    const badge = e.target.closest(".strip-info-badge");
    if (!badge || e.pointerType !== "touch") {
      return;
    }
    const message = badge.getAttribute("data-toast-message") || badge.getAttribute("title") || "";
    if (!message) {
      return;
    }
    acapsBadgeLongPressTriggered = false;
    clearAcapsBadgeLongPress();
    acapsBadgePressed = badge;
    acapsBadgePressed.classList.add("is-pressing");
    acapsBadgeLongPressTimer = setTimeout(() => {
      acapsBadgeLongPressTriggered = true;
      showAcapsModeToast(message);
    }, 550);
  });

  els.briefingStrip?.addEventListener("pointerup", () => {
    clearAcapsBadgeLongPress();
  });

  els.briefingStrip?.addEventListener("pointercancel", () => {
    clearAcapsBadgeLongPress();
    acapsBadgeLongPressTriggered = false;
  });

  els.briefingStrip?.addEventListener("pointerleave", () => {
    clearAcapsBadgeLongPress();
  });

  document.addEventListener("click", (e) => {
    if (!els.acapsModeToast?.classList.contains("is-visible")) {
      return;
    }
    if (e.target.closest(".strip-info-badge") || e.target.closest("#acapsModeToast")) {
      return;
    }
    hideAcapsModeToast();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideAcapsModeToast();
    }
  });
}

function scheduleAutoDataRefresh() {
  if (autoDataRefreshTimer) {
    clearTimeout(autoDataRefreshTimer);
    autoDataRefreshTimer = null;
  }
  autoDataRefreshTimer = setTimeout(() => {
    autoDataRefreshTimer = null;
    loadDashboard({ forceRefresh: false });
  }, AUTO_DATA_REFRESH_MS);
}

function formatAgeCompact(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "n/a";
  }
  const totalMinutes = Math.max(0, Math.round(ageMs / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return currentLanguage === "fr" ? `${hours} h ${minutes} min` : `${hours}h ${minutes}m`;
}

function renderDataAgeStatus() {
  if (!els.dataAgeStatus) {
    return;
  }

  const statusClasses = ["is-fresh", "is-aging", "is-stale", "is-unknown"];
  els.dataAgeStatus.classList.remove(...statusClasses);

  const generatedAtMs = dashboardState?.generated_at ? new Date(dashboardState.generated_at).getTime() : NaN;
  if (!Number.isFinite(generatedAtMs)) {
    els.dataAgeStatus.classList.add("is-unknown");
    els.dataAgeStatus.textContent = t("dataAgeUnknown");
    return;
  }

  const ageMs = Date.now() - generatedAtMs;
  const ageLabel = formatAgeCompact(ageMs);

  if (ageMs >= DATA_STALE_WARN_MS) {
    els.dataAgeStatus.classList.add("is-stale");
    els.dataAgeStatus.textContent = t("dataAgeStale", { age: ageLabel });
    return;
  }

  if (ageMs >= 5 * 60 * 1000) {
    els.dataAgeStatus.classList.add("is-aging");
    els.dataAgeStatus.textContent = t("dataAgeAging", { age: ageLabel });
    return;
  }

  els.dataAgeStatus.classList.add("is-fresh");
  els.dataAgeStatus.textContent = t("dataAgeFresh", { age: ageLabel });
}

function renderStaleBanner() {
  if (!els.staleBanner || !dashboardState) {
    return;
  }

  const parts = [];
  if (freshnessMode === "lenient") {
    const policy = dashboardState.freshness_policy || {};
    parts.push(t("staleBanner", { years: policy.nutrition_max_age_years ?? 3 }));
  }

  const generatedAtMs = dashboardState.generated_at ? new Date(dashboardState.generated_at).getTime() : NaN;
  if (Number.isFinite(generatedAtMs)) {
    const ageMs = Date.now() - generatedAtMs;
    if (ageMs >= DATA_STALE_WARN_MS) {
      const ageMinutes = Math.max(1, Math.round(ageMs / 60000));
      parts.push(t("staleDataAgeBanner", { minutes: ageMinutes }));
    }
  }

  if (!parts.length) {
    els.staleBanner.classList.remove("is-visible");
    els.staleBanner.innerHTML = "";
    return;
  }

  els.staleBanner.classList.add("is-visible");
  els.staleBanner.innerHTML = parts.map((part) => `<p>${part}</p>`).join("");
}

async function loadDashboard(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  if (els.refreshBtn) {
    els.refreshBtn.disabled = true;
    els.refreshBtn.textContent = t("updating");
  }
  try {
    const fetchWithTimeout = async ({ timeoutMs = 120000, useForceRefresh = forceRefresh } = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const params = new URLSearchParams({ freshness_mode: freshnessMode });
        if (useForceRefresh) {
          params.set("force_refresh", "1");
        }
        const response = await fetch(`/api/dashboard-data?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    };

    let payload = null;
    let lastErr = null;
    try {
      payload = await fetchWithTimeout({ timeoutMs: forceRefresh ? 90000 : 60000, useForceRefresh: forceRefresh });
    } catch (err) {
      lastErr = err;
    }

    if (!payload && forceRefresh) {
      try {
        payload = await fetchWithTimeout({ timeoutMs: 30000, useForceRefresh: false });
        setAutoStatus(t("fallbackSnapshotStatus"));
      } catch (fallbackErr) {
        lastErr = fallbackErr;
      }
    }

    if (!payload) {
      throw lastErr || new Error("Unable to load dashboard data");
    }

    dashboardState = payload;
    try {
      localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ saved_at: new Date().toISOString(), payload }));
    } catch {}
    setCurrentDate();
    buildBandLegend();
    buildMetrics();
    renderDataValidationPanel();
    renderConfidenceLegend();
    renderBriefingStrip();
    renderOverviewInsights();
    renderTopAlerts();
    renderCountryTable();
    renderServiceDeliveryPanel();
    renderFcvCountryProfile();
    aiRecommendations = buildAiRecommendations();
    renderFoodSecurityPage();
    renderNutritionPage();
    renderHazards();
    renderCyclonePage();
    renderReports();
    renderWhoDonAlerts();
    renderHazardSourceSummaries();
    renderConflictsDisplacementPage();
    renderIcpacForecasts();
    renderRecommendations();
    renderBriefingHighlights();
    renderOperationalReportPage();
    renderMeta();
    renderSourceFreshness();
    updateNavBadges();

    renderStaleBanner();
    renderDataAgeStatus();

    populateCountrySelect();
    const firstCountry = dashboardState.countries?.[0]?.iso3;
    if (firstCountry) {
      els.countrySelect.value = firstCountry;
      renderTrend(firstCountry);
      renderSummary(firstCountry);
      renderForecast(firstCountry);
    }

    renderMap();
    setActivePage(activePageId());
    localizeDynamicBlocks();
    localizePageTextTree(document.body);

    if (!hasAutoStarted) {
      startAutoRotate();
      hasAutoStarted = true;
    }
    scheduleAutoDataRefresh();
  } catch (err) {
    console.error(err);
    let restoredFromCache = false;
    try {
      const cached = JSON.parse(localStorage.getItem(DASHBOARD_CACHE_KEY) || "null");
      if (cached?.payload) {
        dashboardState = cached.payload;
        restoredFromCache = true;
        setCurrentDate();
        buildBandLegend();
        buildMetrics();
        renderDataValidationPanel();
        renderConfidenceLegend();
        renderBriefingStrip();
        renderOverviewInsights();
        renderTopAlerts();
        renderCountryTable();
        renderServiceDeliveryPanel();
        renderFcvCountryProfile();
        aiRecommendations = buildAiRecommendations();
        renderFoodSecurityPage();
        renderNutritionPage();
        renderHazards();
        renderCyclonePage();
        renderReports();
        renderWhoDonAlerts();
        renderHazardSourceSummaries();
        renderConflictsDisplacementPage();
        renderIcpacForecasts();
        renderRecommendations();
        renderBriefingHighlights();
        renderOperationalReportPage();
        renderMeta();
        renderSourceFreshness();
        updateNavBadges();
        populateCountrySelect();
        renderMap();
        setActivePage(activePageId());
        localizeDynamicBlocks();
        localizePageTextTree(document.body);
        renderStaleBanner();
        renderDataAgeStatus();
        const cachedAt = cached.saved_at ? formatDateTime(cached.saved_at) : "n/a";
        setAutoStatus(t("cachedDataStatus", { cachedAt }));
        if (!hasAutoStarted) {
          startAutoRotate();
          hasAutoStarted = true;
        }
        scheduleAutoDataRefresh();
      }
    } catch {}

    if (!restoredFromCache) {
      els.metricGrid.innerHTML = `<article class="metric-card"><h3>${t("loadError")}</h3><div class="metric-note">${err.message}</div></article>`;
      setAutoStatus(t("autoDisplayOff"));
    }
  } finally {
    if (els.refreshBtn) {
      els.refreshBtn.disabled = false;
      els.refreshBtn.textContent = t("updateDashboard");
    }
  }
}

if (currentLanguage !== "fr" && currentLanguage !== "en") {
  currentLanguage = "en";
}

const storedShowOriginalExcerpts = localStorage.getItem(SOURCE_EXCERPTS_CACHE_KEY);
if (storedShowOriginalExcerpts === "1" || storedShowOriginalExcerpts === "0") {
  showOriginalSourceExcerpts = storedShowOriginalExcerpts === "1";
} else {
  showOriginalSourceExcerpts = currentLanguage !== "en";
}

applyLanguage();
startLocalizationObserver();
bindEvents();
loadDashboard();
