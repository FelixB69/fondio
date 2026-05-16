import type { CSSProperties } from "react";
import {
  LuHouse,
  LuFolder,
  LuBook,
  LuSettings,
  LuPlus,
  LuSend,
  LuFile,
  LuDownload,
  LuX,
  LuChevronRight,
  LuChevronDown,
  LuSparkles,
  LuUsers,
  LuCheck,
  LuArrowLeft,
  LuScale,
  LuGavel,
  LuKey,
  LuServer,
  LuCode,
  LuPencil,
  LuChartBar,
  LuClipboardCheck,
  LuTriangleAlert,
  LuFileType,
  LuFileText,
  LuCopy,
  LuMessageSquare,
  LuZap,
  LuBuilding,
  LuLaptop,
  LuRefreshCw,
  LuExternalLink,
  LuArchive,
  LuTrash2,
  LuMenu,
  LuTarget,
  LuBriefcase,
  LuSprout,
  LuLightbulb,
  LuSearch,
  LuHammer,
  LuRocket,
  LuTrendingUp,
  LuGlobe,
  LuStar,
  LuLayers,
} from "react-icons/lu";
import type { IconType } from "react-icons";

export type IconName =
  | "home"
  | "folder"
  | "book"
  | "settings"
  | "plus"
  | "send"
  | "file"
  | "download"
  | "close"
  | "chevRight"
  | "chevDown"
  | "sparkles"
  | "users"
  | "check"
  | "arrowLeft"
  | "balance"
  | "gavel"
  | "key"
  | "server"
  | "code"
  | "pencil"
  | "chart"
  | "tasks"
  | "warning"
  | "pdf"
  | "word"
  | "copy"
  | "msgSquare"
  | "zap"
  | "building"
  | "laptop"
  | "refresh"
  | "externalLink"
  | "archive"
  | "trash"
  | "menu"
  | "target"
  | "briefcase"
  | "sprout"
  | "lightbulb"
  | "search"
  | "hammer"
  | "rocket"
  | "trendingUp"
  | "globe"
  | "star"
  | "layers";

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: CSSProperties;
}

const ICONS: Record<IconName, IconType> = {
  home: LuHouse,
  folder: LuFolder,
  book: LuBook,
  settings: LuSettings,
  plus: LuPlus,
  send: LuSend,
  file: LuFile,
  download: LuDownload,
  close: LuX,
  chevRight: LuChevronRight,
  chevDown: LuChevronDown,
  sparkles: LuSparkles,
  users: LuUsers,
  check: LuCheck,
  arrowLeft: LuArrowLeft,
  balance: LuScale,
  gavel: LuGavel,
  key: LuKey,
  server: LuServer,
  code: LuCode,
  pencil: LuPencil,
  chart: LuChartBar,
  tasks: LuClipboardCheck,
  warning: LuTriangleAlert,
  pdf: LuFileType,
  word: LuFileText,
  copy: LuCopy,
  msgSquare: LuMessageSquare,
  zap: LuZap,
  building: LuBuilding,
  laptop: LuLaptop,
  refresh: LuRefreshCw,
  externalLink: LuExternalLink,
  archive: LuArchive,
  trash: LuTrash2,
  menu: LuMenu,
  target: LuTarget,
  briefcase: LuBriefcase,
  sprout: LuSprout,
  lightbulb: LuLightbulb,
  search: LuSearch,
  hammer: LuHammer,
  rocket: LuRocket,
  trendingUp: LuTrendingUp,
  globe: LuGlobe,
  star: LuStar,
  layers: LuLayers,
};

export function Icon({ name, size = 16, color = "currentColor", style }: IconProps) {
  const Component = ICONS[name];
  if (!Component) return null;
  return (
    <Component
      size={size}
      color={color}
      style={{
        display: "inline-block",
        flexShrink: 0,
        verticalAlign: "middle",
        ...style,
      }}
    />
  );
}
