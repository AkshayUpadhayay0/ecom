'use client';

import {
  createAddressSchema,
  type AddressDto,
  type CustomerDeliveryZoneDto,
} from '@urban-ibile/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { useFormState } from '@/components/auth/use-form-state';
import {
  CheckboxField,
  ErrorSummary,
  Field,
  SelectField,
  StatusMessage,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/ui/form';
import { bff } from '@/lib/client/bff';
import { describeError } from '@/lib/client/error-messages';
import { blankToUndefined, validate } from '@/lib/forms/validate';
import { useI18n } from '@/lib/i18n/provider';

export const ADDRESSES_KEY = ['addresses'] as const;
const ZONES_KEY = ['delivery-zones'] as const;

interface FormValues {
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  landmark: string;
  deliveryZoneId: string;
  isDefault: boolean;
}

function emptyValues(): FormValues {
  return {
    label: '',
    recipientName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    landmark: '',
    deliveryZoneId: '',
    isDefault: false,
  };
}

function valuesOf(address: AddressDto): FormValues {
  return {
    label: address.label ?? '',
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? '',
    city: address.city,
    state: address.state ?? '',
    landmark: address.landmark ?? '',
    deliveryZoneId: address.deliveryZone.id,
    isDefault: address.isDefault,
  };
}

function AddressForm({
  editing,
  zones,
  onDone,
}: {
  editing: AddressDto | null;
  zones: CustomerDeliveryZoneDto[];
  onDone: (message: string) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const form = useFormState();
  const [values, setValues] = useState<FormValues>(editing ? valuesOf(editing) : emptyValues());
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form.submitting) return;
    const payload = {
      label: blankToUndefined(values.label),
      recipientName: values.recipientName,
      phone: values.phone,
      addressLine1: values.addressLine1,
      addressLine2: blankToUndefined(values.addressLine2),
      city: values.city,
      state: blankToUndefined(values.state),
      landmark: blankToUndefined(values.landmark),
      deliveryZoneId: values.deliveryZoneId,
      isDefault: values.isDefault,
    };
    const result = validate(createAddressSchema, payload);
    if (!result.ok) {
      form.fail(result.errors);
      return;
    }
    form.reset();
    form.setSubmitting(true);
    try {
      if (editing) {
        // The API only moves the default to this address (isDefault: true); never un-sets it.
        const { isDefault, ...rest } = result.data;
        await bff('me/addresses/' + editing.id, {
          method: 'PATCH',
          json: { ...rest, ...(isDefault && !editing.isDefault ? { isDefault: true } : {}) },
        });
      } else {
        await bff('me/addresses', { method: 'POST', json: result.data });
      }
      await queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY });
      onDone(t('account.address.saved'));
    } catch (error) {
      form.fail({}, error);
      form.setSubmitting(false);
    }
  }

  const labels = {
    recipientName: t('account.address.recipient'),
    phone: t('account.address.phone'),
    addressLine1: t('account.address.line1'),
    city: t('account.address.city'),
    deliveryZoneId: t('account.address.zone'),
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      aria-label={editing ? t('account.address.edit') : t('account.address.add')}
      className="max-w-lg space-y-4 border border-line bg-white p-4"
    >
      <ErrorSummary
        fields={form.errors}
        labels={labels}
        message={form.serverMessage}
        attempt={form.attempt}
      />
      <Field
        name="label"
        label={t('account.address.label')}
        value={values.label}
        onChange={(e) => {
          set('label', e.target.value);
        }}
      />
      <Field
        name="recipientName"
        label={labels.recipientName}
        autoComplete="name"
        value={values.recipientName}
        error={form.errors.recipientName}
        onChange={(e) => {
          set('recipientName', e.target.value);
        }}
      />
      <Field
        name="phone"
        label={labels.phone}
        type="tel"
        autoComplete="tel"
        value={values.phone}
        error={form.errors.phone}
        onChange={(e) => {
          set('phone', e.target.value);
        }}
      />
      <Field
        name="addressLine1"
        label={labels.addressLine1}
        autoComplete="address-line1"
        value={values.addressLine1}
        error={form.errors.addressLine1}
        onChange={(e) => {
          set('addressLine1', e.target.value);
        }}
      />
      <Field
        name="addressLine2"
        label={t('account.address.line2')}
        autoComplete="address-line2"
        value={values.addressLine2}
        onChange={(e) => {
          set('addressLine2', e.target.value);
        }}
      />
      <Field
        name="city"
        label={labels.city}
        autoComplete="address-level2"
        value={values.city}
        error={form.errors.city}
        onChange={(e) => {
          set('city', e.target.value);
        }}
      />
      <Field
        name="state"
        label={t('account.address.state')}
        autoComplete="address-level1"
        value={values.state}
        onChange={(e) => {
          set('state', e.target.value);
        }}
      />
      <Field
        name="landmark"
        label={t('account.address.landmark')}
        value={values.landmark}
        onChange={(e) => {
          set('landmark', e.target.value);
        }}
      />
      <SelectField
        name="deliveryZoneId"
        label={labels.deliveryZoneId}
        placeholder={t('account.address.zone_choose')}
        value={values.deliveryZoneId}
        error={form.errors.deliveryZoneId}
        options={zones.map((zone) => ({ value: zone.id, label: zone.name }))}
        onChange={(value) => {
          set('deliveryZoneId', value);
        }}
      />
      {!editing?.isDefault ? (
        <CheckboxField
          name="isDefault"
          label={t('account.address.make_default_check')}
          checked={values.isDefault}
          onChange={(checked) => {
            set('isDefault', checked);
          }}
        />
      ) : null}
      <div className="flex gap-3">
        <button type="submit" disabled={form.submitting} className={primaryButtonClass}>
          {form.submitting ? t('form.submitting') : t('form.save')}
        </button>
        <button
          type="button"
          onClick={() => {
            onDone('');
          }}
          className={secondaryButtonClass}
        >
          {t('form.cancel')}
        </button>
      </div>
    </form>
  );
}

export function AddressesSection() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const addresses = useQuery({
    queryKey: ADDRESSES_KEY,
    queryFn: () => bff<AddressDto[]>('me/addresses'),
  });
  const zones = useQuery({
    queryKey: ZONES_KEY,
    queryFn: () => bff<CustomerDeliveryZoneDto[]>('delivery/zones'),
  });
  const [mode, setMode] = useState<'list' | { edit: AddressDto | null }>('list');
  const [note, setNote] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => bff<undefined>('me/addresses/' + id, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY });
      setNote(t('account.address.removed'));
    },
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) =>
      bff('me/addresses/' + id, { method: 'PATCH', json: { isDefault: true } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY }),
  });

  const zoneList = zones.data ?? [];
  const failure = remove.error ?? makeDefault.error ?? addresses.error;
  const described = failure ? describeError(failure) : null;

  return (
    <section aria-labelledby="addresses-heading" className="space-y-4">
      <h2 id="addresses-heading" className="text-xl font-semibold">
        {t('account.addresses')}
      </h2>
      {described ? (
        <p role="alert" className="text-red-text">
          {t(described.key, described.params)}
        </p>
      ) : null}
      {note ? <StatusMessage>{note}</StatusMessage> : null}

      {mode === 'list' ? (
        <>
          {addresses.isPending ? <p>{t('form.loading')}</p> : null}
          {addresses.data?.length === 0 ? <p>{t('account.addresses_empty')}</p> : null}
          <ul className="grid gap-4 sm:grid-cols-2">
            {addresses.data?.map((address) => (
              <li
                key={address.id}
                className="space-y-1 border border-line bg-white p-4"
                data-testid="address-card"
              >
                <p className="font-semibold">
                  {address.label ?? address.recipientName}
                  {address.isDefault ? (
                    <span className="ml-2 bg-emerald px-2 py-0.5 text-sm font-normal text-ivory">
                      {t('account.address.default')}
                    </span>
                  ) : null}
                </p>
                <p>{address.recipientName}</p>
                <p>
                  {[address.addressLine1, address.addressLine2, address.city, address.state]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                <p className="text-sm text-ink-muted">{address.deliveryZone.name}</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => {
                      setNote(null);
                      setMode({ edit: address });
                    }}
                  >
                    {t('form.edit')}
                  </button>
                  {!address.isDefault ? (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={makeDefault.isPending}
                      onClick={() => {
                        makeDefault.mutate(address.id);
                      }}
                    >
                      {t('account.address.make_default')}
                    </button>
                  ) : null}
                  {confirmId === address.id ? (
                    <span
                      role="group"
                      aria-label={t('account.address.confirm_delete')}
                      className="flex items-center gap-2"
                    >
                      <span>{t('account.address.confirm_delete')}</span>
                      <button
                        type="button"
                        className={primaryButtonClass}
                        onClick={() => {
                          remove.mutate(address.id);
                          setConfirmId(null);
                        }}
                      >
                        {t('form.delete')}
                      </button>
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        onClick={() => {
                          setConfirmId(null);
                        }}
                      >
                        {t('form.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => {
                        setConfirmId(address.id);
                      }}
                    >
                      {t('form.delete')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {zones.isSuccess && zoneList.length === 0 ? <p>{t('account.address.no_zones')}</p> : null}
          <button
            type="button"
            className={primaryButtonClass}
            disabled={zoneList.length === 0}
            onClick={() => {
              setNote(null);
              setMode({ edit: null });
            }}
          >
            {t('account.address.add')}
          </button>
        </>
      ) : (
        <AddressForm
          editing={mode.edit}
          zones={zoneList}
          onDone={(message) => {
            setNote(message || null);
            setMode('list');
          }}
        />
      )}
    </section>
  );
}
