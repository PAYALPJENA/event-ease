import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { setFollowing } from '../services/studentService';
import type { Club } from '../types/event';

/** Follow / unfollow a club (blueprint §4.11). */
const FollowButton = ({ club, following, onChange }: { club: Pick<Club, 'id' | 'name'>; following: boolean; onChange: (following: boolean) => void }) => {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user) {
    return <Link to="/sign-in" className="btn btn-secondary text-sm">Sign in to follow</Link>;
  }
  return (
    <button
      type="button"
      aria-pressed={following}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await setFollowing(club.id, !following);
          onChange(!following);
        } finally {
          setBusy(false);
        }
      }}
      className={following ? 'btn btn-secondary text-sm' : 'btn btn-primary text-sm'}
    >
      {following ? 'Following' : 'Follow'}
      <span className="sr-only"> {club.name}</span>
    </button>
  );
};

export default FollowButton;
