import { z } from 'zod';
import { paginationQuerySchema, type Translations } from './admin-common.js';

export const contentBlockKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'must be a content block key such as home.hero');

/** `null` clears the media. */
export const setContentMediaSchema = z.object({ mediaAssetId: z.uuid().nullable() });
export type SetContentMediaRequest = z.infer<typeof setContentMediaSchema>;

export const listContentBlocksQuerySchema = paginationQuerySchema;

export interface ContentTranslationDto {
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
}

export interface ContentBlockSummaryDto {
  id: string;
  key: string;
  /** Editor: 'video' (home.hero) or 'text' (footer, policies). */
  kind: 'text' | 'video';
  /** Text block with no English text yet: "Pending client content". */
  pending: boolean;
  isPublished: boolean;
  mediaAssetId: string | null;
  languages: string[];
  updatedAt: string;
  updatedBy: string | null;
}

export interface ContentBlockDto extends ContentBlockSummaryDto {
  translations: Translations<ContentTranslationDto>;
}

/* ---------- Content editor by type (tester fixes, 20 Oct 2026) ---------- */

/** content_blocks.content_kind: which editor a block uses. */
export const CONTENT_KINDS = ['text', 'video'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

/** Text blocks are edited in English only (approved Pidgin copy is applied by developers). */
export const CONTENT_TEXT_LANGUAGE = 'en';
export const CONTENT_TITLE_MAX_LENGTH = 200;
export const CONTENT_BODY_MAX_LENGTH = 20_000;

/** Anything that looks like an HTML/XML tag, comment or doctype: text blocks are plain text. */
const MARKUP = /<\s*[a-z!/?]/i;
/** Control characters other than tab and newline. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function plainText(max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .min(1, 'Required.')
        .max(max, `At most ${max} characters.`)
        .refine((value) => !MARKUP.test(value), 'Use plain text: HTML tags are not allowed.')
        .refine((value) => !CONTROL_CHARS.test(value), 'Contains invalid characters.'),
    );
}

/**
 * PUT /admin/content-blocks/:key/text (text blocks only). PLAIN TEXT: a blank line starts a new
 * paragraph and a line starting with "# " is a heading. Never HTML.
 */
export const updateContentTextSchema = z
  .object({
    title: plainText(CONTENT_TITLE_MAX_LENGTH),
    body: plainText(CONTENT_BODY_MAX_LENGTH),
  })
  .strict();
export type UpdateContentTextRequest = z.infer<typeof updateContentTextSchema>;

export type ContentTextPart = { type: 'heading' | 'paragraph'; text: string };

const HEADING_PREFIX = '# ';

/**
 * Plain text -> headings and paragraphs (strings only, never HTML). Clients render each part as
 * escaped text; line breaks inside a paragraph are kept as "\n".
 */
export function parsePlainText(body: string): ContentTextPart[] {
  const parts: ContentTextPart[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) parts.push({ type: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
    } else if (line.startsWith(HEADING_PREFIX)) {
      flush();
      const text = line.slice(HEADING_PREFIX.length).trim();
      if (text !== '') parts.push({ type: 'heading', text });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return parts;
}
