import { useQuery } from '@tanstack/react-query';
import type { AdminHiddenPageDto, SerialImportResultDto } from '@urban-ibile/shared';
import { KeyRound, QrCode, Upload } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InfoBanner, PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ListCard, QueryView } from '@/components/QueryStates';
import { SuperAdminOnly } from '@/components/SuperAdminOnly';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useIsSuperAdmin } from '@/features/auth/roles';
import { configApi } from '@/lib/api/config-api';
import { formatDateTime } from '@/lib/format';
import { notify } from '@/lib/notify';
import { useAdminMutation } from '@/lib/use-admin-mutation';

const qrKeys = {
  pages: ['config', 'hidden-pages'] as const,
  batches: (page: number) => ['config', 'serial-batches', page] as const,
};

function ContentEditor({ page, onClose }: { page: AdminHiddenPageDto; onClose: () => void }) {
  const [title, setTitle] = useState(page.title ?? '');
  const [body, setBody] = useState(page.body ?? '');
  const save = useAdminMutation(
    () => configApi.updateHiddenPage(page.id, { title: title.trim(), body: body.trim() }),
    {
      success: 'Page content saved.',
      invalidate: [qrKeys.pages],
    },
  );
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Page ${page.slotNumber} content`}
      description="Only the title and text can change. The link and QR code stay the same forever."
      confirmLabel="Save content"
      confirmDisabled={title.trim() === '' || body.trim() === ''}
      onConfirm={() => save.mutateAsync(undefined)}
    >
      <Field label="Title" required>
        <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Text" required>
        <Textarea value={body} rows={8} onChange={(e) => setBody(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

function SerialsPanel() {
  const isSuper = useIsSuperAdmin();
  const [page, setPage] = useState(1);
  const batches = useQuery({
    queryKey: qrKeys.batches(page),
    queryFn: () => configApi.serialBatches({ page }),
    enabled: isSuper,
  });
  const [file, setFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [result, setResult] = useState<SerialImportResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [serial, setSerial] = useState('');
  const deactivate = useAdminMutation((value: string) => configApi.deactivateSerial(value), {
    success: (s) => `Serial ${s.hint ?? ''} deactivated.`,
    invalidate: [['config', 'serial-batches']],
  });

  async function runImport(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    try {
      const csv = await file.text();
      const imported = await configApi.importSerials(csv, {
        sourceName: sourceName.trim() || file.name,
        dryRun,
      });
      setResult(imported);
      notify.success(
        dryRun
          ? `Check finished: ${imported.imported} serial(s) would be imported.`
          : `${imported.imported} serial(s) imported.`,
      );
      if (!dryRun) await batches.refetch();
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Serial numbers</CardTitle>
        <CardDescription>
          Serials are stored only as secure hashes and are never shown or listed — only batch counts
          and masked hints. Import and deactivation are for super admins.
        </CardDescription>
      </CardHeader>
      <div className="space-y-5 px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <Field
            label="CSV file"
            hint="Columns: serial, category (GENERAL / EXCLUSIVE), pageSlot (GENERAL only)."
          >
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={!isSuper}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2"
            />
          </Field>
          <Field label="Source name">
            <Input
              value={sourceName}
              disabled={!isSuper}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="e.g. Client list 16 Oct"
            />
          </Field>
          <SuperAdminOnly>
            <Button variant="outline" disabled={!file || busy} onClick={() => void runImport(true)}>
              Check only
            </Button>
          </SuperAdminOnly>
          <SuperAdminOnly>
            <Button disabled={!file || busy} onClick={() => void runImport(false)}>
              <Upload aria-hidden="true" /> Import
            </Button>
          </SuperAdminOnly>
        </div>
        {result ? (
          <div role="status" className="rounded-lg border p-3 text-sm">
            <p className="font-medium">
              {result.dryRun ? 'Check only (nothing saved): ' : 'Imported: '}
              {result.imported} of {result.totalRows} rows · General {result.byCategory.GENERAL} ·
              Exclusive {result.byCategory.EXCLUSIVE}
            </p>
            {[...result.duplicates, ...result.invalid].length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                {[...result.duplicates, ...result.invalid].slice(0, 20).map((issue) => (
                  <li key={`${issue.line}-${issue.reason}`}>
                    Line {issue.line} {issue.hint ? `(${issue.hint})` : ''}: {issue.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <SuperAdminOnly>
            <Button variant="outline" onClick={() => setDeactivating(true)}>
              <KeyRound aria-hidden="true" /> Deactivate a serial
            </Button>
          </SuperAdminOnly>
        </div>
        {isSuper ? (
          <QueryView
            query={batches}
            what="serial batches"
            isEmpty={(d) => d.data.length === 0}
            empty={{
              icon: KeyRound,
              title: 'No serials imported yet',
              description: 'Serial lists are pending from the client.',
            }}
          >
            {(data) => (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead scope="col">Batch</TableHead>
                      <TableHead scope="col" className="text-right">
                        Rows
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        Active
                      </TableHead>
                      <TableHead scope="col">By</TableHead>
                      <TableHead scope="col">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>{b.sourceName ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.rowCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.activeCount}</TableCell>
                        <TableCell>{b.admin?.displayName ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(new Date(b.createdAt))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pagination meta={data.meta} onPage={setPage} />
              </>
            )}
          </QueryView>
        ) : null}
      </div>
      <ConfirmDialog
        open={deactivating}
        onOpenChange={(o) => {
          setDeactivating(o);
          if (!o) setSerial('');
        }}
        title="Deactivate a serial"
        description="Type the exact serial. It stops unlocking pages at once. The serial is sent once to be matched against its hash and is never stored or shown."
        confirmLabel="Deactivate"
        destructive
        confirmDisabled={serial.trim() === ''}
        onConfirm={async () => {
          try {
            await deactivate.mutateAsync(serial.trim());
          } finally {
            setSerial('');
          }
        }}
      >
        <Field label="Serial" required>
          <Input value={serial} autoComplete="off" onChange={(e) => setSerial(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}

export function QrPagesPage() {
  const pages = useQuery({
    queryKey: qrKeys.pages,
    queryFn: async () => (await configApi.hiddenPages()).data,
  });
  const [editing, setEditing] = useState<AdminHiddenPageDto | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="QR Pages"
        description="Hidden pages opened from permanent QR codes. A page unlocks only with a valid serial number; the QR code alone never unlocks anything."
      />
      <InfoBanner>
        Final page texts and the serial lists are pending from the client. Links and route tokens
        never change, so printed QR codes keep working.
      </InfoBanner>
      <ListCard>
        <QueryView
          query={pages}
          what="QR pages"
          isEmpty={(d) => d.length === 0}
          empty={{
            icon: QrCode,
            title: 'No QR pages',
            description: 'QR pages are created with the database setup.',
          }}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Page</TableHead>
                  <TableHead scope="col">Title</TableHead>
                  <TableHead scope="col">QR link (read-only)</TableHead>
                  <TableHead scope="col">Access</TableHead>
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      #{p.slotNumber}
                      <span className="block font-mono text-xs text-muted-foreground">
                        {p.slug}
                      </span>
                    </TableCell>
                    <TableCell>
                      {p.title ?? <span className="text-muted-foreground">No title yet</span>}
                    </TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-xs" title={p.publicUrl}>
                      {p.publicUrl}
                    </TableCell>
                    <TableCell>
                      {p.exclusiveOnly ? (
                        <Badge tone="accent">Exclusive serials only</Badge>
                      ) : (
                        <Badge>General or Exclusive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        Edit content
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryView>
      </ListCard>
      <SerialsPanel />
      {editing ? (
        <ContentEditor key={editing.id} page={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
