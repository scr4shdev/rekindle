import {
  BookOpenIcon,
  ClapperboardIcon,
  CoffeeIcon,
  EarIcon,
  EyeIcon,
  HandHeartIcon,
  MapPinIcon,
  MessageCircleHeartIcon,
  MusicIcon,
  ShirtIcon,
  SparklesIcon,
  TrophyIcon,
  TvIcon,
  UserRoundIcon,
  UtensilsCrossedIcon,
  type LucideIcon,
} from "lucide-react";
import type { EraMotif } from "@/components/era-art";
import type { StepKind, TasteDomain } from "@/lib/domain/types";

export const DOMAIN_ICON: Record<TasteDomain, LucideIcon> = {
  music: MusicIcon,
  film: ClapperboardIcon,
  television: TvIcon,
  food: UtensilsCrossedIcon,
  fashion: ShirtIcon,
  sport: TrophyIcon,
  public_figure: UserRoundIcon,
  book: BookOpenIcon,
  place: MapPinIcon,
};

export const DOMAIN_MOTIF: Record<TasteDomain, EraMotif> = {
  music: "vinyl",
  film: "filmstrip",
  television: "screen",
  food: "gingham",
  fashion: "houndstooth",
  sport: "pennant",
  public_figure: "portrait",
  book: "pages",
  place: "stamp",
};

export const STEP_ICON: Record<StepKind, LucideIcon> = {
  opening: CoffeeIcon,
  listen: EarIcon,
  look: EyeIcon,
  talk: MessageCircleHeartIcon,
  taste: UtensilsCrossedIcon,
  move: HandHeartIcon,
  closing: SparklesIcon,
};

/** Motif for a step without an entity, by what the step does. */
export const STEP_MOTIF: Record<StepKind, EraMotif> = {
  opening: "sunrise",
  listen: "vinyl",
  look: "filmstrip",
  talk: "portrait",
  taste: "gingham",
  move: "pennant",
  closing: "sunrise",
};
