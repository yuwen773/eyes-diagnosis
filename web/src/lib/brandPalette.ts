/**
 * 品牌层取色（给 canvas / WebGL / 内联 SVG 用）。
 *
 * 这些组件读不到 CSS 变量，颜色只能以字面值传进去；但值必须和
 * tokens.css 的 --brand-* 对得上。集中在这里，改一处就够，也免得
 * 每个组件各写一遍十六进制。
 *
 * 注意：这里只收「与令牌一一对应」的颜色。品牌首屏的多色色带
 * （HeroPrism 的 PALETTES）是美术取值，不是令牌，留在组件里。
 */

/** 品牌蓝：浅色主题下用于光标跟随的边框（比 --brand-primary 更亮一档）。 */
export const BRAND_BLUE_LIGHT = "#4f86e8"

/** 品牌蓝 · 暗主题：与 --brand-primary（html.dark）同值。 */
export const BRAND_BLUE_DARK = "#85b5ff"
