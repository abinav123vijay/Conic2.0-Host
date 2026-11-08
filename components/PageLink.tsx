import Link from 'next/link';
import type { Route } from 'next';
export function PageLink({href,label}:{href:Route;label:string}){return <Link className="button secondary" href={href}>{label}</Link>}
