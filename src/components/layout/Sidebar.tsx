import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Search, Link2, BookOpen, BarChart2, Bot, Menu, X, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/screener', label: 'Screener', icon: Search },
  { to: '/chain', label: 'Options Chain', icon: Link2 },
  { to: '/journal', label: 'Trade Journal', icon: BookOpen },
  { to: '/analytics', label: 'Analytics', icon: BarChart2 },
  { to: '/auto', label: 'Auto Trader', icon: Bot },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const isMobile = useIsMobile();

  const renderLink = (to: string, label: string, Icon: React.ElementType) => {
    const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
    return (
      <NavLink
        key={to}
        to={to}
        onClick={() => isMobile && setMobileOpen(false)}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
          collapsed && !isMobile && 'justify-center px-0'
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        {(isMobile || !collapsed) && <span>{label}</span>}
      </NavLink>
    );
  };

  const content = (
    <>
      <div className={cn('flex items-center border-b border-sidebar-border', collapsed && !isMobile ? 'h-14 justify-center' : 'px-4 py-4')}>
        {collapsed && !isMobile ? (
          <TrendingUp className="h-5 w-5 text-primary" />
        ) : (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <span className="text-sm font-bold tracking-tight text-foreground">Options Edge</span>
            </div>
            {isMobile && (
              <button onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {!(collapsed && !isMobile) && (
          <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 pb-2">
            Navigation
          </span>
        )}
        {navItems.map(({ to, label, icon }) => renderLink(to, label, icon))}
      </nav>

      {!isMobile && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-10 items-center justify-center border-t border-sidebar-border text-muted-foreground hover:text-foreground transition-colors w-full text-xs"
        >
          {collapsed ? '→' : '←'}
        </button>
      )}
    </>
  );

  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-card border border-border shadow-md text-foreground"
        >
          <Menu className="h-4 w-4" />
        </button>
        {mobileOpen && (
          <>
            <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setMobileOpen(false)} />
            <aside className="fixed inset-y-0 left-0 z-50 w-60 bg-sidebar border-r border-sidebar-border flex flex-col shadow-xl">
              {content}
            </aside>
          </>
        )}
      </>
    );
  }

  return (
    <aside className={cn('h-screen sticky top-0 flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300', collapsed ? 'w-[60px]' : 'w-[220px]')}>
      {content}
    </aside>
  );
}
