import type { ImportSuggestion } from '@bukmark/shared/review';
import { builderSource } from '../builder/model.js';
import { suggestBin } from '../sift/bins.js';

function file(folder: string, reason: string): ImportSuggestion { return { folder, reason }; }
function ask(question: string, reason: string): ImportSuggestion { return { folder: null, reason, question }; }

/** A local filing suggestion has no delivery destination. Only a saved title and address enter this function. */
export function importSuggestion(title: string, address: string): ImportSuggestion {
  const u = URL.parse(address);
  if (!u || !title.trim()) return ask('What did you want to return to?', 'The saved details do not identify the page.');
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname.toLowerCase();
  const text = title.toLowerCase();
  if (/(?:^|\/)(?:checkout|cart|basket)(?:\/|$)/.test(path))
    return ask('Is this purchase still unfinished?', 'This link opens a checkout. Keep it for an open purchase or archive it when finished.');
  if (/\/(?:log[-_]?in|signin|auth|profile|account|admin)(?:\/|$)/.test(path) || /^admin\./.test(host))
    return ask('Do you need this shortcut for an open task?', 'The address leads into an account.');
  if (path === '/search' || (u.searchParams.has('q') && /search/i.test(title)))
    return ask('Which result were you looking for?', 'This bookmark saves a search. You can record the result you want to revisit.');
  if (/\/(?:book|booking|reserve|reserveren)(?:\/|$)/.test(path) || (/book|booking/.test(host) && /airport|parking/.test(text + path)))
    return ask('Is this booking still part of your plans?', 'The address leads into a booking flow.');
  if (/\/(?:programme?|programma|events?|concerts?)(?:\/|$)/.test(path))
    return ask('Are you planning to go?', 'This is an event or programme page.');
  if (/black friday|black-friday|aanbiedingen|\/deals\b/.test(text + ' ' + path) || /\/product\/.+/.test(path))
    return ask('Which item or price would make this worth revisiting?', 'The saved details point to an offer. Your shopping interest stays here.');
  if (builderSource(address) || (host === 'huggingface.co' && /^\/[\w.-]+\/[\w.-]+\/?$/.test(path)))
    return file('Builder references', 'The address identifies a specific development project.');
  if (host === 'docs.google.com' && /^\/(?:document|spreadsheets|presentation)\//.test(path))
    return file('Project work', 'This is a direct link to a working document.');
  if (/\b(?:parking|parkeren)\b/.test(text) && /airport|luchthaven/i.test(title + host))
    return file('Travel references', 'The saved title identifies airport parking information.');
  if (/\/releases?\//.test(path)) return file('References', 'The address identifies a particular release.');
  if (/^support\.|^help\./.test(host) && /\/articles?\//.test(path))
    return file('References', 'The address points to a specific help article.');
  if (/\bhow to\b/.test(text) || /how-to-/.test(path))
    return file('How-to guides', 'The saved title or address describes a worked example.');
  if (/open[- ]source/.test(text) && /\bmodels?\b/.test(text))
    return file('Reading references', 'The title names a family of models you can read about or compare.');
  if ((/live.?cod/.test(text) && /audio|music/.test(text)) ||
      (path === '/' && (/creative/.test(text) && /\bai\b/.test(text) ||
        /connected/.test(text) && /one place/.test(text) || /projects?/.test(text) && /agents/.test(text))))
    return file('Tools to try', 'The title describes a tool and an activity you can try with it.');
  const bin = suggestBin({ title, url: address });
  if (bin.name === 'Price-watch review') return ask('Are you interested in buying this item?', 'The address identifies a specific listing.');
  if (bin.name === 'Buying research') return file('Buying research', 'The saved details point to product information you can compare.');
  if (bin.name === 'Technical reference' || bin.name === 'Discussions and answers')
    return file('References', bin.reason);
  return ask('What would you go back to this page to do?', 'Keep it, save a next step, or archive it if you have finished.');
}
