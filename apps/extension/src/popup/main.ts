import { listHubs, saveLink } from '../lib/api';
import { loadSettings } from '../lib/settings';
import { outcomeMessage } from './outcome';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const titleEl = $<HTMLInputElement>('title');
const noteEl = $<HTMLTextAreaElement>('note');
const hubEl = $<HTMLSelectElement>('hub');
const saveEl = $<HTMLButtonElement>('save');
const statusEl = $<HTMLDivElement>('status');

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) { setStatus('No page to save', true); saveEl.disabled = true; return; }
  titleEl.value = tab.title ?? '';

  const { baseUrl } = await loadSettings();

  // A failure here must not block saving — the hub dropdown is a convenience,
  // the capture is the point.
  try {
    for (const hub of await listHubs(baseUrl)) {
      const opt = document.createElement('option');
      opt.value = hub.name;
      opt.textContent = `${hub.name} (${hub.linkCount})`;
      hubEl.append(opt);
    }
  } catch {
    setStatus('Could not load hubs — saving still works');
  }

  saveEl.addEventListener('click', async () => {
    saveEl.disabled = true;
    setStatus('Saving…');
    try {
      const res = await saveLink(baseUrl, {
        url: tab.url!,
        title: titleEl.value,
        note: noteEl.value,
        hub: hubEl.value,
      });
      setStatus(outcomeMessage(res));
      setTimeout(() => window.close(), 700);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Save failed', true);
      saveEl.disabled = false;
    }
  });
}

void init();
