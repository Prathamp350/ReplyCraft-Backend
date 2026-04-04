const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

const routes = [];

files.forEach(file => {
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
    const baseRouteMatch = file.replace('.routes.js', '');
    
    const lines = content.split('\n');
    lines.forEach(line => {
        const match = line.match(/router\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/);
        if (match) {
            const method = match[1].toUpperCase();
            const endpoint = match[2];
            routes.push(`- **${method}** \`/api/${baseRouteMatch === 'auth' ? 'auth' : baseRouteMatch === 'reply' ? 'reply' : baseRouteMatch === 'review' ? 'reviews' : baseRouteMatch === 'google' ? 'google' : baseRouteMatch === 'profile' ? 'profile' : baseRouteMatch === 'analytics' ? 'analytics' : baseRouteMatch === 'billing' ? 'billing' : baseRouteMatch === 'aiConfig' ? 'ai-config' : baseRouteMatch === 'integration' ? 'integrations' : baseRouteMatch === 'insights' ? 'insights' : baseRouteMatch === 'settings' ? 'settings' : baseRouteMatch === 'dashboard' ? 'dashboard' : baseRouteMatch === 'contact' ? 'contact' : baseRouteMatch === 'admin' ? 'admin' : baseRouteMatch === 'ticket' ? 'tickets' : baseRouteMatch}${endpoint === '/' ? '' : endpoint}\``);
        }
    });
});

console.log(routes.join('\n'));
