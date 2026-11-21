import luma from "@/assets/personas/luma.webp"
import atlas from "@/assets/personas/atlas.webp"
import mira from "@/assets/personas/mira.webp"
import vera from "@/assets/personas/vera.webp"
import type { Role } from "@/lib/collaborationProtocol"

// Portraits from the product-approved Iris Digital Personas v1.0 board.
export const personas = {
  VISION: {
    name: "Luma",
    alias: "露玛",
    image: luma,
    profile: "敏锐、冷静，对不确定性保持审慎。",
  },
  EVIDENCE: {
    name: "Atlas",
    alias: "阿特拉斯",
    image: atlas,
    profile: "理性、严谨，重视来源的版本和可追溯性。",
  },
  EXPLANATION: {
    name: "Mira",
    alias: "米拉",
    image: mira,
    profile: "温和、清晰，擅长给复杂信息理出层次。",
  },
  CRITIC: {
    name: "Vera",
    alias: "维拉",
    image: vera,
    profile: "独立、审慎，留意依据的缺口和表述的风险。",
  },
} satisfies Record<
  Role,
  { name: string; alias: string; image: string; profile: string }
>
