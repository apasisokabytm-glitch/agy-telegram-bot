module.exports = {
  apps: [{
    name: 'agy-telegram-bot',
    script: 'bot.js',
    cwd: __dirname,
    watch: false,
    autorestart: true,
    max_restarts: 20,
    env: { NODE_ENV: 'production' },
    error_file: './data/bot.err.log',
    out_file: './data/bot.out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};
