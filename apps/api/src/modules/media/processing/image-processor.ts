import sharp from 'sharp';

export interface ImageInfo {
  width: number;
  height: number;
  /** "#rrggbb" */
  dominantColor: string;
}

export interface ImageVariant {
  width: number;
  height: number;
  path: string;
}

/** Image resizing (sharp). Blurhash is not generated (would need another library). */
export interface ImageProcessor {
  inspect(inputPath: string): Promise<ImageInfo>;
  /** Writes a WebP of the given width (never upscaled; EXIF rotation applied). */
  toWebp(inputPath: string, width: number, outputPath: string): Promise<ImageVariant>;
}

const WEBP_QUALITY = 80;
const HEX_RADIX = 16;
const hex = (value: number): string => value.toString(HEX_RADIX).padStart(2, '0');

export function createImageProcessor(): ImageProcessor {
  return {
    async inspect(inputPath) {
      const image = sharp(inputPath).rotate();
      const [meta, stats] = await Promise.all([image.metadata(), image.stats()]);
      if (!meta.width || !meta.height) throw new Error('Unreadable image.');
      // EXIF orientations 5-8 swap width and height.
      const swapped = (meta.orientation ?? 1) >= 5;
      const { r, g, b } = stats.dominant;
      return {
        width: swapped ? meta.height : meta.width,
        height: swapped ? meta.width : meta.height,
        dominantColor: `#${hex(r)}${hex(g)}${hex(b)}`,
      };
    },

    async toWebp(inputPath, width, outputPath) {
      const info = await sharp(inputPath)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(outputPath);
      return { width: info.width, height: info.height, path: outputPath };
    },
  };
}
