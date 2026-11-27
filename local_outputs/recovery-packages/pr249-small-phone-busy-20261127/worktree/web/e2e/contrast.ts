import type { Locator } from "@playwright/test";

type ContrastPseudoElement = "::placeholder";

interface RgbaColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export interface ContrastMeasurement {
  ratio: number;
  foreground: RgbaColor;
  background: RgbaColor;
}

export async function measureContrast(
  locator: Locator,
  pseudoElement?: ContrastPseudoElement,
): Promise<ContrastMeasurement> {
  return locator.evaluate((element, pseudo) => {
    type Color = { red: number; green: number; blue: number; alpha: number };

    const parseColor = (value: string): Color | null => {
      const channels = value.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3) return null;
      return {
        red: channels[0],
        green: channels[1],
        blue: channels[2],
        alpha: channels[3] ?? 1,
      };
    };

    const composite = (foreground: Color, background: Color): Color => {
      const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
      if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
      return {
        red: (
          foreground.red * foreground.alpha
          + background.red * background.alpha * (1 - foreground.alpha)
        ) / alpha,
        green: (
          foreground.green * foreground.alpha
          + background.green * background.alpha * (1 - foreground.alpha)
        ) / alpha,
        blue: (
          foreground.blue * foreground.alpha
          + background.blue * background.alpha * (1 - foreground.alpha)
        ) / alpha,
        alpha,
      };
    };

    const luminance = (color: Color): number => {
      const linear = [color.red, color.green, color.blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };

    let background: Color = { red: 0, green: 0, blue: 0, alpha: 0 };
    for (let current: Element | null = element; current; current = current.parentElement) {
      const layer = parseColor(getComputedStyle(current).backgroundColor);
      if (layer) background = composite(background, layer);
      if (background.alpha >= 0.999) break;
    }
    if (background.alpha < 0.999) {
      background = composite(background, { red: 255, green: 255, blue: 255, alpha: 1 });
    }

    const rawForeground = parseColor(getComputedStyle(element, pseudo || null).color);
    if (!rawForeground) {
      throw new Error(`Unable to parse computed foreground color for ${element.tagName}`);
    }
    const foreground = composite(rawForeground, background);
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    const ratio = (
      Math.max(foregroundLuminance, backgroundLuminance) + 0.05
    ) / (
      Math.min(foregroundLuminance, backgroundLuminance) + 0.05
    );

    return { ratio, foreground, background };
  }, pseudoElement);
}
