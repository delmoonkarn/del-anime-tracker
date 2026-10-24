import { useEffect, useState } from 'react';

// Below Tailwind's `sm` breakpoint (640px).
const PHONE = '(max-width: 639px)';

/** True on a phone-sized screen, where lists switch to compact rows and
 *  3-column poster grids. Follows the window as it's resized or rotated. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const onChange = () => setPhone(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return phone;
}
