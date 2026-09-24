import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { get, post, patch, del } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Avatar, GroupAvatar, Header, Icon, Sheet, Empty, Confirm, FriendPicker } from '../components/ui.jsx';
import { relDay, fmtTime } from '../lib/dates.js';
import RichText from '../components/RichText.jsx';

/* ---------- Lists: your own chat filters, shown on the Chats screen ---------- */
export function Lists() {
  const { toast } = useApp();
  const [qs, setQs] = useSearchParams();
  const [lists, setLists] = useState(null);
  const [convs, setConvs] = useState([]);
  const [edit, setEdit] = useState(null); // { id?, name, conversation_ids }
  const [ask, setAsk] = useState(null);
  const load = () => get('/lists').then((r) => setLists(r.lists)).catch(() => setLists([]));
  useEffect(() => {
    load();
    get('/conversations').then((r) => setConvs(r.conversations.filter((c) => !c.is_ai))).catch(() => {});
    if (qs.get('new')) { setEdit({ name: '', conversation_ids: [] }); setQs({}, { replace: true }); }
  }, []); // eslint-disable-line
  const save = async () => {
    try {
      if (edit.id) await patch(`/lists/${edit.id}`, { name: edit.name, conversation_ids: edit.conversation_ids });
      else await post('/lists', { name: edit.name, conversation_ids: edit.conversation_ids });
      setEdit(null); load();
      toast({ title: 'List saved', body: 'It shows as a filter on your Chats screen' });
    } catch (e) { toast({ title: 'Could not save', body: e.message }); }
  };
  const ids = edit?.conversation_ids || [];
  return (
    <>
      <Header back="/you" title="Lists" right={<button className="icon-plain accent" onClick={() => setEdit({ name: '', conversation_ids: [] })} aria-label="New list"><Icon name="plus" size={26} /></button>} />
      <p className="note">Group chats your way, like Family, Work or Trip crew. Each list is a filter at the top of Chats.</p>
      {!lists ? <div className="spinner" /> : lists.length === 0 ? (
        <Empty title="No lists yet" action={<button className="btn primary mt" onClick={() => setEdit({ name: '', conversation_ids: [] })}>Create a list</button>}>Pick a few chats and give them a name.</Empty>
      ) : (
        <div className="group-list mt">
          {lists.map((l) => (
            <button key={l.id} className="row-item cell" onClick={() => setEdit({ ...l })}>
              <span className="tile-ic" style={{ '--c': '#8B6CFF' }}><Icon name="list" size={19} /></span>
              <span className="grow"><b>{l.name}</b><small>{l.conversation_ids.length} chat{l.conversation_ids.length === 1 ? '' : 's'}</small></span>
              <Icon name="right" size={18} className="muted" />
            </button>
          ))}
        </div>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit list' : 'New list'}>
        {edit && (
          <div className="form">
            <input autoFocus placeholder="List name, e.g. Family" value={edit.name} maxLength={30} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <div className="list-label">Chats</div>
            <div className="sheet-list picker-list">
              {convs.map((c) => (
                <button key={c.id} type="button" className="row-item" onClick={() => setEdit({ ...edit, conversation_ids: ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id] })}>
                  {c.is_group ? <GroupAvatar conv={c} size={40} /> : <Avatar user={c.members.find((m) => !m.me)} size={40} />}
                  <span className="grow"><b>{c.title}</b></span>
                  <span className={`check ${ids.includes(c.id) ? 'on' : ''}`}>{ids.includes(c.id) && <Icon name="check" size={16} />}</span>
                </button>
              ))}
            </div>
            <button className="btn primary block" disabled={!edit.name.trim()} onClick={save}>Save{ids.length ? ` (${ids.length})` : ''}</button>
            {edit.id && <button className="btn quiet block danger-text" onClick={() => setAsk({ title: `Delete "${edit.name}"?`, body: 'The chats stay, only the list goes.', ok: 'Delete list', danger: true, run: async () => { await del(`/lists/${edit.id}`); setEdit(null); load(); } })}>Delete list</button>}
          </div>
        )}
      </Sheet>
      <Confirm ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}

/* ---------- Broadcasts: one message, delivered to each person in your own chat with them ---------- */
export function Broadcasts() {
  const { friends, navigate, toast } = useApp();
  const [list, setList] = useState(null);
  const [create, setCreate] = useState(null); // { name, member_ids }
  const load = () => get('/broadcasts').then((r) => setList(r.broadcasts)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const save = async () => {
    try { const r = await post('/broadcasts', create); setCreate(null); navigate(`/you/broadcasts/${r.broadcast.id}`); }
    catch (e) { toast({ title: 'Could not create it', body: e.message }); }
  };
  return (
    <>
      <Header back="/you" title="Broadcasts" right={<button className="icon-plain accent" onClick={() => setCreate({ name: '', member_ids: [] })} aria-label="New broadcast"><Icon name="plus" size={26} /></button>} />
      <p className="note">Send one message to several friends at once. Each gets it in their own chat with you, and replies come back privately.</p>
      {!list ? <div className="spinner" /> : list.length === 0 ? (
        <Empty title="No broadcast lists" action={<button className="btn primary mt" onClick={() => setCreate({ name: '', member_ids: [] })}>New broadcast</button>}>Great for party invites or quick updates to a few people.</Empty>
      ) : (
        <div className="group-list mt">
          {list.map((b) => (
            <button key={b.id} className="row-item cell" onClick={() => navigate(`/you/broadcasts/${b.id}`)}>
              <span className="tile-ic" style={{ '--c': '#14A36B' }}><Icon name="megaphone" size={19} /></span>
              <span className="grow"><b>{b.name}</b><small className="ellipsis">{b.members.map((m) => m.display_name.split(' ')[0]).join(', ')}</small></span>
              <Icon name="right" size={18} className="muted" />
            </button>
          ))}
        </div>
      )}
      <Sheet open={!!create} onClose={() => setCreate(null)} title="New broadcast">
        {create && (
          <div className="form">
            <input placeholder="Name (optional), e.g. Party crew" value={create.name} maxLength={40} onChange={(e) => setCreate({ ...create, name: e.target.value })} />
            <FriendPicker friends={friends.friends} picked={create.member_ids} onChange={(ids) => setCreate({ ...create, member_ids: ids })} />
            <button className="btn primary block" disabled={!create.member_ids.length} onClick={save}>Create{create.member_ids.length ? ` (${create.member_ids.length})` : ''}</button>
          </div>
        )}
      </Sheet>
    </>
  );
}

export function Broadcast() {
  const { id } = useParams();
  const { friends, navigate, toast } = useApp();
  const [b, setB] = useState(null);
  const [sends, setSends] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [ask, setAsk] = useState(null);
  const load = () => get(`/broadcasts/${id}`).then((r) => { setB(r.broadcast); setSends(r.sends); }).catch(() => navigate('/you/broadcasts', { replace: true }));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { const r = await post(`/broadcasts/${id}/send`, { body: text }); setText(''); load(); toast({ title: `Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`, body: 'Each in their own chat with you' }); }
    catch (x) { toast({ title: 'Not sent', body: x.message }); } finally { setBusy(false); }
  };
  if (!b) return <><Header back="/you/broadcasts" title="" /><div className="spinner" /></>;
  return (
    <>
      <Header back="/you/broadcasts" title={b.name} right={<button className="link" onClick={() => setEdit({ name: b.name, member_ids: b.member_ids })}>Edit</button>} />
      <div className="avatars-row">{b.members.map((m) => <span key={m.id} className="av-chip"><Avatar user={m} size={40} /><small>{m.display_name.split(' ')[0]}</small></span>)}</div>
      <form className="broadcast-compose" onSubmit={send}>
        <textarea rows={3} placeholder={`Message to ${b.members.length} ${b.members.length === 1 ? 'person' : 'people'}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
        <button className="btn primary block" disabled={busy || !text.trim()}><Icon name="send" size={18} />{busy ? 'Sending…' : 'Send to everyone'}</button>
      </form>
      {sends.length > 0 && (
        <>
          <div className="list-label">Sent</div>
          <div className="group-list">
            {sends.map((s) => (
              <div key={s.id} className="row-item">
                <span className="grow"><small className="muted">{relDay(s.created_at)} {fmtTime(s.created_at)} · to {s.sent_to} {s.sent_to === 1 ? 'person' : 'people'}</small><span className="text sent-body"><RichText text={s.body} /></span></span>
              </div>
            ))}
          </div>
        </>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Edit broadcast">
        {edit && (
          <div className="form">
            <input value={edit.name} maxLength={40} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <FriendPicker friends={friends.friends} picked={edit.member_ids} onChange={(ids) => setEdit({ ...edit, member_ids: ids })} />
            <button className="btn primary block" disabled={!edit.member_ids.length} onClick={async () => { await patch(`/broadcasts/${id}`, edit); setEdit(null); load(); }}>Save</button>
            <button className="btn quiet block danger-text" onClick={() => setAsk({ title: 'Delete this broadcast list?', body: 'Messages already sent stay in each chat.', ok: 'Delete', danger: true, run: async () => { await del(`/broadcasts/${id}`); navigate('/you/broadcasts', { replace: true }); } })}>Delete broadcast list</button>
          </div>
        )}
      </Sheet>
      <Confirm ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}
