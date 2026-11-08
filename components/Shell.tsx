'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';

const ownerLinks=[
  ['/overview','Overview'],
  ['/dashboard/monthly','Monthly Dashboard'],['/dashboard/yearly','Yearly Dashboard'],
  ['/entries/daily','Daily Entries'],['/entries/purchases','Purchases'],
  ['/finance','Finance'],['/dashboard/reconciliation','Account Reconciliation'],
  ['/settings','Settings'],['/import-export','Excel Import / Export']
] as const;
const viewerLinks=[
  ['/overview','Overview'],
  ['/dashboard/monthly','Monthly Dashboard'],['/dashboard/yearly','Yearly Dashboard'],
  ['/entries/daily','Daily Entries'],['/entries/purchases','Purchases']
] as const;
export default function Shell({children}:{children:React.ReactNode}){
  const path=usePathname(); const router=useRouter(); const [open,setOpen]=useState(false);
  const [role,setRole]=useState<'owner'|'viewer'|null>(null);
  const [theme,setTheme]=useState<'light'|'dark'>('light');
  useEffect(()=>{fetch('/api/auth/me').then(response=>response.ok?response.json():null).then(user=>setRole(user?.role||null)).catch(()=>setRole(null))},[]);
  useEffect(()=>{
    const savedTheme=window.localStorage.getItem('conic-theme');
    if(savedTheme==='light'||savedTheme==='dark'){
      setTheme(savedTheme);
      document.documentElement.dataset.theme=savedTheme;
    }
  },[]);
  if (path === '/login' || path === '/signup') return <>{children}</>;
  const links=role==='owner'?ownerLinks:role==='viewer'?viewerLinks:[];
  const logout=async()=>{await fetch('/api/auth/logout',{method:'POST'});router.replace('/login');router.refresh()};
  const toggleTheme=()=>{
    const nextTheme=theme==='light'?'dark':'light';
    setTheme(nextTheme);
    document.documentElement.dataset.theme=nextTheme;
    window.localStorage.setItem('conic-theme',nextTheme);
  };
  return <div className="app-shell">
    <aside className={`sidebar ${open?'open':''}`}>
      <div className="brand"><div className="brand-mark">C</div><div><strong>CONIC</strong><span>Business System</span></div></div>
      <nav>{links.map(([href,label])=><Link key={href} href={href as Route} onClick={()=>setOpen(false)} className={path.startsWith(href)?'active':''}>{label}</Link>)}</nav>
      <div className="sidebar-footer">MongoDB-backed • Multi-device</div>
    </aside>
    <div className="backdrop" onClick={()=>setOpen(false)} />
    <main className="main"><header className="topbar"><button className="menu" onClick={()=>setOpen(true)}>☰</button><div><div className="eyebrow">CONIC</div><div className="page-title">Business Tracker</div></div><div className="top-actions"><button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme==='light'?'dark':'light'} theme`} aria-pressed={theme==='dark'}>{theme==='light'?'Dark theme':'Light theme'}</button><button className="logout-button" onClick={logout}>Sign out</button></div></header>{children}</main>
  </div>
}
