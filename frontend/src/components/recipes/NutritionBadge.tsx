/** Small source-of-nutrition badge rendered next to an ingredient's
 *  name. Four states + an explicit "none":
 *
 *    'usda'   → 🥑 Leaf — values came from USDA FoodData Central
 *               (raw cooking ingredients — Foundation + SR Legacy)
 *    'off'    → 🌍 Globe — values came from Open Food Facts
 *               (branded packaged product)
 *    'ai'     → 🤖 Sparkles — local Ollama estimate
 *    'manual' → ✏️ Pencil — user typed them by hand
 *    null     → no badge (no nutrition values yet)
 *
 *  Tooltip text mirrors the spec exactly so the user always knows
 *  what the icon means without clicking. `extra` is appended for the
 *  OFF case ("Quelle: Open Food Facts (Followfish)") — the recipe-
 *  edit row passes the brand from off_product_code's resolved row,
 *  detail rows fall back to just "Open Food Facts". USDA badges
 *  ignore `extra` since Foundation/SR Legacy rows aren't branded. */
import clsx from 'clsx';
import { Globe, Leaf, Pencil, Sparkles } from 'lucide-react';
import type { NutritionSource } from '@/types';

interface Props {
  source: NutritionSource | null;
  /** Free-form context appended to the OFF tooltip — e.g. brand name. */
  extra?: string | null;
  className?: string;
}

export function NutritionBadge({ source, extra, className }: Props) {
  if (!source) return null;

  const meta = (() => {
    switch (source) {
      case 'usda':
        return {
          Icon: Leaf,
          tooltip: 'Quelle: USDA FoodData Central',
          color: 'text-emerald-700',
        };
      case 'off':
        return {
          Icon: Globe,
          tooltip: extra
            ? `Quelle: Open Food Facts (${extra})`
            : 'Quelle: Open Food Facts',
          color: 'text-sky-600',
        };
      case 'ai':
        return {
          Icon: Sparkles,
          tooltip: 'Quelle: KI-Schätzung — bitte prüfen',
          color: 'text-violet-600',
        };
      case 'manual':
        return {
          Icon: Pencil,
          tooltip: 'Manuell eingetragen',
          color: 'text-muted',
        };
    }
  })();

  const { Icon, tooltip, color } = meta;
  return (
    <span
      role="img"
      aria-label={tooltip}
      title={tooltip}
      className={clsx('inline-flex items-center', color, className)}
    >
      <Icon size={14} aria-hidden />
    </span>
  );
}
