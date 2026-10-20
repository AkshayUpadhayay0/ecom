import { useQuery } from '@tanstack/react-query';
import { isAdminEditableSetting, type SettingDto } from '@urban-ibile/shared';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryStates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useIsSuperAdmin } from '@/features/auth/roles';
import { configApi } from '@/lib/api/config-api';
import { SETTINGS_QUERY_KEY } from '@/layout/use-store-time-zone';
import { formatDateTime } from '@/lib/format';
import { humanise } from '@/lib/status';
import { useAdminMutation } from '@/lib/use-admin-mutation';

const settingsKey = SETTINGS_QUERY_KEY;
const SENSITIVE_SETTING = 'Read-only: technical setting, changed by developers (super admin).';

type Kind = 'number' | 'boolean' | 'string' | 'json';

/** Editor type from the current value or, when unset, the default. */
function kindOf(setting: SettingDto): Kind {
  const sample = setting.value ?? setting.defaultValue;
  if (typeof sample === 'number') return 'number';
  if (typeof sample === 'boolean') return 'boolean';
  if (typeof sample === 'string') return 'string';
  return sample === null || sample === undefined ? 'string' : 'json';
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function SettingEditor({ setting, onClose }: { setting: SettingDto; onClose: () => void }) {
  const kind = kindOf(setting);
  const initial = setting.value ?? setting.defaultValue;
  const [text, setText] = useState(
    initial === null || initial === undefined
      ? ''
      : kind === 'json'
        ? JSON.stringify(initial, null, 2)
        : display(initial),
  );
  const [error, setError] = useState<string | null>(null);
  const save = useAdminMutation((value: unknown) => configApi.updateSetting(setting.key, value), {
    success: 'Setting saved.',
    invalidate: [settingsKey],
  });

  function parse(): { ok: true; value: unknown } | { ok: false } {
    if (kind === 'number') {
      const value = Number(text);
      return text.trim() !== '' && Number.isFinite(value) ? { ok: true, value } : { ok: false };
    }
    if (kind === 'boolean') return { ok: true, value: text === 'true' };
    if (kind === 'json') {
      try {
        return { ok: true, value: JSON.parse(text) as unknown };
      } catch {
        return { ok: false };
      }
    }
    return text.trim() === '' ? { ok: false } : { ok: true, value: text.trim() };
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Edit ${setting.key}`}
      description={setting.description ?? undefined}
      confirmLabel="Save setting"
      onConfirm={async () => {
        const parsed = parse();
        if (!parsed.ok) {
          setError('Enter a valid value.');
          throw new Error('Enter a valid value.');
        }
        await save.mutateAsync(parsed.value);
      }}
    >
      {kind === 'boolean' ? (
        <Field label="Value">
          <NativeSelect
            value={text === '' ? 'false' : text}
            onChange={(e) => setText(e.target.value)}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </NativeSelect>
        </Field>
      ) : kind === 'json' ? (
        <Field label="Value (JSON)" error={error ?? undefined}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-xs"
            rows={8}
          />
        </Field>
      ) : (
        <Field
          label="Value"
          error={error ?? undefined}
          hint={
            setting.defaultValue !== null && setting.defaultValue !== undefined
              ? `Default: ${display(setting.defaultValue)}`
              : undefined
          }
        >
          <Input
            type={kind === 'number' ? 'number' : 'text'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      )}
    </ConfirmDialog>
  );
}

export function SettingsPage() {
  const settings = useQuery({ queryKey: settingsKey, queryFn: configApi.settings });
  const [editing, setEditing] = useState<SettingDto | null>(null);
  const [clearing, setClearing] = useState<SettingDto | null>(null);
  const isSuper = useIsSuperAdmin();
  // One shared list (packages/shared ADMIN_EDITABLE_SETTING_KEYS) used by the API and the UI.
  const canEdit = (key: string) => isSuper || isAdminEditableSetting(key);
  const clear = useAdminMutation((key: string) => configApi.updateSetting(key, null), {
    success: 'Setting cleared (not provided).',
    invalidate: [settingsKey],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Store configuration (limits, timings, contact details). Items marked “not provided” are pending client decisions; the shop uses the default meanwhile. Contact details and the return address can be changed by every admin; other settings are sensitive configuration and only a super admin can change them."
      />
      <QueryView
        query={settings}
        what="settings"
        isEmpty={(d) => d.length === 0}
        empty={{ icon: Settings, title: 'No settings', description: 'Nothing to configure.' }}
      >
        {(data) => {
          const groups = new Map<string, SettingDto[]>();
          for (const setting of data) {
            const group = setting.key.split('.')[0] ?? 'other';
            groups.set(group, [...(groups.get(group) ?? []), setting]);
          }
          return (
            <div className="space-y-6">
              {[...groups.entries()].map(([group, items]) => (
                <Card key={group} className="overflow-hidden">
                  <CardHeader>
                    <CardTitle>{humanise(group)}</CardTitle>
                  </CardHeader>
                  <ul className="divide-y border-t">
                    {items.map((setting) => (
                      <li
                        key={setting.key}
                        className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-xs">{setting.key}</p>
                          {setting.description ? (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {setting.description}
                            </p>
                          ) : null}
                          <p className="mt-1 text-sm">
                            {setting.value === null ? (
                              <>
                                <Badge tone="warning">Not provided</Badge>
                                {setting.defaultValue !== null &&
                                setting.defaultValue !== undefined ? (
                                  <span className="ml-2 text-muted-foreground">
                                    using default {display(setting.defaultValue)}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="break-all">{display(setting.value)}</span>
                            )}
                          </p>
                          {setting.updatedAt ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Updated {formatDateTime(new Date(setting.updatedAt))}
                            </p>
                          ) : null}
                        </div>
                        {canEdit(setting.key) ? (
                          <div className="flex shrink-0 gap-2">
                            <Button variant="outline" size="sm" onClick={() => setEditing(setting)}>
                              Edit
                            </Button>
                            {setting.value !== null ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setClearing(setting)}
                              >
                                Clear
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          // Read-only for the client's staff; the API refuses changes (403).
                          <p className="shrink-0 text-xs text-muted-foreground sm:max-w-48 sm:text-right">
                            {SENSITIVE_SETTING}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          );
        }}
      </QueryView>
      {editing ? (
        <SettingEditor key={editing.key} setting={editing} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={clearing !== null}
        onOpenChange={(o) => !o && setClearing(null)}
        title={`Clear ${clearing?.key ?? ''}?`}
        description="The value becomes “not provided”; the shop uses the default (if any)."
        confirmLabel="Clear value"
        onConfirm={() => (clearing ? clear.mutateAsync(clearing.key) : Promise.resolve())}
      />
    </div>
  );
}
