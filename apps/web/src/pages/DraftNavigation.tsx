import { useEffect, useRef, useState } from 'react';
import styles from './ReviewPage.module.css';

export type DraftStage = 'sources' | 'drafts';

export function useDraftNavigation(hasDrafts: boolean | undefined) {
  const [choice, setChoice] = useState<DraftStage | null>(null);
  const draftsButton = useRef<HTMLButtonElement>(null);
  const stage = choice ?? (hasDrafts ? 'drafts' : 'sources');
  useEffect(() => {
    if (choice === null && hasDrafts !== undefined) setChoice(hasDrafts ? 'drafts' : 'sources');
  }, [choice, hasDrafts]);
  function showPreparedDraft() {
    setChoice('drafts');
    draftsButton.current?.focus();
  }
  return { stage, setChoice, draftsButton, showPreparedDraft };
}

export function DraftNavigation({ navigation }: { navigation: ReturnType<typeof useDraftNavigation> }) {
  const { stage, setChoice, draftsButton } = navigation;
  return <div role="group" aria-label="Draft workflow" className={styles.filters}>
    <button type="button" aria-pressed={stage === 'sources'} onClick={() => setChoice('sources')}>Find bookmarks</button>
    <button type="button" aria-pressed={stage === 'drafts'} onClick={() => setChoice('drafts')} ref={draftsButton}>Review drafts</button>
  </div>;
}
