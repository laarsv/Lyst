/** Curated emoji + colour presets for list creation/edit.
 *
 *  Each preset is a fixed pair: pick one and both the list's emoji and
 *  border colour are set in a single tap. Users can still override either
 *  field independently via the picker's footer inputs.
 *
 *  Aliases are German first (the UI is German), with light English/synonym
 *  coverage for searches like "shopping" or "art". Group names themselves
 *  are matched against too, so `q="einkauf"` returns every shopping preset.
 *
 *  Adding a new preset: pick a group (or add one), pick an emoji, pick a
 *  colour that visually pairs with it, write 3–6 short aliases. Order
 *  inside a group matters — first item is shown first in the picker. */

export interface Preset {
  emoji: string;
  color: string;
  /** Lower-case search tokens. The group label is matched separately so
   *  no need to repeat it here. */
  aliases: string[];
}

export interface PresetGroup {
  id: string;
  label: string;
  presets: Preset[];
}

export const PRESET_GROUPS: PresetGroup[] = [
  {
    id: 'einkauf',
    label: 'Einkauf',
    presets: [
      { emoji: '🛒', color: '#00c896', aliases: ['einkauf', 'wagen', 'shopping', 'korb', 'supermarkt'] },
      { emoji: '🥕', color: '#e87a2b', aliases: ['gemüse', 'karotte', 'möhre', 'obst', 'frisch'] },
      { emoji: '🍞', color: '#c9933c', aliases: ['brot', 'bäckerei', 'backwaren', 'frühstück'] },
      { emoji: '🥛', color: '#b8c9d6', aliases: ['milch', 'molkerei', 'getränk', 'milchprodukte'] },
      { emoji: '🧀', color: '#f0c64a', aliases: ['käse', 'molkerei', 'milchprodukte'] },
      { emoji: '🍎', color: '#e05252', aliases: ['apfel', 'obst', 'früchte', 'snack'] },
      { emoji: '🥩', color: '#a44848', aliases: ['fleisch', 'steak', 'metzger', 'protein'] },
      { emoji: '🐟', color: '#4a8bc2', aliases: ['fisch', 'meer', 'omega', 'sushi'] },
      { emoji: '🍷', color: '#6e2c4d', aliases: ['wein', 'alkohol', 'getränk', 'rotwein'] },
      { emoji: '☕', color: '#6b4423', aliases: ['kaffee', 'getränk', 'morgens', 'pause'] },
    ],
  },
  {
    id: 'reisen',
    label: 'Reisen & Packen',
    presets: [
      { emoji: '🎒', color: '#2e7d6b', aliases: ['rucksack', 'wandern', 'tour', 'pack'] },
      { emoji: '🧳', color: '#6b4d3a', aliases: ['koffer', 'gepäck', 'urlaub', 'reise'] },
      { emoji: '✈️', color: '#4a8bc2', aliases: ['flug', 'flugzeug', 'urlaub', 'reise'] },
      { emoji: '🏖️', color: '#f0b04a', aliases: ['strand', 'urlaub', 'sommer', 'meer'] },
      { emoji: '⛰️', color: '#6e7a8a', aliases: ['berg', 'wandern', 'alpen', 'natur'] },
      { emoji: '🏕️', color: '#4a7a3a', aliases: ['camping', 'zelt', 'outdoor', 'natur'] },
      { emoji: '🏨', color: '#8c6a4e', aliases: ['hotel', 'unterkunft', 'reise', 'übernachten'] },
      { emoji: '🚗', color: '#2c4a6e', aliases: ['auto', 'roadtrip', 'fahren', 'wagen'] },
      { emoji: '🌍', color: '#3a8a7a', aliases: ['welt', 'erde', 'reise', 'global'] },
      { emoji: '🏝️', color: '#4ec2a4', aliases: ['insel', 'tropen', 'urlaub', 'meer'] },
    ],
  },
  {
    id: 'haushalt',
    label: 'Haushalt',
    presets: [
      { emoji: '🏠', color: '#5e7a8a', aliases: ['haus', 'zuhause', 'wohnung', 'heim'] },
      { emoji: '🧹', color: '#8a7a5e', aliases: ['besen', 'putzen', 'reinigen', 'sauber'] },
      { emoji: '🔧', color: '#6e6e6e', aliases: ['werkzeug', 'reparatur', 'schraubenschlüssel', 'heimwerken'] },
      { emoji: '💡', color: '#f0c64a', aliases: ['lampe', 'glühbirne', 'licht', 'idee'] },
      { emoji: '🪴', color: '#5e8a4e', aliases: ['pflanze', 'blume', 'garten', 'topf'] },
      { emoji: '🧺', color: '#c98a6e', aliases: ['korb', 'wäsche', 'picknick'] },
      { emoji: '🪞', color: '#a0b0c0', aliases: ['spiegel', 'bad', 'einrichtung'] },
      { emoji: '🛏️', color: '#8a7e6e', aliases: ['bett', 'schlaf', 'schlafzimmer'] },
      { emoji: '🚿', color: '#6ec2d4', aliases: ['dusche', 'bad', 'wasser'] },
      { emoji: '🧴', color: '#d4a8b8', aliases: ['lotion', 'pflege', 'kosmetik', 'shampoo'] },
    ],
  },
  {
    id: 'familie',
    label: 'Familie & Kinder',
    presets: [
      { emoji: '👨‍👩‍👧', color: '#e88aa4', aliases: ['familie', 'eltern', 'kinder'] },
      { emoji: '👶', color: '#f0c8d4', aliases: ['baby', 'säugling', 'neugeboren'] },
      { emoji: '🍼', color: '#b8d4e8', aliases: ['fläschchen', 'baby', 'milch'] },
      { emoji: '🧸', color: '#c9933c', aliases: ['teddy', 'bär', 'kuscheltier', 'spielzeug'] },
      { emoji: '🎒', color: '#6e9ec2', aliases: ['schulranzen', 'schule', 'rucksack', 'kinder'] },
      { emoji: '📚', color: '#a44848', aliases: ['bücher', 'lesen', 'schule', 'lernen'] },
      { emoji: '⚽', color: '#2c2c2c', aliases: ['fußball', 'sport', 'ball', 'kinder'] },
      { emoji: '🎨', color: '#c2528e', aliases: ['malen', 'kunst', 'kreativ', 'farben'] },
      { emoji: '🎮', color: '#6e4ec2', aliases: ['spiele', 'gaming', 'konsole', 'controller'] },
      { emoji: '🎂', color: '#f0a4c2', aliases: ['geburtstag', 'kuchen', 'feier', 'kinder'] },
    ],
  },
  {
    id: 'arbeit',
    label: 'Arbeit & Projekte',
    presets: [
      { emoji: '💼', color: '#2c2c4e', aliases: ['arbeit', 'job', 'aktentasche', 'büro'] },
      { emoji: '📋', color: '#5e7a8a', aliases: ['klemmbrett', 'aufgaben', 'todo', 'liste'] },
      { emoji: '📝', color: '#c9b04a', aliases: ['notiz', 'zettel', 'schreiben', 'memo'] },
      { emoji: '💻', color: '#4a4a4a', aliases: ['laptop', 'computer', 'arbeit', 'remote'] },
      { emoji: '📊', color: '#4a8bc2', aliases: ['diagramm', 'statistik', 'auswertung', 'daten'] },
      { emoji: '🎯', color: '#e05252', aliases: ['ziel', 'fokus', 'okr', 'milestone'] },
      { emoji: '🚀', color: '#6e4ec2', aliases: ['rakete', 'launch', 'start', 'projekt'] },
      { emoji: '⚡', color: '#f0c64a', aliases: ['blitz', 'energie', 'schnell', 'sprint'] },
      { emoji: '📞', color: '#2e7d6b', aliases: ['telefon', 'anruf', 'call', 'meeting'] },
      { emoji: '📅', color: '#c2528e', aliases: ['kalender', 'termin', 'datum', 'planung'] },
    ],
  },
  {
    id: 'hobbys',
    label: 'Hobbys & Sport',
    presets: [
      { emoji: '🏃', color: '#e87a2b', aliases: ['laufen', 'joggen', 'rennen', 'sport'] },
      { emoji: '🚴', color: '#2e7d6b', aliases: ['fahrrad', 'radfahren', 'bike', 'tour'] },
      { emoji: '🧘', color: '#a8c2a4', aliases: ['yoga', 'meditation', 'achtsamkeit', 'entspannung'] },
      { emoji: '🎵', color: '#6e4ec2', aliases: ['musik', 'noten', 'song', 'hören'] },
      { emoji: '📷', color: '#4a4a4a', aliases: ['kamera', 'foto', 'fotografie'] },
      { emoji: '🎨', color: '#c2528e', aliases: ['malen', 'kunst', 'kreativ', 'farbe'] },
      { emoji: '🎮', color: '#6e4ec2', aliases: ['gaming', 'videospiel', 'controller', 'konsole'] },
      { emoji: '🎲', color: '#e05252', aliases: ['würfel', 'spiel', 'brett', 'zufall'] },
      { emoji: '🏊', color: '#4a8bc2', aliases: ['schwimmen', 'pool', 'wasser', 'sport'] },
      { emoji: '⛷️', color: '#b8c9d6', aliases: ['ski', 'schnee', 'winter', 'piste'] },
    ],
  },
  {
    id: 'anlaesse',
    label: 'Anlässe',
    presets: [
      { emoji: '🎉', color: '#c2528e', aliases: ['party', 'feier', 'konfetti', 'hurra'] },
      { emoji: '🎁', color: '#e05252', aliases: ['geschenk', 'überraschung', 'paket', 'present'] },
      { emoji: '🎂', color: '#f0a4c2', aliases: ['geburtstag', 'kuchen', 'torte', 'feier'] },
      { emoji: '💐', color: '#d4528e', aliases: ['blumen', 'strauß', 'jubiläum', 'glückwunsch'] },
      { emoji: '🎄', color: '#2e7d6b', aliases: ['weihnachten', 'tannenbaum', 'fest', 'winter'] },
      { emoji: '🎃', color: '#e87a2b', aliases: ['halloween', 'kürbis', 'herbst'] },
      { emoji: '💍', color: '#c9b04a', aliases: ['ring', 'hochzeit', 'verlobung', 'antrag'] },
      { emoji: '🍾', color: '#6e2c4d', aliases: ['sekt', 'champagner', 'feier', 'silvester'] },
      { emoji: '🎆', color: '#6e4ec2', aliases: ['feuerwerk', 'silvester', 'rakete', 'fest'] },
      { emoji: '🥂', color: '#f0c64a', aliases: ['anstoßen', 'cheers', 'sekt', 'feier'] },
    ],
  },
  {
    id: 'sonstiges',
    label: 'Sonstiges',
    presets: [
      { emoji: '⭐', color: '#f0c64a', aliases: ['stern', 'favorit', 'wichtig'] },
      { emoji: '❤️', color: '#e05252', aliases: ['herz', 'liebe', 'favorit'] },
      { emoji: '📌', color: '#4a8bc2', aliases: ['pin', 'nadel', 'fixiert', 'merken'] },
      { emoji: '✅', color: '#00c896', aliases: ['häkchen', 'erledigt', 'check', 'fertig'] },
      { emoji: '🔥', color: '#e87a2b', aliases: ['feuer', 'hot', 'trend', 'wichtig'] },
      { emoji: '💎', color: '#4ec2c4', aliases: ['diamant', 'wertvoll', 'edelstein', 'premium'] },
      { emoji: '🌟', color: '#f0c64a', aliases: ['glanz', 'stern', 'highlight'] },
      { emoji: '📁', color: '#c9933c', aliases: ['ordner', 'sammlung', 'dokumente'] },
      { emoji: '✨', color: '#c2528e', aliases: ['sparkles', 'glanz', 'magie', 'special'] },
      { emoji: '🎯', color: '#e05252', aliases: ['ziel', 'bullseye', 'fokus', 'treffer'] },
    ],
  },
];

/** Flat list of all presets — handy when search needs to ignore groups. */
export const ALL_PRESETS: Preset[] = PRESET_GROUPS.flatMap((g) => g.presets);

/** Default preset per list type. The values match the four spec defaults
 *  exactly: SHOPPING → 🛒 #00c896, PACKING → 🎒 #2e7d6b, CHECKLIST → ✅
 *  #00c896, CUSTOM → 📋 #5e7a8a. Used when seeding the picker for a new
 *  list — users can still override before saving. */
export const DEFAULT_PRESET_FOR_TYPE: Record<string, Preset> = {
  SHOPPING: { emoji: '🛒', color: '#00c896', aliases: [] },
  PACKING: { emoji: '🎒', color: '#2e7d6b', aliases: [] },
  CHECKLIST: { emoji: '✅', color: '#00c896', aliases: [] },
  CUSTOM: { emoji: '📋', color: '#5e7a8a', aliases: [] },
};

/** Filter presets by a search query against aliases + group label. Empty
 *  query returns the original groups. Match is a case-insensitive substring
 *  on any alias word; matches also include the emoji character itself
 *  ("🛒" → exact match) so paste-search works. */
export function filterPresetGroups(query: string): PresetGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return PRESET_GROUPS;
  return PRESET_GROUPS
    .map((group) => {
      const groupHit = group.label.toLowerCase().includes(q);
      const matched = group.presets.filter(
        (p) =>
          groupHit ||
          p.emoji === query.trim() ||
          p.aliases.some((a) => a.includes(q)),
      );
      return matched.length ? { ...group, presets: matched } : null;
    })
    .filter((g): g is PresetGroup => g !== null);
}
