import {
  CONTENT_BODY_MAX_LENGTH,
  CONTENT_KEYS_NOT_SHOWN_ON_SITE,
  CONTENT_NOT_SHOWN_NOTE,
  CONTENT_TEXT_LANGUAGE,
  CONTENT_TITLE_MAX_LENGTH,
  parsePlainText,
  updateContentTextSchema,
  type ContentBlockDto,
} from '@urban-ibile/shared';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useIsSuperAdmin } from '@/features/auth/roles';
import { configApi } from '@/lib/api/config-api';
import { errorMessage } from '@/lib/notify';
import { useAdminMutation } from '@/lib/use-admin-mutation';

/**
 * Plain-text editor for text blocks (footer, policies). English only: approved Pidgin copy is
 * applied by developers, so there are no language fields. The preview renders parts as escaped
 * text through React (never as HTML).
 */
export function TextBlockEditor({
  block,
  invalidate,
}: {
  block: ContentBlockDto;
  invalidate: readonly (readonly string[])[];
}) {
  const english = block.translations[CONTENT_TEXT_LANGUAGE];
  const savedTitle = english?.title ?? '';
  const savedBody = english?.body ?? '';
  const [title, setTitle] = useState(savedTitle);
  const [body, setBody] = useState(savedBody);
  const [error, setError] = useState<string | null>(null);
  const save = useAdminMutation(
    (text: { title: string; body: string }) => configApi.setBlockText(block.key, text),
    { success: 'Content saved.', invalidate: invalidate.map((key) => [...key]) },
  );

  const isSuper = useIsSuperAdmin();
  const [resetting, setResetting] = useState(false);
  const reset = useAdminMutation(() => configApi.resetBlockText(block.key), {
    success: 'Restored the default: Pending client content, published.',
    invalidate: invalidate.map((key) => [...key]),
  });

  const parsed = updateContentTextSchema.safeParse({ title, body });
  const problem = parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Check the text.');
  const changed = title !== savedTitle || body !== savedBody;
  const parts = parsePlainText(body);

  async function submit() {
    if (!parsed.success) return;
    setError(null);
    try {
      await save.mutateAsync(parsed.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {block.pending ? (
          <Badge tone="warning">Pending client content</Badge>
        ) : (
          <Badge tone="success">Text provided</Badge>
        )}
        <span className="text-xs text-muted-foreground">English</span>
        {CONTENT_KEYS_NOT_SHOWN_ON_SITE.includes(block.key) ? (
          <Badge>Not shown on the website</Badge>
        ) : null}
      </div>
      {CONTENT_KEYS_NOT_SHOWN_ON_SITE.includes(block.key) ? (
        <p className="text-sm text-muted-foreground">{CONTENT_NOT_SHOWN_NOTE}</p>
      ) : null}
      <Field label="Title" required>
        <Input
          value={title}
          maxLength={CONTENT_TITLE_MAX_LENGTH}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field
        label="Text"
        required
        hint="Plain text only (no HTML). Leave an empty line to start a new paragraph; start a line with “# ” for a heading."
      >
        <Textarea
          value={body}
          rows={12}
          maxLength={CONTENT_BODY_MAX_LENGTH}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      {changed && problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {isSuper ? (
          // Developer recovery (super_admin only; the API refuses others with 403).
          <Button variant="outline" onClick={() => setResetting(true)}>
            Reset to default
          </Button>
        ) : null}
        <Button
          onClick={() => void submit()}
          disabled={!changed || problem !== null || save.isPending}
        >
          {save.isPending ? 'Saving…' : block.pending ? 'Save' : 'Update'}
        </Button>
      </div>
      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title={`Reset ${block.key} to its default?`}
        description="This restores the “Pending client content” placeholder and the published state, and removes the current text. No new text is added. The change is recorded in the audit log."
        confirmLabel="Reset to default"
        destructive
        onConfirm={() => reset.mutateAsync(undefined)}
      />
      {parts.length > 0 ? (
        <section aria-label="Preview" className="space-y-2 rounded-lg border bg-muted/30 p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Preview
          </p>
          {title.trim() ? <h3 className="font-display text-lg">{title.trim()}</h3> : null}
          {parts.map((part, index) =>
            part.type === 'heading' ? (
              <h4 key={index} className="font-medium">
                {part.text}
              </h4>
            ) : (
              <p key={index} className="whitespace-pre-line text-muted-foreground">
                {part.text}
              </p>
            ),
          )}
        </section>
      ) : null}
    </div>
  );
}
