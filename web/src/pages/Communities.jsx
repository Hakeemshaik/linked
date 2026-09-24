import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { get, post, patch } from '../lib/api.js';
import { useApp, useSocket } from '../lib/store.jsx';
import { Avatar, Header, Icon, Sheet, Empty, Confirm, FriendPicker, Cell } from '../components/ui.jsx';
import { AVATARS, EMOJI, avatarUrl, emojiUrl } from '../lib/art.js';
import { cached, cache } from '../lib/cache.js';

const PICS = [...EMOJI.map((e) => [e.id, emojiUrl(e.id)]), ...AVATARS.map((a) => [a.id, avatarUrl(a.id)])];
const picUrl = (id) => PICS.find(([k]) => k === id)?.[1];

export function CommunityPic({ c, size = 52 }) {
  const url = c?.avatar && picUrl(c.avatar);
  return (
    <span className="community-pic" style={{ width: size, height: size, '--r': `${Math.round(size * 0.3)}px` }}>
      {url ? <img src={url} alt="" draggable="false" /> : <Icon name="community" size={size * 0.5} />}
    </span>
  );
}

/** Name, description, picture and first members of a new community. */
function CreateSheet({ open, onClose, onDone }) {
  const { friends, toast } = useApp();
  const [f, setF] = useState({ name: '', description: '', avatar: 'party', member_ids: [] });
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ name: '', description: '', avatar: 'party', member_ids: [] }); setStep(1); } }, [open]);
  const create = async () => {
    setBusy(true);
    try { const r = await post('/communities', f); onDone(r.community); }
    catch (e) { toast({ title: 'Could not create it', body: e.message }); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={step === 1 ? 'New community' : 'Add members'}>
      {step === 1 ? (
        <div className="form">
          <div className="pic-row">
            {PICS.slice(0, 10).map(([k, url]) => (
              <button key={k} type="button" className={`pic-opt ${f.avatar === k ? 'on' : ''}`} onClick={() => setF({ ...f, avatar: k })} aria-label={k}><img src={url} alt="" /></button>
            ))}
          </div>
          <input autoFocus placeholder="Community name, e.g. Varsity crew" maxLength={50} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <textarea rows={2} placeholder="What's it about? (optional)" maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <p className="muted small">A community holds several groups, plus an Announcements chat that everyone in it gets.</p>
          <button className="btn primary block" disabled={!f.name.trim()} onClick={() => setStep(2)}>Next</button>
        </div>
      ) : (
        <div className="form">
          <FriendPicker friends={friends.friends} picked={f.member_ids} onChange={(ids) => setF({ ...f, member_ids: ids })} />
          <button className="btn primary block" disabled={busy} onClick={create}>{busy ? 'Creating…' : f.member_ids.length ? `Create with ${f.member_ids.length + 1} people` : 'Create, add people later'}</button>
          <button className="btn quiet block" onClick={() => setStep(1)}>Back</button>
        </div>
      )}
    </Sheet>
  );
}

/* The Communities tab. */
export default function Communities() {
  const { navigate } = useApp();
  const [qs, setQs] = useSearchParams();
  const [list, setList] = useState(() => cached('communities') || null);
  const [create, setCreate] = useState(!!qs.get('new'));
  const load = () => get('/communities').then((r) => { setList(r.communities); cache('communities', r.communities); }).catch(() => setList((l) => l || []));
  useEffect(() => { load(); if (qs.get('new')) setQs({}, { replace: true }); }, []); // eslint-disable-line
  useSocket('communities:changed', load);
  return (
    <>
      <Header title="Communities" right={<button className="icon-plain accent" onClick={() => setCreate(true)} aria-label="New community"><Icon name="plus" size={26} /></button>} />
      {list && list.length === 0 ? (
        <div className="community-intro">
          <span className="community-hero"><Icon name="community" size={44} /></span>
          <h2>Stay connected with a community</h2>
          <p className="muted">Bring your groups together: a varsity class, a sports club, the family. Everyone gets the Announcements, and people join the groups they care about.</p>
          <button className="btn primary big-btn block" onClick={() => setCreate(true)}>Start your community</button>
        </div>
      ) : !list ? <div className="spinner" /> : (
        <>
          <button className="row-item new-community" onClick={() => setCreate(true)}>
            <span className="community-pic add" style={{ width: 52, height: 52, '--r': '16px' }}><Icon name="plus" size={26} /></span>
            <span className="grow"><b>New community</b></span>
          </button>
          {list.map((c) => (
            <section key={c.id} className="community-block">
              <button className="row-item" onClick={() => navigate(`/community/${c.id}`)}>
                <CommunityPic c={c} size={52} />
                <span className="grow"><b>{c.name}</b><small>{c.members.length} member{c.members.length === 1 ? '' : 's'} · {c.groups.length + 1} chat{c.groups.length ? 's' : ''}</small></span>
                <Icon name="right" size={18} className="muted" />
              </button>
              <div className="community-chats">
                {c.announcements_id && (
                  <button className="row-item" onClick={() => navigate(`/chat/${c.announcements_id}`)}>
                    <span className="tile-ic" style={{ '--c': 'var(--ok)' }}><Icon name="megaphone" size={19} /></span>
                    <span className="grow"><b>Announcements</b></span>
                  </button>
                )}
                {c.groups.filter((g) => g.joined).slice(0, 3).map((g) => (
                  <button key={g.id} className="row-item" onClick={() => navigate(`/chat/${g.id}`)}>
                    <span className="tile-ic" style={{ '--c': 'var(--accent)' }}><Icon name="friends" size={19} /></span>
                    <span className="grow"><b>{g.name}</b></span>
                  </button>
                ))}
                {c.groups.some((g) => !g.joined) && (
                  <button className="row-item" onClick={() => navigate(`/community/${c.id}`)}>
                    <span className="grow"><small className="accent">{c.groups.filter((g) => !g.joined).length} more group{c.groups.filter((g) => !g.joined).length > 1 ? 's' : ''} to join</small></span>
                  </button>
                )}
              </div>
            </section>
          ))}
        </>
      )}
      <CreateSheet open={create} onClose={() => setCreate(false)} onDone={(c) => { setCreate(false); load(); navigate(`/community/${c.id}`); }} />
    </>
  );
}

/* One community: announcements, its groups (join the ones you want), members. */
export function Community() {
  const { id } = useParams();
  const { friends, navigate, toast, me } = useApp();
  const [c, setC] = useState(null);
  const [sheet, setSheet] = useState(null); // add | group | edit
  const [picked, setPicked] = useState([]);
  const [gname, setGname] = useState('');
  const [edit, setEdit] = useState({});
  const [ask, setAsk] = useState(null);
  const load = () => get(`/communities/${id}`).then((r) => setC(r.community)).catch(() => navigate('/communities', { replace: true }));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  useSocket('communities:changed', load);
  if (!c) return <><Header back="/communities" title="" /><div className="spinner" /></>;
  const admin = c.role === 'admin';
  const addMembers = async () => {
    try { await post(`/communities/${id}/members`, { member_ids: picked }); setSheet(null); setPicked([]); load(); toast({ title: 'Added to the community' }); }
    catch (e) { toast({ title: 'Could not add', body: e.message }); }
  };
  const newGroup = async () => {
    try { const r = await post(`/communities/${id}/groups`, { name: gname }); setSheet(null); setGname(''); navigate(`/chat/${r.conversation_id}`); }
    catch (e) { toast({ title: 'Could not create the group', body: e.message }); }
  };
  const join = async (g) => {
    try { await post(`/communities/${id}/groups/${g.id}/join`); navigate(`/chat/${g.id}`); }
    catch (e) { toast({ title: 'Could not join', body: e.message }); }
  };
  const save = async () => {
    try { const r = await patch(`/communities/${id}`, edit); setC(r.community); setSheet(null); }
    catch (e) { toast({ title: 'Could not save', body: e.message }); }
  };
  return (
    <>
      <Header back="/communities" title="" right={admin && <button className="link" onClick={() => { setEdit({ name: c.name, description: c.description || '', avatar: c.avatar }); setSheet('edit'); }}>Edit</button>} />
      <section className="info-hero">
        <CommunityPic c={c} size={96} />
        <h2>{c.name}</h2>
        <p className="muted">Community · {c.members.length} member{c.members.length === 1 ? '' : 's'}</p>
        {c.description && <p className="community-desc">{c.description}</p>}
        <div className="info-actions">
          <button onClick={() => { setPicked([]); setSheet('add'); }}><Icon name="userPlus" size={22} />Add people</button>
          <button onClick={() => setSheet('group')}><Icon name="plus" size={22} />New group</button>
        </div>
      </section>

      <div className="group-list">
        {c.announcements_id && (
          <button className="row-item" onClick={() => navigate(`/chat/${c.announcements_id}`)}>
            <span className="tile-ic lg" style={{ '--c': 'var(--ok)' }}><Icon name="megaphone" size={22} /></span>
            <span className="grow"><b>Announcements</b><small>Everyone in the community</small></span>
            <Icon name="right" size={18} className="muted" />
          </button>
        )}
      </div>
      <div className="list-label">Groups you're in</div>
      <div className="group-list">
        {c.groups.filter((g) => g.joined).length === 0 && <p className="muted small pad empty-note">None yet. Join one below or start a new group.</p>}
        {c.groups.filter((g) => g.joined).map((g) => (
          <button key={g.id} className="row-item" onClick={() => navigate(`/chat/${g.id}`)}>
            <span className="tile-ic lg" style={{ '--c': 'var(--accent)' }}><Icon name="friends" size={22} /></span>
            <span className="grow"><b>{g.name}</b><small>{g.member_count} member{g.member_count === 1 ? '' : 's'}</small></span>
            <Icon name="right" size={18} className="muted" />
          </button>
        ))}
      </div>
      {c.groups.some((g) => !g.joined) && (
        <>
          <div className="list-label">Groups you can join</div>
          <div className="group-list">
            {c.groups.filter((g) => !g.joined).map((g) => (
              <div key={g.id} className="row-item">
                <span className="tile-ic lg" style={{ '--c': '#8A8A99' }}><Icon name="friends" size={22} /></span>
                <span className="grow"><b>{g.name}</b><small>{g.member_count} member{g.member_count === 1 ? '' : 's'}</small></span>
                <button className="btn small primary" onClick={() => join(g)}>Join</button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="list-label">{c.members.length} members</div>
      <div className="group-list">
        {c.members.map((u) => (
          <div key={u.id} className="row-item">
            <Avatar user={u} size={40} />
            <span className="grow"><b>{u.id === me?.id ? 'You' : u.display_name}</b><small>@{u.username}</small></span>
            {u.role === 'admin' && <span className="tag">Admin</span>}
          </div>
        ))}
      </div>
      <div className="group-list mt">
        <Cell icon="logout" danger title="Leave community" chevron={false} onClick={() => setAsk({
          title: `Leave "${c.name}"?`, body: "You'll leave its Announcements and all its groups.", ok: 'Leave', danger: true,
          run: async () => { await post(`/communities/${id}/leave`); navigate('/communities', { replace: true }); },
        })} />
      </div>

      <Sheet open={sheet === 'add'} onClose={() => setSheet(null)} title="Add people">
        <FriendPicker friends={friends.friends} picked={picked} onChange={setPicked} exclude={c.members.map((m) => m.id)} />
        <button className="btn primary block" disabled={!picked.length} onClick={addMembers}>Add{picked.length ? ` ${picked.length}` : ''}</button>
      </Sheet>
      <Sheet open={sheet === 'group'} onClose={() => setSheet(null)} title="New group">
        <div className="form">
          <input autoFocus placeholder="Group name, e.g. Soccer on Sundays" value={gname} maxLength={60} onChange={(e) => setGname(e.target.value)} />
          <p className="muted small">Anyone in {c.name} can see it and join.</p>
          <button className="btn primary block" disabled={!gname.trim()} onClick={newGroup}>Create group</button>
        </div>
      </Sheet>
      <Sheet open={sheet === 'edit'} onClose={() => setSheet(null)} title="Edit community">
        <div className="form">
          <div className="pic-row">
            {PICS.slice(0, 10).map(([k, url]) => (
              <button key={k} type="button" className={`pic-opt ${edit.avatar === k ? 'on' : ''}`} onClick={() => setEdit({ ...edit, avatar: k })} aria-label={k}><img src={url} alt="" /></button>
            ))}
          </div>
          <input value={edit.name || ''} maxLength={50} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <textarea rows={3} maxLength={300} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="Description" />
          <button className="btn primary block" disabled={!edit.name?.trim()} onClick={save}>Save</button>
        </div>
      </Sheet>
      <Confirm ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}
