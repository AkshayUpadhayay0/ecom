import { spawn } from 'node:child_process';

/** What the pipeline needs to know about a video file. */
export interface VideoProbe {
  durationMs: number | null;
  /** Display size (rotation already applied). */
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface FfmpegCheck {
  ok: boolean;
  version?: string;
  error?: string;
}

/** Thin, swappable wrapper around ffmpeg/ffprobe (tests use a stub). */
export interface FfmpegRunner {
  check(): Promise<FfmpegCheck>;
  probe(inputPath: string): Promise<VideoProbe>;
  /** Runs ffmpeg with the given arguments (no shell); rejects on a non-zero exit. */
  run(args: readonly string[]): Promise<void>;
}

export interface FfmpegPaths {
  ffmpegPath: string;
  ffprobePath: string;
}

const STDERR_TAIL = 2000;
const ROTATED = new Set([90, 270, -90, -270]);

function exec(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Arguments are passed as an array: no shell, so file names cannot inject commands.
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

export function createFfmpegRunner(paths: FfmpegPaths): FfmpegRunner {
  return {
    async check() {
      try {
        const output = await exec(paths.ffmpegPath, ['-version']);
        await exec(paths.ffprobePath, ['-version']);
        return { ok: true, version: output.split('\n')[0]?.trim() ?? 'unknown' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async probe(inputPath) {
      const output = await exec(paths.ffprobePath, [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        inputPath,
      ]);
      const parsed = JSON.parse(output) as {
        streams?: ProbeStream[];
        format?: { duration?: string };
      };
      const video = parsed.streams?.find((s) => s.codec_type === 'video');
      if (!video?.width || !video.height) throw new Error('No video stream found.');
      const rotation = Number(
        video.tags?.rotate ??
          video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
          0,
      );
      const rotated = ROTATED.has(rotation);
      const seconds = Number(parsed.format?.duration);
      return {
        durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
        width: rotated ? video.height : video.width,
        height: rotated ? video.width : video.height,
        hasAudio: parsed.streams?.some((s) => s.codec_type === 'audio') ?? false,
      };
    },

    async run(args) {
      await exec(paths.ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args]);
    },
  };
}

/** Printed by the worker when ffmpeg cannot be started. */
export const FFMPEG_INSTALL_HELP = [
  'ffmpeg/ffprobe were not found. Video processing is disabled until they are installed.',
  'Install on Windows (pick one), then open a NEW terminal:',
  '  winget install --id Gyan.FFmpeg -e',
  '  choco install ffmpeg          (Chocolatey, from an admin terminal)',
  'Check with: ffmpeg -version',
  'Or set FFMPEG_PATH / FFPROBE_PATH in .env to the full paths of ffmpeg.exe and ffprobe.exe.',
].join('\n');
