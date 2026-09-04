import { useParams } from 'react-router-dom';
import { useHubs } from '../api/queries';
import { LinksView } from '../components/LinksView';
import styles from './HubPage.module.css';

export function HubPage() {
  const { hubId } = useParams<{ hubId: string }>();
  const { data, isPending } = useHubs();

  if (!hubId) return null;
  if (isPending) return null;

  const hub = data?.items.find((item) => item.id === hubId);
  if (!hub) {
    return (
      <div className={styles.state} role="status">
        <h2>Hub not found</h2>
        <p>This hub may have been renamed, archived, or removed.</p>
      </div>
    );
  }

  return <LinksView hubId={hubId} />;
}
