const { useState, useEffect, useRef } = React;

const Icon = ({ name, size = 20, className = "" }) => {
    const iconRef = useRef(null);
    useEffect(() => {
        if (window.lucide && iconRef.current) {
            window.lucide.createIcons({
                attrs: { class: className, width: size, height: size },
                nameAttr: 'data-lucide',
                root: iconRef.current
            });
        }
    }, [name, size, className]);
    return <span ref={iconRef}><i data-lucide={name}></i></span>;
};

const Toast = ({ message, type = 'success', onClose }) => (
    <div className={`fixed bottom-6 right-6 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border animate-fade-in z-[200] ${
        type === 'error' ? 'bg-red-900 border-red-800 text-white' : 'bg-slate-950 border-slate-800 text-white'
    }`}>
        <Icon name={type === 'error' ? "alert-circle" : "check-circle"} size={20} className={type === 'success' ? 'text-emerald-400' : 'text-red-400'} />
        <span className="text-sm font-bold tracking-wide">{message}</span>
        <button onClick={onClose} className="ml-4 text-slate-400 hover:text-white transition"><Icon name="x" size={16} /></button>
    </div>
);

const Logo = ({ className = "h-10", collapsed = false }) => (
    <svg className={className} viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg">
        <g transform="translate(0, 6)" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3 l-3 9H2" transform="scale(1.2)"/>
        </g>
        {!collapsed && (
            <text x="40" y="28" fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="900" fontSize="20" letterSpacing="-1">
                <tspan fill="white">PING</tspan>
                <tspan fill="#3b82f6">COUNTER</tspan>
            </text>
        )}
    </svg>
);

const SidebarItem = ({ name, icon, active, onClick, badge }) => (
    <button 
        onClick={onClick}
        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-all duration-200 group mb-1 ${
            active ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100 border border-transparent'
        }`}
    >
        <div className="flex items-center gap-3">
            <Icon name={icon} size={18} className={active ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'} />
            <span className="text-sm font-bold tracking-tight">{name}</span>
        </div>
        {badge > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-lg shadow-red-500/20">{badge}</span>
        )}
    </button>
);

const Sidebar = ({ activeView, user, onLogout }) => (
    <aside className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col h-screen sticky top-0 shrink-0">
        <div className="p-6 border-b border-slate-800/50 mb-4">
            <a href="index.html" className="cursor-pointer block">
                <Logo className="h-8" />
            </a>
        </div>

        <div className="flex-1 px-4 overflow-y-auto">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 px-4">Navigation</div>
            <SidebarItem 
                name="Dashboard" 
                icon="layout-dashboard" 
                active={activeView === 'projects'} 
                onClick={() => window.location.href = 'index.html'} 
            />
            <SidebarItem 
                name="Usage & Plan" 
                icon="bar-chart-3" 
                active={activeView === 'account'} 
                onClick={() => window.location.href = 'settings.html'} 
            />
            
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 mt-8 px-4">Management</div>
            <SidebarItem 
                name="Settings" 
                icon="settings" 
                active={activeView === 'account'} 
                onClick={() => window.location.href = 'settings.html'} 
            />
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/50">
            <a href="settings.html" className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-800 transition group mb-2 border border-transparent hover:border-slate-700/50">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black uppercase shadow-lg shadow-blue-500/20">
                    {(user?.full_name || user?.email || '?')[0]}
                </div>
                <div className="text-left overflow-hidden">
                    <div className="text-sm font-bold text-slate-100 truncate">{user?.full_name || 'Ping User'}</div>
                    <div className="text-[10px] font-bold text-slate-500 truncate uppercase tracking-widest leading-none mt-1">Free Tier</div>
                </div>
            </a>
            <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition group font-bold text-sm">
                <Icon name="log-out" size={18} />
                Logout
            </button>
        </div>
    </aside>
);

const Breadcrumb = ({ view, subView, project }) => {
    const items = [{ label: 'Dashboard', url: 'index.html' }];
    if (view === 'project-detail' && project) {
        items.push({ label: project.project_name, url: `project.html?name=${project.project_name}` });
        if (subView !== 'overview') {
            items.push({ label: subView.charAt(0).toUpperCase() + subView.slice(1), active: true });
        } else {
            items[items.length - 1].active = true;
        }
    } else if (view === 'account') {
        items.push({ label: 'Account Settings', active: true });
    } else {
        items[0].active = true;
    }

    return (
        <div className="h-16 border-b border-slate-800 bg-slate-900/30 flex items-center px-8 shrink-0">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                {items.map((item, idx) => (
                    <React.Fragment key={idx}>
                        {idx > 0 && <Icon name="chevron-right" size={14} className="text-slate-700" />}
                        {item.active ? (
                            <span className="uppercase tracking-widest text-slate-100 font-black">{item.label}</span>
                        ) : (
                            <a href={item.url} className="uppercase tracking-widest transition-colors hover:text-slate-300">
                                {item.label}
                            </a>
                        )}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};
