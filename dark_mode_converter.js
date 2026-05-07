const fs = require('fs');

let html = fs.readFileSync('dashboard.html', 'utf8');

// Logo Inversion
html = html.replace(/<img src="assets\/pingcounter_logo\.svg" className="h-16"/g, '<img src="assets/pingcounter_logo.svg" className="h-16 invert opacity-90"');
html = html.replace(/<img src="assets\/pingcounter_logo\.svg" className="h-10"/g, '<img src="assets/pingcounter_logo.svg" className="h-10 invert opacity-90"');

// Body
html = html.replace(/<body class="bg-\[#f8fafc\] text-slate-900">/g, '<body class="bg-[#0b1120] text-slate-50 selection:bg-blue-500/30">');

// App Header Glassmorphism update
// We'll surgically update `header className="bg-white border-b border-slate-200...`
html = html.replace(/header className="bg-white border-b border-slate-200/g, 'header className="bg-[#0b1120]/80 backdrop-blur-md border-b border-slate-800/80');

// Component specific massive class sweeps
const mappings = [
    // Backgrounds
    { from: 'bg-white', to: 'bg-slate-900 border-slate-800' },
    { from: 'bg-slate-50', to: 'bg-slate-800' },
    { from: 'bg-slate-100', to: 'bg-slate-800' },
    { from: 'hover:bg-slate-100', to: 'hover:bg-slate-700' },
    { from: 'hover:bg-slate-50', to: 'hover:bg-slate-800/80' },
    { from: 'bg-slate-900', to: 'bg-slate-950 border-slate-800' }, // Darker elements get deeper
    { from: 'from-blue-50 to-indigo-50', to: 'from-slate-900 to-slate-950' },
    { from: 'border-slate-50', to: 'border-slate-800' },

    // Borders
    { from: 'border-slate-100', to: 'border-slate-800' },
    { from: 'border-slate-200', to: 'border-slate-700/50' },

    // Text Colors
    { from: 'text-slate-900', to: 'text-slate-50' },
    { from: 'text-slate-800', to: 'text-slate-100' },
    { from: 'text-slate-700', to: 'text-slate-300' },
    { from: 'text-slate-600', to: 'text-slate-400' },
    { from: 'text-slate-500', to: 'text-slate-400' },
    
    // Shadows
    { from: 'shadow-slate-200/50', to: 'shadow-black/50' },
    { from: 'shadow-slate-200', to: 'shadow-black/50' },
];

let replacedCount = 0;
for (const map of mappings) {
    const regex = new RegExp(`\\b${map.from}\\b`, 'g');
    html = html.replace(regex, map.to);
}

fs.writeFileSync('dashboard.html', html);
console.log('UI CSS tokens replaced successfully for dark mode.');
