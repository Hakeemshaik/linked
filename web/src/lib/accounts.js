// Accounts signed in on this phone, so you can switch between them (You → Account → Add account).
const KEY = 'linkup_accounts';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 5))); } catch { /* private mode */ } };

export const savedAccounts = () => read();
export function rememberAccount(user, token) {
  if (!user?.id || !token) return;
  const { id, username, display_name, avatar, color } = user;
  write([{ id, username, display_name, avatar, color, token }, ...read().filter((a) => a.id !== id)]);
}
export const forgetAccount = (id) => write(read().filter((a) => a.id !== id));
