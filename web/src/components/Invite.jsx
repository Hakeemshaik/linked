import { Suspense, lazy, useEffect, useState } from 'react';

// The invite sheet (with its QR code maker) loads the first time it's opened, not with the app.
const InviteSheet = lazy(() => import('./InviteSheet.jsx'));

export default function Invite({ open, onClose }) {
  const [used, setUsed] = useState(open);
  useEffect(() => { if (open) setUsed(true); }, [open]);
  if (!used) return null;
  return <Suspense fallback={null}><InviteSheet open={open} onClose={onClose} /></Suspense>;
}
