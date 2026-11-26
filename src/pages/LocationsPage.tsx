import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { Crosshair, Loader2, MapPin, MapPinOff, Monitor, Pencil, Plus, Printer, QrCode, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/hooks/useSettings';
import { updateSettings } from '@/services/api';
import { clockUrl, currentPosition, deleteLocation, fetchLocations, fetchStaticToken, QrError, saveLocation, seedDemoLocation, type LocationInput } from '@/services/qr';
import { WBox, WButton, WChip, WInput, WPageHeader, WSegmented } from '@/components/app/ui';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { Switch } from '@/components/shared/ui/Switch';
import { notify } from '@/utils/notify';
import type { Location } from '@/types';

const RADII = [0, 50, 100, 200, 500];
const EMPTY: LocationInput = { name: '', lat: null, lng: null, radius_m: null, allow_static: false, active: true };

/**
 * "/admin/locations": workplaces and their QR codes (PLAN.md 7, 10).
 * Managers open the kiosk and print codes; the owner adds and edits places
 * and decides whether staff may also use the in-app button.
 */
export function LocationsPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';
  const navigate = useNavigate();
  const settings = useSettings();
  const [list, setList] = useState<Location[] | null>(null);
  const [edit, setEdit] = useState<{ id?: string; v: LocationInput } | null>(null);
  const [print, setPrint] = useState<{ name: string; img: string } | null>(null);
  const [buttonOk, setButtonOk] = useState<boolean | null>(null);

  useEffect(() => { if (settings) setButtonOk(settings.allow_button_clock ?? true); }, [settings]);

  const load = useCallback(async () => {
    seedDemoLocation();
    try { setList(await fetchLocations()); } catch { setList([]); notify.error('Could not load locations.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setClockMode = async (allow: boolean) => {
    const before = buttonOk;
    setButtonOk(allow);
    try {
      await updateSettings({ allow_button_clock: allow });
      notify.success(allow ? 'Staff can clock with the button or the QR code' : 'Staff must scan the QR code at work');
    } catch {
      setButtonOk(before);
      notify.error('Could not change the setting.');
    }
  };

  const openPrint = async (l: Location) => {
    try {
      const { token, name } = await fetchStaticToken(l.id);
      setPrint({ name, img: await QRCode.toDataURL(clockUrl(l.id, token), { margin: 2, width: 900, errorCorrectionLevel: 'M' }) });
    } catch (e) {
      notify.error(e instanceof QrError ? e.message : 'Could not make the printed code.');
    }
  };

  return (
    <>
      <WPageHeader
        title="Locations & QR"
        subtitle="Where people clock in. Put a tablet with the kiosk screen at the door, or print a code."
        actions={isOwner ? <WButton onClick={() => setEdit({ v: { ...EMPTY } })}><Plus size={17} /> Add location</WButton> : undefined}
      />

      <div className="sc-grid">
        {isOwner && buttonOk !== null && (
          <WBox title="How staff clock in" meta="Managers can always fix entries.">
            <WSegmented<'any' | 'qr'>
              ariaLabel="Clock-in method"
              value={buttonOk ? 'any' : 'qr'}
              onChange={(v) => void setClockMode(v === 'any')}
              options={[{ value: 'any', label: 'Button or QR' }, { value: 'qr', label: 'QR only' }]}
            />
            <p className="mt-3 text-[14px] text-ink-3 lg:text-[12.5px]">{buttonOk ? 'Staff can tap Start shift anywhere, or scan the code at work.' : 'Staff must scan the code at work. The Start shift button is hidden for them.'}</p>
          </WBox>
        )}

        {list === null && <section className="sc-card"><span className="sc-skel block h-24 w-full" /></section>}
        {list !== null && list.length === 0 && (
          <WBox>
            <div className="sc-empty">
              <span className="ic"><QrCode size={20} /></span>
              <b>No locations yet</b>
              <span>{isOwner ? 'Add your workplace to get a clock-in QR code.' : 'Ask the owner to add your workplace.'}</span>
              {isOwner && <WButton onClick={() => setEdit({ v: { ...EMPTY } })}><Plus size={17} /> Add location</WButton>}
            </div>
          </WBox>
        )}

        <div className="loc-list">
          {(list ?? []).map((l) => (
            <section key={l.id} className="sc-card loc-card">
              <div className="sc-card-h">
                <div className="min-w-0">
                  <h2 className="truncate">{l.name}</h2>
                  <small>{l.radius_m ? <><MapPin size={13} className="inline -mt-0.5" /> Must be within {l.radius_m} m</> : <><MapPinOff size={13} className="inline -mt-0.5" /> No GPS check</>}</small>
                </div>
                <WChip tone={l.active ? 'ok' : 'default'}>{l.active ? 'In use' : 'Off'}</WChip>
              </div>
              <div className="flex flex-wrap gap-2">
                <WChip tone="accent" dot={false}>New code every day</WChip>
                {l.allow_static && <WChip tone="warn" dot={false}>Printed code allowed</WChip>}
              </div>
              <div className="loc-acts">
                <WButton onClick={() => navigate(`/kiosk/${l.id}`)} disabled={!l.active}><Monitor size={17} /> Open kiosk</WButton>
                {l.allow_static && <WButton tone="secondary" onClick={() => void openPrint(l)} disabled={!l.active}><Printer size={17} /> Print code</WButton>}
                {isOwner && <WButton tone="ghost" onClick={() => setEdit({ id: l.id, v: { name: l.name, lat: l.lat, lng: l.lng, radius_m: l.radius_m, allow_static: l.allow_static, active: l.active } })} aria-label={`Edit ${l.name}`}><Pencil size={17} /> Edit</WButton>}
              </div>
            </section>
          ))}
        </div>
      </div>

      <LocationSheet
        value={edit}
        onClose={() => setEdit(null)}
        onSaved={async () => { setEdit(null); await load(); }}
      />

      <BottomSheet open={print !== null} onClose={() => setPrint(null)} title="Printed QR code" footer={<WButton onClick={() => window.print()}><Printer size={18} /> Print</WButton>}>
        {print && (
          <div className="print-area">
            <p className="sheet-sub">Anyone with a photo of this code can clock in from anywhere unless the location has a GPS circle. The rotating kiosk code is safer.</p>
            <div className="print-sheet">
              <b>{print.name}</b>
              <img src={print.img} alt={`Printed clock-in code for ${print.name}`} />
              <span>Scan with your phone camera to clock in or out</span>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

function LocationSheet({ value, onClose, onSaved }: { value: { id?: string; v: LocationInput } | null; onClose(): void; onSaved(): Promise<void> }) {
  const [v, setV] = useState<LocationInput>(EMPTY);
  const [busy, setBusy] = useState<'save' | 'gps' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => { if (value) { setV(value.v); setError(null); setBusy(null); setSure(false); } }, [value]);

  const useHere = async () => {
    setBusy('gps'); setError(null);
    try {
      const p = await currentPosition(15_000);
      setV((x) => ({ ...x, lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6, radius_m: x.radius_m ?? 100 }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const save = async () => {
    if (!v.name.trim()) { setError('Give the location a name.'); return; }
    setBusy('save'); setError(null);
    try { await saveLocation(v, value?.id); notify.success(value?.id ? 'Location saved' : 'Location added'); await onSaved(); } catch (e) { setError((e as Error).message); setBusy(null); }
  };
  const del = async () => {
    if (!value?.id) return;
    // two taps instead of a pop-up: the first one asks, the second deletes
    if (!sure) { setSure(true); return; }
    setBusy('delete');
    try { await deleteLocation(value.id); notify.success('Location deleted'); await onSaved(); } catch (e) { setError((e as Error).message); setBusy(null); }
  };

  return (
    <BottomSheet
      open={value !== null}
      onClose={onClose}
      title={value?.id ? 'Edit location' : 'Add location'}
      footer={(
        <>
          {value?.id && <WButton tone="danger" onClick={del} disabled={busy !== null}><Trash2 size={18} /> {sure ? 'Tap again to delete' : 'Delete'}</WButton>}
          <WButton onClick={save} disabled={busy !== null}>{busy === 'save' ? <Loader2 size={18} className="animate-spin" /> : value?.id ? 'Save' : 'Add location'}</WButton>
        </>
      )}
    >
      <div className="grid gap-4">
        <WInput label="Name" placeholder="e.g. Main door" maxLength={80} value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} required />
        <div className="w-field">
          <span className="w-label">GPS check (optional)</span>
          <p className="m-0 text-[14px] text-ink-3 lg:text-[12.5px]">Stand at the workplace and tap the button. A scan then only works within the distance below.</p>
          <WButton tone="secondary" onClick={useHere} disabled={busy !== null}>{busy === 'gps' ? <Loader2 size={18} className="animate-spin" /> : <Crosshair size={18} />} {v.lat !== null ? 'Update to this position' : 'Use this position'}</WButton>
          {v.lat !== null && <p className="m-0 text-[14px] text-ink-2 tnum lg:text-[12.5px]">{v.lat.toFixed(5)}, {v.lng?.toFixed(5)}</p>}
        </div>
        {v.lat !== null && (
          <div className="w-field">
            <span className="w-label">Must be within</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Distance">
              {RADII.map((r) => (
                <button key={r} type="button" className="sc-preset" aria-pressed={(v.radius_m ?? 0) === r} onClick={() => setV((x) => (r === 0 ? { ...x, lat: null, lng: null, radius_m: null } : { ...x, radius_m: r }))}>
                  {r === 0 ? 'No GPS check' : `${r} m`}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="loc-toggle">
          <span><b>Allow a printed code</b><small>A paper code that never changes. Easier, but a photo of it works from anywhere.</small></span>
          <Switch checked={v.allow_static} onChange={(c) => setV((x) => ({ ...x, allow_static: c }))} label="Allow a printed code" />
        </label>
        <label className="loc-toggle">
          <span><b>In use</b><small>Switch off to stop all codes for this place.</small></span>
          <Switch checked={v.active} onChange={(c) => setV((x) => ({ ...x, active: c }))} label="In use" />
        </label>
        {sure && <div className="sc-alert danger" role="alert"><span>Its QR codes stop working at once. Past clock entries are kept.</span></div>}
        {error && <div className="sc-alert danger" role="alert"><span>{error}</span></div>}
      </div>
    </BottomSheet>
  );
}
