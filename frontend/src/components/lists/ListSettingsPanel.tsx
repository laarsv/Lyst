import { useEffect } from 'react';
import type { ListSummary } from '@/types';
import { SharePanel } from '@/components/lists/SharePanel';
import { CollaboratorsPanel } from '@/components/lists/CollaboratorsPanel';
import { RemindersPanel } from '@/components/lists/RemindersPanel';
import { HistoryPanel } from '@/components/lists/HistoryPanel';

interface Props {
  open: boolean;
  list: ListSummary;
  onClose: () => void;
  onListUpdate: (patch: Partial<ListSummary>) => void;
}

/** Slide-in side panel that hosts every list setting (share / collaborators
 *  / reminders / history). The list detail view itself stays focused on
 *  the items — these panels only appear here. */
export function ListSettingsPanel({ open, list, onClose, onListUpdate }: Props) {
  // Esc closes the panel and we lock the body scroll while it's open so
  // the dimmed content behind doesn't shift the viewport on overflow.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — slight dim, click-to-close */}
      <button
        type="button"
        aria-hidden={!open}
        tabIndex={-1}
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-ink/30 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Panel — full width on phones, 400px on >= sm */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Listen-Einstellungen"
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[400px] bg-page border-l border-line
          shadow-flat transition-transform duration-200 ease-out flex flex-col
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{
          paddingTop: 'env(safe-area-inset-top, 0)',
          paddingBottom: 'env(safe-area-inset-bottom, 0)',
        }}
      >
        <header className="px-4 py-3 border-b border-line bg-surface flex items-center gap-2">
          <h2 className="font-semibold flex-1">Einstellungen</h2>
          <button
            type="button"
            className="p-2 rounded-lg text-muted hover:bg-page hover:text-ink"
            aria-label="Schließen"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        {/* Sections — independently scrollable so a long history doesn't push
            share controls off-screen. */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <Section title="Öffentlicher Link">
            <SharePanel list={list} onUpdate={onListUpdate} />
          </Section>
          <Section title="Mitnutzer">
            <CollaboratorsPanel listId={list.id} />
          </Section>
          <Section title="Erinnerungen">
            <RemindersPanel listId={list.id} />
          </Section>
          <Section title="Verlauf">
            <HistoryPanel listId={list.id} />
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted mb-1.5 px-1">
        {title}
      </div>
      {children}
    </section>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
