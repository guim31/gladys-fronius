// -----------------------------------------------------------------------------
// Every text the code shows to the user, in the four languages of the Gladys
// interface (en, fr, de, es). German says "du", Spanish says "usted".
// test/i18n.test.js checks that each one exists in all four, is not empty
// and fits where it is shown, and that no other source file writes a text.
//
// Vocabulary taken from the Gladys interface (front/src/config/i18n): Netzbezug
// / Einspeisung, Eigenverbrauch, Ladestand; importación / exportación de la red,
// autoconsumo, nivel de batería. Brand and product names are not translated.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** The text of one language, English when it is missing. */
export function pick(text, language) {
  return text[language] ?? text.en;
}

/** A multi-language object built by one function per language. */
export function localize(build) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, build(language)]));
}

/** Decimal number in the conventions of a language, without thousands separator. */
export function formatNumber(value, digits, language) {
  const text = Number(value).toFixed(digits);
  return language === 'en' ? text : text.replace('.', ',');
}

// --- Device and feature names (frozen by Gladys when the device is created) ---

export const DEVICE_NAMES = {
  system: {
    en: 'Fronius system',
    fr: 'Installation Fronius',
    de: 'Fronius-Anlage',
    es: 'Instalación Fronius',
  },
  inverter: (id) => ({
    en: `Fronius inverter ${id}`,
    fr: `Onduleur Fronius ${id}`,
    de: `Fronius-Wechselrichter ${id}`,
    es: `Inversor Fronius ${id}`,
  }),
  meter: (index) => ({
    en: `Fronius meter ${index}`,
    fr: `Compteur Fronius ${index}`,
    de: `Fronius-Zähler ${index}`,
    es: `Contador Fronius ${index}`,
  }),
  battery: (index) => ({
    en: `Fronius battery ${index}`,
    fr: `Batterie Fronius ${index}`,
    de: `Fronius-Batterie ${index}`,
    es: `Batería Fronius ${index}`,
  }),
};

export const FEATURE_NAMES = {
  pvPower: {
    en: 'Solar production',
    fr: 'Production solaire',
    de: 'Solarproduktion',
    es: 'Producción solar',
  },
  homePower: {
    en: 'House consumption',
    fr: 'Consommation de la maison',
    de: 'Hausverbrauch',
    es: 'Consumo de la casa',
  },
  gridImport: {
    en: 'Grid import',
    fr: 'Soutirage du réseau',
    de: 'Netzbezug',
    es: 'Importación de la red',
  },
  gridExport: {
    en: 'Grid export',
    fr: 'Injection dans le réseau',
    de: 'Netzeinspeisung',
    es: 'Exportación a la red',
  },
  batteryCharge: {
    en: 'Battery charging',
    fr: 'Charge de la batterie',
    de: 'Batterieladung',
    es: 'Carga de la batería',
  },
  batteryDischarge: {
    en: 'Battery discharging',
    fr: 'Décharge de la batterie',
    de: 'Batterieentladung',
    es: 'Descarga de la batería',
  },
  productionToday: {
    en: 'Production today',
    fr: 'Production du jour',
    de: 'Produktion heute',
    es: 'Producción de hoy',
  },
  productionTotal: {
    en: 'Total production',
    fr: 'Production totale',
    de: 'Gesamtproduktion',
    es: 'Producción total',
  },
  acPower: { en: 'AC power', fr: 'Puissance AC', de: 'AC-Leistung', es: 'Potencia CA' },
  acVoltage: { en: 'AC voltage', fr: 'Tension AC', de: 'AC-Spannung', es: 'Tensión CA' },
  acCurrent: { en: 'AC current', fr: 'Courant AC', de: 'AC-Strom', es: 'Corriente CA' },
  dcVoltage: (input) => ({
    en: `DC voltage (input ${input})`,
    fr: `Tension DC (entrée ${input})`,
    de: `DC-Spannung (Eingang ${input})`,
    es: `Tensión CC (entrada ${input})`,
  }),
  dcCurrent: (input) => ({
    en: `DC current (input ${input})`,
    fr: `Courant DC (entrée ${input})`,
    de: `DC-Strom (Eingang ${input})`,
    es: `Corriente CC (entrada ${input})`,
  }),
  inverterState: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  errorCode: { en: 'Error code', fr: "Code d'erreur", de: 'Fehlercode', es: 'Código de error' },
  gridPower: {
    en: 'Grid exchange',
    fr: 'Échange avec le réseau',
    de: 'Netzaustausch',
    es: 'Intercambio con la red',
  },
  meterPower: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  phasePower: (phase) => ({
    en: `Power phase ${phase}`,
    fr: `Puissance phase ${phase}`,
    de: `Leistung Phase ${phase}`,
    es: `Potencia fase ${phase}`,
  }),
  phaseVoltage: (phase) => ({
    en: `Voltage phase ${phase}`,
    fr: `Tension phase ${phase}`,
    de: `Spannung Phase ${phase}`,
    es: `Tensión fase ${phase}`,
  }),
  importIndex: {
    en: 'Energy imported (meter)',
    fr: 'Énergie soutirée (index)',
    de: 'Netzbezug (Zählerstand)',
    es: 'Energía importada (índice)',
  },
  exportIndex: {
    en: 'Energy exported (meter)',
    fr: 'Énergie injectée (index)',
    de: 'Einspeisung (Zählerstand)',
    es: 'Energía exportada (índice)',
  },
  batteryLevel: {
    en: 'Charge level',
    fr: 'Niveau de charge',
    de: 'Ladestand',
    es: 'Nivel de carga',
  },
  batteryTemperature: {
    en: 'Cell temperature',
    fr: 'Température des cellules',
    de: 'Zelltemperatur',
    es: 'Temperatura de las celdas',
  },
  batteryEnergy: {
    en: 'Stored energy',
    fr: 'Énergie stockée',
    de: 'Gespeicherte Energie',
    es: 'Energía almacenada',
  },
};

// --- Text states ------------------------------------------------------------

// Inverter status codes of the Solar API (StatusCode), as Home Assistant reads
// them: 0-6 start-up, 7 running, 8 standby, 9 bootloading, 10 error, 11 idle,
// 12 ready, 13 sleeping.
export const INVERTER_STATES = {
  startup: { en: 'Starting', fr: 'Démarrage', de: 'Startet', es: 'Arrancando' },
  running: { en: 'Producing', fr: 'En production', de: 'Produziert', es: 'Produciendo' },
  standby: { en: 'Standby', fr: 'Veille', de: 'Standby', es: 'En espera' },
  bootloading: { en: 'Updating', fr: 'Mise à jour', de: 'Aktualisierung', es: 'Actualizando' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  idle: { en: 'Idle', fr: 'Inactif', de: 'Inaktiv', es: 'Inactivo' },
  ready: { en: 'Ready', fr: 'Prêt', de: 'Bereit', es: 'Listo' },
  sleeping: { en: 'Sleeping', fr: 'En sommeil', de: 'Schläft', es: 'En reposo' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

export const ERROR_TEXTS = {
  none: { en: 'No error', fr: 'Aucune erreur', de: 'Kein Fehler', es: 'Sin errores' },
  code: (code) => ({
    en: `Code ${code}`,
    fr: `Code ${code}`,
    de: `Code ${code}`,
    es: `Código ${code}`,
  }),
};

// Battery_Mode of the power flow (GEN24). A mode missing here is shown as the
// API sends it, in English.
export const BATTERY_MODES = {
  normal: { en: 'Normal', fr: 'Normal', de: 'Normal', es: 'Normal' },
  disabled: { en: 'Disabled', fr: 'Désactivée', de: 'Deaktiviert', es: 'Desactivada' },
  suspended: { en: 'Suspended', fr: 'Suspendue', de: 'Pausiert', es: 'Suspendida' },
  'battery full': { en: 'Full', fr: 'Pleine', de: 'Voll', es: 'Llena' },
  'nearly depleted': { en: 'Nearly empty', fr: 'Presque vide', de: 'Fast leer', es: 'Casi vacía' },
  calibrate: { en: 'Calibrating', fr: 'Calibrage', de: 'Kalibrierung', es: 'Calibrando' },
  service: { en: 'Service', fr: 'Maintenance', de: 'Wartung', es: 'Mantenimiento' },
  'charge boost': {
    en: 'Forced charge',
    fr: 'Charge forcée',
    de: 'Zwangsladung',
    es: 'Carga forzada',
  },
};

// --- Dashboard widget ---------------------------------------------------------

// Tile labels and status labels: 24 characters at most (SDK bound).
export const WIDGET_TEXT = {
  solar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  house: { en: 'House', fr: 'Maison', de: 'Haus', es: 'Casa' },
  fromGrid: { en: 'From the grid', fr: 'Soutirage', de: 'Netzbezug', es: 'De la red' },
  toGrid: { en: 'To the grid', fr: 'Injection', de: 'Einspeisung', es: 'A la red' },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  today: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  selfConsumption: {
    en: 'Self-consumption',
    fr: 'Autoconsommation',
    de: 'Eigenverbrauch',
    es: 'Autoconsumo',
  },
  autonomy: { en: 'Self-sufficiency', fr: 'Autonomie', de: 'Autarkie', es: 'Autosuficiencia' },
  thisYear: { en: 'This year', fr: 'Cette année', de: 'Dieses Jahr', es: 'Este año' },
  total: { en: 'Total', fr: 'Total', de: 'Gesamt', es: 'Total' },
  batteryFlow: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  discharging: { en: 'Discharging', fr: 'En décharge', de: 'Entlädt', es: 'Descargando' },
  batteryIdle: { en: 'Idle', fr: 'Au repos', de: 'Inaktiv', es: 'En reposo' },
  inverters: { en: 'Inverters', fr: 'Onduleurs', de: 'Wechselrichter', es: 'Inversores' },
  updated: { en: 'Updated at', fr: 'Actualisé à', de: 'Aktualisiert um', es: 'Actualizado a las' },
  chartTitle: {
    en: 'Production and consumption',
    fr: 'Production et consommation',
    de: 'Produktion und Verbrauch',
    es: 'Producción y consumo',
  },
};

// Sentences of the widget when there is nothing to show (body text, 300 max).
export const WIDGET_MESSAGES = {
  notConfigured: {
    en: 'Enter the IP address of your Fronius Datamanager or GEN24 inverter in the configuration of the integration.',
    fr: "Saisissez l'adresse IP de votre Datamanager ou de votre onduleur GEN24 Fronius dans la configuration de l'intégration.",
    de: 'Gib die IP-Adresse deines Fronius Datamanager oder GEN24-Wechselrichters in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección IP de su Datamanager o de su inversor GEN24 Fronius en la configuración de la integración.',
  },
  noData: {
    en: 'No reading from the Fronius system yet: check the connection status in the configuration of the integration.',
    fr: "Aucune mesure de l'installation Fronius pour l'instant : vérifiez l'état de la connexion dans la configuration de l'intégration.",
    de: 'Noch keine Messwerte der Fronius-Anlage: Prüfe den Verbindungsstatus in der Konfiguration der Integration.',
    es: 'Todavía no hay mediciones de la instalación Fronius: compruebe el estado de la conexión en la configuración de la integración.',
  },
};

// --- Connection status and action messages --------------------------------------

export const MESSAGES = {
  notConfigured: {
    en: 'Enter the IP address of your Fronius Datamanager or GEN24 inverter.',
    fr: "Saisissez l'adresse IP de votre Datamanager ou de votre onduleur GEN24 Fronius.",
    de: 'Gib die IP-Adresse deines Fronius Datamanager oder GEN24-Wechselrichters ein.',
    es: 'Introduzca la dirección IP de su Datamanager o de su inversor GEN24 Fronius.',
  },
  invalidHost: {
    en: 'This address is not valid: enter an IP address or a host name, for example 192.0.2.10.',
    fr: "Cette adresse n'est pas valide : saisissez une adresse IP ou un nom d'hôte, par exemple 192.0.2.10.",
    de: 'Diese Adresse ist ungültig: Gib eine IP-Adresse oder einen Hostnamen ein, zum Beispiel 192.0.2.10.',
    es: 'Esta dirección no es válida: introduzca una dirección IP o un nombre de host, por ejemplo 192.0.2.10.',
  },
  unreachable: (reason) => ({
    en: `The Fronius system does not answer (${reason}). Check the IP address, and that the Solar API is enabled on a GEN24 (Communication > Solar API).`,
    fr: `L'installation Fronius ne répond pas (${reason}). Vérifiez l'adresse IP, et que la Solar API est activée sur un GEN24 (Communication > Solar API).`,
    de: `Die Fronius-Anlage antwortet nicht (${reason}). Prüfe die IP-Adresse und ob die Solar API auf einem GEN24 aktiviert ist (Kommunikation > Solar API).`,
    es: `La instalación Fronius no responde (${reason}). Compruebe la dirección IP y que la Solar API esté activada en un GEN24 (Comunicación > Solar API).`,
  }),
  publishFailed: (reason) => ({
    en: `The Fronius system answers, but Gladys refused its devices (${reason}).`,
    fr: `L'installation Fronius répond, mais Gladys a refusé ses appareils (${reason}).`,
    de: `Die Fronius-Anlage antwortet, aber Gladys hat ihre Geräte abgelehnt (${reason}).`,
    es: `La instalación Fronius responde, pero Gladys ha rechazado sus dispositivos (${reason}).`,
  }),
  found: ({ datamanager, inverters, meters, batteries }) => {
    const kind = datamanager ? 'Datamanager' : 'GEN24 / Tauro';
    return {
      en: `Connected to the Fronius ${kind}. Inverters: ${inverters}, meters: ${meters}, batteries: ${batteries}. The devices are in the Discovery tab.`,
      fr: `Connecté au ${kind} Fronius. Onduleurs : ${inverters}, compteurs : ${meters}, batteries : ${batteries}. Les appareils sont dans l'onglet Découverte.`,
      de: `Mit Fronius ${kind} verbunden. Wechselrichter: ${inverters}, Zähler: ${meters}, Batterien: ${batteries}. Die Geräte findest du im Tab „Entdecken“.`,
      es: `Conectado al ${kind} Fronius. Inversores: ${inverters}, contadores: ${meters}, baterías: ${batteries}. Los dispositivos están en la pestaña Descubrir.`,
    };
  },
};
