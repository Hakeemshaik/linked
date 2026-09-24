import { useEffect, useState } from 'react';
import { get, post, del } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Avatar, Header, Empty, Icon } from '../components/ui.jsx';
import { ago } from '../lib/dates.js';
import { pushState } from '../lib/push.js';

const KIND_ICON = {
  event_invite: ['cal', 'var(--violet)'], event_update: ['cal', 'var(--blue)'], event_cancel: ['x', 'var(--danger)'], rsvp: ['check', 'var(--ok)'],
  reminder: ['clock', 'var(--gold)'], invite_call: ['video', 'var(--ok)'], missed_call: ['video', 'var(--danger)'], invite_chill: ['coffee', 'var(--pink)'], invite_response: ['check', 'var(--ok)'],
  friend_request: ['userPlus', 'var(--violet)'], friend_accept: ['friends', 'var(--ok)'], message: ['chat', 'var(--blue)'], test: ['bell', 'var(--gold)'],
};

// Opening this screen counts as seeing them all: the count goes back to zero, the new ones stay highlighted until you leave.
export default function Alerts() {
  const { setUnread, navigate, toast } = useApp();
  const [list, setList] = useState(null);
  const [push] = useState(pushState);

  const load = () => get('/notifications').then((r) => {
    setList((cur) => {
      const seenNew = new Set((cur || []).filter((n) => n.fresh).map((n) => n.id));
      return r.notifications.map((n) => ({ ...n, fresh: !n.read || seenNew.has(n.id) }));
    });
    if (r.unread) post('/notifications/read-all').then(() => setUnread(0)).catch(() => {});
    else setUnread(0);
  }).catch(() => setList((c) => c || []));
  useEffect(() => { load(); }, []); // eslint-disable-line
  useSocket('notification', (n) => n.kind !== 'message' && n.kind !== 'reaction' && load());

  const clear = async () => {
    const before = list;
    setList([]);
    try { await del('/notifications'); } catch (e) { setList(before); toast({ title: 'Could not clear', body: e.message }); }
  };

  const fresh = (list || []).filter((n) => n.fresh);
  const earlier = (list || []).filter((n) => !n.fresh);
  const rows = (items) => (
    <div className="group-list">{items.map((n) => {
      const [icon, color] = KIND_ICON[n.kind] || KIND_ICON.test;
      return (
        <button key={n.id} className={`row-item notif ${n.fresh ? 'is-unread' : ''}`} onClick={() => navigate(n.url)}>
          {n.data?.from ? <span className="notif-face"><Avatar user={n.data.from} size={44} /><i style={{ '--c': color }}><Icon name={icon} size={12} /></i></span>
            : <span className="qi" style={{ '--c': color }}><Icon name={icon} /></span>}
          <span className="grow"><b>{n.title}</b>{n.body && <small className="wrap">{n.body}</small>}</span>
          <small className="muted notif-time">{ago(n.created_at)}</small>
        </button>
      );
    })}</div>
  );

  return (
    <>
      <Header back="/" title="Notifications" right={list?.length > 0 && <button className="link" onClick={clear}>Clear</button>} />

      {push !== 'granted' && (
        <button className="row-item banner-row card-row" onClick={() => navigate('/you/notifications')}>
          <span className="round-ic solid" style={{ '--c': 'var(--gold)' }}><Icon name="bell" size={20} /></span>
          <span className="grow"><b>{push === 'denied' ? 'Notifications are blocked' : 'Turn on notifications'}</b><small>So calls and messages reach you when Linkup is closed</small></span>
          <Icon name="right" size={18} className="muted" />
        </button>
      )}

      {!list ? <div className="spinner" /> : list.length === 0 ? (
        <Empty art="alerts" title="All caught up">Invites, plan updates, reminders and missed calls show up here. Messages stay in your chats.</Empty>
      ) : (
        <>
          {fresh.length > 0 && <><h2 className="list-label">New</h2>{rows(fresh)}</>}
          {earlier.length > 0 && <><h2 className="list-label">Earlier</h2>{rows(earlier)}</>}
        </>
      )}
    </>
  );
}
