export function getDashboardUrl(env = process.env) {
    if (env.PUBLIC_URL)
        return env.PUBLIC_URL;
    if (env.NODE_ENV === 'production')
        return 'https://football-analytics-bot-0zwd.onrender.com';
    return 'http://localhost:5000';
}
