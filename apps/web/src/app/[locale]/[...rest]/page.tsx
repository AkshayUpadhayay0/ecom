import { notFound } from 'next/navigation';

/** Unknown URLs render the styled 404 inside the site layout. */
export default function UnknownPage(): never {
  notFound();
}
